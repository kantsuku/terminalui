const pty = require('@homebridge/node-pty-prebuilt-multiarch');

// Patterns that trigger auto-yes responses
// Each entry: { pattern: RegExp, response: string }
const AUTO_YES_PATTERNS = [
  // Claude Code: Enter to confirm / Press Enter (default already on Yes/Allow)
  { pattern: /enter to confirm/i,  response: '\r' },
  { pattern: /press enter/i,       response: '\r' },
  // Claude Code: permission / trust prompts
  { pattern: /do you want to/i,    response: '\r' },
  { pattern: /allow.*\?/i,         response: '\r' },
  { pattern: /trust.*folder/i,     response: '\r' },
  { pattern: /proceed\?/i,         response: '\r' },
  // Generic y/n
  { pattern: /\(y\/n\)|\[y\/n\]|\(yes\/no\)|\[yes\/no\]|\[Y\/n\]|\[y\/N\]/i, response: 'y\r' },
  // npm / pip
  { pattern: /is this ok\?/i,      response: 'y\r' },
  { pattern: /are you sure/i,      response: 'y\r' },
];

/**
 * Attach a node-pty process to a tmux session and wire it to a WebSocket.
 * Returns an object with: proc, setAutoYes(bool)
 */
function attachSession(sessionName, ws, cols = 80, rows = 24) {
  let autoYes = false;
  let outputBuffer = '';
  let autoYesTimer = null;

  const TMUX = process.env.TMUX_BIN || '/opt/homebrew/bin/tmux';
  const proc = pty.spawn(TMUX, ['attach-session', '-t', sessionName], {
    name: 'xterm-256color',
    cols,
    rows,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });

  // 評価プロンプト用バッファ（常時監視）

  proc.onData((data) => {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }

    if (autoYes) {
      // Accumulate output and check patterns with a short debounce
      outputBuffer += data;
      clearTimeout(autoYesTimer);
      autoYesTimer = setTimeout(() => {
        // ANSI エスケープ除去（OSC含む）
        const plain = outputBuffer
          .replace(/\x1B\][^\x07\x1B]*(\x07|\x1B\\)/g, '')
          .replace(/[\x1B\x9B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g, '')
          .replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, '');
        console.log('[AutoYes] checking:', JSON.stringify(plain.slice(-300)));
        let matched = false;
        for (const { pattern, response } of AUTO_YES_PATTERNS) {
          if (pattern.test(plain)) {
            console.log('[AutoYes] matched:', pattern, '→', JSON.stringify(response));
            proc.write(response);
            matched = true;
            break;
          }
        }
        if (!matched) console.log('[AutoYes] no match');
        outputBuffer = '';
      }, 400);
    }
  });

  proc.onExit(({ exitCode }) => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
    }
  });

  return {
    proc,
    write: (data) => proc.write(data),
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: () => proc.kill(),
    setAutoYes: (enabled) => {
      autoYes = enabled;
      outputBuffer = '';
    },
  };
}

module.exports = { attachSession };
