# Dashboard Sync Server (separate process) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a second, standalone Flask process — `sync_server.py`, its own port — that exposes bearer-token-authenticated, read (sessions, reports) and read/write (checklist) endpoints, so multiple Dashboard instances can work as a hub-and-spoke: one **main** instance is the checklist's source of truth, and any number of **slave** instances proxy their own checklist reads/writes to it instead of keeping a local copy, while each instance (main or slave) still keeps its own sessions/reports local and exposes them read-only for the others to pull.

**Architecture:** Two separate Flask apps on two ports, present on every instance (main and slave alike):
- `server.py` (port 8765, no auth) — the local dashboard UI + full CRUD API. Unchanged by default. When `dashboard-config.json` has a `sync.upstream` key (`{"url": ..., "token": ...}`), its four checklist routes (`/api/checklist`, `/api/personal/checklist`, and their `<item_id>` variants) stop touching local `checklist.json`/`personal-checklist.json` and instead proxy to that URL's `/api/sync/checklist` — this is what makes an instance a "slave" for checklist purposes. Absent that key (the default), behavior is exactly what it is today.
- `sync_server.py` (port 8766, bearer-token-gated on every route) — the only thing a Cloudflare tunnel needs to point at, since a free Cloudflare account can't easily do path-based routing rules. One hostname → one port, no rules. Every instance runs this, so the aggregator (or any peer) can pull that instance's sessions/reports and, on whichever instance is designated "main," read/write its checklist.

Both processes on the same machine read/write the same JSON files under `data/`. That means checklist writes on **main** can now come from two independent OS processes at once (a user editing locally in `server.py`, a slave's proxy hitting `sync_server.py`), so the shared data-access helpers move into a new dependency-free module, `dashboard_data.py`, and gain an OS-level file lock (`fcntl.flock`) in addition to the existing in-process `threading.Lock` — the in-process lock alone only serializes threads within one process, not across two.

Sessions and reports stay **GET-only** on the sync side, on every instance — they're written by agents running locally against `server.py`/the filesystem directly. A slave's own agent sessions and reports stay on that slave, in its own local files; only checklist is centralized. This means there's exactly one writer location for checklist (main's `checklist.json` / `personal-checklist.json`, lock-protected) whether the write comes in from main's own local UI or proxied from a slave — no multi-writer conflict to resolve.

**Tech Stack:** Python 3.12, Flask 3.1, flasgger 0.9.7 (already installed in `.venv`), pytest (new dev dependency, installed into `.venv`, no requirements file exists in this repo to pin it in). The checklist proxy (`sync_client.py`) uses only `urllib.request` from the standard library — no new dependency for outbound HTTP.

## Global Constraints

- `server.py`'s routes, responses, and headers are unchanged by default. The only unconditional change to that file is swapping its private helpers for imports from `dashboard_data.py`. Its checklist routes gain a second code path (proxy to `sync.upstream`) that only activates when that config key is set — this is the one deliberate, opt-in behavior change, confined to the four checklist route families.
- `sync_server.py` requires a token to even start — there's no `DASHBOARD_SYNC_ENABLED` opt-in flag like an earlier draft of this plan had, because this process's only job is sync; if you're running it, sync is enabled by definition. Missing token (env `DASHBOARD_SYNC_TOKEN`, or `dashboard-config.json`'s `sync.token` key) is a hard boot failure (`SystemExit`).
- 401 body is always exactly `{"error": "unauthorized"}`. Token comparison uses `hmac.compare_digest` — never `==`.
- `sync_server.py` never sends `Access-Control-Allow-*` headers — it's server-to-server traffic (aggregator → instance), not browser traffic, so there's nothing to add and nothing to guard.
- `/apidocs`, `/apispec_1.json`, `/flasgger_static/*` on `sync_server.py` are excluded from the auth gate — Swagger UI needs to load before you can supply a token to it, and the issue's own rollout section says the tunnel maps `/apidocs` alongside `/api/sync/*`.
- Report files are served only by looking up a `name` from `reports/reports-index.json` and resolving to `Path(entry["file"]).name` before calling `send_from_directory` — never take a raw filename/path from the client.
- Any function in `dashboard_data.py` that mutates a JSON file (`_add`, `_add_first`, `_patch`, `_delete`) takes the cross-process file lock for the whole read-modify-write, not just the in-process one.
- When `server.py` is proxying (slave mode) and the upstream is unreachable (network failure, not a 4xx/5xx from a live server), the local route returns `502 {"error": "upstream unavailable: <detail>"}` — never a silent fallback to local files, since that would let the slave's checklist quietly diverge from main's.
- New tests live in `tests/`, use `pytest` + Flask's `app.test_client()`, and isolate themselves from the real `data/`/`reports/` directories via `monkeypatch.setattr` on the module's path constants — never read/write the developer's real personal data during tests.

---

### Task 1: Extract `dashboard_data.py` with cross-process file locking; refactor `server.py` to use it

**Files:**
- Create: `dashboard_data.py`
- Modify: `server.py` — remove its private `BASE`/`DATA`/`_lock`/`_read`/`_write`/`_list`/`_add`/`_add_first`/`_patch`/`_delete` (currently lines 1–66), replace with an import from `dashboard_data`.
- Modify: `.gitignore` — add `data/*.lock`.
- Create: `tests/__init__.py` (empty — makes `tests` importable, avoids pytest rootdir ambiguity)
- Create: `tests/conftest.py`
- Create: `tests/test_dashboard_data.py`
- Create: `tests/test_server_smoke.py`

**Interfaces:**
- Produces: `dashboard_data.BASE: Path`, `dashboard_data.DATA: Path`, `dashboard_data.REPORTS_DIR: Path` (= `BASE / "reports"`), `dashboard_data.REPORTS_INDEX_PATH: Path` (= `REPORTS_DIR / "reports-index.json"`), `dashboard_data._read(path: Path) -> list`, `dashboard_data._write(path: Path, data: list) -> None`, `dashboard_data._list(filename: str, filter_fn=None) -> list`, `dashboard_data._add(filename: str, item: dict) -> dict`, `dashboard_data._add_first(filename: str, item: dict) -> dict`, `dashboard_data._patch(filename: str, item_id: str, mutate_fn) -> dict | None`, `dashboard_data._delete(filename: str, item_id: str) -> bool`. Signatures are identical to `server.py`'s current private helpers — this is a pure extraction, not a redesign, except for the added locking.
- Consumes (later tasks): `sync_server.py` (Task 2 onward) imports the same names from `dashboard_data`.

- [ ] **Step 1: Install pytest into the project venv**

Run: `.venv/bin/pip install --quiet pytest`
Expected: exits 0. Verify with `.venv/bin/python -c "import pytest; print(pytest.__version__)"` — prints something like `8.x.x`.

- [ ] **Step 2: Create the test package scaffolding**

`tests/__init__.py`:
```python
```
(empty file)

`tests/conftest.py`:
```python
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# sync_server.py resolves its token at import time and exits if none is
# configured. Set a default here, before any test file imports it, so
# collection never crashes regardless of the developer's real env. Individual
# tests override behavior via monkeypatch.setattr(sync_server, "SYNC_TOKEN", ...).
os.environ.setdefault("DASHBOARD_SYNC_TOKEN", "test-session-token")
```

- [ ] **Step 3: Write the failing tests for `dashboard_data`**

`tests/test_dashboard_data.py`:
```python
import json
from concurrent.futures import ProcessPoolExecutor

import pytest

import dashboard_data


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    d = tmp_path / "data"
    d.mkdir()
    monkeypatch.setattr(dashboard_data, "DATA", d)
    return d


def test_read_missing_file_returns_empty_list(data_dir):
    assert dashboard_data._read(data_dir / "nope.json") == []


def test_read_invalid_json_returns_empty_list(data_dir):
    (data_dir / "bad.json").write_text("{not json", encoding="utf-8")
    assert dashboard_data._read(data_dir / "bad.json") == []


def test_write_then_read_round_trips(data_dir):
    dashboard_data._write(data_dir / "x.json", [{"id": "1"}])
    assert dashboard_data._read(data_dir / "x.json") == [{"id": "1"}]


def test_add_appends_and_persists(data_dir):
    dashboard_data._add("x.json", {"id": "1"})
    dashboard_data._add("x.json", {"id": "2"})
    assert dashboard_data._read(data_dir / "x.json") == [{"id": "1"}, {"id": "2"}]


def test_add_first_prepends(data_dir):
    dashboard_data._add_first("x.json", {"id": "1"})
    dashboard_data._add_first("x.json", {"id": "2"})
    assert dashboard_data._read(data_dir / "x.json") == [{"id": "2"}, {"id": "1"}]


def test_patch_mutates_matching_item(data_dir):
    dashboard_data._write(data_dir / "x.json", [{"id": "1", "checked": False}])
    result = dashboard_data._patch("x.json", "1", lambda i: i.__setitem__("checked", True))
    assert result == {"id": "1", "checked": True}
    assert dashboard_data._read(data_dir / "x.json") == [{"id": "1", "checked": True}]


def test_patch_missing_id_returns_none(data_dir):
    dashboard_data._write(data_dir / "x.json", [])
    assert dashboard_data._patch("x.json", "missing", lambda i: None) is None


def test_delete_removes_matching_item(data_dir):
    dashboard_data._write(data_dir / "x.json", [{"id": "1"}, {"id": "2"}])
    assert dashboard_data._delete("x.json", "1") is True
    assert dashboard_data._read(data_dir / "x.json") == [{"id": "2"}]


def test_delete_missing_id_returns_false(data_dir):
    dashboard_data._write(data_dir / "x.json", [])
    assert dashboard_data._delete("x.json", "missing") is False


def _add_one(args):
    # Runs in a separate process (ProcessPoolExecutor) — re-imports dashboard_data
    # fresh and points it at the same on-disk directory as the parent test.
    data_dir_str, item_id = args
    import dashboard_data as dd
    from pathlib import Path
    dd.DATA = Path(data_dir_str)
    dd._add("concurrent.json", {"id": item_id})
    return item_id


def test_add_is_safe_across_processes(data_dir):
    # This is the regression test for the bug this task exists to fix: two
    # separate OS processes (server.py and sync_server.py) both calling _add
    # on the same file. Without a cross-process lock, concurrent
    # read-modify-write cycles lose updates (item counts. If dashboard_data
    # regresses to threading.Lock alone, this test becomes flaky/fails under
    # load — that's the point.
    dashboard_data._write(data_dir / "concurrent.json", [])
    n = 20
    args = [(str(data_dir), str(i)) for i in range(n)]
    with ProcessPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(_add_one, args))
    assert len(results) == n
    items = json.loads((data_dir / "concurrent.json").read_text(encoding="utf-8"))
    assert len(items) == n
    assert {i["id"] for i in items} == {str(i) for i in range(n)}
```

`tests/test_server_smoke.py`:
```python
import json

import pytest

import server


@pytest.fixture
def client(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setattr(server, "DATA", data_dir)
    return server.app.test_client()


def test_checklist_add_then_list_round_trips(client):
    resp = client.post("/api/checklist", json={"text": "hello"})
    assert resp.status_code == 201
    item_id = resp.get_json()["id"]

    resp = client.get("/api/checklist")
    assert resp.status_code == 200
    items = resp.get_json()
    assert len(items) == 1
    assert items[0]["id"] == item_id
    assert items[0]["text"] == "hello"


def test_checklist_patch_toggles_checked(client):
    item_id = client.post("/api/checklist", json={"text": "x"}).get_json()["id"]
    resp = client.patch(f"/api/checklist/{item_id}", json={"checked": True})
    assert resp.status_code == 200
    assert resp.get_json()["checked"] is True


def test_checklist_delete_removes_item(client):
    item_id = client.post("/api/checklist", json={"text": "x"}).get_json()["id"]
    resp = client.delete(f"/api/checklist/{item_id}")
    assert resp.status_code == 204
    assert client.get("/api/checklist").get_json() == []
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/ -v`
Expected: `test_dashboard_data.py` fails with `ModuleNotFoundError: No module named 'dashboard_data'`. `test_server_smoke.py` passes already — it characterizes `server.py`'s existing (unrefactored) checklist behavior, which doesn't change in this task, only the internals backing it do.

- [ ] **Step 5: Create `dashboard_data.py`**

```python
#!/usr/bin/env python3
import fcntl
import json
import threading
from pathlib import Path

BASE = Path(__file__).parent.resolve()
DATA = BASE / "data"
DATA.mkdir(exist_ok=True)
REPORTS_DIR = BASE / "reports"
REPORTS_INDEX_PATH = REPORTS_DIR / "reports-index.json"

_lock = threading.Lock()


def _read(path: Path) -> list:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _write(path: Path, data: list) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _list(filename: str, filter_fn=None) -> list:
    items = _read(DATA / filename)
    if filter_fn:
        return [i for i in items if filter_fn(i)]
    return items


class _FileLock:
    """Cross-process advisory lock via flock on a sibling .lock file.

    threading.Lock only serializes threads within one process. server.py and
    sync_server.py are separate processes that can both mutate the same
    JSON files (checklist.json in particular), so writes need an OS-level
    lock too, or concurrent read-modify-write cycles can lose updates.
    """

    def __init__(self, path: Path):
        self._lockfile = path.with_name(path.name + ".lock")

    def __enter__(self):
        self._fh = open(self._lockfile, "w")
        fcntl.flock(self._fh, fcntl.LOCK_EX)
        return self

    def __exit__(self, *exc_info):
        fcntl.flock(self._fh, fcntl.LOCK_UN)
        self._fh.close()


def _add(filename: str, item: dict) -> dict:
    with _lock, _FileLock(DATA / filename):
        items = _read(DATA / filename)
        items.append(item)
        _write(DATA / filename, items)
    return item


def _add_first(filename: str, item: dict) -> dict:
    with _lock, _FileLock(DATA / filename):
        items = _read(DATA / filename)
        items.insert(0, item)
        _write(DATA / filename, items)
    return item


def _patch(filename: str, item_id: str, mutate_fn):
    with _lock, _FileLock(DATA / filename):
        items = _read(DATA / filename)
        for item in items:
            if item["id"] == item_id:
                mutate_fn(item)
                _write(DATA / filename, items)
                return item
    return None


def _delete(filename: str, item_id: str) -> bool:
    with _lock, _FileLock(DATA / filename):
        items = _read(DATA / filename)
        new_items = [i for i in items if i["id"] != item_id]
        if len(new_items) == len(items):
            return False
        _write(DATA / filename, new_items)
        return True
```

- [ ] **Step 6: Refactor `server.py` to use `dashboard_data`**

Remove these lines from the top of `server.py` (currently lines 1–16, up to `_lock = threading.Lock()`):
```python
#!/usr/bin/env python3
import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flasgger import Swagger

BASE = Path(__file__).parent.resolve()
DATA = BASE / "data"
DATA.mkdir(exist_ok=True)

app = Flask(__name__, static_folder=None)
_lock = threading.Lock()
```

Replace with:
```python
#!/usr/bin/env python3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flasgger import Swagger

from dashboard_data import BASE, DATA, _add, _add_first, _delete, _list, _patch, _read, _write

app = Flask(__name__, static_folder=None)
```

Then remove the six helper function definitions that follow (currently lines 35–88: `_read`, `_write`, `_list`, `_add`, `_add_first`, `_patch`, `_delete`) — they're identical in signature and behavior to the ones now imported from `dashboard_data`, just now lock-protected across processes too. Every call site in the rest of `server.py` (`_list("checklist.json", ...)`, `_add("checklist.json", item)`, etc.) is unchanged — same names, same arguments.

- [ ] **Step 7: Add `.gitignore` entry for lock files**

In `.gitignore`, add a line after `data/*.json`:
```
data/*.lock
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/ -v`
Expected: all tests pass (`test_dashboard_data.py`: 10 passed; `test_server_smoke.py`: 3 passed).

- [ ] **Step 9: Commit**

```bash
git add dashboard_data.py server.py .gitignore tests/__init__.py tests/conftest.py tests/test_dashboard_data.py tests/test_server_smoke.py
git commit -m "refactor: extract dashboard_data module with cross-process file locking"
```

---

### Task 2: `sync_server.py` skeleton — boot-time token, global auth gate, Swagger

**Files:**
- Create: `sync_server.py`
- Create: `tests/test_sync_server_auth.py`
- Create: `tests/test_sync_server_boot.py`

**Interfaces:**
- Consumes: `dashboard_data.BASE`, `dashboard_data.DATA`, `dashboard_data.REPORTS_DIR`, `dashboard_data.REPORTS_INDEX_PATH`, `dashboard_data._read/_write/_add/_add_first/_patch/_delete` (Task 1).
- Produces: `sync_server.app` (Flask instance), `sync_server.SYNC_TOKEN: str` (resolved at import time; import raises `SystemExit` if no token is configured), `sync_server._config_sync_token() -> str | None`. Later tasks (3–5) register routes on `sync_server.app`; tests for those tasks reuse the same auth-gate behavior established here.

- [ ] **Step 1: Write the failing tests**

`tests/test_sync_server_auth.py`:
```python
import sync_server


def test_missing_header_returns_401(monkeypatch):
    monkeypatch.setattr(sync_server, "SYNC_TOKEN", "s3cr3t")
    client = sync_server.app.test_client()
    resp = client.get("/api/sync/__probe")
    assert resp.status_code == 401
    assert resp.get_json() == {"error": "unauthorized"}


def test_wrong_token_returns_401(monkeypatch):
    monkeypatch.setattr(sync_server, "SYNC_TOKEN", "s3cr3t")
    client = sync_server.app.test_client()
    resp = client.get("/api/sync/__probe", headers={"Authorization": "Bearer nope"})
    assert resp.status_code == 401


def test_no_cors_headers_ever(monkeypatch):
    monkeypatch.setattr(sync_server, "SYNC_TOKEN", "s3cr3t")
    client = sync_server.app.test_client()
    resp = client.get("/api/sync/__probe", headers={"Authorization": "Bearer s3cr3t"})
    assert "Access-Control-Allow-Origin" not in resp.headers


def test_apidocs_accessible_without_token():
    client = sync_server.app.test_client()
    resp = client.get("/apidocs/")
    assert resp.status_code == 200


def test_apispec_accessible_without_token():
    client = sync_server.app.test_client()
    resp = client.get("/apispec_1.json")
    assert resp.status_code == 200
```

Note: `/api/sync/__probe` doesn't exist as a route yet in this task — that's fine, since the auth gate runs in `before_request`, which fires before Flask's URL routing decides 404 vs 200. A 401 here proves the gate itself works, independent of any specific route existing. Task 3 onward re-verifies auth on the real routes too.

`tests/test_sync_server_boot.py`:
```python
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_boot_fails_fast_without_any_token(tmp_path):
    # BASE in dashboard_data.py is Path(__file__).parent.resolve() — it follows
    # the *file's* location, not the process cwd. So to deterministically test
    # "no dashboard-config.json fallback either" without depending on whatever
    # the developer's real (gitignored) dashboard-config.json happens to
    # contain, copy both modules into an empty tmp_path and import from there.
    shutil.copy(REPO_ROOT / "dashboard_data.py", tmp_path / "dashboard_data.py")
    shutil.copy(REPO_ROOT / "sync_server.py", tmp_path / "sync_server.py")
    result = subprocess.run(
        [sys.executable, "-c", "import sync_server"],
        cwd=tmp_path,
        env={"PATH": "/usr/bin:/bin"},
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode != 0
    assert "DASHBOARD_SYNC_TOKEN" in result.stderr


def test_boot_succeeds_with_env_token():
    result = subprocess.run(
        [sys.executable, "-c", "import sync_server"],
        cwd=REPO_ROOT,
        env={"PATH": "/usr/bin:/bin", "DASHBOARD_SYNC_TOKEN": "abc123"},
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_sync_server_auth.py tests/test_sync_server_boot.py -v`
Expected: `ModuleNotFoundError: No module named 'sync_server'`.

- [ ] **Step 3: Create `sync_server.py`**

```python
#!/usr/bin/env python3
import hmac
import json
import os

from flask import Flask, jsonify, request
from flasgger import Swagger

from dashboard_data import BASE

app = Flask(__name__, static_folder=None)

Swagger(app, template={
    "info": {
        "title": "Dashboard Sync API",
        "description": "Bearer-token-authenticated API for aggregating multiple Dashboard instances (sessions, reports, checklist).",
        "version": "1.0.0",
    },
    "tags": [{"name": "Sync"}],
    "securityDefinitions": {
        "bearerAuth": {
            "type": "apiKey",
            "name": "Authorization",
            "in": "header",
            "description": "Pass as 'Bearer <token>'.",
        }
    },
})


def _config_sync_token() -> str | None:
    try:
        config = json.loads((BASE / "dashboard-config.json").read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    return config.get("sync", {}).get("token")


SYNC_TOKEN = os.environ.get("DASHBOARD_SYNC_TOKEN") or _config_sync_token()
if not SYNC_TOKEN:
    raise SystemExit(
        "DASHBOARD_SYNC_TOKEN not set. sync_server.py only serves /api/sync/*, "
        "so a token is required to start it at all. Set the DASHBOARD_SYNC_TOKEN "
        "env var, or dashboard-config.json's 'sync.token' key."
    )

_PUBLIC_PREFIXES = ("/apidocs", "/apispec", "/flasgger_static")


@app.before_request
def _check_token():
    if request.path.startswith(_PUBLIC_PREFIXES):
        return
    auth = request.headers.get("Authorization", "")
    prefix = "Bearer "
    supplied = auth[len(prefix):] if auth.startswith(prefix) else None
    if not supplied or not hmac.compare_digest(supplied, SYNC_TOKEN):
        app.logger.warning("sync auth failed from %s on %s", request.remote_addr, request.path)
        return jsonify({"error": "unauthorized"}), 401


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8766, debug=False)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_sync_server_auth.py tests/test_sync_server_boot.py -v`
Expected: 7 passed.

- [ ] **Step 5: Run the full suite so far**

Run: `.venv/bin/python -m pytest tests/ -v`
Expected: all 20 tests across Tasks 1–2 pass.

- [ ] **Step 6: Commit**

```bash
git add sync_server.py tests/test_sync_server_auth.py tests/test_sync_server_boot.py
git commit -m "feat: add sync_server.py skeleton with boot-time token and global auth gate"
```

---

### Task 3: `GET /api/sync/reports` and `GET /api/sync/reports/<name>`

**Files:**
- Modify: `sync_server.py` — add imports and two routes after the `_check_token` function.
- Create: `tests/test_sync_reports.py`

**Interfaces:**
- Consumes: `dashboard_data.REPORTS_DIR`, `dashboard_data.REPORTS_INDEX_PATH`, `dashboard_data._read` (Task 1); `sync_server.SYNC_TOKEN` / auth gate (Task 2).
- Produces: `sync_server._find_report(name: str) -> dict | None`.

- [ ] **Step 1: Write the failing tests**

`tests/test_sync_reports.py`:
```python
import json

import pytest

import sync_server


@pytest.fixture
def client(tmp_path, monkeypatch):
    reports_dir = tmp_path / "reports"
    reports_dir.mkdir()
    monkeypatch.setattr(sync_server, "REPORTS_DIR", reports_dir)
    monkeypatch.setattr(sync_server, "REPORTS_INDEX_PATH", reports_dir / "reports-index.json")
    monkeypatch.setattr(sync_server, "SYNC_TOKEN", "test-token")
    return sync_server.app.test_client()


AUTH = {"Authorization": "Bearer test-token"}


def test_list_reports_returns_index_contents(client):
    index = [{"name": "foo", "file": "reports/foo.html", "title": "Foo", "mtime": "2026-01-01T00:00:00"}]
    sync_server.REPORTS_INDEX_PATH.write_text(json.dumps(index), encoding="utf-8")
    resp = client.get("/api/sync/reports", headers=AUTH)
    assert resp.status_code == 200
    assert resp.get_json() == index


def test_list_reports_empty_when_index_missing(client):
    resp = client.get("/api/sync/reports", headers=AUTH)
    assert resp.status_code == 200
    assert resp.get_json() == []


def test_list_reports_requires_auth(client):
    resp = client.get("/api/sync/reports")
    assert resp.status_code == 401


def test_get_report_serves_html_by_name(client):
    index = [{"name": "foo", "file": "reports/foo.html", "title": "Foo", "mtime": "x"}]
    sync_server.REPORTS_INDEX_PATH.write_text(json.dumps(index), encoding="utf-8")
    sync_server.REPORTS_DIR.joinpath("foo.html").write_text("<html>hi</html>", encoding="utf-8")
    resp = client.get("/api/sync/reports/foo", headers=AUTH)
    assert resp.status_code == 200
    assert b"hi" in resp.data


def test_get_report_unknown_name_returns_404(client):
    sync_server.REPORTS_INDEX_PATH.write_text("[]", encoding="utf-8")
    resp = client.get("/api/sync/reports/does-not-exist", headers=AUTH)
    assert resp.status_code == 404
    assert resp.get_json() == {"error": "not found"}


def test_get_report_path_traversal_via_encoded_slash_is_rejected(client):
    index = [{"name": "foo", "file": "reports/foo.html", "title": "Foo", "mtime": "x"}]
    sync_server.REPORTS_INDEX_PATH.write_text(json.dumps(index), encoding="utf-8")
    resp = client.get("/api/sync/reports/..%2f..%2fetc%2fpasswd", headers=AUTH)
    assert resp.status_code == 404


def test_get_report_name_not_in_index_cannot_read_arbitrary_file(client):
    sync_server.REPORTS_INDEX_PATH.write_text("[]", encoding="utf-8")
    sync_server.REPORTS_DIR.joinpath("secret.html").write_text("nope", encoding="utf-8")
    resp = client.get("/api/sync/reports/secret", headers=AUTH)
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_sync_reports.py -v`
Expected: FAIL — `404 NOT FOUND` from Flask routing (no `/api/sync/reports` route registered yet).

- [ ] **Step 3: Implement the routes**

Add to the imports at the top of `sync_server.py`:
```python
from pathlib import Path

from flask import send_from_directory

from dashboard_data import BASE, REPORTS_DIR, REPORTS_INDEX_PATH, _read
```
(replacing the earlier `from dashboard_data import BASE` line from Task 2 with this fuller one.)

Add after the `_check_token` function:
```python
def _find_report(name: str) -> dict | None:
    for entry in _read(REPORTS_INDEX_PATH):
        if entry.get("name") == name:
            return entry
    return None


@app.route("/api/sync/reports", methods=["GET"])
def sync_list_reports():
    """List all reports available for sync.
    ---
    tags: [Sync]
    security:
      - bearerAuth: []
    responses:
      200:
        description: Reports index (same shape as reports/reports-index.json)
      401:
        description: Missing or invalid bearer token
    """
    return jsonify(_read(REPORTS_INDEX_PATH))


@app.route("/api/sync/reports/<name>", methods=["GET"])
def sync_get_report(name):
    """Fetch a single report's HTML by its index name.
    ---
    tags: [Sync]
    security:
      - bearerAuth: []
    parameters:
      - in: path
        name: name
        type: string
        required: true
        description: The 'name' field from the reports index (not a filename)
    responses:
      200:
        description: Report HTML
      401:
        description: Missing or invalid bearer token
      404:
        description: No report with that name in the index
    """
    entry = _find_report(name)
    if entry is None:
        return jsonify({"error": "not found"}), 404
    filename = Path(entry["file"]).name
    return send_from_directory(str(REPORTS_DIR), filename)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_sync_reports.py -v`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add sync_server.py tests/test_sync_reports.py
git commit -m "feat: add GET /api/sync/reports and /api/sync/reports/<name>"
```

---

### Task 4: `GET /api/sync/sessions`

**Files:**
- Modify: `sync_server.py` — add one route, add `DATA` to the `dashboard_data` import.
- Create: `tests/test_sync_sessions.py`

**Interfaces:**
- Consumes: `dashboard_data.DATA`, `dashboard_data._read` (Task 1).
- Produces: `GET /api/sync/sessions` → JSON array (same shape as `server.py`'s `GET /api/sessions`, read-only — sessions are only ever written locally by `server.py`).

- [ ] **Step 1: Write the failing tests**

`tests/test_sync_sessions.py`:
```python
import json

import pytest

import sync_server


@pytest.fixture
def client(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setattr(sync_server, "DATA", data_dir)
    monkeypatch.setattr(sync_server, "SYNC_TOKEN", "test-token")
    return sync_server.app.test_client()


AUTH = {"Authorization": "Bearer test-token"}


def test_sync_sessions_returns_registry_contents(client):
    (sync_server.DATA / "sessions-registry.json").write_text(
        json.dumps([{"id": "abc123", "provider": "edgar", "name": "test", "status": "active"}]),
        encoding="utf-8",
    )
    resp = client.get("/api/sync/sessions", headers=AUTH)
    assert resp.status_code == 200
    assert resp.get_json() == [{"id": "abc123", "provider": "edgar", "name": "test", "status": "active"}]


def test_sync_sessions_empty_when_registry_missing(client):
    resp = client.get("/api/sync/sessions", headers=AUTH)
    assert resp.status_code == 200
    assert resp.get_json() == []


def test_sync_sessions_requires_auth(client):
    resp = client.get("/api/sync/sessions")
    assert resp.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_sync_sessions.py -v`
Expected: FAIL — `404 NOT FOUND` (route not registered yet).

- [ ] **Step 3: Implement the route**

Update the `dashboard_data` import line in `sync_server.py`:
```python
from dashboard_data import BASE, DATA, REPORTS_DIR, REPORTS_INDEX_PATH, _read
```

Add after `sync_get_report`:
```python
@app.route("/api/sync/sessions", methods=["GET"])
def sync_sessions():
    """List registered sessions for sync (read-only — written locally by server.py).
    ---
    tags: [Sync]
    security:
      - bearerAuth: []
    responses:
      200:
        description: Same shape as server.py's GET /api/sessions
      401:
        description: Missing or invalid bearer token
    """
    return jsonify(_read(DATA / "sessions-registry.json"))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_sync_sessions.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add sync_server.py tests/test_sync_sessions.py
git commit -m "feat: add GET /api/sync/sessions"
```

---

### Task 5: Checklist read/write over sync — `GET`/`POST /api/sync/checklist`, `PATCH`/`DELETE /api/sync/checklist/<item_id>`

This is the endpoint the aggregator actually needs writes on: creating/checking/removing tasks on a machine you don't have direct access to. Both `checklist.json` (work) and `personal-checklist.json` (personal) are reachable via a `list` selector — `"checklist"` (default) or `"personal-checklist"` — in the POST body / as a query param on PATCH/DELETE.

**Files:**
- Modify: `sync_server.py` — add imports (`uuid`, `datetime`/`timezone`, `_add`/`_patch`/`_delete` from `dashboard_data`), a `_checklist_filename` helper, and four routes.
- Create: `tests/test_sync_checklist.py`

**Interfaces:**
- Consumes: `dashboard_data._read`/`_add`/`_patch`/`_delete` (Task 1, now cross-process-lock-protected).
- Produces: `sync_server._checklist_filename(list_name: str) -> str | None` (maps `"checklist"` → `"checklist.json"`, `"personal-checklist"` → `"personal-checklist.json"`, anything else → `None`).

- [ ] **Step 1: Write the failing tests**

`tests/test_sync_checklist.py`:
```python
import json

import pytest

import sync_server


@pytest.fixture
def client(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setattr(sync_server, "DATA", data_dir)
    monkeypatch.setattr(sync_server, "SYNC_TOKEN", "test-token")
    return sync_server.app.test_client()


AUTH = {"Authorization": "Bearer test-token"}


def test_get_checklist_combines_both_lists(client):
    (sync_server.DATA / "checklist.json").write_text(
        json.dumps([{"id": "1", "text": "a", "checked": False}]), encoding="utf-8"
    )
    (sync_server.DATA / "personal-checklist.json").write_text(
        json.dumps([{"id": "2", "text": "b", "checked": True}]), encoding="utf-8"
    )
    resp = client.get("/api/sync/checklist", headers=AUTH)
    assert resp.status_code == 200
    assert resp.get_json() == {
        "checklist": [{"id": "1", "text": "a", "checked": False}],
        "personal_checklist": [{"id": "2", "text": "b", "checked": True}],
    }


def test_get_checklist_empty_lists_when_files_missing(client):
    resp = client.get("/api/sync/checklist", headers=AUTH)
    assert resp.get_json() == {"checklist": [], "personal_checklist": []}


def test_get_checklist_requires_auth(client):
    resp = client.get("/api/sync/checklist")
    assert resp.status_code == 401


def test_post_checklist_defaults_to_work_list(client):
    resp = client.post("/api/sync/checklist", json={"text": "new task"}, headers=AUTH)
    assert resp.status_code == 201
    body = resp.get_json()
    assert body["text"] == "new task"
    assert body["checked"] is False
    on_disk = json.loads((sync_server.DATA / "checklist.json").read_text(encoding="utf-8"))
    assert on_disk == [body]
    assert not (sync_server.DATA / "personal-checklist.json").exists()


def test_post_checklist_targets_personal_list(client):
    resp = client.post(
        "/api/sync/checklist", json={"text": "personal task", "list": "personal-checklist"}, headers=AUTH
    )
    assert resp.status_code == 201
    on_disk = json.loads((sync_server.DATA / "personal-checklist.json").read_text(encoding="utf-8"))
    assert on_disk[0]["text"] == "personal task"


def test_post_checklist_requires_text(client):
    resp = client.post("/api/sync/checklist", json={}, headers=AUTH)
    assert resp.status_code == 400


def test_post_checklist_rejects_unknown_list(client):
    resp = client.post("/api/sync/checklist", json={"text": "x", "list": "not-a-real-list"}, headers=AUTH)
    assert resp.status_code == 400


def test_post_checklist_requires_auth(client):
    resp = client.post("/api/sync/checklist", json={"text": "x"})
    assert resp.status_code == 401


def test_patch_checklist_toggles_checked_on_work_list_by_default(client):
    item_id = client.post("/api/sync/checklist", json={"text": "x"}, headers=AUTH).get_json()["id"]
    resp = client.patch(f"/api/sync/checklist/{item_id}", json={"checked": True}, headers=AUTH)
    assert resp.status_code == 200
    assert resp.get_json()["checked"] is True


def test_patch_checklist_targets_personal_list_via_query_param(client):
    item_id = client.post(
        "/api/sync/checklist", json={"text": "x", "list": "personal-checklist"}, headers=AUTH
    ).get_json()["id"]
    resp = client.patch(
        f"/api/sync/checklist/{item_id}?list=personal-checklist", json={"checked": True}, headers=AUTH
    )
    assert resp.status_code == 200
    assert resp.get_json()["checked"] is True


def test_patch_checklist_missing_id_returns_404(client):
    resp = client.patch("/api/sync/checklist/does-not-exist", json={"checked": True}, headers=AUTH)
    assert resp.status_code == 404


def test_patch_checklist_rejects_unknown_list(client):
    resp = client.patch("/api/sync/checklist/x?list=nope", json={"checked": True}, headers=AUTH)
    assert resp.status_code == 400


def test_delete_checklist_removes_item(client):
    item_id = client.post("/api/sync/checklist", json={"text": "x"}, headers=AUTH).get_json()["id"]
    resp = client.delete(f"/api/sync/checklist/{item_id}", headers=AUTH)
    assert resp.status_code == 204
    assert client.get("/api/sync/checklist", headers=AUTH).get_json()["checklist"] == []


def test_delete_checklist_missing_id_returns_404(client):
    resp = client.delete("/api/sync/checklist/does-not-exist", headers=AUTH)
    assert resp.status_code == 404


def test_delete_checklist_requires_auth(client):
    resp = client.delete("/api/sync/checklist/whatever")
    assert resp.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_sync_checklist.py -v`
Expected: FAIL — `404 NOT FOUND` (routes not registered yet).

- [ ] **Step 3: Implement the routes**

Add to the imports at the top of `sync_server.py`:
```python
import uuid
from datetime import datetime, timezone
```
and update the `dashboard_data` import:
```python
from dashboard_data import BASE, DATA, REPORTS_DIR, REPORTS_INDEX_PATH, _add, _delete, _patch, _read
```

Add after `sync_sessions`:
```python
CHECKLIST_FILES = {
    "checklist": "checklist.json",
    "personal-checklist": "personal-checklist.json",
}


def _checklist_filename(list_name: str) -> str | None:
    return CHECKLIST_FILES.get(list_name)


@app.route("/api/sync/checklist", methods=["GET"])
def sync_get_checklist():
    """Get work and personal checklists for sync.
    ---
    tags: [Sync]
    security:
      - bearerAuth: []
    responses:
      200:
        description: Object with 'checklist' and 'personal_checklist' arrays
      401:
        description: Missing or invalid bearer token
    """
    return jsonify({
        "checklist": _read(DATA / "checklist.json"),
        "personal_checklist": _read(DATA / "personal-checklist.json"),
    })


@app.route("/api/sync/checklist", methods=["POST"])
def sync_add_checklist_item():
    """Create a checklist item on this instance from a remote aggregator.
    ---
    tags: [Sync]
    security:
      - bearerAuth: []
    parameters:
      - in: body
        name: body
        required: true
        schema:
          type: object
          required: [text]
          properties:
            text:
              type: string
            list:
              type: string
              description: "'checklist' (default, work) or 'personal-checklist'"
    responses:
      201:
        description: Created item
      400:
        description: text required, or list is not 'checklist'/'personal-checklist'
      401:
        description: Missing or invalid bearer token
    """
    body = request.get_json(force=True) or {}
    text = str(body.get("text", "")).strip()
    if not text:
        return jsonify({"error": "text required"}), 400
    filename = _checklist_filename(str(body.get("list", "checklist")))
    if filename is None:
        return jsonify({"error": "list must be 'checklist' or 'personal-checklist'"}), 400
    item = {
        "id": uuid.uuid4().hex[:8],
        "text": text,
        "checked": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return jsonify(_add(filename, item)), 201


@app.route("/api/sync/checklist/<item_id>", methods=["PATCH"])
def sync_patch_checklist_item(item_id):
    """Toggle or set checked state of a checklist item from a remote aggregator.
    ---
    tags: [Sync]
    security:
      - bearerAuth: []
    parameters:
      - in: path
        name: item_id
        type: string
        required: true
      - in: query
        name: list
        type: string
        required: false
        description: "'checklist' (default, work) or 'personal-checklist'"
      - in: body
        name: body
        schema:
          type: object
          properties:
            checked:
              type: boolean
    responses:
      200:
        description: Updated item
      400:
        description: list is not 'checklist'/'personal-checklist'
      401:
        description: Missing or invalid bearer token
      404:
        description: Not found
    """
    filename = _checklist_filename(request.args.get("list", "checklist"))
    if filename is None:
        return jsonify({"error": "list must be 'checklist' or 'personal-checklist'"}), 400
    body = request.get_json(force=True) or {}

    def mutate(item):
        item["checked"] = bool(body["checked"]) if "checked" in body else not item.get("checked", False)

    item = _patch(filename, item_id, mutate)
    if item is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(item)


@app.route("/api/sync/checklist/<item_id>", methods=["DELETE"])
def sync_delete_checklist_item(item_id):
    """Delete a checklist item from a remote aggregator.
    ---
    tags: [Sync]
    security:
      - bearerAuth: []
    parameters:
      - in: path
        name: item_id
        type: string
        required: true
      - in: query
        name: list
        type: string
        required: false
        description: "'checklist' (default, work) or 'personal-checklist'"
    responses:
      204:
        description: Deleted
      400:
        description: list is not 'checklist'/'personal-checklist'
      401:
        description: Missing or invalid bearer token
      404:
        description: Not found
    """
    filename = _checklist_filename(request.args.get("list", "checklist"))
    if filename is None:
        return jsonify({"error": "list must be 'checklist' or 'personal-checklist'"}), 400
    if not _delete(filename, item_id):
        return jsonify({"error": "not found"}), 404
    return "", 204
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_sync_checklist.py -v`
Expected: 15 passed.

- [ ] **Step 5: Run the full suite**

Run: `.venv/bin/python -m pytest tests/ -v`
Expected: all tests across Tasks 1–5 pass (45 total).

- [ ] **Step 6: Commit**

```bash
git add sync_server.py tests/test_sync_checklist.py
git commit -m "feat: add checklist read/write over sync (GET/POST/PATCH/DELETE)"
```

---

### Task 7: Checklist proxy in `server.py` (slave mode) via `sync_client.py`

An instance becomes a "slave" for checklist purposes by setting `dashboard-config.json`'s `sync.upstream` key to another instance's sync API (`{"url": "https://main.example.com", "token": "..."}`). Once set, `server.py`'s four checklist route families stop touching `checklist.json`/`personal-checklist.json` on disk and instead call that URL's `/api/sync/checklist` endpoints (Task 5) over plain `urllib.request` — no new dependency. The frontend (`dashboard-common.js`) doesn't change: it still calls the same local `/api/checklist` / `/api/personal/checklist` routes and gets the same response shapes back: it has no idea whether the answer came from disk or over the network.

**Files:**
- Create: `sync_client.py`
- Modify: `server.py` — add `_resolve_upstream()` / `UPSTREAM` near the top (after the `dashboard_data` import), and branch all four checklist route families (`get_checklist`, `add_checklist`, `patch_checklist`, `delete_checklist`, `get_personal_checklist`, `add_personal_checklist`, `patch_personal_checklist`, `delete_personal_checklist`) on `UPSTREAM`.
- Create: `tests/test_sync_client.py`
- Create: `tests/test_server_checklist_proxy.py`

**Interfaces:**
- Consumes: nothing from earlier tasks directly — `sync_client.py` is a standalone HTTP client module. It targets the wire format `sync_server.py` already serves (Task 5): `GET /api/sync/checklist` → `{"checklist": [...], "personal_checklist": [...]}`; `POST /api/sync/checklist` body `{"text": ..., "list": ...}` → `201` + item; `PATCH /api/sync/checklist/<id>?list=...` body `{"checked": ...}` → `200` + item or `404`; `DELETE /api/sync/checklist/<id>?list=...` → `204` or `404`.
- Produces: `sync_client.UpstreamError` (exception; raised for network failures, and also raised by the module-level functions for any unexpected HTTP status from a live upstream other than the 404-as-not-found case in `patch_checklist_item`/`delete_checklist_item`), `sync_client.get_checklist(url, token, list_name) -> list`, `sync_client.add_checklist_item(url, token, list_name, text) -> dict`, `sync_client.patch_checklist_item(url, token, list_name, item_id, checked) -> dict | None`, `sync_client.delete_checklist_item(url, token, list_name, item_id) -> bool`. `list_name` is `"checklist"` or `"personal-checklist"`, same vocabulary as `sync_server.py`'s `_checklist_filename`.
- Produces: `server._resolve_upstream() -> dict | None` (`{"url": ..., "token": ...}` or `None`), `server.UPSTREAM` (module-level, resolved at import time from `dashboard-config.json`'s `sync.upstream` key — no env var for this one, since it's inherently per-machine config, not a secret-only value).

- [ ] **Step 1: Write the failing tests for `sync_client.py`**

These run a real `sync_server.app` in a background thread (via `werkzeug.serving.make_server`, ephemeral port) so `sync_client.py` is tested against the actual wire format, not a mock.

`tests/test_sync_client.py`:
```python
import json
import threading

import pytest
from werkzeug.serving import make_server

import sync_client
import sync_server


@pytest.fixture
def live_sync_server(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setattr(sync_server, "DATA", data_dir)
    monkeypatch.setattr(sync_server, "SYNC_TOKEN", "test-token")

    server = make_server("127.0.0.1", 0, sync_server.app)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", data_dir
    finally:
        server.shutdown()
        thread.join()


def test_get_checklist_returns_work_list(live_sync_server):
    url, data_dir = live_sync_server
    (data_dir / "checklist.json").write_text(json.dumps([{"id": "1", "text": "a"}]), encoding="utf-8")
    result = sync_client.get_checklist(url, "test-token", "checklist")
    assert result == [{"id": "1", "text": "a"}]


def test_get_checklist_returns_personal_list(live_sync_server):
    url, data_dir = live_sync_server
    (data_dir / "personal-checklist.json").write_text(json.dumps([{"id": "2", "text": "b"}]), encoding="utf-8")
    result = sync_client.get_checklist(url, "test-token", "personal-checklist")
    assert result == [{"id": "2", "text": "b"}]


def test_add_checklist_item_returns_created_item(live_sync_server):
    url, _ = live_sync_server
    item = sync_client.add_checklist_item(url, "test-token", "checklist", "new task")
    assert item["text"] == "new task"
    assert item["checked"] is False


def test_patch_checklist_item_returns_updated_item(live_sync_server):
    url, _ = live_sync_server
    item = sync_client.add_checklist_item(url, "test-token", "checklist", "x")
    updated = sync_client.patch_checklist_item(url, "test-token", "checklist", item["id"], True)
    assert updated["checked"] is True


def test_patch_checklist_item_missing_id_returns_none(live_sync_server):
    url, _ = live_sync_server
    assert sync_client.patch_checklist_item(url, "test-token", "checklist", "nope", True) is None


def test_delete_checklist_item_returns_true(live_sync_server):
    url, _ = live_sync_server
    item = sync_client.add_checklist_item(url, "test-token", "checklist", "x")
    assert sync_client.delete_checklist_item(url, "test-token", "checklist", item["id"]) is True


def test_delete_checklist_item_missing_id_returns_false(live_sync_server):
    url, _ = live_sync_server
    assert sync_client.delete_checklist_item(url, "test-token", "checklist", "nope") is False


def test_wrong_token_raises_upstream_error(live_sync_server):
    url, _ = live_sync_server
    with pytest.raises(sync_client.UpstreamError):
        sync_client.get_checklist(url, "wrong-token", "checklist")


def test_unreachable_host_raises_upstream_error():
    with pytest.raises(sync_client.UpstreamError):
        sync_client.get_checklist("http://127.0.0.1:1", "any-token", "checklist")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_sync_client.py -v`
Expected: `ModuleNotFoundError: No module named 'sync_client'`.

- [ ] **Step 3: Create `sync_client.py`**

```python
#!/usr/bin/env python3
import json
import urllib.error
import urllib.request


class UpstreamError(Exception):
    """Raised by _request only for network-level failures (DNS, connection
    refused, timeout) — a well-formed HTTP response, even a 4xx/5xx, is
    returned as (status, body) instead. The module-level functions below then
    layer their own meaning on top of that: 404 is treated as a normal "not
    found" result (None/False) where it's a valid business outcome (patch,
    delete), but any other unexpected status from a live server — including
    auth failures — is also raised as UpstreamError, since the caller has no
    useful way to act on "main said 401" beyond surfacing that sync is broken.
    """


def _request(url: str, token: str, method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(
        url.rstrip("/") + path,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        resp = urllib.request.urlopen(req, timeout=5)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        return exc.code, (json.loads(raw) if raw else None)
    except urllib.error.URLError as exc:
        raise UpstreamError(str(exc.reason)) from exc
    with resp:
        raw = resp.read()
        return resp.status, (json.loads(raw) if raw else None)


def get_checklist(url: str, token: str, list_name: str) -> list:
    status, body = _request(url, token, "GET", "/api/sync/checklist")
    if status != 200:
        raise UpstreamError(f"unexpected status {status} from GET /api/sync/checklist")
    key = "checklist" if list_name == "checklist" else "personal_checklist"
    return body[key]


def add_checklist_item(url: str, token: str, list_name: str, text: str) -> dict:
    status, body = _request(url, token, "POST", "/api/sync/checklist", {"text": text, "list": list_name})
    if status != 201:
        raise UpstreamError(f"unexpected status {status} from POST /api/sync/checklist: {body}")
    return body


def patch_checklist_item(url: str, token: str, list_name: str, item_id: str, checked: bool):
    status, body = _request(
        url, token, "PATCH", f"/api/sync/checklist/{item_id}?list={list_name}", {"checked": checked}
    )
    if status == 404:
        return None
    if status != 200:
        raise UpstreamError(f"unexpected status {status} from PATCH /api/sync/checklist/{item_id}: {body}")
    return body


def delete_checklist_item(url: str, token: str, list_name: str, item_id: str) -> bool:
    status, body = _request(url, token, "DELETE", f"/api/sync/checklist/{item_id}?list={list_name}")
    if status == 404:
        return False
    if status != 204:
        raise UpstreamError(f"unexpected status {status} from DELETE /api/sync/checklist/{item_id}: {body}")
    return True
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_sync_client.py -v`
Expected: 9 passed.

- [ ] **Step 5: Write the failing tests for `server.py`'s proxy branch**

`tests/test_server_checklist_proxy.py`:
```python
import pytest

import server
import sync_client


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(server, "UPSTREAM", {"url": "http://main.example", "token": "up-token"})
    return server.app.test_client()


def test_get_checklist_proxies_to_upstream(client, monkeypatch):
    monkeypatch.setattr(
        sync_client, "get_checklist", lambda url, token, list_name: [{"id": "1", "text": "from main"}]
    )
    resp = client.get("/api/checklist")
    assert resp.status_code == 200
    assert resp.get_json() == [{"id": "1", "text": "from main"}]


def test_get_personal_checklist_proxies_with_personal_list_name(client, monkeypatch):
    seen = {}

    def fake_get_checklist(url, token, list_name):
        seen["list_name"] = list_name
        return []

    monkeypatch.setattr(sync_client, "get_checklist", fake_get_checklist)
    client.get("/api/personal/checklist")
    assert seen["list_name"] == "personal-checklist"


def test_post_checklist_proxies_and_returns_created_item(client, monkeypatch):
    monkeypatch.setattr(
        sync_client,
        "add_checklist_item",
        lambda url, token, list_name, text: {"id": "1", "text": text, "checked": False},
    )
    resp = client.post("/api/checklist", json={"text": "new task"})
    assert resp.status_code == 201
    assert resp.get_json()["text"] == "new task"


def test_patch_checklist_proxies_and_returns_updated_item(client, monkeypatch):
    monkeypatch.setattr(
        sync_client,
        "patch_checklist_item",
        lambda url, token, list_name, item_id, checked: {"id": item_id, "checked": checked},
    )
    resp = client.patch("/api/checklist/abc123", json={"checked": True})
    assert resp.status_code == 200
    assert resp.get_json() == {"id": "abc123", "checked": True}


def test_patch_checklist_proxy_missing_id_returns_404(client, monkeypatch):
    monkeypatch.setattr(
        sync_client, "patch_checklist_item", lambda url, token, list_name, item_id, checked: None
    )
    resp = client.patch("/api/checklist/nope", json={"checked": True})
    assert resp.status_code == 404


def test_delete_checklist_proxies(client, monkeypatch):
    monkeypatch.setattr(
        sync_client, "delete_checklist_item", lambda url, token, list_name, item_id: True
    )
    resp = client.delete("/api/checklist/abc123")
    assert resp.status_code == 204


def test_delete_checklist_proxy_missing_id_returns_404(client, monkeypatch):
    monkeypatch.setattr(
        sync_client, "delete_checklist_item", lambda url, token, list_name, item_id: False
    )
    resp = client.delete("/api/checklist/nope")
    assert resp.status_code == 404


def test_upstream_unreachable_returns_502(client, monkeypatch):
    def raise_upstream_error(*args, **kwargs):
        raise sync_client.UpstreamError("connection refused")

    monkeypatch.setattr(sync_client, "get_checklist", raise_upstream_error)
    resp = client.get("/api/checklist")
    assert resp.status_code == 502
    assert "upstream unavailable" in resp.get_json()["error"]


def test_no_upstream_configured_uses_local_files(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "UPSTREAM", None)
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setattr(server, "DATA", data_dir)
    client = server.app.test_client()
    resp = client.get("/api/checklist")
    assert resp.status_code == 200
    assert resp.get_json() == []
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_server_checklist_proxy.py -v`
Expected: `AttributeError: module 'server' has no attribute 'UPSTREAM'`.

- [ ] **Step 7: Wire the proxy into `server.py`**

Add near the top of `server.py`, after the `dashboard_data` import:
```python
import json

import sync_client


def _resolve_upstream() -> dict | None:
    try:
        config = json.loads((BASE / "dashboard-config.json").read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    upstream = config.get("sync", {}).get("upstream")
    if not upstream or not upstream.get("url") or not upstream.get("token"):
        return None
    return upstream


UPSTREAM = _resolve_upstream()
```

Replace the existing `get_checklist` (work list) with:
```python
@app.route("/api/checklist", methods=["GET"])
def get_checklist():
    """Get all checklist items.
    ---
    tags: [Checklist]
    responses:
      200:
        description: List of checklist items
        schema:
          type: array
          items:
            $ref: '#/definitions/ChecklistItem'
      502:
        description: Upstream sync server unreachable (only when sync.upstream is configured)
    definitions:
      ChecklistItem:
        type: object
        properties:
          id:
            type: string
            example: a1b2c3d4
          text:
            type: string
            example: Review PRs
          checked:
            type: boolean
          created_at:
            type: string
            format: date-time
    """
    if UPSTREAM:
        try:
            return jsonify(sync_client.get_checklist(UPSTREAM["url"], UPSTREAM["token"], "checklist"))
        except sync_client.UpstreamError as exc:
            return jsonify({"error": f"upstream unavailable: {exc}"}), 502
    return jsonify(_list("checklist.json"))
```

Replace `add_checklist`:
```python
@app.route("/api/checklist", methods=["POST"])
def add_checklist():
    """Add a checklist item.
    ---
    tags: [Checklist]
    parameters:
      - in: body
        name: body
        required: true
        schema:
          type: object
          required: [text]
          properties:
            text:
              type: string
              example: Review PRs
    responses:
      201:
        description: Created item
        schema:
          $ref: '#/definitions/ChecklistItem'
      400:
        description: text required
      502:
        description: Upstream sync server unreachable (only when sync.upstream is configured)
    """
    body = request.get_json(force=True) or {}
    text = str(body.get("text", "")).strip()
    if not text:
        return jsonify({"error": "text required"}), 400
    if UPSTREAM:
        try:
            return jsonify(sync_client.add_checklist_item(UPSTREAM["url"], UPSTREAM["token"], "checklist", text)), 201
        except sync_client.UpstreamError as exc:
            return jsonify({"error": f"upstream unavailable: {exc}"}), 502
    item = {
        "id": uuid.uuid4().hex[:8],
        "text": text,
        "checked": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return jsonify(_add("checklist.json", item)), 201
```

Replace `patch_checklist`:
```python
@app.route("/api/checklist/<item_id>", methods=["PATCH"])
def patch_checklist(item_id):
    """Toggle or set checked state of a checklist item.
    ---
    tags: [Checklist]
    parameters:
      - in: path
        name: item_id
        type: string
        required: true
      - in: body
        name: body
        schema:
          type: object
          properties:
            checked:
              type: boolean
    responses:
      200:
        description: Updated item
        schema:
          $ref: '#/definitions/ChecklistItem'
      404:
        description: Not found
      502:
        description: Upstream sync server unreachable (only when sync.upstream is configured)
    """
    body = request.get_json(force=True) or {}
    if UPSTREAM:
        checked = bool(body["checked"]) if "checked" in body else None
        try:
            if checked is None:
                current = sync_client.get_checklist(UPSTREAM["url"], UPSTREAM["token"], "checklist")
                existing = next((i for i in current if i["id"] == item_id), None)
                checked = not existing.get("checked", False) if existing else True
            item = sync_client.patch_checklist_item(UPSTREAM["url"], UPSTREAM["token"], "checklist", item_id, checked)
        except sync_client.UpstreamError as exc:
            return jsonify({"error": f"upstream unavailable: {exc}"}), 502
        if item is None:
            return jsonify({"error": "not found"}), 404
        return jsonify(item)

    def mutate(item):
        item["checked"] = bool(body["checked"]) if "checked" in body else not item.get("checked", False)
    item = _patch("checklist.json", item_id, mutate)
    if item is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(item)
```

Replace `delete_checklist`:
```python
@app.route("/api/checklist/<item_id>", methods=["DELETE"])
def delete_checklist(item_id):
    """Delete a checklist item.
    ---
    tags: [Checklist]
    parameters:
      - in: path
        name: item_id
        type: string
        required: true
    responses:
      204:
        description: Deleted
      404:
        description: Not found
      502:
        description: Upstream sync server unreachable (only when sync.upstream is configured)
    """
    if UPSTREAM:
        try:
            deleted = sync_client.delete_checklist_item(UPSTREAM["url"], UPSTREAM["token"], "checklist", item_id)
        except sync_client.UpstreamError as exc:
            return jsonify({"error": f"upstream unavailable: {exc}"}), 502
        if not deleted:
            return jsonify({"error": "not found"}), 404
        return "", 204
    if not _delete("checklist.json", item_id):
        return jsonify({"error": "not found"}), 404
    return "", 204
```

Apply the identical pattern to the four personal-checklist routes (`get_personal_checklist`, `add_personal_checklist`, `patch_personal_checklist`, `delete_personal_checklist`), the only difference being `"personal-checklist"` instead of `"checklist"` as the `list_name` argument, and `"personal-checklist.json"` as the local filename — same shape as the existing pairing between these two route families already in the file.

Note on `patch_checklist`'s toggle-without-body case: the local `_patch` helper can read-and-flip `checked` atomically under its own lock, but the proxy path (when `checked` is omitted from the request body) would need two separate HTTP calls — read current state, then PATCH with the computed value — with a small window where a concurrent write in between could compute a stale toggle. In practice this window is never hit: `dashboard-common.js`'s `toggleChecklist()` (`dashboard-common.js:136-149`) always sends an explicit `{"checked": !done}` body, computed client-side from the checkbox's current DOM state, and never omits `checked`. The read-then-patch fallback above exists only so the proxy path doesn't silently misbehave for a hypothetical caller (e.g. a raw `curl` PATCH with an empty body) that omits it — it's a documented best-effort, not a claim of atomicity.

- [ ] **Step 8: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_server_checklist_proxy.py -v`
Expected: 9 passed.

- [ ] **Step 9: Run the full suite**

Run: `.venv/bin/python -m pytest tests/ -v`
Expected: all tests across Tasks 1–7 pass (63 total).

- [ ] **Step 10: Commit**

```bash
git add sync_client.py server.py tests/test_sync_client.py tests/test_server_checklist_proxy.py
git commit -m "feat: proxy checklist routes to a configured sync.upstream (slave mode)"
```

---

### Task 8: Deployment scripts + manual end-to-end verification

**Files:**
- Create: `serve-sync.sh` (mirrors `serve.sh`)
- Create: `dashboard-sync.service` (mirrors `dashboard.service`)
- Modify: `install.sh` — install the second systemd unit alongside the existing one.

**Interfaces:**
- Consumes: nothing new — this is packaging around the already-complete `sync_server.py`.

- [ ] **Step 1: Create `serve-sync.sh`**

```bash
#!/bin/bash
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
echo "Dashboard Sync API a correr em http://localhost:8766"
"$SCRIPT_DIR/.venv/bin/python" "$SCRIPT_DIR/sync_server.py"
```

Run: `chmod +x serve-sync.sh`

- [ ] **Step 2: Create `dashboard-sync.service`**

```ini
[Unit]
Description=Dashboard Sync API (bearer-token-authenticated, for exposure via tunnel)

[Service]
WorkingDirectory={{DASHBOARD_DIR}}
ExecStart={{DASHBOARD_DIR}}/.venv/bin/python {{DASHBOARD_DIR}}/sync_server.py
Restart=on-failure

[Install]
WantedBy=default.target
```

- [ ] **Step 3: Update `install.sh` to install the second unit**

Find, in `install.sh`:
```bash
# 6. Install systemd user service
SERVICE_TEMPLATE="$DASHBOARD_DIR/dashboard.service"
SERVICE_DEST="$HOME/.config/systemd/user/dashboard.service"
if [ -f "$SERVICE_TEMPLATE" ]; then
  mkdir -p "$HOME/.config/systemd/user"
  sed "s|{{DASHBOARD_DIR}}|$DASHBOARD_DIR|g" "$SERVICE_TEMPLATE" > "$SERVICE_DEST"
  systemctl --user daemon-reload
  echo "✓ Installed $SERVICE_DEST and reloaded daemon"
else
  echo "  dashboard.service template not found, skipping"
fi
```

Replace with:
```bash
# 6. Install systemd user services (dashboard + sync)
mkdir -p "$HOME/.config/systemd/user"
for SERVICE_NAME in dashboard dashboard-sync; do
  SERVICE_TEMPLATE="$DASHBOARD_DIR/$SERVICE_NAME.service"
  SERVICE_DEST="$HOME/.config/systemd/user/$SERVICE_NAME.service"
  if [ -f "$SERVICE_TEMPLATE" ]; then
    sed "s|{{DASHBOARD_DIR}}|$DASHBOARD_DIR|g" "$SERVICE_TEMPLATE" > "$SERVICE_DEST"
    echo "✓ Installed $SERVICE_DEST"
  else
    echo "  $SERVICE_NAME.service template not found, skipping"
  fi
done
systemctl --user daemon-reload
echo "✓ Reloaded systemd user daemon"
```

`dashboard-sync.service` is installed but not started automatically, same as `dashboard.service` today (the README already documents `systemctl --user start dashboard` as a manual step) — starting it without `DASHBOARD_SYNC_TOKEN` configured just crash-loops harmlessly (`Restart=on-failure`) rather than exposing anything, since `sync_server.py` refuses to boot without a token.

- [ ] **Step 4: Start both servers locally and verify they coexist**

```bash
DASHBOARD_SYNC_TOKEN=dev-secret .venv/bin/python sync_server.py &
.venv/bin/python server.py &
sleep 1
```

- [ ] **Step 5: Confirm the sync server rejects unauthenticated requests**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8766/api/sync/sessions
```
Expected: `401`

- [ ] **Step 6: Confirm the sync server serves authenticated requests**

```bash
curl -s -H "Authorization: Bearer dev-secret" http://localhost:8766/api/sync/checklist
```
Expected: `{"checklist": [...], "personal_checklist": [...]}` — real content from your local `data/` dir.

- [ ] **Step 7: Confirm a remote-created task lands in the local dashboard's checklist**

```bash
curl -s -X POST -H "Authorization: Bearer dev-secret" -H "Content-Type: application/json" \
  -d '{"text": "created via sync"}' http://localhost:8766/api/sync/checklist
curl -s http://localhost:8765/api/checklist | grep -o "created via sync"
```
Expected: second command prints `created via sync` — proving the write went through the shared `data/checklist.json` and the local (unauthenticated, port 8765) server sees it immediately.

- [ ] **Step 8: Confirm the local dashboard is completely unaffected**

```bash
curl -s -i http://localhost:8765/api/checklist | grep -i "access-control-allow-origin"
```
Expected: header present (`*`) — proves `server.py`'s CORS/behavior wasn't touched by any of this.

- [ ] **Step 9: Confirm Swagger UI on the sync server**

Open `http://localhost:8766/apidocs` in a browser (or `curl -s http://localhost:8766/apispec_1.json | grep -o '"Sync"'`) — confirm the `Sync` tag lists all six endpoints with a lock icon (bearer auth), and that the docs page itself loaded without needing a token.

- [ ] **Step 10: Simulate slave/proxy mode against the same main instance**

`server.py` hardcodes port 8765, so a true two-machine setup can't be fully reproduced on one dev box — Task 7's automated tests already cover the proxy logic in isolation. This step is a real-world integration sanity check: point this instance's own `server.py` at its own `sync_server.py` as if it were a slave pointed at some other main, proving the wiring works end to end, then revert.

Stop the currently running `server.py` (keep `sync_server.py` running):
```bash
kill %2  # the server.py job from Step 4; check `jobs` if the numbering differs
```

Back up your real config and write a temporary one pointing at the local sync server:
```bash
cp dashboard-config.json dashboard-config.json.bak 2>/dev/null || true
python3 -c "
import json
from pathlib import Path
path = Path('dashboard-config.json')
config = json.loads(path.read_text()) if path.exists() else {}
config['sync'] = {'upstream': {'url': 'http://localhost:8766', 'token': 'dev-secret'}}
path.write_text(json.dumps(config, indent=2))
"
```

- [ ] **Step 11: Restart `server.py` in proxy mode and confirm it reads through**

```bash
.venv/bin/python server.py &
sleep 1
curl -s -X POST -H "Content-Type: application/json" -d '{"text": "created via slave"}' http://localhost:8765/api/checklist
curl -s -H "Authorization: Bearer dev-secret" http://localhost:8766/api/sync/checklist | grep -o "created via slave"
```
Expected: the `POST` to the local, unauthenticated `/api/checklist` (no bearer token needed — that's `server.py`'s own local API, unchanged) returns `201` with the created item, and the second `curl` — hitting `sync_server.py` directly — shows the same item landed in `checklist.json`, proving `server.py` proxied the write instead of creating a second, local copy.

- [ ] **Step 12: Confirm a local read also proxies (not a stale local file)**

```bash
curl -s http://localhost:8765/api/checklist | grep -o "created via slave"
```
Expected: prints `created via slave` — this instance's own `GET /api/checklist` is now backed by `sync_server.py`'s data, not a local `checklist.json` (which, if `sync.upstream` is set, is never read).

- [ ] **Step 13: Restore the real config**

```bash
kill %2  # the proxy-mode server.py from Step 11
mv dashboard-config.json.bak dashboard-config.json 2>/dev/null || rm -f dashboard-config.json
.venv/bin/python server.py &
sleep 1
curl -s http://localhost:8765/api/checklist  # back to local files — should not include "created via slave"
```

- [ ] **Step 14: Stop both servers**

```bash
kill %1 %2
```

---

## Out of scope for this plan

- **Cloudflare tunnel config itself** — pointing a tunnel hostname at port 8766 is a one-time dashboard action in Cloudflare's UI (`dash.cloudflare.com`), not a repo change. The point of the two-server split is that this becomes a single "route this hostname to this port" rule instead of path-based rules the free tier can't do.
- **Sessions/reports writes over sync** — explicitly read-only; they're written by agents executing locally, and there's no remote-management use case for them the way there is for checklist tasks.
- **Per-instance tokens** — the issue's own open question resolves to "one shared secret for all," which `DASHBOARD_SYNC_TOKEN` implements.
- **Rate limiting** — logging auth failures (`app.logger.warning`) is the chosen minimum bar; adding a dependency like Flask-Limiter isn't justified for a single-user tool talking to a small, known set of instances.
- **An aggregating "combined view" dashboard UI** — this plan builds the sync API each instance exposes (Tasks 1–6) and the checklist proxy that makes hub/spoke actually usable (Task 7). A page that renders every instance's sessions/reports side by side is a separate frontend deliverable that consumes these APIs; it isn't built here.
- **Multi-hop sync chains** — `sync.upstream` points one instance at exactly one main. A slave being itself the upstream for a third instance (chained hub/spoke) is unsupported and untested.
