const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const TMUX = process.env.TMUX_BIN || '/opt/homebrew/bin/tmux';
const TERMINAL_UI_DIR = path.resolve(__dirname, '..');
// Claude Code セッションの起動ディレクトリ（デフォルト: ホームディレクトリ）
// terminal-ui の CLAUDE.md が読み込まれるとキャラ設定が上書きされるため
const CLAUDE_START_DIR = process.env.CLAUDE_START_DIR || process.env.HOME || TERMINAL_UI_DIR;

const { stripAnsi } = require('./stripAnsi');

async function listSessions() {
  try {
    const { stdout } = await execAsync(
      `${TMUX} list-sessions -F "#{session_name}|#{session_windows}|#{session_attached}|#{session_activity}|#{pane_current_command}"`
    );

    const lines = stdout.trim().split('\n').filter(Boolean);
    const sessions = await Promise.all(
      lines.map(async (line) => {
        const [name, windows, attached, activity, command] = line.split('|');
        const lastLine = await getLastLine(name);
        return {
          name,
          windows: parseInt(windows, 10),
          attached: parseInt(attached, 10) > 0,
          activity: new Date(parseInt(activity, 10) * 1000).toISOString(),
          status: parseInt(attached, 10) > 0 ? 'active' : 'idle',
          isClaude: !['zsh', 'bash', 'sh', 'fish', 'csh', 'tcsh', 'dash'].includes(command?.trim()),
          lastLine,
        };
      })
    );
    return sessions;
  } catch (e) {
    console.warn('[tmux] list error:', e.message);
    return [];
  }
}

async function getLastLine(sessionName) {
  try {
    const { stdout } = await execAsync(
      `${TMUX} capture-pane -t "${sessionName}" -p 2>/dev/null`
    );
    const lines = stdout.split('\n').map(l => stripAnsi(l).trim()).filter(Boolean);
    return lines[lines.length - 1] || '';
  } catch {
    return '';
  }
}

async function createSession(name, command, systemPrompt) {
  const sessionName = name || `session-${Date.now()}`;
  if (command) {
    // フルパスで実行（tmuxのPATHに依存しない）
    // サーバーの PATH に ~/.local/bin などを補完してフルパスを解決
    const { stdout: whichOut } = await execAsync(
      `PATH="$PATH:$HOME/.local/bin:$HOME/.npm/bin:/usr/local/bin" which ${command} 2>/dev/null || echo ${command}`
    );
    const fullPath = whichOut.trim();
    // execFile でシェルを挟まず直接引数を渡す（sh -c 経由だと claude が即終了するため）
    const args = ['new-session', '-d', '-s', sessionName, '-c', CLAUDE_START_DIR, '--', fullPath];
    if (systemPrompt) args.push('--append-system-prompt', systemPrompt);
    await execFileAsync(TMUX, args);
  } else {
    await execFileAsync(TMUX, ['new-session', '-d', '-s', sessionName]);
  }
  // ステータスバーを非表示
  await execFileAsync(TMUX, ['set-option', '-t', sessionName, 'status', 'off']).catch((e) => { console.warn('[tmux] status-off error:', e.message); });
  return sessionName;
}

async function renameSession(oldName, newName) {
  await execFileAsync(TMUX, ['rename-session', '-t', oldName, newName]);
}

async function killSession(name) {
  await execFileAsync(TMUX, ['kill-session', '-t', name]);
}

async function sessionExists(name) {
  try {
    await execFileAsync(TMUX, ['has-session', '-t', name]);
    return true;
  } catch {
    return false;
  }
}

module.exports = { listSessions, createSession, killSession, sessionExists, renameSession };
