// Assembles the light npm package: the bundle entry, its patch, docs and
// screenshots, but not the 388 MB of app + Electron runtime. The npm build
// fetches that runtime once on first launch (see lib/index.js).
//
//   node scripts/pack-npm-release.mjs [--out <dir>] [--no-pack]
//
// The release tarball (dist/dsh-status-bar.tgz, built by
// pack-plugin-release.mjs) stays self-contained; this script only produces the
// registry copy so `dsh plugin add dsh-status-bar` is a ~1.6 MB download.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = join(repoRoot, 'packages', 'dsh-status-bar');

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outDir = resolve(outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] : join(repoRoot, 'dist', 'npm'));
const runPack = !args.includes('--no-pack');

const RUNTIME_URL = 'https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-status-bar.tgz';
const COPIED = ['lib', 'cordis.patch.yml', 'README.md', 'LICENSE', 'assets', 'screenshots.json'];

const manifest = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'));
manifest.files = [...COPIED];
manifest.dsh = { ...manifest.dsh, statusBar: { runtime: RUNTIME_URL } };

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const entry of COPIED) {
  cpSync(join(pluginRoot, entry), join(outDir, entry), { recursive: true });
}
writeFileSync(join(outDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

if (!runPack) {
  console.log(`[npm-pack] staged ${outDir}`);
  process.exit(0);
}

execFileSync('npm', ['pack', '--pack-destination', outDir], { cwd: outDir, stdio: 'inherit', shell: true });
const tarball = join(outDir, `${manifest.name}-${manifest.version}.tgz`);
console.log(`[npm-pack] ${manifest.name}@${manifest.version} -> ${tarball}`);
console.log('[npm-pack] publish with: npm publish "' + outDir + '" --registry https://registry.npmjs.org/');
