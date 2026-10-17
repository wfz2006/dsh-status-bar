import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
if(process.platform==='win32')execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('scripts/build-region-capture.ps1')],{stdio:'inherit',windowsHide:true});
