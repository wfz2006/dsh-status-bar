import { useEffect, useRef, useState } from 'react';
import type { Projection } from '@glass/protocol';
import type { SourceState } from '../shared/api';

export function DSHConnection({ projection, focusAddress = 0 }: { projection: Projection; focusAddress?: number }) {
  const [source, setSource] = useState<SourceState>({ mode: 'dsh', connection: 'disconnected', endpoint: null, error: null });
  const [url, setURL] = useState('');
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'mock' | null>(null);
  const [error, setError] = useState('');
  const operation = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focusAddress) input.current?.focus(); }, [focusAddress]);
  useEffect(() => {
    let received = false;
    let mounted = true;
    const unsubscribe = window.glass.subscribeSourceState(value => { received = true; setSource(value); });
    void window.glass.getSourceState().then(value => { if (mounted && !received) setSource(value); })
      .catch(() => { if (mounted && !received) setError('连接状态暂不可用'); });
    return () => { mounted = false; operation.current++; unsubscribe(); };
  }, []);
  let origin = '';
  try { if (source.endpoint) origin = new URL(source.endpoint).origin; } catch { /* Never render an unvalidated authentication URL. */ }
  async function change(action: 'connect' | 'disconnect' | 'mock') {
    if (busy && (busy !== 'connect' || action === 'connect')) return;
    const attempt = ++operation.current;
    const authenticationURL = url.trim();
    if (action === 'connect') setURL('');
    setBusy(action); setError('');
    try {
      if (action === 'connect') await window.glass.connectDSH(authenticationURL);
      else if (action === 'disconnect') await window.glass.disconnectDSH();
      else await window.glass.useMock();
    } catch (failure) {
      if (attempt !== operation.current) return;
      const message = action === 'connect' && failure instanceof Error
        ? failure.message.replace(/^Error invoking remote method 'glass:dsh-connect': (?:Error: )?/, '') : '';
      setError(message || (action === 'connect' ? '未能连接，请检查官方认证地址及 DSH 是否运行。' : '切换未完成，请重试。'));
    } finally { if (attempt === operation.current) setBusy(null); }
  }
  const connecting = busy === 'connect' || source.connection === 'connecting';
  const label = source.mode === 'mock' ? 'Mock 演示 · 不会执行审批' : source.connection === 'connected' ? 'DSH 已连接' : source.connection === 'connecting' ? '正在连接 DSH' : 'DSH 未连接';
  return <fieldset className="settings-group source-settings"><legend>DeepSeek Harness</legend>
    <p className="source-notice" role="status" data-connection={source.connection} data-source={source.mode}>
      <strong>{label}</strong>{origin && <span className="source-origin">{origin}</span>}
    </p>
    <form className="source-connect" onSubmit={event => { event.preventDefault(); void change('connect'); }}>
      <label htmlFor="dsh-authentication-url">官方认证地址</label>
      <input ref={input} id="dsh-authentication-url" type="password" autoComplete="off" spellCheck={false} value={url} disabled={!!busy || connecting}
        onChange={event => setURL(event.target.value)} placeholder="粘贴 DSH 本地认证根地址" aria-describedby="dsh-address-note" />
      <button className="quiet-button" type="submit" disabled={!!busy || connecting || !url.trim()}><span className="control-label">{connecting ? '正在连接…' : '连接 DSH'}</span></button>
    </form>
    <p className="muted" id="dsh-address-note">使用 DSH 官方提供的本地认证地址；仅本次连接使用，提交后清空，不保存。{source.mode === 'dsh' && source.connection === 'connected' && (projection.stale ? ' · 正在同步会话' : ' · 会话已同步')}</p>
    {(error || source.error) && <p className="source-error" role="alert">{error || source.error}</p>}
    <div className="source-actions">
      <button className="text-button" disabled={busy === 'disconnect' || busy === 'mock' || !connecting && (source.mode !== 'dsh' || source.connection === 'disconnected')} onClick={() => void change('disconnect')}><span className="control-label">{connecting ? '取消连接' : '断开连接'}</span></button>
      <button className="text-button" disabled={busy === 'disconnect' || busy === 'mock' || source.mode === 'mock' && !connecting} onClick={() => void change('mock')}><span className="control-label">切换到 Mock 演示</span></button>
    </div>
  </fieldset>;
}
