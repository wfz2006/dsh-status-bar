import { useEffect, useState } from 'react';
import type { Projection } from '@glass/protocol';
import type { SourceState } from '../shared/api';

export function DSHConnection({ projection }: { projection: Projection }) {
  const [source, setSource] = useState<SourceState>({ mode: 'dsh', connection: 'disconnected', endpoint: null, error: null });
  const [url, setURL] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const unsubscribe = window.glass.subscribeSourceState(setSource);
    void window.glass.getSourceState().then(setSource).catch(() => setError('连接状态暂不可用'));
    return unsubscribe;
  }, []);
  let origin = '';
  try { if (source.endpoint) origin = new URL(source.endpoint).origin; } catch { /* Never render an unvalidated authentication URL. */ }
  async function change(action: 'connect' | 'disconnect' | 'mock') {
    if (busy) return;
    const authenticationURL = url.trim();
    if (action === 'connect') setURL('');
    setBusy(true); setError('');
    try {
      if (action === 'connect') await window.glass.connectDSH(authenticationURL);
      else if (action === 'disconnect') await window.glass.disconnectDSH();
      else await window.glass.useMock();
      setSource(await window.glass.getSourceState());
    } catch { setError(action === 'connect' ? '未能连接，请检查官方认证地址及 DSH 是否运行。' : '切换未完成，请重试。'); }
    finally { setBusy(false); }
  }
  const label = source.mode === 'mock' ? 'Mock 演示 · 不会执行审批' : source.connection === 'connected' ? 'DSH 已连接' : source.connection === 'connecting' ? '正在连接 DSH' : 'DSH 未连接';
  return <fieldset className="settings-group source-settings"><legend>DeepSeek Harness</legend>
    <p className="source-notice" role="status"><strong>{label}</strong>{origin && <span className="source-origin">{origin}</span>}</p>
    <form className="source-connect" onSubmit={event => { event.preventDefault(); void change('connect'); }}>
      <label htmlFor="dsh-authentication-url">官方认证地址</label>
      <input id="dsh-authentication-url" type="password" autoComplete="off" spellCheck={false} value={url} disabled={busy}
        onChange={event => setURL(event.target.value)} placeholder="粘贴 DSH 本地认证根地址" aria-describedby="dsh-address-note" />
      <button className="quiet-button" type="submit" disabled={busy || !url.trim()}><span className="control-label">{busy ? '处理中…' : '连接 DSH'}</span></button>
    </form>
    <p className="muted" id="dsh-address-note">使用 DSH 官方提供的本地认证地址；仅本次连接使用，提交后清空，不保存。{source.mode === 'dsh' && source.connection === 'connected' && (projection.stale ? ' · 正在同步会话' : ' · 会话已同步')}</p>
    {(error || source.error) && <p className="source-error" role="alert">{error || source.error}</p>}
    <div className="source-actions">
      <button className="text-button" disabled={busy || source.mode !== 'dsh' || source.connection === 'disconnected'} onClick={() => void change('disconnect')}><span className="control-label">断开连接</span></button>
      <button className="text-button" disabled={busy || source.mode === 'mock'} onClick={() => void change('mock')}><span className="control-label">切换到 Mock 演示</span></button>
    </div>
  </fieldset>;
}
