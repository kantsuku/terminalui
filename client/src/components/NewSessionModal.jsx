import { useState } from 'react';

export default function NewSessionModal({ onConfirm, onCancel }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('shell');

  const handleSubmit = (e) => {
    e.preventDefault();
    onConfirm({ name: name.trim() || undefined, type });
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>新規セッション</h3>
        <form onSubmit={handleSubmit}>
          <div className="row">
            <input
              placeholder="セッション名（省略可）"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="radio" name="type" value="shell"
                checked={type === 'shell'}
                onChange={() => setType('shell')}
                style={{ width: 'auto', padding: 0, border: 'none', background: 'none' }}
              />
              <span>Shell</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="radio" name="type" value="claude"
                checked={type === 'claude'}
                onChange={() => setType('claude')}
                style={{ width: 'auto', padding: 0, border: 'none', background: 'none' }}
              />
              <span style={{ color: '#d2a8ff' }}>⚡ Claude Code</span>
            </label>
          </div>
          <div className="actions">
            <button type="button" onClick={onCancel}>キャンセル</button>
            <button type="submit" className="primary">作成</button>
          </div>
        </form>
      </div>
    </div>
  );
}
