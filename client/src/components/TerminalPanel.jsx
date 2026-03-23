import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
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

const TERM_THEME = {
  background:   '#0a0f0d',
  foreground:   '#e6edf3',
  cursor:       '#00d4aa',
  selectionBackground: '#0a3d2a',
  black:        '#0a0f0d',
  red:          '#f85149',
  green:        '#00d4aa',
  yellow:       '#ffd700',
  blue:         '#00d4aa',
  magenta:      '#bc8cff',
  cyan:         '#00d4aa',
  white:        '#e6edf3',
  brightBlack:  '#7a9e8a',
  brightRed:    '#ff7b72',
  brightGreen:  '#00ffcc',
  brightYellow: '#ffe44d',
  brightBlue:   '#4dffd4',
  brightMagenta:'#d2a8ff',
  brightCyan:   '#4dffd4',
  brightWhite:  '#f0f6fc',
};

const TerminalPanel = forwardRef(function TerminalPanel(
  { sessionName, mobile = false, active = true, onConnStateChange, onActivity, onOutput, onInput },
  ref
) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const wsRef = useRef(null);
  const connectRef = useRef(null);
  const clientAutoEnterRef = useRef(false);
  const onOutputRef   = useRef(onOutput);
  const onInputRef    = useRef(onInput);
  const onActivityRef = useRef(onActivity);
  onOutputRef.current   = onOutput;
  onInputRef.current    = onInput;
  onActivityRef.current = onActivity;
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
    setAutoYes(enabled) { sendJson({ type: 'autoyes', enabled }); },
    setClientAutoEnter(enabled) { clientAutoEnterRef.current = enabled; },
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
    if (!sessionName || !containerRef.current || !active) return;

    const term = new Terminal({
      theme: TERM_THEME,
      fontSize: mobile ? 13 : 12,
      fontFamily: '"JetBrains Mono", "Menlo", "Monaco", "Consolas", monospace',
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

    const connect = () => {
      if (!mounted) return;
      connectRef.current = connect;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      wsRef.current = ws;
      updateState('connecting');

      ws.onopen = () => {
        updateState('connected');
        ws.send(JSON.stringify({ type: 'attach', session: sessionName, cols: term.cols, rows: term.rows }));
      };

      ws.onerror = () => updateState('error');

      ws.onclose = () => {
        wsRef.current = null;
        if (!mounted) return;
        updateState('reconnecting');
        reconnectTimeout = setTimeout(connect, 2000);
      };

      let clientAutoEnterTimer = null;
      let clientAutoEnterCooldown = false;
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        switch (msg.type) {
          case 'output': {
            term.write(msg.data, scrollLocked ? () => term.scrollToBottom() : undefined);
            onActivityRef.current?.();
            onOutputRef.current?.(msg.data);
            if (clientAutoEnterRef.current && !clientAutoEnterCooldown) {
              clearTimeout(clientAutoEnterTimer);
              clientAutoEnterTimer = setTimeout(() => {
                if (clientAutoEnterRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: 'input', data: '\r' }));
                  clientAutoEnterCooldown = true;
                  setTimeout(() => { clientAutoEnterCooldown = false; }, 8000);
                }
              }, 2000);
            }
            break;
          }
          case 'exit':
            clearTimeout(clientAutoEnterTimer);
            term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n');
            break;
          case 'error':  term.write(`\r\n\x1b[31m[error: ${msg.message}]\x1b[0m\r\n`); break;
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

    const ro = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
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
      ro.disconnect();
      containerRef.current?.removeEventListener('wheel', wheelHandler, { capture: true });
      wsRef.current?.close();
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionName, mobile, active]);

  const stateColor = {
    connecting:   '#d29922',
    connected:    '#3fb950',
    disconnected: '#8b949e',
    error:        '#f85149',
    reconnecting: '#d29922',
  }[connState] || '#8b949e';

  return (
    <div className="terminal-panel-wrap">
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
