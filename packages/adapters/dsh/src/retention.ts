/** Session-local caches use separate maps: session IDs may themselves contain
 * colons, so clearing a string prefix can accidentally erase another session. */
export class SessionCache<T> {
  private readonly sessions = new Map<string, Map<string, T>>();
  get size() { let total = 0; for (const entries of this.sessions.values()) total += entries.size; return total; }
  get(sessionId: string, key: string) { return this.sessions.get(sessionId)?.get(key); }
  set(sessionId: string, key: string, value: T) {
    let entries = this.sessions.get(sessionId);
    if (!entries) { entries = new Map(); this.sessions.set(sessionId, entries); }
    entries.set(key, value);
  }
  deleteSession(sessionId: string) { this.sessions.delete(sessionId); }
  clear() { this.sessions.clear(); }
  deleteWhere(sessionId: string, predicate: (value: T, key: string) => boolean) {
    const entries = this.sessions.get(sessionId); if (!entries) return;
    for (const [key, value] of entries) if (predicate(value, key)) entries.delete(key);
    if (!entries.size) this.sessions.delete(sessionId);
  }
  trim(sessionId: string, limit: number, protectedKeys: ReadonlySet<string> = new Set()) {
    const entries = this.sessions.get(sessionId); if (!entries) return;
    for (const key of entries.keys()) {
      if (entries.size <= limit) break;
      if (!protectedKeys.has(key)) entries.delete(key);
    }
  }
}

