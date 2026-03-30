const pty = require('@homebridge/node-pty-prebuilt-multiarch');
const { sendNtfy } = require('./ntfy');
const { stripAnsi } = require('./stripAnsi');

// ══════════════════════════════════════════════════════════════════════════════
// AUTO-YES 超絶強化パターン
// いかなる確認にも最速で YES を返す
// ══════════════════════════════════════════════════════════════════════════════

const AUTO_YES_PATTERNS = [
  // ── Claude Code 固有 ──────────────────────────────────────────────────────
  { pattern: /enter to confirm/i,                response: '\r' },
  { pattern: /press enter/i,                     response: '\r' },
  { pattern: /esc to cancel/i,                   response: '\r' },
  { pattern: /\(a\)llow/i,                       response: '\r' },
  { pattern: /do you want to/i,                  response: '\r' },
  { pattern: /would you like/i,                  response: '\r' },
  { pattern: /allow.*\?/i,                       response: '\r' },
  { pattern: /trust.*folder/i,                   response: '\r' },
  { pattern: /proceed\?/i,                       response: '\r' },
  { pattern: /continue\?/i,                      response: '\r' },
  { pattern: /approve\?/i,                       response: '\r' },
  { pattern: /confirm\?/i,                       response: '\r' },
  { pattern: /accept\?/i,                        response: '\r' },

  // ── y/n 系（全パターン網羅）──────────────────────────────────────────────
  { pattern: /\(y\/n\)/i,                        response: 'y\r' },
  { pattern: /\[y\/n\]/i,                        response: 'y\r' },
  { pattern: /\(yes\/no\)/i,                     response: 'y\r' },
  { pattern: /\[yes\/no\]/i,                     response: 'y\r' },
  { pattern: /\[Y\/n\]/,                         response: 'y\r' },
  { pattern: /\[y\/N\]/,                         response: 'y\r' },
  { pattern: /\(Y\/n\)/,                         response: 'y\r' },
  { pattern: /\(y\/N\)/,                         response: 'y\r' },
  { pattern: /yes or no/i,                       response: 'yes\r' },
  { pattern: /type 'yes'/i,                      response: 'yes\r' },
  { pattern: /type yes/i,                        response: 'yes\r' },
  { pattern: /enter yes/i,                       response: 'yes\r' },

  // ── npm / yarn / pnpm ────────────────────────────────────────────────────
  { pattern: /is this ok\?/i,                    response: 'y\r' },
  { pattern: /are you sure/i,                    response: 'y\r' },
  { pattern: /ok to proceed/i,                   response: 'y\r' },
  { pattern: /shall i/i,                         response: 'y\r' },

  // ── git / gh ─────────────────────────────────────────────────────────────
  { pattern: /overwrite/i,                       response: 'y\r' },
  { pattern: /already exists.*replace/i,         response: 'y\r' },
  { pattern: /delete.*branch/i,                  response: 'y\r' },
  { pattern: /force push/i,                      response: 'y\r' },
  { pattern: /create.*repository/i,              response: '\r' },
  { pattern: /visibility.*private|public/i,      response: '\r' },
  { pattern: /what would you like/i,             response: '\r' },
  { pattern: /select.*option/i,                  response: '\r' },

  // ── pip / python ─────────────────────────────────────────────────────────
  { pattern: /upgrade.*pip/i,                    response: 'y\r' },
  { pattern: /install.*anyway/i,                 response: 'y\r' },

  // ── docker / system ──────────────────────────────────────────────────────
  { pattern: /remove.*container/i,               response: 'y\r' },
  { pattern: /restart.*service/i,                response: 'y\r' },
  { pattern: /permission denied.*retry/i,        response: 'y\r' },

  // ── 日本語プロンプト ─────────────────────────────────────────────────────
  { pattern: /よろしいですか/,                    response: 'y\r' },
  { pattern: /実行しますか/,                      response: 'y\r' },
  { pattern: /続行しますか/,                      response: 'y\r' },
  { pattern: /削除しますか/,                      response: 'y\r' },
  { pattern: /上書きしますか/,                    response: 'y\r' },
  { pattern: /確認/,                              response: 'y\r' },

  // ── 最終キャッチ: ? で終わる行（他のパターンに引っかからなかった場合）───
  { pattern: /\?\s*$/,                           response: '\r' },
];

// 質問パターン（通知トリガー）— AUTO_YES_PATTERNS から自動生成
const QUESTION_PATTERNS = AUTO_YES_PATTERNS.map(p => p.pattern);

function attachSession(sessionName, ws, cols = 80, rows = 24, ntfyTopicArg = '') {
  const ntfyTopic = ntfyTopicArg || process.env.NTFY_TOPIC || '';
  let autoYes = false;

  // 通知用
  let hadOutput = false;
  let doneTimer = null;
  let questionCooldown = false;
  let questionCooldownTimer = null;

  // autoYesクールダウン（超短縮: 500ms）
  let autoYesCooldown = false;
  let autoYesCooldownTimer = null;
  const AUTO_YES_COOLDOWN_MS = 500;

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

  proc.onData((rawData) => {
    const data = typeof rawData === 'string' ? rawData : rawData.toString('utf8');
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }

    // ANSI除去は1回だけ（通知とautoYesで共有）
    const plain = stripAnsi(data);

    if (ntfyTopic) {
      hadOutput = true;
      clearTimeout(doneTimer);
      doneTimer = setTimeout(() => {
        if (hadOutput) {
          sendNtfy(ntfyTopic, `⚡ ${sessionName}`, 'ちゅどーん！完了したっちゃ！', 3);
          hadOutput = false;
        }
      }, 3000);

      if (!questionCooldown && !autoYes) {
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

    // AUTO-YES: クールダウン超短縮で最速応答
    if (autoYes && !autoYesCooldown) {
      for (const { pattern, response } of AUTO_YES_PATTERNS) {
        if (pattern.test(plain)) {
          console.log('[AutoYes] matched:', pattern, '→', JSON.stringify(response));
          // 即座に応答（setImmediate で出力完了直後に書き込む）
          setImmediate(() => proc.write(response));
          autoYesCooldown = true;
          clearTimeout(autoYesCooldownTimer);
          autoYesCooldownTimer = setTimeout(() => { autoYesCooldown = false; }, AUTO_YES_COOLDOWN_MS);
          // autoYes中は質問通知を抑制
          questionCooldown = true;
          clearTimeout(questionCooldownTimer);
          questionCooldownTimer = setTimeout(() => { questionCooldown = false; }, 5000);
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
