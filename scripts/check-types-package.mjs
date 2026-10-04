import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'gnome-types-check-'));
try {
  const packed = JSON.parse(
    execFileSync(
      'npm',
      [
        'pack',
        '--workspace',
        '@bridge-applications/voiced-gnome-types',
        '--pack-destination',
        directory,
        '--json',
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    ),
  );
  assert.equal(packed.length, 1);
  const pkg = packed[0];
  for (const file of pkg.files) {
    assert(
      /^(dist\/[^/]+\.(?:js|d\.ts|json)|README\.md|package\.json)$/.test(
        file.path,
      ),
      `Unexpected package file: ${file.path}`,
    );
  }
  assert(pkg.files.some((file) => file.path === 'dist/index.js'));
  assert(pkg.files.some((file) => file.path === 'dist/index.d.ts'));
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  execFileSync(
    'npm',
    [
      'install',
      join(directory, pkg.filename),
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
    { cwd: directory, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  await writeFile(
    join(directory, 'consumer.mjs'),
    `import assert from 'node:assert/strict';
import { CHARACTERS, ConfigSchema, CharacterSpeechSchema } from '@bridge-applications/voiced-gnome-types';
assert.equal(CHARACTERS.length, 18);
assert(ConfigSchema.safeParse({ liveAvailable: false, maxSessionSeconds: 180 }).success);
assert(!CharacterSpeechSchema.safeParse({ characterId: 'missing', text: '' }).success);
`,
  );
  execFileSync(process.execPath, ['consumer.mjs'], {
    cwd: directory,
    stdio: 'inherit',
  });
  await writeFile(
    join(directory, 'consumer.ts'),
    `import { CHARACTERS, ConfigSchema, OUTFIT_LOOKS, type AppConfig, type OutfitLook } from '@bridge-applications/voiced-gnome-types';
const config: AppConfig = ConfigSchema.parse({ liveAvailable: false, maxSessionSeconds: 180 });
const characterId: string = CHARACTERS[0]!.id;
const look: OutfitLook = 'classic';
const outfit = OUTFIT_LOOKS[look].outfit;
// @ts-expect-error Catalog look IDs remain a literal union in published declarations.
const invalidLook: OutfitLook = 'does_not_exist';
void [config, characterId, outfit, invalidLook];
`,
  );
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      'consumer.ts',
    ],
    { cwd: directory, stdio: 'inherit' },
  );
  const metadata = JSON.parse(
    await readFile(
      join(
        directory,
        'node_modules/@bridge-applications/voiced-gnome-types/package.json',
      ),
      'utf8',
    ),
  );
  assert.equal(metadata.repository.directory, 'packages/types');
  assert.equal(metadata.publishConfig.registry, 'https://npm.pkg.github.com');
  console.log(
    `Verified packed package: ${pkg.files.length} permitted files; isolated Node ESM and TypeScript consumers pass.`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
