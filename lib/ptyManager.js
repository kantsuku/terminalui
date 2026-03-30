const pty = require('@homebridge/node-pty-prebuilt-multiarch');
const { sendNtfy } = require('./ntfy');
const { stripAnsi } = require('./stripAnsi');

// Patterns that trigger auto-yes responses
// Each entry: { pattern: RegExp, response: string }
const AUTO_YES_PATTERNS = [
  // Claude Code: Enter to confirm / Press Enter (default already on Yes/Allow)
  { pattern: /enter to confirm/i,      response: '\r' },
  { pattern: /press enter/i,           response: '\r' },
  // Claude Code の編集確認ダイアログ（Esc to cancel → Enter で確定）
  { pattern: /esc to cancel/i,         response: '\r' },
  // Claude Code: permission / trust prompts
  { pattern: /do you want to/i,        response: '\r' },
  { pattern: /would you like/i,        response: '\r' },
  { pattern: /allow.*\?/i,             response: '\r' },
  { pattern: /trust.*folder/i,         response: '\r' },
  { pattern: /proceed\?/i,             response: '\r' },
  { pattern: /continue\?/i,            response: '\r' },
  { pattern: /approve\?/i,             response: '\r' },
  // Claude Code ツール実行確認（Allow (a) / No (n) など）
  { pattern: /\(a\)llow/i,             response: '\r' },
  // Generic y/n
  { pattern: /\(y\/n\)|\[y\/n\]|\(yes\/no\)|\[yes\/no\]|\[Y\/n\]|\[y\/N\]/i, response: 'y\r' },
  // npm / pip / overwrite
  { pattern: /is this ok\?/i,          response: 'y\r' },
  { pattern: /are you sure/i,          response: 'y\r' },
  { pattern: /overwrite/i,             response: 'y\r' },
];

/**
 * Attach a node-pty process to a tmux session and wire it to a WebSocket.
 * Returns an object with: proc, setAutoYes(bool)
 */
// 質問パターン（通知トリガー）
const QUESTION_PATTERNS = [
  /\(y\/n\)|\[y\/n\]|\(yes\/no\)|\[yes\/no\]|\[Y\/n\]|\[y\/N\]/i,
  /enter to confirm/i,
  /do you want to/i,
  /allow.*\?/i,
  /proceed\?/i,
  /are you sure/i,
  /is this ok\?/i,
  /esc to cancel/i,
];

function attachSession(sessionName, ws, cols = 80, rows = 24, ntfyTopicArg = '') {
  const ntfyTopic = ntfyTopicArg || process.env.NTFY_TOPIC || '';
  let autoYes = false;

  // 通知用
  let hadOutput = false;
  let doneTimer = null;
  let questionCooldown = false;
  let questionCooldownTimer = null;

  // autoYes即チェック用クールダウン
  let autoYesCooldown = false;
  let autoYesCooldownTimer = null;

  const TMUX = process.env.TMUX_BIN || '/opt/homebrew/bin/tmux';
  const proc = pty.spawn(TMUX, ['attach-session', '-t', sessionName], {
    name: 'xterm-256color',
    cols,
    rows,
    encoding: null,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: 'ja_JP.UTF-8',
    },
  });

  // 評価プロンプト用バッファ（常時監視）

  proc.onData((rawData) => {
    const data = typeof rawData === 'string' ? rawData : rawData.toString('utf8');
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }

    if (ntfyTopic) {
      hadOutput = true;
      // 完了検知: 3秒間出力がなければ「完了」通知
      clearTimeout(doneTimer);
      doneTimer = setTimeout(() => {
        if (hadOutput) {
          sendNtfy(ntfyTopic, `⚡ ${sessionName}`, 'ちゅどーん！完了したっちゃ！', 3);
          hadOutput = false;
        }
      }, 3000);

      // 質問検知
      if (!questionCooldown) {
        const plain = stripAnsi(data);
        for (const pattern of QUESTION_PATTERNS) {
          if (pattern.test(plain)) {
            sendNtfy(ntfyTopic, `❓ ${sessionName}`, '返事が必要っちゃ！確認してっちゃ！', 4);
            questionCooldown = true;
            clearTimeout(questionCooldownTimer);
            questionCooldownTimer = setTimeout(() => { questionCooldown = false; }, 30000);
            break;
          }
        }
      }
    }

    if (autoYes && !autoYesCooldown) {
      const plain = stripAnsi(data);
      for (const { pattern, response } of AUTO_YES_PATTERNS) {
        if (pattern.test(plain)) {
          console.log('[AutoYes] matched:', pattern, '→', JSON.stringify(response));
          proc.write(response);
          autoYesCooldown = true;
          clearTimeout(autoYesCooldownTimer);
          autoYesCooldownTimer = setTimeout(() => { autoYesCooldown = false; }, 1500);
          break;
        }
      }
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
      autoYesCooldown = false;
    },
  };
}

module.exports = { attachSession };
