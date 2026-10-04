import { createHmac } from 'node:crypto';
import { vi } from 'vitest';
export function testEnv(): Env {
  return {
    ALLOWED_ORIGINS: 'https://gnome.example,http://127.0.0.1:5184',
    DEMO_ENABLED: 'true',
    DEMO_ENVIRONMENT: 'production',
    DEMO_DAILY_CONVERSATIONS: '60',
    DEMO_DAILY_TTS_CHARACTERS: '20000',
    TURNSTILE_SITE_KEY: 'public-site-key',
    TURNSTILE_SECRET_KEY: 'private-turnstile-key',
    ABUSE_HASH_SECRET: 'test-hash-secret-with-at-least-32-characters',
    ELEVENLABS_AGENT_ID: '',
    ELEVENLABS_API_KEY: 'private-test-key',
    MAX_SESSION_SECONDS: '180',
    CHARACTER_AGENT_ID: 'characters',
    STORY_PLANNER_AGENT_ID: '',
    STORY_CHARACTER_AGENT_ID: '',
    DEMO_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    SESSION_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    STORY_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    DEMO_SESSIONS: {
      getByName: vi.fn(() => ({
        initialize: vi.fn(async () => Date.now() + 600000),
        reserve: vi.fn(async () => ({ ok: true })),
        finish: vi.fn(async () => undefined),
      })),
    },
    DEMO_BUDGET: {
      getByName: vi.fn(() => ({
        reserve: vi.fn(async () => ({ ok: true })),
        finish: vi.fn(async () => undefined),
      })),
    },
  } as Env;
}
export function paidRequest(
  path: string,
  body: unknown,
  origin = 'https://gnome.example',
): Request {
  const payload = 'a'.repeat(64) + '.' + (Date.now() + 600000);
  const token =
    payload +
    '.' +
    createHmac('sha256', testEnv().ABUSE_HASH_SECRET)
      .update('demo:' + payload + ':' + origin)
      .digest('hex');
  return new Request('https://worker.example/api/characters/' + path, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}
