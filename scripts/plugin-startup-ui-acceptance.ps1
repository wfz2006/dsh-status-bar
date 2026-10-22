param([string]$OutputDirectory = '.tools/first-run-ui')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $repoRoot 'packages/dsh-status-bar/lib/startup-window.ps1')
$output = [IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
$null = New-Item -ItemType Directory -Path $output -Force
$testStatePath = Join-Path $output 'state.json'
$testActionPath = Join-Path $output 'action.txt'
function Write-State($value) { [IO.File]::WriteAllText($testStatePath, ($value | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false)) }
function Save-Window($window, [string]$name) {
  $window.UpdateLayout()
  $content = $window
  $scale = [Windows.PresentationSource]::FromVisual($window).CompositionTarget.TransformToDevice.M11
  $bitmap = New-Object Windows.Media.Imaging.RenderTargetBitmap ([int][Math]::Ceiling($content.RenderSize.Width*$scale)),([int][Math]::Ceiling($content.RenderSize.Height*$scale)),(96*$scale),(96*$scale),([Windows.Media.PixelFormats]::Pbgra32)
  $bitmap.Render($content)
  $encoder = New-Object Windows.Media.Imaging.PngBitmapEncoder
  $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
  $stream = [IO.File]::Create((Join-Path $output $name))
  try { $encoder.Save($stream) } finally { $stream.Dispose() }
}
Write-State @{phase='downloading';received=48MB;total=155MB;message='正在下载桌面运行时，完成后自动打开悬浮窗。'}
$ui = New-StartupWindow -StatePath $testStatePath -ActionPath $testActionPath -OwnerPid $PID
try {
  $ui.Window.Show()
  & $ui.Tick
  if($ui.Window.FindName('Heading').Text -ne '正在准备悬浮窗'){throw 'Chinese heading/encoding mismatch'}
  if($ui.Window.FindName('Progress').Value -lt 30){throw 'Progress was not rendered'}
  if($ui.Retry.Visibility -ne 'Collapsed'){throw 'Retry exposed during active download'}
  Save-Window $ui.Window 'progress.png'
  Write-State @{phase='failed';received=0;total=0;message='下载连接暂时不可用，已保留可续传数据。'}
  & $ui.Tick
  if($ui.Retry.Visibility -ne 'Visible' -or -not $ui.Retry.IsEnabled){throw 'Missing visible retry control'}
  $buttonPosition=$ui.Cancel.TranslatePoint((New-Object Windows.Point 0,0),$ui.Window)
  if($buttonPosition.Y + $ui.Cancel.ActualHeight -gt $ui.Window.ActualHeight){throw 'Action buttons overflow the native window'}
  Save-Window $ui.Window 'failed.png'
  $ui.Retry.RaiseEvent((New-Object Windows.RoutedEventArgs ([Windows.Controls.Primitives.ButtonBase]::ClickEvent)))
  if([IO.File]::ReadAllText($testActionPath) -ne 'retry'){throw 'Retry did not emit the retry action'}
  Write-State @{phase='retrying';message='正在重新连接。'}
  & $ui.Tick
  if(-not $ui.Window.IsVisible -or $ui.Retry.Visibility -ne 'Collapsed'){throw 'Retry did not preserve the window/transition state'}
  $ui.Cancel.RaiseEvent((New-Object Windows.RoutedEventArgs ([Windows.Controls.Primitives.ButtonBase]::ClickEvent)))
  if([IO.File]::ReadAllText($testActionPath) -ne 'cancel' -or $ui.Window.IsVisible){throw 'Cancel did not stop/close the bootstrap UI'}
  [IO.File]::WriteAllText((Join-Path $output 'acceptance.json'), (@{result='PASS';checks=@('native WPF progress and Chinese text','visible actionable failure','retry command without closing','cancel command and window close');scope='owned native startup window only; no production DSH profile'}|ConvertTo-Json))
  Write-Output 'Native first-run progress / failure / retry / cancel: PASS'
} finally { $ui.Finished=$true; $ui.Window.Close() }
