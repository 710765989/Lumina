$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# Snapshot stays in this process' memory and is never printed or written to disk.
# Refuse unsupported objects before the test changes the user's clipboard.
$existing = [System.Windows.Forms.Clipboard]::GetDataObject()
$snapshot = New-Object System.Windows.Forms.DataObject
if ($existing) {
  $formats = $existing.GetFormats($false)
  $safeFormats = @('UnicodeText','Text','System.String','FileDrop','Bitmap','DeviceIndependentBitmap','Dib','PNG','HTML Format','Rich Text Format','Preferred DropEffect','Locale')
  foreach ($format in $formats) { if ($safeFormats -notcontains $format) { [Console]::WriteLine('SKIP_UNSUPPORTED_CLIPBOARD_SNAPSHOT');exit 0 } }
  foreach ($format in $formats) {
    $value = $existing.GetData($format,$false)
    if ($null -eq $value) { continue }
    if ($value -is [System.IO.MemoryStream]) { $value = New-Object System.IO.MemoryStream(,$value.ToArray()) }
    elseif ($value -is [System.Drawing.Bitmap]) { $value = $value.Clone() }
    elseif (!($value -is [string] -or $value -is [byte[]] -or $value -is [string[]])) {
      [Console]::WriteLine('SKIP_UNSUPPORTED_CLIPBOARD_SNAPSHOT'); exit 0
    }
    $snapshot.SetData($format,$false,$value)
  }
}
[Console]::WriteLine('READY')
try {
  $request = [Console]::ReadLine() | ConvertFrom-Json
  if ($request.action -eq 'verify') {
    $files = [System.Windows.Forms.Clipboard]::GetFileDropList()
    $effectStream = [System.Windows.Forms.Clipboard]::GetData('Preferred DropEffect')
    $effect = 0
    if ($effectStream -is [System.IO.MemoryStream]) { $effect = [BitConverter]::ToInt32($effectStream.ToArray(),0) }
    $image = [System.Windows.Forms.Clipboard]::GetImage()
    $sourceExists = $files.Count -eq 1 -and [System.IO.File]::Exists($files[0])
    $shell = New-Object -ComObject Shell.Application
    $folder = $shell.NameSpace([string]$request.directory)
    $folder.Self.InvokeVerb('paste')
    $target = if ($files.Count) { Join-Path ([string]$request.directory) ([System.IO.Path]::GetFileName($files[0])) } else { '' }
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while ($target -and ![System.IO.File]::Exists($target) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    $exact = $target -and [System.IO.File]::Exists($target) -and ((Get-FileHash -LiteralPath $files[0]).Hash -eq (Get-FileHash -LiteralPath $target).Hash)
    [Console]::WriteLine((@{fileCount=$files.Count;effect=$effect;imagePresent=($null -ne $image);sourceRetained=$sourceExists;pasteExact=[bool]$exact} | ConvertTo-Json -Compress))
    if ($image) { $image.Dispose() }
  }
} finally {
  [System.Windows.Forms.Clipboard]::SetDataObject($snapshot,$true,10,100)
}
