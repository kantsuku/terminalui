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
  // 編集確認: "Do you want to make this edit" → shift+tab で allow all
  { pattern: /do you want to make this edit/i,   response: '\x1b[Z' },  // shift+tab = allow all
  { pattern: /Yes, allow all edits/i,            response: '\x1b[Z' },  // shift+tab
  // 信頼確認: "Yes, I trust this folder" → Enter
  { pattern: /trust this folder/i,               response: '\r' },
  // accept edits プロンプト
  { pattern: /accept edits/i,                    response: '\x1b[Z' },  // shift+tab = accept
  // Allow once/always/Deny → allow always
  { pattern: /\(A\)llow once.*\(a\)llow always/i, response: 'a\r' },
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
  // safety check / Quick safety check
  { pattern: /safety check/i,                    response: '\r' },

  // ── SSH 接続確認（yes/no/[fingerprint]）─────────────────────────────────
  { pattern: /continue connecting.*\(yes\/no/i,  response: 'yes\r' },
  { pattern: /authenticity.*can't be established/i, response: 'yes\r' },

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
  { pattern: /would you like to install/i,       response: 'y\r' },
  // npm init / yarn init 対話プロンプト（デフォルト値でEnter）
  { pattern: /package name:\s*\(/i,              response: '\r' },
  { pattern: /version:\s*\(/i,                   response: '\r' },
  { pattern: /description:\s*$/i,                response: '\r' },
  { pattern: /entry point.*[:\[]/i,              response: '\r' },
  { pattern: /test command:\s*$/i,               response: '\r' },
  { pattern: /git repository:\s*$/i,             response: '\r' },
  { pattern: /keywords:\s*$/i,                   response: '\r' },
  { pattern: /author:\s*$/i,                     response: '\r' },
  { pattern: /license:\s*\(/i,                   response: '\r' },

  // ── git / gh ─────────────────────────────────────────────────────────────
  { pattern: /overwrite/i,                       response: 'y\r' },
  { pattern: /already exists.*replace/i,         response: 'y\r' },
  { pattern: /delete.*branch/i,                  response: 'y\r' },
  { pattern: /force push/i,                      response: 'y\r' },
  { pattern: /create.*repository/i,              response: '\r' },
  { pattern: /visibility.*private|public/i,      response: '\r' },
  { pattern: /what would you like/i,             response: '\r' },
  { pattern: /select.*option/i,                  response: '\r' },
  { pattern: /which.*method/i,                   response: '\r' },

  // ── pip / python ─────────────────────────────────────────────────────────
  { pattern: /upgrade.*pip/i,                    response: 'y\r' },
  { pattern: /install.*anyway/i,                 response: 'y\r' },

  // ── docker / system ──────────────────────────────────────────────────────
  { pattern: /remove.*container/i,               response: 'y\r' },
  { pattern: /restart.*service/i,                response: 'y\r' },
  { pattern: /permission denied.*retry/i,        response: 'y\r' },

  // ── clasp / GAS ──────────────────────────────────────────────────────────
  { pattern: /manifest file has been updated/i,  response: 'y\r' },

  // ── homebrew ─────────────────────────────────────────────────────────────
  { pattern: /ready to install/i,                response: '\r' },
  { pattern: /press return to continue/i,        response: '\r' },

  // ── prisma / DB ──────────────────────────────────────────────────────────
  { pattern: /create a new migration/i,          response: 'y\r' },
  { pattern: /apply.*migration/i,               response: 'y\r' },
  { pattern: /reset.*database/i,                response: 'y\r' },

  // ── typescript / vite / create-* ─────────────────────────────────────────
  { pattern: /create a new tsconfig/i,           response: 'y\r' },
  { pattern: /framework.*:/i,                    response: '\r' },
  { pattern: /variant.*:/i,                      response: '\r' },

  // ── ターミナルページャー（less/more）──────────────────────────────────────
  { pattern: /--More--/,                         response: ' ' },

  // ── 日本語プロンプト ─────────────────────────────────────────────────────
  { pattern: /よろしいですか/,                    response: 'y\r' },
  { pattern: /実行しますか/,                      response: 'y\r' },
  { pattern: /続行しますか/,                      response: 'y\r' },
  { pattern: /削除しますか/,                      response: 'y\r' },
  { pattern: /上書きしますか/,                    response: 'y\r' },
  { pattern: /確認/,                              response: 'y\r' },
  { pattern: /インストールしますか/,              response: 'y\r' },
  { pattern: /更新しますか/,                      response: 'y\r' },
  { pattern: /作成しますか/,                      response: 'y\r' },
  { pattern: /変更しますか/,                      response: 'y\r' },
  { pattern: /許可しますか/,                      response: 'y\r' },

  // ── 汎用デフォルト値プロンプト（[default]: 形式）──────────────────────────
  { pattern: /\[[^\]]+\]:\s*$/,                  response: '\r' },
  { pattern: /\([^)]+\)\s*$/,                    response: '\r' },

  // ── 最終キャッチ: ? で終わる行 ───────────────────────────────────────────
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

  // autoYesクールダウン（超短縮: 300ms）
  let autoYesCooldown = false;
  let autoYesCooldownTimer = null;
  const AUTO_YES_COOLDOWN_MS = 300;

  // 出力バッファ（チャンク分割対策: 直近の出力を結合してパターンマッチ）
  let outputBuffer = '';
  let bufferFlushTimer = null;
  const BUFFER_MAX = 2000; // バッファ最大文字数

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

    // ANSI除去 + バッファに蓄積（チャンク分割対策）
    const plain = stripAnsi(data);
    outputBuffer += plain;
    if (outputBuffer.length > BUFFER_MAX) outputBuffer = outputBuffer.slice(-BUFFER_MAX);

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

    // AUTO-YES: バッファ全体でパターンマッチ（チャンク分割に強い）
    // 即時チェック + 50ms後に再チェック（遅延チャンク対策）
    const checkAutoYes = () => {
      if (!autoYes || autoYesCooldown) return;
      for (const { pattern, response } of AUTO_YES_PATTERNS) {
        if (pattern.test(outputBuffer)) {
          console.log('[AutoYes] matched:', pattern, '→', JSON.stringify(response));
          setImmediate(() => proc.write(response));
          autoYesCooldown = true;
          outputBuffer = ''; // マッチ後にバッファクリア（二重応答防止）
          clearTimeout(autoYesCooldownTimer);
          autoYesCooldownTimer = setTimeout(() => { autoYesCooldown = false; }, AUTO_YES_COOLDOWN_MS);
          questionCooldown = true;
          clearTimeout(questionCooldownTimer);
          questionCooldownTimer = setTimeout(() => { questionCooldown = false; }, 5000);
          break;
        }
      }
    };
    checkAutoYes();
    // 遅延チャンク対策: 50ms後に再チェック
    clearTimeout(bufferFlushTimer);
    bufferFlushTimer = setTimeout(checkAutoYes, 50);
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
