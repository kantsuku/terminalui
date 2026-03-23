import { useState, useEffect } from 'react';

export const DEFAULT_SETTINGS = {
  name: 'ラムちゃん',
  accent: '#00d4aa',
  claudePrompt: 'ラム（うる星やつら）風の口調で応答する。語尾に「っちゃ」「のけ」「だっちゃ」を使う。例:「まかせるっちゃ！」「ダーリン、何かないのけ？」「ちゅどーん！」など。',
  charImgNormal:   null,  // 通常顔（idle/working中に交互表示）
  charImgIdle:     null,
  charImgWorking:  null,
  charImgOffline:  null,
  charImgThinking: null,
  charImgSuccess:  null,
  charImgError:    null,
  idleLines: [
    'ダーリン、何かないのけ？',
    'ひまだっちゃ〜…',
    '指示してくれるっちゃか？',
    'うち、待ってるっちゃよ！',
    'ダーリンのこと、大好きだっちゃ！',
    'なんか頼むっちゃ〜',
    'うち、いつでも準備OKだっちゃ！',
    'ダーリン、さぼってるのけ？',
    'もしかして、うちのこと忘れてるっちゃか？',
    '今日は何するのけ？',
    'うち、ずっとここにいるっちゃよ！',
    'はやく仕事くれるっちゃ〜！',
    'ダーリン、一緒にがんばるっちゃ！',
    'うちはいつでもダーリンの味方だっちゃ！',
  ],
  workingLines: [
    'うち、がんばってるっちゃ！',
    'まかせるっちゃ、ダーリン！',
    'ちゅどーん！と片付けるっちゃ！',
    'うち、全力でやるっちゃ！',
    'もうちょっと待つっちゃよ〜',
    'うちを信じるっちゃ！',
    'せっせとやってるっちゃ！',
    '電撃パワーで解決するっちゃ！',
    'ダーリン、もうすぐだっちゃよ！',
    '集中してるっちゃ、邪魔しないっちゃ！',
    'うちに任せれば大丈夫だっちゃ！',
    'ちょっとだけ待つっちゃよ〜！',
  ],
  offlineLines: [
    'ダーリン、うちを置いてくっちゃか？',
    'つながらないっちゃ…電撃かますっちゃよ？',
    'サーバーさん、どこ行ったのけ？',
    'うち、さびしいっちゃ…',
    'ダーリン！早くつなぐっちゃ！',
    '通信が切れたっちゃ…ちゅどーん…',
    'うちのこと、忘れたのけ？',
    'サーバーが逃げたっちゃか？',
  ],
  thinkingLines: [
    'ちょっと待つっちゃ…',
    'うち、考えてるっちゃ…',
    'んー、どうするっちゃか…',
    'ダーリン、うちに任せるっちゃ！',
  ],
  successLines: [
    'ちゅどーん！できたっちゃ！',
    'うち、やりとげたっちゃよ！',
    'かんぺきだっちゃ！',
    'ダーリン、見てたっちゃか？',
  ],
  errorLines: [
    'あらら…エラーだっちゃ…',
    'ちゅどーん…うまくいかなかったっちゃ',
    'ダーリン、なんか変だっちゃ！',
    'うち、電撃かけていいっちゃか？',
  ],
};

function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--green', color);
}

function localLoad() {
  try {
    const base = JSON.parse(localStorage.getItem('termui-settings') || 'null');
    const imgs = {
      charImgNormal:   localStorage.getItem('termui-img-normal')   || null,
      charImgIdle:     localStorage.getItem('termui-img-idle')     || null,
      charImgWorking:  localStorage.getItem('termui-img-working')  || null,
      charImgOffline:  localStorage.getItem('termui-img-offline')  || null,
      charImgThinking: localStorage.getItem('termui-img-thinking') || null,
      charImgSuccess:  localStorage.getItem('termui-img-success')  || null,
      charImgError:    localStorage.getItem('termui-img-error')    || null,
    };
    return base ? { ...DEFAULT_SETTINGS, ...base, ...imgs } : null;
  } catch { return null; }
}

function localSave(next) {
  try {
    const { charImgNormal, charImgIdle, charImgWorking, charImgOffline, charImgThinking, charImgSuccess, charImgError, ...rest } = next;
    localStorage.setItem('termui-settings', JSON.stringify(rest));
    const imgEntries = [
      ['termui-img-normal',   charImgNormal],
      ['termui-img-idle',     charImgIdle],
      ['termui-img-working',  charImgWorking],
      ['termui-img-offline',  charImgOffline],
      ['termui-img-thinking', charImgThinking],
      ['termui-img-success',  charImgSuccess],
      ['termui-img-error',    charImgError],
    ];
    for (const [key, val] of imgEntries) {
      if (val !== null) localStorage.setItem(key, val);
      else localStorage.removeItem(key);
    }
  } catch { /* quota exceeded — ignore for cache */ }
}

async function serverLoad(userName) {
  try {
    const res = await fetch(`/api/user-settings/${encodeURIComponent(userName)}`);
    const data = await res.json();
    return data ? { ...DEFAULT_SETTINGS, ...data } : null;
  } catch { return null; }
}

async function serverSave(userName, next) {
  try {
    await fetch(`/api/user-settings/${encodeURIComponent(userName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
  } catch { /* サーバー保存失敗はサイレントに */ }
}

export function useSettings(userName = 'default') {
  const [settings, setSettings] = useState(() => localLoad() || DEFAULT_SETTINGS);

  // マウント時: サーバーから取得して上書き（デバイス間同期）
  useEffect(() => {
    serverLoad(userName).then(serverSettings => {
      if (serverSettings) {
        setSettings(serverSettings);
        localSave(serverSettings);
        applyAccent(serverSettings.accent);
      }
    });
  }, [userName]); // eslint-disable-line react-hooks/exhaustive-deps

  // 初回アクセント適用
  useEffect(() => {
    applyAccent(settings.accent);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (partial) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    localSave(next);
    serverSave(userName, next);
    if (partial.accent) applyAccent(partial.accent);
  };

  const reset = () => {
    setSettings(DEFAULT_SETTINGS);
    localSave(DEFAULT_SETTINGS);
    serverSave(userName, DEFAULT_SETTINGS);
    applyAccent(DEFAULT_SETTINGS.accent);
  };

  return { settings, save, reset };
}

// 後方互換: App.jsx の loadSavedImages() 呼び出し用（サーバー同期後は不要だが残す）
export function loadSavedImages() {
  return {
    charImgNormal:   localStorage.getItem('termui-img-normal')   || null,
    charImgIdle:     localStorage.getItem('termui-img-idle')     || null,
    charImgWorking:  localStorage.getItem('termui-img-working')  || null,
    charImgOffline:  localStorage.getItem('termui-img-offline')  || null,
    charImgThinking: localStorage.getItem('termui-img-thinking') || null,
    charImgSuccess:  localStorage.getItem('termui-img-success')  || null,
    charImgError:    localStorage.getItem('termui-img-error')    || null,
  };
}
