param(
    [string]$Site = "WS1",
    [string]$Currency = "MYR",
    [string]$StartDate = "2026-01-01",
    [string]$EndDate = "2026-07-23"
)

$ErrorActionPreference = "Stop"
$qcScript = Join-Path $PSScriptRoot "tools\qc_csir_connection.py"
$bundledPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if (-not (Test-Path -LiteralPath $qcScript)) {
    throw "QC script was not found at $qcScript"
}

$pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
if ($pythonCommand) {
    $python = $pythonCommand.Source
}
elseif (Test-Path -LiteralPath $bundledPython) {
    $python = $bundledPython
}
else {
    throw "Python was not found on PATH or in the bundled Codex runtime."
}

& $python $qcScript `
    --site $Site `
    --currency $Currency `
    --start-date $StartDate `
    --end-date $EndDate

exit $LASTEXITCODE
