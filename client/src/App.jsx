import { useState, useEffect } from 'react';
import { useSessions } from './hooks/useSessions';
import { useSettings, loadSavedImages } from './hooks/useSettings';
import PCLayout from './components/PCLayout';
import MobileLayout from './components/MobileLayout';
import SettingsModal from './components/SettingsModal';

export default function App() {
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
