import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { elevenLabsKey } from './elevenlabs-auth.mjs';
import { assertAgentSecurity } from './agent-security.mjs';
const config = await readFile(
  new URL('../apps/worker/wrangler.jsonc', import.meta.url),
  'utf8',
);
const id = config.match(/"CHARACTER_AGENT_ID"\s*:\s*"([^"]+)"/)?.[1];
if (!id) throw Error('No character agent configured.');
const headers = {
  'xi-api-key': await elevenLabsKey(),
  'Content-Type': 'application/json',
};
const url = 'https://api.elevenlabs.io/v1/convai/agents/' + id;
async function getAgent() {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error('Agent lookup failed: ' + response.status);
  return response.json();
}
let agent = await getAgent();
if (process.argv.includes('--apply')) {
  const directory = await mkdtemp(join(tmpdir(), 'gnome-agent-security-'));
  await writeFile(join(directory, 'agent-before.json'), JSON.stringify(agent), {
    mode: 0o600,
  });
  const response = await fetch(url, {
    method: 'PATCH',
    headers,
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      conversation_config: {
        conversation: {
          ...agent.conversation_config.conversation,
          max_duration_seconds: 180,
        },
      },
      platform_settings: {
        auth: {
          ...agent.platform_settings.auth,
          enable_auth: true,
          allowlist: [],
        },
        call_limits: {
          ...agent.platform_settings.call_limits,
          daily_limit: 60,
          agent_concurrency_limit: 2,
          bursting_enabled: false,
        },
        overrides: {
          ...agent.platform_settings.overrides,
          custom_llm_extra_body: false,
          custom_llm_extra_headers: false,
          conversation_config_override: {
            agent: { first_message: true },
            conversation: { text_only: true, max_duration_seconds: false },
            tts: { voice_id: true },
          },
        },
      },
    }),
  });
  if (!response.ok) {
    // Provider errors may include sensitive context; never print their bodies.
    await response.body?.cancel();
    throw Error('Agent hardening failed: ' + response.status);
  }
  await response.body?.cancel();
  agent = await getAgent();
  console.log(
    'Applied agent protections; backup saved to ' +
      join(directory, 'agent-before.json'),
  );
}
assertAgentSecurity(agent);
console.log(
  'Verified: authenticated agent, 180s maximum, at most two concurrent calls, 60/day, no bursting, restricted overrides, v4 Turbo.',
);
