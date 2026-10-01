using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

internal static class KeyListener
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const int VK_LEFT = 0x25;
    private const int VK_SHIFT = 0x10;
    private const int VK_CONTROL = 0x11;
    private const int VK_MENU = 0x12;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;
    private static string stateFolder = "";
    private static LowLevelKeyboardProc callback = HookCallback;
    private static IntPtr hook = IntPtr.Zero;
    private static HashSet<int> capturedKeys = new HashSet<int>();

    public static int Main(string[] args)
    {
        if (args.Length != 1) return 2;
        stateFolder = args[0];
        Directory.CreateDirectory(stateFolder);
        bool created;
        using (var mutex = new Mutex(true, "PremiereSubtitleNavigator.KeyListener", out created))
        {
            if (!created) return 0;
            hook = SetHook(callback);
            if (hook == IntPtr.Zero) return 3;
            try
            {
                var idleSince = DateTime.UtcNow;
                while (!File.Exists(Path.Combine(stateFolder, "stop")))
                {
                    MSG msg;
                    while (PeekMessage(out msg, IntPtr.Zero, 0, 0, 1))
                    {
                        TranslateMessage(ref msg);
                        DispatchMessage(ref msg);
                    }
                    if (IsHeartbeatFresh()) idleSince = DateTime.UtcNow;
                    if ((DateTime.UtcNow - idleSince).TotalMinutes > 10) break;
                    Thread.Sleep(10);
                }
            }
            finally { UnhookWindowsHookEx(hook); }
        }
        return 0;
    }

    private static IntPtr SetHook(LowLevelKeyboardProc proc)
    {
        using (var process = Process.GetCurrentProcess())
        using (var module = process.MainModule)
            return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(module.ModuleName), 0);
    }

    private static IntPtr HookCallback(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0)
        {
            int key = Marshal.ReadInt32(data);
            bool down = message == (IntPtr)WM_KEYDOWN || message == (IntPtr)WM_SYSKEYDOWN;
            bool up = message == (IntPtr)WM_KEYUP || message == (IntPtr)WM_SYSKEYUP;
            if (up && capturedKeys.Remove(key)) return (IntPtr)1;
            if (down && capturedKeys.Contains(key)) return (IntPtr)1;
            if (down && ShouldCapture())
            {
                string command = CommandForKey(key, IsDown(VK_CONTROL), IsDown(VK_SHIFT),
                    IsDown(VK_MENU), IsDown(VK_LWIN) || IsDown(VK_RWIN));
                if (command != null)
                {
                    try
                    {
                        File.AppendAllText(Path.Combine(stateFolder, "commands.queue"),
                            command + "|" + DateTime.UtcNow.Ticks + Environment.NewLine);
                        capturedKeys.Add(key);
                        return (IntPtr)1;
                    }
                    catch
                    {
                        // Never fall through to native undo: it could undo an unrelated old edit.
                        if (command == "undo" || command == "redo")
                        {
                            capturedKeys.Add(key);
                            return (IntPtr)1;
                        }
                    }
                }
                else if (!KeepsShortcutsActive(key, IsDown(VK_CONTROL), IsDown(VK_SHIFT),
                    IsDown(VK_MENU), IsDown(VK_LWIN) || IsDown(VK_RWIN)))
                {
                    // Release capture immediately. The panel notices this signal on its next poll.
                    // Let the triggering key continue to Premiere normally.
                    try { File.Delete(Path.Combine(stateFolder, "active")); } catch { }
                }
            }
        }
        return CallNextHookEx(hook, code, message, data);
    }

    internal static string CommandForKey(int key, bool control, bool shift, bool alt, bool win)
    {
        if (alt || win) return null;
        if (control && key == 0x5A) return shift ? "redo" : "undo";
        if (control || shift) return null;
        if (key == VK_LEFT) return "left";
        if (key == 0x27) return "right";
        if (key == 0xDB) return "trim-left"; // [ (VK_OEM_4)
        if (key == 0xDD) return "trim-right"; // ] (VK_OEM_6)
        return null;
    }

    internal static bool KeepsShortcutsActive(int key, bool control, bool shift, bool alt, bool win)
    {
        if (alt || win || key == VK_MENU || key == 0xA4 || key == 0xA5 || key == VK_LWIN || key == VK_RWIN) return false;
        // Ctrl and Shift must be allowed as prefixes for Ctrl+Z / Ctrl+Shift+Z.
        if (key == VK_CONTROL || key == 0xA2 || key == 0xA3 || key == VK_SHIFT || key == 0xA0 || key == 0xA1) return true;
        if (CommandForKey(key, control, shift, alt, win) != null) return true;
        return !control && !shift && (key == 0x20 || (key >= 0x25 && key <= 0x28));
    }

    private static bool IsDown(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }

    private static bool ShouldCapture()
    {
        if (!IsHeartbeatFresh()) return false;
        try
        {
            uint pid;
            GetWindowThreadProcessId(GetForegroundWindow(), out pid);
            var name = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant();
            return name.Contains("adobe premiere pro") || name == "premiere";
        }
        catch { return false; }
    }

    private static bool IsHeartbeatFresh()
    {
        try
        {
            var heartbeat = Path.Combine(stateFolder, "heartbeat");
            return File.Exists(Path.Combine(stateFolder, "active")) &&
                   File.Exists(heartbeat) &&
                   (DateTime.UtcNow - File.GetLastWriteTimeUtc(heartbeat)).TotalSeconds < 2.5;
        }
        catch { return false; }
    }

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] private struct MSG { public IntPtr HWnd; public uint Message; public UIntPtr WParam; public IntPtr LParam; public uint Time; public POINT Point; }
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc callback, IntPtr module, uint threadId);
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)] private static extern IntPtr GetModuleHandle(string moduleName);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool PeekMessage(out MSG message, IntPtr window, uint min, uint max, uint remove);
    [DllImport("user32.dll")] private static extern bool TranslateMessage([In] ref MSG message);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage([In] ref MSG message);
}
