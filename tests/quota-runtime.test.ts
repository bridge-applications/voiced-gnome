import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
let runtime: Miniflare, directory: string, scriptPath: string, script: string;
function createRuntime() {
  return new Miniflare({
    ...convertV4MiniflareOptions({
      name: 'quota-tests',
      modules: true,
      script,
      compatibilityDate: '2026-10-03',
      compatibilityFlags: ['nodejs_compat'],
      durableObjects: {
        SESSIONS: { className: 'SessionUnderTest', useSQLite: true },
        BUDGETS: { className: 'DemoBudget', useSQLite: true },
      },
      bindings: {
        DEMO_DAILY_TTS_CHARACTERS: '100',
        DEMO_DAILY_CONVERSATIONS: '3',
      },
    }),
    resourcePersistencePath: join(directory, 'storage'),
  });
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gnome-quota-runtime-'));
  scriptPath = join(directory, 'worker.js');
  await build({
    entryPoints: ['tests/fixtures/quota-worker.ts'],
    outfile: scriptPath,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    external: ['cloudflare:workers'],
  });
  script = await readFile(scriptPath, 'utf8');
  runtime = createRuntime();
}, 30000);
afterAll(async () => {
  await runtime?.dispose();
  if (directory) await rm(directory, { recursive: true, force: true });
});
const day = () => new Date().toISOString().slice(0, 10);
async function rpc(body: Record<string, unknown>) {
  const response = await runtime.dispatchFetch('https://test.invalid/', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    ok: boolean;
    code?: string;
    status?: number;
  }>;
}
const reserveBudget = (
  name: string,
  id: string,
  characters: number,
  operation = 'speech',
) =>
  rpc({
    type: 'budget',
    method: 'reserve',
    name,
    id,
    ip: 'test-network',
    day: day(),
    operation,
    characters,
  });
const finishBudget = (name: string, id: string) =>
  rpc({ type: 'budget', method: 'finish', name, id });
const visitor = (
  name: string,
  method: string,
  id = crypto.randomUUID(),
  extra = {},
) =>
  rpc({
    type: 'session',
    name,
    method,
    id,
    origin: 'https://tesselpunt.com',
    operation: 'conversation',
    ...extra,
  });
describe('SQLite quotas in the real Workers runtime', () => {
  it('allows exactly one claimant for the final allowance under parallel requests', async () => {
    expect((await reserveBudget('race', 'seed', 90)).ok).toBe(true);
    await finishBudget('race', 'seed');
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        reserveBudget('race', String(i), 10),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      results.filter((r) => !r.ok).every((r) => r.code === 'demo_limit'),
    ).toBe(true);
  });
  it('does not charge or generate twice for a reused request ID', async () => {
    expect((await reserveBudget('duplicate', 'request', 40)).ok).toBe(true);
    await finishBudget('duplicate', 'request');
    expect(await reserveBudget('duplicate', 'request', 40)).toMatchObject({
      ok: false,
      code: 'duplicate_request',
      status: 409,
    });
    expect((await reserveBudget('duplicate', 'next', 60)).ok).toBe(true);
    expect(await reserveBudget('duplicate', 'overflow', 1)).toMatchObject({
      ok: false,
      code: 'demo_limit',
    });
  });
  it('limits aggregate speech concurrency and reopens only the lease on completion', async () => {
    expect((await reserveBudget('concurrency', 'a', 20)).ok).toBe(true);
    expect((await reserveBudget('concurrency', 'b', 20)).ok).toBe(true);
    expect(await reserveBudget('concurrency', 'c', 20)).toMatchObject({
      ok: false,
      code: 'demo_busy',
    });
    await finishBudget('concurrency', 'a');
    expect((await reserveBudget('concurrency', 'c', 20)).ok).toBe(true);
    await finishBudget('concurrency', 'b');
    await finishBudget('concurrency', 'c');
    expect(await reserveBudget('concurrency', 'remaining', 41)).toMatchObject({
      ok: false,
      code: 'demo_limit',
    });
  });
  it('reserves the daily conversation count atomically', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        reserveBudget('conversations', String(i), 0, 'conversation'),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
  });
  it('enforces verification issuance limits for a network without storing its IP', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        reserveBudget('verification', String(i), 0, 'verification'),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(20);
    expect(
      results.filter((r) => !r.ok).every((r) => r.code === 'network_limit'),
    ).toBe(true);
  });
  it('rejects unknown, expired and differently scoped visitor capabilities', async () => {
    expect(await visitor('unknown', 'reserve')).toMatchObject({ status: 401 });
    await visitor('expiry', 'init');
    expect(
      await visitor('expiry', 'reserve', 'wrong-origin', {
        origin: 'https://other.example',
      }),
    ).toMatchObject({ status: 401 });
    await visitor('expiry', 'expire');
    expect(await visitor('expiry', 'reserve')).toMatchObject({ status: 401 });
  });
  it('locks overlapping requests and retains the session allowance after finishing', async () => {
    await visitor('visitor-limits', 'init');
    expect((await visitor('visitor-limits', 'reserve', 'first')).ok).toBe(true);
    expect(await visitor('visitor-limits', 'reserve', 'overlap')).toMatchObject(
      { code: 'request_in_progress' },
    );
    await visitor('visitor-limits', 'finish', 'first');
    expect(await visitor('visitor-limits', 'reserve', 'first')).toMatchObject({
      code: 'duplicate_request',
    });
    for (let i = 0; i < 3; i++) {
      expect((await visitor('visitor-limits', 'reserve', String(i))).ok).toBe(
        true,
      );
      await visitor('visitor-limits', 'finish', String(i));
    }
    expect(await visitor('visitor-limits', 'reserve', 'fifth')).toMatchObject({
      code: 'visitor_limit',
    });
  });
  it('preserves consumed quota across a runtime restart', async () => {
    expect((await reserveBudget('persistent', 'before', 90)).ok).toBe(true);
    await finishBudget('persistent', 'before');
    await runtime.dispose();
    runtime = createRuntime();
    expect(await reserveBudget('persistent', 'after', 11)).toMatchObject({
      code: 'demo_limit',
    });
    expect(await reserveBudget('persistent', 'before', 90)).toMatchObject({
      code: 'duplicate_request',
    });
  }, 30000);
});
