import { useState } from 'react';

export default function RenameModal({ currentName, onConfirm, onCancel }) {
  const [name, setName] = useState(currentName);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed && trimmed !== currentName) onConfirm(trimmed);
    else onCancel();
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>セッション名を変更</h3>
        <form onSubmit={handleSubmit}>
          <div className="row">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onFocus={(e) => e.target.select()}
            />
          </div>
          <div className="actions">
            <button type="button" onClick={onCancel}>キャンセル</button>
            <button type="submit" className="primary">変更</button>
          </div>
        </form>
      </div>
    </div>
  );
}
