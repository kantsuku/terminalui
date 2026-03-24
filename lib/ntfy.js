const https = require('https');

/**
 * ntfy.sh にプッシュ通知を送る
 * @param {string} topic  - ntfyトピック名 (例: "termui-kiyosu")
 * @param {string} title  - 通知タイトル
 * @param {string} message - 通知本文
 * @param {number} priority - 1(min)〜5(max)、デフォルト3
 */
function sendNtfy(topic, title, message, priority = 3, iconUrl = '') {
  if (!topic) return;
  try {
    const payload = { topic, title, message, priority, tags: ['zap'] };
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: 'ntfy.sh',
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    });
    req.on('error', () => {});
    req.write(data);
    req.end();
  } catch {}
}

module.exports = { sendNtfy };
