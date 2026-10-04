import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = new URL('../', import.meta.url);
const metadata = JSON.parse(
  await readFile(new URL('docs/preview-audio.json', root), 'utf8'),
);
const temporary = await mkdtemp(join(tmpdir(), 'gnome-cues-'));
try {
  const results = await Promise.all(
    Object.entries(metadata.clips).map(async ([name, clip]) => {
      const base = join(temporary, name);
      await writeFile(base + '.txt', clip.text);
      await run(process.env.FFMPEG_PATH || 'ffmpeg', [
        '-loglevel',
        'error',
        '-y',
        '-i',
        fileURLToPath(new URL('apps/client/public' + clip.file, root)),
        '-ar',
        '16000',
        '-ac',
        '1',
        base + '.wav',
      ]);
      await run(process.env.RHUBARB_PATH || 'rhubarb', [
        '-f',
        'json',
        '--extendedShapes',
        'GHX',
        '--threads',
        '2',
        '-d',
        base + '.txt',
        '-o',
        base + '.json',
        base + '.wav',
      ]);
      const data = JSON.parse(await readFile(base + '.json', 'utf8'));
      return {
        name,
        duration: data.metadata.duration,
        mouthCues: data.mouthCues,
      };
    }),
  );
  for (const { name, ...data } of results) {
    await writeFile(
      new URL(`apps/client/public/preview/${name}.json`, root),
      JSON.stringify(data) + '\n',
    );
    console.log(`${name}: ${data.duration}s, ${data.mouthCues.length} cues`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
