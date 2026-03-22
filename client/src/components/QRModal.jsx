import { useEffect, useState, useRef } from 'react';
import QRCode from 'qrcode';

export default function QRModal({ onClose }) {
  const [urls, setUrls] = useState([]);
  const [selectedUrl, setSelectedUrl] = useState('');
  const canvasRef = useRef(null);

  useEffect(() => {
    fetch('/api/info')
      .then(r => r.json())
      .then(data => {
        setUrls(data.urls);
        // localhost以外があればそちらを優先
        const preferred = data.urls.find(u => !u.includes('localhost')) || data.urls[0];
        setSelectedUrl(preferred || '');
      });
  }, []);

  useEffect(() => {
    if (!selectedUrl || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, selectedUrl, {
      width: 240,
      margin: 2,
      color: { dark: '#00d4aa', light: '#0a0f0d' },
    });
  }, [selectedUrl]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12,
          padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          minWidth: 300,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--accent)' }}>スマホでスキャンっちゃ！</div>

        <canvas ref={canvasRef} style={{ borderRadius: 8 }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
          {urls.map(url => (
            <button
              key={url}
              style={{
                background: selectedUrl === url ? '#0a2018' : 'transparent',
                border: `1px solid ${selectedUrl === url ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 6, padding: '6px 12px', color: 'var(--text)',
                fontSize: 12, cursor: 'pointer', textAlign: 'left',
              }}
              onClick={() => setSelectedUrl(url)}
            >
              {url}
            </button>
          ))}
        </div>

        <button onClick={onClose} style={{ color: 'var(--text-muted)', fontSize: 12 }}>閉じる</button>
      </div>
    </div>
  );
}
