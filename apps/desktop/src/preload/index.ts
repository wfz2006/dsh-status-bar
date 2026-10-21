import { contextBridge, ipcRenderer } from 'electron';
import type { GlassAPI, WindowState, SourceState } from '../shared/api';
import type { Projection } from '@glass/protocol';
import type { DesktopOpticsFrame,DesktopOpticsState,DesktopOpticsBounds } from '../shared/desktop-optics';
import { ProjectionReceiver, type ProjectionMessage } from '../shared/projection-channel';
const receiver = new ProjectionReceiver();
const subscribers = new Set<(projection: Projection) => void>();
let syncing: Promise<Projection> | undefined;
let missingRevision = 0;
function notify(projection: Projection) { for (const callback of subscribers) callback(projection); }
function requestState(): Promise<Projection> {
  if (syncing) return syncing;
  syncing = ipcRenderer.invoke('glass:state').then((message: ProjectionMessage) => {
    const result = receiver.accept(message); if (result.state) notify(result.state);
    if (receiver.version >= missingRevision) missingRevision = 0;
    if (!receiver.current) throw new Error('Projection baseline unavailable');
    return receiver.current;
  }).catch(error => { missingRevision = 0; throw error; }).finally(() => {
    syncing = undefined;
    if (missingRevision) queueMicrotask(() => { void requestState().catch(() => {}); });
  });
  return syncing;
}
ipcRenderer.on('glass:update', (_event, value: ProjectionMessage | Projection) => {
  // Full projections remain accepted for the isolated fixture/older producers.
  if ('connection' in value) { notify(value); return; }
  const result = receiver.accept(value);
  if (result.needsSync) {
    if (receiver.current) notify({ ...receiver.current, stale: true,
      approvals: receiver.current.approvals.map(request => ({ ...request, actionable: false })),
      questions: receiver.current.questions.map(request => ({ ...request, actionable: false })) });
    missingRevision = Math.max(missingRevision, value.revision); void requestState().catch(() => {});
  }
  else if (result.state) notify(result.state);
});
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
    // A static desktop may emit only one frame. Subscribe before asking for
    // a fresh snapshot so late mounts/theme changes cannot miss that image.
    void ipcRenderer.invoke('glass:optics-refresh').catch(()=>{});
    return ()=>ipcRenderer.removeListener('glass:optics-frame',listener);
  },
  getState: requestState,
  getWindowState: () => ipcRenderer.invoke('glass:window-state'),
  subscribeWindow: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: WindowState) => callback(value);
    ipcRenderer.on('glass:window-update', listener);
    return () => ipcRenderer.removeListener('glass:window-update', listener);
  },
  subscribe: callback => {
    subscribers.add(callback);
    return () => { subscribers.delete(callback); };
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
