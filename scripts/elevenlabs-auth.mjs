import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
export async function elevenLabsKey() {
  if (process.env.ELEVENLABS_API_KEY?.trim())
    return process.env.ELEVENLABS_API_KEY;
  for (const path of ['../.env', '../apps/worker/.dev.vars']) {
    try {
      const env = parseEnv(
        await readFile(new URL(path, import.meta.url), 'utf8'),
      );
      if (env.ELEVENLABS_API_KEY?.trim()) return env.ELEVENLABS_API_KEY;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error('ELEVENLABS_API_KEY is not configured.');
}
export async function agentId() {
  const text = await readFile(
    new URL('../apps/worker/wrangler.jsonc', import.meta.url),
    'utf8',
  );
  const id = text.match(/"ELEVENLABS_AGENT_ID"\s*:\s*"([^"]+)"/)?.[1];
  if (!id) throw new Error('The ElevenLabs agent is not configured.');
  return id;
}
