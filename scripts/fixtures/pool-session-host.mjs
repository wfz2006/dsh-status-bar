// Test plugin loaded only by pool-session-acceptance into its temporary official
// web Profile. The real Agent loop and tools use a deterministic local provider.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
export const name = 'glass-pool-session-fixture';
export const inject = ['agents', 'llm', 'tools', 'approval', 'userQuestions'];

export function apply(ctx) {
  const home = process.env.GLASS_POOL_TEST_HOME;
  if (!home || home !== process.env.DSH_HOME) throw new Error('An isolated pool test profile is required');
  const route = 'glass-pool-test';
  const nativeRequire = createRequire(join(process.resourcesPath, 'app.asar', 'dsh', 'package.json'));
  const { defineTool } = nativeRequire('@deepseek-ai/dsh-tools');
  const askUser = nativeRequire('@deepseek-ai/dsh-tool-ask-user');
  ctx.on('session/event', (session,event) => {
    if (session.id !== 'pool-b') return;
    if (event.type === 'tool/result' && event.data.message?.toolCallId === 'pool-real-question' && !event.data.message.isError) {
      const block = event.data.message.content.find(b => b.type === 'text');
      const answers = block && JSON.parse(block.text).answers;
      if (answers?.[0]?.id === 'choice' && answers[0].custom === '先看蓝色样本') console.info('[pool-test] answer matched');
    }
  }, { global:true });
  const rounds = new Map();
  const adapter = {
    providerInfo: id => ({ id, name: 'Pool acceptance fixture' }),
    providerRetryPolicy: () => undefined,
    listModels: () => Promise.resolve([]),
    resolveModel: async (provider, id) => ({ provider, id, name: id }),
    async prepareCall(provider, model) {
      return { model: await this.resolveModel(provider, model), stream: options => this.stream(options) };
    },
    async *stream({ model, tools }) {
      const agentTurn = tools?.some(t => t.name === 'ask_user_question');
      const round = agentTurn ? (rounds.get(model) ?? 0) + 1 : 0;
      if (agentTurn) rounds.set(model, round);
      const asks = model === 'pool-b' && round === 1;
      const reviews = model === 'pool-b' && (round === 2 || round === 3);
      let block;
      if (asks || reviews) {
        const args = asks ? { questions: [{ id: 'choice', question: '先核对哪一项？' }], timeout: 60 } : { item: round === 2 ? '第一份样本' : '第二份样本' };
        block = { type: 'tool-call', id: asks ? 'pool-real-question' : 'pool-real-review-' + round,
          name: asks ? 'ask_user_question' : 'pool_review', arguments: JSON.stringify(args) };
      } else block = { type: 'text', text: '本轮核对已结束。' };
      yield { type: 'block-start', index: 0, blockType: block.type };
      yield { type: 'block-end', index: 0, block };
      yield { type: 'finish', reason: { kind: asks || reviews ? 'tool-calls' : 'stop' } };
    },
  };
  ctx.llm.registerAdapter([route], adapter);
  ctx.tools.register(defineTool({
    name: 'pool_review', description: 'Ask permission to review a synthetic color sample.',
    parameters: { item: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { outcome: { type:'string', required:true } } },
      render: (_args, value) => [{ type:'text', text:value.outcome }] },
    async execute(args, exec) {
      const outcome = await ctx.approval.request({ agent: exec.agent, toolName: 'pool_review', callId: exec.callId, signal: exec.signal, reason: '核对' + args.item });
      console.info('[pool-test] approval ' + outcome);
      return { outcome };
    },
  }));
  let started = false;
  const timer = setInterval(async () => {
    if (started || !existsSync(join(home, 'start-fixture'))) return;
    started = true;
    try {
      const agents = [];
      for (const id of ['pool-a', 'pool-b']) {
        const handle = await ctx.agents.create({ sessionId: id, agentOptions: { provider: route, model: id }, meta: { cwd: home },
          setup(agentCtx) { agentCtx.inject(['tools', 'userQuestions'], child => { askUser.apply(child, { mode: 'timed', timeout: 60 }); }); } });
        handle.agent.session.append('session/title', { title: id === 'pool-a' ? '项目笔记' : '核对清单', messageSeqs: [], source: { kind:'user' } });
        agents.push(handle.agent);
      }
      console.info('[pool-test] sessions ready');
      const begin = setInterval(() => {
        if (!existsSync(join(home, 'start-turn'))) return;
        clearInterval(begin);
        agents[1].followup({ id: randomUUID(), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '核对本地样本' }] });
      }, 80);
      ctx.on('dispose', () => clearInterval(begin));
    } catch (error) { console.error('[pool-test] setup error ' + error.message); }
  }, 80);
  ctx.on('dispose', () => clearInterval(timer));
}
