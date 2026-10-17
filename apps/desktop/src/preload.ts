import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lumina', {
  command: (command: unknown) => ipcRenderer.invoke('lumina:command', command),
  pickFolder: () => ipcRenderer.invoke('lumina:pick-folder') as Promise<string | null>,
});
