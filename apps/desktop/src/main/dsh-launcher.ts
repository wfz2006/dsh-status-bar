import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, extname } from 'node:path';
import { dialog, shell, type BrowserWindow } from 'electron';

export function dshExecutableCandidates(env: NodeJS.ProcessEnv): string[] {
  return [env.DSH_DESKTOP_EXECUTABLE,
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe'),
    env.ProgramFiles && join(env.ProgramFiles, 'DeepSeek Harness', 'DeepSeek Harness.exe'),
    env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'DeepSeek Harness', 'DeepSeek Harness.exe'),
  ].filter((path): path is string => !!path && isAbsolute(path) && extname(path).toLowerCase() === '.exe');
}

/** A user-selected application path is local preference, never a credential or
 * a reason to inspect DSH's Profile. It is only launched by an explicit action. */
export function createDshLauncher(win: BrowserWindow, directory: string) {
  const preference = join(directory, 'dsh-desktop.json');
  const valid = (path: unknown): path is string => typeof path === 'string' && isAbsolute(path) && extname(path).toLowerCase() === '.exe' && existsSync(path);
  let selected: string | undefined;
  try { const saved: unknown = JSON.parse(readFileSync(preference, 'utf8')); if (saved && typeof saved === 'object' && 'executable' in saved && valid(saved.executable)) selected = saved.executable; } catch { /* Optional local preference. */ }
  selected ??= dshExecutableCandidates(process.env).find(valid);
  let opening = false;
  return async () => {
    if (opening) return; opening = true;
    try {
      if (!valid(selected)) {
        const result = await dialog.showOpenDialog(win, { title: '选择 DeepSeek Harness 程序', properties: ['openFile'], filters: [{ name: 'DSH 桌面程序', extensions: ['exe'] }] });
        const path = result.filePaths[0]; if (result.canceled || !valid(path)) return;
        selected = path;
        try { writeFileSync(preference, JSON.stringify({ executable: path })); } catch { /* Opening does not require writable preferences. */ }
      }
      await shell.openPath(selected);
    } catch { /* A closed picker/window must not create an unhandled rejection. */ }
    finally { opening = false; }
  };
}
