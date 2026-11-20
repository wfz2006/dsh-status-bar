// Run after pack-plugin-release.mjs with the same --stage and --out values.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { sha256File } from '../packages/dsh-status-bar/lib/split-runtime.js';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return resolve(index === -1 ? fallback : process.argv[index + 1]);
};
const stage = arg('--stage', 'packages/dsh-status-bar');
const out = arg('--out', 'dist');
const { version } = JSON.parse(readFileSync(join(stage, 'app/package.json'), 'utf8'));
const electron = createRequire(resolve('apps/desktop/package.json'))('electron/package.json');
const archive = join(out, 'dsh-status-bar-app.tgz');
// Derive the exact file list from npm's archive. npm can omit files in staging.
const prefix = 'package/electron/dist/';
const names = execFileSync('tar', ['-tzf', join(out, 'dsh-status-bar.tgz')], { encoding: 'utf8' })
  .split(/\r?\n/).filter(name => name.startsWith(prefix) && !name.endsWith('/')).map(name => name.slice(prefix.length));
if (!names.includes('electron.exe')) throw new Error('Windows Electron runtime is missing from the release bundle');
const engineFiles = {};
for (const name of names.sort()) engineFiles[name] = await sha256File(join(stage, 'electron', 'dist', name));
const temporary = mkdtempSync(join(out, 'app-stage-'));
try {
  cpSync(join(stage, 'app'), join(temporary, 'package', 'app'), { recursive: true });
  execFileSync('tar', ['-czf', archive, '-C', temporary, 'package'], { stdio: 'inherit' });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
const manifest = {
  version,
  platform: process.platform,
  arch: process.arch,
  electronVersion: electron.version,
  app: {
    url: `https://github.com/wfz2006/dsh-status-bar/releases/download/v${version}/dsh-status-bar-app.tgz`,
    sha256: await sha256File(archive),
  },
  engineFiles,
};
writeFileSync(join(out, 'split-runtime.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`[app-pack] ${archive}`);
