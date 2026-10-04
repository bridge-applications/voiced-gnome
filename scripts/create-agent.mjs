import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const config = JSON.parse(
  await readFile(
    new URL('../docs/agent-template.json', import.meta.url),
    'utf8',
  ),
);
const prompt = await readFile(
  new URL('../docs/agent-prompt.txt', import.meta.url),
  'utf8',
);
config.conversation_config.agent.prompt.prompt = prompt;
config.conversation_config.tts.voice_id =
  process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
const origins = (
  process.env.GNOME_ALLOWED_ORIGINS ||
  'http://127.0.0.1:5184,http://localhost:5184'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
config.platform_settings.auth.allowlist = origins.map((origin) => ({
  hostname: new URL(origin).hostname,
}));
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify(config, null, 2));
  process.exit(0);
}
const workerConfig = await readFile(
  new URL('../apps/worker/wrangler.jsonc', import.meta.url),
  'utf8',
);
const existingAgent = workerConfig.match(
  /"ELEVENLABS_AGENT_ID"\s*:\s*"([^"]+)"/,
)?.[1];
if (existingAgent && !process.argv.includes('--new')) {
  console.log(
    `Agent ${existingAgent} is already connected. Use --new only if you want to create another agent.`,
  );
  process.exit(0);
}
let apiKey = process.env.ELEVENLABS_API_KEY;
for (const path of ['../.env', '../apps/worker/.dev.vars']) {
  if (apiKey?.trim()) break;
  try {
    const local = parseEnv(
      await readFile(new URL(path, import.meta.url), 'utf8'),
    );
    apiKey = local.ELEVENLABS_API_KEY;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
if (!apiKey?.trim()) {
  console.error(
    'Set ELEVENLABS_API_KEY in the root .env, apps/worker/.dev.vars or your environment. Never commit this key.',
  );
  process.exit(1);
}

try {
  const modelsResponse = await fetch(
    'https://api.elevenlabs.io/v1/convai/llm/list',
    {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!modelsResponse.ok)
    throw new Error(
      `Could not list supported LLMs (HTTP ${modelsResponse.status}).`,
    );
  const models = await modelsResponse.json();
  const ids = Array.isArray(models.llms)
    ? models.llms
        .filter(
          (item) =>
            !item.is_deprecated && !item.deprecation_info?.is_deprecated,
        )
        .map((item) => item.llm)
    : [];
  const llm =
    process.env.ELEVENLABS_LLM ||
    ['gemini-3.8-flash', 'gemini-2.5-flash'].find((id) => ids.includes(id));
  if (!llm || !ids.includes(llm))
    throw new Error(
      'No configured Gemini Flash model is available. Set ELEVENLABS_LLM to a supported model ID.',
    );
  config.conversation_config.agent.prompt.llm = llm;
  const voice = await fetch(
    `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(config.conversation_config.tts.voice_id)}`,
    {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!voice.ok)
    throw new Error(
      `The selected voice is unavailable (HTTP ${voice.status}). Set ELEVENLABS_VOICE_ID to a voice in your account.`,
    );
  await voice.body?.cancel();
  const response = await fetch(
    'https://api.elevenlabs.io/v1/convai/agents/create',
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Agent creation returned HTTP ${response.status}. Check your account, voice and agent settings. The upstream body is omitted to keep logs free of sensitive data.`,
    );
  const result = await response.json();
  if (typeof result.agent_id !== 'string')
    throw new Error(
      'Agent creation returned no agent ID. Check the ElevenLabs dashboard before retrying.',
    );
  console.log(`Created agent ${result.agent_id} using ${llm}.`);
  console.log(
    `Set ELEVENLABS_AGENT_ID in apps/worker/wrangler.jsonc, then restart the local Worker.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Agent setup failed.');
  // A timeout may still have created an agent. Avoid automatic duplicate creation.
  console.error(
    'If the create request timed out, check the ElevenLabs dashboard before retrying.',
  );
  process.exitCode = 1;
}
