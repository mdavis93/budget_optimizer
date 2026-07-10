#!/usr/bin/env node
/**
 * Launch a child process with ELECTRON_RUN_AS_NODE stripped.
 *
 * Electron-based editors (Cursor, VS Code) export ELECTRON_RUN_AS_NODE=1 for
 * their own Node subprocesses. If inherited, our Electron binary boots as plain
 * Node — require('electron') returns a path string, app.whenReady() crashes,
 * and the UI stays blank.
 */
const { spawn } = require('child_process');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/electron-launch-env.cjs <command> [args...]');
  process.exit(1);
}

const child = spawn(command, args, {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
