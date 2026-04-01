const pty = require('@homebridge/node-pty-prebuilt-multiarch');
const { sendNtfy } = require('./ntfy');
const { stripAnsi } = require('./stripAnsi');
// 学習機能は一旦無効化（誤学習による暴走防止）
// const { getLearnedAsAutoYes, learnPattern } = require('./learnedPatterns');

// ══════════════════════════════════════════════════════════════════════════════
// AUTO-YES パターン（旧版安定ロジック復活版）
// 全パターンをバッファ蓄積→400msデバウンスで一括チェック。
// delayedOnly区分・即時チェック・クールダウンは廃止。
// safe: true  → 半自動モードでも自動応答（日常的な確認）
// safe: false → 全自動モードのみ自動応答（破壊的・重要判断）
// ══════════════════════════════════════════════════════════════════════════════

const AUTO_YES_PATTERNS = [
  // ── Claude Code 固有 ──────────────────────────────────────────────────────
  { pattern: /Tab to amend/i,                    response: '\x1b[Z',   safe: true },
  { pattern: /accept edits/i,                    response: '\x1b[Z',   safe: true },
  { pattern: /Yes, allow all edits/i,            response: '\x1b[Z',   safe: true },
  { pattern: /trust this folder/i,               response: '\r',        safe: true },
  { pattern: /enter to confirm/i,                response: '\r',        safe: true },
  { pattern: /safety check/i,                    response: '\r',        safe: true },
  { pattern: /\(A\)llow once.*\(a\)llow always/i, response: 'a\r',     safe: true },
  { pattern: /\(a\)llow/i,                       response: '\r',        safe: true },
  { pattern: /do you want to/i,                  response: '\r',        safe: true },
  { pattern: /allow.*\?/i,                       response: '\r',        safe: true },
  { pattern: /trust.*folder/i,                   response: '\r',        safe: true },
  { pattern: /proceed\?/i,                       response: '\r',        safe: true },
  { pattern: /Esc to cancel/i,                   response: '\r',        safe: true },
  { pattern: /How is Claude doing/i,             response: '\x1b',      safe: true },
  { pattern: /\(optional\)/i,                    response: '\x1b',      safe: true },

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
  { pattern: /type 'yes'/i,                      response: 'yes\r',     safe: false },
  { pattern: /type yes/i,                        response: 'yes\r',     safe: false },
  { pattern: /enter yes/i,                       response: 'yes\r',     safe: false },

  // ── npm / yarn / pnpm ────────────────────────────────────────────────────
  { pattern: /is this ok\?/i,                    response: 'y\r',       safe: true },
  { pattern: /are you sure/i,                    response: 'y\r',       safe: false },
  { pattern: /ok to proceed/i,                   response: 'y\r',       safe: true },
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

  // ── pip / python ─────────────────────────────────────────────────────────
  { pattern: /upgrade.*pip/i,                    response: 'y\r',       safe: true },

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

  // ── prisma / DB（破壊的操作は safe: false）─────────────────────────────────
  { pattern: /create a new migration/i,          response: 'y\r',       safe: true },
  { pattern: /apply.*migration/i,               response: 'y\r',       safe: false },
  { pattern: /reset.*database/i,                response: 'y\r',       safe: false },

  // ── typescript / vite / create-* ─────────────────────────────────────────
  { pattern: /create a new tsconfig/i,           response: 'y\r',       safe: true },

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

  // ── 選択UI ─────────────────────────────────────────────────────────────────
  { pattern: /›\s*Yes\s*\/\s*No/i,               response: '\r',        safe: true },
  { pattern: /›\s*No\s*\/\s*Yes/i,               response: '\x1b[B\r',  safe: true },

  // ── 日本語プロンプト ─────────────────────────────────────────────────────
  { pattern: /よろしいですか/,                    response: 'y\r',       safe: true },
  { pattern: /実行しますか/,                      response: 'y\r',       safe: true },
  { pattern: /続行しますか/,                      response: 'y\r',       safe: true },
  { pattern: /削除しますか/,                      response: 'y\r',       safe: false },
  { pattern: /上書きしますか/,                    response: 'y\r',       safe: false },
  { pattern: /インストールしますか/,              response: 'y\r',       safe: true },
  { pattern: /更新しますか/,                      response: 'y\r',       safe: true },
  { pattern: /作成しますか/,                      response: 'y\r',       safe: true },
  { pattern: /変更しますか/,                      response: 'y\r',       safe: true },
  { pattern: /許可しますか/,                      response: 'y\r',       safe: true },
];

// 質問パターン（通知トリガー）— AUTO_YES_PATTERNS から自動生成
const QUESTION_PATTERNS = AUTO_YES_PATTERNS.map(p => p.pattern);

// autoYesMode: false | 'semi' | 'full'
function attachSession(sessionName, ws, cols = 80, rows = 24, ntfyTopicArg = '') {
  const ntfyTopic = ntfyTopicArg || process.env.NTFY_TOPIC || '';
  let autoYesMode = false; // false | 'semi' | 'full'
  let currentWs = ws; // 差し替え可能なWS参照

  // 通知用
  let hadOutput = false;
  let doneTimer = null;
  let questionCooldown = false;
  let questionCooldownTimer = null;

  // 旧版安定ロジック: バッファ蓄積→400msデバウンス→全パターン一括チェック
  let outputBuffer = '';
  let autoYesTimer = null;

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
    if (currentWs && currentWs.readyState === 1) {
      currentWs.send(JSON.stringify({ type: 'output', data }));
    }

    // 旧版安定ロジック: バッファ蓄積→400msデバウンス→全パターン一括チェック
    if (autoYesMode) {
      outputBuffer += data;
      clearTimeout(autoYesTimer);
      autoYesTimer = setTimeout(() => {
        const plain = stripAnsi(outputBuffer);
        let matched = false;
        for (const { pattern, response, safe } of AUTO_YES_PATTERNS) {
          if (pattern.test(plain)) {
            if (autoYesMode === 'semi' && !safe) {
              console.log('[AutoYes:semi] SKIP (unsafe):', pattern);
              if (currentWs && currentWs.readyState === 1) {
                currentWs.send(JSON.stringify({ type: 'autoyes-blocked', pattern: pattern.toString() }));
              }
              if (ntfyTopic && !questionCooldown) {
                sendNtfy(ntfyTopic, `⚠️ ${sessionName}`, '確認が必要です', 5);
                questionCooldown = true;
                clearTimeout(questionCooldownTimer);
                questionCooldownTimer = setTimeout(() => { questionCooldown = false; }, 30000);
              }
              matched = true;
              break;
            }
            console.log(`[AutoYes:${autoYesMode}] matched:`, pattern, '→', JSON.stringify(response));
            proc.write(response);
            matched = true;
            break;
          }
        }
        // no match ログは抑制（スパム防止）
        outputBuffer = '';
      }, 400);
    }

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
  });

  let alive = true;
  let exitCallbacks = [];

  proc.onExit(({ exitCode }) => {
    alive = false;
    if (currentWs && currentWs.readyState === 1) {
      currentWs.send(JSON.stringify({ type: 'exit', code: exitCode }));
    }
    for (const cb of exitCallbacks) cb(exitCode);
    exitCallbacks = [];
  });

  return {
    proc,
    write: (data) => {
      // 学習機能は一旦無効化
      proc.write(data);
    },
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: () => proc.kill(),
    isAlive: () => alive,
    onExit: (cb) => { if (!alive) cb(); else exitCallbacks.push(cb); },
    setAutoYes: (mode) => {
      // 後方互換: true → 'full', false → false
      autoYesMode = mode === true ? 'full' : mode || false;
      outputBuffer = '';
    },
    // WS差し替え: 切断→再接続時に同じptyを別のWSに繋ぎ直す
    reattachWs: (newWs) => {
      currentWs = newWs;
    },
  };
}

module.exports = { attachSession };
