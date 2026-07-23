"""Validate that the local connection reaches the expected CSIR ClickHouse service.

The checks are deliberately read-only and never print or persist credentials.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = 8223
EXPECTED_TUNNEL_HOSTNAME = "https://chdb-pzqgvmxrwfnjkstd.enigmagames.cc"
DEFAULT_ENV_FILE = Path.home() / "Downloads" / "env.env"
DEFAULT_REPORT_DIR = PROJECT_ROOT / "outputs" / "csir_connection_qc"
READ_ONLY_SETTINGS = {
    "readonly": 1,
    "max_execution_time": 30,
    "max_result_rows": 100,
    "result_overflow_mode": "break",
}
SAFE_IDENTIFIER = re.compile(r"^[A-Z0-9_]+$")


@dataclass
class Check:
    name: str
    status: str
    detail: str
    evidence: dict[str, Any]


@dataclass
class QueryResult:
    column_names: list[str]
    result_rows: list[list[Any]]


class HttpClickHouseClient:
    def __init__(self, username: str, password: str) -> None:
        self.username = username
        self.password = password

    def query(self, sql: str, settings: dict[str, Any]) -> QueryResult:
        parameters = urllib.parse.urlencode(settings)
        url = f"http://{HOST}:{PORT}/?{parameters}"
        statement = f"{sql.rstrip().rstrip(';')} FORMAT JSON"
        request = urllib.request.Request(
            url,
            data=statement.encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "text/plain; charset=utf-8",
                "X-ClickHouse-User": self.username,
                "X-ClickHouse-Key": self.password,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=35) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"ClickHouse HTTP {exc.code}: {detail}") from exc
        meta = payload.get("meta", [])
        column_names = [str(column["name"]) for column in meta]
        rows = [
            [row.get(column_name) for column_name in column_names]
            for row in payload.get("data", [])
        ]
        return QueryResult(column_names=column_names, result_rows=rows)


def json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    return str(value)


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def resolve_credentials(env_file: Path) -> tuple[str, str, str]:
    file_values = load_env_file(env_file)
    username = (
        os.getenv("CSIR_CLICKHOUSE_USER")
        or os.getenv("CLICKHOUSE_USER_CSIR")
        or file_values.get("CLICKHOUSE_USER_CSIR")
    )
    password = (
        os.getenv("CSIR_CLICKHOUSE_PASSWORD")
        or os.getenv("CLICKHOUSE_PASSWORD_CSIR")
        or file_values.get("CLICKHOUSE_PASSWORD_CSIR")
    )
    source = "environment variables" if (
        os.getenv("CSIR_CLICKHOUSE_USER")
        or os.getenv("CLICKHOUSE_USER_CSIR")
        or os.getenv("CSIR_CLICKHOUSE_PASSWORD")
        or os.getenv("CLICKHOUSE_PASSWORD_CSIR")
    ) else str(env_file)
    if not username or not password:
        raise RuntimeError(
            "Credentials were not found in the supported environment variables "
            f"or {env_file}."
        )
    return username, password, source


def listener_process() -> dict[str, Any] | None:
    try:
        netstat = subprocess.run(
            ["netstat.exe", "-ano", "-p", "tcp"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    listener = re.search(
        r"(?mi)^\s*TCP\s+127\.0\.0\.1:8223\s+\S+\s+LISTENING\s+(\d+)\s*$",
        netstat.stdout,
    )
    if netstat.returncode != 0 or not listener:
        return None
    process_id = int(listener.group(1))
    script = (
        f"Get-Process -Id {process_id} -ErrorAction Stop | "
        "Select-Object Id,ProcessName,Path | ConvertTo-Json -Compress"
    )
    try:
        completed = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", script],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        details = json.loads(completed.stdout.strip())
        return {
            "process_id": details.get("Id", process_id),
            "process_name": details.get("ProcessName"),
            "executable_path": details.get("Path"),
        }
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return None


def execute_query(
    client: Any,
    audit: list[dict[str, Any]],
    name: str,
    sql: str,
) -> tuple[list[str], list[list[Any]]]:
    started = time.perf_counter()
    entry: dict[str, Any] = {
        "name": name,
        "sql": sql,
        "started_at": datetime.now().astimezone().isoformat(),
        "pii_fields": [],
    }
    try:
        result = client.query(sql, settings=READ_ONLY_SETTINGS)
        rows = [[json_safe(value) for value in row] for row in result.result_rows]
        entry.update(
            {
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                "rows_returned": len(rows),
                "status": "success",
            }
        )
        audit.append(entry)
        return list(result.column_names), rows
    except Exception as exc:
        entry.update(
            {
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                "rows_returned": 0,
                "status": "error",
                "error_type": type(exc).__name__,
                "error": str(exc),
            }
        )
        audit.append(entry)
        raise


def validate_inputs(site: str, currency: str, start_date: str, end_date: str) -> None:
    if not SAFE_IDENTIFIER.fullmatch(site) or not SAFE_IDENTIFIER.fullmatch(currency):
        raise ValueError("Site and currency may contain only uppercase letters, numbers, and underscores.")
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    if start > end:
        raise ValueError("Start date must be on or before end date.")


def report_status(checks: list[Check]) -> str:
    if any(check.status == "FAIL" for check in checks):
        return "FAIL"
    if any(check.status == "WARN" for check in checks):
        return "PASS_WITH_WARNINGS"
    return "PASS"


def main() -> int:
    today = date.today()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", default="WS1")
    parser.add_argument("--currency", default="MYR")
    parser.add_argument("--start-date", default=f"{today.year}-01-01")
    parser.add_argument("--end-date", default=today.isoformat())
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--report-dir", type=Path, default=DEFAULT_REPORT_DIR)
    args = parser.parse_args()

    site = args.site.upper()
    currency = args.currency.upper()
    validate_inputs(site, currency, args.start_date, args.end_date)

    checks: list[Check] = []
    audit: list[dict[str, Any]] = []
    server_identity: dict[str, Any] = {}
    data_signature: dict[str, Any] = {}

    try:
        with socket.create_connection((HOST, PORT), timeout=3):
            checks.append(
                Check(
                    "Local tunnel listener",
                    "PASS",
                    f"A TCP listener accepted a connection on {HOST}:{PORT}.",
                    {"host": HOST, "port": PORT},
                )
            )
    except OSError as exc:
        checks.append(
            Check(
                "Local tunnel listener",
                "FAIL",
                "The CSIR tunnel is not running.",
                {"host": HOST, "port": PORT, "error": str(exc)},
            )
        )

    process = listener_process()
    if process:
        executable = str(process.get("executable_path") or "")
        process_name = str(process.get("process_name") or "")
        expected_binary = PROJECT_ROOT / "bin" / "cloudflared.exe"
        correct_binary = (
            process_name.lower() == "cloudflared"
            and Path(executable).resolve() == expected_binary.resolve()
        )
        tunnel_script = PROJECT_ROOT / "start_csir_tunnel.ps1"
        tunnel_config = (
            tunnel_script.read_text(encoding="utf-8-sig")
            if tunnel_script.exists()
            else ""
        )
        correct_target = EXPECTED_TUNNEL_HOSTNAME in tunnel_config
        correct_listener = "127.0.0.1:8223" in tunnel_config
        checks.append(
            Check(
                "Tunnel process fingerprint",
                "PASS" if correct_binary and correct_target and correct_listener else "FAIL",
                (
                    "The listener belongs to the project cloudflared binary and "
                    "the tunnel configuration targets the approved CSIR hostname."
                    if correct_binary and correct_target and correct_listener
                    else "The listener process or tunnel configuration is not approved."
                ),
                {
                    "process_id": process.get("process_id"),
                    "process_name": process_name,
                    "executable_path": executable,
                    "expected_hostname": EXPECTED_TUNNEL_HOSTNAME,
                    "configured_hostname_match": correct_target,
                    "configured_listener_match": correct_listener,
                },
            )
        )
    else:
        checks.append(
            Check(
                "Tunnel process fingerprint",
                "WARN",
                "The listener process could not be fingerprinted.",
                {"expected_hostname": EXPECTED_TUNNEL_HOSTNAME},
            )
        )

    try:
        username, password, credential_source = resolve_credentials(args.env_file)
        checks.append(
            Check(
                "Credential availability",
                "PASS",
                "Credentials were found without embedding them in the QC script.",
                {"source": credential_source, "secret_values_recorded": False},
            )
        )
    except RuntimeError as exc:
        checks.append(Check("Credential availability", "FAIL", str(exc), {}))
        username = password = ""

    client = None
    if not any(check.status == "FAIL" for check in checks[:1]) and username and password:
        try:
            client = HttpClickHouseClient(username=username, password=password)
            columns, rows = execute_query(
                client,
                audit,
                "server_identity",
                (
                    "SELECT version() AS version, currentUser() AS current_user, "
                    "timezone() AS server_timezone, hostName() AS server_host, "
                    "now() AS server_time"
                ),
            )
            server_identity = dict(zip(columns, rows[0], strict=False))
            checks.append(
                Check(
                    "Authentication and server identity",
                    "PASS",
                    "Authenticated ClickHouse returned a complete server fingerprint.",
                    server_identity,
                )
            )
        except Exception as exc:
            checks.append(
                Check(
                    "Authentication and server identity",
                    "FAIL",
                    "ClickHouse authentication or the identity query failed.",
                    {"error_type": type(exc).__name__, "error": str(exc)},
                )
            )

    if client is not None:
        try:
            _, rows = execute_query(
                client,
                audit,
                "readonly_session",
                "SELECT value FROM system.settings WHERE name = 'readonly' LIMIT 1",
            )
            read_only_value = str(rows[0][0]) if rows else ""
            checks.append(
                Check(
                    "Read-only session enforcement",
                    "PASS" if read_only_value == "1" else "FAIL",
                    (
                        "The QC queries are executing with readonly=1."
                        if read_only_value == "1"
                        else "The session did not confirm readonly=1."
                    ),
                    {"readonly": read_only_value},
                )
            )
        except Exception as exc:
            checks.append(
                Check(
                    "Read-only session enforcement",
                    "FAIL",
                    "Could not verify the read-only session setting.",
                    {"error_type": type(exc).__name__, "error": str(exc)},
                )
            )

        try:
            _, rows = execute_query(
                client,
                audit,
                "database_signature",
                (
                    "SELECT name FROM system.databases "
                    "WHERE name IN ('WORKSPACE', 'ENIGMA') ORDER BY name"
                ),
            )
            actual_databases = {str(row[0]) for row in rows}
            expected_databases = {"WORKSPACE", "ENIGMA"}
            missing_databases = sorted(expected_databases - actual_databases)
            checks.append(
                Check(
                    "CSIR database signature",
                    "PASS" if not missing_databases else "FAIL",
                    (
                        "The expected CSIR database names are present."
                        if not missing_databases
                        else "One or more expected CSIR databases are missing."
                    ),
                    {
                        "expected": sorted(expected_databases),
                        "observed": sorted(actual_databases),
                        "missing": missing_databases,
                    },
                )
            )
        except Exception as exc:
            checks.append(
                Check(
                    "CSIR database signature",
                    "FAIL",
                    "The database signature query failed.",
                    {"error_type": type(exc).__name__, "error": str(exc)},
                )
            )

        expected_tables = {
            "Daily_GMT8_Snapshot_A",
            "Members_Overview_ABC",
            "GetBonus_ABC",
        }
        try:
            _, rows = execute_query(
                client,
                audit,
                "table_signature",
                (
                    "SELECT name FROM system.tables WHERE database = 'WORKSPACE' "
                    "AND name IN ('Daily_GMT8_Snapshot_A', 'Members_Overview_ABC', "
                    "'GetBonus_ABC') ORDER BY name"
                ),
            )
            actual_tables = {str(row[0]) for row in rows}
            missing_tables = sorted(expected_tables - actual_tables)
            checks.append(
                Check(
                    "WS table signature",
                    "PASS" if not missing_tables else "FAIL",
                    (
                        "The expected WS reporting tables are present."
                        if not missing_tables
                        else "One or more expected WS reporting tables are missing."
                    ),
                    {
                        "expected": sorted(expected_tables),
                        "observed": sorted(actual_tables),
                        "missing": missing_tables,
                    },
                )
            )
        except Exception as exc:
            checks.append(
                Check(
                    "WS table signature",
                    "FAIL",
                    "The table signature query failed.",
                    {"error_type": type(exc).__name__, "error": str(exc)},
                )
            )

        required_columns = {
            "Daily_GMT8_Snapshot_A": {
                "SITE_edit",
                "Currency",
                "MEMBER_ID",
                "SnapshotDate",
                "DepositAmount",
                "NGR",
            },
            "Members_Overview_ABC": {
                "SITE_edit",
                "Currency",
                "MEMBER_ID",
                "Username",
                "PlayerStatus",
            },
            "GetBonus_ABC": {
                "SITE_edit",
                "Currency",
                "MEMBER_ID",
                "BonusTime_gmt8",
                "BonusCode",
                "BonusAmount",
            },
        }
        try:
            _, rows = execute_query(
                client,
                audit,
                "column_signature",
                (
                    "SELECT table, name FROM system.columns "
                    "WHERE database = 'WORKSPACE' "
                    "AND table IN ('Daily_GMT8_Snapshot_A', 'Members_Overview_ABC', "
                    "'GetBonus_ABC') ORDER BY table, name"
                ),
            )
            actual_columns: dict[str, set[str]] = {}
            for table, column in rows:
                actual_columns.setdefault(str(table), set()).add(str(column))
            missing_columns = {
                table: sorted(columns - actual_columns.get(table, set()))
                for table, columns in required_columns.items()
                if columns - actual_columns.get(table, set())
            }
            checks.append(
                Check(
                    "WS schema signature",
                    "PASS" if not missing_columns else "FAIL",
                    (
                        "Required non-PII WS columns match the expected schema."
                        if not missing_columns
                        else "Required WS columns are missing."
                    ),
                    {"missing_columns": missing_columns},
                )
            )
        except Exception as exc:
            checks.append(
                Check(
                    "WS schema signature",
                    "FAIL",
                    "The schema signature query failed.",
                    {"error_type": type(exc).__name__, "error": str(exc)},
                )
            )

        snapshot_sql = f"""
SELECT
    count() AS row_count,
    countDistinct(MEMBER_ID) AS unique_members,
    min(SnapshotDate) AS first_snapshot_date,
    max(SnapshotDate) AS latest_snapshot_date
FROM WORKSPACE.Daily_GMT8_Snapshot_A
WHERE SITE_edit = '{site}'
  AND Currency = '{currency}'
  AND SnapshotDate BETWEEN toDate('{args.start_date}') AND toDate('{args.end_date}')
""".strip()
        try:
            columns, rows = execute_query(
                client,
                audit,
                "bounded_ws_snapshot_check",
                snapshot_sql,
            )
            snapshot = dict(zip(columns, rows[0], strict=False))
            data_signature["daily_snapshot"] = snapshot
            row_count = int(snapshot.get("row_count") or 0)
            checks.append(
                Check(
                    "Bounded WS snapshot data",
                    "PASS" if row_count > 0 else "FAIL",
                    (
                        f"Date-bounded {site}/{currency} snapshot data was returned."
                        if row_count > 0
                        else f"No {site}/{currency} snapshot rows were returned."
                    ),
                    snapshot,
                )
            )
        except Exception as exc:
            checks.append(
                Check(
                    "Bounded WS snapshot data",
                    "FAIL",
                    "The date-bounded WS snapshot query failed.",
                    {"error_type": type(exc).__name__, "error": str(exc)},
                )
            )

        bonus_sql = f"""
SELECT
    count() AS approved_bonus_rows,
    countDistinct(MEMBER_ID) AS unique_members,
    min(toDate(BonusTime_gmt8)) AS first_bonus_date,
    max(toDate(BonusTime_gmt8)) AS latest_bonus_date
FROM WORKSPACE.GetBonus_ABC
WHERE SITE_edit = '{site}'
  AND Currency = '{currency}'
  AND BonusTime_gmt8 >= toDateTime('{args.start_date} 00:00:00')
  AND BonusTime_gmt8 < toDateTime('{args.end_date} 00:00:00') + toIntervalDay(1)
  AND BonusStatus IN ('Approved', 'Redeemed', 'Complete')
""".strip()
        try:
            columns, rows = execute_query(
                client,
                audit,
                "bounded_ws_bonus_check",
                bonus_sql,
            )
            bonus = dict(zip(columns, rows[0], strict=False))
            data_signature["approved_bonus"] = bonus
            bonus_rows = int(bonus.get("approved_bonus_rows") or 0)
            checks.append(
                Check(
                    "Bounded WS bonus data",
                    "PASS" if bonus_rows > 0 else "WARN",
                    (
                        f"Date-bounded approved {site}/{currency} bonus data was returned."
                        if bonus_rows > 0
                        else f"No approved {site}/{currency} bonus rows were returned."
                    ),
                    bonus,
                )
            )
        except Exception as exc:
            checks.append(
                Check(
                    "Bounded WS bonus data",
                    "FAIL",
                    "The date-bounded WS bonus query failed.",
                    {"error_type": type(exc).__name__, "error": str(exc)},
                )
            )

    status = report_status(checks)
    generated_at = datetime.now().astimezone()
    report = {
        "qc_status": status,
        "generated_at": generated_at.isoformat(),
        "scope": {
            "approved_tunnel_hostname": EXPECTED_TUNNEL_HOSTNAME,
            "local_listener": f"{HOST}:{PORT}",
            "site": site,
            "currency": currency,
            "start_date": args.start_date,
            "end_date": args.end_date,
        },
        "checks": [asdict(check) for check in checks],
        "server_identity": server_identity,
        "data_signature": data_signature,
        "query_audit": audit,
        "credentials_recorded": False,
    }
    args.report_dir.mkdir(parents=True, exist_ok=True)
    timestamp = generated_at.strftime("%Y%m%d_%H%M%S")
    report_path = args.report_dir / f"CSIR_Connection_QC_{timestamp}.json"
    latest_path = args.report_dir / "latest.json"
    payload = json.dumps(json_safe(report), ensure_ascii=False, indent=2)
    report_path.write_text(payload + "\n", encoding="utf-8")
    latest_path.write_text(payload + "\n", encoding="utf-8")

    print(f"CSIR CONNECTION QC: {status}")
    for check in checks:
        print(f"[{check.status}] {check.name}: {check.detail}")
    print(f"Report: {report_path}")
    return 1 if status == "FAIL" else 0


if __name__ == "__main__":
    raise SystemExit(main())
