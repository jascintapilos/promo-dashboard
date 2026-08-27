"""Test the local CSIR ClickHouse connection without storing credentials."""

from __future__ import annotations

import getpass
import os
import sys
from pathlib import Path

# CSIR endpoint, credentials and client all come from csir_config.py, alongside this file.
from csir_config import describe, env_file_path, get_client, load_env_file, require_tunnel

STATUS_FILE = Path(__file__).resolve().parent / "logs" / "csir-connection-status.txt"


def write_status(status: str) -> None:
    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATUS_FILE.write_text(status + "\n", encoding="utf-8")


def main() -> int:
    print(f"Connecting to {describe()}")
    try:
        require_tunnel()
    except SystemExit:
        write_status("TUNNEL_NOT_RUNNING")
        raise
    write_status("WAITING_FOR_CREDENTIALS")

    file_values = load_env_file(env_file_path())
    username = (
        os.getenv("CSIR_CLICKHOUSE_USER")
        or os.getenv("CLICKHOUSE_USER_CSIR")
        or file_values.get("CLICKHOUSE_USER_CSIR")
        or input("CSIR ClickHouse username: ").strip()
    )
    password = (
        os.getenv("CSIR_CLICKHOUSE_PASSWORD")
        or os.getenv("CLICKHOUSE_PASSWORD_CSIR")
        or file_values.get("CLICKHOUSE_PASSWORD_CSIR")
        or getpass.getpass("CSIR ClickHouse password: ")
    )

    if not username or not password:
        write_status("MISSING_CREDENTIALS")
        print("Username and password are required.", file=sys.stderr)
        return 2

    try:
        write_status("CONNECTING")
        client = get_client(
            send_receive_timeout=30,
            username=username,
            password=password,
            check_tunnel=False,  # already checked above
        )
        version = client.command("SELECT version()")
        databases = client.query("SELECT name FROM system.databases ORDER BY name").result_rows
    except Exception as exc:
        write_status(f"FAILED:{type(exc).__name__}")
        print(f"Connection failed: {exc}", file=sys.stderr)
        return 1

    write_status(f"CONNECTED\nCLICKHOUSE_VERSION={version}\nTEAM_DATABASE_COUNT={len(databases)}")
    print(f"Connected successfully. ClickHouse version: {version}")
    print("Accessible databases:")
    for (name,) in databases:
        print(f"  - {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
