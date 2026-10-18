param([Parameter(Mandatory=$true)][long]$Handle,[Parameter(Mandatory=$true)][uint32]$Owner)
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DshShapeProbe {
  [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
  [StructLayout(LayoutKind.Sequential)] public struct POINT {public int X,Y;}
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window,out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window,out uint owner);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern int GetWindowRgn(IntPtr window,IntPtr region);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window,uint flags);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int l,int t,int r,int b);
  [DllImport("gdi32.dll")] public static extern uint GetRegionData(IntPtr region,uint size,IntPtr data);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr region);
}
'@
$target=[IntPtr]$Handle
[uint32]$actualOwner=0
[DshShapeProbe]::GetWindowThreadProcessId($target,[ref]$actualOwner)|Out-Null
if($actualOwner -ne $Owner){throw 'Not the owned test window'}
$oldRect=New-Object DshShapeProbe+RECT
[DshShapeProbe]::GetWindowRect($target,[ref]$oldRect)|Out-Null
[DshShapeProbe]::SetThreadDpiAwarenessContext([IntPtr](-4))|Out-Null
$rect=New-Object DshShapeProbe+RECT
[DshShapeProbe]::GetWindowRect($target,[ref]$rect)|Out-Null
$point=New-Object DshShapeProbe+POINT
$point.X=$rect.Left+[int](($rect.Right-$rect.Left)/2)
$point.Y=$rect.Top+[int](($rect.Bottom-$rect.Top)/2)
$visible=[DshShapeProbe]::GetAncestor([DshShapeProbe]::WindowFromPoint($point),2)
$region=[DshShapeProbe]::CreateRectRgn(0,0,0,0)
$buffer=[IntPtr]::Zero
try {
  $kind=[DshShapeProbe]::GetWindowRgn($target,$region)
  $size=[DshShapeProbe]::GetRegionData($region,0,[IntPtr]::Zero)
  if($size -lt 32){throw 'Window region unavailable'}
  $buffer=[Runtime.InteropServices.Marshal]::AllocHGlobal([int]$size)
  [DshShapeProbe]::GetRegionData($region,$size,$buffer)|Out-Null
  $bytes=New-Object byte[] $size
  [Runtime.InteropServices.Marshal]::Copy($buffer,$bytes,0,[int]$size)
  $count=[BitConverter]::ToInt32($bytes,8)
  $rows=@(for($i=0;$i -lt $count;$i++){
    $offset=32+$i*16
    @{x=[BitConverter]::ToInt32($bytes,$offset);y=[BitConverter]::ToInt32($bytes,$offset+4);right=[BitConverter]::ToInt32($bytes,$offset+8);bottom=[BitConverter]::ToInt32($bytes,$offset+12)}
  })
  @{dpi=[DshShapeProbe]::GetDpiForWindow($target);beforeThread=@{x=$oldRect.Left;y=$oldRect.Top;right=$oldRect.Right;bottom=$oldRect.Bottom};rect=@{x=$rect.Left;y=$rect.Top;right=$rect.Right;bottom=$rect.Bottom};centerVisible=$visible.ToInt64();handle=$Handle;kind=$kind;rows=$rows}|ConvertTo-Json -Depth 5 -Compress
} finally {
  if($buffer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)}
  [DshShapeProbe]::DeleteObject($region)|Out-Null
}
