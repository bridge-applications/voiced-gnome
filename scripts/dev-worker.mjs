import { randomBytes } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = new URL('../', import.meta.url);
const secretFile = new URL('apps/worker/.dev.vars', root);
try {
  const local = parseEnv(await readFile(new URL('.env', root), 'utf8'));
  if (Object.hasOwn(local, 'ELEVENLABS_API_KEY')) {
    let existing = {};
    try {
      existing = parseEnv(await readFile(secretFile, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    existing.ELEVENLABS_API_KEY = local.ELEVENLABS_API_KEY;
    existing.ABUSE_HASH_SECRET ||= randomBytes(32).toString('hex');
    const content =
      Object.entries(existing)
        .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
        .join('\n') + '\n';
    await writeFile(secretFile, content, { mode: 0o600 });
    await chmod(secretFile, 0o600);
    console.log('Using the root .env for the local Worker key.');
  }
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const child = spawn(
  process.execPath,
  [
    fileURLToPath(new URL('node_modules/wrangler/bin/wrangler.js', root)),
    'dev',
    '--port',
    '8787',
    '--env',
    'local',
    ...process.argv.slice(2),
  ],
  { cwd: fileURLToPath(new URL('apps/worker/', root)), stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', () => {
  console.error('Could not start the local Worker. Run npm ci first.');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
