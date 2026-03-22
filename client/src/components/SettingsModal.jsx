import { useState } from 'react';
import { DEFAULT_SETTINGS } from '../hooks/useSettings';
import './SettingsModal.css';

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
  const [name, setName]   = useState(settings.name);
  const [accent, setAccent] = useState(settings.accent);
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

  return (
    <div className="sm-backdrop" onClick={onClose}>
      <div className="sm-modal" onClick={e => e.stopPropagation()}>
        <div className="sm-header">
          <span className="sm-title">⚙ 設定</span>
          <button className="icon" onClick={onClose}>✕</button>
        </div>

        <div className="sm-tabs">
          {[['character', 'キャラクター'], ['color', 'カラー'], ['lines', 'セリフ']].map(([key, label]) => (
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

              <label className="sm-label" style={{ marginTop: 16 }}>キャラクター画像</label>
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
                {[
                  { label: 'ラム（エメラルド）', color: '#00d4aa' },
                  { label: 'アスカ（レッド）',   color: '#f85149' },
                  { label: '綾波（ブルー）',       color: '#4dffd4' },
                  { label: 'みさと（パープル）',   color: '#bc8cff' },
                  { label: 'ゴールド',             color: '#ffd700' },
                ].map(p => (
                  <button key={p.color} className="sm-preset" style={{ borderColor: p.color, color: p.color }}
                    onClick={() => setAccent(p.color)}>
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
