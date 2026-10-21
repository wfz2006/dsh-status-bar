import { record } from './transport';

const sensitiveKey = /(?:secret|password|passwd|token|authorization|api.?key|^env$)/i;
export function redactCredentials(value: string): string {
  return value
    .replace(/(\b(?:authorization|proxy-authorization)\s*:\s*(?:Bearer|Basic)\s+)[^\s"'`]+/gi, '$1[已隐藏]')
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}/g, '[已隐藏]')
    .replace(/(\bhttps?:\/\/)[^\s/@]+@/gi, '$1[已隐藏]@')
    .replace(/((?:\b[\w-]*(?:api[_-]?key|token|secret|password|passwd))\s*(?:=|:)\s*["']?)(?!\[已隐藏\])[^\s"'&;`]+/gi, '$1[已隐藏]')
    .replace(/(--(?:api[_-]?key|access[_-]?token|token|secret|password|passwd)\s+["']?)[^\s"'&;`]+/gi, '$1[已隐藏]');
}
export function toolPreview(value: unknown): { preview: string; complete: boolean } {
  const unavailable = { preview: '参数过长或格式不可验证，请在 DSH 中确认。', complete: false };
  if (typeof value !== 'string' || value.length > 4096) return unavailable;
  let parsed: unknown; try { parsed = JSON.parse(value); } catch { return unavailable; }
  if (!Object.keys(record(parsed)).length) return unavailable;
  let redacted = false;
  function clean(value: unknown): unknown {
    if (typeof value === 'string') { const safe = redactCredentials(value); redacted ||= safe !== value; return safe; }
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(record(value)).map(([key, nested]) => {
      if (sensitiveKey.test(key)) { redacted = true; return [key, '[已隐藏]']; }
      return [key, clean(nested)];
    }));
    return value;
  }
  const safe = record(clean(parsed)); const encoded = JSON.stringify(safe);
  if (encoded.length > 4096) return unavailable;
  const preview = typeof safe.command === 'string' ? safe.command : encoded;
  return { preview: (redacted ? '敏感字段已隐藏，请在 DSH 中核对完整参数。\n' + preview : preview).slice(0, 4096), complete: !redacted };
}
