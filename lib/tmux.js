const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const TMUX = process.env.TMUX_BIN || '/opt/homebrew/bin/tmux';

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\x1B\x9B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g, '');
}

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
          isClaude: command?.trim() === 'claude',
          lastLine,
        };
      })
    );
    return sessions;
  } catch {
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

async function createSession(name, command) {
  const sessionName = name || `session-${Date.now()}`;
  if (command) {
    // フルパスで実行（tmuxのPATHに依存しない）
    const { stdout: whichOut } = await execAsync(`which ${command} 2>/dev/null || echo ${command}`);
    const fullPath = whichOut.trim();
    await execAsync(`${TMUX} new-session -d -s "${sessionName}" "${fullPath}"`);
  } else {
    await execAsync(`${TMUX} new-session -d -s "${sessionName}"`);
  }
  return sessionName;
}

async function renameSession(oldName, newName) {
  await execAsync(`${TMUX} rename-session -t "${oldName}" "${newName}"`);
}

async function killSession(name) {
  await execAsync(`${TMUX} kill-session -t "${name}"`);
}

async function sessionExists(name) {
  try {
    await execAsync(`${TMUX} has-session -t "${name}" 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

module.exports = { listSessions, createSession, killSession, sessionExists, renameSession };
