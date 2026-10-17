/**
 * Parses the launcher hand-off used by the DSH host plugin.
 *
 * The DSH bundle starts the Glass desktop app with `--dsh-link=<authenticated url>`
 * so the window connects without the user pasting anything. The value is only
 * accepted when it is a loopback http(s) root URL without credentials, hash or
 * sub-path; anything else is ignored rather than surfaced as a connection error.
 */
export function dshLinkFromArgs(argv: readonly string[]): string | undefined {
  let value: string | undefined;
  for (const arg of argv) {
    if (arg.startsWith('--dsh-link=')) value = arg.slice('--dsh-link='.length);
  }
  if (!value || value.length > 4096) return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return undefined;
    if (url.username || url.password || url.hash) return undefined;
    if (url.pathname !== '/') return undefined;
    return value;
  } catch {
    return undefined;
  }
}
