import { useState } from 'react';

export default function NewSessionModal({ onConfirm, onCancel, characters = [], defaultCharId = '' }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('shell');
  const [characterId, setCharacterId] = useState(defaultCharId || characters[0]?.id || '');

  const handleConfirm = () => {
    // Shell は天馬博士固定・名前は'Shell'固定
    onConfirm({ name: type === 'shell' ? 'Shell' : (name.trim() || undefined), type, characterId: type === 'shell' ? 'tenma' : characterId });
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ touchAction: 'manipulation', background: '#0f1a16', border: '1px solid #1e3d2f' }}>
        <h3>新規セッション</h3>
        {type === 'claude' && (
        <div className="row">
          <input
            placeholder="セッション名（省略可）"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
          />
        </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="radio" name="type" value="shell" checked={type === 'shell'}
              onChange={() => setType('shell')}
              style={{ width: 'auto', padding: 0, border: 'none', background: 'none' }} />
            <span>Shell</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="radio" name="type" value="claude" checked={type === 'claude'}
              onChange={() => setType('claude')}
              style={{ width: 'auto', padding: 0, border: 'none', background: 'none' }} />
            <span style={{ color: '#d2a8ff' }}>⚡ Claude Code</span>
          </label>
        </div>
        {/* Shell = 天馬博士固定、Claude = キャラ選択 */}
        {type === 'shell' ? (
          <div className="row" style={{ alignItems: 'center', gap: 8, color: '#a0713a', fontSize: 13, fontWeight: 600 }}>
            <span>👨‍🔬 天馬博士（固定）</span>
          </div>
        ) : characters.length > 1 && (
          <div className="row">
            <select
              value={characterId}
              onChange={e => setCharacterId(e.target.value)}
              style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '8px 10px', fontSize: 13 }}
            >
              {characters.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.id === defaultCharId ? ' ★' : ''}</option>
              ))}
            </select>
          </div>
        )}
        <div className="actions">
          <button type="button" onClick={onCancel}>キャンセル</button>
          <button type="button" className="primary" onClick={handleConfirm}>作成</button>
        </div>
      </div>
    </div>
  );
}
