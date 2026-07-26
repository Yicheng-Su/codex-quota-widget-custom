param(
  [string]$RuntimeSource,
  [Parameter(Mandatory = $true)]
  [string]$Output,
  [switch]$Force,
  [switch]$KeepBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '.build-custom'))
$stageRoot = Join-Path $buildRoot 'runtime'
$asarPath = Join-Path $buildRoot 'app.asar'
$payloadPath = Join-Path $buildRoot 'runtime-payload.zip'
$launcherPath = Join-Path $buildRoot 'portable-launcher.exe'
$assembledPath = Join-Path $buildRoot 'assembled-custom.exe'
$approvalHelperPath = Join-Path $stageRoot 'resources\ChatGPTQuotaApprovalHelper.exe'
$outputPath = [IO.Path]::GetFullPath($Output)

function Assert-BuildRoot {
  $expectedParent = [IO.Path]::GetFullPath($projectRoot).TrimEnd('\') + '\'
  if (-not $buildRoot.StartsWith($expectedParent, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Build directory is outside the project: $buildRoot"
  }
  if ([IO.Path]::GetFileName($buildRoot) -ne '.build-custom') {
    throw "Unexpected build directory name: $buildRoot"
  }
}

function Find-RuntimeSource {
  if ($RuntimeSource) {
    return (Resolve-Path -LiteralPath $RuntimeSource).Path
  }

  $known = Join-Path $env:TEMP 'nsoFE9.tmp\7z-out'
  if (Test-Path -LiteralPath (Join-Path $known 'ChatGPT Quota.exe')) {
    return (Resolve-Path -LiteralPath $known).Path
  }

  $candidates = Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter 'nso*.tmp' -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName '7z-out' } |
    Where-Object {
      (Test-Path -LiteralPath (Join-Path $_ 'ChatGPT Quota.exe')) -and
      (Test-Path -LiteralPath (Join-Path $_ 'resources\app.asar'))
    } |
    Sort-Object { (Get-Item -LiteralPath $_).LastWriteTime } -Descending

  $candidate = $candidates | Select-Object -First 1
  if (-not $candidate) {
    throw 'The extracted official v1.4.1 runtime was not found. Start the official portable EXE once, then retry.'
  }
  return (Resolve-Path -LiteralPath $candidate).Path
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Command,
    [Parameter(Mandatory = $true)][string]$Name
  )
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
}

Assert-BuildRoot
if ([IO.Path]::GetExtension($outputPath) -ine '.exe') {
  throw "Output must be an .exe file: $outputPath"
}

$runtimeRoot = Find-RuntimeSource
foreach ($required in @('ChatGPT Quota.exe', 'resources\app.asar')) {
  if (-not (Test-Path -LiteralPath (Join-Path $runtimeRoot $required) -PathType Leaf)) {
    throw "Runtime is missing $required under $runtimeRoot"
  }
}

if (Test-Path -LiteralPath $buildRoot) {
  Assert-BuildRoot
  Remove-Item -LiteralPath $buildRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $buildRoot,$stageRoot -Force | Out-Null

$outputDirectory = Split-Path -Parent $outputPath
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
if (Test-Path -LiteralPath $outputPath) {
  if (-not $Force) { throw "Output already exists: $outputPath" }
  Remove-Item -LiteralPath $outputPath -Force
}

try {
  & node.exe (Join-Path $PSScriptRoot 'pack-asar.js') --root $projectRoot --output $asarPath
  if ($LASTEXITCODE -ne 0) { throw "ASAR packaging failed with exit code $LASTEXITCODE" }

  & robocopy.exe $runtimeRoot $stageRoot /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /NC /NS | Out-Null
  $robocopyCode = $LASTEXITCODE
  if ($robocopyCode -ge 8) { throw "Runtime copy failed with robocopy exit code $robocopyCode" }

  Copy-Item -LiteralPath $asarPath -Destination (Join-Path $stageRoot 'resources\app.asar') -Force
  if (-not (Test-Path -LiteralPath (Join-Path $stageRoot 'ChatGPT Quota.exe') -PathType Leaf)) {
    throw 'Staged runtime executable is missing.'
  }

  $csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  if (-not (Test-Path -LiteralPath $csc -PathType Leaf)) {
    throw "The .NET Framework C# compiler was not found: $csc"
  }
  $uiaClient = Get-ChildItem -LiteralPath 'C:\Windows\Microsoft.NET\assembly\GAC_MSIL\UIAutomationClient' -Recurse -Filter UIAutomationClient.dll -ErrorAction Stop |
    Select-Object -First 1 -ExpandProperty FullName
  $uiaTypes = Get-ChildItem -LiteralPath 'C:\Windows\Microsoft.NET\assembly\GAC_MSIL\UIAutomationTypes' -Recurse -Filter UIAutomationTypes.dll -ErrorAction Stop |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $uiaClient -or -not $uiaTypes) { throw 'Windows UI Automation assemblies were not found.' }
  $helperCompilerArguments = @(
    '/nologo',
    '/target:exe',
    '/optimize+',
    "/out:$approvalHelperPath",
    '/reference:System.Web.Extensions.dll',
    "/reference:$uiaClient",
    "/reference:$uiaTypes",
    (Join-Path $PSScriptRoot 'ApprovalHelper.cs')
  )
  & $csc $helperCompilerArguments
  if ($LASTEXITCODE -ne 0) { throw "Approval helper compilation failed with exit code $LASTEXITCODE" }
  if (-not (Test-Path -LiteralPath $approvalHelperPath -PathType Leaf)) {
    throw 'Compiled approval helper is missing from the staged runtime.'
  }

  Push-Location $stageRoot
  try {
    & tar.exe -a -cf $payloadPath .
    if ($LASTEXITCODE -ne 0) { throw "ZIP payload creation failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }

  $compilerArguments = @(
    '/nologo',
    '/target:winexe',
    '/optimize+',
    "/out:$launcherPath",
    "/win32icon:$(Join-Path $projectRoot 'assets\icon.ico')",
    '/reference:System.IO.Compression.dll',
    '/reference:System.IO.Compression.FileSystem.dll',
    '/reference:System.Windows.Forms.dll',
    (Join-Path $PSScriptRoot 'PortableLauncher.cs')
  )
  & $csc $compilerArguments
  if ($LASTEXITCODE -ne 0) { throw "Portable launcher compilation failed with exit code $LASTEXITCODE" }

  Copy-Item -LiteralPath $launcherPath -Destination $assembledPath
  $payloadInfo = Get-Item -LiteralPath $payloadPath
  $outputStream = [IO.File]::Open($assembledPath, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $payloadStream = [IO.File]::OpenRead($payloadPath)
    try {
      $payloadStream.CopyTo($outputStream)
    } finally {
      $payloadStream.Dispose()
    }
    $writer = New-Object IO.BinaryWriter($outputStream, [Text.Encoding]::UTF8, $true)
    try {
      $writer.Write([int64]$payloadInfo.Length)
      $writer.Write([Text.Encoding]::ASCII.GetBytes('CQWZIP-PAYLOAD01'))
      $writer.Flush()
    } finally {
      $writer.Dispose()
    }
    $outputStream.Flush($true)
  } finally {
    $outputStream.Dispose()
  }

  $assembledStream = [IO.File]::OpenRead($assembledPath)
  try {
    if ($assembledStream.Length -le 24) { throw 'Assembled EXE is too short.' }
    [void]$assembledStream.Seek(-24, [IO.SeekOrigin]::End)
    $reader = New-Object IO.BinaryReader($assembledStream, [Text.Encoding]::UTF8, $true)
    try {
      $recordedLength = $reader.ReadInt64()
      $recordedMagic = [Text.Encoding]::ASCII.GetString($reader.ReadBytes(16))
    } finally {
      $reader.Dispose()
    }
    if ($recordedLength -ne $payloadInfo.Length -or $recordedMagic -ne 'CQWZIP-PAYLOAD01') {
      throw 'Assembled EXE footer verification failed.'
    }
  } finally {
    $assembledStream.Dispose()
  }

  Copy-Item -LiteralPath $assembledPath -Destination $outputPath
  $final = Get-Item -LiteralPath $outputPath
  $hash = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
  [pscustomobject]@{
    output = $final.FullName
    bytes = $final.Length
    sha256 = $hash
    payloadBytes = $payloadInfo.Length
    runtimeSource = $runtimeRoot
  } | ConvertTo-Json -Compress
} finally {
  if (-not $KeepBuild -and (Test-Path -LiteralPath $buildRoot)) {
    Assert-BuildRoot
    Remove-Item -LiteralPath $buildRoot -Recurse -Force
  }
}
