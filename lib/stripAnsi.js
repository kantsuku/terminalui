/**
 * ANSI エスケープコードを除去する共通ユーティリティ
 */
function stripAnsi(str) {
  return str
    .replace(/\x1B\][^\x07\x1B]*(\x07|\x1B\\)/g, '')
    .replace(/[\x1B\x9B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g, '')
    .replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, '');
}

module.exports = { stripAnsi };
