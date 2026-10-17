param([Parameter(Mandatory=$true)][string]$Path,[Parameter(Mandatory=$true)][long]$Handle)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DshCaptureWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
}
'@
[DshCaptureWindow]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
$captureHandle = [IntPtr]$Handle
$rect = New-Object DshCaptureWindow+RECT
if (![DshCaptureWindow]::GetWindowRect($captureHandle,[ref]$rect)) { throw 'Owned window unavailable' }
function Assert-OwnedRegion {
  $point = New-Object DshCaptureWindow+POINT
  $point.X = $rect.Left + [int](($rect.Right - $rect.Left) / 2)
  $point.Y = $rect.Top + [int](($rect.Bottom - $rect.Top) / 2)
  $visible = [DshCaptureWindow]::GetAncestor([DshCaptureWindow]::WindowFromPoint($point),2)
  if ($visible -ne $captureHandle) { throw ('Owned window is occluded: rejecting screenshot; expected={0}, visible={1}, rect={2},{3},{4},{5}' -f $captureHandle.ToInt64(),$visible.ToInt64(),$rect.Left,$rect.Top,$rect.Right,$rect.Bottom) }
}
Assert-OwnedRegion
$region = '{0},{1},{2},{3}' -f $rect.Left,$rect.Top,($rect.Right-$rect.Left),($rect.Bottom-$rect.Top)
& "$env:USERPROFILE/.codex/skills/screenshot/scripts/take_screenshot.ps1" -Path $Path -Region $region
Assert-OwnedRegion
