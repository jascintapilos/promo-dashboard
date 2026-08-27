"""Run a SQL file against CSIR ClickHouse via plain HTTP (bypasses clickhouse_connect ping)."""
import json, sys, urllib.error, urllib.parse, urllib.request
from pathlib import Path

# CSIR endpoint, credentials and client all come from csir_config.py at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from csir_config import BASE_URL, credentials, require_tunnel

sql_file = sys.argv[1] if len(sys.argv) > 1 else None
sql = Path(sql_file).read_text(encoding="utf-8").strip() if sql_file else sys.stdin.read().strip()
sql = sql.rstrip(";")

require_tunnel()
u, p = credentials()
params = urllib.parse.urlencode({"readonly": 1, "max_execution_time": 120, "max_result_rows": 50000})
req = urllib.request.Request(
    f"{BASE_URL}/?{params}",
    data=f"{sql} FORMAT JSON".encode("utf-8"),
    method="POST",
    headers={"Content-Type": "text/plain; charset=utf-8",
             "X-ClickHouse-User": u, "X-ClickHouse-Key": p},
)
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        payload = json.loads(r.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    sys.exit(f"HTTP {e.code}: {e.read().decode()}")

meta = payload.get("meta", [])
cols = [c["name"] for c in meta]
rows = [[row.get(c) for c in cols] for row in payload.get("data", [])]
print(json.dumps({"columns": cols, "rows": rows, "total": len(rows)}, ensure_ascii=False, indent=2))
