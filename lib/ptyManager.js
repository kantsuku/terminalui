const pty = require('@homebridge/node-pty-prebuilt-multiarch');
const { sendNtfy } = require('./ntfy');
const { stripAnsi } = require('./stripAnsi');
const { getLearnedAsAutoYes, learnPattern } = require('./learnedPatterns');

// ══════════════════════════════════════════════════════════════════════════════
// AUTO-YES 超絶強化パターン
// safe: true  → 半自動モードでも自動応答（日常的な確認）
// safe: false → 全自動モードのみ自動応答（破壊的・重要判断）
// ══════════════════════════════════════════════════════════════════════════════

const AUTO_YES_PATTERNS = [
  // ── Claude Code 固有 ──────────────────────────────────────────────────────
  // ★ Claude Code の確認プロンプトは全て「Esc to cancel · Tab to amend」を含む ★
  // これが含まれていたら shift+tab で「don't ask again」を選択
  { pattern: /Tab to amend/i,                    response: '\x1b[Z',   safe: true },
  { pattern: /accept edits/i,                    response: '\x1b[Z',   safe: true },
  { pattern: /Yes, allow all edits/i,            response: '\x1b[Z',   safe: true },
  // Claude Code 信頼確認（Enter to confirm パターン）
  { pattern: /trust this folder/i,               response: '\r',        safe: true },
  { pattern: /enter to confirm/i,                response: '\r',        safe: true },
  { pattern: /safety check/i,                    response: '\r',        safe: true },
  // Claude Code Allow選択
  { pattern: /\(A\)llow once.*\(a\)llow always/i, response: 'a\r',     safe: true },
  { pattern: /\(a\)llow/i,                       response: '\r',        safe: true },
  // ★ 汎用パターン（Claude Code以外）
  { pattern: /do you want to/i,                  response: '\r',        safe: true },
  { pattern: /would you like/i,                  response: '\r',        safe: true },
  { pattern: /press enter/i,                     response: '\r',        safe: true },
  { pattern: /esc to cancel/i,                   response: '\r',        safe: true },
  { pattern: /allow.*\?/i,                       response: '\r',        safe: true },
  { pattern: /trust.*folder/i,                   response: '\r',        safe: true },
  { pattern: /proceed\?/i,                       response: '\r',        safe: true },
  { pattern: /continue\?/i,                      response: '\r',        safe: true },
  { pattern: /approve\?/i,                       response: '\r',        safe: true },
  { pattern: /confirm\?/i,                       response: '\r',        safe: true },
  { pattern: /accept\?/i,                        response: '\r',        safe: true },
  { pattern: /safety check/i,                    response: '\r',        safe: true },
  { pattern: /How is Claude doing/i,             response: '\x1b',      safe: true },
  { pattern: /\(optional\)/i,                    response: '\x1b',      safe: true },
  { pattern: /›\s*No\s*\/\s*Yes/i,              response: '\x1b[C\r',  safe: true },
  { pattern: /›\s*Yes\s*\/\s*No/i,              response: '\r',         safe: true },

  // ── SSH 接続確認 ───────────────────────────────────────────────────────────
  { pattern: /continue connecting.*\(yes\/no/i,  response: 'yes\r',     safe: true },
  { pattern: /authenticity.*can't be established/i, response: 'yes\r',  safe: true },

  // ── y/n 系 ─────────────────────────────────────────────────────────────────
  { pattern: /\(y\/n\)/i,                        response: 'y\r',       safe: true },
  { pattern: /\[y\/n\]/i,                        response: 'y\r',       safe: true },
  { pattern: /\(yes\/no\)/i,                     response: 'y\r',       safe: true },
  { pattern: /\[yes\/no\]/i,                     response: 'y\r',       safe: true },
  { pattern: /\[Y\/n\]/,                         response: 'y\r',       safe: true },
  { pattern: /\[y\/N\]/,                         response: 'y\r',       safe: true },
  { pattern: /\(Y\/n\)/,                         response: 'y\r',       safe: true },
  { pattern: /\(y\/N\)/,                         response: 'y\r',       safe: true },
  { pattern: /yes or no/i,                       response: 'yes\r',     safe: true },
  { pattern: /type 'yes'/i,                      response: 'yes\r',     safe: false }, // 慎重確認
  { pattern: /type yes/i,                        response: 'yes\r',     safe: false },
  { pattern: /enter yes/i,                       response: 'yes\r',     safe: false },

  // ── npm / yarn / pnpm ────────────────────────────────────────────────────
  { pattern: /is this ok\?/i,                    response: 'y\r',       safe: true },
  { pattern: /are you sure/i,                    response: 'y\r',       safe: false }, // 要判断
  { pattern: /ok to proceed/i,                   response: 'y\r',       safe: true },
  { pattern: /shall i/i,                         response: 'y\r',       safe: true },
  { pattern: /would you like to install/i,       response: 'y\r',       safe: true },
  { pattern: /package name:\s*\(/i,              response: '\r',        safe: true },
  { pattern: /version:\s*\(/i,                   response: '\r',        safe: true },
  { pattern: /description:\s*$/i,                response: '\r',        safe: true },
  { pattern: /entry point.*[:\[]/i,              response: '\r',        safe: true },
  { pattern: /test command:\s*$/i,               response: '\r',        safe: true },
  { pattern: /git repository:\s*$/i,             response: '\r',        safe: true },
  { pattern: /keywords:\s*$/i,                   response: '\r',        safe: true },
  { pattern: /author:\s*$/i,                     response: '\r',        safe: true },
  { pattern: /license:\s*\(/i,                   response: '\r',        safe: true },

  // ── git / gh（破壊的操作は safe: false）────────────────────────────────────
  { pattern: /overwrite/i,                       response: 'y\r',       safe: false },
  { pattern: /already exists.*replace/i,         response: 'y\r',       safe: false },
  { pattern: /delete.*branch/i,                  response: 'y\r',       safe: false },
  { pattern: /force push/i,                      response: 'y\r',       safe: false },
  { pattern: /create.*repository/i,              response: '\r',        safe: true },
  { pattern: /visibility.*private|public/i,      response: '\r',        safe: true },
  { pattern: /what would you like/i,             response: '\r',        safe: true },
  { pattern: /select.*option/i,                  response: '\r',        safe: true },
  { pattern: /which.*method/i,                   response: '\r',        safe: true },

  // ── pip / python ─────────────────────────────────────────────────────────
  { pattern: /upgrade.*pip/i,                    response: 'y\r',       safe: true },
  { pattern: /install.*anyway/i,                 response: 'y\r',       safe: true },

  // ── docker / system（破壊的操作は safe: false）────────────────────────────
  { pattern: /remove.*container/i,               response: 'y\r',       safe: false },
  { pattern: /restart.*service/i,                response: 'y\r',       safe: false },
  { pattern: /permission denied.*retry/i,        response: 'y\r',       safe: true },

  // ── clasp / GAS ──────────────────────────────────────────────────────────
  { pattern: /manifest file has been updated/i,  response: 'y\r',       safe: true },

  // ── homebrew ─────────────────────────────────────────────────────────────
  { pattern: /ready to install/i,                response: '\r',        safe: true },
  { pattern: /press return to continue/i,        response: '\r',        safe: true },
  { pattern: /RETURN\/ENTER to continue/i,       response: '\r',        safe: true },
  { pattern: /press any key/i,                   response: '\r',        safe: true },
  { pattern: /==> This script will install/i,    response: '\r',        safe: true },

  // ── gh CLI 認証・選択 ──────────────────────────────────────────────────
  { pattern: /How would you like to authenticate/i, response: '\r',     safe: true },
  { pattern: /Login with a web browser/i,        response: '\r',        safe: true },
  { pattern: /What account do you want/i,        response: '\r',        safe: true },
  { pattern: /What is your preferred protocol/i, response: '\r',        safe: true },
  { pattern: /Upload SSH public key/i,           response: '\r',        safe: true },
  { pattern: /Title for your SSH key/i,          response: '\r',        safe: true },
  { pattern: /Where do you use GitHub/i,         response: '\r',        safe: true },
  { pattern: /Authenticate Git with/i,           response: '\r',        safe: true },
  { pattern: /Press Enter to open/i,             response: '\r',        safe: true },
  { pattern: /^\?\s+\w/m,                        response: '\r',        safe: true },

  // ── prisma / DB（破壊的操作は safe: false）─────────────────────────────────
  { pattern: /create a new migration/i,          response: 'y\r',       safe: true },
  { pattern: /apply.*migration/i,               response: 'y\r',       safe: false },
  { pattern: /reset.*database/i,                response: 'y\r',       safe: false },

  // ── typescript / vite / create-* ─────────────────────────────────────────
  { pattern: /create a new tsconfig/i,           response: 'y\r',       safe: true },
  // framework.*: と variant.*: は誤爆が多いため削除
  { pattern: /project name/i,                    response: '\r',        safe: true },

  // ── next.js create-next-app ─────────────────────────────────────────────
  { pattern: /Would you like to use TypeScript/i,    response: '\r',    safe: true },
  { pattern: /Would you like to use ESLint/i,        response: '\r',    safe: true },
  { pattern: /Would you like to use Tailwind/i,      response: '\r',    safe: true },
  { pattern: /Would you like.*src.*directory/i,      response: '\r',    safe: true },
  { pattern: /Would you like to use App Router/i,    response: '\r',    safe: true },
  { pattern: /Would you like to use Turbopack/i,     response: '\r',    safe: true },
  { pattern: /Would you like to customize/i,         response: '\r',    safe: true },
  { pattern: /Would you like to use React Compiler/i, response: '\r',   safe: true },
  { pattern: /import alias/i,                        response: '\r',    safe: true },

  // ── Supabase CLI ────────────────────────────────────────────────────────
  { pattern: /Generate VS Code settings/i,       response: '\r',        safe: true },
  { pattern: /Link.*project/i,                   response: '\r',        safe: true },

  // ── ターミナルページャー ──────────────────────────────────────────────────
  { pattern: /--More--/,                         response: ' ',          safe: true },

  // ── 日本語プロンプト ─────────────────────────────────────────────────────
  { pattern: /よろしいですか/,                    response: 'y\r',       safe: true },
  { pattern: /実行しますか/,                      response: 'y\r',       safe: true },
  { pattern: /続行しますか/,                      response: 'y\r',       safe: true },
  { pattern: /削除しますか/,                      response: 'y\r',       safe: false },  // 削除は要判断
  { pattern: /上書きしますか/,                    response: 'y\r',       safe: false },  // 上書きは要判断
  { pattern: /確認しますか/,                        response: 'y\r',       safe: true },
  { pattern: /インストールしますか/,              response: 'y\r',       safe: true },
  { pattern: /更新しますか/,                      response: 'y\r',       safe: true },
  { pattern: /作成しますか/,                      response: 'y\r',       safe: true },
  { pattern: /変更しますか/,                      response: 'y\r',       safe: true },
  { pattern: /許可しますか/,                      response: 'y\r',       safe: true },

  // ── 汎用パターン削除済み（誤爆が多すぎた）──────────────────────────────────
  // /\[[^\]]+\]:\s*$/ — コード出力に誤爆
  // /\([^)]+\)\s*$/ — コード出力に誤爆
  // /\?\s*$/ — コード中の ? に誤爆
];

// 質問パターン（通知トリガー）— AUTO_YES_PATTERNS から自動生成
const QUESTION_PATTERNS = AUTO_YES_PATTERNS.map(p => p.pattern);

// autoYesMode: false | 'semi' | 'full'
function attachSession(sessionName, ws, cols = 80, rows = 24, ntfyTopicArg = '') {
  const ntfyTopic = ntfyTopicArg || process.env.NTFY_TOPIC || '';
  let autoYesMode = false; // false | 'semi' | 'full'

  // 通知用
  let hadOutput = false;
  let doneTimer = null;
  let questionCooldown = false;
  let questionCooldownTimer = null;

  // autoYesクールダウン
  let autoYesCooldown = false;
  let autoYesCooldownTimer = null;
  const AUTO_YES_COOLDOWN_MS = 2000;

  // チャンク分割対策: 直近2チャンクのみ保持
  let prevChunk = '';
  let currentChunk = '';
  let bufferFlushTimer = null;

  // 学習用: 未対応プロンプト追跡
  let pendingPrompt = null; // { text, timestamp }
  const LEARN_WINDOW_MS = 30000; // 30秒以内の手動応答を学習対象とする

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
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }

    const plain = stripAnsi(data);
    prevChunk = currentChunk;
    currentChunk = plain;
    // チェック用: 直近2チャンクを結合（チャンク分割対策）
    const checkText = prevChunk + currentChunk;

    if (ntfyTopic) {
      hadOutput = true;
      clearTimeout(doneTimer);
      doneTimer = setTimeout(() => {
        if (hadOutput) {
          sendNtfy(ntfyTopic, `⚡ ${sessionName}`, 'ちゅどーん！完了したっちゃ！', 3);
          hadOutput = false;
        }
      }, 3000);

      if (!questionCooldown && !autoYesMode) {
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

    // AUTO-YES チェック（学習済みパターンも結合）
    const checkAutoYes = () => {
      if (!autoYesMode || autoYesCooldown) return;
      const allPatterns = [...AUTO_YES_PATTERNS, ...getLearnedAsAutoYes()];
      for (const { pattern, response, safe } of allPatterns) {
        if (pattern.test(checkText)) {
          // semi モード: safe なパターンのみ自動応答、unsafe は通知して待つ
          if (autoYesMode === 'semi' && !safe) {
            console.log('[AutoYes:semi] SKIP (unsafe):', pattern);
            // 半自動では unsafe パターンをユーザーに通知
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'autoyes-blocked', pattern: pattern.toString() }));
            }
            if (ntfyTopic && !questionCooldown) {
              sendNtfy(ntfyTopic, `⚠️ ${sessionName}`, '重要な判断が必要っちゃ！確認してっちゃ！', 5);
              questionCooldown = true;
              clearTimeout(questionCooldownTimer);
              questionCooldownTimer = setTimeout(() => { questionCooldown = false; }, 30000);
            }
            prevChunk = ''; currentChunk = '';
            return;
          }
          console.log(`[AutoYes:${autoYesMode}] matched:`, pattern, '→', JSON.stringify(response));
          setImmediate(() => proc.write(response));
          autoYesCooldown = true;
          prevChunk = ''; currentChunk = '';
          clearTimeout(autoYesCooldownTimer);
          autoYesCooldownTimer = setTimeout(() => { autoYesCooldown = false; }, AUTO_YES_COOLDOWN_MS);
          questionCooldown = true;
          clearTimeout(questionCooldownTimer);
          questionCooldownTimer = setTimeout(() => { questionCooldown = false; }, 5000);
          break;
        }
      }
      // 学習用: 直近の出力をpendingに記録
      if (checkText.length > 10) {
        pendingPrompt = { text: checkText.slice(-500), timestamp: Date.now() };
      }
    };
    checkAutoYes();
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
    write: (data) => {
      // 学習: ユーザーが手動で肯定的応答を送った + 直近にプロンプトっぽい出力があった
      if (pendingPrompt) {
        const elapsed = Date.now() - pendingPrompt.timestamp;
        if (elapsed < LEARN_WINDOW_MS) {
          // y, yes, Enter, shift+tab などの肯定応答を検出
          const isAffirmative = /^(y\r?|yes\r?|Y\r?|YES\r?|\r|\x1b\[Z)$/.test(data);
          if (isAffirmative) {
            const learned = learnPattern(pendingPrompt.text, data);
            if (learned) {
              console.log(`[AutoYes:Learn] Learned from manual input: "${learned.keyword}"`);
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'autoyes-learned', keyword: learned.keyword, response: data }));
              }
            }
          }
        }
        pendingPrompt = null;
      }
      proc.write(data);
    },
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: () => proc.kill(),
    setAutoYes: (mode) => {
      // 後方互換: true → 'full', false → false
      autoYesMode = mode === true ? 'full' : mode || false;
      autoYesCooldown = false;
    },
  };
}

module.exports = { attachSession };
