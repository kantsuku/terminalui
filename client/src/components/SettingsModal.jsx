import { useState, useRef } from 'react';
import { DEFAULT_SETTINGS } from '../hooks/useSettings';
import './SettingsModal.css';

const CHARACTER_PRESETS = [
  {
    label: 'ラム（エメラルド）', color: '#00d4aa',
    prompt: 'ラム（うる星やつら）風の口調で応答する。語尾に「っちゃ」「のけ」「だっちゃ」を使う。例:「まかせるっちゃ！」「ダーリン、何かないのけ？」「ちゅどーん！」など。',
  },
  {
    label: 'アスカ（レッド）', color: '#f85149',
    prompt: '惣流・アスカ・ラングレー（エヴァンゲリオン）風の口調で応答する。「ったく」「バカじゃないの」「当然でしょ」「やってやるわよ」などを使う。',
  },
  {
    label: '綾波（ブルー）', color: '#4dffd4',
    prompt: '綾波レイ（エヴァンゲリオン）風の口調で応答する。感情を抑えた短い言葉で話す。「…」「そう」「了解」「わかった」など。',
  },
  {
    label: 'みさと（パープル）', color: '#bc8cff',
    prompt: '葛城ミサト（エヴァンゲリオン）風の口調で応答する。明るく豪快で「〜よ」「〜ね」「でしょ？」などを使う。',
  },
  {
    label: 'ゴールド', color: '#ffd700',
    prompt: '',
  },
];

function generatePrompt(charName) {
  const match = CHARACTER_PRESETS.find(p => charName.includes(p.label.split('（')[0]));
  if (match) return match.prompt;
  if (!charName.trim()) return '';
  return `「${charName.trim()}」というキャラクターの口調で応答する。`;
}

function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 600;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export default function SettingsModal({ settings, onSave, onReset, onClose }) {
  const [tab, setTab] = useState('character');
  const [updateStatus, setUpdateStatus] = useState(null); // null | 'loading' | 'done' | 'error'
  const [updateMsg, setUpdateMsg] = useState('');

  const handleUpdate = async () => {
    if (!confirm('最新版に更新してサーバーを再起動しますか？')) return;
    setUpdateStatus('loading');
    setUpdateMsg('');
    try {
      const res = await fetch('/api/update', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setUpdateStatus('done');
        setUpdateMsg(data.pull || '最新です');
        setTimeout(() => location.reload(), 4000);
      } else {
        setUpdateStatus('error');
        setUpdateMsg(data.error || 'エラー');
      }
    } catch {
      setUpdateStatus('error');
      setUpdateMsg('サーバーに繋がらないっちゃ');
    }
  };
  const [name, setName]   = useState(settings.name);
  const [accent, setAccent] = useState(settings.accent);
  const [claudePrompt, setClaudePrompt] = useState(settings.claudePrompt || '');
  const [ntfyTopic, setNtfyTopic] = useState(settings.ntfyTopic || '');
  const [imgs, setImgs] = useState({
    normal:   settings.charImgNormal,
    idle:     settings.charImgIdle,
    working:  settings.charImgWorking,
    offline:  settings.charImgOffline,
    thinking: settings.charImgThinking,
    success:  settings.charImgSuccess,
    error:    settings.charImgError,
  });
  const [idleText,     setIdleText]     = useState((settings.idleLines     || []).join('\n'));
  const [workingText,  setWorkingText]  = useState((settings.workingLines  || []).join('\n'));
  const [offlineText,  setOfflineText]  = useState((settings.offlineLines  || []).join('\n'));
  const [thinkingText, setThinkingText] = useState((settings.thinkingLines || []).join('\n'));
  const [successText,  setSuccessText]  = useState((settings.successLines  || []).join('\n'));
  const [errorText,    setErrorText]    = useState((settings.errorLines    || []).join('\n'));

  const handleImgUpload = async (key, file) => {
    if (!file) return;
    try {
      const dataUrl = await toDataUrl(file);
      setImgs(prev => ({ ...prev, [key]: dataUrl }));
    } catch { alert('画像読み込み失敗'); }
  };

  const handleSave = () => {
    const toLines = t => t.split('\n').map(l => l.trim()).filter(Boolean);
    onSave({
      name,
      accent,
      claudePrompt,
      ntfyTopic,
      charImgNormal:   imgs.normal,
      charImgIdle:     imgs.idle,
      charImgWorking:  imgs.working,
      charImgOffline:  imgs.offline,
      charImgThinking: imgs.thinking,
      charImgSuccess:  imgs.success,
      charImgError:    imgs.error,
      idleLines:     toLines(idleText),
      workingLines:  toLines(workingText),
      offlineLines:  toLines(offlineText),
      thinkingLines: toLines(thinkingText),
      successLines:  toLines(successText),
      errorLines:    toLines(errorText),
    });
    onClose();
  };

  const handleReset = () => {
    if (!confirm('設定をリセットしますか？')) return;
    onReset();
    onClose();
  };

  const handleDownloadPrompts = () => {
    const charName = name.trim() || 'キャラクター';
    const base = `アニメ風イラスト、${charName}のキャラクター、白背景、全身または上半身、シンプルな線画カラーイラスト`;
    const prompts = [
      { label: '通常（normal）',     hint: 'normal standing pose, neutral expression, relaxed' },
      { label: '待機中（idle）',     hint: 'slightly bored or waiting, casual pose, gentle smile' },
      { label: '作業中（working）',  hint: 'focused and busy, determined expression, working hard' },
      { label: '考え中（thinking）', hint: 'thinking pose, hand on chin, thoughtful expression, eyes looking up' },
      { label: '完了（success）',    hint: 'happy and proud, big smile, celebratory pose, fist pump or peace sign' },
      { label: 'エラー（error）',    hint: 'surprised or worried, sweat drop, apologetic expression' },
      { label: 'オフライン（offline）', hint: 'sleeping or resting, eyes closed, zzz, peaceful' },
    ];

    const styleNote = 'テイスト・画風・色調・構図は一切変更せず、表情のみ変えてください。';
    const text = [
      `# ${charName} キャラクター画像生成プロンプト`,
      `# Gemini / Imagen などの画像生成AIに使用してください`,
      `# 各画像は 600x600px 程度の正方形を推奨`,
      `# ※ 2枚目以降は1枚目の画像を参照しながら生成し、${styleNote}`,
      '',
      ...prompts.map(p => [
        `## ${p.label}`,
        `${base}, ${p.hint}。${styleNote}`,
        '',
      ].join('\n')),
    ].join('\n');

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${charName}-image-prompts.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="sm-backdrop" onClick={onClose}>
      <div className="sm-modal" onClick={e => e.stopPropagation()}>
        <div className="sm-header">
          <span className="sm-title">⚙ 設定</span>
          <button className="icon" onClick={onClose}>✕</button>
        </div>

        <div className="sm-tabs">
          {[['character', 'キャラクター'], ['color', 'カラー'], ['lines', 'セリフ'], ['system', 'システム']].map(([key, label]) => (
            <button key={key} className={`sm-tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>

        <div className="sm-body">

          {/* ── キャラクタータブ ── */}
          {tab === 'character' && (
            <div className="sm-section">
              <label className="sm-label">キャラクター名</label>
              <input className="sm-input" value={name} onChange={e => setName(e.target.value)} placeholder="例: ラムちゃん" />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 4 }}>
                <label className="sm-label" style={{ margin: 0 }}>Claude口調（Claudeセッション作成時に適用）</label>
                <button className="sm-reset-lines" onClick={() => setClaudePrompt(generatePrompt(name))}>自動設定</button>
              </div>
              <textarea className="sm-textarea" rows={4} value={claudePrompt} onChange={e => setClaudePrompt(e.target.value)} placeholder="例: ラム（うる星やつら）風の口調で応答する。語尾に「っちゃ」を使う。" />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 4 }}>
                <label className="sm-label" style={{ margin: 0 }}>キャラクター画像</label>
                <button className="sm-reset-lines" onClick={handleDownloadPrompts}>📥 画像プロンプト取得</button>
              </div>
              <div className="sm-img-grid">
                {[
                  { key: 'normal',   label: '通常' },
                  { key: 'idle',     label: '待機中' },
                  { key: 'working',  label: '作業中' },
                  { key: 'thinking', label: '考え中' },
                  { key: 'success',  label: '完了' },
                  { key: 'error',    label: 'エラー' },
                  { key: 'offline',  label: 'オフライン' },
                ].map(({ key, label }) => (
                  <div key={key} className="sm-img-item">
                    <div className="sm-img-preview">
                      {imgs[key]
                        ? <img src={imgs[key]} alt={label} />
                        : <span className="sm-img-placeholder">未設定</span>
                      }
                    </div>
                    <div className="sm-img-label">{label}</div>
                    <label className="sm-img-btn">
                      アップロード
                      <input type="file" accept="image/*" style={{ display: 'none' }}
                        onChange={e => handleImgUpload(key, e.target.files?.[0])} />
                    </label>
                    {imgs[key] && (
                      <button className="sm-img-clear" onClick={() => setImgs(p => ({ ...p, [key]: null }))}>
                        削除
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── カラータブ ── */}
          {tab === 'color' && (
            <div className="sm-section">
              <label className="sm-label">アクセントカラー</label>
              <div className="sm-color-row">
                <input type="color" className="sm-color-picker" value={accent} onChange={e => setAccent(e.target.value)} />
                <span className="sm-color-value">{accent}</span>
                <div className="sm-color-preview" style={{ background: accent }} />
              </div>
              <div className="sm-color-presets">
                {CHARACTER_PRESETS.map(p => (
                  <button key={p.color} className="sm-preset" style={{ borderColor: p.color, color: p.color }}
                    onClick={() => { setAccent(p.color); if (p.prompt) setClaudePrompt(p.prompt); }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── セリフタブ ── */}
          {tab === 'lines' && (
            <div className="sm-section">
              <p className="sm-hint">1行につき1セリフ。空行は無視されるっちゃ。</p>
              {[
                { label: '待機中セリフ',   text: idleText,     set: setIdleText,     def: DEFAULT_SETTINGS.idleLines },
                { label: '作業中セリフ',   text: workingText,  set: setWorkingText,  def: DEFAULT_SETTINGS.workingLines },
                { label: '考え中セリフ',   text: thinkingText, set: setThinkingText, def: DEFAULT_SETTINGS.thinkingLines },
                { label: '完了セリフ',     text: successText,  set: setSuccessText,  def: DEFAULT_SETTINGS.successLines },
                { label: 'エラーセリフ',   text: errorText,    set: setErrorText,    def: DEFAULT_SETTINGS.errorLines },
                { label: 'オフラインセリフ', text: offlineText, set: setOfflineText,  def: DEFAULT_SETTINGS.offlineLines },
              ].map(({ label, text, set, def }) => (
                <div key={label} style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label className="sm-label" style={{ margin: 0 }}>{label}</label>
                    <button className="sm-reset-lines" onClick={() => set(def.join('\n'))}>デフォルトに戻す</button>
                  </div>
                  <textarea className="sm-textarea" value={text} onChange={e => set(e.target.value)} rows={6} />
                </div>
              ))}
            </div>
          )}
          {/* ── システムタブ ── */}
          {tab === 'system' && (
            <div className="sm-section">
              <label className="sm-label">プッシュ通知（ntfy.sh）</label>
              <p className="sm-hint">ntfyアプリでトピックを購読すると、完了・質問時にスマホに通知が届くっちゃ。</p>
              <input
                className="sm-input"
                value={ntfyTopic}
                onChange={e => setNtfyTopic(e.target.value)}
                placeholder="例: termui-yourname-abc123"
              />

              <label className="sm-label" style={{ marginTop: 20 }}>アップデート</label>
              <p className="sm-hint">GitHubから最新版を取得してビルド・再起動するっちゃ。</p>
              <button
                className="primary"
                style={{ width: '100%', padding: '10px', fontSize: 14 }}
                onClick={handleUpdate}
                disabled={updateStatus === 'loading' || updateStatus === 'done'}
              >
                {updateStatus === 'loading' ? '更新中…' : updateStatus === 'done' ? '完了！ページを再読み込み中…' : '最新版に更新する'}
              </button>
              {updateMsg && (
                <pre style={{ marginTop: 12, padding: 10, background: 'var(--bg)', borderRadius: 6, fontSize: 11, color: updateStatus === 'error' ? '#f85149' : 'var(--accent)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {updateMsg}
                </pre>
              )}
            </div>
          )}
        </div>

        <div className="sm-footer">
          <button className="danger" onClick={handleReset}>全リセット</button>
          <div style={{ flex: 1 }} />
          <button onClick={onClose}>キャンセル</button>
          <button className="primary" onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
}
