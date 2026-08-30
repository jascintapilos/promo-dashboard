"""Single source of truth for the CSIR ClickHouse connection.

Every CSIR script imports its endpoint, credentials and client from here, so the
connection is defined in exactly one place instead of being copy-pasted into
twenty scripts.

Endpoint is chosen by the CSIR_MODE environment variable:

    direct   (default)  csir-ch.zoom66.xyz:8443 over TLS -- the endpoint from the
                        August 2026 migration guide. No tunnel, no browser
                        sign-in.

    tunnel   (retired)  127.0.0.1:8223 over plain HTTP, through the local
                        Cloudflare Access tunnel started by
                        start_csir_tunnel.ps1. Its origin was shut down on
                        2026-08-27, so this only works if that is restored.

Overriding the default is one environment variable; no script needs editing:

    PowerShell   $env:CSIR_MODE = "tunnel"
    cmd.exe      set CSIR_MODE=tunnel

Individual pieces can be overridden with CSIR_HOST / CSIR_PORT / CSIR_SECURE if
the endpoint moves again.

Credentials are never stored here. They are read, in order of preference, from:

    1. CSIR_CLICKHOUSE_USER     / CSIR_CLICKHOUSE_PASSWORD      (env)
    2. CLICKHOUSE_USER_CSIR     / CLICKHOUSE_PASSWORD_CSIR      (env)
    3. CLICKHOUSE_USER_CSIR     / CLICKHOUSE_PASSWORD_CSIR      (CSIR_ENV_FILE,
                                                     default ~/Downloads/env.env)

Run this file directly to print the resolved endpoint without touching
credentials or the network:

    python csir_config.py
"""

from __future__ import annotations

import os
import socket
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_ENV_FILE = Path.home() / "Downloads" / "env.env"

# The Cloudflare Access hostname the tunnel fronts, and the script that starts
# it. qc_csir_connection.py fingerprints the running tunnel against these.
TUNNEL_HOSTNAME = "https://chdb-pzqgvmxrwfnjkstd.enigmagames.cc"
TUNNEL_SCRIPT = PROJECT_ROOT / "start_csir_tunnel.ps1"

ENDPOINTS: dict[str, dict[str, Any]] = {
    "tunnel": {"host": "127.0.0.1", "port": 8223, "secure": False},
    "direct": {"host": "csir-ch.zoom66.xyz", "port": 8443, "secure": True},
}
# Switched to "direct" on 2026-08-27: the Cloudflare tunnel origin was shut down that
# day as announced, so "tunnel" no longer points anywhere. Set CSIR_MODE=tunnel to get
# the old behaviour back if the origin is ever restored.
DEFAULT_MODE = "direct"


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


MODE = os.getenv("CSIR_MODE", DEFAULT_MODE).strip().lower()
if MODE not in ENDPOINTS:
    raise SystemExit(
        f"CSIR_MODE must be one of {sorted(ENDPOINTS)}; got {MODE!r}."
    )

_endpoint = ENDPOINTS[MODE]
HOST: str = os.getenv("CSIR_HOST", _endpoint["host"]).strip()
PORT: int = int(os.getenv("CSIR_PORT", _endpoint["port"]))
SECURE: bool = _bool_env("CSIR_SECURE", _endpoint["secure"])

SCHEME = "https" if SECURE else "http"
BASE_URL = f"{SCHEME}://{HOST}:{PORT}"

# True only when we are actually pointed at the local tunnel listener, whichever
# way we got there (mode or explicit host/port override).
IS_TUNNEL: bool = (HOST, PORT) == (
    ENDPOINTS["tunnel"]["host"],
    ENDPOINTS["tunnel"]["port"],
)


# ── Market seam ───────────────────────────────────────────────────────────────
# Which brand market the PROMO-REPORT pipeline pulls. Flip PROMO_MARKET to run the
# same pull/compute/build scripts for another market; they read MARKET / CURRENCY /
# LOGSITE / SUF / SYMBOL from here instead of hardcoding 'MYR' / 'WS1_MYS_MYR' / '-MY'.
# SITE_EDIT is the same brand (WS1) for every market — only currency + logsite move.
#
# IMPORTANT: money-denominated thresholds (size bands, loss/reward floors) are NOT a
# symbol swap — a "RM400 bonus" band means a different real amount than "S$400". Use
# money(my_value) to rescale a MY-tuned money threshold into the current market's
# currency (S$1 ≈ RM3.3, Aug 2026). Dimensionless per-RM RATIOS (NGR-lift/RM,
# give-to-take, fatigue factors, attributed_per_rm) transfer UNCHANGED — never money()
# those. And figures that are MY analysis RESULTS (e.g. a frequency-cap saving) must be
# RE-DERIVED per market, not rescaled.
_MARKETS = {
    "MY": {"currency": "MYR", "logsite": "WS1_MYS_MYR", "suffix": "MY", "symbol": "RM", "myr_per_unit": 1.0},
    "SG": {"currency": "SGD", "logsite": "WS1_SGP_SGD", "suffix": "SG", "symbol": "S$", "myr_per_unit": 3.3},
}
PROMO_MARKET: str = os.getenv("PROMO_MARKET", "MY").strip().upper()
if PROMO_MARKET not in _MARKETS:
    raise SystemExit(f"PROMO_MARKET must be one of {sorted(_MARKETS)}; got {PROMO_MARKET!r}.")

MARKET: str = PROMO_MARKET
CURRENCY: str = _MARKETS[PROMO_MARKET]["currency"]        # 'MYR' / 'SGD' — the ClickHouse Currency filter + facts tag
LOGSITE: str = _MARKETS[PROMO_MARKET]["logsite"]          # membership-log SITE key
SUF: str = _MARKETS[PROMO_MARKET]["suffix"]               # filename suffix: acq-codes-{SUF}.json
SYMBOL: str = _MARKETS[PROMO_MARKET]["symbol"]            # 'RM' / 'S$' — for persisted text fields
SITE_EDIT: str = "WS1"                                    # brand, same across markets
_MYR_PER_UNIT: float = _MARKETS[PROMO_MARKET]["myr_per_unit"]


def money(my_value: float, step: float | None = None) -> float:
    """Rescale a MY-tuned money threshold into the current market's currency.

    money(400) -> 400 for MY, ~121 for SG (400/3.3). Pass step to round to a tidy
    band edge in the target currency (e.g. money(400, step=50) -> 100 for SG). Use
    ONLY for real-money thresholds (size bands, loss/reward floors); never for
    dimensionless per-RM ratios, which transfer unchanged.
    """
    v = my_value / _MYR_PER_UNIT
    if step:
        v = round(v / step) * step
    return round(v, 2) if step is None else v


def env_file_path() -> Path:
    return Path(os.getenv("CSIR_ENV_FILE", DEFAULT_ENV_FILE))


def load_env_file(path: Path | str | None = None) -> dict[str, str]:
    """Parse a KEY=VALUE file, tolerating BOM, blank lines, # comments, quotes."""
    target = Path(path) if path is not None else env_file_path()
    values: dict[str, str] = {}
    if not target.exists():
        return values
    for raw_line in target.read_text(encoding="utf-8-sig").splitlines():
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


def resolve_credentials(env_file: Path | str | None = None) -> tuple[str, str, str]:
    """Return (username, password, source). `source` never contains the secret."""
    path = Path(env_file) if env_file is not None else env_file_path()
    file_values = load_env_file(path)
    from_env = any(
        os.getenv(name)
        for name in (
            "CSIR_CLICKHOUSE_USER",
            "CLICKHOUSE_USER_CSIR",
            "CSIR_CLICKHOUSE_PASSWORD",
            "CLICKHOUSE_PASSWORD_CSIR",
        )
    )
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
    if not username or not password:
        raise RuntimeError(
            "CSIR credentials were not found. Set CSIR_CLICKHOUSE_USER and "
            "CSIR_CLICKHOUSE_PASSWORD, or put CLICKHOUSE_USER_CSIR and "
            f"CLICKHOUSE_PASSWORD_CSIR in {path}."
        )
    return username, password, "environment variables" if from_env else str(path)


def credentials(env_file: Path | str | None = None) -> tuple[str, str]:
    username, password, _ = resolve_credentials(env_file)
    return username, password


def describe() -> str:
    """Endpoint summary safe to print or log -- contains no credentials."""
    return f"{BASE_URL} (CSIR_MODE={MODE})"


def require_tunnel(timeout: float = 3.0) -> None:
    """Fail fast if we need the local tunnel and it is not running.

    A no-op when pointed at a remote endpoint, where there is no listener to
    start and the connection attempt itself is the real check.
    """
    if not IS_TUNNEL:
        return
    try:
        with socket.create_connection((HOST, PORT), timeout=timeout):
            return
    except OSError as exc:
        raise SystemExit(
            f"The CSIR tunnel is not listening on {HOST}:{PORT}.\n"
            f"Run .\\{TUNNEL_SCRIPT.name} in a separate PowerShell window first."
        ) from exc


def get_client(
    send_receive_timeout: int = 300,
    connect_timeout: int = 10,
    env_file: Path | str | None = None,
    check_tunnel: bool = True,
    username: str | None = None,
    password: str | None = None,
    **kwargs: Any,
):
    """A configured clickhouse_connect client for the current endpoint.

    Pass username/password to supply credentials from somewhere else (an
    interactive prompt, say); otherwise they are resolved as described above.
    """
    import clickhouse_connect

    if check_tunnel:
        require_tunnel()
    if username is None or password is None:
        username, password = credentials(env_file)
    try:
        return clickhouse_connect.get_client(
            host=HOST,
            port=PORT,
            secure=SECURE,
            username=username,
            password=password,
            connect_timeout=connect_timeout,
            send_receive_timeout=send_receive_timeout,
            **kwargs,
        )
    except Exception as exc:
        # The raw driver error is ~25 lines of urllib3 internals ending in "Read timed
        # out", which reads like a bug in our code. Say what actually happened instead.
        hint = (
            "The tunnel is listening locally, but its origin is not responding.\n"
            "The Cloudflare origin was retired on 2026-08-27 -- use CSIR_MODE=direct."
            if IS_TUNNEL
            else
            "A timeout with no response usually means the CSIR server is down rather\n"
            "than anything being wrong here; check with the data team. If it is instead\n"
            "an authentication error, re-check the credentials in the env file."
        )
        raise ConnectionError(
            f"Could not reach CSIR at {BASE_URL} (CSIR_MODE={MODE}).\n"
            f"{hint}\n"
            f"Underlying error: {type(exc).__name__}: {exc}"
        ) from exc


if __name__ == "__main__":
    print(f"CSIR_MODE   {MODE}")
    print(f"endpoint    {BASE_URL}")
    print(f"secure      {SECURE}")
    print(f"tunnel      {IS_TUNNEL}")
    print(f"env file    {env_file_path()}")
    try:
        _user, _pw, _source = resolve_credentials()
        print(f"credentials found via {_source}")
    except RuntimeError as exc:
        print(f"credentials NOT found: {exc}")

    # The old per-script code read CLICKHOUSE_HOST_CSIR / CLICKHOUSE_PORT_CSIR from the
    # env file. Endpoint selection now goes through CSIR_MODE / CSIR_HOST / CSIR_PORT, so
    # say so plainly if those stale keys are still around and disagree -- otherwise editing
    # them looks like it should work, silently does nothing, and reads as a failed migration.
    _file = load_env_file()
    _stale_host = _file.get("CLICKHOUSE_HOST_CSIR")
    _stale_port = _file.get("CLICKHOUSE_PORT_CSIR")
    if (_stale_host and _stale_host != HOST) or (_stale_port and str(_stale_port) != str(PORT)):
        print()
        print(f"NOTE  {env_file_path()} still sets")
        print(f"        CLICKHOUSE_HOST_CSIR={_stale_host}  CLICKHOUSE_PORT_CSIR={_stale_port}")
        print("      Those keys are NOT used to pick the endpoint any more, so editing them")
        print("      changes nothing. Use CSIR_MODE=direct (or CSIR_HOST / CSIR_PORT).")
        print("      Credentials in that file are still read normally.")


# ── MIGRATION note ────────────────────────────────────────────────────────────
#
# 2026-08-19. A guide circulated on Telegram asked everyone to drop the Cloudflare
# tunnel and connect straight to csir-ch.zoom66.xyz:8443, same username and password.
# The default stayed on the tunnel initially because the endpoint was unverified.
#
# 2026-08-27. Resolved and switched to direct:
#
#   * Provenance confirmed -- the guide came from Joyce in the internal Telegram
#     group, and the host traceroutes in 5 hops at <1ms, so it is internal
#     infrastructure rather than the unrelated public host it first looked like.
#   * The tunnel origin was shut down that day as announced. It now fails with
#     "failed to connect to origin / websocket: bad handshake", so leaving the
#     default on "tunnel" would point every script at something permanently dead.
#
# NOT yet verified end to end: the CSIR server was down on the day of the switch
# (confirmed by the data team, no ETA), so the direct endpoint has never returned
# a row here. TCP connects on 8443 and 8123 but the server sends zero bytes.
#
# STILL TO CHECK once the server is back -- run SHOW DATABASES. The user guide says
# the data lives in a database starting with "Team_", but every script here queries
# WORKSPACE.* (and VMDB.*). If the new server exposes different names or grants, the
# scripts will fail with unknown-database errors that look like connection problems
# but are not. Confirm before trusting any output.
