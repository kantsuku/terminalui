require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const os = require('os');

const { listSessions, createSession, killSession, sessionExists, renameSession } = require('./lib/tmux');
const { attachSession } = require('./lib/ptyManager');

// ── 認証 ───────────────────────────────────────────────────────────────────────
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';
const AUTH_SECRET     = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');

function makeToken() {
  return crypto.createHmac('sha256', AUTH_SECRET).update(ACCESS_PASSWORD).digest('hex');
}

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) rc.split(';').forEach(c => {
    const [k, ...v] = c.split('=');
    list[k.trim()] = decodeURIComponent(v.join('=').trim());
  });
  return list;
}

function isAuthenticated(req) {
  if (!ACCESS_PASSWORD) return true;
  return parseCookies(req)['termui-auth'] === makeToken();
}

function authMiddleware(req, res, next) {
  if (!ACCESS_PASSWORD) return next();
  if (req.path === '/api/login' || req.path === '/api/auth-check') return next();
  if (req.path.startsWith('/api/') && !isAuthenticated(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
// 初回セットアップ: 必要なディレクトリを自動作成
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}${ext}`);
    },
  }),
});

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// ── キープアライブ（30秒ごとに ping、無応答なら切断）──────────────────────────
const keepAlive = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
wss.on('close', () => clearInterval(keepAlive));

app.use(express.json({ limit: '50mb' }));
app.use(authMiddleware);

// Serve built client in production
const clientDist = path.join(__dirname, 'client', 'dist');
// Assets have content hashes → cache forever
app.use('/assets', express.static(path.join(clientDist, 'assets'), { maxAge: '1y', immutable: true }));
// アップロード画像を静的配信（/uploads/xxx.png → UPLOAD_DIR/xxx.png）
app.use('/uploads', express.static(UPLOAD_DIR));
// /manifest.json は静的ファイルより先にルートで処理（ユーザーのキャラ画像アイコン用）
app.get('/manifest.json', (req, res) => {
  const userName = req.query.user || 'default';
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'no-cache');
  res.json(buildManifest(userName));
});
// index.html must not be cached
app.use(express.static(clientDist, { index: false }));
app.get('/test', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.send('<html><body style="background:red;color:white;font-size:40px;padding:40px">サーバー接続OK</body></html>');
});

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ── ユーザー設定の永続化 ───────────────────────────────────────────────────────
// user-settings/ はプロジェクト内に置いてバックアップしやすくする（gitignore済み）
const SETTINGS_DIR = process.env.SETTINGS_DIR || path.join(__dirname, 'user-settings');
fs.mkdirSync(SETTINGS_DIR, { recursive: true });

// 旧 ~/.termui-settings/ から自動マイグレーション
(function migrateOldSettings() {
  const oldDir = path.join(os.homedir(), '.termui-settings');
  try {
    if (!fs.existsSync(oldDir)) return;
    for (const f of fs.readdirSync(oldDir)) {
      const src = path.join(oldDir, f);
      const dst = path.join(SETTINGS_DIR, f);
      if (!fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
        console.log(`[Migration] ${f} を user-settings/ に移行`);
      }
    }
  } catch (e) {
    console.warn('[Migration] 失敗:', e.message);
  }
})();

function settingsPath(userName) {
  const safe = userName.replace(/[^a-zA-Z0-9_\-]/g, '_');
  return path.join(SETTINGS_DIR, `${safe}.json`);
}

// ── REST API ──────────────────────────────────────────────────────────────────

// Upload image → save to ~/Desktop/uploads/ → return file path
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  res.json({ path: req.file.path });
});

app.get('/api/user-settings/:userName', (req, res) => {
  try {
    const p = settingsPath(req.params.userName);
    if (!fs.existsSync(p)) return res.json(null);
    res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch { res.json(null); }
});

app.post('/api/user-settings/:userName', (req, res) => {
  try {
    fs.writeFileSync(settingsPath(req.params.userName), JSON.stringify(req.body));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/error-report', (req, res) => {
  console.error('[CLIENT ERROR]', req.body.error);
  res.json({ ok: true });
});

app.get('/api/auth-check', (req, res) => {
  res.json({ ok: isAuthenticated(req), passwordRequired: !!ACCESS_PASSWORD });
});

app.post('/api/login', (req, res) => {
  if (!ACCESS_PASSWORD) return res.json({ ok: true });
  const { password } = req.body;
  if (password !== ACCESS_PASSWORD) {
    return res.status(401).json({ error: 'パスワードが違うっちゃ！' });
  }
  const token = makeToken();
  const maxAge = 60 * 60 * 24 * 30; // 30日
  res.setHeader('Set-Cookie', `termui-auth=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`);
  res.json({ ok: true });
});

// 動的マニフェスト（ユーザーのキャラ画像をアイコンに使う）
function buildManifest(userName) {
  const iconUrl = `/api/icon?user=${encodeURIComponent(userName)}`;
  return {
    name: 'ラムちゃんターミナル',
    short_name: 'ラムちゃん',
    description: 'ラムちゃんがお手伝いするターミナルUIだっちゃ！',
    start_url: '/',
    display: 'standalone',
    background_color: '#0d1117',
    theme_color: '#1c2128',
    orientation: 'any',
    icons: [
      { src: iconUrl, sizes: '192x192', type: 'image/png' },
      { src: iconUrl, sizes: '512x512', type: 'image/png' },
    ],
  };
}

app.get('/api/manifest.json', (req, res) => {
  const userName = req.query.user || 'default';
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'no-cache');
  res.json(buildManifest(userName));
});

// /manifest.json はURLパラメータのuserを使って動的に返す
app.get('/manifest.json', (req, res) => {
  const userName = req.query.user || 'default';
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'no-cache');
  res.json(buildManifest(userName));
});

// ユーザーのキャラ画像をアイコンとして配信（センタークロップしてPWAホーム画面用）
app.get('/api/icon', async (req, res) => {
  const userName = req.query.user || 'default';
  try {
    const p = settingsPath(userName);
    if (!fs.existsSync(p)) return res.redirect('/character.png');
    const settings = JSON.parse(fs.readFileSync(p, 'utf8'));
    const dataUrl = settings.charImgNormal || settings.charImgIdle || settings.charImgWorking;
    if (!dataUrl || !dataUrl.startsWith('data:')) return res.redirect('/character.png');
    const [, b64] = dataUrl.split(',');
    const buf = Buffer.from(b64, 'base64');
    const sharp = require('sharp');
    const img = sharp(buf);
    const { width, height } = await img.metadata();
    const size = Math.min(width, height);
    const left = Math.floor((width - size) / 2);
    const top = Math.floor((height - size) / 2);
    const cropped = await img.extract({ left, top, width: size, height: size }).png().toBuffer();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(cropped);
  } catch {
    res.redirect('/character.png');
  }
});

app.get('/api/info', (req, res) => {
  const PORT = process.env.PORT || 3001;
  const nets = os.networkInterfaces();
  const urls = [`http://localhost:${PORT}`];
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        urls.push(`http://${iface.address}:${PORT}`);
      }
    }
  }
  res.json({ urls });
});

app.get('/api/sessions', async (req, res) => {
  res.json(await listSessions());
});

// Create a regular session or a Claude Code session
// body: { name?: string, type?: 'shell' | 'claude' }
app.post('/api/sessions', async (req, res) => {
  const { name, type, systemPrompt } = req.body;
  console.log(`[POST /api/sessions] name=${name} type=${type} from=${req.ip}`);
  try {
    const command = type === 'claude' ? 'claude' : undefined;
    const sessionName = await createSession(name, command, systemPrompt);
    console.log(`[POST /api/sessions] created: ${sessionName}`);
    res.json({ ok: true, name: sessionName });
  } catch (err) {
    console.error(`[POST /api/sessions] error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Rename a session
app.patch('/api/sessions/:name', async (req, res) => {
  const { newName } = req.body;
  if (!newName) return res.status(400).json({ error: 'newName is required' });
  try {
    await renameSession(req.params.name, newName);
    res.json({ ok: true, name: newName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:name', async (req, res) => {
  try {
    await killSession(req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// セリフ自動生成（Claude API）
app.post('/api/generate-lines', async (req, res) => {
  const { charName, claudePrompt } = req.body || {};
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY が設定されていないっちゃ' });
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic.default({ apiKey });
    const charDesc = claudePrompt
      ? `キャラクター名: ${charName || 'キャラクター'}\n口調の指示: ${claudePrompt}`
      : `キャラクター名: ${charName || 'キャラクター'}`;
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `以下のキャラクター設定に基づいて、各状態のセリフを生成してください。

${charDesc}

各状態について、そのキャラクターらしい短いセリフを5個ずつ生成してください。
セリフは10〜30文字程度の短いものにしてください。

以下のJSON形式で返してください（他のテキストは不要）:
{
  "idleLines": ["セリフ1", "セリフ2", "セリフ3", "セリフ4", "セリフ5"],
  "workingLines": ["セリフ1", ...],
  "thinkingLines": ["セリフ1", ...],
  "successLines": ["セリフ1", ...],
  "errorLines": ["セリフ1", ...],
  "offlineLines": ["セリフ1", ...]
}

状態の意味:
- idle: 待機中（暇そう、待ってる）
- working: 作業中（頑張ってる、忙しい）
- thinking: 考え中（思考中、処理中）
- success: 完了（やり遂げた、成功）
- error: エラー（失敗、困った）
- offline: オフライン（休憩中、寝てる）`,
      }],
    });
    const text = message.content[0]?.text || '';
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
    res.json({ ok: true, lines: json });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// アップデート（git pull → npm run build → 再起動）
app.post('/api/update', async (req, res) => {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  const dir = __dirname;
  try {
    const pull = await execAsync('git pull', { cwd: dir });
    const build = await execAsync('npm run build', { cwd: dir });
    res.json({ ok: true, pull: pull.stdout.trim(), build: build.stdout.trim() });
    setTimeout(() => process.exit(0), 500);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// tmux capture-pane で履歴取得
app.get('/api/sessions/:name/history', async (req, res) => {
  const { name } = req.params;
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  const TMUX = process.env.TMUX_BIN || '/opt/homebrew/bin/tmux';
  try {
    const { stdout } = await execAsync(`${TMUX} capture-pane -p -S -2000 -t "${name}" 2>/dev/null`);
    // ANSI エスケープコードを除去
    const clean = stdout.replace(/\x1b\[[0-9;]*[mGKHFABCDsuJr]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
    res.json({ content: clean });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SPA fallback (must be after API routes)
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ── WebSocket ─────────────────────────────────────────────────────────────────

wss.on('connection', (ws, req) => {
  if (!isAuthenticated(req)) {
    ws.close(1008, 'unauthorized');
    return;
  }
  console.log('[WS] connected from', req.socket.remoteAddress);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let session = null; // { proc, write, resize, kill, setAutoYes }
  let autoYesEnabled = false; // attach前に届いたautoyes状態をバッファ

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'attach': {
        if (session) session.kill();
        sessionExists(msg.session).then((exists) => {
          if (!exists) {
            ws.send(JSON.stringify({ type: 'error', message: `Session "${msg.session}" not found` }));
            return;
          }
          session = attachSession(msg.session, ws, msg.cols || 80, msg.rows || 24, msg.ntfyTopic || '');
          if (autoYesEnabled) session.setAutoYes(true);
        });
        break;
      }
      case 'input': {
        console.log('[WS] input:', JSON.stringify(msg.data));
        if (session) session.write(msg.data);
        break;
      }
      case 'resize': {
        if (session) session.resize(msg.cols, msg.rows);
        break;
      }
      case 'autoyes': {
        autoYesEnabled = !!msg.enabled;
        if (session) session.setAutoYes(autoYesEnabled);
        ws.send(JSON.stringify({ type: 'autoyes', enabled: autoYesEnabled }));
        break;
      }
    }
  });

  ws.on('close', () => {
    if (session) session.kill();
    session = null;
  });

  ws.on('error', () => {
    if (session) session.kill();
    session = null;
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Terminal UI running → http://localhost:${PORT}`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://0.0.0.0:${PORT}`);
});
