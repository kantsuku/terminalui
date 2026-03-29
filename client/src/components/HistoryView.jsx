import { useRef, useEffect, useState } from 'react';
import './HistoryView.css';

const CODE_RE = /^(?:\s{4,}|\t)|[{}();=><[\]]{3,}|^\s*(?:import |export |const |let |var |function |class |return |if |for |while |\.|\/\/|#!|<\/?\w)/;
const PATH_RE = /^\s*[\w./-]+\.\w+(?::\d+)?$/;

const CJK_RE = /[\u3000-\u9fff\uac00-\ud7af\uff01-\uff60]/;

function isCodeLine(line) {
  if (!line.trim()) return false;
  if (CJK_RE.test(line)) return false;
  return CODE_RE.test(line) || PATH_RE.test(line.trim());
}

/** 長いブロックかどうか */
const LONG_THRESHOLD = 5;

/**
 * Claude Code のターミナル出力をパースしてブロック分けする
 */
function parseBlocks(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const blocks = [];
  let current = null;

  const flush = () => {
    if (current && current.lines.length > 0) {
      while (current.lines.length && current.lines[current.lines.length - 1].trim() === '') {
        current.lines.pop();
      }
      if (current.lines.length > 0) blocks.push(current);
    }
    current = null;
  };

  for (const line of lines) {
    const trimmed = line.trimStart();

    // ユーザー入力行の検出
    if (/^[>❯]\s/.test(trimmed) || /^\$\s/.test(trimmed)) {
      flush();
      current = { type: 'human', lines: [trimmed.replace(/^[>❯$]\s*/, '')] };
      continue;
    }

    // ツール実行のヘッダー検出（罫線、ツール名）
    // ただしassistant/humanブロック内の装飾罫線はtoolに切り替えない
    const toolMatch = trimmed.match(/^(?:⏺\s*)?(Read|Edit|Update|Write|Bash|Glob|Grep|Search|Agent|Plan)(\(| )/);
    const isToolHeader = !!toolMatch;
    const isBoxBorder = /^[╭╮╰╯┌┐└┘│┃]/.test(trimmed);
    const isDivider = /^[─━]{4,}$/.test(trimmed);
    if (isToolHeader || (isBoxBorder && current?.type !== 'assistant' && current?.type !== 'human') || (isDivider && current?.type !== 'assistant' && current?.type !== 'human')) {
      // 新しいツールヘッダーなら前のブロックをflushして新ブロック開始
      if (isToolHeader) {
        flush();
        const toolName = toolMatch[1];
        // Bash( の後のコマンド部分を抽出
        const cmdMatch = trimmed.match(/^(?:⏺\s*)?(?:Read|Edit|Write|Bash|Glob|Grep|Search|Agent|Plan)\((.+)/);
        const cmdPreview = cmdMatch ? cmdMatch[1].replace(/\)$/, '').trim() : '';
        current = { type: 'tool', toolName, cmdPreview, lines: [] };
      } else {
        if (current?.type !== 'tool') flush();
        if (!current) current = { type: 'tool', lines: [] };
      }
      current.lines.push(line);
      continue;
    }
    // assistant/human内の罫線・テーブルはそのまま含める
    if ((isDivider || isBoxBorder) && (current?.type === 'assistant' || current?.type === 'human')) {
      current.lines.push(line);
      continue;
    }

    // 空行の処理
    if (trimmed === '') {
      if (current) current.lines.push('');
      continue;
    }

    // それ以外はassistant
    if (current?.type !== 'assistant' && current?.type !== 'human') {
      if (current?.type === 'tool') {
        current.lines.push(line);
        continue;
      }
      flush();
      current = { type: 'assistant', lines: [] };
    }
    if (!current) current = { type: 'assistant', lines: [] };
    current.lines.push(line);
  }
  flush();

  // assistant ブロック内のコード部分を分離
  const result = [];
  for (const block of blocks) {
    if (block.type !== 'assistant') {
      result.push(block);
      continue;
    }
    let textLines = [];
    let codeLines = [];
    const flushSub = () => {
      if (textLines.length > 0) {
        result.push({ type: 'assistant', lines: [...textLines] });
        textLines = [];
      }
      if (codeLines.length > 0) {
        result.push({ type: 'code', lines: [...codeLines] });
        codeLines = [];
      }
    };
    for (const line of block.lines) {
      if (isCodeLine(line)) {
        codeLines.push(line);
      } else {
        if (codeLines.length > 0 && codeLines.length < 3) {
          textLines.push(...codeLines);
          codeLines = [];
        } else if (codeLines.length >= 3) {
          flushSub();
        }
        textLines.push(line);
      }
    }
    if (codeLines.length >= 3) {
      if (textLines.length > 0) {
        result.push({ type: 'assistant', lines: textLines });
        textLines = [];
      }
      result.push({ type: 'code', lines: codeLines });
    } else {
      textLines.push(...codeLines);
      if (textLines.length > 0) {
        result.push({ type: 'assistant', lines: textLines });
      }
    }
  }
  return result;
}

/** テキスト内のURLをクリック可能なリンクに変換 */
const URL_SPLIT_RE = /(https?:\/\/[^\s<>"')\]]+)/;

function Linkify({ text }) {
  const parts = text.split(URL_SPLIT_RE);
  return parts.map((part, i) =>
    i % 2 === 1
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="hv-link">{part}</a>
      : part
  );
}

/** 折りたたみ可能なブロック */
function CollapsibleBlock({ type, label, labelClass, lines, defaultOpen, preview: previewProp }) {
  const [open, setOpen] = useState(defaultOpen);
  const lineCount = lines.length;
  const preview = previewProp || lines.find(l => l.trim())?.trim().slice(0, 50) || '';

  return (
    <div className={`hv-block hv-block--${type}`}>
      <div className="hv-collapse-header" onClick={() => setOpen(v => !v)}>
        <span className={`hv-label ${labelClass || ''}`}>{label}</span>
        <span className="hv-collapse-meta">
          {!open && <span className="hv-collapse-preview">{preview}</span>}
          <span className="hv-collapse-count">{lineCount}行</span>
          <span className="hv-collapse-arrow">{open ? '▼' : '▶'}</span>
        </span>
      </div>
      {open && (
        <div className="hv-content">
          <Linkify text={lines.join('\n')} />
        </div>
      )}
    </div>
  );
}

export default function HistoryView({ content, onClose }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content]);

  const blocks = parseBlocks(content);

  return (
    <div className="hv-root">
      <div className="hv-header">
        <span className="hv-title">履歴</span>
        <div className="hv-header-actions">
          <button className="hv-btn" onClick={() => {
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }}>↓ 最下部</button>
          <button className="hv-close" onClick={onClose}>✕</button>
        </div>
      </div>
      <div ref={scrollRef} className="hv-scroll">
        {blocks.length === 0 && (
          <div className="hv-empty">履歴がありません</div>
        )}
        {blocks.map((block, i) => {
          // tool は折りたたみ（日本語を含む内容はデフォルト展開）
          if (block.type === 'tool') {
            const toolLabel = block.toolName || 'Tool';
            const labelCls = block.toolName === 'Bash' ? 'hv-label--bash' : 'hv-label--tool';
            const hasCJK = block.lines.some(l => CJK_RE.test(l));
            return <CollapsibleBlock key={i} type="tool" label={toolLabel} labelClass={labelCls} lines={block.lines} defaultOpen={hasCJK} preview={block.cmdPreview} />;
          }
          if (block.type === 'code') {
            return <CollapsibleBlock key={i} type="code" label="Code" labelClass="hv-label--code" lines={block.lines} defaultOpen={false} />;
          }

          // assistant で長い（5行超）ものも折りたたみ
          if (block.type === 'assistant' && block.lines.length > LONG_THRESHOLD) {
            return <CollapsibleBlock key={i} type="assistant" label="Claude" labelClass="hv-label--assistant" lines={block.lines} defaultOpen={false} />;
          }

          // human / 短い assistant はそのまま表示
          return (
            <div key={i} className={`hv-block hv-block--${block.type}`}>
              {block.type === 'human' && <div className="hv-label">You</div>}
              {block.type === 'assistant' && <div className="hv-label hv-label--assistant">Claude</div>}
              <div className="hv-content">
                <Linkify text={block.lines.join('\n')} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
