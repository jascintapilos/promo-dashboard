# CSIR ClickHouse Connection QC

Run this check before using CSIR data for a workbook or report.

## 1. Start the approved tunnel

Open a PowerShell window in this folder and run:

```powershell
.\start_csir_tunnel.cmd
```

Keep that window open.

## 2. Run the QC

Open a second PowerShell window in this folder and run:

```powershell
.\run_csir_qc.cmd
```

The default scope is WS1, MYR, from 2026-01-01 through 2026-07-23. To use
another approved scope:

```powershell
.\run_csir_qc.cmd -Site WS1 -Currency MYR -StartDate 2026-07-01 -EndDate 2026-07-23
```

## Verdicts

- `PASS`: the approved tunnel, authentication, CSIR server/schema, read-only
  setting, and bounded data checks all passed.
- `PASS_WITH_WARNINGS`: the connection is usable, but a non-critical check
  needs review.
- `FAIL`: do not use the connection or its data until the failed check is fixed.

Every run writes a timestamped JSON audit report and refreshes:

```text
outputs\csir_connection_qc\latest.json
```

The report includes the executed read-only SQL, duration, returned-row count,
and check evidence. It never records the password.
