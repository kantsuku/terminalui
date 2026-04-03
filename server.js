require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const os = require('os');

const { exec, execFile, execSync } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const TMUX = process.env.TMUX_BIN || '/opt/homebrew/bin/tmux';
const { listSessions, createSession, killSession, sessionExists, renameSession } = require('./lib/tmux');
const { attachSession } = require('./lib/ptyManager');

// ── サーバー間同期 ─────────────────────────────────────────────────────────────
const SYNC_SERVERS = (process.env.SYNC_SERVERS || '').split(',').map(s => s.trim()).filter(Boolean);

async function syncToServers(apiPath, body) {
  for (const server of SYNC_SERVERS) {
    try {
      await fetch(`${server}${apiPath}?_sync=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      console.log(`[Sync] → ${server}${apiPath} OK`);
    } catch (e) {
      console.warn(`[Sync] → ${server}${apiPath} failed:`, e.message);
    }
  }
}

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
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('画像ファイルのみアップロード可能です'), false);
  },
});

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// ── キープアライブ（45秒ごとに ping、2回連続無応答で切断）─────────────────────
const keepAlive = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.missedPongs >= 2) return ws.terminate();
    if (ws.isAlive === false) {
      ws.missedPongs = (ws.missedPongs || 0) + 1;
    } else {
      ws.missedPongs = 0;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 45000);
wss.on('close', () => clearInterval(keepAlive));

// ── pty セッションプール（WS切断後も一定時間保持して再接続時に再利用）──────────
const PTY_GRACE_MS = 300000; // 5分間ptyを保持（再接続猶予を拡大）
const ptyPool = new Map(); // key: tmuxSessionName → { session, graceTimer, wsRef }

function getOrCreatePty(tmuxSession, ws, cols, rows, ntfyTopic) {
  const existing = ptyPool.get(tmuxSession);
  if (existing) {
    // ptyプロセスが死んでいたら削除して新規作成へ
    if (existing.session.isAlive && !existing.session.isAlive()) {
      console.log(`[PtyPool] dead pty detected, removing: ${tmuxSession}`);
      clearTimeout(existing.graceTimer);
      ptyPool.delete(tmuxSession);
    } else {
      // grace timer をキャンセルして再利用
      clearTimeout(existing.graceTimer);
      existing.graceTimer = null;
      existing.wsRef = ws;
      // 既存ptyの出力先を新しいWSに差し替え
      existing.session.reattachWs(ws);
      existing.session.resize(cols, rows);
      console.log(`[PtyPool] reused: ${tmuxSession}`);
      return existing.session;
    }
  }
  // 新規作成
  const session = attachSession(tmuxSession, ws, cols, rows, ntfyTopic);
  ptyPool.set(tmuxSession, { session, graceTimer: null, wsRef: ws });
  // ptyプロセス終了時にプールから自動削除
  session.onExit(() => {
    const entry = ptyPool.get(tmuxSession);
    if (entry && entry.session === session) {
      clearTimeout(entry.graceTimer);
      ptyPool.delete(tmuxSession);
      console.log(`[PtyPool] auto-removed (process exited): ${tmuxSession}`);
    }
  });
  console.log(`[PtyPool] created: ${tmuxSession}`);
  return session;
}

function releasePty(tmuxSession, releasingWs) {
  const entry = ptyPool.get(tmuxSession);
  if (!entry) return;
  // 別のWSが既にこのptyを使用中なら、リリースをスキップ（レース条件防止）
  if (releasingWs && entry.wsRef !== releasingWs) {
    console.log(`[PtyPool] skip release (ws mismatch, pty already reattached): ${tmuxSession}`);
    return;
  }
  // 既存のgrace timerがあればキャンセル
  clearTimeout(entry.graceTimer);
  // grace period: 60秒後にptyを本当に殺す（ただし再利用されていなければ）
  const releasedWs = releasingWs;
  entry.graceTimer = setTimeout(() => {
    // 再チェック: grace期間中に別のWSが再利用していたら殺さない
    if (releasedWs && entry.wsRef !== releasedWs) {
      console.log(`[PtyPool] grace expired but pty reused by new ws, skip: ${tmuxSession}`);
      return;
    }
    console.log(`[PtyPool] grace expired, detaching pty (tmux session preserved): ${tmuxSession}`);
    try { entry.session.detach ? entry.session.detach() : entry.session.kill(); } catch {}
    ptyPool.delete(tmuxSession);
  }, PTY_GRACE_MS);
  console.log(`[PtyPool] released (grace ${PTY_GRACE_MS / 1000}s): ${tmuxSession}`);
}

function killPtyImmediate(tmuxSession) {
  const entry = ptyPool.get(tmuxSession);
  if (!entry) return;
  clearTimeout(entry.graceTimer);
  entry.session.kill();
  ptyPool.delete(tmuxSession);
  console.log(`[PtyPool] killed immediately: ${tmuxSession}`);
}

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
  const urlPath = `/uploads/${req.file.filename}`;
  // アップロード後に自動gitコミット（バックグラウンドで実行、失敗しても無視）
  try {
    execSync(`git add uploads/ && git commit -m "chore: upload image ${req.file.filename}"`, {
      cwd: __dirname, stdio: 'ignore'
    });
  } catch (e) { console.warn('[Upload] git commit skipped:', e.message); }
  res.json({ path: urlPath });
});

app.get('/api/user-settings/:userName', (req, res) => {
  try {
    const p = settingsPath(req.params.userName);
    if (fs.existsSync(p)) return res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
    // ユーザー設定がなければテンプレートから作成
    // _default.json → 既存ユーザーの設定の順でフォールバック
    const defaultP = settingsPath('_default');
    if (fs.existsSync(defaultP)) return res.json(JSON.parse(fs.readFileSync(defaultP, 'utf8')));
    // 既存ユーザー設定からキャラ一覧をコピー
    const files = fs.readdirSync(SETTINGS_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
    for (const f of files) {
      try {
        const tmpl = JSON.parse(fs.readFileSync(path.join(SETTINGS_DIR, f), 'utf8'));
        if (tmpl.characters?.length > 0) return res.json(tmpl);
      } catch (e) { console.warn('[Settings] parse error:', f, e.message); }
    }
    res.json(null);
  } catch { res.json(null); }
});

app.post('/api/user-settings/:userName', async (req, res) => {
  try {
    fs.writeFileSync(settingsPath(req.params.userName), JSON.stringify(req.body));
    res.json({ ok: true });
    // _sync=1 のリクエストはループ防止のため同期しない
    if (!req.query._sync) {
      syncToServers(`/api/user-settings/${encodeURIComponent(req.params.userName)}`, req.body);
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// キャラクター設定を全ユーザーに配布
app.post('/api/broadcast-characters', (req, res) => {
  try {
    const { characters } = req.body || {};
    if (!characters?.length) return res.status(400).json({ error: 'characters が空です' });
    const files = fs.readdirSync(SETTINGS_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
    let updated = 0;
    for (const f of files) {
      try {
        const p = path.join(SETTINGS_DIR, f);
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (!data.characters) continue;
        // 送信元のキャラを全てマージ（IDで既存を上書き、なければ追加）
        for (const src of characters) {
          const idx = data.characters.findIndex(c => c.id === src.id);
          if (idx >= 0) {
            data.characters[idx] = src;
          } else {
            data.characters.push(src);
          }
        }
        fs.writeFileSync(p, JSON.stringify(data, null, 2));
        updated++;
      } catch (e) { console.warn('[Broadcast] parse error:', e.message); }
    }
    res.json({ ok: true, updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/error-report', (req, res) => {
  console.error('[CLIENT ERROR]', req.body.error);
  res.json({ ok: true });
});

// ── 学習済みAutoYESパターン API ──────────────────────────────────────────────
const { loadLearnedPatterns, deleteLearnedPattern } = require('./lib/learnedPatterns');

app.get('/api/learned-patterns', (req, res) => {
  res.json(loadLearnedPatterns());
});

app.delete('/api/learned-patterns/:index', (req, res) => {
  const idx = parseInt(req.params.index, 10);
  const removed = deleteLearnedPattern(idx);
  if (removed) res.json({ ok: true, removed });
  else res.status(404).json({ error: 'パターンが見つかりません' });
});

app.get('/api/auth-check', (req, res) => {
  res.json({ ok: isAuthenticated(req), passwordRequired: !!ACCESS_PASSWORD });
});

app.post('/api/login', (req, res) => {
  if (!ACCESS_PASSWORD) return res.json({ ok: true });
  const { password } = req.body;
  if (password !== ACCESS_PASSWORD) {
    return res.status(401).json({ error: 'パスワードが違います' });
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
    name: 'Terminal UI',
    short_name: 'TermUI',
    description: 'ターミナルUI',
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

// ユーザーのキャラ画像をアイコンとして配信（センタークロップしてPWAホーム画面用）
app.get('/api/icon', async (req, res) => {
  const userName = req.query.user || 'default';
  try {
    const p = settingsPath(userName);
    if (!fs.existsSync(p)) return res.redirect('/character.png');
    const settings = JSON.parse(fs.readFileSync(p, 'utf8'));
    // characters配列からデフォルトキャラの画像を取得
    const charId = settings.defaultCharId || 'default';
    const char = (settings.characters || []).find(c => c.id === charId) || (settings.characters || [])[0];
    const dataUrl = char?.charImgNormal || char?.charImgIdle || char?.charImgWorking
      || settings.charImgNormal || settings.charImgIdle || settings.charImgWorking;
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

// ユーザー別セッション分離: tmuxセッション名に "{user}--" プレフィックスを付ける
const SEP = '--';
function prefixed(user, name) { return `${user}${SEP}${name}`; }
function stripPrefix(user, tmuxName) {
  const p = `${user}${SEP}`;
  return tmuxName.startsWith(p) ? tmuxName.slice(p.length) : tmuxName;
}

app.get('/api/sessions', async (req, res) => {
  const user = req.query.user || 'default';
  const prefix = `${user}${SEP}`;
  const displayNames = loadDisplayNames(user);
  const all = await listSessions();
  // プレフィックスが一致するセッションだけ返し、displayNamesで表示名を解決
  const filtered = all
    .filter(s => s.name.startsWith(prefix))
    .map(s => {
      const internal = s.name.slice(prefix.length);
      return { ...s, name: displayNames[internal] || internal, _id: internal };
    });
  res.json(filtered);
});

// displayNames ヘルパー: ユーザーごとの表示名マッピング（設定JSONとは別ファイル）
function displayNamesPath(userName) {
  const safe = userName.replace(/[^a-zA-Z0-9_\-]/g, '_');
  return path.join(SETTINGS_DIR, `${safe}.displayNames.json`);
}
function loadDisplayNames(userName) {
  const p = displayNamesPath(userName);
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}
function saveDisplayNames(userName, displayNames) {
  fs.writeFileSync(displayNamesPath(userName), JSON.stringify(displayNames, null, 2));
}

// 自動セッション名生成
function autoName(type, existingDisplayNames) {
  const prefix = type === 'claude' ? 'Claude' : 'Shell';
  const used = new Set(Object.values(existingDisplayNames));
  for (let i = 1; ; i++) {
    const candidate = `${prefix} ${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

// Create a regular session or a Claude Code session
// body: { name?: string, type?: 'shell' | 'claude', user?: string }
app.post('/api/sessions', async (req, res) => {
  const { name, type, systemPrompt, user = 'default' } = req.body;
  const displayNames = loadDisplayNames(user);
  // 表示名を決定（入力なし→自動生成、Shell→'Shell'固定）
  const displayName = type === 'shell' ? 'Shell' : (name?.trim() || autoName(type, displayNames));
  // tmux名はASCIIのみ（タイムスタンプベース）
  const tmuxId = `s${Date.now()}`;
  const tmuxName = prefixed(user, tmuxId);
  console.log(`[POST /api/sessions] tmux=${tmuxName} display="${displayName}" type=${type} from=${req.ip}`);
  try {
    const command = type === 'claude' ? 'claude' : undefined;
    // Claude セッションの場合、リポジトリ一覧をシステムプロンプトに含める
    let finalPrompt = systemPrompt || '';
    if (type === 'claude') {
      try {
        const { stdout } = await execAsync(
          'PATH="$PATH:/opt/homebrew/bin:/usr/local/bin" gh repo list kantsuku --limit 30 2>/dev/null'
        );
        const repoList = stdout.trim();
        if (repoList) {
          finalPrompt += `\n\nユーザーからの最初の発言を受け取ったら、まず以下のリポジトリ一覧を見やすいテーブル形式（番号付き）で表示し、最後の選択肢として「🆕 新しいプロジェクトを作る」も追加して、「今日はどれをやる？」と聞いてください。ユーザーが具体的な作業指示をしてきた場合はそちらを優先してOKです。ユーザーが新規プロジェクトを選んだ場合は、以下の手順で進めてください：\n1. まずどんなプロジェクトを作りたいかヒアリングする\n2. CLAUDE.md を作成（プロジェクト概要・技術スタック・ディレクトリ構成・開発ルール）\n3. .gitignore を作成\n4. 必要なパッケージのインストールと初期ファイル生成\n5. git init してinitial commit\n6. GitHubリポジトリを作成してpush（gh repo create）\n\nリポジトリ一覧:\n${repoList}`;
        }
      } catch (e) { console.warn('[Session] repo list fetch failed:', e.message); }
    }
    const sessionName = await createSession(tmuxName, command, finalPrompt || undefined);
    // リポ一覧はシステムプロンプトに含まれているので、
    // ユーザーの最初の発言でClaude側が判断して表示する。
    // 自動送信は廃止（セッション途中で文脈が途切れる問題の防止）。
    const internalName = stripPrefix(user, sessionName);
    // displayNames マッピングを保存
    displayNames[internalName] = displayName;
    saveDisplayNames(user, displayNames);
    console.log(`[POST /api/sessions] created: ${sessionName} -> "${displayName}"`);
    res.json({ ok: true, name: displayName });
  } catch (err) {
    console.error(`[POST /api/sessions] error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Rename a session (表示名のみ変更、tmuxセッション名は変えない)
app.patch('/api/sessions/:id', async (req, res) => {
  const { newName } = req.body;
  const user = req.query.user || 'default';
  if (!newName) return res.status(400).json({ error: 'newName is required' });
  try {
    const displayNames = loadDisplayNames(user);
    const internalId = req.params.id;
    displayNames[internalId] = newName;
    saveDisplayNames(user, displayNames);
    res.json({ ok: true, name: newName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  const user = req.query.user || 'default';
  try {
    const internalId = req.params.id;
    const tmuxName = prefixed(user, internalId);
    // ptyプールから即座に削除（tmuxセッション削除前にptyを片付ける）
    killPtyImmediate(tmuxName);
    await killSession(tmuxName);
    // displayNames からも削除
    const displayNames = loadDisplayNames(user);
    delete displayNames[internalId];
    saveDisplayNames(user, displayNames);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// セリフ自動生成（Claude API）
// APIキー取得・保存
const envPath = path.join(__dirname, '.env');
app.get('/api/api-key', (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY || '';
  res.json({ hasKey: !!key, masked: key ? key.slice(0, 10) + '...' + key.slice(-4) : '' });
});
app.post('/api/api-key', (req, res) => {
  const { apiKey } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: 'APIキーが空です' });
  try {
    let envContent = '';
    if (fs.existsSync(envPath)) envContent = fs.readFileSync(envPath, 'utf8');
    if (envContent.match(/^ANTHROPIC_API_KEY=.*/m)) {
      envContent = envContent.replace(/^ANTHROPIC_API_KEY=.*/m, `ANTHROPIC_API_KEY=${apiKey}`);
    } else {
      envContent += `${envContent && !envContent.endsWith('\n') ? '\n' : ''}ANTHROPIC_API_KEY=${apiKey}\n`;
    }
    fs.writeFileSync(envPath, envContent);
    process.env.ANTHROPIC_API_KEY = apiKey;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/generate-lines', async (req, res) => {
  const { charName, claudePrompt } = req.body || {};
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'APIキーが未設定です。システムタブで設定してください' });
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
セリフは20文字以内の短いものにしてください。絶対に20文字を超えないこと。

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

// アップデート（git pull → npm install → npm run build → 再起動）
app.post('/api/update', async (req, res) => {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  const dir = __dirname;
  try {
    // npmのフルパスを解決（launchd環境ではPATHが限られるため）
    const npmBin = process.execPath.replace(/\/node$/, '/npm');
    const env = { ...process.env, PATH: `/usr/local/bin:/opt/homebrew/bin:${process.env.PATH || ''}` };
    await execAsync('git rm -r --cached user-settings/ uploads/ 2>/dev/null || true', { cwd: dir, env });
    const pull    = await execAsync('git pull', { cwd: dir, env });
    const install = await execAsync(`"${npmBin}" install`, { cwd: dir, env });
    const build   = await execAsync(`"${npmBin}" run build`, { cwd: dir, env });
    res.json({ ok: true, pull: pull.stdout.trim(), install: install.stdout.trim(), build: build.stdout.trim() });
    // nohup で独立プロセスとして再起動コマンドを投げてから exit
    setTimeout(() => {
      const { exec } = require('child_process');
      const plist = `${os.homedir()}/Library/LaunchAgents/com.terminalui.server.plist`;
      if (fs.existsSync(plist)) {
        // launchd管理下: unload→load を独立プロセスで実行（node死後も生き残る）
        exec(`nohup sh -c 'sleep 2 && launchctl unload "${plist}" && launchctl load "${plist}"' > /dev/null 2>&1 &`);
      } else {
        // launchd管理外: node を直接再起動
        exec(`nohup sh -c 'sleep 2 && node "${__filename}" > /tmp/terminal-ui.log 2>&1' > /dev/null 2>&1 &`);
      }
      process.exit(0);
    }, 500);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// tmux capture-pane で履歴取得
app.get('/api/sessions/:name/history', async (req, res) => {
  const { name } = req.params;
  const user = req.query.user || 'default';
  const tmuxName = prefixed(user, name);
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  const TMUX = process.env.TMUX_BIN || '/opt/homebrew/bin/tmux';
  try {
    const { stdout } = await execAsync(`${TMUX} capture-pane -p -S -2000 -t "${tmuxName}" 2>/dev/null`);
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
  ws.missedPongs = 0;
  ws.on('pong', () => { ws.isAlive = true; ws.missedPongs = 0; });
  let session = null; // { proc, write, resize, kill, setAutoYes, reattachWs }
  let currentTmuxSession = null; // ptyPool のキー
  let autoYesMode = 'semi'; // デフォルト半自動（safe パターンのみ自動応答）— クライアントから変更可
  let attachSeq = 0; // 連続attachリクエストの古い結果を無視するためのシーケンス番号

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'attach': {
        // 前のセッションがあればプールに返却（killしない）
        if (currentTmuxSession) {
          releasePty(currentTmuxSession, ws);
        }
        const tmuxSession = prefixed(msg.user || 'default', msg.session);
        // attachリクエストIDで古いasync完了を無視する（連続attach対策）
        const attachId = ++attachSeq;
        sessionExists(tmuxSession).then((exists) => {
          // 古いattachリクエストの結果が遅れて来た場合は無視
          if (attachId !== attachSeq) {
            console.log(`[WS] stale attach ignored: ${tmuxSession} (seq ${attachId} vs ${attachSeq})`);
            return;
          }
          if (!exists) {
            ws.send(JSON.stringify({ type: 'error', message: `Session "${msg.session}" not found` }));
            return;
          }
          session = getOrCreatePty(tmuxSession, ws, msg.cols || 80, msg.rows || 24, msg.ntfyTopic || '');
          currentTmuxSession = tmuxSession;
          session.setAutoYes(autoYesMode);
          ws.send(JSON.stringify({ type: 'autoyes', mode: autoYesMode }));
        });
        break;
      }
      case 'input': {
        if (session) session.write(msg.data);
        break;
      }
      case 'resize': {
        if (session) session.resize(msg.cols, msg.rows);
        break;
      }
      case 'autoyes': {
        // mode: false | 'semi' | 'full' （後方互換: enabled=true → 'full'）
        autoYesMode = msg.mode || (msg.enabled ? 'full' : false);
        if (session) session.setAutoYes(autoYesMode);
        ws.send(JSON.stringify({ type: 'autoyes', mode: autoYesMode }));
        break;
      }
    }
  });

  ws.on('close', () => {
    // pty を殺さずプールに返却 → grace period 後に自動回収
    // WS参照を渡して、既に別WSが再利用済みならリリースをスキップ
    if (currentTmuxSession) {
      releasePty(currentTmuxSession, ws);
    }
    session = null;
    currentTmuxSession = null;
  });

  ws.on('error', () => {
    if (currentTmuxSession) {
      releasePty(currentTmuxSession, ws);
    }
    session = null;
    currentTmuxSession = null;
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Terminal UI running → http://localhost:${PORT}`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://0.0.0.0:${PORT}`);
});
