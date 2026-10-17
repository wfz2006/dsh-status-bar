import type { Projection } from '@glass/protocol';
import type { GlassSettings } from '../shared/view-model';
import type { MockAction } from '../shared/api';
export function GlassSettingsPanel({ value, update, projection, mock, back }: { value: GlassSettings; update: (patch: Partial<GlassSettings>) => void; projection: Projection; mock: (action: MockAction) => void; back: () => void }) {
  return <section className="settings-panel">
    <div className="panel-heading"><h1>设置</h1><button className="quiet-button" onClick={back}>返回</button></div>
    <div className="settings-scroll">
      <p className="source-notice">数据源：<strong>{projection.source === 'dsh' ? 'DSH' : 'Mock 演示'}</strong><br />当前未接入真实 DSH，演示审批不能提交。</p>
      <label>显示主题<select aria-label="显示主题" value={value.theme} onChange={e => update({ theme: e.target.value as GlassSettings['theme'] })}><option value="auto">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
      <label>玻璃强度<select aria-label="玻璃强度" value={value.strength} onChange={e => update({ strength: e.target.value as GlassSettings['strength'] })}><option value="clear">清透</option><option value="balanced">平衡</option><option value="readable">易读</option></select></label>
      <label>默认形态<select aria-label="默认形态" value={value.defaultView} onChange={e => update({ defaultView: e.target.value as GlassSettings['defaultView'] })}><option value="capsule">胶囊</option><option value="peek">速览</option><option value="remember-last">记住上次</option></select></label>
      <label>审批时自动展开<input aria-label="审批时自动展开" type="checkbox" checked={value.autoApproval} onChange={e => update({ autoApproval: e.target.checked })} /></label>
      <label>完成后自动收起<input aria-label="完成后自动收起" type="checkbox" checked={value.autoCollapse} onChange={e => update({ autoCollapse: e.target.checked })} /></label>
      <label>动画<select aria-label="动画" value={value.animation} onChange={e => update({ animation: e.target.value as GlassSettings['animation'] })}><option value="full">完整</option><option value="reduced">减少</option><option value="off">关闭</option></select></label>
      <label>置顶行为<select aria-label="置顶行为" value={value.pin} onChange={e => update({ pin: e.target.value as GlassSettings['pin'] })}><option value="normal">普通</option><option value="always">始终置顶</option><option value="on-notification">有待处理请求时</option></select></label>
      <details className="debug-settings"><summary>材质降级与调试</summary>
        <label>窗口材质<select aria-label="系统材质" value={value.material} onChange={e => update({ material: e.target.value as GlassSettings['material'] })}><option value="system">推荐薄透</option><option value="transparent">纯透明</option><option value="acrylic">Acrylic 对照</option><option value="solid">稳定实色</option></select></label>
        <p className="muted">连接状态：{projection.connection}{projection.stale ? ' · 旧数据' : ''}</p>
        <div className="debug-actions"><button onClick={() => mock('restart')}>重播演示</button><button onClick={() => mock(projection.connection === 'connected' ? 'disconnect' : 'reconnect')}>{projection.connection === 'connected' ? '模拟断线' : '重新连接'}</button><button onClick={() => mock('out-of-order')}>模拟乱序</button></div>
      </details>
    </div>
  </section>;
}
