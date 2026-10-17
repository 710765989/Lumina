import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void };
let core: ChildProcessWithoutNullStreams | undefined;
const pending: Pending[] = [];
const mainDirectory = path.dirname(fileURLToPath(import.meta.url));
function writeLog(message: string): void {
  try { appendFileSync(path.join(app.getPath('userData'), 'lumina-main.log'), `${new Date().toISOString()} ${message}\n`); } catch { /* diagnostics must not stop the app */ }
}

function startCoreHost(): void {
  if (core) return;
  const workspace = path.resolve(app.getAppPath(), '..', '..');
  const packaged = app.isPackaged;
  const command = packaged ? process.execPath : (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
  const args = packaged ? [path.join(app.getAppPath(), 'dist', 'core-host.cjs'), '--stdio'] : ['--filter', '@lumina/core-host', 'start:stdio'];
  writeLog(`start core packaged=${packaged} command=${command} args=${JSON.stringify(args)}`);
  core = spawn(command, args, {
    cwd: packaged ? path.dirname(process.execPath) : workspace,
    env: { ...process.env, ...(packaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}), LUMINA_DB_PATH: path.join(app.getPath('userData'), 'data', 'lumina.db') },
    windowsHide: true,
  });
  core.stderr.on('data', (chunk) => writeLog(`core stderr: ${String(chunk).trim()}`));
  core.on('error', (error) => writeLog(`core error: ${error.message}`));
  const lines = createInterface({ input: core.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    const item = pending.shift();
    if (!item) return;
    try {
      const response = JSON.parse(line) as { ok: boolean; data?: unknown; error?: string };
      if (response.ok) item.resolve(response.data);
      else item.reject(new Error(response.error ?? 'Core command failed'));
    } catch (error) { item.reject(error instanceof Error ? error : new Error(String(error))); }
  });
  core.on('exit', (code, signal) => {
    writeLog(`core exit code=${code} signal=${signal ?? ''}`);
    const error = new Error('Lumina core host exited');
    while (pending.length) pending.shift()!.reject(error);
    core = undefined;
  });
}

function sendCommand(command: unknown): Promise<unknown> {
  startCoreHost();
  return new Promise((resolve, reject) => { pending.push({ resolve, reject }); core!.stdin.write(`${JSON.stringify(command)}\n`); });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200, height: 800, minWidth: 960, minHeight: 640, backgroundColor: '#f6f8fc',
    webPreferences: { preload: path.join(mainDirectory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  window.webContents.on('console-message', (_event, _level, message, line, source) => writeLog(`renderer ${source}:${line} ${message}`));
  window.webContents.on('did-finish-load', () => writeLog('renderer did-finish-load'));
  window.webContents.on('dom-ready', () => writeLog('renderer dom-ready'));
  window.webContents.on('did-fail-load', (_event, code, description, url) => writeLog(`renderer did-fail-load code=${code} description=${description} url=${url}`));
  if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL).catch((error) => writeLog(`loadURL failed: ${error instanceof Error ? error.message : String(error)}`));
  else void window.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html')).catch((error) => writeLog(`loadFile failed: ${error instanceof Error ? error.message : String(error)}`));
}

app.whenReady().then(() => {
  writeLog('app ready');
  mkdirSync(path.join(app.getPath('userData'), 'data'), { recursive: true });
  ipcMain.handle('lumina:command', (_event, command: unknown) => { writeLog(`ipc command ${JSON.stringify(command)}`); return sendCommand(command); });
  ipcMain.handle('lumina:pick-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  try { createWindow(); } catch (error) { writeLog(`createWindow failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => core?.kill());
