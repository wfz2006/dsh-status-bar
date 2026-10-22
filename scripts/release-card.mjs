// Generates the release banner for this repository: logo, title, tagline and a
// row of live badges (latest version, stars, downloads, license). Data comes
// from the GitHub REST API; the whale mark and the wording come from the repo
// itself, so the card never drifts from the project.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(resolve('apps/desktop/package.json'));
const electron = require('electron');
const root = resolve('.');

function parseArgs(argv) {
  const args = { width: 1200, height: 450, out: 'docs/images/release-card.png' };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--repo') { args.repo = value; i++; }
    else if (key === '--out') { args.out = value; i++; }
    else if (key === '--data') { args.data = value; i++; }
    else if (key === '--width') { args.width = Number(value); i++; }
    else if (key === '--height') { args.height = Number(value); i++; }
    else if (key === '--html-only') { args.htmlOnly = true; }
  }
  return args;
}

function repoFromGitRemote() {
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const match = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (match) return `${match[1]}/${match[2]}`;
  } catch { }
  throw new Error('无法从 git remote 推断仓库，请用 --repo owner/name 指定');
}

async function github(path) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  try {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'dsh-release-card',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) throw new Error(`GitHub API ${path} -> ${response.status} ${response.statusText}`);
    return response.json();
  } catch (error) {
    // Some corporate VPNs intercept TLS with a local root that Node does not
    // trust. Fall back to the GitHub CLI, which uses the system trust store.
    const message = error?.cause?.code ?? error?.code ?? error?.message ?? '';
    if (!/UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED|certificate/i.test(message)) throw error;
    const output = execFileSync('gh', ['api', path], { encoding: 'utf8', windowsHide: true });
    return JSON.parse(output);
  }
}

async function collectData(repo) {
  const [info, releases] = await Promise.all([
    github(`/repos/${repo}`),
    github(`/repos/${repo}/releases?per_page=100`),
  ]);
  // The releases endpoint occasionally answers with an empty list; one retry
  // keeps the card from showing "—" while releases clearly exist.
  let list = releases;
  if (!Array.isArray(list) || list.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    list = await github(`/repos/${repo}/releases?per_page=100`);
  }
  const published = list.filter((release) => !release.draft && !release.prerelease);
  const latest = published[0] ?? null;
  const downloads = published
    .flatMap((release) => release.assets ?? [])
    .reduce((sum, asset) => sum + (asset.download_count ?? 0), 0);
  return {
    repo,
    stars: info.stargazers_count ?? 0,
    downloads,
    latest: latest?.tag_name ?? null,
    latestName: latest?.name ?? null,
    releasedAt: latest?.published_at ?? null,
    license: info.license?.spdx_id ?? null,
  };
}

async function repoMeta() {
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const title = readme.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'DSH Status Bar';
  const tagline = readme.match(/^>\s*\*\*(.+?)\*\*/m)?.[1]?.trim() ?? null;
  return { title, tagline };
}

async function whaleMark() {
  const source = await readFile(join(root, 'apps/desktop/src/renderer/whale-mark.ts'), 'utf8');
  const mark = source.match(/WHALE_MARK\s*=\s*"([^"]+)"/)?.[1];
  if (!mark) throw new Error('无法从 whale-mark.ts 解析鲸鱼标路径');
  return mark;
}

const ICONS = {
  tag: '<path d="M20.59 13.41 12 22l-9-9V3h10l7.59 7.59a2 2 0 0 1 0 2.82Z"/><circle cx="7.5" cy="7.5" r="1.4" fill="#1b2029"/>',
  star: '<path d="m12 2 3.09 6.26L21 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l5.89-1.01Z"/>',
  download: '<path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 20h16"/>',
  shield: '<path d="M12 22s8-4 8-10V5.2L12 2.4 4 5.2V12c0 6 8 10 8 10Z"/>',
};

function chip(label, icon, value, tone) {
  return `<span class="chip"><span class="cap">${icon ? `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>` : ''}${label}</span><span class="val ${tone}">${value}</span></span>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function renderHtml({ title, tagline, data, mark, width, height }) {
  const badges = [
    chip('LATEST', 'tag', data.latest ?? '—', 'accent'),
    chip('STARS', 'star', data.stars, 'plain'),
    chip('DOWNLOADS', 'download', data.downloads, 'green'),
    data.license ? chip('LICENSE', 'shield', data.license, 'plain') : '',
  ].join('');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${width}px; height: ${height}px; overflow: hidden;
    font-family: 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif;
    background: #16264a;
  }
  .card {
    position: relative; width: ${width}px; height: ${height}px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background:
      radial-gradient(900px 520px at 18% -14%, rgba(96, 165, 250, .40), transparent 62%),
      radial-gradient(820px 480px at 88% 116%, rgba(0, 180, 219, .34), transparent 58%),
      radial-gradient(700px 420px at 78% 8%, rgba(129, 140, 248, .28), transparent 60%),
      linear-gradient(140deg, #16264a 0%, #1e3c72 52%, #2a5298 100%);
    color: #fff;
  }
  .sheen {
    position: absolute; inset: 0;
    background: linear-gradient(104deg, rgba(255,255,255,.14) 0%, rgba(255,255,255,0) 38%, rgba(255,255,255,0) 64%, rgba(255,255,255,.07) 100%);
  }
  .logo {
    position: relative; width: 104px; height: 104px; border-radius: 50%;
    display: grid; place-items: center;
    background: radial-gradient(circle at 34% 26%, rgba(255,255,255,.36), rgba(255,255,255,.08) 46%, rgba(255,255,255,.03) 72%);
    box-shadow: 0 18px 44px rgba(3, 10, 28, .45), inset 0 1px 0 rgba(255,255,255,.34);
  }
  .logo::before {
    content: ''; position: absolute; inset: -2px; border-radius: 50%; padding: 2px;
    background: conic-gradient(from 205deg, #38bdf8, #a78bfa, #fb923c, #38bdf8);
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor; mask-composite: exclude;
  }
  .logo svg { width: 54px; height: 54px; fill: #9ad9ff; filter: drop-shadow(0 3px 8px rgba(2, 12, 30, .55)); }
  .title {
    margin: 24px 0 0; font-size: 46px; font-weight: 700; letter-spacing: .3px; line-height: 1.1;
    text-shadow: -1px 0 rgba(56,189,248,.45), 1px 0 rgba(251,146,60,.35), 0 6px 24px rgba(3,10,28,.5);
  }
  .tagline { margin: 10px 0 0; font-size: 19px; font-weight: 500; color: rgba(255,255,255,.74); }
  .divider {
    margin-top: 24px; width: min(${width - 160}px, 1040px); height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.30), transparent);
  }
  .badges { margin-top: 20px; display: flex; align-items: stretch; gap: 9px; }
  .chip { display: inline-flex; align-items: stretch; font-size: 15px; font-weight: 700; letter-spacing: .07em; }
  .chip .cap {
    display: inline-flex; align-items: center; gap: 6px; padding: 8px 13px;
    background: #9aa2ad; color: #10141b;
  }
  .chip .cap svg { width: 15px; height: 15px; fill: #ffffff; }
  .chip .val { display: inline-flex; align-items: center; padding: 8px 15px; color: #10141b; }
  .chip .val.accent { background: #22d3ee; }
  .chip .val.green { background: #a3e635; }
  .chip .val.plain { background: #6b7280; color: #f8fafc; }
</style></head>
<body>
  <div class="card">
    <div class="sheen"></div>
    <div class="logo">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${mark}" /></svg>
    </div>
    <h1 class="title">${escapeHtml(title)}</h1>
    ${tagline ? `<p class="tagline">${escapeHtml(tagline)}</p>` : ''}
    <div class="divider"></div>
    <div class="badges">${badges}</div>
  </div>
</body></html>`;
}

async function render(html, out, width, height) {
  const htmlPath = join(root, 'reports', 'release-card.html');
  await mkdir(dirname(htmlPath), { recursive: true });
  await writeFile(htmlPath, html, 'utf8');
  await mkdir(dirname(resolve(out)), { recursive: true });
  const payload = JSON.stringify({ html: htmlPath, out: resolve(out), width, height });
  const env = { ...process.env, GLASS_RELEASE_CARD_PAYLOAD: payload };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(electron, [join(root, 'scripts', 'release-card-main.cjs')], {
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (!existsSync(resolve(out))) throw new Error(`渲染未产出文件：${out}`);
}

const args = parseArgs(process.argv.slice(2));
const repo = args.repo ?? repoFromGitRemote();
const data = args.data
  ? JSON.parse(await readFile(resolve(args.data), 'utf8'))
  : await collectData(repo);
const meta = await repoMeta();
const mark = await whaleMark();

console.log('仓库:', data.repo, '| stars:', data.stars, '| downloads:', data.downloads, '| latest:', data.latest ?? '—');

if (args.htmlOnly) {
  const htmlPath = resolve('reports/release-card.html');
  await mkdir(dirname(htmlPath), { recursive: true });
  await writeFile(htmlPath, renderHtml({ ...meta, data, mark, width: args.width, height: args.height }), 'utf8');
  console.log('HTML 已写出:', htmlPath);
} else {
  await render(renderHtml({ ...meta, data, mark, width: args.width, height: args.height }), args.out, args.width, args.height);
  console.log('卡片已生成:', args.out);
}
