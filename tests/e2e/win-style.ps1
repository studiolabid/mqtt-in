<#
.SYNOPSIS
  Read-only facts about the windows of an e2e run (Windows only), for tests/e2e/suites/platform-*.

.DESCRIPTION
  -Hwnd <decimal>      one top-level window (BrowserWindow.getNativeWindowHandle()): its title,
                       style and extended style (WS_EX_TOOLWINDOW 0x80 keeps it out of the taskbar,
                       Alt+Tab and Task View; WS_EX_APPWINDOW 0x40000 forces it in;
                       WS_EX_NOACTIVATE 0x08000000 means it cannot be activated), visibility,
                       owner, rectangle (physical pixels) and whether it is the foreground window.
  -ProcessId <pid>     every VISIBLE top-level window of that process (title, class, extended
                       style): an automation run must have exactly one, its own window.

  Always: the handle of the foreground window (the user's, unless something took the focus).
  Nothing is changed: no window is moved, shown, focused, styled or closed.

.EXAMPLE
  powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File tests/e2e/win-style.ps1 -Hwnd 1234 -ProcessId 5678
#>
param(
  [string]$Hwnd = '',
  [int]$ProcessId = 0
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class MqttInWinStyle {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  public class Info {
    public string Hwnd { get; set; }
    public string Title { get; set; }
    public string ClassName { get; set; }
    public long Style { get; set; }
    public long ExStyle { get; set; }
    public bool Visible { get; set; }
    public string Owner { get; set; }
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
  }

  delegate bool WindowProc(IntPtr hWnd, IntPtr data);

  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
  static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
  static extern int GetWindowLong32(IntPtr hWnd, int index);
  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
  [DllImport("user32.dll")]
  static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetClassName(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")]
  static extern bool EnumWindows(WindowProc proc, IntPtr data);
  [DllImport("user32.dll")]
  static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")]
  static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

  /** GWL_STYLE (-16) or GWL_EXSTYLE (-20), as an unsigned 32-bit value. */
  static long Long(IntPtr hWnd, int index) {
    long value = IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, index).ToInt64() : GetWindowLong32(hWnd, index);
    return value & 0xFFFFFFFFL;
  }

  public static void PhysicalPixels() {
    try {
      // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 (this thread only): rectangles in pixels.
      SetThreadDpiAwarenessContext(new IntPtr(-4));
    } catch (EntryPointNotFoundException) {
      // Before Windows 10 1607: logical coordinates.
    }
  }

  public static Info Describe(IntPtr hWnd) {
    var title = new StringBuilder(512);
    GetWindowText(hWnd, title, 512);
    var cls = new StringBuilder(256);
    GetClassName(hWnd, cls, 256);
    RECT rect;
    GetWindowRect(hWnd, out rect);
    return new Info {
      Hwnd = hWnd.ToInt64().ToString(),
      Title = title.ToString(),
      ClassName = cls.ToString(),
      Style = Long(hWnd, -16),
      ExStyle = Long(hWnd, -20),
      Visible = IsWindowVisible(hWnd),
      // GW_OWNER = 4
      Owner = GetWindow(hWnd, 4).ToInt64().ToString(),
      X = rect.Left,
      Y = rect.Top,
      Width = rect.Right - rect.Left,
      Height = rect.Bottom - rect.Top
    };
  }

  public static List<Info> VisibleWindowsOf(uint pid) {
    var found = new List<Info>();
    EnumWindows((hWnd, data) => {
      uint owner;
      GetWindowThreadProcessId(hWnd, out owner);
      if (owner == pid && IsWindowVisible(hWnd)) found.Add(Describe(hWnd));
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@

[MqttInWinStyle]::PhysicalPixels()
$foreground = [MqttInWinStyle]::GetForegroundWindow()
$report = [ordered]@{
  foregroundHwnd = $foreground.ToInt64().ToString()
  window = $null
  processWindows = $null
}
if ($Hwnd -ne '') {
  $handle = [IntPtr]::new([Int64]::Parse($Hwnd))
  if ([MqttInWinStyle]::IsWindow($handle)) {
    $info = [MqttInWinStyle]::Describe($handle)
    $report.window = [ordered]@{
      hwnd = $info.Hwnd
      title = $info.Title
      className = $info.ClassName
      style = $info.Style
      exStyle = $info.ExStyle
      toolWindow = (($info.ExStyle -band 0x80) -ne 0)
      appWindow = (($info.ExStyle -band 0x40000) -ne 0)
      noActivate = (($info.ExStyle -band 0x08000000) -ne 0)
      topmost = (($info.ExStyle -band 0x8) -ne 0)
      visible = $info.Visible
      owner = $info.Owner
      foreground = ($handle -eq $foreground)
      rect = [ordered]@{ x = $info.X; y = $info.Y; width = $info.Width; height = $info.Height }
    }
  }
}
if ($ProcessId -gt 0) {
  $report.processWindows = @(
    [MqttInWinStyle]::VisibleWindowsOf([uint32]$ProcessId) | ForEach-Object {
      [ordered]@{
        hwnd = $_.Hwnd
        title = $_.Title
        className = $_.ClassName
        exStyle = $_.ExStyle
        toolWindow = (($_.ExStyle -band 0x80) -ne 0)
        rect = [ordered]@{ x = $_.X; y = $_.Y; width = $_.Width; height = $_.Height }
      }
    }
  )
}
$report | ConvertTo-Json -Compress -Depth 4
