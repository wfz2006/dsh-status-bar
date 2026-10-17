// Isolated Profile probe only. Never registers an approval/question answerer.
export const name = 'dsh-glass-probe';
export const inject = ['sessions'];
export function apply(ctx) {
  console.info('[dsh-glass-probe] loaded (observe only)');
  ctx.on('session/event', (session, event) => {
    // Never log event.data, conversation content, tool arguments or session id.
    console.info('[dsh-glass-probe] event', JSON.stringify({ type: event.type, seq: event.seq, hasSessionIdentity: typeof session.id === 'string', ...(event.type === 'todo/write' ? { todoCount: event.data.todos.length } : {}) }));
  }, { global: true });
  ctx.on('dispose', () => console.info('[dsh-glass-probe] disposed'));
  if (process.env.GLASS_PROBE_FIXTURE === '1') {
    const timer = setTimeout(() => {
      // Synthetic test data inside the isolated DSH_HOME only. No model/tools.
      const session = ctx.sessions.create('glass-probe-fixture');
      session.append('turn/start', { turn: 1 });
      session.append('todo/write', { todos: [
        { content: 'Probe A', status: 'completed' },
        { content: 'Probe B', status: 'in_progress' },
        { content: 'Probe C', status: 'pending' },
      ] });
      session.append('todo/write', { todos: [
        { content: 'Probe A', status: 'completed' },
        { content: 'Probe C', status: 'in_progress' },
      ] });
      console.info('[dsh-glass-probe] fixture appended; not a model-driven Agent session');
    }, 1200);
    ctx.on('dispose', () => clearTimeout(timer));
  }
}
