/** Real integration is intentionally gated on a version-matched Profile probe. */
export const dshIntegration = Object.freeze({
  status: 'BLOCKED', mode: 'unavailable', respondApproval: false, respondQuestion: false,
  reason: 'Desktop 0.2.0-rc.2 插件加载、事件观察和 answerer 所有权尚未完成实机验证。',
});
