#!/usr/bin/env node
// Assembles the self-contained release tarball for `dsh-glass-plugin`.
//
// The plugin has to work when the market installs it into an arbitrary profile:
// nothing is built or downloaded at install time. So the tarball carries
//
//   app/            the built desktop renderer + main bundle (+ native helper)
//   electron/dist/  the Electron runtime the app is launched with
//   lib/ cordis.patch.yml LICENSE README.md screenshots.json assets/
//
// `app/` and `electron/` are generated and git-ignored. Usage:
//
//   node scripts/pack-plugin-release.mjs [--no-build] [--out <dir>]
//
// The resulting file is renamed to `dsh-glass-plugin.tgz` so a release asset can
// keep a version-free name (releases/latest/download/dsh-glass-plugin.tgz).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktopDir = join(repoRoot, 'apps', 'desktop');
const pluginDir = join(repoRoot, 'packages', 'dsh-plugin');
const args = process.argv.slice(2);
const noBuild = args.includes('--no-build');
const outIndex = args.indexOf('--out');
const outDir = resolve(outIndex === -1 ? join(repoRoot, 'dist') : args[outIndex + 1]);

const version = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8')).version;

function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`[pack] ${command} ${commandArgs.join(' ')} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

function sizeOf(path) {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  return stat.isDirectory() ? 0 : stat.size;
}

function mib(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function electronDistDir() {
  const requireFromDesktop = createRequire(join(desktopDir, 'package.json'));
  try {
    return join(dirname(requireFromDesktop.resolve('electron/package.json')), 'dist');
  } catch {
    console.error('[pack] could not resolve the `electron` package from apps/desktop; run `pnpm install` first');
    process.exit(1);
  }
}

// 1. Desktop build. The root `pnpm build` also compiles the native region helper,
//    which fails while a Glass window is running (the .exe is locked), so only the
//    JS bundle is rebuilt here and the existing helper is copied as-is.
if (!noBuild) {
  run('pnpm', ['--filter', '@glass/desktop', 'build'], repoRoot);
}

const mainBundle = join(desktopDir, 'out', 'main', 'index.js');
if (!existsSync(mainBundle)) {
  console.error(`[pack] missing ${mainBundle}; run without --no-build`);
  process.exit(1);
}

const nativeHelper = join(desktopDir, 'native', 'RegionCapture.exe');
if (!existsSync(nativeHelper)) {
  console.warn(`[pack] ${nativeHelper} is missing; the packaged app will degrade (no screen sampling for refraction)`);
}

// 2. app/ — main bundle, renderer, preload, native helper.
const appDir = join(pluginDir, 'app');
rmSync(appDir, { recursive: true, force: true });
mkdirSync(join(appDir, 'native'), { recursive: true });
cpSync(join(desktopDir, 'out'), join(appDir, 'out'), { recursive: true });
if (existsSync(nativeHelper)) cpSync(nativeHelper, join(appDir, 'native', 'RegionCapture.exe'));
writeFileSync(join(appDir, 'package.json'), `${JSON.stringify({
  name: 'dsh-status-bar',
  productName: 'DSH Status Bar',
  version,
  private: true,
  type: 'module',
  main: 'out/main/index.js',
}, null, 2)}\n`);

// 3. electron/dist — the runtime is launched with the app directory as argv[1].
const distSource = electronDistDir();
if (!existsSync(distSource)) {
  console.error(`[pack] missing Electron runtime at ${distSource}; run \`pnpm install\` first`);
  process.exit(1);
}
const electronTarget = join(pluginDir, 'electron', 'dist');
rmSync(join(pluginDir, 'electron'), { recursive: true, force: true });
mkdirSync(electronTarget, { recursive: true });
cpSync(distSource, electronTarget, { recursive: true });

// 4. npm pack, then give the artifact a version-free release name.
mkdirSync(outDir, { recursive: true });
run('npm', ['pack', '--pack-destination', outDir], pluginDir);
const packed = join(outDir, `dsh-glass-plugin-${version}.tgz`);
const releaseName = join(outDir, 'dsh-glass-plugin.tgz');
if (existsSync(packed)) {
  rmSync(releaseName, { force: true });
  renameSync(packed, releaseName);
}

console.log(`[pack] app/      ${mib(sizeOf(mainBundle))} main bundle + assets`);
console.log(`[pack] electron/ ${mib(sizeOf(join(electronTarget, 'electron.exe')))} electron.exe from ${distSource}`);
console.log(`[pack] tarball   ${releaseName} (${mib(sizeOf(releaseName))})`);
