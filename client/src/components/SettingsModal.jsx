import { useState, useRef } from 'react';
import { DEFAULT_CHARACTER } from '../hooks/useSettings';
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
  { label: 'ゴールド', color: '#ffd700', prompt: '' },
];

function generatePrompt(charName) {
  const match = CHARACTER_PRESETS.find(p => charName.includes(p.label.split('（')[0]));
  if (match) return match.prompt;
  if (!charName.trim()) return '';
  return `「${charName.trim()}」というキャラクターの口調で応答する。`;
}

function resizeAndUpload(file) {
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
      canvas.toBlob(blob => {
        const form = new FormData();
        form.append('file', blob, `char_${Date.now()}.jpg`);
        fetch('/api/upload', { method: 'POST', body: form })
          .then(r => r.json())
          .then(data => resolve(data.path))
          .catch(reject);
      }, 'image/jpeg', 0.82);
    };
    img.onerror = reject;
    img.src = url;
  });
}

function newCharId() {
  return `char_${Date.now()}`;
}

export default function SettingsModal({ settings, onSave, onReset, onClose }) {
  const [tab, setTab] = useState('character');
  const [updateStatus, setUpdateStatus] = useState(null);
  const [updateMsg, setUpdateMsg] = useState('');
  const [broadcastStatus, setBroadcastStatus] = useState(null);
  const [generating, setGenerating] = useState(false);

  // キャラクター一覧の編集用ローカルコピー
  const [characters, setCharacters] = useState(() =>
    settings.characters.map(c => ({ ...c }))
  );
  const [defaultCharId, setDefaultCharId] = useState(settings.defaultCharId);
  const [selectedCharId, setSelectedCharId] = useState(
    settings.defaultCharId || settings.characters[0]?.id
  );
  const [ntfyTopic, setNtfyTopic] = useState(settings.ntfyTopic || '');

  const selectedChar = characters.find(c => c.id === selectedCharId) || characters[0];
  const selectedIdx = characters.findIndex(c => c.id === selectedCharId);

  // 選択中キャラのフィールドを更新するヘルパー
  const updateChar = (partial) => {
    setCharacters(prev => prev.map(c =>
      c.id === selectedCharId ? { ...c, ...partial } : c
    ));
  };

  const handleImgUpload = async (key, file) => {
    if (!file) return;
    try {
      const urlPath = await resizeAndUpload(file);
      updateChar({ [key]: urlPath });
    } catch { alert('画像アップロード失敗'); }
  };

  const handleAddChar = () => {
    const id = newCharId();
    const newChar = { ...DEFAULT_CHARACTER, id, name: '新キャラ' };
    setCharacters(prev => [...prev, newChar]);
    setSelectedCharId(id);
  };

  const handleDeleteChar = () => {
    if (characters.length <= 1) { alert('最後のキャラは削除できないっちゃ'); return; }
    if (!confirm(`「${selectedChar.name}」を削除しますか？`)) return;
    const next = characters.filter(c => c.id !== selectedCharId);
    setCharacters(next);
    const newSel = next[0].id;
    setSelectedCharId(newSel);
    if (defaultCharId === selectedCharId) setDefaultCharId(newSel);
  };

  const handleSave = () => {
    onSave({
      ntfyTopic,
      characters,
      defaultCharId,
      sessionChars: settings.sessionChars || {},
    });
    onClose();
  };

  const handleReset = () => {
    if (!confirm('設定をリセットしますか？')) return;
    onReset();
    onClose();
  };

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

  const handleDownloadPrompts = () => {
    const charName = selectedChar.name.trim() || 'キャラクター';
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
      '',
      ...prompts.map(p => [`## ${p.label}`, `${base}, ${p.hint}。${styleNote}`, ''].join('\n')),
    ].join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${charName}-image-prompts.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!selectedChar) return null;

  return (
    <div className="sm-backdrop" onClick={onClose}>
      <div className="sm-modal" onClick={e => e.stopPropagation()}>
        <div className="sm-header">
          <span className="sm-title">⚙ 設定</span>
          <button className="icon" onClick={onClose}>✕</button>
        </div>

        {/* キャラクター選択バー */}
        <div className="sm-char-bar">
          <select
            className="sm-char-select"
            value={selectedCharId}
            onChange={e => setSelectedCharId(e.target.value)}
          >
            {characters.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{c.id === defaultCharId ? ' ★' : ''}
              </option>
            ))}
          </select>
          <button className="sm-char-btn" onClick={handleAddChar}>＋</button>
          <button
            className="sm-char-btn sm-char-btn--default"
            onClick={() => setDefaultCharId(selectedCharId)}
            title="デフォルトに設定"
            style={{ color: selectedCharId === defaultCharId ? 'var(--accent)' : undefined }}
          >★</button>
          <button className="sm-char-btn danger" onClick={handleDeleteChar}>削除</button>
        </div>

        <div className="sm-tabs">
          {[['character', 'キャラ'], ['color', 'カラー'], ['lines', 'セリフ'], ['system', 'システム']].map(([key, label]) => (
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
              <input className="sm-input" value={selectedChar.name}
                onChange={e => updateChar({ name: e.target.value })} placeholder="例: ラムちゃん" />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 4 }}>
                <label className="sm-label" style={{ margin: 0 }}>Claude口調</label>
                <button className="sm-reset-lines" onClick={() => updateChar({ claudePrompt: generatePrompt(selectedChar.name) })}>自動設定</button>
              </div>
              <textarea className="sm-textarea" rows={4} value={selectedChar.claudePrompt || ''}
                onChange={e => updateChar({ claudePrompt: e.target.value })}
                placeholder="例: ラム風の口調で応答する。語尾に「っちゃ」を使う。" />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 4 }}>
                <label className="sm-label" style={{ margin: 0 }}>キャラクター画像</label>
                <button className="sm-reset-lines" onClick={handleDownloadPrompts}>📥 画像プロンプト取得</button>
              </div>
              <div className="sm-img-grid">
                {[
                  { key: 'charImgNormal',   label: '通常' },
                  { key: 'charImgIdle',     label: '待機中' },
                  { key: 'charImgWorking',  label: '作業中' },
                  { key: 'charImgThinking', label: '考え中' },
                  { key: 'charImgSuccess',  label: '完了' },
                  { key: 'charImgError',    label: 'エラー' },
                  { key: 'charImgOffline',  label: 'オフライン' },
                ].map(({ key, label }) => (
                  <div key={key} className="sm-img-item">
                    <div className="sm-img-preview">
                      {selectedChar[key]
                        ? <img src={selectedChar[key]} alt={label} />
                        : <span className="sm-img-placeholder">未設定</span>
                      }
                    </div>
                    <div className="sm-img-label">{label}</div>
                    <label className="sm-img-btn">
                      アップロード
                      <input type="file" accept="image/*" style={{ display: 'none' }}
                        onChange={e => handleImgUpload(key, e.target.files?.[0])} />
                    </label>
                    {selectedChar[key] && (
                      <button className="sm-img-clear" onClick={() => updateChar({ [key]: null })}>削除</button>
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
                <input type="color" className="sm-color-picker" value={selectedChar.accent || '#00d4aa'}
                  onChange={e => updateChar({ accent: e.target.value })} />
                <span className="sm-color-value">{selectedChar.accent}</span>
                <div className="sm-color-preview" style={{ background: selectedChar.accent }} />
              </div>
              <div className="sm-color-presets">
                {CHARACTER_PRESETS.map(p => (
                  <button key={p.color} className="sm-preset" style={{ borderColor: p.color, color: p.color }}
                    onClick={() => {
                      updateChar({ accent: p.color });
                      if (p.prompt) updateChar({ claudePrompt: p.prompt });
                    }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── セリフタブ ── */}
          {tab === 'lines' && (
            <div className="sm-section">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <p className="sm-hint" style={{ margin: 0 }}>1行につき1セリフ。空行は無視されるっちゃ。</p>
                <button
                  className="primary"
                  style={{ fontSize: 12, padding: '4px 12px', whiteSpace: 'nowrap' }}
                  disabled={generating}
                  onClick={async () => {
                    setGenerating(true);
                    try {
                      const res = await fetch('/api/generate-lines', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ charName: selectedChar.name, claudePrompt: selectedChar.claudePrompt }),
                      });
                      const data = await res.json();
                      if (data.ok && data.lines) {
                        updateChar({
                          idleLines:    data.lines.idleLines    || selectedChar.idleLines,
                          workingLines: data.lines.workingLines || selectedChar.workingLines,
                          thinkingLines:data.lines.thinkingLines|| selectedChar.thinkingLines,
                          successLines: data.lines.successLines || selectedChar.successLines,
                          errorLines:   data.lines.errorLines   || selectedChar.errorLines,
                          offlineLines: data.lines.offlineLines || selectedChar.offlineLines,
                        });
                      } else {
                        alert(data.error || '生成失敗っちゃ');
                      }
                    } catch { alert('通信エラーっちゃ'); }
                    finally { setGenerating(false); }
                  }}
                >
                  {generating ? '生成中…' : '✨ AIで自動生成'}
                </button>
              </div>
              {[
                { label: '待機中セリフ',     key: 'idleLines',     def: DEFAULT_CHARACTER.idleLines },
                { label: '作業中セリフ',     key: 'workingLines',  def: DEFAULT_CHARACTER.workingLines },
                { label: '考え中セリフ',     key: 'thinkingLines', def: DEFAULT_CHARACTER.thinkingLines },
                { label: '完了セリフ',       key: 'successLines',  def: DEFAULT_CHARACTER.successLines },
                { label: 'エラーセリフ',     key: 'errorLines',    def: DEFAULT_CHARACTER.errorLines },
                { label: 'オフラインセリフ', key: 'offlineLines',  def: DEFAULT_CHARACTER.offlineLines },
              ].map(({ label, key, def }) => (
                <div key={key} style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label className="sm-label" style={{ margin: 0 }}>{label}</label>
                    <button className="sm-reset-lines" onClick={() => updateChar({ [key]: def })}>デフォルトに戻す</button>
                  </div>
                  <textarea className="sm-textarea" rows={6}
                    value={(selectedChar[key] || []).join('\n')}
                    onChange={e => updateChar({ [key]: e.target.value.split('\n').map(l => l.trim()).filter(Boolean) })} />
                </div>
              ))}
            </div>
          )}

          {/* ── システムタブ ── */}
          {tab === 'system' && (
            <div className="sm-section">
              <label className="sm-label">プッシュ通知（ntfy.sh）</label>
              <p className="sm-hint">ntfyアプリでトピックを購読すると、完了・質問時にスマホに通知が届くっちゃ。</p>
              <input className="sm-input" value={ntfyTopic} onChange={e => setNtfyTopic(e.target.value)}
                placeholder="例: termui-yourname-abc123" />

              <label className="sm-label" style={{ marginTop: 20 }}>キャラクター配布</label>
              <p className="sm-hint">現在のキャラクター設定（画像・セリフ含む）を全ユーザーに反映するっちゃ。</p>
              <button className="primary" style={{ width: '100%', padding: '10px', fontSize: 14 }}
                disabled={broadcastStatus === 'loading'}
                onClick={async () => {
                  if (!confirm('全ユーザーにキャラクター設定を反映しますか？')) return;
                  setBroadcastStatus('loading');
                  try {
                    const res = await fetch('/api/broadcast-characters', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ characters }),
                    });
                    const data = await res.json();
                    if (data.ok) {
                      setBroadcastStatus('done');
                      setTimeout(() => setBroadcastStatus(null), 3000);
                    } else {
                      alert(data.error || '反映失敗');
                      setBroadcastStatus(null);
                    }
                  } catch { alert('通信エラー'); setBroadcastStatus(null); }
                }}>
                {broadcastStatus === 'loading' ? '反映中…' : broadcastStatus === 'done' ? '反映完了！' : '📢 全ユーザーに反映'}
              </button>

              <label className="sm-label" style={{ marginTop: 20 }}>アップデート</label>
              <p className="sm-hint">GitHubから最新版を取得してビルド・再起動するっちゃ。</p>
              <button className="primary" style={{ width: '100%', padding: '10px', fontSize: 14 }}
                onClick={handleUpdate}
                disabled={updateStatus === 'loading' || updateStatus === 'done'}>
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
