// User-enabled, bounded capture helper. No files, networking, screen enumeration,
// hooks or background loop. One frame per stdin request; EOF exits immediately.
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
public static class RegionCapture {
  [StructLayout(LayoutKind.Sequential)] struct RECT {public int Left,Top,Right,Bottom;}
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out RECT rect);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool GetWindowDisplayAffinity(IntPtr window,out uint affinity);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("dwmapi.dll")] static extern int DwmFlush();
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window,IntPtr insertAfter,int x,int y,int width,int height,uint flags);
  static int PositionOnly(string[] args) {
    if(args.Length!=3)return 2;
    var window=new IntPtr(long.Parse(args[1]));uint expected=uint.Parse(args[2]);
    string line;
    while((line=Console.ReadLine())!=null) {
      uint owner;GetWindowThreadProcessId(window,out owner);
      var parts=line.Split(' ');int x,y;
      if(owner!=expected || !IsWindowVisible(window) || parts.Length!=2 || !int.TryParse(parts[0],out x) || !int.TryParse(parts[1],out y))return 3;
      // SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE: never round-trip size.
      if(!SetWindowPos(window,IntPtr.Zero,x,y,0,0,0x0001|0x0004|0x0010))return 8;
      Console.WriteLine("ok");Console.Out.Flush();
    }
    return 0;
  }
  public static int Main(string[] args) {
    try {
      SetProcessDpiAwarenessContext(new IntPtr(-4));
      if(args.Length==3 && args[0]=="--geometry") {
        var target=new IntPtr(long.Parse(args[1]));uint owner;GetWindowThreadProcessId(target,out owner);RECT r;
        if(owner!=uint.Parse(args[2]) || !GetWindowRect(target,out r))return 3;
        Console.WriteLine(r.Left+" "+r.Top+" "+(r.Right-r.Left)+" "+(r.Bottom-r.Top));return 0;
      }
      if(args.Length>0 && args[0]=="--position")return PositionOnly(args);
      if(args.Length!=2)return 2;
      var window=new IntPtr(long.Parse(args[0]));uint expected=uint.Parse(args[1]);
      SetProcessDpiAwarenessContext(new IntPtr(-4));
      using(var output=new BinaryWriter(Console.OpenStandardOutput())) {
        while(Console.ReadLine()=="frame") {
          uint owner;GetWindowThreadProcessId(window,out owner);
          uint affinity;if(!GetWindowDisplayAffinity(window,out affinity) || affinity!=0x11)return 7;
          RECT r;if(owner!=expected || !IsWindowVisible(window) || !GetWindowRect(window,out r))return 3;
          int ww=r.Right-r.Left,wh=r.Bottom-r.Top;
          int margin=Math.Min(48,(int)Math.Ceiling(24.0*GetDpiForWindow(window)/96.0));
          int sx=GetSystemMetrics(76),sy=GetSystemMetrics(77),sw=GetSystemMetrics(78),sh=GetSystemMetrics(79);
          // Reject partially off-screen windows instead of inventing pixels.
          if(ww<=0 || wh<=0 || r.Left<sx || r.Top<sy || r.Right>sx+sw || r.Bottom>sy+sh)return 4;
          int left=Math.Max(sx,r.Left-margin),top=Math.Max(sy,r.Top-margin);
          int width=Math.Min(sx+sw,r.Right+margin)-left,height=Math.Min(sy+sh,r.Bottom+margin)-top;
          if(width>4096 || height>4096 || (long)width*height*4>24*1024*1024)return 5;
          DwmFlush();
          using(var bitmap=new Bitmap(width,height,PixelFormat.Format32bppArgb)) {
            using(var graphics=Graphics.FromImage(bitmap))graphics.CopyFromScreen(left,top,0,0,new Size(width,height),CopyPixelOperation.SourceCopy);
            var bits=bitmap.LockBits(new Rectangle(0,0,width,height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
            var rgba=new byte[width*height*4];
            try {for(int y=0;y<height;y++)Marshal.Copy(IntPtr.Add(bits.Scan0,y*bits.Stride),rgba,y*width*4,width*4);}
            finally {bitmap.UnlockBits(bits);}
            try {
            for(int i=0;i<rgba.Length;i+=4){byte blue=rgba[i];rgba[i]=rgba[i+2];rgba[i+2]=blue;rgba[i+3]=255;}
            RECT after;uint afterOwner,afterAffinity;GetWindowThreadProcessId(window,out afterOwner);
            if(afterOwner!=expected || !IsWindowVisible(window) || !GetWindowDisplayAffinity(window,out afterAffinity) || afterAffinity!=0x11 || !GetWindowRect(window,out after)) {Array.Clear(rgba,0,rgba.Length);return 7;}
            if(after.Left<left || after.Top<top || after.Right>left+width || after.Bottom>top+height) {
              // A moved window may reuse captured world pixels only if fully
              // covered. Main reprojects and crops to its current allowed ROI.
              Array.Clear(rgba,0,rgba.Length);output.Write(new byte[]{68,83,72,83});output.Write(new byte[36]);output.Flush();continue;
            }
            output.Write(new byte[]{68,83,72,71});output.Write(rgba.Length);output.Write(width);output.Write(height);
            output.Write(left);output.Write(top);output.Write(r.Left);output.Write(r.Top);output.Write(ww);output.Write(wh);
            output.Write(rgba);output.Flush();
            } finally {Array.Clear(rgba,0,rgba.Length);}
          }
        }
      }
      return 0;
    }catch {Console.Error.WriteLine("Region capture unavailable");return 6;}
  }
}
