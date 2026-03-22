import { useState, useEffect } from 'react';
import { useSessions } from './hooks/useSessions';
import { useSettings, loadSavedImages } from './hooks/useSettings';
import PCLayout from './components/PCLayout';
import MobileLayout from './components/MobileLayout';
import SettingsModal from './components/SettingsModal';

function UserGate({ onEnter }) {
  const [name, setName] = useState('');
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: 'var(--bg)', gap: 16,
    }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent)' }}>⚡ Terminal UI</div>
      <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>あなたの名前を入れてっちゃ！</div>
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onEnter(name.trim()); }}
        placeholder="例: alice"
        style={{
          background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8,
          color: 'var(--text)', padding: '10px 16px', fontSize: 16, width: 220, outline: 'none',
        }}
      />
      <button
        className="primary"
        style={{ padding: '10px 32px', fontSize: 14, borderRadius: 8 }}
        onClick={() => { if (name.trim()) onEnter(name.trim()); }}
      >
        入る
      </button>
    </div>
  );
}

export default function App() {
  const urlUser = new URLSearchParams(location.search).get('user');

  // ?user= がない場合は名前入力画面を表示し、入力後URLにリダイレクト
  if (!urlUser) {
    return <UserGate onEnter={name => {
      const url = new URL(location.href);
      url.searchParams.set('user', name);
      location.replace(url.toString());
    }} />;
  }

  const userName = urlUser;

  const [forceMode, setForceMode] = useState(
    () => localStorage.getItem('termui-force-mode') || null
  );
  const [viewportMobile, setViewportMobile] = useState(() => window.innerWidth < 1024);
  const [showSettings, setShowSettings] = useState(false);
  const sessionHook = useSessions();
  const { settings: baseSettings, save, reset } = useSettings();

  // 画像は別キーで保存されてるので初回マージ
  const [settings, setSettings] = useState(() => ({
    ...baseSettings,
    ...loadSavedImages(),
  }));

  useEffect(() => {
    setSettings({ ...baseSettings, ...loadSavedImages() });
  }, [baseSettings]);

  useEffect(() => {
    const handler = () => setViewportMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const isMobile = forceMode ? forceMode === 'mobile' : viewportMobile;

  const switchTo = (mode) => {
    localStorage.setItem('termui-force-mode', mode);
    setForceMode(mode);
  };

  const handleSave = (partial) => {
    try {
      save(partial);
      setSettings(prev => ({ ...prev, ...partial }));
    } catch (e) {
      alert(e.message);
    }
  };

  const handleReset = () => {
    reset();
    setSettings({ ...loadSavedImages() });
  };

  const layoutProps = {
    ...sessionHook,
    settings,
    userName,
    onOpenSettings: () => setShowSettings(true),
  };

  return (
    <>
      {isMobile
        ? <MobileLayout {...layoutProps} onSwitchMode={() => switchTo('pc')} />
        : <PCLayout     {...layoutProps} onSwitchMode={() => switchTo('mobile')} />
      }
      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={handleSave}
          onReset={handleReset}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
}
