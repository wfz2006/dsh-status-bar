import type { Activity, Projection, Session, SessionNote } from '@glass/protocol';

type Fields = Omit<Projection, 'sessions' | 'seen'>;
type RowDelta<T> = { length: number; items: [number, T][] };
type SessionDelta = { fields: Partial<Session>; deleted: (keyof Session)[];
  activities?: RowDelta<Activity>; notes?: RowDelta<SessionNote> };
export type ProjectionMessage =
  | { kind: 'snapshot'; revision: number; projection: Projection }
  | { kind: 'delta'; revision: number; baseRevision: number; fields: Partial<Fields>; sessions: Record<string, Session>; sessionChanges?: Record<string, SessionDelta>; removed: string[]; seen: { append: string[] } | { replace: string[] } };
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
function rowDelta<T extends object>(before: readonly T[] | undefined, after: T[]): RowDelta<T> | undefined {
  if (before === after) return;
  const items: [number, T][] = [];
  for (let i = 0; i < after.length; i++) if (!before?.[i] || !shallowEqual(before[i]!, after[i]!)) items.push([i, after[i]!]);
  if (!before || before.length !== after.length || items.length) return { length: after.length, items };
}
function sessionDelta(before: Session, after: Session): SessionDelta {
  const delta: SessionDelta = { fields: {}, deleted: (Object.keys(before) as (keyof Session)[]).filter(key => !Object.hasOwn(after, key)) };
  for (const key of Object.keys(after) as (keyof Session)[]) {
    if (before[key] === after[key] && Object.hasOwn(before, key)) continue;
    if (key === 'activities' || key === 'notes') {
      const rows = after[key];
      if (rows) {
        // Positional patches preserve ordering and even duplicate IDs. Only
        // changed rows cross IPC; the receiver keeps every untouched object.
        const change = rowDelta<Activity | SessionNote>(before[key], rows);
        if (change) Object.assign(delta, { [key]: change });
        continue;
      }
    }
    if (key === 'todos' && before.todos.length === after.todos.length && before.todos.every((todo, index) => shallowEqual(todo, after.todos[index]!))) continue;
    if (key === 'stats' && before.stats && after.stats && shallowEqual(before.stats, after.stats)) continue;
    Object.assign(delta.fields, { [key]: after[key] });
  }
  return delta;
}
function applyRows<T>(before: T[] | undefined, delta: RowDelta<T>): T[] {
  const rows = before ? before.slice(0, delta.length) : [];
  rows.length = delta.length;
  for (const [index, item] of delta.items) rows[index] = item;
  return rows;
}
function applySession(before: Session, delta: SessionDelta): Session {
  const next = { ...before, ...delta.fields };
  for (const key of delta.deleted) delete next[key];
  if (delta.activities) next.activities = applyRows(before.activities, delta.activities);
  if (delta.notes) next.notes = applyRows(before.notes, delta.notes);
  return next;
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
    const sessions: Record<string, Session> = {};
    const changes: [string, SessionDelta][] = [];
    for (const [id, session] of Object.entries(projection.sessions)) {
      const previous = Object.hasOwn(before.sessions, id) ? before.sessions[id] : undefined;
      if (previous === session) continue;
      if (!previous || previous.runtimeId !== session.runtimeId) Object.defineProperty(sessions, id, { value: session, enumerable: true });
      else changes.push([id, sessionDelta(previous, session)]);
    }
    const removed = Object.keys(before.sessions).filter(id => !Object.hasOwn(projection.sessions, id));
    const lastSeen = before.seen.at(-1); const overlap = lastSeen === undefined ? -1 : projection.seen.lastIndexOf(lastSeen);
    const seen = lastSeen === undefined || overlap >= 0 ? { append: projection.seen.slice(overlap + 1) } : { replace: projection.seen };
    const baseRevision = this.revision; this.previous = projection;
    return { kind: 'delta', revision: ++this.revision, baseRevision, fields: patch, sessions,
      ...(changes.length ? { sessionChanges: Object.fromEntries(changes) } : {}), removed, seen };
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
    for (const [id, session] of Object.entries(message.sessions)) {
      // Session IDs are protocol strings. Assignment to __proto__ would call
      // Object.prototype's setter instead of creating an actual session entry.
      const before = Object.hasOwn(previous.sessions, id) ? previous.sessions[id] : undefined;
      Object.defineProperty(sessions, id, { value: shareSession(before, session), enumerable: true, writable: true, configurable: true });
    }
    for (const [id, delta] of Object.entries(message.sessionChanges ?? {})) {
      if (!Object.hasOwn(previous.sessions, id) || message.removed.includes(id)) return { needsSync: true };
      sessions[id] = applySession(previous.sessions[id]!, delta);
    }
    this.projection = { ...previous, ...message.fields, sessions,
      seen: 'replace' in message.seen ? message.seen.replace : [...previous.seen, ...message.seen.append].slice(-512) };
    this.revision = message.revision;
    return { state: this.projection, needsSync: false };
  }
}
