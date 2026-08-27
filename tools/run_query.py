"""Run one read-only CSIR ClickHouse query through the local Cloudflare tunnel."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

try:
    import clickhouse_connect
except ModuleNotFoundError:
    clickhouse_connect = None

# CSIR endpoint, credentials and client all come from csir_config.py at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from csir_config import credentials, get_client, require_tunnel

from qc_csir_connection import HttpClickHouseClient


ALLOWED_PREFIXES = {"SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "EXISTS"}
BLOCKED_KEYWORDS = re.compile(
    r"\b(INSERT|ALTER|DROP|DELETE|TRUNCATE|CREATE|RENAME|OPTIMIZE|"
    r"GRANT|REVOKE|KILL|ATTACH|DETACH)\b",
    re.IGNORECASE,
)


def validate_read_only(sql: str) -> str:
    statement = sql.strip()
    while statement.endswith(";"):
        statement = statement[:-1].rstrip()
    if not statement:
        raise SystemExit("No SQL was provided.")
    if ";" in statement:
        raise SystemExit("Only one SQL statement may be executed at a time.")

    without_comments = re.sub(r"(?s)/\*.*?\*/", " ", statement)
    without_comments = re.sub(r"(?m)^\s*--.*$", " ", without_comments).lstrip()
    first_token = re.match(r"[A-Za-z]+", without_comments)
    if not first_token or first_token.group(0).upper() not in ALLOWED_PREFIXES:
        raise SystemExit("Only read-only SELECT/SHOW/DESCRIBE/EXPLAIN queries are allowed.")
    if BLOCKED_KEYWORDS.search(without_comments):
        raise SystemExit("A write or administrative SQL keyword was detected; query blocked.")
    return statement


def json_safe(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", type=Path, help="Read SQL from a UTF-8 file.")
    parser.add_argument("--max-rows", type=int, default=10, help="Rows to print; default 10.")
    parser.add_argument("--output", type=Path, help="Write the JSON result to this file.")
    args = parser.parse_args()

    sql = args.file.read_text(encoding="utf-8") if args.file else sys.stdin.read()
    sql = validate_read_only(sql)
    require_tunnel()

    if clickhouse_connect is not None:
        client = get_client(send_receive_timeout=120)
    else:
        username, password = credentials()
        client = HttpClickHouseClient(username=username, password=password)
    result = client.query(
        sql,
        settings={
            "max_execution_time": 120,
            "max_result_rows": 10_000,
            "result_overflow_mode": "break",
        },
    )
    rows = [
        [json_safe(value) for value in row]
        for row in result.result_rows[: max(args.max_rows, 0)]
    ]
    payload = json.dumps(
        {
            "columns": list(result.column_names),
            "rows": rows,
            "returned_rows": len(result.result_rows),
            "showing_rows": len(rows),
        },
        ensure_ascii=False,
        indent=2,
    )
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
        print(
            json.dumps(
                {
                    "output": str(args.output),
                    "returned_rows": len(result.result_rows),
                    "written_rows": len(rows),
                },
                ensure_ascii=False,
            )
        )
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
