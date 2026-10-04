import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFile, readdir, rm } from 'node:fs/promises';
import { rollup } from 'rollup';
import { dts } from 'rollup-plugin-dts';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = fileURLToPath(new URL('../packages/types/dist/', import.meta.url));
await rm(dist, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    'node_modules/typescript/bin/tsc',
    '-p',
    'packages/types/tsconfig.build.json',
  ],
  { cwd: root, stdio: 'inherit' },
);
await build({
  absWorkingDir: root,
  entryPoints: ['packages/types/src/index.ts'],
  outfile: 'packages/types/dist/index.js',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  external: ['zod'],
});

for (const file of await readdir(join(root, 'packages/types/src'))) {
  if (file.endsWith('.json'))
    await copyFile(
      join(root, 'packages/types/src', file),
      join(dist, 'declarations', file),
    );
}
const declarations = await rollup({
  input: join(dist, 'declarations/index.d.ts'),
  plugins: [
    dts({ tsconfig: join(root, 'packages/types/tsconfig.build.json') }),
  ],
});
try {
  await declarations.write({ file: join(dist, 'index.d.ts'), format: 'es' });
} finally {
  await declarations.close();
}
await rm(join(dist, 'declarations'), { recursive: true, force: true });
