const fs = require('fs');
const path = require('path');

const LEARNED_FILE = process.env.LEARNED_PATTERNS_FILE
  || path.join(__dirname, '..', 'user-settings', 'learned-patterns.json');

/**
 * 学習済みパターンを読み込む
 * @returns {Array<{keyword: string, response: string, learnedAt: string, count: number}>}
 */
function loadLearnedPatterns() {
  try {
    if (!fs.existsSync(LEARNED_FILE)) return [];
    return JSON.parse(fs.readFileSync(LEARNED_FILE, 'utf8'));
  } catch (e) {
    console.warn('[LearnedPatterns] load error:', e.message);
    return [];
  }
}

/**
 * 学習パターンを保存
 */
function saveLearnedPatterns(patterns) {
  try {
    fs.mkdirSync(path.dirname(LEARNED_FILE), { recursive: true });
    fs.writeFileSync(LEARNED_FILE, JSON.stringify(patterns, null, 2));
  } catch (e) {
    console.warn('[LearnedPatterns] save error:', e.message);
  }
}

/**
 * 新しいパターンを学習
 * @param {string} promptText - プロンプトのテキスト（直近の出力バッファ末尾）
 * @param {string} response - ユーザーが送った応答
 * @returns {object|null} 学習したパターン、または既存の場合null
 */
function learnPattern(promptText, response) {
  // プロンプトからキーワードを抽出（最後の意味のある行）
  const lines = promptText.split('\n').map(l => l.trim()).filter(Boolean);
  // 末尾から ? を含む行、または最後の行を取得
  let keyLine = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/[?？]/.test(lines[i]) || /\(y\/n\)|\[y\/n\]/i.test(lines[i])) {
      keyLine = lines[i];
      break;
    }
  }
  if (!keyLine) keyLine = lines[lines.length - 1] || '';
  if (!keyLine || keyLine.length < 5) return null; // 短すぎるのは無視

  // キーワードを正規化（記号を除去、小文字化、先頭末尾の空白除去）
  const keyword = keyLine
    .replace(/[>❯$›⏵●\[\](){}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100); // 100文字まで

  if (!keyword || keyword.length < 5) return null;

  const patterns = loadLearnedPatterns();

  // 既に同じキーワードがあればカウントを増やすだけ
  const existing = patterns.find(p => p.keyword === keyword);
  if (existing) {
    existing.count = (existing.count || 1) + 1;
    existing.lastUsed = new Date().toISOString();
    saveLearnedPatterns(patterns);
    return null;
  }

  // 新規学習
  const entry = {
    keyword,
    response,
    learnedAt: new Date().toISOString(),
    count: 1,
  };
  patterns.push(entry);
  saveLearnedPatterns(patterns);
  console.log(`[AutoYes:Learn] NEW: "${keyword}" → ${JSON.stringify(response)}`);
  return entry;
}

/**
 * 学習済みパターンを削除
 * @param {number} index - 削除するインデックス
 */
function deleteLearnedPattern(index) {
  const patterns = loadLearnedPatterns();
  if (index >= 0 && index < patterns.length) {
    const removed = patterns.splice(index, 1);
    saveLearnedPatterns(patterns);
    return removed[0];
  }
  return null;
}

/**
 * 学習済みパターンを AUTO_YES_PATTERNS 互換形式に変換
 */
function getLearnedAsAutoYes() {
  const patterns = loadLearnedPatterns();
  return patterns.map(p => ({
    pattern: new RegExp(escapeRegex(p.keyword), 'i'),
    response: p.response,
    safe: true,
    learned: true,
  }));
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { loadLearnedPatterns, learnPattern, deleteLearnedPattern, getLearnedAsAutoYes };
