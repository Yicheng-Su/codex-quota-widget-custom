const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const APPROVAL_TEXT = "批准";
const DEFAULT_TOKEN_TTL_MS = 31_000;
const APPROVAL_HELPER_NAME = "ChatGPTQuotaApprovalHelper.exe";
const OFFICIAL_CODEX_PACKAGE_FAMILY = "OpenAI.Codex_2p2nqsd0c76g0";
const OFFICIAL_CODEX_IMAGE_PATTERN = /[\\/]WindowsApps[\\/]OpenAI\.Codex_[^\\/]+[\\/]app[\\/]ChatGPT\.exe$/i;

// This script deliberately exposes only two fixed actions. The renderer must
// never be able to turn this bridge into a generic key-injection facility.
const POWERSHELL_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Write-Result([object]$value) {
  [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 10))
  exit 0
}

try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes

  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace ChatGPTQuotaApproval {
  public static class Native {
    public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    public const uint INPUT_KEYBOARD = 1;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_UNICODE = 0x0004;
    public const ushort VK_RETURN = 0x0D;

    [StructLayout(LayoutKind.Sequential)]
    public struct FILETIME {
      public uint dwLowDateTime;
      public uint dwHighDateTime;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
      public int dx;
      public int dy;
      public uint mouseData;
      public uint dwFlags;
      public uint time;
      public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
      public ushort wVk;
      public ushort wScan;
      public uint dwFlags;
      public uint time;
      public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT {
      public uint uMsg;
      public ushort wParamL;
      public ushort wParamH;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION {
      [FieldOffset(0)] public MOUSEINPUT mi;
      [FieldOffset(0)] public KEYBDINPUT ki;
      [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
      public uint type;
      public INPUTUNION data;
    }

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int virtualKey);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint count, INPUT[] inputs, int size);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder path, ref uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetProcessTimes(
      IntPtr process,
      out FILETIME creation,
      out FILETIME exit,
      out FILETIME kernel,
      out FILETIME user
    );

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetPackageFamilyName(IntPtr process, ref uint length, StringBuilder familyName);

    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr handle);

    public static bool BlockingModifierIsDown() {
      int[] keys = { 0x10, 0x11, 0x12, 0x5B, 0x5C };
      foreach (int key in keys) {
        if ((GetAsyncKeyState(key) & 0x8000) != 0) return true;
      }
      return false;
    }

    public static uint SendUnicodeText(string text) {
      char[] chars = text.ToCharArray();
      INPUT[] inputs = new INPUT[chars.Length * 2];
      for (int index = 0; index < chars.Length; index++) {
        inputs[index * 2].type = INPUT_KEYBOARD;
        inputs[index * 2].data.ki.wVk = 0;
        inputs[index * 2].data.ki.wScan = chars[index];
        inputs[index * 2].data.ki.dwFlags = KEYEVENTF_UNICODE;

        inputs[index * 2 + 1].type = INPUT_KEYBOARD;
        inputs[index * 2 + 1].data.ki.wVk = 0;
        inputs[index * 2 + 1].data.ki.wScan = chars[index];
        inputs[index * 2 + 1].data.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
      }
      return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    public static uint SendEnter() {
      INPUT[] inputs = new INPUT[2];
      inputs[0].type = INPUT_KEYBOARD;
      inputs[0].data.ki.wVk = VK_RETURN;
      inputs[1].type = INPUT_KEYBOARD;
      inputs[1].data.ki.wVk = VK_RETURN;
      inputs[1].data.ki.dwFlags = KEYEVENTF_KEYUP;
      return SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
    }
  }
}
'@

  $officialFamily = "OpenAI.Codex_2p2nqsd0c76g0"
  $requestBytes = [Convert]::FromBase64String($env:CHATGPT_QUOTA_APPROVAL_REQUEST)
  $requestJson = [Text.Encoding]::UTF8.GetString($requestBytes)
  $request = $requestJson | ConvertFrom-Json

  if ($request.action -ne "insert" -and $request.action -ne "submit") {
    Write-Result ([ordered]@{ ok = $false; code = "unsupported-action" })
  }

  function Get-ProcessIdentity([uint32]$processId) {
    $handle = [ChatGPTQuotaApproval.Native]::OpenProcess(
      [ChatGPTQuotaApproval.Native]::PROCESS_QUERY_LIMITED_INFORMATION,
      $false,
      $processId
    )
    if ($handle -eq [IntPtr]::Zero) { throw "process-query-denied" }

    try {
      $pathBuffer = New-Object Text.StringBuilder 32768
      [uint32]$pathLength = $pathBuffer.Capacity
      if (-not [ChatGPTQuotaApproval.Native]::QueryFullProcessImageName($handle, 0, $pathBuffer, [ref]$pathLength)) {
        throw "process-path-unavailable"
      }

      $creation = New-Object ChatGPTQuotaApproval.Native+FILETIME
      $exit = New-Object ChatGPTQuotaApproval.Native+FILETIME
      $kernel = New-Object ChatGPTQuotaApproval.Native+FILETIME
      $user = New-Object ChatGPTQuotaApproval.Native+FILETIME
      if (-not [ChatGPTQuotaApproval.Native]::GetProcessTimes(
        $handle,
        [ref]$creation,
        [ref]$exit,
        [ref]$kernel,
        [ref]$user
      )) { throw "process-time-unavailable" }

      [uint64]$created = ([uint64]$creation.dwHighDateTime * 4294967296) + [uint64]$creation.dwLowDateTime
      [uint32]$familyLength = 0
      [void][ChatGPTQuotaApproval.Native]::GetPackageFamilyName($handle, [ref]$familyLength, $null)
      $family = ""
      if ($familyLength -gt 0) {
        $familyBuffer = New-Object Text.StringBuilder ([int]$familyLength)
        $familyResult = [ChatGPTQuotaApproval.Native]::GetPackageFamilyName(
          $handle,
          [ref]$familyLength,
          $familyBuffer
        )
        if ($familyResult -eq 0) { $family = $familyBuffer.ToString() }
      }

      return [ordered]@{
        pid = [int]$processId
        created = [string]$created
        imagePath = $pathBuffer.ToString()
        packageFamily = $family
      }
    } finally {
      [void][ChatGPTQuotaApproval.Native]::CloseHandle($handle)
    }
  }

  function Test-OfficialCodex([object]$identity) {
    return (
      $identity.packageFamily -ieq $officialFamily -and
      $identity.imagePath -match '\\WindowsApps\\OpenAI\.Codex_[^\\]+\\app\\ChatGPT\.exe$'
    )
  }

  function Get-RuntimeId([Windows.Automation.AutomationElement]$element) {
    $parts = $element.GetRuntimeId()
    if ($null -eq $parts -or $parts.Count -eq 0) { throw "uia-runtime-id-unavailable" }
    return (($parts | ForEach-Object { [string]$_ }) -join ".")
  }

  function Get-FocusedControl {
    $element = [Windows.Automation.AutomationElement]::FocusedElement
    if ($null -eq $element) { throw "uia-focus-unavailable" }

    $current = $element.Current
    $typeName = $current.ControlType.ProgrammaticName
    if (
      -not $current.IsEnabled -or
      -not $current.IsKeyboardFocusable -or
      -not $current.HasKeyboardFocus -or
      ($typeName -ne "ControlType.Edit" -and $typeName -ne "ControlType.Document")
    ) { throw "focused-control-not-editable" }

    $controlIdentity = Get-ProcessIdentity ([uint32]$current.ProcessId)
    if (-not (Test-OfficialCodex $controlIdentity)) { throw "focused-control-not-codex" }

    $ancestry = New-Object Collections.Generic.List[string]
    $cursor = $element
    $walker = [Windows.Automation.TreeWalker]::RawViewWalker
    for ($index = 0; $index -lt 16 -and $null -ne $cursor; $index++) {
      $ancestry.Add((Get-RuntimeId $cursor))
      $cursor = $walker.GetParent($cursor)
    }

    return [ordered]@{
      processId = [int]$current.ProcessId
      processCreated = $controlIdentity.created
      imagePath = $controlIdentity.imagePath
      packageFamily = $controlIdentity.packageFamily
      runtimeId = Get-RuntimeId $element
      ancestry = @($ancestry)
      controlType = $typeName
      automationId = [string]$current.AutomationId
      className = [string]$current.ClassName
      frameworkId = [string]$current.FrameworkId
      isKeyboardFocusable = [bool]$current.IsKeyboardFocusable
      hasKeyboardFocus = [bool]$current.HasKeyboardFocus
      isEnabled = [bool]$current.IsEnabled
    }
  }

  function Get-ForegroundTarget {
    $window = [ChatGPTQuotaApproval.Native]::GetForegroundWindow()
    if (
      $window -eq [IntPtr]::Zero -or
      -not [ChatGPTQuotaApproval.Native]::IsWindow($window) -or
      -not [ChatGPTQuotaApproval.Native]::IsWindowVisible($window) -or
      [ChatGPTQuotaApproval.Native]::IsIconic($window)
    ) { throw "foreground-window-unavailable" }

    [uint32]$windowProcessId = 0
    [void][ChatGPTQuotaApproval.Native]::GetWindowThreadProcessId($window, [ref]$windowProcessId)
    if ($windowProcessId -eq 0) { throw "foreground-process-unavailable" }

    $identity = Get-ProcessIdentity $windowProcessId
    if (-not (Test-OfficialCodex $identity)) { throw "foreground-not-official-codex" }

    return [ordered]@{
      hwnd = ("0x{0:x}" -f ([uint64]$window.ToInt64()))
      pid = $identity.pid
      processCreated = $identity.created
      imagePath = $identity.imagePath
      packageFamily = $identity.packageFamily
      control = Get-FocusedControl
    }
  }

  function Test-StringArrayEqual([object]$left, [object]$right) {
    $leftValues = @($left)
    $rightValues = @($right)
    if ($leftValues.Count -ne $rightValues.Count) { return $false }
    for ($index = 0; $index -lt $leftValues.Count; $index++) {
      if ([string]$leftValues[$index] -cne [string]$rightValues[$index]) { return $false }
    }
    return $true
  }

  function Test-ControlEqual([object]$actual, [object]$expected) {
    return (
      [int]$actual.processId -eq [int]$expected.processId -and
      [string]$actual.processCreated -ceq [string]$expected.processCreated -and
      [string]$actual.packageFamily -ieq [string]$expected.packageFamily -and
      [string]$actual.imagePath -ieq [string]$expected.imagePath -and
      [string]$actual.runtimeId -ceq [string]$expected.runtimeId -and
      (Test-StringArrayEqual $actual.ancestry $expected.ancestry) -and
      [string]$actual.controlType -ceq [string]$expected.controlType -and
      [string]$actual.automationId -ceq [string]$expected.automationId -and
      [string]$actual.className -ceq [string]$expected.className -and
      [string]$actual.frameworkId -ceq [string]$expected.frameworkId
    )
  }

  function Test-TargetEqual([object]$actual, [object]$expected) {
    return (
      [string]$actual.hwnd -ieq [string]$expected.hwnd -and
      [int]$actual.pid -eq [int]$expected.pid -and
      [string]$actual.processCreated -ceq [string]$expected.processCreated -and
      [string]$actual.packageFamily -ieq [string]$expected.packageFamily -and
      [string]$actual.imagePath -ieq [string]$expected.imagePath -and
      (Test-ControlEqual $actual.control $expected.control)
    )
  }

  $target = Get-ForegroundTarget

  if ($request.action -eq "submit") {
    if ($null -eq $request.expected -or -not (Test-TargetEqual $target $request.expected)) {
      Write-Result ([ordered]@{ ok = $false; code = "target-changed" })
    }
  }

  if ([ChatGPTQuotaApproval.Native]::BlockingModifierIsDown()) {
    Write-Result ([ordered]@{ ok = $false; code = "modifier-key-down" })
  }

  $confirmed = Get-ForegroundTarget
  if (-not (Test-TargetEqual $confirmed $target)) {
    Write-Result ([ordered]@{ ok = $false; code = "target-changed" })
  }

  if ($request.action -eq "insert") {
    $approvalText = ([char]0x6279).ToString() + ([char]0x51C6).ToString()
    $sent = [ChatGPTQuotaApproval.Native]::SendUnicodeText($approvalText)
    if ($sent -ne 4) {
      Write-Result ([ordered]@{ ok = $false; code = "send-input-failed"; sent = [int]$sent })
    }
    Start-Sleep -Milliseconds 20
    $after = Get-ForegroundTarget
    if (-not (Test-TargetEqual $after $target)) {
      Write-Result ([ordered]@{
        ok = $false
        code = "target-changed-after-input"
        inputWasSent = $true
      })
    }
    Write-Result ([ordered]@{ ok = $true; code = "inserted"; target = $after })
  }

  $sent = [ChatGPTQuotaApproval.Native]::SendEnter()
  if ($sent -ne 2) {
    Write-Result ([ordered]@{ ok = $false; code = "send-input-failed"; sent = [int]$sent })
  }

  # A successful Enter can legitimately replace the editor immediately, so
  # the pre-send target is returned. Requiring the control to survive the
  # submission would turn a successful send into a false failure.
  Write-Result ([ordered]@{ ok = $true; code = "submitted"; target = $target })
} catch {
  $message = [string]$_.Exception.Message
  $knownCodes = @(
    "process-query-denied",
    "process-path-unavailable",
    "process-time-unavailable",
    "uia-runtime-id-unavailable",
    "uia-focus-unavailable",
    "focused-control-not-editable",
    "focused-control-not-codex",
    "foreground-window-unavailable",
    "foreground-process-unavailable",
    "foreground-not-official-codex"
  )
  $code = if ($knownCodes -contains $message) { $message } else { "bridge-error" }
  Write-Result ([ordered]@{ ok = $false; code = $code })
}
`;

const POWERSHELL_BOOTSTRAP = String.raw`
$ErrorActionPreference = "Stop"
$sourceBytes = [Convert]::FromBase64String($env:CHATGPT_QUOTA_APPROVAL_SCRIPT)
$source = [Text.Encoding]::UTF8.GetString($sourceBytes)
& ([ScriptBlock]::Create($source))
`;

function isOfficialCodexIdentity(identity) {
  return Boolean(
    identity &&
      identity.packageFamily === OFFICIAL_CODEX_PACKAGE_FAMILY &&
      typeof identity.imagePath === "string" &&
      OFFICIAL_CODEX_IMAGE_PATTERN.test(identity.imagePath)
  );
}

function isEditableControlFingerprint(control) {
  return Boolean(
    control &&
      Number.isInteger(control.processId) &&
      control.processId > 0 &&
      typeof control.processCreated === "string" &&
      control.processCreated.length > 0 &&
      isOfficialCodexIdentity(control) &&
      typeof control.runtimeId === "string" &&
      control.runtimeId.length > 0 &&
      Array.isArray(control.ancestry) &&
      control.ancestry.length > 0 &&
      control.ancestry.every((value) => typeof value === "string" && value.length > 0) &&
      (control.controlType === "ControlType.Edit" || control.controlType === "ControlType.Document") &&
      control.isKeyboardFocusable === true &&
      control.hasKeyboardFocus === true &&
      control.isEnabled === true
  );
}

function validateTargetSnapshot(target) {
  return Boolean(
    target &&
      typeof target.hwnd === "string" &&
      /^0x[0-9a-f]+$/i.test(target.hwnd) &&
      target.hwnd !== "0x0" &&
      Number.isInteger(target.pid) &&
      target.pid > 0 &&
      typeof target.processCreated === "string" &&
      target.processCreated.length > 0 &&
      isOfficialCodexIdentity(target) &&
      isEditableControlFingerprint(target.control)
  );
}

function sameStringArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameControlFingerprint(left, right) {
  return Boolean(
    isEditableControlFingerprint(left) &&
      isEditableControlFingerprint(right) &&
      left.processId === right.processId &&
      left.processCreated === right.processCreated &&
      left.imagePath.toLowerCase() === right.imagePath.toLowerCase() &&
      left.packageFamily === right.packageFamily &&
      left.runtimeId === right.runtimeId &&
      sameStringArray(left.ancestry, right.ancestry) &&
      left.controlType === right.controlType &&
      String(left.automationId || "") === String(right.automationId || "") &&
      String(left.className || "") === String(right.className || "") &&
      String(left.frameworkId || "") === String(right.frameworkId || "")
  );
}

function sameTargetSnapshot(left, right) {
  return Boolean(
    validateTargetSnapshot(left) &&
      validateTargetSnapshot(right) &&
      left.hwnd.toLowerCase() === right.hwnd.toLowerCase() &&
      left.pid === right.pid &&
      left.processCreated === right.processCreated &&
      left.imagePath.toLowerCase() === right.imagePath.toLowerCase() &&
      left.packageFamily === right.packageFamily &&
      sameControlFingerprint(left.control, right.control)
  );
}

function buildRunnerRequest(action, expected) {
  if (action === "insert") return Object.freeze({ action: "insert" });
  if (action === "submit" && validateTargetSnapshot(expected)) {
    return { action: "submit", expected: structuredCloneSafe(expected) };
  }
  throw new TypeError("Invalid Windows approval action or target");
}

function parsePowerShellOutput(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) throw new Error("PowerShell approval bridge returned no result");
  const parsed = JSON.parse(lines.at(-1));
  if (!parsed || typeof parsed !== "object" || typeof parsed.ok !== "boolean") {
    throw new Error("PowerShell approval bridge returned an invalid result");
  }
  return parsed;
}

function resolveApprovalHelperPath(options = {}) {
  if (options.helperPath) return options.helperPath;
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, APPROVAL_HELPER_NAME),
    path.join(__dirname, "../../.build-helper-test", APPROVAL_HELPER_NAME)
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function runApprovalHelper(request, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 2_000;
  const executable = resolveApprovalHelperPath(options);
  const encodedRequest = Buffer.from(JSON.stringify(request), "utf8").toString("base64");

  return new Promise((resolve, reject) => {
    if (!executable || !fs.existsSync(executable)) {
      reject(new Error(`Approval helper is missing: ${executable || "unknown"}`));
      return;
    }

    const child = spawn(executable, [encodedRequest], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const outputLimit = 1024 * 1024;
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      const error = new Error("Approval helper timed out");
      error.code = "ETIMEDOUT";
      reject(error);
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length <= outputLimit || settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(new Error("Approval helper output exceeded its limit"));
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-1_000);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const error = new Error(`Approval helper exited with code ${code}`);
        error.code = code;
        error.stderr = stderr;
        reject(error);
        return;
      }
      try {
        resolve(parsePowerShellOutput(stdout));
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function runPowerShell(request, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 4_000;
  const windowsRoot = process.env.SystemRoot || "C:\\Windows";
  const executable = path.join(
    windowsRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
  const encodedRequest = Buffer.from(JSON.stringify(request), "utf8").toString("base64");
  const encodedScript = Buffer.from(POWERSHELL_SCRIPT, "utf8").toString("base64");
  const encodedBootstrap = Buffer.from(POWERSHELL_BOOTSTRAP, "utf16le").toString("base64");

  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedBootstrap],
      {
        windowsHide: true,
        env: {
          ...process.env,
          CHATGPT_QUOTA_APPROVAL_REQUEST: encodedRequest,
          CHATGPT_QUOTA_APPROVAL_SCRIPT: encodedScript
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    const outputLimit = 1024 * 1024;
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      const error = new Error("PowerShell approval bridge timed out");
      error.code = "ETIMEDOUT";
      reject(error);
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > outputLimit && !settled) {
        settled = true;
        clearTimeout(timer);
        child.kill();
        reject(new Error("PowerShell approval bridge output exceeded its limit"));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-1_000);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const error = new Error(`PowerShell approval bridge exited with code ${code}`);
        error.code = code;
        error.stderr = stderr;
        reject(error);
        return;
      }
      try {
        resolve(parsePowerShellOutput(stdout));
      } catch (parseError) {
        reject(parseError);
      }
    });

  });
}

function createWindowsApprovalInput(options = {}) {
  const platform = options.platform || process.platform;
  const runner = options.runner || ((request) => runApprovalHelper(request, options));
  const now = options.now || Date.now;
  const wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const retryDelayMs = Number.isFinite(options.retryDelayMs)
    ? Math.max(0, Math.floor(options.retryDelayMs))
    : 100;
  const makeToken = options.makeToken || (() => `approval-${crypto.randomUUID()}`);
  const tokenTtlMs = Number.isFinite(options.tokenTtlMs)
    ? Math.max(1, Math.floor(options.tokenTtlMs))
    : DEFAULT_TOKEN_TTL_MS;
  const pendingTargets = new Map();
  let busy = false;

  function failure(code, details = {}) {
    return { ok: false, code, ...details };
  }

  function pruneExpired() {
    const currentTime = now();
    for (const [token, entry] of pendingTargets) {
      if (entry.expiresAt <= currentTime) pendingTargets.delete(token);
    }
  }

  async function insertApprovalText() {
    if (platform !== "win32") return failure("unsupported-platform");
    if (busy) return failure("busy");
    busy = true;
    pendingTargets.clear();
    try {
      const request = buildRunnerRequest("insert");
      let result = await runner(request);
      const retryableCodes = new Set([
        "foreground-window-unavailable",
        "foreground-process-unavailable",
        "foreground-not-official-codex",
        "uia-focus-unavailable",
        "focused-control-not-editable",
        "focused-control-not-codex"
      ]);
      if (
        result?.ok !== true &&
        result?.inputWasSent !== true &&
        retryableCodes.has(result?.code)
      ) {
        await wait(retryDelayMs);
        result = await runner(request);
      }
      if (!result || result.ok !== true) {
        return failure(result?.code || "runner-failed", {
          inputWasSent: result?.inputWasSent === true
        });
      }
      if (result.code !== "inserted" || !validateTargetSnapshot(result.target)) {
        return failure("invalid-runner-result");
      }

      const token = makeToken();
      const expiresAt = now() + tokenTtlMs;
      pendingTargets.set(token, {
        target: structuredCloneSafe(result.target),
        expiresAt
      });
      return {
        ok: true,
        code: "inserted",
        token,
        expiresAt,
        text: APPROVAL_TEXT
      };
    } catch {
      return failure("runner-failed");
    } finally {
      busy = false;
    }
  }

  async function submitApproval(token) {
    if (platform !== "win32") return failure("unsupported-platform");
    if (busy) return failure("busy");
    pruneExpired();
    const entry = pendingTargets.get(token);
    if (!entry) return failure("invalid-or-expired-token");

    // Consume before the OS call so rapid double-clicks can never submit twice.
    pendingTargets.delete(token);
    busy = true;
    try {
      const result = await runner(buildRunnerRequest("submit", entry.target));
      if (!result || result.ok !== true) {
        return failure(result?.code || "runner-failed", {
          inputWasSent: result?.inputWasSent === true
        });
      }
      if (
        result.code !== "submitted" ||
        !validateTargetSnapshot(result.target) ||
        !sameTargetSnapshot(entry.target, result.target)
      ) {
        return failure("target-changed");
      }
      return { ok: true, code: "submitted" };
    } catch {
      return failure("runner-failed");
    } finally {
      busy = false;
    }
  }

  function cancel(token) {
    if (typeof token === "undefined") {
      const hadPending = pendingTargets.size > 0;
      pendingTargets.clear();
      return hadPending;
    }
    return pendingTargets.delete(token);
  }

  function hasPending(token) {
    pruneExpired();
    return pendingTargets.has(token);
  }

  return Object.freeze({
    insertApprovalText,
    submitApproval,
    cancel,
    hasPending
  });
}

module.exports = {
  APPROVAL_TEXT,
  APPROVAL_HELPER_NAME,
  DEFAULT_TOKEN_TTL_MS,
  OFFICIAL_CODEX_PACKAGE_FAMILY,
  buildRunnerRequest,
  createWindowsApprovalInput,
  isEditableControlFingerprint,
  isOfficialCodexIdentity,
  parsePowerShellOutput,
  resolveApprovalHelperPath,
  runApprovalHelper,
  runPowerShell,
  sameControlFingerprint,
  sameTargetSnapshot,
  validateTargetSnapshot
};
