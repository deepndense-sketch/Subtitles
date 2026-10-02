$ErrorActionPreference = 'Stop'
$job = $PSScriptRoot
$status = Join-Path $job 'status.json'
function Get-UpdateHash($filePath) {
    $stream = [IO.File]::OpenRead($filePath)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $sha.Dispose() }
}
function Write-UpdateStatus($state, $message) {
    $tempStatus = $status + '.tmp'
    [IO.File]::WriteAllText($tempStatus, (@{state=$state;message=$message;pid=$PID} | ConvertTo-Json -Compress))
    Move-Item -LiteralPath $tempStatus -Destination $status -Force
}
$changed = @()
$mutex = $null
$ownsMutex = $false
try {
    $mutex = New-Object System.Threading.Mutex($false, 'Local\SubtitleCEPUpdate')
    $ownsMutex = $mutex.WaitOne(0)
    if (!$ownsMutex) { throw 'Another Subtitle update is already waiting. Close Premiere to finish it.' }
    $plan = Get-Content -LiteralPath (Join-Path $job 'plan.json') -Raw | ConvertFrom-Json
    $expected = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'Adobe\CEP\extensions\Subtitle'))
    if ([IO.Path]::GetFullPath($plan.target) -ne $expected) { throw 'Unexpected CEP destination.' }
    if ((Get-Item -LiteralPath $expected).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked CEP directories are not supported.' }
    $allowed = @('CSXS/manifest.xml','css/style.css','index.html','js/main.js','js/updates.js','jsx/subtitle_navigator.jsx','lib/subtitle-index.js','lib/update-checker.js','lib/cep-updater.js','native/KeyListener.exe','native/install-update.ps1','package.json','release.json')
    if ($plan.files.Count -ne $allowed.Count) { throw 'Incomplete update plan.' }
    $seen = @{}
    foreach ($file in $plan.files) {
        if ($allowed -notcontains $file.path -or $seen.ContainsKey($file.path)) { throw 'Unexpected update path.' }
        $seen[$file.path] = $true
        $inputFile = Join-Path (Join-Path $job 'payload') $file.path
        if ((Get-UpdateHash $inputFile) -ne $file.sha256) { throw 'Update file verification failed.' }
    }
    Write-UpdateStatus 'waiting' 'Update ready. Save and close Premiere to finish installing.'
    while (Get-Process -Name 'Adobe Premiere Pro','Premiere' -ErrorAction SilentlyContinue) {
        if (Test-Path -LiteralPath (Join-Path $job 'cancel')) { throw 'Update cancelled before installation.' }
        Start-Sleep -Seconds 2
    }
    if (Test-Path -LiteralPath (Join-Path $job 'cancel')) { throw 'Update cancelled before installation.' }
    # Stop only this extension's listener through its own stop signal.
    $stateFolder = Join-Path $env:LOCALAPPDATA 'PremiereSubtitleNavigator'
    [IO.File]::WriteAllText((Join-Path $stateFolder 'stop'), 'stop')
    Start-Sleep -Seconds 1
    Write-UpdateStatus 'installing' 'Installing into the Subtitle CEP folder.'
    foreach ($file in $plan.files) {
        $destination = Join-Path $expected $file.path
        $backup = Join-Path (Join-Path $job 'backup') $file.path
        $existed = Test-Path -LiteralPath $destination
        if ($existed) {
            New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
            Copy-Item -LiteralPath $destination -Destination $backup
        }
        $changed += @{Destination=$destination;Backup=$backup;Existed=$existed}
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path (Join-Path $job 'payload') $file.path) -Destination $destination -Force
        if ((Get-UpdateHash $destination) -ne $file.sha256) { throw 'Installed file verification failed.' }
    }
    Write-UpdateStatus 'complete' ('Subtitle '+$plan.version+' installed. Open Premiere again.')
} catch {
    $failure = $_.Exception.Message
    $rollbackErrors = @()
    foreach ($file in $changed) {
        try {
            if ($file.Existed) { Copy-Item -LiteralPath $file.Backup -Destination $file.Destination -Force }
            elseif (Test-Path -LiteralPath $file.Destination) { Remove-Item -LiteralPath $file.Destination }
        } catch { $rollbackErrors += $_.Exception.Message }
    }
    if ($rollbackErrors.Count) { $failure += ' Backup restoration needs attention: '+($rollbackErrors -join '; ') }
    Write-UpdateStatus 'failed' $failure
    exit 1
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
