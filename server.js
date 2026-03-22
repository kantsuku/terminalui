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

const UPLOAD_DIR = path.join(os.homedir(), 'Desktop', 'uploads');
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

app.use(express.json());
app.use(authMiddleware);

// Serve built client in production
const clientDist = path.join(__dirname, 'client', 'dist');
// Assets have content hashes → cache forever
app.use('/assets', express.static(path.join(clientDist, 'assets'), { maxAge: '1y', immutable: true }));
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

// ── REST API ──────────────────────────────────────────────────────────────────

// Upload image → save to ~/Desktop/uploads/ → return file path
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  res.json({ path: req.file.path });
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
  const { name, type } = req.body;
  try {
    const command = type === 'claude' ? 'claude' : undefined;
    const sessionName = await createSession(name, command);
    res.json({ ok: true, name: sessionName });
  } catch (err) {
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
          session = attachSession(msg.session, ws, msg.cols || 80, msg.rows || 24);
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
        if (session) session.setAutoYes(!!msg.enabled);
        ws.send(JSON.stringify({ type: 'autoyes', enabled: !!msg.enabled }));
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

// ── 起動時セッション自動作成 ───────────────────────────────────────────────────
// AUTO_SESSIONS="name:type,name2:type2" 形式で指定（type: shell | claude）
// デフォルト: shell セッション + claude セッション
async function ensureDefaultSessions() {
  const raw = process.env.AUTO_SESSIONS || 'shell:shell,claude:claude';
  const targets = raw.split(',').map(s => {
    const [name, type = 'shell'] = s.trim().split(':');
    return { name, type };
  });

  for (const { name, type } of targets) {
    const exists = await sessionExists(name);
    if (!exists) {
      try {
        const command = type === 'claude' ? 'claude' : undefined;
        await createSession(name, command);
        console.log(`[AutoSession] created "${name}" (${type})`);
      } catch (e) {
        console.warn(`[AutoSession] failed to create "${name}": ${e.message}`);
      }
    } else {
      console.log(`[AutoSession] "${name}" already exists`);
    }
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
  console.log(`Terminal UI running → http://localhost:${PORT}`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://0.0.0.0:${PORT}`);
  await ensureDefaultSessions();
});
