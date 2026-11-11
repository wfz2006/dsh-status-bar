import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Projection } from '@glass/protocol';
import { CAPSULE_MOTIONS, COMPLETION_FEEDBACK_MS, type CapsuleMotion, type GlassSettings } from '../shared/view-model';
import type { MockAction } from '../shared/api';
import type { DesktopOpticsState } from '../shared/desktop-optics';
import { DEFAULT_GLASS_APPEARANCE } from '../shared/glass-appearance';
import { WHALE_SKINS } from '../shared/whale-skins';
import { CHIME_PRESETS } from '../shared/sound';
import { Icon, type IconName } from './icon';
import { DSHConnection } from './dsh-connection';
import { TaskCapsule, type Task } from './task-views';
import { WhaleArt } from './whale-companion';
import { playChime } from './sound';

declare const __GLASS_BUILD__: string;
type Update = (patch: Partial<GlassSettings>) => void;
type SettingsProps = { value: GlassSettings; update: Update };

const pages = [
  { id: 'appearance', name: '外观', icon: 'image' },
  { id: 'motion', name: '动效', icon: 'whale' },
  { id: 'window', name: '窗口', icon: 'list' },
  { id: 'connection', name: '连接', icon: 'globe' },
] as const satisfies readonly { id: string; name: string; icon: IconName }[];
type SettingsPage = typeof pages[number]['id'];

function SettingSelect<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (value: T) => void; options: readonly (readonly [T, string])[];
}) {
  return <label className="settings-row">{label}<select aria-label={label} value={value} onChange={event => onChange(event.target.value as T)}>
    {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
  </select></label>;
}

function SettingToggle({ label, detail, checked, onChange }: {
  label: string; detail?: string; checked: boolean; onChange: (checked: boolean) => void;
}) {
  const description = useId();
  return <label className="settings-row">
    <span>{label}{detail && <small id={description} className="settings-row-detail">{detail}</small>}</span>
    <input aria-label={label} aria-describedby={detail ? description : undefined} type="checkbox" checked={checked}
      onChange={event => onChange(event.target.checked)} />
  </label>;
}

function AppearanceSettings({ value, update, showPoolIntro }: SettingsProps & { showPoolIntro: () => void }) {
  const [optics, setOptics] = useState<DesktopOpticsState>({ enabled: false, running: false, error: null });
  useEffect(() => {
    let current = true;
    const unsubscribe = window.glass.subscribeOpticsState(setOptics);
    void window.glass.getOpticsState().then(state => { if (current) setOptics(state); }).catch(() => {});
    return () => { current = false; unsubscribe(); };
  }, []);
  const solid = value.material === 'solid';
  const resetDisabled = value.tintColor === DEFAULT_GLASS_APPEARANCE.tintColor
    && value.tintOpacity === DEFAULT_GLASS_APPEARANCE.tintOpacity && value.brightness === DEFAULT_GLASS_APPEARANCE.brightness;
  const shapes = [
    { id: 'classic', title: '原版玻璃', detail: '紧凑胶囊与速览' },
    { id: 'whale-pool', title: '鲸鱼水池', detail: '鲸鱼与流动水面' },
  ] as const;
  return <>
    <fieldset className="settings-group"><legend>悬浮窗形态</legend>
      <div className="settings-shapes">
        {shapes.map(shape => <label key={shape.id} className="settings-shape" data-shape={shape.id}>
          <span className="shape-art" aria-hidden="true"><WhaleArt /><i /></span>
          <span className="shape-label"><strong>{shape.title}</strong><small>{shape.detail}</small></span>
          <input type="radio" name="glass-appearance" aria-label={shape.title} checked={value.appearance === shape.id}
            onChange={() => update({ appearance: shape.id })} />
        </label>)}
      </div>
      {value.appearance === 'whale-pool' && <>
        <SettingSelect label="水池排版" value={value.poolLayout} onChange={poolLayout => update({ poolLayout })}
          options={[['clear','清流'],['stream','轻舟'],['letter','水笺']]} />
        <SettingSelect label="水池轮廓" value={value.poolContour} onChange={poolContour => update({ poolContour })}
          options={[['pearl','饱满水珠'],['mirror','柔角水镜'],['drop','圆头水滴']]} />
      </>}
      <button type="button" className="text-button shape-guide" onClick={showPoolIntro}>查看鲸鱼水池介绍 <Icon name="chevron-right" /></button>
    </fieldset>
    <details className="settings-whale-picker">
      <summary>
        <span>小鲸鱼外观</span>
        <span className="settings-whale-current"><WhaleArt skin={value.whaleSkin} />{WHALE_SKINS.find(skin => skin.id === value.whaleSkin)?.name}</span>
        <Icon name="chevron" />
      </summary>
      <div className="settings-whale-grid" role="group" aria-label="小鲸鱼外观">
        {WHALE_SKINS.map(skin => <label className="settings-whale-option" key={skin.id}>
          <span className="settings-whale-swatch" aria-hidden="true"><WhaleArt skin={skin.id} /></span>
          <span>{skin.name}</span>
          <input type="radio" name="whale-skin" aria-label={skin.name} checked={value.whaleSkin === skin.id}
            onChange={() => update({ whaleSkin: skin.id })} />
        </label>)}
      </div>
    </details>
    <fieldset className="settings-group"><legend>玻璃材质</legend>
      <SettingSelect label="玻璃主题" value={value.material} onChange={material => update({ material })}
        options={[['system','推荐薄透'],['transparent','纯透明'],['frosted','磨砂玻璃'],['solid','稳定实色']]} />
      <SettingSelect label="显示主题" value={value.theme} onChange={theme => update({ theme })}
        options={[['auto','跟随系统'],['light','浅色'],['dark','深色']]} />
      <SettingSelect label="玻璃强度" value={value.strength} onChange={strength => update({ strength })}
        options={[['clear','清透'],['balanced','平衡'],['readable','易读']]} />
      <label className="settings-row">玻璃底色<span className="tint-choice">
        <input aria-label="玻璃底色" type="color" value={value.tintColor} disabled={solid}
          onChange={event => update({ tintColor: event.target.value })} />
        <output>{value.tintColor.toUpperCase()}</output>
      </span></label>
      <label className="settings-row" htmlFor="glass-tint-opacity">底色浓度<span className="appearance-slider">
        <input id="glass-tint-opacity" aria-label="底色浓度" type="range" min="0" max="100" value={value.tintOpacity}
          disabled={solid} onChange={event => update({ tintOpacity: Number(event.target.value) })} />
        <output htmlFor="glass-tint-opacity">{value.tintOpacity}%</output>
      </span></label>
      <label className="settings-row" htmlFor="glass-brightness">玻璃亮度<span className="appearance-slider">
        <input id="glass-brightness" aria-label="玻璃亮度" aria-describedby="glass-appearance-note" type="range"
          min="50" max="150" value={value.brightness} disabled={!optics.enabled || solid}
          onChange={event => update({ brightness: Number(event.target.value) })} />
        <output htmlFor="glass-brightness">{value.brightness}%</output>
      </span></label>
      <div className="appearance-footer">
        <p className="muted" id="glass-appearance-note">{solid ? '切换回透明材质后，底色与亮度设置会生效。'
          : !optics.enabled ? '开启真实折射后可调亮度。' : '亮度只调整玻璃背景。'}</p>
        <button type="button" className="text-button appearance-reset" disabled={resetDisabled}
          onClick={() => update({ ...DEFAULT_GLASS_APPEARANCE })}>恢复默认</button>
      </div>
    </fieldset>
    <fieldset className="settings-group"><legend>光学效果</legend>
      <SettingToggle label="真实折射与色散" checked={optics.enabled}
        onChange={enabled => { void window.glass.setOpticsEnabled(enabled).then(setOptics)
          .catch(() => setOptics({ ...optics, error: '未能切换折射' })); }} />
      <p className="muted">仅取样本窗后方及少量边距，不保存、不上传。隐藏窗口时暂停。{optics.running && ' 已开启。'}</p>
      {optics.error && <p className="source-error" role="alert">{optics.error}</p>}
    </fieldset>
  </>;
}

const motionDetails: Record<CapsuleMotion, { title: string; detail: string }> = {
  classic: { title: '经典掠光', detail: '微光扫过玻璃，完成时暖金聚亮' },
  type: { title: '字光落印', detail: '标题逐字跃起，完成时换字落印' },
  silver: { title: '流银巡航', detail: '银光沿边绕行，完成时暖光收拢' },
  tide: { title: '鲸游潮汐', detail: '鲸鱼带出水线，完成时水光铺开' },
};
const previewTask: Task = {
  session: undefined, title: '整理项目与验证结果', status: 'running', label: '进行中',
  todos: [], current: [], completed: 2, total: 3, pending: [], questions: [], attentionCount: 0,
};

function MotionSettings({ value, update }: SettingsProps) {
  const [preview, setPreview] = useState({ status: 'running' as 'running' | 'completed', playing: false, sequence: 0 });
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timeout.current), []);
  function play(status: typeof preview.status) {
    clearTimeout(timeout.current);
    setPreview(previous => ({ status, playing: true, sequence: previous.sequence + 1 }));
    timeout.current = setTimeout(() => setPreview(previous => ({ ...previous, playing: false })),
      status === 'completed' ? COMPLETION_FEEDBACK_MS : 5600);
  }
  const completed = preview.status === 'completed';
  return <>
    <fieldset className="settings-group"><legend>原版玻璃 · 胶囊动效</legend>
      <div className="settings-motion-stage">
        <div className="settings-stage-heading"><strong>{motionDetails[value.capsuleMotion].title}</strong><span>演示</span></div>
        <div className="settings-motion-sample" data-playing={preview.playing}>
          <TaskCapsule key={preview.sequence} motion={value.capsuleMotion} feedback={preview.playing}
            task={{ ...previewTask, status: preview.status, completed: completed ? 3 : 2, label: completed ? '已完成' : '进行中' }} />
        </div>
        <div className="settings-preview-controls">
          <button type="button" className="quiet-button" onClick={() => play('running')}>播放进行中</button>
          <button type="button" className="quiet-button" onClick={() => play('completed')}>播放完成</button>
        </div>
      </div>
      <div className="settings-motion-options">
        {CAPSULE_MOTIONS.map(motion => <label className="settings-motion-option" key={motion}>
          <span><strong>{motionDetails[motion].title}</strong><small className="settings-row-detail">{motionDetails[motion].detail}</small></span>
          <input type="radio" name="capsule-motion" aria-label={motionDetails[motion].title} checked={value.capsuleMotion === motion}
            onChange={() => { update({ capsuleMotion: motion }); play(preview.status); }} />
        </label>)}
      </div>
      {value.appearance === 'whale-pool' && <p className="muted">切回原版玻璃时应用这里选择的胶囊动效。</p>}
    </fieldset>
    <fieldset className="settings-group"><legend>动态效果</legend>
      <SettingSelect label="动画" value={value.animation} onChange={animation => update({ animation })}
        options={[['full','完整'],['reduced','减少'],['off','关闭']]} />
      <p className="muted">播放效果会遵循此设置及系统的减少动态效果偏好。</p>
    </fieldset>
  </>;
}

export function GlassSettingsPanel({ value, update, projection, mock, back, showPoolIntro }: SettingsProps & {
  projection: Projection; mock: (action: MockAction) => void; back: () => void; showPoolIntro: () => void;
}) {
  const [page, setPage] = useState<SettingsPage>('appearance');
  const scroll = useRef<HTMLDivElement>(null);
  const tabPrefix = useId();
  const tabId = (id: SettingsPage) => tabPrefix + '-tab-' + id;
  const panelId = (id: SettingsPage) => tabPrefix + '-panel-' + id;
  function openPage(id: SettingsPage) {
    setPage(id);
    if (scroll.current) scroll.current.scrollTop = 0;
  }
  function moveTab(event: KeyboardEvent<HTMLDivElement>) {
    const index = pages.findIndex(item => item.id === page);
    const last = pages.length - 1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? last : event.key === 'ArrowRight'
      ? (index + 1) % pages.length : event.key === 'ArrowLeft' ? (index + last) % pages.length : undefined;
    if (next === undefined) return;
    event.preventDefault();
    const id = pages[next]!.id;
    openPage(id);
    document.getElementById(tabId(id))?.focus();
  }
  const source = projection.source === 'mock' ? 'Mock 演示' : projection.connection === 'connected'
    ? 'DSH 已连接' : projection.connection === 'connecting' || projection.connection === 'reconnecting' ? '正在连接 DSH' : 'DSH 未连接';
  return <section className="settings-panel" aria-label="设置">
    <header className="panel-heading settings-heading">
      <button type="button" className="back-button" aria-label="返回" title="返回" onClick={back}><Icon name="back" /></button>
      <div className="settings-heading-title"><span>DSH GLASS</span><h1>设置</h1></div>
    </header>
    <div className="settings-tabs" role="tablist" aria-label="设置分类" onKeyDown={moveTab}>
      {pages.map(item => <button key={item.id} type="button" role="tab" id={tabId(item.id)} aria-controls={panelId(item.id)}
        aria-selected={page === item.id} tabIndex={page === item.id ? 0 : -1} onClick={() => openPage(item.id)}>
        <Icon name={item.icon} /><span>{item.name}</span>
      </button>)}
    </div>
    <div className="settings-scroll" ref={scroll}>
      <section role="tabpanel" id={panelId('appearance')} aria-labelledby={tabId('appearance')} hidden={page !== 'appearance'}>
        <AppearanceSettings value={value} update={update} showPoolIntro={showPoolIntro} />
      </section>
      <section role="tabpanel" id={panelId('motion')} aria-labelledby={tabId('motion')} hidden={page !== 'motion'}>
        {page === 'motion' && <MotionSettings value={value} update={update} />}
      </section>
      <section role="tabpanel" id={panelId('window')} aria-labelledby={tabId('window')} hidden={page !== 'window'}>
        <fieldset className="settings-group"><legend>打开方式</legend>
          <SettingSelect label="默认形态" value={value.defaultView} onChange={defaultView => update({ defaultView })}
            options={[['capsule','胶囊'],['peek','速览'],['remember-last','记住上次']]} />
          <SettingSelect label="置顶行为" value={value.pin} onChange={pin => update({ pin })}
            options={[['normal','普通'],['always','始终置顶'],['on-notification','有待处理请求时']]} />
          <SettingToggle label="靠边自动收纳" detail="将原版胶囊或收起的小鲸鱼拖到屏幕边缘，松手后收成小球。"
            checked={value.edgeDock} onChange={edgeDock => update({ edgeDock })} />
        </fieldset>
        <fieldset className="settings-group"><legend>任务提醒</legend>
          <SettingToggle label="审批时自动展开" detail="收到待处理请求时打开审批界面。" checked={value.autoApproval}
            onChange={autoApproval => update({ autoApproval })} />
          <SettingToggle label="完成后自动收起" checked={value.autoCollapse} onChange={autoCollapse => update({ autoCollapse })} />
          <SettingToggle label="提示音" checked={value.sound} onChange={sound => update({ sound })} />
          <SettingSelect label="提示音风格" value={value.soundPreset} onChange={soundPreset => update({ soundPreset })}
            options={CHIME_PRESETS} />
          <div className="settings-preview-controls" role="group" aria-label="试听提示音">
            <button type="button" className="quiet-button" disabled={!value.sound}
              onClick={() => playChime('complete', value.soundPreset)}>试听完成</button>
            <button type="button" className="quiet-button" disabled={!value.sound}
              onClick={() => playChime('approval', value.soundPreset)}>试听待处理</button>
          </div>
        </fieldset>
        <fieldset className="settings-group"><legend>快捷操作</legend>
          <p className="settings-shortcut-note muted">隐藏后按 <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>G</kbd> 恢复。<br />退出后在 DSH 输入 <code>/status-bar</code> 重新打开。</p>
        </fieldset>
      </section>
      <section role="tabpanel" id={panelId('connection')} aria-labelledby={tabId('connection')} hidden={page !== 'connection'}>
        <DSHConnection projection={projection} />
        <details className="debug-settings"><summary><span>演示与诊断</span><Icon name="chevron" /></summary>
          <p className="muted">连接状态 {projection.connection}{projection.stale ? ' · 旧数据' : ''}</p>
          <div className="debug-actions">
            <button disabled={projection.source !== 'mock'} onClick={() => mock('restart')}>重播演示</button>
            <button disabled={projection.source !== 'mock'} onClick={() => mock(projection.connection === 'connected' ? 'disconnect' : 'reconnect')}>
              {projection.connection === 'connected' ? '模拟断线' : '重新连接'}
            </button>
            <button disabled={projection.source !== 'mock'} onClick={() => mock('out-of-order')}>模拟乱序</button>
          </div>
          <p className="muted build-stamp">构建 {new Date(__GLASS_BUILD__).toLocaleString('zh-CN', { hour12: false })}</p>
        </details>
      </section>
    </div>
    <footer className="settings-status">
      <button type="button" className="text-button" aria-label={source + '，打开连接设置'} onClick={() => openPage('connection')}>
        <i aria-hidden="true" data-connected={projection.connection === 'connected'} data-mock={projection.source === 'mock'} />{source}
      </button>
      <span>本地偏好</span>
    </footer>
  </section>;
}
