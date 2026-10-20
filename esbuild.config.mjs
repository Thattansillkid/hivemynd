import esbuild from 'esbuild';
import { builtinModules } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Builds main.js into the repository root (the release asset Obsidian downloads).
// Set HIVEMYND_VAULT to a vault folder to also copy the build into
// <vault>/.obsidian/plugins/hivemynd for testing.

const ROOT = fileURLToPath(new URL('.', import.meta.url));
process.chdir(ROOT);
const production = process.argv[2] === 'production';

// The force layout runs in a Web Worker and the web viewer ships its own browser
// bundle. Both are built first and inlined as strings so the plugin stays a single
// main.js, which is what the community directory expects.
const common = { absWorkingDir: ROOT, bundle: true, format: 'iife', target: 'es2020', minify: production, write: false, legalComments: 'none' };
const worker = await esbuild.build({ ...common, entryPoints: ['src/layout.worker.ts'] });
const workerText = JSON.stringify(worker.outputFiles[0].text);
const viewer = await esbuild.build({ ...common, entryPoints: ['src/viewer.client.ts'], define: { __LAYOUT_WORKER__: workerText } });

await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'cjs',
  target: 'es2020',
  platform: 'browser',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtinModules],
  outfile: 'main.js',
  minify: production,
  sourcemap: production ? false : 'inline',
  legalComments: 'none',
  define: { __LAYOUT_WORKER__: workerText, __VIEWER_JS__: JSON.stringify(viewer.outputFiles[0].text) },
  logLevel: 'info',
});

const vault = process.env.HIVEMYND_VAULT;
if (vault) {
  const dir = path.join(vault, '.obsidian', 'plugins', 'hivemynd');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['main.js', 'manifest.json', 'styles.css']) fs.copyFileSync(f, path.join(dir, f));
  console.log(`copied to ${dir}`);
}
