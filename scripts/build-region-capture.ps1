$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskNative=Join-Path $taskRoot 'apps\desktop\native'
$taskCompiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$taskExe=Join-Path $taskNative 'RegionCapture.exe'
$taskSource=Join-Path $taskNative 'RegionCapture.cs'
& $taskCompiler /nologo /optimize+ /target:exe /reference:System.Drawing.dll "/out:$taskExe" $taskSource
if ($LASTEXITCODE -ne 0) { throw 'Region helper compilation failed' }
