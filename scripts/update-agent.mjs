import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { elevenLabsKey, agentId } from './elevenlabs-auth.mjs';
const key = await elevenLabsKey();
const id = await agentId();
const url = `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(id)}`;
const headers = { 'xi-api-key': key, 'Content-Type': 'application/json' };
const response = await fetch(url, {
  headers,
  signal: AbortSignal.timeout(15000),
});
if (!response.ok)
  throw new Error(`Agent read returned HTTP ${response.status}.`);
const current = await response.json();
const backup = await mkdtemp(join(tmpdir(), 'gnome-agent-backup-'));
await writeFile(join(backup, 'agent.json'), JSON.stringify(current, null, 2));
const template = JSON.parse(
  await readFile(
    new URL('../docs/agent-template.json', import.meta.url),
    'utf8',
  ),
);
const prompt = await readFile(
  new URL('../docs/agent-prompt.txt', import.meta.url),
  'utf8',
);
const agent = {
  first_message: template.conversation_config.agent.first_message,
  prompt: {
    prompt,
    tools: template.conversation_config.agent.prompt.tools,
  },
};
const updated = await fetch(url, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ conversation_config: { agent } }),
  signal: AbortSignal.timeout(20000),
});
if (!updated.ok) {
  const error = await updated.json().catch(() => ({}));
  console.log(
    JSON.stringify(error, (k, v) =>
      ['input', 'ctx'].includes(k) ? undefined : v,
    ),
  );
  throw new Error(
    `Agent update returned HTTP ${updated.status}. Upstream body omitted. Backup: ${backup}`,
  );
}
await updated.body?.cancel();
const verify = await fetch(url, {
  headers,
  signal: AbortSignal.timeout(15000),
});
if (!verify.ok)
  throw new Error(`Agent verification returned HTTP ${verify.status}.`);
const result = await verify.json();
const tools =
  result.conversation_config.agent.prompt.tools?.map((tool) => tool.name) ?? [];
if (!['get_wardrobe', 'change_outfit'].every((name) => tools.includes(name)))
  throw new Error('Wardrobe tools were not confirmed on the agent.');
console.log(
  `Updated and verified ${id}: ${tools.join(', ')}. Backup: ${backup}`,
);
