import { contextBridge, ipcRenderer } from 'electron';
import type { GlassAPI, WindowState, SourceState } from '../shared/api';
import type { Projection } from '@glass/protocol';
import type { DesktopOpticsFrame,DesktopOpticsState,DesktopOpticsBounds } from '../shared/desktop-optics';
const api: GlassAPI = {
  getSourceState: () => ipcRenderer.invoke('glass:source-state'),
  subscribeSourceState: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: SourceState) => callback(value);
    ipcRenderer.on('glass:source-update', listener);
    return () => ipcRenderer.removeListener('glass:source-update', listener);
  },
  connectDSH: url => ipcRenderer.invoke('glass:dsh-connect', url),
  disconnectDSH: () => ipcRenderer.invoke('glass:dsh-disconnect'),
  useMock: () => ipcRenderer.invoke('glass:use-mock'),
  respondApproval: (identity, outcome) => ipcRenderer.invoke('glass:approval-response', identity, outcome),
  respondQuestion: (identity, answers) => ipcRenderer.invoke('glass:question-response', identity, answers),
  getOpticsState:()=>ipcRenderer.invoke('glass:optics-state'),
  setOpticsEnabled:enabled=>ipcRenderer.invoke('glass:optics-enable',enabled),
  subscribeOpticsPosition:callback=>{
    const listener=(_event:Electron.IpcRendererEvent,value:DesktopOpticsBounds)=>callback(value);
    ipcRenderer.on('glass:optics-position',listener);
    return ()=>ipcRenderer.removeListener('glass:optics-position',listener);
  },
  subscribeOpticsState:callback=>{
    const listener=(_event:Electron.IpcRendererEvent,value:DesktopOpticsState)=>callback(value);
    ipcRenderer.on('glass:optics-state',listener);
    return ()=>ipcRenderer.removeListener('glass:optics-state',listener);
  },
  subscribeOpticsFrame:callback=>{
    const listener=(_event:Electron.IpcRendererEvent,value:DesktopOpticsFrame)=>callback(value);
    ipcRenderer.on('glass:optics-frame',listener);
    return ()=>ipcRenderer.removeListener('glass:optics-frame',listener);
  },
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
  moveWindow: position => ipcRenderer.invoke('glass:move', position),
  setSettings: settings => ipcRenderer.invoke('glass:settings', settings),
  selectSession: id => ipcRenderer.invoke('glass:select-session', id),
  copyApproval: identity => ipcRenderer.invoke('glass:copy-approval', identity),
  mockAction: action => ipcRenderer.invoke('glass:mock', action),
};
contextBridge.exposeInMainWorld('glass', api);
