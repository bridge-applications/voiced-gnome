import { describe, expect, it, vi } from 'vitest';
import { handleRequest, readBoundedJson } from '../apps/worker/src/index';
import { testEnv, paidRequest } from './demo-env';
describe('public Worker boundaries', () => {
  it('reports only public configuration, including visitor verification', async () => {
    const response = await handleRequest(
      new Request('https://worker.example/api/config'),
      testEnv(),
    );
    expect(await response.json()).toEqual({
      liveAvailable: true,
      charactersAvailable: true,
      maxSessionSeconds: 180,
      verification: { required: true, siteKey: 'public-site-key' },
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('fails closed if production credentials or bindings are missing', async () => {
    for (const field of [
      'ABUSE_HASH_SECRET',
      'TURNSTILE_SITE_KEY',
      'TURNSTILE_SECRET_KEY',
      'DEMO_BUDGET',
      'DEMO_SESSIONS',
    ] as const) {
      const env = testEnv();
      Object.assign(env, { [field]: undefined });
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
      const config = await handleRequest(
        new Request('https://worker.example/api/config'),
        env,
      );
      expect(await config.json()).toMatchObject({ charactersAvailable: false });
    }
  });
  it('supports Authorization and idempotency preflights only for approved origins', async () => {
    for (const origin of ['https://gnome.example', 'https://other.example']) {
      const response = await handleRequest(
        new Request('https://worker.example/api/characters/session', {
          method: 'OPTIONS',
          headers: { Origin: origin },
        }),
        testEnv(),
      );
      expect(response.status).toBe(
        origin === 'https://gnome.example' ? 204 : 403,
      );
      if (response.status === 204)
        expect(response.headers.get('access-control-allow-headers')).toContain(
          'Authorization',
        );
      else
        expect(response.headers.has('access-control-allow-origin')).toBe(false);
    }
  });
  it('advertises local availability on a same-origin configuration GET without permitting bodyless paid requests', async () => {
    const env = testEnv();
    env.DEMO_ENVIRONMENT = 'local';
    env.TURNSTILE_SECRET_KEY = '';
    const response = await handleRequest(
      new Request('http://127.0.0.1:8787/api/config'),
      env,
    );
    expect(await response.json()).toMatchObject({
      charactersAvailable: true,
      verification: { required: false },
    });
    const upstream = vi.fn();
    expect(
      (
        await handleRequest(
          new Request('http://127.0.0.1:8787/api/demo/session', {
            method: 'POST',
          }),
          env,
          upstream,
        )
      ).status,
    ).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('rejects an absent origin and forged allowed origin without a visitor token', async () => {
    const upstream = vi.fn();
    const request = paidRequest('session', { characterId: 'pip' });
    request.headers.delete('Origin');
    expect((await handleRequest(request, testEnv(), upstream)).status).toBe(
      403,
    );
    request.headers.set('Origin', 'https://gnome.example');
    request.headers.delete('Authorization');
    expect((await handleRequest(request, testEnv(), upstream)).status).toBe(
      401,
    );
    expect(upstream).not.toHaveBeenCalled();
  });
  it('rejects non-POST calls, oversized bodies and unsupported models', async () => {
    const upstream = vi.fn();
    expect(
      (
        await handleRequest(
          new Request('https://worker.example/api/characters/session', {
            headers: { Origin: 'https://gnome.example' },
          }),
          testEnv(),
          upstream,
        )
      ).status,
    ).toBe(405);
    for (const body of [
      { characterId: 'pip', model: 'expensive' },
      { characterId: 'pip', text: 'a'.repeat(5000) },
    ])
      expect(
        (await handleRequest(paidRequest('speech', body), testEnv(), upstream))
          .status,
      ).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('bounds streamed JSON without trusting Content-Length', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(17000));
      },
      cancel,
    });
    await expect(readBoundedJson(new Response(stream))).rejects.toThrow(
      'exceeds limit',
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
});
