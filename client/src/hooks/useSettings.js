import { useState, useEffect } from 'react';

export const DEFAULT_CHARACTER = {
  id: 'default',
  name: 'ラムちゃん',
  accent: '#00d4aa',
  claudePrompt: 'ラム（うる星やつら）風の口調で応答する。語尾に「っちゃ」「のけ」「だっちゃ」を使う。例:「まかせるっちゃ！」「ダーリン、何かないのけ？」「ちゅどーん！」など。',
  charImgNormal:   null,
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
  ],
  workingLines: [
    'うち、がんばってるっちゃ！',
    'まかせるっちゃ、ダーリン！',
    'ちゅどーん！と片付けるっちゃ！',
    'うち、全力でやるっちゃ！',
    'もうちょっと待つっちゃよ〜',
  ],
  offlineLines: [
    'ダーリン、うちを置いてくっちゃか？',
    'つながらないっちゃ…電撃かますっちゃよ？',
    'サーバーさん、どこ行ったのけ？',
    'うち、さびしいっちゃ…',
  ],
  thinkingLines: [
    'ちょっと待つっちゃ…',
    'うち、考えてるっちゃ…',
    'んー、どうするっちゃか…',
  ],
  successLines: [
    'ちゅどーん！できたっちゃ！',
    'うち、やりとげたっちゃよ！',
    'かんぺきだっちゃ！',
  ],
  errorLines: [
    'あらら…エラーだっちゃ…',
    'ちゅどーん…うまくいかなかったっちゃ',
    'ダーリン、なんか変だっちゃ！',
  ],
};

export const DEFAULT_SETTINGS = {
  ntfyTopic: '',
  characters: [DEFAULT_CHARACTER],
  defaultCharId: 'default',
  sessionChars: {},
};

// 旧フォーマット（トップレベルにキャラ設定）→新フォーマットに移行
function migrateSettings(raw) {
  if (raw.characters) return raw; // 既に新フォーマット
  const char = {
    ...DEFAULT_CHARACTER,
    id: 'default',
    name: raw.name || DEFAULT_CHARACTER.name,
    accent: raw.accent || DEFAULT_CHARACTER.accent,
    claudePrompt: raw.claudePrompt || DEFAULT_CHARACTER.claudePrompt,
    charImgNormal:   raw.charImgNormal   ?? null,
    charImgIdle:     raw.charImgIdle     ?? null,
    charImgWorking:  raw.charImgWorking  ?? null,
    charImgOffline:  raw.charImgOffline  ?? null,
    charImgThinking: raw.charImgThinking ?? null,
    charImgSuccess:  raw.charImgSuccess  ?? null,
    charImgError:    raw.charImgError    ?? null,
    idleLines:     raw.idleLines     || DEFAULT_CHARACTER.idleLines,
    workingLines:  raw.workingLines  || DEFAULT_CHARACTER.workingLines,
    offlineLines:  raw.offlineLines  || DEFAULT_CHARACTER.offlineLines,
    thinkingLines: raw.thinkingLines || DEFAULT_CHARACTER.thinkingLines,
    successLines:  raw.successLines  || DEFAULT_CHARACTER.successLines,
    errorLines:    raw.errorLines    || DEFAULT_CHARACTER.errorLines,
  };
  return {
    ntfyTopic: raw.ntfyTopic || '',
    characters: [char],
    defaultCharId: 'default',
    sessionChars: {},
  };
}

function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--green', color);
}

function localLoad() {
  try {
    const raw = JSON.parse(localStorage.getItem('termui-settings') || 'null');
    if (!raw) return null;
    const migrated = migrateSettings(raw);
    // 旧フォーマットの画像をlocalStorageから復元（移行時のみ）
    if (!raw.characters && migrated.characters[0]) {
      const c = migrated.characters[0];
      c.charImgNormal   = localStorage.getItem('termui-img-normal')   || null;
      c.charImgIdle     = localStorage.getItem('termui-img-idle')     || null;
      c.charImgWorking  = localStorage.getItem('termui-img-working')  || null;
      c.charImgOffline  = localStorage.getItem('termui-img-offline')  || null;
      c.charImgThinking = localStorage.getItem('termui-img-thinking') || null;
      c.charImgSuccess  = localStorage.getItem('termui-img-success')  || null;
      c.charImgError    = localStorage.getItem('termui-img-error')    || null;
    }
    return { ...DEFAULT_SETTINGS, ...migrated };
  } catch { return null; }
}

function localSave(next) {
  try {
    // 画像を除いた設定をlocalStorageに保存（容量節約）
    const slim = {
      ...next,
      characters: next.characters.map(c => ({
        ...c,
        charImgNormal: null, charImgIdle: null, charImgWorking: null,
        charImgOffline: null, charImgThinking: null, charImgSuccess: null, charImgError: null,
      })),
    };
    localStorage.setItem('termui-settings', JSON.stringify(slim));
  } catch { /* quota exceeded */ }
}

async function serverLoad(userName) {
  try {
    const res = await fetch(`/api/user-settings/${encodeURIComponent(userName)}`);
    const data = await res.json();
    if (!data) return null;
    return { ...DEFAULT_SETTINGS, ...migrateSettings(data) };
  } catch { return null; }
}

async function serverSave(userName, next) {
  try {
    await fetch(`/api/user-settings/${encodeURIComponent(userName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
  } catch {}
}

export function useSettings(userName = 'default') {
  const [settings, setSettings] = useState(() => localLoad() || DEFAULT_SETTINGS);

  useEffect(() => {
    serverLoad(userName).then(serverSettings => {
      if (serverSettings) {
        setSettings(serverSettings);
        localSave(serverSettings);
        const defChar = serverSettings.characters.find(c => c.id === serverSettings.defaultCharId)
          || serverSettings.characters[0];
        if (defChar?.accent) applyAccent(defChar.accent);
      }
    });
  }, [userName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const defChar = settings.characters.find(c => c.id === settings.defaultCharId)
      || settings.characters[0];
    if (defChar?.accent) applyAccent(defChar.accent);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (partial) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    localSave(next);
    serverSave(userName, next);
  };

  const reset = () => {
    setSettings(DEFAULT_SETTINGS);
    localSave(DEFAULT_SETTINGS);
    serverSave(userName, DEFAULT_SETTINGS);
    applyAccent(DEFAULT_CHARACTER.accent);
  };

  return { settings, save, reset };
}

// セッション名からキャラを取得するヘルパー
export function getCharForSession(settings, sessionName) {
  const charId = settings.sessionChars?.[sessionName] || settings.defaultCharId;
  const byId = settings.characters.find(c => c.id === charId);
  if (byId) return byId;
  // セッション名とキャラ名が一致したら自動マッチ
  const lower = (sessionName || '').toLowerCase();
  const byName = settings.characters.find(c => c.name && c.name.toLowerCase() === lower);
  return byName || settings.characters[0] || DEFAULT_CHARACTER;
}
