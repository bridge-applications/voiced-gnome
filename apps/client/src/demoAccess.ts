import {
  ApiErrorSchema,
  DemoSessionSchema,
  type AppConfig,
} from '@bridge-applications/voiced-gnome-types';
const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
type Verify = (signal: AbortSignal) => Promise<string>;
// Memory only: capabilities are never placed in URLs, localStorage or analytics.
export class DemoAccess {
  private session: { token: string; expiresAt: number } | undefined;
  private pending: Promise<{ token: string; expiresAt: number }> | undefined;
  private config: AppConfig | undefined;
  private verify: Verify | undefined;
  constructor(
    private fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
  ) {}
  configure(config: AppConfig, verify: Verify): void {
    this.config = config;
    this.verify = verify;
  }
  clear(): void {
    this.session = undefined;
  }
  private async access(signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.session && this.session.expiresAt > Date.now() + 15000)
      return this.session;
    if (!this.pending) {
      const config = this.config,
        verify = this.verify;
      if (!config?.verification || !verify)
        throw new Error(
          'The live demo is still getting ready. Please try again.',
        );
      this.pending = (async () => {
        const turnstileToken = config.verification!.required
          ? await verify(signal)
          : '';
        signal.throwIfAborted();
        const response = await this.fetcher(base + '/api/demo/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ turnstileToken }),
          signal,
          cache: 'no-store',
        });
        const body: unknown = await response.json().catch(() => undefined);
        if (!response.ok)
          throw new Error(
            apiMessage(
              body,
              'The visitor check could not complete. Please try again.',
            ),
          );
        const session = DemoSessionSchema.parse(body);
        if (
          session.expiresAt <= Date.now() ||
          session.expiresAt > Date.now() + 610000
        )
          throw new Error(
            'The visitor check could not complete. Please try again.',
          );
        this.session = session;
        return session;
      })().finally(() => {
        this.pending = undefined;
      });
    }
    // Waiting callers can cancel promptly without leaving a challenge running.
    return abortable(this.pending, signal);
  }
  async request(
    path: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<Response> {
    const session = await this.access(signal);
    signal.throwIfAborted();
    const response = await this.fetcher(base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + session.token,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
      signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      if (response.status === 401 && this.session?.token === session.token)
        this.clear();
      throw new Error(
        apiMessage(
          await response.json().catch(() => undefined),
          'The live demo is temporarily unavailable. Please try again.',
        ),
      );
    }
    return response;
  }
}
function apiMessage(body: unknown, fallback: string): string {
  const parsed = ApiErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error.message : fallback;
}
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    pending
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
export const demoAccess = new DemoAccess();
