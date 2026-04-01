import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { CanvasAddon } from '@xterm/addon-canvas';
import '@xterm/xterm/css/xterm.css';
import './TerminalPanel.css';

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

const BASE_THEME = {
  background:   '#0a0f0d',
  foreground:   '#e6edf3',
  black:        '#0a0f0d',
  red:          '#f85149',
  yellow:       '#ffd700',
  magenta:      '#bc8cff',
  white:        '#e6edf3',
  brightBlack:  '#7a9e8a',
  brightRed:    '#ff7b72',
  brightYellow: '#ffe44d',
  brightMagenta:'#d2a8ff',
  brightWhite:  '#f0f6fc',
};

function makeTheme(accent) {
  const a = accent || '#00d4aa';
  // brightGreen/brightBlue/brightCyan を accent の明るめ版に
  const bright = a + 'cc';
  return {
    ...BASE_THEME,
    cursor:             a,
    selectionBackground: a + '33',
    green:              a,
    blue:               a,
    cyan:               a,
    brightGreen:        bright,
    brightBlue:         bright,
    brightCyan:         bright,
  };
}

const TerminalPanel = forwardRef(function TerminalPanel(
  { sessionName, userName = 'default', mobile = false, active = true, ntfyTopic = '', accentColor = '#00d4aa', onConnStateChange, onActivity, onOutput, onInput, onPromptBlocked },
  ref
) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const wsRef = useRef(null);
  const connectRef = useRef(null);
  const clientAutoEnterRef = useRef(false);
  const clientAutoEnterTimerRef = useRef(null);
  const clientAutoEnterCooldownRef = useRef(false);
  const onOutputRef   = useRef(onOutput);
  const onInputRef    = useRef(onInput);
  const onActivityRef = useRef(onActivity);
  const onPromptBlockedRef = useRef(onPromptBlocked);
  onOutputRef.current   = onOutput;
  onInputRef.current    = onInput;
  onActivityRef.current = onActivity;
  onPromptBlockedRef.current = onPromptBlocked;
  const [connState, setConnState] = useState('disconnected');


  const updateState = useCallback((s) => {
    setConnState(s);
    onConnStateChange?.(s);
  }, [onConnStateChange]);

  const sendJson = useCallback((obj) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
      if (obj.type === 'input') onInputRef.current?.();
    }
  }, []);

  useImperativeHandle(ref, () => ({
    sendInput(data) { sendJson({ type: 'input', data }); },
    sendKey(key)   { sendJson({ type: 'input', data: key }); },
    setAutoYes(mode) { sendJson({ type: 'autoyes', mode }); },
    setClientAutoEnter(enabled) {
      // クライアント側AutoEnterは無効化（サーバー側AutoYESに一本化）
      clientAutoEnterRef.current = false;
    },
    focus() { termRef.current?.focus(); },
    scrollUp() {
      const vp = containerRef.current?.querySelector('.xterm-viewport');
      if (!vp) return;
      vp.scrollTop = Math.max(0, vp.scrollTop - 300);
      vp.dispatchEvent(new Event('scroll'));
    },
    scrollDown() {
      const vp = containerRef.current?.querySelector('.xterm-viewport');
      if (!vp) return;
      vp.scrollTop += 300;
      vp.dispatchEvent(new Event('scroll'));
    },
    copySelection() {
      const term = termRef.current;
      if (!term) return;
      // 選択テキストがあればそれを、なければ画面の表示内容をコピー
      let text = term.getSelection();
      if (!text) {
        const buf = term.buffer.active;
        const lines = [];
        for (let i = 0; i < buf.length; i++) {
          lines.push(buf.getLine(i)?.translateToString(true) ?? '');
        }
        text = lines.join('\n').trimEnd();
      }
      if (!text) return;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
      } else {
        fallbackCopy(text);
      }
    },
    scrollBy(dy) {
      const term = termRef.current;
      if (!term) return;
      const lineHeight = term._core?._renderService?.dimensions?.css?.cell?.height ?? 20;
      const lines = Math.round(dy / lineHeight);
      if (lines !== 0) term.scrollLines(lines);
    },
    fitAddon: () => fitRef.current,
    reconnect() {
      wsRef.current?.close();
      connectRef.current?.();
    },
  }), [sendJson]);

  useEffect(() => {
    if (!sessionName || !containerRef.current) return;

    const term = new Terminal({
      theme: makeTheme(accentColor),
      fontSize: mobile ? 15 : 14,
      fontFamily: '"JetBrains Mono", "Menlo", "Monaco", "Consolas", "Hiragino Kaku Gothic ProN", "Noto Sans JP", monospace',
      lineHeight: 1.2,
      cursorBlink: !mobile,
      disableStdin: mobile,
      scrollback: mobile ? 1000 : 5000,
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = '11';
    try { term.loadAddon(new CanvasAddon()); } catch {}
    fitAddon.fit();
    termRef.current = term;
    fitRef.current = fitAddon;

    // ユーザーが手動スクロールしていなければ自動スクロール
    let scrollLocked = true;
    const vp = containerRef.current.querySelector('.xterm-viewport');
    if (vp) {
      vp.addEventListener('scroll', () => {
        scrollLocked = vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 50;
      });
    }

    let mounted = true;
    let reconnectTimeout = null;
    let initTimer = null;
    let backoff = 2000;

    const connect = () => {
      if (!mounted) return;
      connectRef.current = connect;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      wsRef.current = ws;
      updateState('connecting');

      let isInitializing = true;
      clearTimeout(initTimer);
      // 初期化中（tmux履歴バッファ受信中）はスクロール抑制
      // 1.5秒後に初期化完了とみなし、最下部に1回だけジャンプ
      initTimer = setTimeout(() => {
        isInitializing = false;
        term.scrollToBottom();
      }, 1500);

      ws.onopen = () => {
        backoff = 2000;
        updateState('connected');
        ws.send(JSON.stringify({ type: 'attach', session: sessionName, user: userName, cols: term.cols, rows: term.rows, ntfyTopic }));
      };

      ws.onerror = () => updateState('error');

      ws.onclose = () => {
        wsRef.current = null;
        if (!mounted) return;
        updateState('reconnecting');
        reconnectTimeout = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30000);
      };

      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        switch (msg.type) {
          case 'output': {
            term.write(msg.data, (scrollLocked && !isInitializing) ? () => term.scrollToBottom() : undefined);
            onActivityRef.current?.();
            onOutputRef.current?.(msg.data);
            // クライアント側AutoEnterは無効化（サーバー側AutoYESに一本化）
            break;
          }
          case 'exit':
            clearTimeout(clientAutoEnterTimerRef.current);
            term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n');
            break;
          case 'error':  term.write(`\r\n\x1b[31m[error: ${msg.message}]\x1b[0m\r\n`); break;
          case 'autoyes-blocked':
            term.write(`\r\n\x1b[33m[⚠ 半自動: 要判断 — 手動で応答してください]\x1b[0m\r\n`);
            onPromptBlockedRef.current?.();
            break;
          case 'autoyes-learned':
            term.write(`\r\n\x1b[36m[🧠 学習: "${msg.keyword}" → 次回から自動応答]\x1b[0m\r\n`);
            break;
        }
      };
    };

    if (!mobile) {
      term.onData((data) => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }));
        }
      });
    }

    connect();

    let resizeTimer;
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        try { fitAddon.fit(); } catch {}
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      }, 150);
    });
    ro.observe(containerRef.current);

    // マウスホイールをキャプチャして viewport を手動スクロール
    // xterm がマウスモード中でもエスケープシーケンスを pty に送らないようにする
    const wheelHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const vp = containerRef.current?.querySelector('.xterm-viewport');
      if (vp) {
        vp.scrollTop += e.deltaY;
        vp.dispatchEvent(new Event('scroll'));
      }
    };
    containerRef.current.addEventListener('wheel', wheelHandler, { passive: false, capture: true });

    return () => {
      mounted = false;
      clearTimeout(reconnectTimeout);
      clearTimeout(initTimer);
      clearTimeout(resizeTimer);
      ro.disconnect();
      containerRef.current?.removeEventListener('wheel', wheelHandler, { capture: true });
      wsRef.current?.close();
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionName, userName, mobile, accentColor]);

  const stateColor = {
    connecting:   '#d29922',
    connected:    '#3fb950',
    disconnected: '#8b949e',
    error:        '#f85149',
    reconnecting: '#d29922',
  }[connState] || '#8b949e';

  return (
    <div className="terminal-panel-wrap" style={active ? undefined : { display: 'none' }}>
      {!mobile && (
        <div style={{ position: 'absolute', top: 4, right: 8, fontSize: 11, color: stateColor, zIndex: 10, pointerEvents: 'none' }}>
          ● {connState}
        </div>
      )}
      <div ref={containerRef} className={`terminal-container${mobile ? ' terminal-container--mobile' : ''}`} />
    </div>
  );
});

export default TerminalPanel;
