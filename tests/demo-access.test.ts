import { describe, expect, it, vi } from 'vitest';
import { DemoAccess } from '../apps/client/src/demoAccess';
const config = {
  liveAvailable: true,
  maxSessionSeconds: 180,
  verification: { required: true, siteKey: 'site' },
};
const token =
  'a'.repeat(64) + '.' + (Date.now() + 600000) + '.' + 'b'.repeat(64);
const mint = () => Response.json({ token, expiresAt: Date.now() + 600000 });
describe('browser visitor session lifecycle', () => {
  it('verifies once for concurrent requests and attaches fresh idempotency keys', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/api/demo/session')
        ? mint()
        : Response.json({ ok: true }),
    );
    const verify = vi.fn(async () => 'challenge'),
      access = new DemoAccess(fetcher);
    access.configure(config, verify);
    await Promise.all([
      access.request(
        '/api/characters/session',
        {},
        new AbortController().signal,
      ),
      access.request(
        '/api/characters/speech',
        {},
        new AbortController().signal,
      ),
    ]);
    expect(verify).toHaveBeenCalledOnce();
    const paid = fetcher.mock.calls.filter(
      ([url]) => !String(url).endsWith('/api/demo/session'),
    );
    expect(paid).toHaveLength(2);
    const headers = paid.map(([, init]) => new Headers(init?.headers));
    expect(
      headers.every((h) => h.get('Authorization') === 'Bearer ' + token),
    ).toBe(true);
    expect(headers[0]!.get('Idempotency-Key')).not.toBe(
      headers[1]!.get('Idempotency-Key'),
    );
  });
  it('calls a native fetch implementation with its required global receiver', async () => {
    const fetcher = vi.fn(function (this: unknown, url: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(
        String(url).endsWith('/api/demo/session')
          ? mint()
          : Response.json({ ok: true }),
      );
    });
    vi.stubGlobal('fetch', fetcher);
    try {
      const access = new DemoAccess();
      access.configure(config, async () => 'challenge');
      await access.request(
        '/api/characters/session',
        {},
        new AbortController().signal,
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('does not contact a paid endpoint after a failed visitor check', async () => {
    const fetcher = vi.fn<typeof fetch>(),
      access = new DemoAccess(fetcher);
    access.configure(config, async () => {
      throw Error('Check failed');
    });
    await expect(
      access.request(
        '/api/characters/session',
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow('Check failed');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('renews a rejected capability on the next attempt without retrying a paid request automatically', async () => {
    let calls = 0;
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/api/demo/session')
        ? mint()
        : ++calls === 1
          ? Response.json(
              {
                error: {
                  code: 'verification_expired',
                  message: 'Please verify again.',
                },
              },
              { status: 401 },
            )
          : Response.json({ ok: true }),
    );
    const verify = vi.fn(async () => 'challenge'),
      access = new DemoAccess(fetcher);
    access.configure(config, verify);
    await expect(
      access.request(
        '/api/characters/session',
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow('Please verify again.');
    expect(calls).toBe(1);
    await access.request(
      '/api/characters/session',
      {},
      new AbortController().signal,
    );
    expect(verify).toHaveBeenCalledTimes(2);
  });
  it('preserves the friendly quota message and prevents an aborted request from reaching generation', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/api/demo/session')
        ? mint()
        : Response.json(
            {
              error: {
                code: 'demo_limit',
                message: 'The live demo is taking a break for today.',
              },
            },
            { status: 429 },
          ),
    );
    const access = new DemoAccess(fetcher);
    access.configure(config, async () => 'challenge');
    await expect(
      access.request(
        '/api/characters/speech',
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow('taking a break');
    const before = fetcher.mock.calls.length,
      abort = new AbortController();
    abort.abort();
    await expect(
      access.request('/api/characters/speech', {}, abort.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(before);
  });
});
