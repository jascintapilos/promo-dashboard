# GM01 weekly CASHBACK submission wrapper for Task Scheduler.
# Runs on Monday. Computes last week (previous Mon 00:00 -> previous Sun 23:59),
# submits cashback (all levels, API+FISH, check deposit yes), then prints the
# cashback approval-queue summary. Logs all output to captures/gm01-cashback-weekly.log.
# ASCII only - keep it parseable under Windows PowerShell 5.1.

$Root   = Split-Path $PSScriptRoot -Parent
$Log    = Join-Path $Root "captures\gm01-cashback-weekly.log"
$Node   = "C:\Program Files\nodejs\node.exe"
$Submit = Join-Path $Root "bin\gm01-commission-submit.mjs"
$Pull   = Join-Path $Root "bin\gm01-pull-queue.mjs"

$null = New-Item -ItemType Directory -Force -Path (Split-Path $Log)

# Compute last week's Monday..Sunday in DD-MM-YYYY.
$today          = (Get-Date).Date
$daysSinceMon   = ([int]$today.DayOfWeek + 6) % 7      # Monday -> 0, Sunday -> 6
$thisMonday     = $today.AddDays(-$daysSinceMon)
$prevMonday     = $thisMonday.AddDays(-7)
$prevSunday     = $thisMonday.AddDays(-1)
$start          = $prevMonday.ToString("dd-MM-yyyy") + " 00:00"
$end            = $prevSunday.ToString("dd-MM-yyyy") + " 23:59"

$ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
Add-Content $Log "[$ts] Starting weekly cashback submission for $start -> $end ..."

# STEP 2 - submit cashback
& $Node $Submit --bonusType=cashback --submissionType=API,FISH --startDate="$start" --endDate="$end" 2>&1 | Tee-Object -Append -FilePath $Log
$submitCode = $LASTEXITCODE

# STEP 3 - cashback approval-queue summary (searchBonusType=30)
& $Node $Pull --bonusType=30 2>&1 | Tee-Object -Append -FilePath $Log

Add-Content $Log "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] Submit exit code $submitCode."
exit $submitCode
