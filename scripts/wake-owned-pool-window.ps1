param(
  [Parameter(Mandatory=$true)][long]$MainHandle,
  [Parameter(Mandatory=$true)][long]$GuardHandle,
  [Parameter(Mandatory=$true)][uint32]$Owner
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class PoolShortcutProbe {
  [StructLayout(LayoutKind.Sequential)] struct Keyboard {
    public ushort virtualKey, scanCode;
    public uint flags, time;
    public UIntPtr extra;
  }
  [StructLayout(LayoutKind.Sequential)] struct Mouse {
    public int dx, dy;
    public uint data, flags, time;
    public UIntPtr extra;
  }
  [StructLayout(LayoutKind.Explicit)] struct Payload {
    [FieldOffset(0)] public Keyboard key;
    [FieldOffset(0)] public Mouse mouse;
  }
  [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public Payload data; }
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint owner);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, Input[] input, int size);
  static Input Key(ushort key, bool up) {
    return new Input { type = 1, data = new Payload { key = new Keyboard { virtualKey = key, flags = up ? 2u : 0u } } };
  }
  public static uint Wake(IntPtr main, IntPtr guard, uint expectedOwner) {
    uint mainOwner, guardOwner;
    if (main == guard || GetWindowThreadProcessId(main, out mainOwner) == 0 || mainOwner != expectedOwner ||
        GetWindowThreadProcessId(guard, out guardOwner) == 0 || guardOwner != expectedOwner)
      throw new InvalidOperationException("The test must own both HWNDs.");
    if (IsWindowVisible(main)) throw new InvalidOperationException("The main HWND is still visible.");
    if (!IsWindowVisible(guard)) throw new InvalidOperationException("The guard HWND is hidden.");
    if (GetForegroundWindow() != guard) {
      SetForegroundWindow(guard);
      for (int i = 0; i < 12 && GetForegroundWindow() != guard; i++) Thread.Sleep(20);
      if (GetForegroundWindow() != guard) throw new InvalidOperationException("The test guard could not acquire the foreground.");
    }
    foreach (int key in new int[] { 0x10, 0x11, 0x12, 0x47, 0x5b, 0x5c })
      if ((GetAsyncKeyState(key) & 0x8000) != 0) throw new InvalidOperationException("A modifier or the shortcut key is already held.");
    Input[] chord = { Key(0x11, false), Key(0x10, false), Key(0x47, false),
                      Key(0x47, true), Key(0x10, true), Key(0x11, true) };
    if (GetForegroundWindow() != guard) throw new InvalidOperationException("The foreground guard changed.");
    uint sent = SendInput((uint)chord.Length, chord, Marshal.SizeOf(typeof(Input)));
    if (sent != chord.Length) throw new InvalidOperationException("Windows did not insert the complete chord.");
    for (int i = 0; i < 100 && !IsWindowVisible(main); i++) Thread.Sleep(20);
    return sent;
  }
}
'@
$main = [IntPtr]$MainHandle
[Console]::WriteLine('ready')
if ([Console]::ReadLine() -ne 'wake') { throw 'Expected the test window to be ready.' }
$sent = [PoolShortcutProbe]::Wake($main, [IntPtr]$GuardHandle, $Owner)
@{ foregroundGuardOwned = $true; mainWasHidden = $true; inputRecords = $sent; mainVisibleAfter = [PoolShortcutProbe]::IsWindowVisible($main) } | ConvertTo-Json -Compress
