import { useState, useEffect } from 'react';

export const DEFAULT_SETTINGS = {
  name: 'ラムちゃん',
  accent: '#00d4aa',
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

export function useSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('termui-settings');
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  // 初回適用
  useEffect(() => {
    applyAccent(settings.accent);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (partial) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    // charImg* は data URL で大きいので別キーに分けて保存
    const { charImgNormal, charImgIdle, charImgWorking, charImgOffline, charImgThinking, charImgSuccess, charImgError, ...rest } = next;
    try {
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
    } catch (e) {
      console.warn('settings save failed', e);
      throw new Error('保存失敗：ブラウザのストレージ容量が足りないっちゃ。画像を小さくするか削除するっちゃ！');
    }
    if (partial.accent) applyAccent(partial.accent);
  };

  const reset = () => {
    localStorage.removeItem('termui-settings');
    localStorage.removeItem('termui-img-idle');
    localStorage.removeItem('termui-img-working');
    localStorage.removeItem('termui-img-offline');
    setSettings(DEFAULT_SETTINGS);
    applyAccent(DEFAULT_SETTINGS.accent);
  };

  return { settings, save, reset };
}

// 初回ロード時に画像も復元
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
