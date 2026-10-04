import { DurableObject } from 'cloudflare:workers';

export const DEMO_LIMITS = {
  sessionSeconds: 600,
  conversationsPerSession: 4,
  charactersPerSession: 3000,
  speechRequestsPerSession: 24,
  dailyConversations: 60,
  dailyCharacters: 20000,
  dailySpeechRequests: 400,
  dailyVerifications: 200,
  dailyVerificationsPerIp: 20,
  dailyConversationsPerIp: 12,
  dailyCharactersPerIp: 6000,
  speechConcurrency: 2,
  leaseMs: 75000,
} as const;
export type Operation = 'conversation' | 'speech';
export type Decision =
  | { ok: true }
  | { ok: false; code: string; status: number; retryAfter?: number };
const deny = (code: string, status: number, retryAfter?: number): Decision => ({
  ok: false,
  code,
  status,
  ...(retryAfter === undefined ? {} : { retryAfter }),
});
function configuredLimit(value: string, maximum: number): number {
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 0 && limit <= maximum ? limit : 0;
}
// Synchronous SQLite transactions keep counters, leases and replay records atomic.
// No provider network I/O runs inside either object's transaction.
class Ledger<Bindings = Env> extends DurableObject<Bindings> {
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS entries (
      name TEXT PRIMARY KEY, value TEXT NOT NULL
    )`);
  }
  protected read<T>(key: string): T | undefined {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>('SELECT value FROM entries WHERE name = ?', key)
      .toArray()[0];
    return row ? (JSON.parse(row.value) as T) : undefined;
  }
  protected write(key: string, value: unknown): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO entries (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value',
      key,
      JSON.stringify(value),
    );
  }
  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
interface Visitor {
  origin: string;
  expiresAt: number;
  conversations: number;
  characters: number;
  speechRequests: number;
  locks: Partial<Record<Operation, { id: string; expiresAt: number }>>;
}
export class DemoSession extends Ledger {
  async initialize(origin: string): Promise<number> {
    const expiresAt = this.ctx.storage.transactionSync(() => {
      const existing = this.read<Visitor>('visitor');
      if (existing) return existing.expiresAt;
      const expiresAt = Date.now() + DEMO_LIMITS.sessionSeconds * 1000;
      this.write('visitor', {
        origin,
        expiresAt,
        conversations: 0,
        characters: 0,
        speechRequests: 0,
        locks: {},
      } satisfies Visitor);
      return expiresAt;
    });
    await this.ctx.storage.setAlarm(expiresAt + DEMO_LIMITS.leaseMs);
    return expiresAt;
  }
  reserve(
    origin: string,
    id: string,
    operation: Operation,
    characters: number,
  ): Decision {
    return this.ctx.storage.transactionSync(() => {
      const visitor = this.read<Visitor>('visitor');
      const now = Date.now();
      if (!visitor || visitor.expiresAt <= now || visitor.origin !== origin)
        return deny('verification_expired', 401);
      if (this.read('request:' + id)) return deny('duplicate_request', 409);
      const lock = visitor.locks[operation];
      if (lock && lock.expiresAt > now)
        return deny(
          'request_in_progress',
          429,
          Math.ceil((lock.expiresAt - now) / 1000),
        );
      if (operation === 'conversation') {
        if (visitor.conversations >= DEMO_LIMITS.conversationsPerSession)
          return deny(
            'visitor_limit',
            429,
            Math.ceil((visitor.expiresAt - now) / 1000),
          );
        visitor.conversations++;
      } else {
        if (
          visitor.characters + characters > DEMO_LIMITS.charactersPerSession ||
          visitor.speechRequests >= DEMO_LIMITS.speechRequestsPerSession
        )
          return deny(
            'visitor_limit',
            429,
            Math.ceil((visitor.expiresAt - now) / 1000),
          );
        visitor.characters += characters;
        visitor.speechRequests++;
      }
      visitor.locks[operation] = { id, expiresAt: now + DEMO_LIMITS.leaseMs };
      this.write('visitor', visitor);
      this.write('request:' + id, true);
      return { ok: true };
    });
  }
  finish(id: string, operation: Operation): void {
    const visitor = this.read<Visitor>('visitor');
    if (visitor?.locks[operation]?.id !== id) return;
    delete visitor.locks[operation];
    this.write('visitor', visitor);
  }
}
interface Counts {
  verifications: number;
  conversations: number;
  characters: number;
  speechRequests: number;
}
interface Budget extends Counts {
  speech: Record<string, number>;
}
const emptyCounts = (): Counts => ({
  verifications: 0,
  conversations: 0,
  characters: 0,
  speechRequests: 0,
});
export class DemoBudget extends Ledger {
  // One coordinator per UTC day, only for paid admissions/verification. Static
  // requests, audio streams and the agent WebSocket never pass through it.
  async reserve(
    day: string,
    id: string,
    ip: string,
    operation: Operation | 'verification',
    characters: number,
  ): Promise<Decision> {
    const expiry = Date.parse(day + 'T00:00:00Z') + 86400000;
    if (
      !Number.isFinite(expiry) ||
      day !== new Date().toISOString().slice(0, 10)
    )
      return deny('budget_unavailable', 503);
    const result = this.ctx.storage.transactionSync((): Decision => {
      const now = Date.now();
      const retry = Math.max(1, Math.ceil((expiry - now) / 1000));
      const budget = this.read<Budget>('budget') ?? {
        ...emptyCounts(),
        speech: {},
      };
      const visitor = this.read<Counts>('ip:' + ip) ?? emptyCounts();
      if (this.read('request:' + id)) return deny('duplicate_request', 409);
      for (const [key, expiresAt] of Object.entries(budget.speech))
        if (expiresAt <= now) delete budget.speech[key];
      if (operation === 'verification') {
        if (budget.verifications >= DEMO_LIMITS.dailyVerifications)
          return deny('demo_limit', 429, retry);
        if (visitor.verifications >= DEMO_LIMITS.dailyVerificationsPerIp)
          return deny('network_limit', 429, retry);
        budget.verifications++;
        visitor.verifications++;
      } else if (operation === 'conversation') {
        if (
          budget.conversations >=
          configuredLimit(
            this.env.DEMO_DAILY_CONVERSATIONS,
            DEMO_LIMITS.dailyConversations,
          )
        )
          return deny('demo_limit', 429, retry);
        if (visitor.conversations >= DEMO_LIMITS.dailyConversationsPerIp)
          return deny('network_limit', 429, retry);
        budget.conversations++;
        visitor.conversations++;
      } else {
        if (
          budget.characters + characters >
            configuredLimit(
              this.env.DEMO_DAILY_TTS_CHARACTERS,
              DEMO_LIMITS.dailyCharacters,
            ) ||
          budget.speechRequests >= DEMO_LIMITS.dailySpeechRequests
        )
          return deny('demo_limit', 429, retry);
        if (visitor.characters + characters > DEMO_LIMITS.dailyCharactersPerIp)
          return deny('network_limit', 429, retry);
        if (Object.keys(budget.speech).length >= DEMO_LIMITS.speechConcurrency)
          return deny('demo_busy', 429, 15);
        budget.characters += characters;
        visitor.characters += characters;
        budget.speechRequests++;
        visitor.speechRequests++;
        budget.speech[id] = now + DEMO_LIMITS.leaseMs;
      }
      this.write('budget', budget);
      this.write('ip:' + ip, visitor);
      if (operation !== 'verification') {
        const nearLimit =
          budget.characters >=
            configuredLimit(
              this.env.DEMO_DAILY_TTS_CHARACTERS,
              DEMO_LIMITS.dailyCharacters,
            ) *
              0.8 ||
          budget.conversations >=
            configuredLimit(
              this.env.DEMO_DAILY_CONVERSATIONS,
              DEMO_LIMITS.dailyConversations,
            ) *
              0.8;
        console.info(
          JSON.stringify({
            event: 'demo_budget',
            operation,
            conversations: budget.conversations,
            characters: budget.characters,
            speechRequests: budget.speechRequests,
          }),
        );
        if (nearLimit && !this.read('budget-warning')) {
          this.write('budget-warning', true);
          console.warn(
            JSON.stringify({ event: 'demo_budget_near_limit', threshold: 0.8 }),
          );
        }
      }
      this.write('request:' + id, true);
      return { ok: true };
    });
    if (result.ok)
      await this.ctx.storage.setAlarm(expiry + DEMO_LIMITS.leaseMs);
    return result;
  }
  finish(id: string): void {
    const budget = this.read<Budget>('budget');
    if (!budget?.speech[id]) return;
    delete budget.speech[id];
    this.write('budget', budget);
  }
}
