const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const multer = require('multer');
const os = require('os');

const { listSessions, createSession, killSession, sessionExists, renameSession } = require('./lib/tmux');
const { attachSession } = require('./lib/ptyManager');

const UPLOAD_DIR = path.join(os.homedir(), 'Desktop', 'uploads');
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

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Terminal UI running → http://localhost:${PORT}`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://0.0.0.0:${PORT}`);
});
