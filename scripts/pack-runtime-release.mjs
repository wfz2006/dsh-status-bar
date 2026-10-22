// Packages the prebuilt desktop runtime (app + Electron) as its own npm package.
// The plugin keeps working without it, but a first launch fetches this tarball,
// and the npm registry serves 155 MB far faster than a release asset does on
// many networks.
//
//   node scripts/pack-runtime-release.mjs --stage D:\tmp\pack-plugin-0.2.8
//   node scripts/pack-runtime-release.mjs --stage <dir> --publish
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = join(repoRoot, 'packages', 'dsh-status-bar');
const args = process.argv.slice(2);
const value = flag => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
const version = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8')).version;
const stage = value('--stage') ?? join(repoRoot, 'dist', 'runtime-stage');
const outDir = resolve(value('--out') ?? join(repoRoot, 'dist', 'runtime'));
const publish = args.includes('--publish');
const npmConfig = value('--userconfig');

for (const entry of ['app', 'electron']) {
  if (!existsSync(join(stage, entry))) throw new Error(`runtime stage ${stage} is missing ${entry}; run pack-plugin-release.mjs --stage first`);
}
const packageDir = join(stage, '..', `runtime-${version}`);
rmSync(packageDir, { recursive: true, force: true });
mkdirSync(packageDir, { recursive: true });
for (const entry of ['app', 'electron']) cpSync(join(stage, entry), join(packageDir, entry), { recursive: true });
cpSync(join(pluginRoot, 'LICENSE'), join(packageDir, 'LICENSE'));
writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify({
  name: 'dsh-status-bar-runtime',
  version,
  description: 'Prebuilt DSH Status Bar runtime (app + Electron 44.8.0), fetched by dsh-status-bar-plugin on its first launch.',
  license: 'MIT',
  repository: { type: 'git', url: 'git+https://github.com/wfz2006/dsh-status-bar.git', directory: 'packages/dsh-status-bar' },
  files: ['app', 'electron', 'LICENSE'],
}, null, 2)}\n`);

mkdirSync(outDir, { recursive: true });
execFileSync('npm', ['pack', '--pack-destination', outDir], { cwd: packageDir, stdio: 'inherit', shell: true });
const tarball = join(outDir, `dsh-status-bar-runtime-${version}.tgz`);
console.log(`[runtime-pack] ${tarball}`);
if (publish) {
  const config = npmConfig ?? process.env.npm_config_userconfig;
  execFileSync('npm', ['publish', tarball, '--registry', 'https://registry.npmjs.org/', '--access', 'public', ...(config ? ['--userconfig', config] : [])], { cwd: packageDir, stdio: 'inherit', shell: true });
  console.log('[runtime-pack] published');
}
