import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../apps/worker/src/index';
import { networkHash } from '../apps/worker/src/access';
import { testEnv, paidRequest } from './demo-env';
const verifyRequest = (token = 'challenge') =>
  new Request('https://worker.example/api/demo/session', {
    method: 'POST',
    headers: {
      Origin: 'https://gnome.example',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ turnstileToken: token }),
  });
afterEach(() => {
  vi.restoreAllMocks();
});
describe('visitor admission', () => {
  it('checks success, hostname and action before minting any capability', async () => {
    for (const result of [
      { success: false, 'error-codes': ['timeout-or-duplicate'] },
      { success: true, hostname: 'other.example', action: 'gnome_demo' },
      { success: true, hostname: 'gnome.example', action: 'other_action' },
    ]) {
      const env = testEnv();
      const upstream = vi.fn<typeof fetch>(async () => Response.json(result));
      expect((await handleRequest(verifyRequest(), env, upstream)).status).toBe(
        403,
      );
      expect(env.DEMO_SESSIONS.getByName).not.toHaveBeenCalled();
      expect(String(upstream.mock.calls[0]![0])).toBe(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      );
    }
  });
  it('never grants access for an empty, malformed or timed-out verification', async () => {
    for (const upstream of [
      vi.fn<typeof fetch>(async () => {
        throw new DOMException('Timeout', 'TimeoutError');
      }),
      vi.fn<typeof fetch>(async () => new Response('invalid')),
    ]) {
      const env = testEnv();
      expect((await handleRequest(verifyRequest(), env, upstream)).status).toBe(
        503,
      );
      expect(env.DEMO_SESSIONS.getByName).not.toHaveBeenCalled();
    }
    const upstream = vi.fn();
    expect(
      (await handleRequest(verifyRequest(''), testEnv(), upstream)).status,
    ).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('issues an opaque expiring token after successful server verification', async () => {
    const env = testEnv();
    const upstream = vi.fn<typeof fetch>(async () =>
      Response.json({
        success: true,
        hostname: 'gnome.example',
        action: 'gnome_demo',
      }),
    );
    const response = await handleRequest(verifyRequest(), env, upstream);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      token: string;
      expiresAt: number;
    };
    expect(body.token).toMatch(/^[a-f0-9]{64}\.\d{13}\.[a-f0-9]{64}$/);
    expect(body.expiresAt).toBeGreaterThan(Date.now());
    expect(body.expiresAt).toBeLessThanOrEqual(Date.now() + 600000);
    const payload = JSON.parse(String(upstream.mock.calls[0]![1]!.body));
    expect(payload).toEqual({
      secret: env.TURNSTILE_SECRET_KEY,
      response: 'challenge',
    });
    const storedName = vi.mocked(env.DEMO_SESSIONS.getByName).mock.calls[0]![0];
    expect(storedName).not.toBe(body.token);
  });
  it('does not bypass verification when a local environment is deployed remotely', async () => {
    const env = testEnv();
    env.DEMO_ENVIRONMENT = 'local';
    env.TURNSTILE_SECRET_KEY = '';
    const upstream = vi.fn();
    expect(
      (
        await handleRequest(
          new Request('https://remote.workers.dev/api/demo/session', {
            method: 'POST',
            headers: { Origin: 'http://127.0.0.1:5184' },
            body: '{"turnstileToken":""}',
          }),
          env,
          upstream,
        )
      ).status,
    ).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('allows explicit loopback development while retaining the shared quota guards', async () => {
    const env = testEnv();
    env.DEMO_ENVIRONMENT = 'local';
    env.TURNSTILE_SECRET_KEY = '';
    const upstream = vi.fn();
    const response = await handleRequest(
      new Request('http://127.0.0.1:8787/api/demo/session', {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:5184' },
        body: '{"turnstileToken":""}',
      }),
      env,
      upstream,
    );
    expect(response.status).toBe(200);
    expect(upstream).not.toHaveBeenCalled();
    expect(env.DEMO_BUDGET.getByName).toHaveBeenCalledOnce();
  });
  it('rejects Cloudflare test keys in production and hashes network identifiers with a daily salt', async () => {
    const env = testEnv();
    env.TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
    expect((await handleRequest(verifyRequest(), env, vi.fn())).status).toBe(
      503,
    );
    const req = verifyRequest();
    req.headers.set('CF-Connecting-IP', '192.0.2.12');
    const a = await networkHash(req, testEnv(), '2026-10-04');
    const b = await networkHash(req, testEnv(), '2026-10-05');
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('192.0.2.12');
  });
});
describe('cost-bearing boundaries', () => {
  it('stops all old endpoints and the kill switch before upstream work', async () => {
    const upstream = vi.fn();
    for (const path of [
      '/api/session',
      '/api/story/session',
      '/api/story/speech',
    ]) {
      expect(
        (
          await handleRequest(
            new Request('https://worker.example' + path, {
              method: 'POST',
              headers: { Origin: 'https://gnome.example' },
            }),
            testEnv(),
            upstream,
          )
        ).status,
      ).toBe(404);
    }
    const env = testEnv();
    env.DEMO_ENABLED = 'false';
    for (const path of ['speech', 'session'])
      expect(
        (
          await handleRequest(
            paidRequest(path, { characterId: 'pip', text: 'Hi' }),
            env,
            upstream,
          )
        ).status,
      ).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('rejects forged capabilities before allocating or consulting a Durable Object', async () => {
    const env = testEnv(),
      upstream = vi.fn();
    const request = paidRequest('session', { characterId: 'pip' });
    request.headers.set(
      'Authorization',
      'Bearer ' +
        'a'.repeat(64) +
        '.' +
        (Date.now() + 600000) +
        '.' +
        'b'.repeat(64),
    );
    expect((await handleRequest(request, env, upstream)).status).toBe(401);
    expect(env.DEMO_SESSIONS.getByName).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });
  it('rejects tampered expiry and cross-origin capability replay before storage lookup', async () => {
    for (const variant of ['expiry', 'origin']) {
      const env = testEnv(),
        upstream = vi.fn();
      const request = paidRequest('session', { characterId: 'pip' });
      if (variant === 'expiry') {
        const token = request.headers
          .get('Authorization')!
          .split(' ')[1]!
          .split('.');
        token[1] = String(Date.now() + 86400000);
        request.headers.set('Authorization', 'Bearer ' + token.join('.'));
      } else request.headers.set('Origin', 'http://127.0.0.1:5184');
      expect((await handleRequest(request, env, upstream)).status).toBe(401);
      expect(env.DEMO_SESSIONS.getByName).not.toHaveBeenCalled();
      expect(upstream).not.toHaveBeenCalled();
    }
  });
  it('requires a valid token and idempotency key on every paid route', async () => {
    const upstream = vi.fn();
    for (const path of ['speech', 'session']) {
      const body =
        path === 'speech'
          ? { characterId: 'pip', text: 'Hello' }
          : { characterId: 'pip' };
      for (const [header, status] of [
        ['Authorization', 401],
        ['Idempotency-Key', 400],
      ] as const) {
        const request = paidRequest(path, body);
        request.headers.delete(header);
        expect((await handleRequest(request, testEnv(), upstream)).status).toBe(
          status,
        );
      }
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it('rejects expired capabilities and exhaustion before contacting ElevenLabs', async () => {
    for (const scope of ['DEMO_SESSIONS', 'DEMO_BUDGET'] as const) {
      const env = testEnv();
      vi.mocked(env[scope].getByName).mockReturnValue({
        reserve: async () => ({
          ok: false,
          code:
            scope === 'DEMO_SESSIONS' ? 'verification_expired' : 'demo_limit',
          status: scope === 'DEMO_SESSIONS' ? 401 : 429,
          retryAfter: 60,
        }),
        finish: vi.fn(),
      } as never);
      const upstream = vi.fn();
      const response = await handleRequest(
        paidRequest('speech', { characterId: 'pip', text: 'Hello' }),
        env,
        upstream,
      );
      expect(response.status).toBe(scope === 'DEMO_SESSIONS' ? 401 : 429);
      expect(upstream).not.toHaveBeenCalled();
    }
  });
  it('fails closed when the global coordinator is unavailable', async () => {
    const env = testEnv();
    vi.mocked(env.DEMO_BUDGET.getByName).mockReturnValue({
      reserve: async () => {
        throw Error('Unavailable');
      },
    } as never);
    const upstream = vi.fn();
    expect(
      (
        await handleRequest(
          paidRequest('session', { characterId: 'pip' }),
          env,
          upstream,
        )
      ).status,
    ).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('releases leases after upstream failure without refunding an uncertain charge', async () => {
    const env = testEnv();
    const finish = vi.fn();
    const reserve = vi.fn(async () => ({ ok: true }));
    vi.mocked(env.DEMO_SESSIONS.getByName).mockReturnValue({
      reserve,
      finish,
    } as never);
    const response = await handleRequest(
      paidRequest('speech', { characterId: 'pip', text: 'Hello' }),
      env,
      async () => {
        throw new DOMException('Timeout', 'TimeoutError');
      },
    );
    expect(response.status).toBe(502);
    expect(reserve).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
  });
  it('does not follow provider redirects with the secret key', async () => {
    const upstream = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 307,
          headers: { Location: 'https://untrusted.example/' },
        }),
    );
    for (const path of ['session', 'speech']) {
      const body =
        path === 'speech'
          ? { characterId: 'pip', text: 'Hello' }
          : { characterId: 'pip' };
      expect(
        (await handleRequest(paidRequest(path, body), testEnv(), upstream))
          .status,
      ).toBe(502);
    }
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(
      upstream.mock.calls.every(([, init]) => init?.redirect === 'manual'),
    ).toBe(true);
  });
  it('keeps speech leases until the stream finishes or is cancelled', async () => {
    const env = testEnv();
    const finish = vi.fn(async () => undefined);
    vi.mocked(env.DEMO_SESSIONS.getByName).mockReturnValue({
      reserve: async () => ({ ok: true }),
      finish,
    } as never);
    const response = await handleRequest(
      paidRequest('speech', { characterId: 'pip', text: 'Hello' }),
      env,
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array([1]));
            },
          }),
        ),
    );
    expect(response.status).toBe(200);
    expect(finish).not.toHaveBeenCalled();
    await response.body!.cancel();
    expect(finish).toHaveBeenCalledOnce();
  });
  it('bounds audio and cleans up an oversized stream', async () => {
    const env = testEnv();
    const finish = vi.fn(async () => undefined);
    vi.mocked(env.DEMO_SESSIONS.getByName).mockReturnValue({
      reserve: async () => ({ ok: true }),
      finish,
    } as never);
    const response = await handleRequest(
      paidRequest('speech', { characterId: 'pip', text: 'Hello' }),
      env,
      async () => new Response(new Uint8Array(2000001)),
    );
    await expect(response.arrayBuffer()).rejects.toThrow('limit');
    expect(finish).toHaveBeenCalledOnce();
  });
});
