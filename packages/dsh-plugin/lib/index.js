// DSH bundle entry for the Glass companion.
//
// The desktop app lives in apps/desktop and is a separate Electron process.
// This host plugin is intentionally inert for now: it proves the bundle is
// installed and loaded, and gives the future launcher/auto-connect hook a
// place to live. Keep it side-effect free so a profile can mount it safely.

export const name = 'dsh-glass-plugin';

export function apply() {
  console.info('[dsh-glass-plugin] loaded (desktop companion is not wired yet)');
}
