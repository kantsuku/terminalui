import { useState, useEffect } from 'react';
import { useSessions } from './hooks/useSessions';
import { useSettings } from './hooks/useSettings';
import PCLayout from './components/PCLayout';
import MobileLayout from './components/MobileLayout';
import SettingsModal from './components/SettingsModal';

function AuthGate({ onAuth }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!password) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        onAuth();
      } else {
        const data = await res.json();
        setError(data.error || 'エラーっちゃ');
      }
    } catch {
      setError('サーバーに繋がらないっちゃ…');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: 'var(--bg)', gap: 16,
    }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent)' }}>⚡ Terminal UI</div>
      <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>パスワードを入れてっちゃ！</div>
      <input
        autoFocus
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        placeholder="パスワード"
        style={{
          background: 'var(--bg2)', border: `1px solid ${error ? '#f85149' : 'var(--border)'}`,
          borderRadius: 8, color: 'var(--text)', padding: '10px 16px', fontSize: 16, width: 220, outline: 'none',
        }}
      />
      {error && <div style={{ color: '#f85149', fontSize: 12 }}>{error}</div>}
      <button
        className="primary"
        style={{ padding: '10px 32px', fontSize: 14, borderRadius: 8 }}
        onClick={submit}
        disabled={loading}
      >
        {loading ? '確認中…' : '入る'}
      </button>
    </div>
  );
}

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

function AppMain({ userName }) {
  const modeKey = `termui-force-mode-${userName}`;

  const [forceMode, setForceMode] = useState(
    () => localStorage.getItem(modeKey) || null
  );
  const [viewportMobile, setViewportMobile] = useState(() => window.innerWidth < 1024);
  const [showSettings, setShowSettings] = useState(false);
  const sessionHook = useSessions();
  const { settings: baseSettings, save, reset } = useSettings(userName);

  const [settings, setSettings] = useState(() => baseSettings);

  useEffect(() => {
    setSettings(baseSettings);
  }, [baseSettings]);

  useEffect(() => {
    const handler = () => setViewportMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const isMobile = forceMode ? forceMode === 'mobile' : viewportMobile;

  // ホーム画面アイコンをユーザーのキャラ画像に差し替え
  useEffect(() => {
    const iconUrl = `/api/icon?user=${encodeURIComponent(userName)}`;
    // iOS Safari は apple-touch-icon を優先
    let link = document.querySelector('link[rel="apple-touch-icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'apple-touch-icon';
      document.head.appendChild(link);
    }
    link.href = iconUrl;
    // manifest も更新
    const manifest = document.querySelector('link[rel="manifest"]');
    if (manifest) manifest.href = `/manifest.json?user=${encodeURIComponent(userName)}`;
  }, [userName]);

  const switchTo = (mode) => {
    localStorage.setItem(modeKey, mode);
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
  };

  const layoutProps = {
    ...sessionHook,
    settings,
    userName,
    onOpenSettings: () => setShowSettings(true),
    onSaveSettings: handleSave,
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

export default function App() {
  const urlUser = new URLSearchParams(location.search).get('user');
  const [authState, setAuthState] = useState('checking'); // 'checking' | 'required' | 'ok'

  useEffect(() => {
    fetch('/api/auth-check')
      .then(r => r.json())
      .then(data => setAuthState(data.ok ? 'ok' : 'required'))
      .catch(() => setAuthState('ok')); // サーバーエラー時はスルー
  }, []);

  if (authState === 'checking') {
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg3)', gap: 12 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--accent)' }}>⚡ Terminal UI</div>
        <div style={{ fontSize: 14, color: 'var(--accent)', opacity: 0.75 }}>よみこんでるっちゃ～</div>
      </div>
    );
  }

  if (authState === 'required') {
    return <AuthGate onAuth={() => setAuthState('ok')} />;
  }

  if (!urlUser) {
    const savedUser = localStorage.getItem('termui-last-user');
    if (savedUser) {
      const url = new URL(location.href);
      url.searchParams.set('user', savedUser);
      location.replace(url.toString());
      return null;
    }
    return <UserGate onEnter={name => {
      localStorage.setItem('termui-last-user', name);
      const url = new URL(location.href);
      url.searchParams.set('user', name);
      location.replace(url.toString());
    }} />;
  }

  return <AppMain userName={urlUser} />;
}
