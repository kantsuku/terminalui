import { useState, useRef, useCallback, useEffect } from 'react';
import TerminalPanel from './TerminalPanel';
import NewSessionModal from './NewSessionModal';
import RenameModal from './RenameModal';
import QRModal from './QRModal';
import './PCLayout.css';

function statusClass(s) { return s.status === 'active' ? 'active' : 'idle'; }

const SKILLS = [
  { label: '/commit',    cmd: 'コミットして\r',          desc: 'AIが変更内容を見てコミットメッセージを作って保存する' },
  { label: 'git push',  cmd: 'git push\r',            desc: '今のコミットをGitHubに送る' },
  { label: 'git status',cmd: 'git status\r',          desc: '何のファイルが変更されているか確認する' },
  { label: 'git diff',  cmd: 'git --no-pager diff\r', desc: 'ファイルの中身がどう変わったか確認する' },
  { label: 'clasp push', cmd: 'clasp push\r',          desc: 'GASのコードをGoogle Driveにプッシュする' },
  { label: '中断',      cmd: '\x1b',                  desc: 'Escキーを送信して処理を中断する' },
];


export default function PCLayout({ sessions, createSession, killSession, renameSession, fetchSessions, onSwitchMode, settings = {}, onOpenSettings, userName = 'default' }) {
  const activeKey = `termui-active-${userName}`;
  const [activeSessions, setActiveSessions] = useState(() => {
    try {
      const saved = localStorage.getItem(`termui-active-${userName}`);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });
  const [showNewModal, setShowNewModal] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [autoYes, setAutoYes] = useState({});
  const [skillsPopupFor, setSkillsPopupFor] = useState(null);
  const [panelInput, setPanelInput] = useState({});
  const [panelHistory, setPanelHistory] = useState({});
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
  const thinkingSetAtRef  = useRef(null);

  // キャラ画像切替用タイマー（8秒ごと）
  useEffect(() => {
    const id = setInterval(() => setCharTick(t => t + 1), 8000);
    return () => clearInterval(id);
  }, []);
  const panelRefs = useRef({});
  const initializedRef = useRef(false);
  const mainAreaRef = useRef(null);

  // ターミナルのホイールイベントがサイドバーに伝播するのを防ぐ
  useEffect(() => {
    const el = mainAreaRef.current;
    if (!el) return;
    const handler = (e) => e.stopPropagation();
    el.addEventListener('wheel', handler, { passive: true });
    return () => el.removeEventListener('wheel', handler);
  }, []);
  const [, tick] = useState(0);

  // セリフ更新用タイマー
  const isActive = isWorking || isThinking || isDone || isError;
  useEffect(() => {
    const id = setInterval(() => tick(t => t + 1), isActive ? 2000 : 6000);
    return () => clearInterval(id);
  }, [isActive]);

  // charState を debounce して表情のちらつきを防ぐ
  useEffect(() => {
    const raw = isError    ? 'error'
      : isDone     ? 'success'
      : isThinking ? 'thinking'
      : isWorking  ? 'working'
      : 'idle';

    const IMMEDIATE = ['error', 'success'];
    if (IMMEDIATE.includes(raw)) {
      clearTimeout(charDebounceRef.current);
      setDisplayCharState(raw);
    } else {
      clearTimeout(charDebounceRef.current);
      charDebounceRef.current = setTimeout(() => setDisplayCharState(raw), 800);
    }
    return () => clearTimeout(charDebounceRef.current);
  }, [isError, isDone, isThinking, isWorking]);

  // activeSessions が変わるたびに localStorage に保存
  useEffect(() => {
    localStorage.setItem(activeKey, JSON.stringify(activeSessions));
  }, [activeSessions, activeKey]);

  // 初回: 保存済みがなければ既存セッションを最大4つ自動選択
  useEffect(() => {
    if (initializedRef.current || sessions.length === 0) return;
    initializedRef.current = true;
    if (!localStorage.getItem(activeKey)) {
      setActiveSessions(sessions.slice(0, 4).map(s => s.name));
    }
  }, [sessions, activeKey]);

  // セッションが消えたら除去（新セッションは自動追加しない）
  useEffect(() => {
    const names = new Set(sessions.map(s => s.name));
    setActiveSessions(prev => prev.filter(n => names.has(n)));
  }, [sessions]);

  const toggleSession = useCallback((name) => {
    setActiveSessions(prev => {
      if (prev.includes(name)) {
        // 非表示にするとき: autoYes を解除
        panelRefs.current[name]?.setAutoYes(false);
        panelRefs.current[name]?.setClientAutoEnter(false);
        setAutoYes(p => { const n = { ...p }; delete n[name]; return n; });
        return prev.filter(n => n !== name);
      }
      return prev.length < 4 ? [...prev, name] : prev;
    });
  }, []);

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

  const activeSessionNamesRef = useRef(activeSessions);
  activeSessionNamesRef.current = activeSessions;

  const handleActivity = useCallback(() => {
    // working のみ管理。thinking は handleOutput が管理する
    setIsWorking(true);
    clearTimeout(workingTimerRef.current);
    workingTimerRef.current = setTimeout(() => {
      setIsWorking(prev => {
        if (prev) {
          playDoneSound();
          notify('⚡ ちゅどーん！できたっちゃ！', `${activeSessionNamesRef.current.join(', ')} うち、やりとげたっちゃよ！`);
          setIsDone(true);
          clearTimeout(doneTimerRef.current);
          doneTimerRef.current = setTimeout(() => setIsDone(false), 3000);
        }
        return false;
      });
    }, 2000);
  }, [playDoneSound, notify]);

  const THINKING_RE = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷◐◓◑◒]|[Tt]hinking/;

  const handleOutput = useCallback((data) => {
    const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

    if (THINKING_RE.test(clean)) {
      thinkingSetAtRef.current = Date.now();
      setIsThinking(true);
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = setTimeout(() => setIsThinking(false), 30000);
      clearTimeout(workingTimerRef.current);
      workingTimerRef.current = setTimeout(() => {
        setIsWorking(false);
        setIsThinking(false);
      }, 30000);
      return;
    }

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

  const handleCreate = useCallback(async ({ name, type }) => {
    setShowNewModal(false);
    const systemPrompt = type === 'claude' ? settings.claudePrompt : undefined;
    const res = await createSession({ name, type, systemPrompt });
    if (res?.name) {
      await fetchSessions();
      setActiveSessions(prev => prev.length < 4 ? [...prev, res.name] : prev);
    }
  }, [createSession, fetchSessions, settings.claudePrompt]);

  const handleKill = useCallback(async (name) => {
    if (!confirm(`"${name}" を終了しますか？`)) return;
    await killSession(name);
  }, [killSession]);

  const handleRename = useCallback(async (newName) => {
    const old = renaming.name;
    setRenaming(null);
    await renameSession(old, newName);
    setActiveSessions(prev => prev.map(n => n === old ? newName : n));
  }, [renaming, renameSession]);

  // グリッドレイアウト（常に横並び）
  const count = activeSessions.length;
  const cols = count || 1;
  const rows = 1;

  // ドラッグ＆ドロップで並び替え
  const dragSrcRef = useRef(null);
  const handleDragStart = useCallback((name) => { dragSrcRef.current = name; }, []);
  const handleDrop = useCallback((targetName) => {
    const src = dragSrcRef.current;
    if (!src || src === targetName) return;
    setActiveSessions(prev => {
      const next = [...prev];
      const si = next.indexOf(src);
      const ti = next.indexOf(targetName);
      next.splice(si, 1);
      next.splice(ti, 0, src);
      localStorage.setItem(activeKey, JSON.stringify(next));
      return next;
    });
    dragSrcRef.current = null;
  }, [activeKey]);

  // キャラクター
  const charState = displayCharState;
  const normalImg = settings.charImgNormal || null;
  const cycleToNormal = normalImg && charTick % 2 === 1;
  const fallback = normalImg || settings.charImgIdle || null;
  const charSrcMap = {
    error:    settings.charImgError    || fallback,
    success:  settings.charImgSuccess  || fallback,
    thinking: settings.charImgThinking || fallback,
    working:  cycleToNormal ? normalImg : (settings.charImgWorking  || fallback),
    idle:     cycleToNormal ? normalImg : (settings.charImgIdle     || fallback),
  };
  const linesMap = {
    error:    settings.errorLines    || [],
    success:  settings.successLines  || [],
    thinking: settings.thinkingLines || [],
    working:  settings.workingLines  || [],
    idle:     settings.idleLines     || [],
  };
  const intervalMap = { error: 7000, success: 5000, thinking: 8000, working: 8000, idle: 12000 };
  const charSrc = charSrcMap[charState];
  const lines   = linesMap[charState];
  const speech  = lines.length ? lines[Math.floor(Date.now() / intervalMap[charState]) % lines.length] : '';

  return (
    <div className="pc-layout">

      {/* ── 左カラム ── */}
      <aside className="sidebar">

        {/* キャラクターエリア */}
        <div className={`sidebar-character sidebar-character--${charState}`}>
          <img
            key={charSrc}
            src={charSrc}
            alt=""
            className="sidebar-character-img"
            onError={e => { e.target.src = '/character.png'; e.target.onerror = null; }}
          />
          {speech && <div className="sidebar-bubble">{speech}</div>}
        </div>

        {/* ヘッダー */}
        <div className="sidebar-header">
          <span className="logo">{settings.name || 'ラムちゃん'}</span>
          {userName !== 'default' && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>@{userName}</span>}
          <button className="icon" title="QR" onClick={() => setShowQR(true)}>QR</button>
          <button className="icon" title="設定" onClick={onOpenSettings}>⚙</button>
        </div>

        {/* セッション一覧 */}
        <div className="sidebar-section-title">
          SESSIONS
          <span className="sidebar-count">{activeSessions.length} / 4</span>
        </div>
        <div className="session-list">
          {sessions.length === 0 && <div className="empty-msg">セッションなし</div>}
          {sessions.map(s => {
            const secAgo = s.activity ? (Date.now() - new Date(s.activity).getTime()) / 1000 : 9999;
            const working = secAgo < 10;
            const selected = activeSessions.includes(s.name);
            return (
              <div
                key={s.name}
                className={`session-item ${selected ? 'selected' : ''}`}
                onClick={() => toggleSession(s.name)}
              >
                <span className={`dot ${statusClass(s)} ${s.isClaude ? 'claude' : ''}`} />
                <div className="session-info">
                  <div className="session-name">{s.name}</div>
                  <div className={`session-status ${working ? 'session-status--working' : 'session-status--idle'}`}>
                    {working ? '● やってるっちゃ！' : '○ 待機中'}
                  </div>
                </div>
                <div className="session-actions" onClick={e => e.stopPropagation()}>
                  <button className="icon" title="リネーム" onClick={() => setRenaming({ name: s.name })}>✎</button>
                  <button className="icon danger" title="終了" onClick={() => handleKill(s.name)}>✕</button>
                </div>
              </div>
            );
          })}
        </div>

        {/* フッター */}
        <div className="sidebar-footer">
          <button className="primary" style={{ width: '100%' }} onClick={() => setShowNewModal(true)}>
            ＋ 新規セッション
          </button>
          <button style={{ width: '100%', marginTop: 6 }} onClick={onSwitchMode}>
            📱 スマホモード
          </button>
        </div>
      </aside>

      {/* ── 右メインエリア ── */}
      <div className="main-area" ref={mainAreaRef}>
        {count === 0 ? (
          <div className="panel-empty" style={{ flex: 1 }}>
            <div>左のセッション一覧をクリックして表示するっちゃ！</div>
            <div style={{ fontSize: 12, marginTop: 8, color: 'var(--text-muted)' }}>最大4セッション同時表示</div>
          </div>
        ) : (
          <div
            className="panels-grid"
            style={{
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gridTemplateRows: `repeat(${rows}, 1fr)`,
            }}
          >
            {activeSessions.map(name => {
              const sessionType = sessions.find(s => s.name === name)?.type;
              const defaultAy = sessionType !== 'shell';
              const ay = autoYes[name] ?? defaultAy;
              return (
                <div
                  key={name}
                  className="panel"
                  draggable
                  onDragStart={() => handleDragStart(name)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => handleDrop(name)}
                >
                  <div className="panel-header" style={{ cursor: 'grab' }}>
                    <span className="panel-title">{name}</span>
                    <button className="icon danger" title="パネルを閉じる" onClick={() => setActiveSessions(p => p.filter(n => n !== name))}>✕</button>
                  </div>
                  <div className="panel-body">
                    <TerminalPanel
                      ref={el => { panelRefs.current[name] = el; }}
                      sessionName={name}
                      mobile={false}
                      ntfyTopic={settings.ntfyTopic || ''}
                      onActivity={handleActivity}
                      onOutput={handleOutput}
                      onInput={handleInput}
                      onConnStateChange={state => {
                        if (state === 'connected') {
                          const sType = sessions.find(s => s.name === name)?.type;
                          const enabled = autoYes[name] ?? (sType !== 'shell');
                          panelRefs.current[name]?.setAutoYes(enabled);
                          panelRefs.current[name]?.setClientAutoEnter(enabled);
                        }
                      }}
                    />
                  </div>
                  {/* コントロール行 */}
                  <div className="panel-controls" style={{ position: 'relative' }}>
                    <button className="icon" title="スキル" onClick={() => setSkillsPopupFor(v => v === name ? null : name)}>⚡</button>
                    {skillsPopupFor === name && (
                      <div className="panel-skills-popup">
                        {SKILLS.map(sk => (
                          <button
                            key={sk.label}
                            className="panel-skills-popup-item"
                            onClick={() => {
                              setSkillsPopupFor(null);
                              if (sk.confirm && !window.confirm(sk.confirm)) return;
                              panelRefs.current[name]?.sendInput(sk.cmd);
                            }}
                          >
                            <span className="panel-skill-label">{sk.label}</span>
                            <span className="panel-skill-desc">{sk.desc}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <button className="icon" onClick={() => panelRefs.current[name]?.sendKey('\x03')}>中断</button>
                    <button className="icon" onClick={() => panelRefs.current[name]?.copySelection()}>コピー</button>
                    <button className="icon" onClick={async () => {
                      const res = await fetch(`/api/sessions/${encodeURIComponent(name)}/history`);
                      const data = await res.json();
                      setPanelHistory(p => ({ ...p, [name]: data.content || '' }));
                    }}>履歴</button>
                    <div style={{ flex: 1 }} />
                    <button
                      className={`panel-ctrl-big ${ay ? 'active' : ''}`}
                      onClick={() => {
                        const next = !ay;
                        setAutoYes(p => ({ ...p, [name]: next }));
                        panelRefs.current[name]?.setAutoYes(next);
                        panelRefs.current[name]?.setClientAutoEnter(next);
                      }}
                    >
                      自動
                    </button>
                    <button
                      className={`panel-ctrl-big panel-ctrl-yes primary${ay ? ' dimmed' : ''}`}
                      onClick={() => panelRefs.current[name]?.sendKey('\r')}
                    >
                      ⏎ Yes
                    </button>
                  </div>
                  {/* テキスト入力行 */}
                  <div className="panel-input-row">
                    <textarea
                      className="panel-input"
                      placeholder="コマンド入力... (Shift+Enter で改行、Enter で送信)"
                      value={panelInput[name] || ''}
                      onChange={e => setPanelInput(p => ({ ...p, [name]: e.target.value }))}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          const val = panelInput[name];
                          if (!val) return;
                          panelRefs.current[name]?.sendInput(val + '\r');
                          setPanelInput(p => ({ ...p, [name]: '' }));
                        }
                      }}
                      autoComplete="off" autoCorrect="off" spellCheck={false}
                    />
                    <div className="panel-send-col">
                      <label className="panel-attach" title="画像添付">
                        📎
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const form = new FormData();
                          form.append('file', file);
                          try {
                            const res = await fetch('/api/upload', { method: 'POST', body: form });
                            const data = await res.json();
                            if (data.path) setPanelInput(p => ({ ...p, [name]: (p[name] || '') + data.path }));
                          } catch { alert('アップロード失敗'); }
                          e.target.value = '';
                        }} />
                      </label>
                      <button
                        className="primary panel-send"
                        onPointerDown={e => {
                          e.preventDefault();
                          const val = panelInput[name];
                          if (!val) return;
                          panelRefs.current[name]?.sendInput(val + '\r');
                          setPanelInput(p => ({ ...p, [name]: '' }));
                        }}
                      >
                        ▶
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showNewModal && <NewSessionModal onConfirm={handleCreate} onCancel={() => setShowNewModal(false)} />}
      {renaming && <RenameModal currentName={renaming.name} onConfirm={handleRename} onCancel={() => setRenaming(null)} />}
      {showQR && <QRModal onClose={() => setShowQR(false)} />}

      {/* 履歴オーバーレイ */}
      {Object.entries(panelHistory).map(([sName, content]) =>
        content !== null ? (
          <div key={sName} className="modal-backdrop" onClick={() => setPanelHistory(p => ({ ...p, [sName]: null }))}>
            <div className="modal" style={{ width: 700, maxWidth: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent)' }}>履歴 — {sName}</span>
                <button className="icon" onClick={() => setPanelHistory(p => ({ ...p, [sName]: null }))}>✕</button>
              </div>
              <pre ref={el => { if (el && !el.dataset.scrolled) { el.scrollTop = el.scrollHeight; el.dataset.scrolled = 'true'; } }} style={{ flex: 1, overflow: 'auto', margin: 0, color: 'var(--text)', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {content}
              </pre>
            </div>
          </div>
        ) : null
      )}
    </div>
  );
}
