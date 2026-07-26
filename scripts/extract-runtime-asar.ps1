param(
  [Parameter(Mandatory = $true)]
  [string]$AsarPath,

  [Parameter(Mandatory = $true)]
  [string]$Destination
)

$ErrorActionPreference = 'Stop'

$asarFile = (Resolve-Path -LiteralPath $AsarPath).Path
$destinationRoot = [IO.Path]::GetFullPath($Destination)
$archiveBytes = [IO.File]::ReadAllBytes($asarFile)

if ($archiveBytes.Length -lt 16) {
  throw 'Invalid ASAR archive: header is too short.'
}

$headerBlockSize = [BitConverter]::ToUInt32($archiveBytes, 4)
$headerJsonSize = [BitConverter]::ToUInt32($archiveBytes, 12)
$dataOffset = 8 + $headerBlockSize

if ($dataOffset -gt $archiveBytes.Length -or (16 + $headerJsonSize) -gt $archiveBytes.Length) {
  throw 'Invalid ASAR archive: header points outside the file.'
}

$headerJson = [Text.Encoding]::UTF8.GetString($archiveBytes, 16, $headerJsonSize)
$header = $headerJson | ConvertFrom-Json

function Expand-AsarNode {
  param(
    [Parameter(Mandatory = $true)]$Node,
    [string]$RelativePath = ''
  )

  foreach ($property in $Node.files.PSObject.Properties) {
    $entryName = $property.Name
    $entry = $property.Value
    $entryRelativePath = if ($RelativePath) {
      [IO.Path]::Combine($RelativePath, $entryName)
    } else {
      $entryName
    }

    if ($entry.files) {
      Expand-AsarNode -Node $entry -RelativePath $entryRelativePath
      continue
    }

    $targetPath = [IO.Path]::GetFullPath([IO.Path]::Combine($destinationRoot, $entryRelativePath))
    if (-not $targetPath.StartsWith($destinationRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to extract outside destination: $entryRelativePath"
    }

    $size = [int64]$entry.size
    $offset = $dataOffset + [int64]$entry.offset
    if ($offset -lt $dataOffset -or ($offset + $size) -gt $archiveBytes.Length) {
      throw "Invalid ASAR entry range: $entryRelativePath"
    }

    $targetDirectory = Split-Path -Parent $targetPath
    [IO.Directory]::CreateDirectory($targetDirectory) | Out-Null
    $outputBytes = New-Object byte[] $size
    [Array]::Copy($archiveBytes, $offset, $outputBytes, 0, $size)
    [IO.File]::WriteAllBytes($targetPath, $outputBytes)
    Write-Output $entryRelativePath
  }
}

[IO.Directory]::CreateDirectory($destinationRoot) | Out-Null
Expand-AsarNode -Node $header
