import type { Projection, Session } from '@glass/protocol';

type Fields = Omit<Projection, 'sessions' | 'seen'>;
export type ProjectionMessage =
  | { kind: 'snapshot'; revision: number; projection: Projection }
  | { kind: 'delta'; revision: number; baseRevision: number; fields: Partial<Fields>; sessions: Record<string, Session>; removed: string[]; seen: { append: string[] } | { replace: string[] } };
const fields: (keyof Fields)[] = ['connection', 'stale', 'source', 'runtimeId', 'epoch', 'capabilities', 'approvals', 'questions', 'removedSessions'];
function shallowEqual(a: object, b: object): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && Reflect.get(a, key) === Reflect.get(b, key));
}
function sharedArray<T extends object>(before: readonly T[] | undefined, after: T[]): T[] {
  if (!before) return after;
  const items = after.map((item, index) => before[index] && shallowEqual(before[index], item) ? before[index]! : item);
  return items.length === before.length && items.every((item, index) => item === before[index]) ? before as T[] : items;
}
function shareSession(before: Session | undefined, next: Session): Session {
  if (!before || before.runtimeId !== next.runtimeId) return next;
  const stats = next.stats && before.stats && shallowEqual(next.stats, before.stats) ? before.stats : next.stats;
  return { ...next, stats, todos: sharedArray(before.todos, next.todos), activities: sharedArray(before.activities, next.activities),
    ...(next.notes ? { notes: sharedArray(before.notes, next.notes) } : {}) };
}
function sameRequests(a: Projection['approvals'] | Projection['questions'], b: Projection['approvals'] | Projection['questions']) {
  return a.length === b.length && a.every((value, i) => shallowEqual(value, b[i]!));
}

/** Main owns the accepted business projection. This channel only changes how
 * that projection crosses IPC; it cannot grant capabilities or accept a request. */
export class ProjectionPublisher {
  private previous?: Projection;
  private revision = 0;
  private sinceSnapshot = 0;
  constructor(private readonly fullEvery = 300) {}
  snapshot(projection: Projection): ProjectionMessage {
    this.previous = projection; this.sinceSnapshot = 0;
    return { kind: 'snapshot', revision: ++this.revision, projection };
  }
  next(projection: Projection): ProjectionMessage | undefined {
    const before = this.previous;
    if (projection === before) return;
    if (!before || before.runtimeId !== projection.runtimeId || before.epoch !== projection.epoch || ++this.sinceSnapshot >= this.fullEvery) return this.snapshot(projection);
    const patch: Partial<Fields> = {};
    for (const key of fields) {
      if (before[key] === projection[key]) continue;
      if ((key === 'approvals' || key === 'questions') && sameRequests(before[key], projection[key])) continue;
      Object.assign(patch, { [key]: projection[key] });
    }
    const sessions = Object.fromEntries(Object.entries(projection.sessions).filter(([id, session]) => before.sessions[id] !== session));
    const removed = Object.keys(before.sessions).filter(id => !Object.hasOwn(projection.sessions, id));
    const lastSeen = before.seen.at(-1); const overlap = lastSeen === undefined ? -1 : projection.seen.lastIndexOf(lastSeen);
    const seen = lastSeen === undefined || overlap >= 0 ? { append: projection.seen.slice(overlap + 1) } : { replace: projection.seen };
    const baseRevision = this.revision; this.previous = projection;
    return { kind: 'delta', revision: ++this.revision, baseRevision, fields: patch, sessions, removed, seen };
  }
}

export class ProjectionReceiver {
  private revision = -1;
  private projection?: Projection;
  get current() { return this.projection; }
  get version() { return this.revision; }
  accept(message: ProjectionMessage): { state?: Projection; needsSync: boolean } {
    if (message.revision <= this.revision) return { needsSync: false };
    if (message.kind === 'snapshot') {
      this.revision = message.revision; this.projection = message.projection;
      return { state: this.projection, needsSync: false };
    }
    if (!this.projection || message.baseRevision !== this.revision) return { needsSync: true };
    const previous = this.projection; const sessions = { ...previous.sessions };
    for (const id of message.removed) delete sessions[id];
    for (const [id, session] of Object.entries(message.sessions)) sessions[id] = shareSession(previous.sessions[id], session);
    this.projection = { ...previous, ...message.fields, sessions,
      seen: 'replace' in message.seen ? message.seen.replace : [...previous.seen, ...message.seen.append].slice(-512) };
    this.revision = message.revision;
    return { state: this.projection, needsSync: false };
  }
}
