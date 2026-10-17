param([long]$Handle)
$ErrorActionPreference='Stop'
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class DshRoundProbe {
 [StructLayout(LayoutKind.Sequential)] public struct RECT{public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out RECT rect);
 [DllImport("gdi32.dll")] public static extern IntPtr CreateRoundRectRgn(int a,int b,int c,int d,int e,int f);
 [DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr hwnd,IntPtr region,bool redraw);
 [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd,int attr,ref int value,int size);
}
'@
[DshRoundProbe]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
$r=New-Object DshRoundProbe+RECT
if(![DshRoundProbe]::GetWindowRect([IntPtr]$Handle,[ref]$r)){throw 'No owned window'}
$region=[DshRoundProbe]::CreateRoundRectRgn(0,0,($r.Right-$r.Left+1),($r.Bottom-$r.Top+1),78,78)
if(![DshRoundProbe]::SetWindowRgn([IntPtr]$Handle,$region,$true)){throw 'Region failed'}
$cornerPreference=2
[DshRoundProbe]::DwmSetWindowAttribute([IntPtr]$Handle,33,[ref]$cornerPreference,4) | Write-Output
