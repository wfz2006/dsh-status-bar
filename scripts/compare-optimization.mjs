import assert from 'node:assert/strict';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const output = resolve('reports/optimization');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const median = values => { const sorted = values.toSorted((a, b) => a - b); return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2; };
async function files(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(async entry => entry.isDirectory() ? files(join(path, entry.name)) : [{ FullName: join(path, entry.name), Length: (await stat(join(path, entry.name))).size }]))).flat();
}
const beforeFiles = await read(resolve(output, 'build-before.json')), afterFiles = await files(resolve('apps/desktop/out'));
const summarizeFiles = entries => ({ totalBytes: entries.reduce((sum, f) => sum + f.Length, 0), mainJS: entries.find(f => /[\\/]main[\\/]index.js$/.test(f.FullName)).Length,
  preloadJS: entries.find(f => /[\\/]preload[\\/]index.cjs$/.test(f.FullName)).Length,
  rendererJS: entries.filter(f => /[\\/]renderer[\\/].*\.js$/.test(f.FullName)).reduce((sum, f) => sum + f.Length, 0) });
const build = { before: summarizeFiles(beforeFiles), after: summarizeFiles(afterFiles) };
assert.ok(build.after.totalBytes < build.before.totalBytes);
const oldVisual = await read(resolve('reports/memory-upgrade/visual-before.json')), newVisual = await read(resolve('reports/memory-upgrade/visual-after.json'));
assert.equal(oldVisual.surfaces.length, 8); assert.deepEqual(oldVisual.surfaces, newVisual.surfaces);
const rounds = {};
for (const side of ['before', 'after']) rounds[side] = await Promise.all(['', '-2'].map(suffix => read(resolve(`reports/memory-upgrade/optimization-${side}${suffix}.json`))));
const memory = [];
for (const scenario of rounds.before[0].scenarios) {
  const sides = {};
  for (const side of ['before', 'after']) {
    const perRound = rounds[side].map(round => {
      const samples = round.scenarios.find(s => s.name === scenario.name).samples;
      return { privateWorkingSetMiB: median(samples.map(s => s.totalPrivateWorkingSet)) / 1048576,
        jsHeapMiB: median(samples.map(s => s.jsHeapUsed)) / 1048576,
        // The first Tab is the app, the second is the controlled background.
        appRendererMiB: median(samples.map(s => s.processes.find(p => p.type === 'Tab').privateWorkingSet)) / 1048576,
        gpuMiB: median(samples.map(s => s.processes.filter(p => p.type === 'GPU').reduce((sum, p) => sum + p.privateWorkingSet, 0))) / 1048576 };
    });
    sides[side] = { perRound, medianPrivateWorkingSetMiB: median(perRound.map(r => r.privateWorkingSetMiB)), medianAppRendererMiB: median(perRound.map(r => r.appRendererMiB)), medianJSHeapMiB: median(perRound.map(r => r.jsHeapMiB)) };
  }
  memory.push({ name: scenario.name, ...sides });
}
const result = { build, exactVisualComparisons: 8, projection: await read(resolve(output, 'projection-comparison.json')), memory,
  note: 'Two sequential runs per build. Memory includes the controlled background process, excludes DSH Host. GPU working sets can retain allocation pools and vary substantially; report all scenarios and do not infer an overall memory reduction from bundle size or IPC bytes.' };
await writeFile(resolve(output, 'comparison.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
