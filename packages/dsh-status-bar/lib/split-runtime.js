import { createHash } from 'node:crypto';
import { createReadStream, linkSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { checkAbort } from './download.js';

const hashPattern = /^[a-f0-9]{64}$/;
const validFile = name => name.split('/').every(part => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..');
const versionPattern = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;

export function splitRuntime(manifest) {
  if (!manifest || manifest.platform !== process.platform || manifest.arch !== process.arch ||
    !versionPattern.test(manifest.electronVersion) || !hashPattern.test(manifest.app?.sha256) ||
    typeof manifest.app?.url !== 'string' || !manifest.engineFiles || typeof manifest.engineFiles !== 'object') return;
  const files = Object.entries(manifest.engineFiles);
  const executable = process.platform === 'win32' ? 'electron.exe' : 'electron';
  if (!Object.hasOwn(manifest.engineFiles, executable) || files.length > 300 ||
    files.some(([name, hash]) => !validFile(name) || !hashPattern.test(hash)) ||
    new Set(files.map(([name]) => name.toLowerCase())).size !== files.length) return;
  // Check the largest and most version-specific file before inspecting the rest.
  return { app: manifest.app, files: [[executable, manifest.engineFiles[executable]], ...files.filter(([name]) => name !== executable)] };
}

export async function sha256File(file, signal) {
  checkAbort(signal);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file, { signal })) digest.update(chunk);
  return digest.digest('hex');
}

export async function findCompatibleEngine(base, current, files, signal) {
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const version = entry.name.slice('runtime-'.length);
    if (!entry.isDirectory() || entry.name === current || !entry.name.startsWith('runtime-') || !versionPattern.test(version)) continue;
    const engine = join(base, entry.name, 'electron', 'dist');
    try {
      let matches = true;
      for (const [name, hash] of files) {
        const path = join(engine, name);
        if (!lstatSync(path).isFile() || await sha256File(path, signal) !== hash) { matches = false; break; }
      }
      if (matches) return engine;
    } catch { checkAbort(signal); }
  }
}

export function linkEngine(source, destination, files) {
  for (const [name] of files) {
    const file = join(destination, name);
    mkdirSync(dirname(file), { recursive: true });
    linkSync(join(source, name), file);
  }
}
