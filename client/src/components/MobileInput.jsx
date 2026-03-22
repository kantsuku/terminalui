import { useRef, useState } from 'react';
import './MobileInput.css';

// Special key sequences
const HELPER_KEYS = [
  { label: 'Tab',  data: '\t' },
  { label: 'Esc',  data: '\x1b' },
  { label: 'Ctrl', special: 'ctrl' },
  { label: '↑',    data: '\x1b[A' },
  { label: '↓',    data: '\x1b[B' },
  { label: '←',    data: '\x1b[D' },
  { label: '→',    data: '\x1b[C' },
  { label: 'Clear', data: '\x0c' },
  { label: '⏎',    data: '\r' },
];

const CTRL_KEYS = [
  { label: 'Ctrl+C', data: '\x03' },
  { label: 'Ctrl+D', data: '\x04' },
  { label: 'Ctrl+Z', data: '\x1a' },
  { label: 'Ctrl+L', data: '\x0c' },
  { label: 'Ctrl+A', data: '\x01' },
  { label: 'Ctrl+E', data: '\x05' },
];

export default function MobileInput({ onSend, onKey, autoYes, onAutoYesToggle }) {
  const [text, setText] = useState('');
  const [ctrlMode, setCtrlMode] = useState(false);
  const textareaRef = useRef(null);

  const handleSend = () => {
    if (!text) return;
    onSend(text + '\r');
    setText('');
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    // Ctrl+Enter to send
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleHelper = (key) => {
    if (key.special === 'ctrl') {
      setCtrlMode((v) => !v);
      return;
    }
    setCtrlMode(false);
    onKey(key.data);
    textareaRef.current?.focus();
  };

  return (
    <div className="mobile-input">
      {/* Helper keys */}
      <div className="helper-keys">
        {(ctrlMode ? CTRL_KEYS : HELPER_KEYS).map((k) => (
          <button
            key={k.label}
            className={`hkey ${k.special === 'ctrl' && ctrlMode ? 'active' : ''}`}
            onPointerDown={(e) => { e.preventDefault(); handleHelper(k); }}
          >
            {k.label}
          </button>
        ))}
      </div>

      {/* Text area + actions */}
      <div className="input-row">
        <textarea
          ref={textareaRef}
          className="input-area"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="コマンドを入力... (Ctrl+Enter で送信)"
          rows={3}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <div className="input-actions">
          <button
            className={`icon ${autoYes ? 'primary' : ''}`}
            title="自動YES"
            onPointerDown={(e) => { e.preventDefault(); onAutoYesToggle(); }}
          >
            {autoYes ? '✓YES' : 'YES'}
          </button>
          <button
            className="icon"
            title="中断 (Ctrl+C)"
            onPointerDown={(e) => { e.preventDefault(); onKey('\x03'); }}
          >
            ■
          </button>
          <button
            className="primary icon"
            onPointerDown={(e) => { e.preventDefault(); handleSend(); }}
            disabled={!text}
          >
            ▶
          </button>
        </div>
      </div>
    </div>
  );
}
