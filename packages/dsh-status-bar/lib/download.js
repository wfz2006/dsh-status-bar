import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

export function abortError() { return Object.assign(new Error('已取消准备，下次启动可继续下载。'), { name: 'AbortError' }); }
export function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
export function delay(ms, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
const size = path => { try { return statSync(path).size; } catch { return 0; } };
const json = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; } };
function reset(part) { for (const path of [part, `${part}.json`]) rmSync(path, { force: true }); }
function validator(headers) {
  const tag = headers.etag;
  return typeof tag === 'string' && !tag.startsWith('W/') ? tag : headers['last-modified'];
}
function finalHeaders(file) {
  try {
    const blocks = readFileSync(file, 'utf8').split(/\r?\n\r?\n/).filter(block => /^HTTP\//.test(block));
    const last = blocks.at(-1); if (!last) return {};
    const lines = last.split(/\r?\n/); const status = Number(lines.shift()?.split(' ')[1]);
    return { status, headers: Object.fromEntries(lines.filter(line => line.includes(':')).map(line => { const i = line.indexOf(':'); return [line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()]; })) };
  } catch { return {}; }
}
function metadata(headers, source) {
  const range = String(headers['content-range'] ?? '').match(/^bytes \d+-\d+\/(\d+)$/);
  return { source, validator: validator(headers), total: range ? Number(range[1]) : Number(headers['content-length']) || 0 };
}
function curlAttempt(url, part, previous, options) {
  const headersFile = `${part}.headers`;
  rmSync(headersFile, { force: true });
  const offset = size(part);
  const program = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'curl.exe') : 'curl';
  const args = ['--silent', '--show-error', '--location', '--fail', '--connect-timeout', '15', '--max-time', String(options.timeoutMs / 1000),
    '--speed-limit', '1', '--speed-time', String(Math.max(1, Math.ceil(options.idleMs / 1000))), '--proto-redir', '=https,http',
    '--dump-header', headersFile, '--output', part];
  if (new URL(url).protocol === 'https:') args.push('--proto', '=https', '--proto-redir', '=https');
  if (offset) args.push('--continue-at', String(offset), '--header', `If-Range: ${previous.validator}`);
  args.push('--url', url);
  return new Promise((resolve, reject) => {
    let child;
    const progress = () => {
      const result = finalHeaders(headersFile);
      if (result.status === 200 || result.status === 206) {
        const next = metadata(result.headers, options.source);
        writeFileSync(`${part}.json`, JSON.stringify(next));
        options.onProgress({ received: size(part), total: next.total });
      }
    };
    const abort = () => child?.kill();
    try { child = spawn(program, args, { windowsHide: true, stdio: 'ignore' }); }
    catch (error) { reject(error); return; }
    const timer = setInterval(() => { try { progress(); } catch (error) { child.kill(); reject(error); } }, 250); timer.unref();
    const exiting = () => child.kill(); process.once('exit', exiting);
    options.signal?.addEventListener('abort', abort, { once: true });
    child.once('error', error => { clearInterval(timer); process.removeListener('exit', exiting); options.signal?.removeEventListener('abort', abort); reject(error); });
    child.once('close', code => {
      clearInterval(timer); options.signal?.removeEventListener('abort', abort);
      process.removeListener('exit', exiting);
      try {
        progress(); checkAbort(options.signal);
        const response = finalHeaders(headersFile);
        if (code === 0) { resolve(); return; }
        const completed = response.status === 416 && String(response.headers?.['content-range']).match(/^bytes \*\/(\d+)$/);
        if (completed && Number(completed[1]) === offset && previous.total === offset) { resolve(); return; }
        if (code === 33 || response.status === 416) reset(part);
        reject(new Error(response.status >= 400 ? `下载服务返回 HTTP ${response.status}。` : `下载连接中断或超时（curl ${code ?? 'stopped'}）。`));
      } catch (error) { reject(error); }
      finally { rmSync(headersFile, { force: true }); }
    });
    if (options.signal?.aborted) abort();
  });
}
async function nodeAttempt(url, part, previous, options, redirects = 5) {
  checkAbort(options.signal);
  const offset = size(part); let request; let timeout;
  try {
    const response = await new Promise((resolve, reject) => {
      const headers = offset ? { Range: `bytes=${offset}-`, 'If-Range': previous.validator } : {};
      request = (new URL(url).protocol === 'https:' ? httpsGet : httpGet)(url, { headers, signal: options.signal }, resolve);
      request.once('error', reject);
      request.setTimeout(options.idleMs, () => request.destroy(new Error('下载连接长时间没有数据。')));
      timeout = setTimeout(() => request.destroy(new Error('下载超时。')), options.timeoutMs); timeout.unref();
    });
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      const next = new URL(response.headers.location, url);
      if (redirects <= 0 || new URL(url).protocol === 'https:' && next.protocol !== 'https:') throw new Error('下载重定向无效。');
      return await nodeAttempt(next.href, part, previous, options, redirects - 1);
    }
    const complete = status === 416 && String(response.headers['content-range']).match(/^bytes \*\/(\d+)$/);
    if (complete && Number(complete[1]) === offset && previous.total === offset) { response.resume(); return; }
    if (status !== 200 && status !== 206) { response.resume(); if (status === 416) reset(part); throw new Error(`下载服务返回 HTTP ${status}。`); }
    const range = String(response.headers['content-range'] ?? '').match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (status === 206 && (!offset || !range || Number(range[1]) !== offset || Number(range[2]) >= Number(range[3]))) {
      response.destroy(); reset(part); throw new Error('续传范围不匹配，下一次重新下载。');
    }
    const next = metadata(response.headers, options.source);
    writeFileSync(`${part}.json`, JSON.stringify(next));
    let received = status === 206 ? offset : 0;
    const report = () => { try { options.onProgress({ received, total: next.total }); } catch (error) { request.destroy(error); } };
    response.on('data', chunk => { received += chunk.length; report(); });
    const progress = setInterval(report, 250); progress.unref();
    try { await pipeline(response, createWriteStream(part, { flags: status === 206 ? 'a' : 'w' }), { signal: options.signal }); }
    finally { clearInterval(progress); }
    if (next.total && size(part) !== next.total) throw new Error('下载文件不完整。');
  } finally { clearTimeout(timeout); }
}

/** The partial file and its entity validator survive network errors/restarts.
 * Curl uses the working Windows network path; Node is only the missing-curl fallback. */
export async function downloadArchive(url, part, { signal, onProgress = () => {}, attempts = 3, idleMs = 30000, timeoutMs = 300000, backend = 'auto' } = {}) {
  const parsed = new URL(url);
  if (parsed.username || parsed.password || !['https:', 'http:'].includes(parsed.protocol) || parsed.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('运行时地址必须使用 HTTPS。');
  const source = createHash('sha256').update(url).digest('hex');
  let useNode = backend === 'node'; let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    checkAbort(signal);
    const previous = json(`${part}.json`);
    if (previous.source !== source || !previous.validator) reset(part);
    if (existsSync(part) && previous.source === source && previous.total > 0 && size(part) === previous.total) return;
    onProgress({ phase: 'downloading', received: size(part), total: previous.total || 0, attempt, message: '正在下载桌面运行时，完成后自动打开悬浮窗。' });
    let reported = 0;
    const options = { source, signal, idleMs, timeoutMs, onProgress: progress => {
      const now = Date.now(); if (now - reported < 250 && progress.received !== progress.total) return;
      reported = now; onProgress({ phase: 'downloading', attempt, ...progress });
    } };
    try {
      if (!useNode) {
        try { await curlAttempt(url, part, previous, options); }
        catch (error) { if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error; useNode = true; await nodeAttempt(url, part, previous, options); }
      } else await nodeAttempt(url, part, previous, options);
      checkAbort(signal); return;
    } catch (error) {
      checkAbort(signal); lastError = error;
      if (attempt < attempts) {
        onProgress({ phase: 'retrying', message: `下载中断，${attempt} 秒后重试；可验证的已下载部分会保留。`, attempt });
        await delay(attempt * 1000, signal);
      }
    }
  }
  throw new Error(`${lastError?.message ?? '运行时下载失败。'} 已保留可续传的数据，可点击重试。`);
}
