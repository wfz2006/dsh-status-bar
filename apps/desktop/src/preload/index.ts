import { contextBridge, ipcRenderer } from 'electron';
import type { GlassAPI, WindowState } from '../shared/api';
import type { Projection } from '@glass/protocol';
const api: GlassAPI = {
  getState: () => ipcRenderer.invoke('glass:state'),
  getWindowState: () => ipcRenderer.invoke('glass:window-state'),
  subscribeWindow: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: WindowState) => callback(value);
    ipcRenderer.on('glass:window-update', listener);
    return () => ipcRenderer.removeListener('glass:window-update', listener);
  },
  subscribe: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: Projection) => callback(value);
    ipcRenderer.on('glass:update', listener);
    return () => ipcRenderer.removeListener('glass:update', listener);
  },
  windowAction: (action, reduceMotion) => ipcRenderer.invoke('glass:window', action, reduceMotion),
  resizeWindow: bounds => ipcRenderer.invoke('glass:resize', bounds),
  mockAction: action => ipcRenderer.invoke('glass:mock', action),
};
contextBridge.exposeInMainWorld('glass', api);
