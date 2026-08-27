# CSIR ClickHouse Connection QC

Run this check before using CSIR data for a workbook or report.

## 0. Where the connection is defined

Every CSIR script — the QC, `tools/run_query.py`, and all the `bin/*.py`
analysis scripts — reads its endpoint and credentials from **`csir_config.py`**
in this folder. Nothing hardcodes a host or port any more.

To see what is currently configured, without connecting to anything:

```powershell
python csir_config.py
```

Two endpoints are defined:

| `CSIR_MODE` | Endpoint | Notes |
| :--- | :--- | :--- |
| `direct` (default) | `csir-ch.zoom66.xyz:8443` | TLS, no tunnel — per the August 2026 migration guide |
| `tunnel` (retired) | `127.0.0.1:8223` | via `start_csir_tunnel.ps1`; **origin shut down 2026-08-27** |

Overriding the default is one environment variable:

```powershell
$env:CSIR_MODE = "tunnel"
```

**Status as of 2026-08-27.** The default moved to `direct` because the Cloudflare
tunnel origin was retired that day — `tunnel` now fails with `failed to connect to
origin / websocket: bad handshake` and only works if that origin is restored.

The direct endpoint has **not yet returned a row here**: the CSIR server was down
on the day of the switch (confirmed by the data team, no ETA). It accepts TCP on
8443 but sends zero bytes back. So the configuration is complete, but unproven.

**First thing to do when the server is back:** run `SHOW DATABASES`. The user guide
says the data lives in a database whose name starts with `Team_`, but every script
here queries `WORKSPACE.*` (and `VMDB.*`). If the new server exposes different names
or grants, the scripts fail with unknown-database errors that look like connection
problems but are not.

Credentials are never stored in code. They are read from `CSIR_CLICKHOUSE_USER`
/ `CSIR_CLICKHOUSE_PASSWORD`, or `CLICKHOUSE_USER_CSIR` /
`CLICKHOUSE_PASSWORD_CSIR` in `%USERPROFILE%\Downloads\env.env` (override the
path with `CSIR_ENV_FILE`).

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

Individual checks may also report `SKIP`, which does not affect the verdict. In
`direct` mode the **Tunnel process fingerprint** check skips, because there is
no local cloudflared process to fingerprint — the check only means something
when the connection goes through the tunnel.

Every run writes a timestamped JSON audit report and refreshes:

```text
outputs\csir_connection_qc\latest.json
```

The report includes the executed read-only SQL, duration, returned-row count,
and check evidence. It never records the password.
