import { randomUUID } from 'node:crypto';
import type { SessionNote } from '@glass/protocol';
import { record, type RecordValue } from './transport';

type Block = { kind: SessionNote['kind']; text: string; closed: boolean };
type Attempt = { id: string; noteId: string; turn: number; step: number; cursor: number; next: number; blocks: Map<number, Block> };
const integer = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;

/** Display-only prefixes. Never feeds durable events, tool arguments or request capabilities. */
export class AssistantPreview {
  private revision = 0;
  private active?: Attempt;

  private start(value: RecordValue): Attempt | undefined {
    if (typeof value.attemptId !== 'string' || !value.attemptId || value.attemptId.length > 300 ||
      !integer(value.turn) || !integer(value.step) || !integer(value.startedAfterSeq, -1) || value.startedAfterSeq >= Number.MAX_SAFE_INTEGER) return;
    return { id: value.attemptId, noteId: randomUUID(), turn: value.turn, step: value.step, cursor: value.startedAfterSeq, next: 0, blocks: new Map() };
  }

  private chunk(value: unknown) {
    const active = this.active; if (!active) return;
    const c = record(value); if (!integer(c.index)) return;
    // Tool-call fragments may contain incomplete or sensitive arguments. They
    // remain invisible until the existing durable tool/call safety checks run.
    const block = record(c.block);
    const kind = c.type === 'reasoning-delta' || c.type === 'block-end' && block.type === 'reasoning' ? 'reasoning'
      : c.type === 'text-delta' || c.type === 'block-end' && block.type === 'text' ? 'message' : undefined;
    if (!kind) return;
    const text = c.type === 'block-end' ? block.text : c.text;
    if (typeof text !== 'string') return;
    const previous = active.blocks.get(c.index);
    if (previous?.closed || previous && previous.kind !== kind || !previous && active.blocks.size >= 60) return;
    active.blocks.set(c.index, { kind, text: (c.type === 'block-end' ? text : (previous?.text ?? '') + text.slice(0, 2000)).slice(0, 2000), closed: c.type === 'block-end' });
  }

  accept(value: unknown) {
    const f = record(value); if (!integer(f.revision, 1)) return;
    // The upstream revision resets when a new Agent lifecycle starts.
    if (f.type === 'start' && f.revision === 1) this.revision = 0;
    if (f.revision <= this.revision) return;
    if (f.revision !== this.revision + 1) { this.active = undefined; this.revision = f.revision; return; }
    this.revision = f.revision;
    if (f.type === 'start') { this.active = this.start(f); return; }
    if (!this.active || this.active.id !== f.attemptId) return;
    if (f.type === 'end') { this.active = undefined; return; }
    if (f.type === 'chunk') {
      if (f.index !== this.active.next) { this.active = undefined; return; }
      this.active.next++; this.chunk(f.chunk);
    }
  }

  restore(value: unknown) {
    const baseline = record(value); this.active = undefined;
    this.revision = integer(baseline.revision) ? baseline.revision : 0;
    const a = record(baseline.activeAttempt);
    if (!integer(a.nextIndex) || !Array.isArray(a.stream)) return;
    this.active = this.start(a); if (!this.active) return;
    for (const value of a.stream) {
      const entry = record(value);
      if (entry.type === 'chunk') this.chunk(entry.chunk);
      else if ((entry.type === 'text-chunks' || entry.type === 'reasoning-chunks') && Array.isArray(entry.texts)) {
        let prefix = '';
        for (const text of entry.texts) {
          if (typeof text !== 'string') { this.active = undefined; return; }
          prefix += text.slice(0, 2000 - prefix.length);
          if (prefix.length >= 2000) break;
        }
        this.chunk({ type: entry.type === 'text-chunks' ? 'text-delta' : 'reasoning-delta', index: entry.index, text: prefix });
      }
    }
    this.active.next = a.nextIndex;
  }

  settle(event: RecordValue) {
    const active = this.active, data = record(event.data);
    if (active && ['assistant/message', 'assistant/attempt'].includes(String(event.type)) &&
      integer(event.seq) && event.seq > active.cursor && data.turn === active.turn && data.step === active.step) {
      this.active = undefined;
      return new Map([...active.blocks.keys()].map(index => [index, `live:${active.noteId}:${index}`]));
    }
  }

  clear() { this.active = undefined; }

  notes(): SessionNote[] {
    const active = this.active; if (!active) return [];
    return [...active.blocks.entries()].reverse().flatMap(([index, block]) => {
      const text = block.text.replace(/\s+/g, ' ').trim();
      return text ? [{ id: `live:${active.noteId}:${index}`, kind: block.kind, text, sourceSeq: active.cursor + 1, streaming: true }] : [];
    });
  }
}
