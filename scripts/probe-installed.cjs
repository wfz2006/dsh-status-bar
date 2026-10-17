// Read-only inspection of shipped JavaScript (declarations are omitted). Run with the installed
// Electron's Node mode so ASAR is read through Electron's supported filesystem.
const fs = require('node:fs');
const crypto = require('node:crypto');
const root = 'D:/DSH/resources/app.asar/dsh/node_modules/@deepseek-ai/';
const names = ['dsh-session', 'dsh-user-approval', 'dsh-tool-todo', 'dsh-user-questions'];
const records = [];
for (const name of names) {
  const path = root + name;
  const pkg = JSON.parse(fs.readFileSync(path + '/package.json', 'utf8'));
  const types = path + '/lib';
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = dir + '/' + entry.name;
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.js')) {
        const content = fs.readFileSync(file, 'utf8');
        const indices = [...content.matchAll(/session\/event|approval\/request|user-questions\/request|todo\/write/g)].map(m => m.index);
        if (indices.length) records.push({ package: pkg.name, version: pkg.version, file,
          sha256: crypto.createHash('sha256').update(content).digest('hex'),
          excerpts: indices.map(index => ({ offset: index, text: content.slice(Math.max(0, index - 220), index + 450) })) });
      }
    }
  }
  walk(types);
}
fs.writeFileSync('docs/evidence/installed-signatures.json', JSON.stringify(records, null, 2));
console.log(`Saved ${records.length} installed runtime evidence records; no user Profile was read.`);
console.log('Candidate host packages: ' + fs.readdirSync(root).filter(n => /desktop|web/.test(n)).join(', '));
