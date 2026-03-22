import { useState, useRef, useCallback, useEffect } from 'react';
import TerminalPanel from './TerminalPanel';
import NewSessionModal from './NewSessionModal';
import RenameModal from './RenameModal';
import './MobileLayout.css';

function statusClass(s) { return s.status === 'active' ? 'active' : 'idle'; }

const SKILLS = [
  { label: '/commit',    cmd: '/commit\r',             desc: 'AIが変更内容を見てコミットメッセージを作って保存する' },
  { label: 'git push',   cmd: 'git push\r',            desc: '今のコミットをGitHubに送る' },
  { label: 'git status', cmd: 'git status\r',          desc: '何のファイルが変更されているか確認する' },
  { label: 'git diff',   cmd: 'git --no-pager diff\r', desc: 'ファイルの中身がどう変わったか確認する' },
  { label: 'clasp push', cmd: 'clasp push\r',           desc: 'GASのコードをGoogle Driveにプッシュする' },
  { label: '中断',       cmd: '\x1b',                  desc: 'Escキーを送信して処理を中断する' },
];

const KEYS = [
  { label: '↑', data: '\x1b[A' },
  { label: '↓', data: '\x1b[B' },
  { label: 'C-c', data: '\x03' },
  { label: 'C-d', data: '\x04' },
];

export default function MobileLayout({ sessions, createSession, killSession, renameSession, fetchSessions, onSwitchMode, settings = {}, onOpenSettings }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [inputText, setInputText] = useState('');
  const [connState, setConnState] = useState('disconnected');
  const [autoEnter, setAutoEnter] = useState(() => localStorage.getItem('termui-auto-enter') !== 'false');
  const [history, setHistory] = useState(null);
  const [inputHistory, setInputHistory] = useState([]);
  const inputHistoryIdxRef = useRef(-1);
  const [activeSkill, setActiveSkill] = useState(null);
  const [isWorking,        setIsWorking]        = useState(false);
  const [isThinking,       setIsThinking]       = useState(false);
  const [isDone,           setIsDone]           = useState(false);
  const [isError,          setIsError]          = useState(false);
  const [charTick,         setCharTick]         = useState(0);
  const [displayCharState, setDisplayCharState] = useState('idle');
  const workingTimerRef   = useRef(null);
  const thinkingTimerRef  = useRef(null);
  const doneTimerRef      = useRef(null);
  const errorTimerRef     = useRef(null);
  const charDebounceRef   = useRef(null);

  // キャラ画像切替用タイマー（8秒ごと）
  useEffect(() => {
    const id = setInterval(() => setCharTick(t => t + 1), 8000);
    return () => clearInterval(id);
  }, []);

  // charState を debounce して表情のちらつきを防ぐ
  // offline/error/success は即反映、それ以外は0.8秒安定してから切替
  useEffect(() => {
    const raw = connState !== 'connected' ? 'offline'
      : isError    ? 'error'
      : isDone     ? 'success'
      : isThinking ? 'thinking'
      : isWorking  ? 'working'
      : 'idle';

    const IMMEDIATE = ['offline', 'error', 'success'];
    if (IMMEDIATE.includes(raw)) {
      clearTimeout(charDebounceRef.current);
      setDisplayCharState(raw);
    } else {
      clearTimeout(charDebounceRef.current);
      charDebounceRef.current = setTimeout(() => setDisplayCharState(raw), 800);
    }
    return () => clearTimeout(charDebounceRef.current);
  }, [connState, isError, isDone, isThinking, isWorking]);

  const panelRef = useRef(null);
  const terminalDivRef = useRef(null);

  // マウスホイールがタブ等に伝播するのを防ぐ（xterm の子要素ハンドラ後に発火）
  useEffect(() => {
    const el = terminalDivRef.current;
    if (!el) return;
    const handler = (e) => e.stopPropagation();
    el.addEventListener('wheel', handler, { passive: true });
    return () => el.removeEventListener('wheel', handler);
  }, []);
  const textareaRef = useRef(null);

  const activeSession = sessions[activeIdx] || null;

  const openHistory = useCallback(async () => {
    if (!activeSession) return;
    const res = await fetch(`/api/sessions/${encodeURIComponent(activeSession.name)}/history`);
    const data = await res.json();
    setHistory(data.content || '');
  }, [activeSession]);

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (data.path) setInputText(prev => prev + data.path);
    } catch {
      alert('アップロード失敗');
    }
    e.target.value = '';
  };

  useEffect(() => {
    if (sessions.length > 0 && activeIdx >= sessions.length) {
      setActiveIdx(sessions.length - 1);
    }
  }, [sessions.length, activeIdx]);

  // 接続完了時に autoEnter 状態をサーバー＆クライアントへ再送
  useEffect(() => {
    if (connState === 'connected') {
      panelRef.current?.setAutoYes(autoEnter);
      panelRef.current?.setClientAutoEnter(autoEnter);
    }
  }, [connState, autoEnter]);

  const notify = useCallback((title, body) => {
    if (document.visibilityState === 'visible') return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/character.png' });
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then(p => {
        if (p === 'granted') new Notification(title, { body, icon: '/character.png' });
      });
    }
  }, []);

  const playDoneSound = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 150, 300].forEach((delay, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = [880, 1108, 1320][i];
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.15, ctx.currentTime + delay / 1000);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay / 1000 + 0.3);
        osc.start(ctx.currentTime + delay / 1000);
        osc.stop(ctx.currentTime + delay / 1000 + 0.3);
      });
    } catch {}
  }, []);

  const handleActivity = useCallback(() => {
    // working のみ管理。thinking は handleOutput が管理する

    setIsWorking(true);
    clearTimeout(workingTimerRef.current);
    workingTimerRef.current = setTimeout(() => {
      setIsWorking(prev => {
        if (prev) {
          playDoneSound();
          notify('⚡ ちゅどーん！できたっちゃ！', `${activeSession?.name || 'セッション'} うち、やりとげたっちゃよ！`);
          setIsDone(true);
          clearTimeout(doneTimerRef.current);
          doneTimerRef.current = setTimeout(() => setIsDone(false), 3000);
        }
        return false;
      });
    }, 2000);
  }, [playDoneSound]);

  const THINKING_RE = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷◐◓◑◒]|[Tt]hinking/;

  const handleOutput = useCallback((data) => {
    const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

    if (THINKING_RE.test(clean)) {
      thinkingSetAtRef.current = Date.now();
      setIsThinking(true);
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = setTimeout(() => setIsThinking(false), 30000);
      // thinking 中は working タイマーをリセットして完了通知を防ぐ
      clearTimeout(workingTimerRef.current);
      workingTimerRef.current = setTimeout(() => {
        setIsWorking(false);
        setIsThinking(false);
      }, 30000);
      return;
    }

    // thinking 以外の出力が来たら thinking を解除
    setIsThinking(false);
    clearTimeout(thinkingTimerRef.current);

    if (/\bError:|error:|\bfailed to\b|✗ /.test(clean)) {
      setIsError(true);
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setIsError(false), 5000);
    }
  }, []);

  const handleInput = useCallback(() => {
    setIsThinking(true);
    clearTimeout(thinkingTimerRef.current);
    thinkingTimerRef.current = setTimeout(() => setIsThinking(false), 15000);
  }, []);

  const sendInput = useCallback((text) => {
    const t = text ?? inputText;
    if (!t) return;
    panelRef.current?.sendInput(t + '\r');
    setInputHistory(h => [t, ...h.filter(x => x !== t)].slice(0, 50));
    inputHistoryIdxRef.current = -1;
    setInputText('');
    textareaRef.current?.blur();
  }, [inputText]);

  const sendKey = useCallback((data) => {
    panelRef.current?.sendKey(data);
  }, []);

  const handleCreate = useCallback(async ({ name, type }) => {
    setShowNewModal(false);
    setShowDrawer(false);
    const res = await createSession({ name, type });
    if (res?.name) {
      const updated = await fetchSessions();
      const idx = updated.findIndex(s => s.name === res.name);
      setActiveIdx(idx !== -1 ? idx : 0);
    }
  }, [createSession, fetchSessions]);

  const handleKill = useCallback(async (name) => {
    if (!confirm(`"${name}" を終了しますか？`)) return;
    await killSession(name);
    setShowDrawer(false);
  }, [killSession]);

  const handleRename = useCallback(async (newName) => {
    await renameSession(renaming.name, newName);
    setRenaming(null);
  }, [renaming, renameSession]);

  const touchStart = useRef(null);
  const onTouchStart = (e) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, prevY: e.touches[0].clientY, dir: null };
  };
  const onTouchMove = (e) => {
    if (!touchStart.current) return;
    const t = touchStart.current;
    const dx = e.touches[0].clientX - t.x;
    const dy = e.touches[0].clientY - t.y;
    if (t.dir === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      t.dir = Math.abs(dy) > Math.abs(dx) ? 'v' : 'h';
    }
    if (t.dir === 'v') {
      const delta = t.prevY - e.touches[0].clientY;
      t.prevY = e.touches[0].clientY;
      panelRef.current?.scrollBy(delta);
    }
  };
  const onTouchEnd = (e) => {
    if (!touchStart.current) return;
    const { x, y, dir } = touchStart.current;
    touchStart.current = null;
    const dx = e.changedTouches[0].clientX - x;
    const dy = e.changedTouches[0].clientY - y;
    if (dir !== 'v' && Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) setActiveIdx(i => Math.min(i + 1, sessions.length - 1));
      else        setActiveIdx(i => Math.max(i - 1, 0));
    }
  };

  // iOS キーボード表示時に入力エリアが隠れる問題を修正
  const inputAreaRef = useRef(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
      document.documentElement.style.setProperty('--vvo', `${vv.offsetTop}px`);
      // キーボードが出たら入力エリアを画面内に収める
      if (inputAreaRef.current) {
        inputAreaRef.current.style.transform = `translateY(${vv.offsetTop}px)`;
      }
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);


  const statusInfo = {
    connecting:   { label: 'うち、つなごうとしてるっちゃ...', cls: 'warn' },
    connected:    { label: 'つながったっちゃ！',              cls: 'ok'   },
    reconnecting: { label: 'もっかいやるっちゃ！',            cls: 'warn' },
    disconnected: { label: 'きれちゃったっちゃ…',            cls: 'err'  },
    error:        { label: 'エラーだっちゃ！電撃かますっちゃ！', cls: 'err'  },
  }[connState] || { label: connState, cls: 'warn' };

  return (
    <div className="ml-root" style={{ position: 'relative' }}>

      {/* ヘッダー */}
      <header className="ml-header">
        <button className="ml-hbtn" onPointerDown={() => setShowDrawer(true)}>☰</button>
        <button className="ml-hbtn" onPointerDown={e => { e.preventDefault(); onSwitchMode(); }} title="PC版に切替">🖥</button>
        <button className="ml-hbtn" onPointerDown={e => { e.preventDefault(); onOpenSettings?.(); }} title="設定">⚙</button>
        <div className="ml-tabs">
          {sessions.map((s, i) => {
            const secAgo = s.activity ? (Date.now() - new Date(s.activity).getTime()) / 1000 : 9999;
            const needsInput = /[\?？]|y\/n|\[y|enter|confirm|続ける|許可|信頼/i.test(s.lastLine || '');
            const status = needsInput ? { label: '返事するっちゃ！', cls: 'confirm' }
              : secAgo < 10  ? { label: 'やってるっちゃ！', cls: 'working' }
              : { label: 'まってるっちゃ〜', cls: 'idle' };
            return (
              <button
                key={s.name}
                className={`ml-tab ${i === activeIdx ? 'active' : ''}`}
                onPointerDown={() => setActiveIdx(i)}
              >
                <span className={`dot ${statusClass(s)} ${s.isClaude ? 'claude' : ''}`} />
                <span className="ml-tab-inner">
                  <span className="ml-tab-name">{s.name}</span>
                  <span className={`ml-tab-status ml-tab-status--${status.cls}`}>{status.label}</span>
                </span>
              </button>
            );
          })}
        </div>


      </header>


      {/* キャラクターエリア */}
      {(() => {
        const charState = displayCharState;
        // idle/working は通常顔と交互に切替（通常顔が設定されている場合）
        const normalImg = settings.charImgNormal || null;
        const cycleToNormal = normalImg && charTick % 2 === 1;
        const charSrcMap = {
          offline:  settings.charImgOffline  || '/character-offline.png',
          error:    settings.charImgError    || '/character-error.png',
          success:  settings.charImgSuccess  || '/character-success.png',
          thinking: settings.charImgThinking || '/character-thinking.png',
          working:  cycleToNormal ? normalImg : (settings.charImgWorking  || '/character-working.png'),
          idle:     cycleToNormal ? normalImg : (settings.charImgIdle     || '/character-idle.png'),
        };
        const linesMap = {
          offline:  settings.offlineLines  || [],
          error:    settings.errorLines    || [],
          success:  settings.successLines  || [],
          thinking: settings.thinkingLines || [],
          working:  settings.workingLines  || [],
          idle:     settings.idleLines     || [],
        };
        const intervalMap = { offline: 15000, error: 7000, success: 5000, thinking: 8000, working: 8000, idle: 12000 };
        const src   = charSrcMap[charState];
        const lines = linesMap[charState];
        const iv    = intervalMap[charState];
        const speech = lines.length ? lines[Math.floor(Date.now() / iv) % lines.length] : '';
        return (
          <div className={`ml-character ml-character--${charState}`}>
            <img
              key={src}
              src={src}
              alt=""
              className="ml-character-img"
              onError={e => { e.target.src = '/character.png'; e.target.onerror = null; }}
            />
            <div className="ml-character-bubble">{speech}</div>
          </div>
        );
      })()}

      {/* ステータスバー */}
      <div className={`ml-statusbar ml-statusbar--${statusInfo.cls}`}>
        <span>● {statusInfo.label}</span>
        <span className="ml-statusbar-right">
          {connState !== 'connected' && (
            <button className="ml-reconnect-btn" onPointerDown={e => { e.preventDefault(); panelRef.current?.reconnect(); }}>
              もっかいっちゃ！
            </button>
          )}
          {sessions.length > 1 && (
            <span className="ml-statusbar-nav">
              <button onPointerDown={() => setActiveIdx(i => Math.max(i - 1, 0))} disabled={activeIdx === 0}>‹</button>
              <span>{activeIdx + 1} / {sessions.length}</span>
              <button onPointerDown={() => setActiveIdx(i => Math.min(i + 1, sessions.length - 1))} disabled={activeIdx >= sessions.length - 1}>›</button>
            </span>
          )}
        </span>
      </div>

      {/* ターミナル */}
      <div className="ml-terminal" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} ref={terminalDivRef}>
        {activeSession ? (
          <TerminalPanel
            key={activeSession.name}
            ref={panelRef}
            sessionName={activeSession.name}
            mobile={true}
            onConnStateChange={setConnState}
            onActivity={handleActivity}
            onOutput={handleOutput}
            onInput={handleInput}
          />
        ) : (
          <div className="ml-empty">
            <div>セッションがないっちゃ〜のけ？</div>
            <button className="primary" onPointerDown={() => setShowNewModal(true)}>＋ うちと一緒にはじめるっちゃ！</button>
          </div>
        )}
      </div>


      {/* 入力エリア */}
      {activeSession && (
        <div className="ml-input-area" ref={inputAreaRef}>
          {/* スキル行 */}
          <div className="ml-skills" onPointerDown={e => { if (e.currentTarget === e.target) setActiveSkill(null); }}>
            {SKILLS.map(s => {
              const isActive = activeSkill?.label === s.label;
              return (
                <button
                  key={s.label}
                  className={`ml-skill ${isActive ? 'ml-skill--active' : ''}`}
                  onPointerDown={e => {
                    e.preventDefault();
                    if (isActive) {
                      setActiveSkill(null);
                      if (s.confirm && !window.confirm(s.confirm)) return;
                      sendKey(s.cmd);
                    } else {
                      setActiveSkill(s);
                    }
                  }}
                >
                  <span className="ml-skill-label">{isActive ? s.desc : s.label}</span>
                  <span className="ml-skill-desc">{isActive ? '↓ もう一度タップ' : s.desc}</span>
                </button>
              );
            })}
          </div>
          {/* キー行 */}
          <div className="ml-keys-row">
            {KEYS.map(k => (
              <button key={k.label} className="ml-key ml-key--sm" onClick={() => {
                if (k.data === '\x1b[A') {
                  const idx = inputHistoryIdxRef.current + 1;
                  if (idx < inputHistory.length) { inputHistoryIdxRef.current = idx; setInputText(inputHistory[idx]); }
                } else if (k.data === '\x1b[B') {
                  const idx = inputHistoryIdxRef.current - 1;
                  if (idx >= 0) { inputHistoryIdxRef.current = idx; setInputText(inputHistory[idx]); }
                  else { inputHistoryIdxRef.current = -1; setInputText(''); }
                } else {
                  sendKey(k.data);
                }
              }}>
                {k.label}
              </button>
            ))}
            <button className="ml-key ml-key--sm" onClick={() => panelRef.current?.copySelection()}>コピー</button>
            <button className="ml-key ml-key--sm" onClick={() => openHistory()}>履歴</button>
            <div className="ml-key-spacer" />
            <button
              className={`ml-key ml-key--auto ${autoEnter ? 'active' : ''}`}
              onPointerDown={e => {
                e.preventDefault();
                const next = !autoEnter;
                setAutoEnter(next);
                localStorage.setItem('termui-auto-enter', next);
                panelRef.current?.setAutoYes(next);
                panelRef.current?.setClientAutoEnter(next);
              }}
            >
              自動
            </button>
            <button className="ml-key ml-key--enter primary" onPointerDown={e => { e.preventDefault(); sendKey('\r'); }}>
              Yes
            </button>
          </div>
          {/* テキスト入力行 */}
          <div className="ml-input-row">
            <textarea
              ref={textareaRef}
              className="ml-textarea"
              value={inputText}
              onChange={e => {
                const val = e.target.value;
                if (val.includes('\n') && !e.nativeEvent.isComposing) {
                  const trimmed = val.replace(/\n/g, '');
                  sendInput(trimmed || undefined);
                  return;
                }
                setInputText(val);
              }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendInput(); } }}
              placeholder="コマンド入力..."
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            />
            <label className="ml-send ml-attach-label">
              📎
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
            </label>
            <button className="ml-send primary" onPointerDown={e => { e.preventDefault(); sendInput(); }} disabled={!inputText}>▶</button>
          </div>
        </div>
      )}

      {/* 履歴オーバーレイ */}
      {history !== null && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#0d1117', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid #30363d', flexShrink: 0 }}>
            <span style={{ color: '#e6edf3', fontWeight: 700 }}>履歴</span>
            <button style={{ background: 'transparent', border: 'none', color: '#e6edf3', fontSize: 20, padding: '4px 8px' }} onPointerDown={e => { e.preventDefault(); setHistory(null); }}>✕</button>
          </div>
          <pre ref={el => { if (el) el.scrollTop = el.scrollHeight; }} style={{ flex: 1, overflow: 'auto', margin: 0, padding: '12px', color: '#e6edf3', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {history}
          </pre>
        </div>
      )}

      {/* ドロワー */}
      {showDrawer && (
        <div className="ml-backdrop" onPointerDown={() => setShowDrawer(false)}>
          <div className="ml-drawer" onPointerDown={e => e.stopPropagation()}>
            <div className="ml-drawer-header">
              <span>セッション</span>
              <button className="icon" onPointerDown={() => setShowDrawer(false)}>✕</button>
            </div>
            <div className="ml-drawer-list">
              {sessions.map((s, i) => (
                <div
                  key={s.name}
                  className={`ml-drawer-item ${i === activeIdx ? 'active' : ''}`}
                  onPointerDown={() => { setActiveIdx(i); setShowDrawer(false); }}
                >
                  <span className={`dot ${statusClass(s)}`} />
                  <div className="ml-drawer-info">
                    <div className="ml-drawer-name">{s.name}</div>
                    {s.lastLine && <div className="ml-drawer-last">{s.lastLine}</div>}
                  </div>
                  <div className="ml-drawer-btns" onPointerDown={e => e.stopPropagation()}>
                    <button className="icon" onPointerDown={() => { setRenaming({ name: s.name }); setShowDrawer(false); }}>✎</button>
                    <button className="icon danger" onPointerDown={() => handleKill(s.name)}>✕</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="ml-drawer-footer">
              <button className="primary" style={{ width: '100%' }} onPointerDown={() => { setShowDrawer(false); setShowNewModal(true); }}>
                ＋ 新規セッション
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewModal && <NewSessionModal onConfirm={handleCreate} onCancel={() => setShowNewModal(false)} />}
      {renaming && <RenameModal currentName={renaming.name} onConfirm={handleRename} onCancel={() => setRenaming(null)} />}
    </div>
  );
}
