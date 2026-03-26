import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import TerminalPanel from './TerminalPanel';
import NewSessionModal from './NewSessionModal';
import RenameModal from './RenameModal';
import { getCharForSession } from '../hooks/useSettings';
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
  const [showNewModal, setShowNewModal] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [inputText, setInputText] = useState('');
  const [connState, setConnState] = useState('disconnected');
  const autoEnterKey = `termui-auto-enter-v2-${userName}`;
  const [autoEnter, setAutoEnter] = useState(() => {
    const stored = localStorage.getItem(`termui-auto-enter-v2-${userName}`);
    return stored === null ? false : stored === 'true';
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

  const activeSession = sessions[activeIdx] || null;
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
  const effectiveAutoEnter = activeSession?.isClaude ? autoEnter : false;

  // 接続完了時に autoEnter 状態をサーバー＆クライアントへ再送
  useEffect(() => {
    if (connState === 'connected') {
      panelRef.current?.setAutoYes(effectiveAutoEnter);
      panelRef.current?.setClientAutoEnter(effectiveAutoEnter);
    }
  }, [connState, effectiveAutoEnter]);

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
        alert(`セッション作成に失敗: ${res?.error || '不明なエラー'}`);
      }
    } catch (e) {
      alert(`セッション作成エラー: ${e.message}`);
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
    await renameSession(id, newName);
    setRenaming(null);
    // sessionChars のキーも更新
    if (settings.sessionChars?.[oldName]) {
      const updated = { ...settings.sessionChars, [newName]: settings.sessionChars[oldName] };
      delete updated[oldName];
      onSaveSettings?.({ sessionChars: updated });
    }
  }, [renaming, renameSession, settings.sessionChars, onSaveSettings]);

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
      panelRef.current?.scrollBy(-delta);
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
          {sessions.map((s, i) => {
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
      <div className={`ml-statusbar ml-statusbar--${statusInfo.cls}`}>
        <span>● {statusInfo.label}</span>
        <span className="ml-statusbar-right">
          {connState !== 'connected' && (
            <button className="ml-reconnect-btn" onPointerDown={e => { e.preventDefault(); panelRef.current?.reconnect(); }}>
              再接続
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
                  className={`ml-key ml-key--auto ${effectiveAutoEnter ? 'active' : ''}`}
                  onPointerDown={e => {
                    e.preventDefault();
                    const next = !autoEnter;
                    setAutoEnter(next);
                    localStorage.setItem(autoEnterKey, next);
                    panelRef.current?.setAutoYes(next);
                    panelRef.current?.setClientAutoEnter(next);
                  }}
                >
                  {effectiveAutoEnter ? '自動 ON' : '自動 OFF'}
                </button>
                <button className={`ml-key ml-key--enter ${effectiveAutoEnter ? '' : 'primary'}`} onPointerDown={e => { e.preventDefault(); sendKey('\r'); }}>
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
              onChange={e => setInputText(e.target.value)}
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
              {sessions.map((s, i) => (
                <div
                  key={s.name}
                  className={`ml-drawer-item ${i === activeIdx ? 'active' : ''}`}
                  style={{ touchAction: 'manipulation' }}
                  onPointerDown={() => { setActiveIdx(i); setShowDrawer(false); }}
                >
                  <span className={`dot ${statusClass(s)}`} />
                  <div className="ml-drawer-info">
                    <div className="ml-drawer-name">{s.name}</div>
                    {s.lastLine && <div className="ml-drawer-last">{s.lastLine}</div>}
                  </div>
                  <div className="ml-drawer-btns" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
                    {/* Shell = 天馬博士固定、Claude = キャラ選択可 */}
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
              ))}
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
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, background: '#0d1117', display: 'flex', flexDirection: 'column' }}>
        <div style={{ paddingTop: 'env(safe-area-inset-top, 0px)', minHeight: 'calc(52px + env(safe-area-inset-top, 0px))', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: 'env(safe-area-inset-top, 0px) 16px 10px', borderBottom: '1px solid #30363d' }}>
          <span style={{ color: '#e6edf3', fontWeight: 700, fontSize: 14 }}>履歴</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button style={{ background: '#21262d', border: '1px solid #30363d', borderRadius: 8, color: '#e6edf3', fontSize: 12, padding: '6px 14px', cursor: 'pointer' }} onClick={() => { if (historyScrollRef.current) historyScrollRef.current.scrollTop = historyScrollRef.current.scrollHeight; }}>↓ 最下部</button>
            <button style={{ background: 'transparent', border: 'none', color: '#e6edf3', fontSize: 22, padding: '4px 4px', cursor: 'pointer', lineHeight: 1 }} onClick={() => setHistory(null)}>✕</button>
          </div>
        </div>
        <div ref={historyScrollRef} style={{ height: 'calc(var(--vvh, 100dvh) - 44px - env(safe-area-inset-top, 0px))', overflowY: 'scroll', WebkitOverflowScrolling: 'touch' }}>
          <pre style={{ margin: 0, padding: '12px', color: '#e6edf3', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowX: 'hidden' }}>
            {history}
          </pre>
        </div>
      </div>,
      document.body
    )}
    </>
  );
}
