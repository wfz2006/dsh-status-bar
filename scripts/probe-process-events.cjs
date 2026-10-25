// Read shipped public JavaScript through Electron's read-only ASAR filesystem.
// No Profile, authentication file or user session is accessed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = process.argv[2];
if (!asar || !path.isAbsolute(asar)) throw new Error('Pass the installed app.asar absolute path');
const output = path.resolve('reports/process-sync/installed');
fs.mkdirSync(output, { recursive: true });
console.log('Related public packages:', fs.readdirSync(path.join(asar, 'dsh/node_modules/@deepseek-ai')).filter(name => /tool|agent|remote/.test(name)).join(', '));
const records = [];
for (const name of ['dsh-api-session-controller', 'dsh-api-gateway', 'dsh-agent-loop', 'dsh-api-remotes', 'dsh-client-ui-tool', 'dsh-tools', 'dsh-agent-tool-presentation']) {
  const base = path.join(asar, 'dsh/node_modules/@deepseek-ai', name);
  const version = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8')).version;
  const source = fs.readFileSync(path.join(base, 'lib/index.js'), 'utf8');
  fs.writeFileSync(path.join(output, name + '.js'), source);
  records.push({ name, version, sha256: crypto.createHash('sha256').update(source).digest('hex') });
}
fs.writeFileSync(path.join(output, 'sources.json'), JSON.stringify(records, null, 2));
console.log(JSON.stringify(records));
