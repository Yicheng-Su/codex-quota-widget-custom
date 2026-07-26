using System;
using System.Collections;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

internal static class ApprovalHelper
{
    private const string OfficialFamily = "OpenAI.Codex_2p2nqsd0c76g0";
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const uint InputKeyboard = 1;
    private const uint KeyEventKeyUp = 0x0002;
    private const uint KeyEventUnicode = 0x0004;
    private const ushort VirtualKeyReturn = 0x0D;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 1024 * 1024 };

    [STAThread]
    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            if (args.Length != 1) return WriteResult(Failure("invalid-request"));
            string requestJson = Encoding.UTF8.GetString(Convert.FromBase64String(args[0]));
            Dictionary<string, object> request = AsDictionary(Json.DeserializeObject(requestJson));
            string action = GetString(request, "action");
            if (action != "insert" && action != "submit") return WriteResult(Failure("unsupported-action"));

            if (!WaitForBlockingModifiersToRelease(750)) return WriteResult(Failure("modifier-key-down"));

            Dictionary<string, object> target = GetForegroundTarget();
            if (action == "submit")
            {
                Dictionary<string, object> expected = AsDictionary(GetValue(request, "expected"));
                if (expected == null || !TargetsEqual(target, expected)) return WriteResult(Failure("target-changed"));
            }

            Dictionary<string, object> confirmed = GetForegroundTarget();
            if (!TargetsEqual(target, confirmed)) return WriteResult(Failure("target-changed"));

            if (action == "insert")
            {
                if (SendUnicodeText("批准") != 4) return WriteResult(Failure("send-input-failed"));
                Thread.Sleep(8);
                Dictionary<string, object> after = GetForegroundTarget();
                if (!TargetsEqual(target, after))
                {
                    Dictionary<string, object> changed = Failure("target-changed-after-input");
                    changed["inputWasSent"] = true;
                    return WriteResult(changed);
                }
                Dictionary<string, object> inserted = Success("inserted");
                inserted["target"] = after;
                return WriteResult(inserted);
            }

            if (SendEnter() != 2) return WriteResult(Failure("send-input-failed"));
            Dictionary<string, object> submitted = Success("submitted");
            submitted["target"] = target;
            return WriteResult(submitted);
        }
        catch (BridgeException error)
        {
            return WriteResult(Failure(error.Code));
        }
        catch
        {
            return WriteResult(Failure("bridge-error"));
        }
    }

    private static Dictionary<string, object> GetForegroundTarget()
    {
        IntPtr window = GetForegroundWindow();
        if (window == IntPtr.Zero || !IsWindow(window) || !IsWindowVisible(window) || IsIconic(window))
            throw new BridgeException("foreground-window-unavailable");

        uint processId;
        GetWindowThreadProcessId(window, out processId);
        if (processId == 0) throw new BridgeException("foreground-process-unavailable");
        Dictionary<string, object> identity = GetProcessIdentity(processId);
        if (!IsOfficialCodex(identity)) throw new BridgeException("foreground-not-official-codex");

        Dictionary<string, object> target = new Dictionary<string, object>();
        target["hwnd"] = "0x" + ((ulong)window.ToInt64()).ToString("x");
        target["pid"] = identity["pid"];
        target["processCreated"] = identity["processCreated"];
        target["imagePath"] = identity["imagePath"];
        target["packageFamily"] = identity["packageFamily"];
        target["control"] = GetFocusedControl();
        return target;
    }

    private static Dictionary<string, object> GetFocusedControl()
    {
        AutomationElement element = AutomationElement.FocusedElement;
        if (element == null) throw new BridgeException("uia-focus-unavailable");
        AutomationElement.AutomationElementInformation current = element.Current;
        string typeName = current.ControlType.ProgrammaticName;
        if (!current.IsEnabled || !current.IsKeyboardFocusable || !current.HasKeyboardFocus ||
            (typeName != "ControlType.Edit" && typeName != "ControlType.Document"))
            throw new BridgeException("focused-control-not-editable");

        Dictionary<string, object> identity = GetProcessIdentity((uint)current.ProcessId);
        if (!IsOfficialCodex(identity)) throw new BridgeException("focused-control-not-codex");

        List<string> ancestry = new List<string>();
        AutomationElement cursor = element;
        TreeWalker walker = TreeWalker.RawViewWalker;
        for (int index = 0; index < 16 && cursor != null; index++)
        {
            ancestry.Add(GetRuntimeId(cursor));
            cursor = walker.GetParent(cursor);
        }

        Dictionary<string, object> control = new Dictionary<string, object>();
        control["processId"] = current.ProcessId;
        control["processCreated"] = identity["processCreated"];
        control["imagePath"] = identity["imagePath"];
        control["packageFamily"] = identity["packageFamily"];
        control["runtimeId"] = GetRuntimeId(element);
        control["ancestry"] = ancestry;
        control["controlType"] = typeName;
        control["automationId"] = current.AutomationId ?? "";
        control["className"] = current.ClassName ?? "";
        control["frameworkId"] = current.FrameworkId ?? "";
        control["isKeyboardFocusable"] = current.IsKeyboardFocusable;
        control["hasKeyboardFocus"] = current.HasKeyboardFocus;
        control["isEnabled"] = current.IsEnabled;
        return control;
    }

    private static Dictionary<string, object> GetProcessIdentity(uint processId)
    {
        IntPtr process = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (process == IntPtr.Zero) throw new BridgeException("process-query-denied");
        try
        {
            StringBuilder image = new StringBuilder(32768);
            uint imageLength = (uint)image.Capacity;
            if (!QueryFullProcessImageName(process, 0, image, ref imageLength))
                throw new BridgeException("process-path-unavailable");

            FileTime created, exited, kernel, user;
            if (!GetProcessTimes(process, out created, out exited, out kernel, out user))
                throw new BridgeException("process-time-unavailable");
            ulong createdValue = ((ulong)created.High << 32) + created.Low;

            uint familyLength = 0;
            GetPackageFamilyName(process, ref familyLength, null);
            string family = "";
            if (familyLength > 0)
            {
                StringBuilder familyBuffer = new StringBuilder((int)familyLength);
                if (GetPackageFamilyName(process, ref familyLength, familyBuffer) == 0)
                    family = familyBuffer.ToString();
            }

            Dictionary<string, object> identity = new Dictionary<string, object>();
            identity["pid"] = (int)processId;
            identity["processCreated"] = createdValue.ToString();
            identity["imagePath"] = image.ToString();
            identity["packageFamily"] = family;
            return identity;
        }
        finally
        {
            CloseHandle(process);
        }
    }

    private static bool IsOfficialCodex(Dictionary<string, object> identity)
    {
        string family = GetString(identity, "packageFamily");
        string imagePath = GetString(identity, "imagePath");
        return String.Equals(family, OfficialFamily, StringComparison.OrdinalIgnoreCase) &&
            imagePath.IndexOf("\\WindowsApps\\OpenAI.Codex_", StringComparison.OrdinalIgnoreCase) >= 0 &&
            imagePath.EndsWith("\\app\\ChatGPT.exe", StringComparison.OrdinalIgnoreCase);
    }

    private static string GetRuntimeId(AutomationElement element)
    {
        int[] values = element.GetRuntimeId();
        if (values == null || values.Length == 0) throw new BridgeException("uia-runtime-id-unavailable");
        string[] text = new string[values.Length];
        for (int index = 0; index < values.Length; index++) text[index] = values[index].ToString();
        return String.Join(".", text);
    }

    private static bool TargetsEqual(Dictionary<string, object> left, Dictionary<string, object> right)
    {
        if (left == null || right == null) return false;
        return EqualText(left, right, "hwnd", true) &&
            GetInt(left, "pid") == GetInt(right, "pid") &&
            EqualText(left, right, "processCreated", false) &&
            EqualText(left, right, "imagePath", true) &&
            EqualText(left, right, "packageFamily", true) &&
            ControlsEqual(AsDictionary(GetValue(left, "control")), AsDictionary(GetValue(right, "control")));
    }

    private static bool ControlsEqual(Dictionary<string, object> left, Dictionary<string, object> right)
    {
        if (left == null || right == null) return false;
        return GetInt(left, "processId") == GetInt(right, "processId") &&
            EqualText(left, right, "processCreated", false) &&
            EqualText(left, right, "imagePath", true) &&
            EqualText(left, right, "packageFamily", true) &&
            EqualText(left, right, "runtimeId", false) &&
            EqualText(left, right, "controlType", false) &&
            EqualText(left, right, "automationId", false) &&
            EqualText(left, right, "className", false) &&
            EqualText(left, right, "frameworkId", false) &&
            StringListsEqual(GetValue(left, "ancestry"), GetValue(right, "ancestry"));
    }

    private static bool StringListsEqual(object leftValue, object rightValue)
    {
        IList left = leftValue as IList;
        IList right = rightValue as IList;
        if (left == null || right == null || left.Count != right.Count) return false;
        for (int index = 0; index < left.Count; index++)
            if (!String.Equals(Convert.ToString(left[index]), Convert.ToString(right[index]), StringComparison.Ordinal)) return false;
        return true;
    }

    private static bool EqualText(Dictionary<string, object> left, Dictionary<string, object> right, string key, bool ignoreCase)
    {
        return String.Equals(GetString(left, key), GetString(right, key),
            ignoreCase ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);
    }

    private static object GetValue(Dictionary<string, object> value, string key)
    {
        object result;
        return value != null && value.TryGetValue(key, out result) ? result : null;
    }

    private static string GetString(Dictionary<string, object> value, string key)
    {
        object raw = GetValue(value, key);
        return raw == null ? "" : Convert.ToString(raw);
    }

    private static int GetInt(Dictionary<string, object> value, string key)
    {
        object raw = GetValue(value, key);
        int result;
        return raw != null && Int32.TryParse(Convert.ToString(raw), out result) ? result : 0;
    }

    private static Dictionary<string, object> AsDictionary(object value)
    {
        return value as Dictionary<string, object>;
    }

    private static Dictionary<string, object> Success(string code)
    {
        Dictionary<string, object> result = new Dictionary<string, object>();
        result["ok"] = true;
        result["code"] = code;
        return result;
    }

    private static Dictionary<string, object> Failure(string code)
    {
        Dictionary<string, object> result = new Dictionary<string, object>();
        result["ok"] = false;
        result["code"] = code;
        return result;
    }

    private static int WriteResult(Dictionary<string, object> result)
    {
        Console.WriteLine(Json.Serialize(result));
        return 0;
    }

    private static bool BlockingModifierIsDown()
    {
        int[] keys = { 0x10, 0x11, 0x12, 0x5B, 0x5C };
        foreach (int key in keys) if ((GetAsyncKeyState(key) & 0x8000) != 0) return true;
        return false;
    }

    private static bool WaitForBlockingModifiersToRelease(int timeoutMilliseconds)
    {
        int attempts = Math.Max(1, timeoutMilliseconds / 10);
        for (int attempt = 0; attempt < attempts; attempt++)
        {
            if (!BlockingModifierIsDown()) return true;
            Thread.Sleep(10);
        }
        return !BlockingModifierIsDown();
    }

    private static uint SendUnicodeText(string text)
    {
        Input[] inputs = new Input[text.Length * 2];
        for (int index = 0; index < text.Length; index++)
        {
            inputs[index * 2].Type = InputKeyboard;
            inputs[index * 2].Data.Keyboard.Scan = text[index];
            inputs[index * 2].Data.Keyboard.Flags = KeyEventUnicode;
            inputs[index * 2 + 1].Type = InputKeyboard;
            inputs[index * 2 + 1].Data.Keyboard.Scan = text[index];
            inputs[index * 2 + 1].Data.Keyboard.Flags = KeyEventUnicode | KeyEventKeyUp;
        }
        return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input)));
    }

    private static uint SendEnter()
    {
        Input[] inputs = new Input[2];
        inputs[0].Type = InputKeyboard;
        inputs[0].Data.Keyboard.VirtualKey = VirtualKeyReturn;
        inputs[1].Type = InputKeyboard;
        inputs[1].Data.Keyboard.VirtualKey = VirtualKeyReturn;
        inputs[1].Data.Keyboard.Flags = KeyEventKeyUp;
        return SendInput(2, inputs, Marshal.SizeOf(typeof(Input)));
    }

    private sealed class BridgeException : Exception
    {
        internal readonly string Code;
        internal BridgeException(string code) : base(code) { Code = code; }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime { internal uint Low; internal uint High; }
    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput { internal int X, Y; internal uint Data, Flags, Time; internal UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput { internal ushort VirtualKey, Scan; internal uint Flags, Time; internal UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)]
    private struct HardwareInput { internal uint Message; internal ushort ParamLow, ParamHigh; }
    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] internal MouseInput Mouse;
        [FieldOffset(0)] internal KeyboardInput Keyboard;
        [FieldOffset(0)] internal HardwareInput Hardware;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Input { internal uint Type; internal InputUnion Data; }

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder path, ref uint size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetProcessTimes(IntPtr process, out FileTime created, out FileTime exited, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetPackageFamilyName(IntPtr process, ref uint length, StringBuilder familyName);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
}
