param([int]$MainProcessId, [string]$ElectronProcessIds)
$ErrorActionPreference = 'Stop'
$ids = @($ElectronProcessIds.Split(',') | ForEach-Object { [int]$_ })
$helpers = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$MainProcessId AND Name='RegionCapture.exe'")
$ids += @($helpers | ForEach-Object { [int]$_.ProcessId })
$filter = ($ids | ForEach-Object { "IDProcess=$_" }) -join ' OR '
@(Get-CimInstance Win32_PerfRawData_PerfProc_Process -Filter $filter | ForEach-Object {
  [pscustomobject]@{ pid=[int]$_.IDProcess; privateWorkingSet=[long]$_.WorkingSetPrivate; workingSet=[long]$_.WorkingSet; privateBytes=[long]$_.PrivateBytes; helper=([int]$_.IDProcess -in @($helpers.ProcessId)) }
}) | ConvertTo-Json -Compress
