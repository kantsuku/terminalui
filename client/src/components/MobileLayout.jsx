import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import TerminalPanel from './TerminalPanel';
import NewSessionModal from './NewSessionModal';
import RenameModal from './RenameModal';
import HistoryView from './HistoryView';
import { getCharForSession } from '../hooks/useSettings';
import { showToast } from './Toast';
import './MobileLayout.css';

function statusClass(s) { return s.status === 'active' ? 'active' : 'idle'; }

const SKILLS = [
  { label: '/commit',        cmd: 'コミットして\r',               desc: 'AIが変更内容を見てコミットメッセージを作って保存する' },
  { label: 'git push',       cmd: 'git push\r',                 desc: '今のコミットをGitHubに送る' },
  { label: 'git status',     cmd: 'git status\r',               desc: '何のファイルが変更されているか確認する' },
  { label: 'git diff',       cmd: 'git --no-pager diff\r',      desc: 'ファイルの中身がどう変わったか確認する' },
  { label: 'clasp push',     cmd: 'clasp push\r',               desc: 'GASのコードをGoogle Driveにプッシュする' },
  { label: '中断',           cmd: '\x1b',                       desc: 'Escキーを送信して処理を中断する' },
  { label: 'gh repos',       cmd: 'gh repo list kantsuku --limit 30\r', desc: 'kantsukuのGitHubリポジトリ一覧を表示する' },
  { label: 'デザインチェック', cmd: 'フォント・スペーシング・カラー・レスポンシブなどUIデザインを一括チェックして、問題があれば修正して\r', desc: 'UIデザインを一括チェック' },
  { label: '改善提案',       cmd: 'このプロジェクトのUX・機能・パフォーマンスについて改善案を提案して\r', desc: '改善案をAIが提案する' },
  { label: 'ヘルスチェック', cmd: 'このプロジェクトのクラッシュ・バグ・メモリリーク・セキュリティ問題を洗い出して、問題があれば修正して\r', desc: '問題を洗い出して修正する' },
  { label: 'プロジェクト構築', cmd: 'このディレクトリに新規プロジェクトを構築して。以下の手順で進めて：\n1. まずどんなプロジェクトを作りたいかヒアリングして\n2. CLAUDE.md を作成（プロジェクト概要・技術スタック・ディレクトリ構成・開発ルール）\n3. .gitignore を作成\n4. 必要なパッケージのインストールと初期ファイル生成\n5. git init してinitial commit\n6. GitHubリポジトリを作成してpush（gh repo create）\nまずは何を作るか聞いて。\r', desc: '新規プロジェクトの初期構築をAIがヒアリングしながら行う' },
];

const KEYS = [
  { label: '中断', data: '\x03' },
];

export default function MobileLayout({ sessions, createSession, killSession, renameSession, fetchSessions, onSwitchMode, settings = {}, onOpenSettings, onSaveSettings, userName = 'default' }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [showDrawer, setShowDrawer] = useState(false);
  // PC同様、選択したセッションだけ表示
  const mobileActiveKey = `termui-mobile-active-${userName}`;
  const [mobileActiveSessions, setMobileActiveSessions] = useState(() => {
    try {
      const saved = localStorage.getItem(`termui-mobile-active-${userName}`);
      if (saved) return JSON.parse(saved);
    } catch {}
    return null; // null = 未設定（全表示、初回は自動選択）
  });
  const [showNewModal, setShowNewModal] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [inputText, setInputText] = useState('');
  const [connState, setConnState] = useState('disconnected');
  // autoYesMode: false | 'semi' | 'full' の3段階
  const autoYesModeKey = `termui-autoyes-mode-${userName}`;
  const [autoYesMode, setAutoYesMode] = useState(() => {
    const stored = localStorage.getItem(`termui-autoyes-mode-${userName}`);
    if (stored === 'semi' || stored === 'full') return stored;
    // v2からの移行: true → 'full'
    const legacy = localStorage.getItem(`termui-auto-enter-v2-${userName}`);
    if (legacy === 'true') return 'full';
    return false;
  });
  const [history, setHistory] = useState(null);
  const [inputHistory, setInputHistory] = useState([]);
  const inputHistoryIdxRef = useRef(-1);
  const [activeSkill, setActiveSkill] = useState(null);
  const [showSkillsPopup, setShowSkillsPopup] = useState(false);
  const [isWorking,        setIsWorking]        = useState(false);
  const [isThinking,       setIsThinking]       = useState(false);
  const [isDone,           setIsDone]           = useState(false);
  const [isError,          setIsError]          = useState(false);
  const [promptWaiting,    setPromptWaiting]    = useState(false);
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
  const historyScrollRef = useRef(null);

  // mobileActiveSessions でフィルタ（null=全表示、配列=選択のみ）
  const visibleSessions = mobileActiveSessions
    ? sessions.filter(s => mobileActiveSessions.includes(s._id || s.name))
    : sessions;

  // mobileActiveSessionsの永続化 + 存在しないセッションの除去
  useEffect(() => {
    if (mobileActiveSessions) {
      const ids = new Set(sessions.map(s => s._id || s.name));
      const cleaned = mobileActiveSessions.filter(n => ids.has(n));
      if (cleaned.length !== mobileActiveSessions.length) setMobileActiveSessions(cleaned);
      localStorage.setItem(mobileActiveKey, JSON.stringify(cleaned));
    }
  }, [mobileActiveSessions, sessions]);

  // activeIdx が visibleSessions の範囲外にならないよう補正
  useEffect(() => {
    if (activeIdx >= visibleSessions.length && visibleSessions.length > 0) {
      setActiveIdx(visibleSessions.length - 1);
    }
  }, [visibleSessions.length, activeIdx]);

  const activeSession = visibleSessions[activeIdx] || null;
  const activeSessionRef = useRef(null);
  activeSessionRef.current = activeSession;

  // アクティブセッションのキャラを取得
  const activeChar = getCharForSession(settings, activeSession?.name || '');
  const accent = activeChar.accent || '#00d4aa';

  // bodyの背景もキャラ色に合わせる（セーフエリア外の隙間対策）
  useEffect(() => {
    document.body.style.background = accent + '18';
    return () => { document.body.style.background = ''; };
  }, [accent]);

  const openHistory = useCallback(async () => {
    if (!activeSession) return;
    const res = await fetch(`/api/sessions/${encodeURIComponent(activeSession._id || activeSession.name)}/history?user=${encodeURIComponent(userName)}`);
    const data = await res.json();
    setHistory(data.content || '');
    setTimeout(() => {
      if (historyScrollRef.current) {
        historyScrollRef.current.scrollTop = historyScrollRef.current.scrollHeight;
      }
    }, 50);
  }, [activeSession]);

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
      const data = await res.json();
      if (data.path) setInputText(prev => prev + data.path);
    } catch (e) {
      showToast(e.name === 'TimeoutError' ? 'アップロードタイムアウト' : 'アップロード失敗', 'error');
    }
    e.target.value = '';
  };

  useEffect(() => {
    if (sessions.length > 0 && activeIdx >= sessions.length) {
      setActiveIdx(sessions.length - 1);
    }
  }, [sessions.length, activeIdx]);

  // セッション切替時に表情・状態をリセット
  useEffect(() => {
    setIsWorking(false);
    setIsThinking(false);
    setIsDone(false);
    setIsError(false);
    clearTimeout(workingTimerRef.current);
    clearTimeout(thinkingTimerRef.current);
    clearTimeout(doneTimerRef.current);
    clearTimeout(errorTimerRef.current);
  }, [activeIdx]);

  // Shell セッションは自動OFF固定、Claude セッションはユーザー設定に従う
  const effectiveAutoYes = activeSession?.isClaude ? autoYesMode : false;

  // 接続完了時に autoYes 状態をサーバー＆クライアントへ再送
  useEffect(() => {
    if (connState === 'connected') {
      panelRef.current?.setAutoYes(effectiveAutoYes);
      panelRef.current?.setClientAutoEnter(!!effectiveAutoYes);
    }
  }, [connState, effectiveAutoYes]);

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

  const playDoneSound = useCallback(() => {}, []);

  const handleActivity = useCallback(() => {
    // working のみ管理。thinking は handleOutput が管理する

    setIsWorking(true);
    clearTimeout(workingTimerRef.current);
    workingTimerRef.current = setTimeout(() => {
      setIsWorking(prev => {
        if (prev) {
          playDoneSound();
          notify('⚡ 完了！', `${activeSessionRef.current?.name || 'セッション'} の処理が終わりました`);
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
    panelRef.current?.sendInput((t || '') + '\r');
    setInputHistory(h => [t, ...h.filter(x => x !== t)].slice(0, 50));
    inputHistoryIdxRef.current = -1;
    setInputText('');
    if (textareaRef.current) { textareaRef.current.style.height = 'auto'; }
    textareaRef.current?.blur();
  }, [inputText]);

  const sendKey = useCallback((data) => {
    panelRef.current?.sendKey(data);
  }, []);

  const handleCreate = useCallback(async ({ name, type, characterId }) => {
    setShowNewModal(false);
    setShowDrawer(false);
    const char = settings.characters.find(c => c.id === characterId) || settings.characters[0];
    const systemPrompt = type === 'claude' ? char?.claudePrompt : undefined;
    try {
      const res = await createSession({ name, type, systemPrompt });
      if (res?.name) {
        // セッション↔キャラ紐づけを保存（先に保存してからセッション切替）
        if (characterId) {
          const newSessionChars = { ...(settings.sessionChars || {}), [res.name]: characterId };
          onSaveSettings?.({ sessionChars: newSessionChars });
          // React stateが更新されるまで1tick待つ
          await new Promise(r => setTimeout(r, 50));
        }
        // セッション起動直後は tmux に反映されるまで少し待つ
        await new Promise(r => setTimeout(r, 800));
        const updated = await fetchSessions();
        const idx = updated.findIndex(s => s.name === res.name);
        setActiveIdx(idx !== -1 ? idx : Math.max(updated.length - 1, 0));
      } else {
        showToast(`セッション作成に失敗: ${res?.error || '不明なエラー'}`, 'error');
      }
    } catch (e) {
      showToast(`セッション作成エラー: ${e.message}`, 'error');
    }
  }, [createSession, fetchSessions, settings.characters, settings.sessionChars, onSaveSettings]);

  const handleKill = useCallback(async (id) => {
    await killSession(id);
    setShowDrawer(false);
    fetchSessions();
  }, [killSession, fetchSessions]);

  const handleRename = useCallback(async (newName) => {
    const id = renaming._id || renaming.name;
    const oldName = renaming.name;
    try {
      await renameSession(id, newName);
      setRenaming(null);
      // sessionChars のキーも更新
      if (settings.sessionChars?.[oldName]) {
        const updated = { ...settings.sessionChars, [newName]: settings.sessionChars[oldName] };
        delete updated[oldName];
        onSaveSettings?.({ sessionChars: updated });
      }
    } catch (e) {
      showToast(`リネーム失敗: ${e.message}`, 'error');
    }
  }, [renaming, renameSession, settings.sessionChars, onSaveSettings]);

  const touchStart = useRef(null);
  const onTouchStart = (e) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, prevY: e.touches[0].clientY, dir: null, time: Date.now() };
  };
  const onTouchMove = (e) => {
    if (!touchStart.current) return;
    const t = touchStart.current;
    const dx = e.touches[0].clientX - t.x;
    const dy = e.touches[0].clientY - t.y;
    if (t.dir === null && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) {
      t.dir = Math.abs(dy) > Math.abs(dx) ? 'v' : 'h';
    }
    if (t.dir === 'v') {
      const delta = t.prevY - e.touches[0].clientY;
      t.prevY = e.touches[0].clientY;
      panelRef.current?.scrollBy(-delta);
    }
  };
  const onTouchEnd = (e) => {
    if (!touchStart.current) return;
    const { x, y, dir, time } = touchStart.current;
    touchStart.current = null;
    const dx = e.changedTouches[0].clientX - x;
    const dy = e.changedTouches[0].clientY - y;
    const elapsed = Date.now() - (time || Date.now());
    const velocity = elapsed > 0 ? Math.abs(dx) / elapsed : 0;
    if (dir !== 'v' && Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) && velocity > 0.3) {
      if (dx < 0) setActiveIdx(i => Math.min(i + 1, visibleSessions.length - 1));
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
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);


  const pickLine = (lines, fallback) => lines?.length ? lines[charTick % lines.length] : fallback;
  const statusInfo = {
    connecting:   { label: pickLine(activeChar.thinkingLines, '接続中...'), cls: 'warn' },
    connected:    { label: pickLine(activeChar.idleLines, '接続済み'),  cls: 'ok'   },
    reconnecting: { label: pickLine(activeChar.thinkingLines, '再接続中...'), cls: 'warn' },
    disconnected: { label: pickLine(activeChar.offlineLines, '切断されました'), cls: 'err'  },
    error:        { label: pickLine(activeChar.errorLines, 'エラー'),    cls: 'err'  },
  }[connState] || { label: connState, cls: 'warn' };

  return (
    <>
    <div className="ml-root" style={{ position: 'relative', '--accent': accent, '--accent-dim': accent + '18', '--bg2': accent + '0d', '--bg3': accent + '18', '--border': accent + '40' }}>

      {/* ヘッダー */}
      <header className="ml-header">
        <button className="ml-hbtn" onPointerDown={() => setShowDrawer(true)}>☰</button>
        <div className="ml-tabs">
          {visibleSessions.map((s, i) => {
            const secAgo = s.activity ? (Date.now() - new Date(s.activity).getTime()) / 1000 : 9999;
            const needsInput = /[\?？]|y\/n|\[y|enter|confirm|続ける|許可|信頼/i.test(s.lastLine || '');
            const sChar = getCharForSession(settings, s.name);
            const pickLine = (lines, fallback) => lines?.length ? lines[charTick % lines.length] : fallback;
            const status = needsInput ? { label: pickLine(sChar.thinkingLines, '確認待ち'), cls: 'confirm' }
              : secAgo < 10  ? { label: pickLine(sChar.workingLines, '作業中'), cls: 'working' }
              : { label: pickLine(sChar.idleLines, '待機中'), cls: 'idle' };
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
        const normalImg = activeChar.charImgNormal || null;
        const cycleToNormal = normalImg && charTick % 2 === 1;
        const fallback = normalImg || activeChar.charImgIdle || null;
        const charSrcMap = {
          offline:  activeChar.charImgOffline  || fallback,
          error:    activeChar.charImgError    || fallback,
          success:  activeChar.charImgSuccess  || fallback,
          thinking: activeChar.charImgThinking || fallback,
          working:  cycleToNormal ? normalImg : (activeChar.charImgWorking  || fallback),
          idle:     cycleToNormal ? normalImg : (activeChar.charImgIdle     || fallback),
        };
        const linesMap = {
          offline:  activeChar.offlineLines  || [],
          error:    activeChar.errorLines    || [],
          success:  activeChar.successLines  || [],
          thinking: activeChar.thinkingLines || [],
          working:  activeChar.workingLines  || [],
          idle:     activeChar.idleLines     || [],
        };
        const intervalMap = { offline: 15000, error: 7000, success: 5000, thinking: 8000, working: 8000, idle: 12000 };
        const src   = charSrcMap[charState];
        const lines = linesMap[charState].length ? linesMap[charState] : (linesMap['idle'] || []);
        const iv    = intervalMap[charState];
        const speech = lines.length ? lines[Math.floor(Date.now() / iv) % lines.length] : '';
        if (!src) return null;
        return (
          <div className={`ml-character ml-character--${charState}`}>
            <img
              key={src}
              src={src}
              alt=""
              className="ml-character-img"
              onError={e => { e.target.style.display = 'none'; }}
            />
            {speech && <div className="ml-character-bubble">{speech}</div>}
          </div>
        );
      })()}

      {/* ステータスバー */}
      <div className={`ml-statusbar ml-statusbar--${promptWaiting ? 'warning' : statusInfo.cls}`}>
        <span>{promptWaiting ? '⏸ 要判断！' : `● ${statusInfo.label}`}</span>
        <span className="ml-statusbar-right">
          {connState !== 'connected' && (
            <button className="ml-reconnect-btn" onPointerDown={e => { e.preventDefault(); panelRef.current?.reconnect(); }}>
              再接続
            </button>
          )}
          {visibleSessions.length > 1 && (
            <span className="ml-statusbar-nav">
              <button onPointerDown={() => setActiveIdx(i => Math.max(i - 1, 0))} disabled={activeIdx === 0}>‹</button>
              <span>{activeIdx + 1} / {visibleSessions.length}</span>
              <button onPointerDown={() => setActiveIdx(i => Math.min(i + 1, visibleSessions.length - 1))} disabled={activeIdx >= visibleSessions.length - 1}>›</button>
            </span>
          )}
        </span>
      </div>

      {/* ターミナル */}
      <div className="ml-terminal" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} ref={terminalDivRef}>
        {activeSession ? (
          <TerminalPanel
            key={activeSession._id || activeSession.name}
            ref={panelRef}
            sessionName={activeSession._id || activeSession.name}
            userName={userName}
            mobile={true}
            ntfyTopic={settings.ntfyTopic || ''}
            accentColor={accent}
            onConnStateChange={setConnState}
            onActivity={handleActivity}
            onOutput={handleOutput}
            onInput={handleInput}
            onPromptBlocked={() => { setPromptWaiting(true); showToast('⚠️ 要判断！手動で応答してください', 'error', 5000); setTimeout(() => setPromptWaiting(false), 10000); }}
          />
        ) : (
          <div className="ml-empty">
            <div>セッションがありません</div>
            <button className="primary" onPointerDown={() => setShowNewModal(true)}>＋ 新規セッション</button>
          </div>
        )}
      </div>


      {/* スキルポップアップ */}
      {showSkillsPopup && (
        <div className="ml-skills-backdrop" onPointerDown={() => { setShowSkillsPopup(false); setActiveSkill(null); }}>
          <div className="ml-skills-popup" onPointerDown={e => e.stopPropagation()}>
            <div className="ml-skills-popup-title">スキル</div>
            {SKILLS.map(s => {
              const isActive = activeSkill?.label === s.label;
              return (
                <button
                  key={s.label}
                  className={`ml-skills-popup-item ${isActive ? 'ml-skills-popup-item--active' : ''}`}
                  onPointerDown={e => {
                    e.preventDefault();
                    if (isActive) {
                      setActiveSkill(null);
                      setShowSkillsPopup(false);
                      if (s.confirm && !window.confirm(s.confirm)) return;
                      sendKey(s.cmd);
                    } else {
                      setActiveSkill(s);
                    }
                  }}
                >
                  <span className="ml-skills-popup-label">{s.label}</span>
                  <span className="ml-skills-popup-desc">{isActive ? '↓ もう一度タップで実行' : s.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 入力エリア */}
      {activeSession && (
        <div className="ml-input-area" ref={inputAreaRef}>
          {/* キー行 */}
          <div className="ml-keys-row">
            <button
              className="ml-key ml-key--sm ml-key--skills"
              onPointerDown={e => { e.preventDefault(); setShowSkillsPopup(v => !v); setActiveSkill(null); }}
            >⚡️</button>
            {KEYS.map(k => (
              <button key={k.label} className="ml-key ml-key--sm" onClick={() => sendKey(k.data)}>
                {k.label}
              </button>
            ))}
            <button className="ml-key ml-key--sm" onClick={() => panelRef.current?.copySelection()}>コピー</button>
            <button className="ml-key ml-key--sm" onClick={() => openHistory()}>履歴</button>
            <div className="ml-key-spacer" />
            {activeSession?.isClaude && (
              <>
                <button
                  className={`ml-key ml-key--auto ${effectiveAutoYes ? 'active' : ''} ${effectiveAutoYes === 'semi' ? 'semi' : ''}`}
                  onPointerDown={e => {
                    e.preventDefault();
                    // 3段階トグル: OFF → 半 ON → 自動 ON → OFF
                    const next = !autoYesMode ? 'semi' : autoYesMode === 'semi' ? 'full' : false;
                    setAutoYesMode(next);
                    localStorage.setItem(autoYesModeKey, next || '');
                    panelRef.current?.setAutoYes(next);
                    panelRef.current?.setClientAutoEnter(!!next);
                  }}
                >
                  {effectiveAutoYes === 'full' ? '自動⏎' : effectiveAutoYes === 'semi' ? '半⏎' : '手動'}
                </button>
                <button className={`ml-key ml-key--enter ${effectiveAutoYes === 'full' ? '' : 'primary'}`} onPointerDown={e => { e.preventDefault(); sendKey('\r'); }}>
                  ⏎ Yes
                </button>
              </>
            )}
          </div>
          {/* テキスト入力行 */}
          <div className="ml-input-row">
            <textarea
              ref={textareaRef}
              className="ml-textarea"
              value={inputText}
              onChange={e => {
                setInputText(e.target.value);
                // textarea 高さ自動伸縮
                const ta = e.target;
                ta.style.height = 'auto';
                ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
              }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendInput(); } }}
              placeholder="コマンド入力..."
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            />
            <label className="ml-send ml-attach-label">
              📎
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
            </label>
            <button className="ml-send primary" onPointerDown={e => { e.preventDefault(); sendInput(); }}>▶</button>
          </div>
        </div>
      )}

      {/* iOSセーフエリア（入力エリアの下） */}
      <div style={{ flexShrink: 0, height: 'env(safe-area-inset-bottom, 0px)', background: accent + '18' }} />

      {/* ドロワー */}
      {showDrawer && (
        <div className="ml-backdrop" onPointerDown={() => setShowDrawer(false)}>
          <div className="ml-drawer" onPointerDown={e => e.stopPropagation()}>
            <div className="ml-drawer-header">
              <span>セッション</span>
              <button className="icon" onPointerDown={() => setShowDrawer(false)}>✕</button>
            </div>
            <div className="ml-drawer-list">
              {sessions.map((s) => {
                const sid = s._id || s.name;
                const isVisible = !mobileActiveSessions || mobileActiveSessions.includes(sid);
                const visIdx = visibleSessions.findIndex(v => (v._id || v.name) === sid);
                return (
                <div
                  key={s.name}
                  className={`ml-drawer-item ${visIdx === activeIdx && isVisible ? 'active' : ''} ${!isVisible ? 'hidden-session' : ''}`}
                  style={{ touchAction: 'manipulation' }}
                  onPointerDown={() => {
                    if (!isVisible) return;
                    setActiveIdx(visIdx >= 0 ? visIdx : 0);
                    setShowDrawer(false);
                  }}
                >
                  {/* 表示/非表示トグル（ステータスdot統合） */}
                  <button
                    className={`ml-drawer-toggle ${isVisible ? 'on' : ''} ${isVisible ? statusClass(s) : ''}`}
                    onPointerDown={e => {
                      e.stopPropagation(); e.preventDefault();
                      const current = mobileActiveSessions || sessions.map(ss => ss._id || ss.name);
                      if (isVisible) {
                        const next = current.filter(n => n !== sid);
                        if (next.length > 0) setMobileActiveSessions(next);
                      } else {
                        setMobileActiveSessions([...current, sid]);
                      }
                    }}
                  />
                  <div className="ml-drawer-info">
                    <div className="ml-drawer-name">{s.name}</div>
                    {s.lastLine && <div className="ml-drawer-last">{s.lastLine}</div>}
                  </div>
                  <div className="ml-drawer-btns" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
                    {(settings.sessionChars?.[s.name] === 'tenma' || (!settings.sessionChars?.[s.name] && !s.isClaude)) ? (
                      <span style={{ fontSize: 11, color: '#a0713a', padding: '0 4px' }}>天馬博士</span>
                    ) : (settings.characters?.length > 1) && (
                      <select
                        className="ml-drawer-char-select"
                        value={settings.sessionChars?.[s.name] || settings.defaultCharId || ''}
                        onChange={e => {
                          const newSessionChars = { ...(settings.sessionChars || {}), [s.name]: e.target.value };
                          onSaveSettings?.({ sessionChars: newSessionChars });
                        }}
                      >
                        {settings.characters.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    )}
                    <button className="icon" style={{ touchAction: 'manipulation' }} onPointerDown={e => { e.stopPropagation(); e.preventDefault(); setRenaming({ name: s.name, _id: s._id }); setShowDrawer(false); }}>✎</button>
                    <button className="icon danger" style={{ touchAction: 'manipulation' }} onPointerDown={e => { e.stopPropagation(); e.preventDefault(); handleKill(s._id || s.name); }}>✕</button>
                  </div>
                </div>
                );
              })}
            </div>
            <div className="ml-drawer-footer">
              <button className="primary" style={{ width: '100%' }} onPointerDown={() => { setShowDrawer(false); setShowNewModal(true); }}>
                ＋ 新規セッション
              </button>
              <button style={{ width: '100%', marginTop: 8 }} onPointerDown={e => { e.preventDefault(); setShowDrawer(false); onOpenSettings?.(); }}>
                ⚙ 設定
              </button>
              <button style={{ width: '100%', marginTop: 8 }} onPointerDown={e => { e.preventDefault(); setShowDrawer(false); onSwitchMode(); }}>
                🖥 PC版に切替
              </button>
              {userName !== 'default' && (
                <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>@{userName}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {showNewModal && <NewSessionModal characters={settings.characters || []} defaultCharId={settings.defaultCharId} onConfirm={handleCreate} onCancel={() => setShowNewModal(false)} />}
      {renaming && <RenameModal currentName={renaming.name} onConfirm={handleRename} onCancel={() => setRenaming(null)} />}
    </div>

    {/* 履歴: document.body に portal → position:fixed 祖先の iOS スクロールバグを回避 */}
    {!!history && createPortal(
      <HistoryView content={history} onClose={() => setHistory(null)} />,
      document.body
    )}
    </>
  );
}
