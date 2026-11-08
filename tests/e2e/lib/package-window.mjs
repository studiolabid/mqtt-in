/**
 * check-package (Windows): read-only facts about the top-level windows of one process, for the
 * packaged app whose main process cannot be reached through Playwright. For each window: title,
 * extended style (WS_EX_TOOLWINDOW 0x80 keeps it out of the taskbar, Alt+Tab and Task View;
 * WS_EX_APPWINDOW 0x40000 forces it in), visibility, bounds and whether it is the foreground
 * window; plus the bounds of every display. All in physical pixels (a per-monitor DPI aware
 * thread). Nothing is changed: no window is moved, shown, focused or closed.
 */
import { execFile } from 'node:child_process'

const PROBE = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class MqttInWindowProbe {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  public class Bounds {
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
  }
  public class Window {
    public string Title { get; set; }
    public long ExStyle { get; set; }
    public bool Visible { get; set; }
    public bool Foreground { get; set; }
    public Bounds Bounds { get; set; }
  }
  public class Report {
    public List<Window> Windows { get; set; }
    public List<Bounds> Displays { get; set; }
  }
  delegate bool WindowProc(IntPtr hWnd, IntPtr data);
  delegate bool MonitorProc(IntPtr monitor, IntPtr hdc, ref RECT rect, IntPtr data);
  [DllImport("user32.dll")]
  static extern bool EnumWindows(WindowProc proc, IntPtr data);
  [DllImport("user32.dll")]
  static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorProc proc, IntPtr data);
  [DllImport("user32.dll")]
  static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")]
  static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")]
  static extern int GetWindowLong(IntPtr hWnd, int index);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")]
  static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  static Bounds ToBounds(RECT r) {
    var width = r.Right - r.Left;
    return new Bounds { X = r.Left, Y = r.Top, Width = width, Height = r.Bottom - r.Top };
  }
  public static Report Inspect(uint pid) {
    // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2: window and display bounds in physical pixels.
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    var report = new Report { Windows = new List<Window>(), Displays = new List<Bounds>() };
    IntPtr foreground = GetForegroundWindow();
    EnumWindows((hWnd, data) => {
      uint owner;
      GetWindowThreadProcessId(hWnd, out owner);
      if (owner != pid) return true;
      var title = new StringBuilder(512);
      GetWindowText(hWnd, title, 512);
      RECT rect;
      GetWindowRect(hWnd, out rect);
      report.Windows.Add(new Window {
        Title = title.ToString(),
        ExStyle = (uint)GetWindowLong(hWnd, -20),
        Visible = IsWindowVisible(hWnd),
        Foreground = hWnd == foreground,
        Bounds = ToBounds(rect)
      });
      return true;
    }, IntPtr.Zero);
    MonitorProc addDisplay = (IntPtr monitor, IntPtr hdc, ref RECT rect, IntPtr data) => {
      report.Displays.Add(ToBounds(rect));
      return true;
    };
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, addDisplay, IntPtr.Zero);
    return report;
  }
}
`

/** The windows of process `pid` and the displays, read through a short PowerShell P/Invoke. */
export function inspectWindows(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`invalid pid ${pid}`)
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `Add-Type -TypeDefinition @'\n${PROBE}\n'@`,
    `[MqttInWindowProbe]::Inspect(${pid}) | ConvertTo-Json -Compress -Depth 5`
  ].join('\n')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass']
  return new Promise((done, fail) => {
    execFile(
      'powershell.exe',
      [...args, '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 60_000 },
      (error, stdout, stderr) => {
        if (error) return fail(new Error(`window probe failed: ${stderr || error.message}`))
        const report = JSON.parse(stdout.trim())
        const windows = (report.Windows ?? []).map((w) => ({
          title: w.Title,
          toolWindow: (w.ExStyle & 0x80) !== 0,
          appWindow: (w.ExStyle & 0x40000) !== 0,
          visible: w.Visible,
          foreground: w.Foreground,
          bounds: { x: w.Bounds.X, y: w.Bounds.Y, width: w.Bounds.Width, height: w.Bounds.Height }
        }))
        const displays = (report.Displays ?? []).map((d) => ({
          x: d.X,
          y: d.Y,
          width: d.Width,
          height: d.Height
        }))
        done({ windows, displays })
      }
    )
  })
}

/** True when the rectangle overlaps any display. */
export function onAnyDisplay(rect, displays) {
  return displays.some(
    (d) =>
      rect.x < d.x + d.width &&
      rect.x + rect.width > d.x &&
      rect.y < d.y + d.height &&
      rect.y + rect.height > d.y
  )
}
