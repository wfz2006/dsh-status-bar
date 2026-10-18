import type { Projection } from '@glass/protocol';
import type { GlassSettings } from '../shared/view-model';
import type { MockAction } from '../shared/api';
import { useEffect,useState } from 'react';
import type { DesktopOpticsState } from '../shared/desktop-optics';
import { Icon } from './icon';
import { DEFAULT_GLASS_APPEARANCE } from '../shared/glass-appearance';
import { DSHConnection } from './dsh-connection';
declare const __GLASS_BUILD__: string;
export function GlassSettingsPanel({ value, update, projection, mock, back }: { value: GlassSettings; update: (patch: Partial<GlassSettings>) => void; projection: Projection; mock: (action: MockAction) => void; back: () => void }) {
  const [optics,setOptics]=useState<DesktopOpticsState>({enabled:false,running:false,error:null});
  useEffect(()=>{void window.glass.getOpticsState().then(setOptics);return window.glass.subscribeOpticsState(setOptics);},[]);
  return <section className="settings-panel">
    <div className="panel-heading"><button className="back-button" aria-label="返回" title="返回" onClick={back}><Icon name="back"/></button><h1>设置</h1></div>
    <div className="settings-scroll">
      <DSHConnection projection={projection}/>
      <fieldset className="settings-group"><legend>外观</legend>
      <label>显示主题<select aria-label="显示主题" value={value.theme} onChange={e => update({ theme: e.target.value as GlassSettings['theme'] })}><option value="auto">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
      <label>玻璃强度<select aria-label="玻璃强度" value={value.strength} onChange={e => update({ strength: e.target.value as GlassSettings['strength'] })}><option value="clear">清透</option><option value="balanced">平衡</option><option value="readable">易读</option></select></label>
      <label>玻璃主题<select aria-label="玻璃主题" value={value.material} onChange={e => update({ material: e.target.value as GlassSettings['material'] })}><option value="system">推荐薄透</option><option value="transparent">纯透明</option><option value="frosted">磨砂玻璃</option><option value="solid">稳定实色</option></select></label>
      <label>玻璃底色<span className="tint-choice"><input aria-label="玻璃底色" type="color" value={value.tintColor} disabled={value.material==='solid'} onChange={e=>update({tintColor:e.target.value})}/><output>{value.tintColor.toUpperCase()}</output></span></label>
      <label htmlFor="glass-tint-opacity">底色浓度<span className="appearance-slider"><input id="glass-tint-opacity" aria-label="底色浓度" type="range" min="0" max="100" step="1" value={value.tintOpacity} disabled={value.material==='solid'} onChange={e=>update({tintOpacity:Number(e.target.value)})}/><output htmlFor="glass-tint-opacity">{value.tintOpacity}%</output></span></label>
      <label htmlFor="glass-brightness">玻璃亮度<span className="appearance-slider"><input id="glass-brightness" aria-label="玻璃亮度" aria-describedby="glass-appearance-note" type="range" min="50" max="150" step="1" value={value.brightness} disabled={!optics.enabled || value.material==='solid'} onChange={e=>update({brightness:Number(e.target.value)})}/><output htmlFor="glass-brightness">{value.brightness}%</output></span></label>
      <div className="appearance-footer"><p className="muted" id="glass-appearance-note">{value.material==='solid'?'实色模式下保留调色设置，切回透明后生效。':!optics.enabled?'开启下方真实折射后可调亮度；底色可直接调整。':'仅调整玻璃背景，文字与亮边保持清晰。'}</p><button className="text-button appearance-reset" onClick={()=>update({...DEFAULT_GLASS_APPEARANCE})} disabled={value.tintColor===DEFAULT_GLASS_APPEARANCE.tintColor && value.tintOpacity===DEFAULT_GLASS_APPEARANCE.tintOpacity && value.brightness===DEFAULT_GLASS_APPEARANCE.brightness}><span className="control-label">恢复默认</span></button></div>
      <label>真实折射与色散<input aria-label="真实折射与色散" type="checkbox" checked={optics.enabled} onChange={e=>{void window.glass.setOpticsEnabled(e.target.checked).then(setOptics).catch(()=>setOptics({enabled:false,running:false,error:'未能开启折射'}));}} /></label>
      <p className="muted">仅取样本框后方及少量边距，不保存、不上传。关闭或隐藏即停；启动默认开启。{optics.error ?? (optics.running?' · 已开启':'')}</p>
      </fieldset>
      <fieldset className="settings-group"><legend>行为</legend>
      <label>默认形态<select aria-label="默认形态" value={value.defaultView} onChange={e => update({ defaultView: e.target.value as GlassSettings['defaultView'] })}><option value="capsule">胶囊</option><option value="peek">速览</option><option value="remember-last">记住上次</option></select></label>
      <label>审批时自动展开<input aria-label="审批时自动展开" type="checkbox" checked={value.autoApproval} onChange={e => update({ autoApproval: e.target.checked })} /></label>
      <label>提示音<input aria-label="提示音" type="checkbox" checked={value.sound} onChange={e => update({ sound: e.target.checked })} /></label>
      <label>完成后自动收起<input aria-label="完成后自动收起" type="checkbox" checked={value.autoCollapse} onChange={e => update({ autoCollapse: e.target.checked })} /></label>
      <label>动画<select aria-label="动画" value={value.animation} onChange={e => update({ animation: e.target.value as GlassSettings['animation'] })}><option value="full">完整</option><option value="reduced">减少</option><option value="off">关闭</option></select></label>
      <label>置顶行为<select aria-label="置顶行为" value={value.pin} onChange={e => update({ pin: e.target.value as GlassSettings['pin'] })}><option value="normal">普通</option><option value="always">始终置顶</option><option value="on-notification">有待处理请求时</option></select></label>
      </fieldset>
      <details className="debug-settings"><summary><span>材质降级与调试</span><Icon name="chevron"/></summary>
        <p className="muted">旧 Acrylic 对照会露出方形底角，已停用；旧选择自动回到薄透。磨砂玻璃在真实折射开启时模糊取样画面，关闭时退回半透明白雾。</p>
        <p className="muted">连接状态：{projection.connection}{projection.stale ? ' · 旧数据' : ''}</p>
        <div className="debug-actions"><button disabled={projection.source!=='mock'} onClick={() => mock('restart')}><span className="control-label">重播演示</span></button><button disabled={projection.source!=='mock'} onClick={() => mock(projection.connection === 'connected' ? 'disconnect' : 'reconnect')}><span className="control-label">{projection.connection === 'connected' ? '模拟断线' : '重新连接'}</span></button><button disabled={projection.source!=='mock'} onClick={() => mock('out-of-order')}><span className="control-label">模拟乱序</span></button></div>
      </details>
      <p className="muted build-stamp">构建 {new Date(__GLASS_BUILD__).toLocaleString('zh-CN', { hour12: false })}</p>
    </div>
  </section>;
}
