# Sync API with Bearer Token Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/api/sync/*` namespace to `server.py` that is bearer-token-authenticated, documented in Swagger, and safe to expose over a Cloudflare tunnel — so other Dashboard instances (other machines/accounts) can pull sessions, reports, and checklist data for aggregation.

**Architecture:** Everything lives in the existing single-file `server.py` (matches the codebase's established pattern — every other resource group, Checklist/Announcements/News/Music/Personal/Sessions, is a section in this one file). A `require_token` decorator wraps four new read-only GET routes. Token resolution happens once at process start (env var `DASHBOARD_SYNC_TOKEN`, falling back to a `sync.token` key in the gitignored `dashboard-config.json`) and is gated behind an explicit `DASHBOARD_SYNC_ENABLED=true` opt-in so existing local-only deployments don't change behavior or start crashing. CORS headers are dropped entirely on `/api/sync/*` since it's server-to-server traffic, not browser traffic.

**Tech Stack:** Python 3.12, Flask 3.1, flasgger 0.9.7 (already installed in `.venv`), pytest (new dev dependency, installed into `.venv` but not persisted to any requirements file — this repo has none).

## Global Constraints

- Zero behavior change to existing `/api/{checklist,announcements,news,music,personal/*,sessions}` routes — no new required headers, no CORS changes on those paths.
- Sync is opt-in: if `DASHBOARD_SYNC_ENABLED` is not `"true"`, `/api/sync/*` always returns `503 {"error": "sync not enabled"}`, regardless of token env vars being set. This keeps the default (local, no env vars set) working exactly as today.
- When sync **is** enabled, missing token config is a hard boot failure (`SystemExit`), not a silent unauthenticated fallback.
- 401 body is always exactly `{"error": "unauthorized"}`, matching the issue's spec.
- Token comparison uses `hmac.compare_digest` — never `==`.
- v1 is GET-only. No POST/mirror-back routes, no write-conflict handling — explicitly out of scope per the issue's non-goals.
- Report files are served only by looking up a `name` from `reports/reports-index.json` and resolving to `Path(entry["file"]).name` before calling `send_from_directory` — never take a raw filename/path from the client.
- New tests live in `tests/`, use `pytest` + Flask's `app.test_client()`, and isolate themselves from the real `data/`/`reports/` directories via `monkeypatch.setattr` on the module's path constants (never read/write the developer's real personal data during tests).

---

### Task 1: Test harness + sync token resolution

**Files:**
- Create: `tests/__init__.py` (empty — makes `tests` importable as a package, matches nothing special but avoids pytest rootdir ambiguity)
- Create: `tests/conftest.py`
- Create: `tests/test_sync_token.py`
- Modify: `server.py` — add imports and `_resolve_sync_token` / `_config_sync_token` near the top, after the existing `DATA`/`BASE` setup (around line 13, right after `DATA.mkdir(exist_ok=True)`), before `app = Flask(...)`.

**Interfaces:**
- Produces: `server._resolve_sync_token() -> str | None` — reads `DASHBOARD_SYNC_ENABLED` env var; returns `None` if not `"true"`; otherwise returns the token (env `DASHBOARD_SYNC_TOKEN`, or `dashboard-config.json`'s `sync.token` key) or raises `SystemExit` if neither is set.
- Produces: `server.SYNC_TOKEN` — module-level value, `_resolve_sync_token()` evaluated once at import time. Later tasks' `require_token` decorator reads this **by name at call time** (not captured in a closure), so tests can do `monkeypatch.setattr(server, "SYNC_TOKEN", "...")` to simulate any state without re-importing the module.
- Consumes (later tasks): none.

- [ ] **Step 1: Install pytest into the project venv**

Run: `.venv/bin/pip install --quiet pytest`
Expected: exits 0, no output (quiet mode). Verify with `.venv/bin/python -c "import pytest; print(pytest.__version__)"` — should print a version like `8.x.x`.

- [ ] **Step 2: Create the test package files**

`tests/__init__.py`:
```python
```
(empty file)

`tests/conftest.py`:
```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
```

- [ ] **Step 3: Write the failing test for token resolution**

`tests/test_sync_token.py`:
```python
import json

import pytest

import server


def test_disabled_by_default(monkeypatch):
    monkeypatch.delenv("DASHBOARD_SYNC_ENABLED", raising=False)
    assert server._resolve_sync_token() is None


def test_enabled_true_case_sensitive_lowercase(monkeypatch):
    monkeypatch.setenv("DASHBOARD_SYNC_ENABLED", "TRUE")
    monkeypatch.delenv("DASHBOARD_SYNC_TOKEN", raising=False)
    monkeypatch.setattr(server, "BASE", server.BASE)  # no config file at BASE by default
    assert server._resolve_sync_token() is None


def test_enabled_reads_token_from_env(monkeypatch):
    monkeypatch.setenv("DASHBOARD_SYNC_ENABLED", "true")
    monkeypatch.setenv("DASHBOARD_SYNC_TOKEN", "abc123")
    assert server._resolve_sync_token() == "abc123"


def test_enabled_falls_back_to_config_file(monkeypatch, tmp_path):
    monkeypatch.setenv("DASHBOARD_SYNC_ENABLED", "true")
    monkeypatch.delenv("DASHBOARD_SYNC_TOKEN", raising=False)
    (tmp_path / "dashboard-config.json").write_text(
        json.dumps({"sync": {"token": "cfg-token"}}), encoding="utf-8"
    )
    monkeypatch.setattr(server, "BASE", tmp_path)
    assert server._resolve_sync_token() == "cfg-token"


def test_enabled_without_any_token_fails_fast(monkeypatch, tmp_path):
    monkeypatch.setenv("DASHBOARD_SYNC_ENABLED", "true")
    monkeypatch.delenv("DASHBOARD_SYNC_TOKEN", raising=False)
    monkeypatch.setattr(server, "BASE", tmp_path)  # no dashboard-config.json here
    with pytest.raises(SystemExit):
        server._resolve_sync_token()
```

Note on `test_enabled_true_case_sensitive_lowercase`: this documents that only the literal string `"true"` enables sync (matches the `"true"` string check used in `_resolve_sync_token`, mirroring how the codebase already checks `request.args.get("active") == "true"` in `get_sessions`).

- [ ] **Step 4: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_sync_token.py -v`
Expected: `ImportError` or `AttributeError: module 'server' has no attribute '_resolve_sync_token'` (function doesn't exist yet).

- [ ] **Step 5: Implement `_resolve_sync_token` in server.py**

In `server.py`, add `import hmac` and `import os` to the top imports (currently `json`, `threading`, `uuid`, `datetime`/`timezone`, `pathlib.Path`):

```python
import hmac
import json
import os
import threading
import uuid
```

Then, immediately after `DATA.mkdir(exist_ok=True)` (currently line 13) and before `app = Flask(__name__, static_folder=None)`:

```python
def _config_sync_token() -> str | None:
    try:
        config = json.loads((BASE / "dashboard-config.json").read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    return config.get("sync", {}).get("token")


def _resolve_sync_token() -> str | None:
    if os.environ.get("DASHBOARD_SYNC_ENABLED") != "true":
        return None
    token = os.environ.get("DASHBOARD_SYNC_TOKEN") or _config_sync_token()
    if not token:
        raise SystemExit(
            "DASHBOARD_SYNC_ENABLED=true but no token configured. "
            "Set DASHBOARD_SYNC_TOKEN or dashboard-config.json's 'sync.token'."
        )
    return token


SYNC_TOKEN = _resolve_sync_token()
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_sync_token.py -v`
Expected: 5 passed.

- [ ] **Step 7: Commit**

```bash
git add tests/__init__.py tests/conftest.py tests/test_sync_token.py server.py
git commit -m "feat: add sync token resolution (env var or config, opt-in via DASHBOARD_SYNC_ENABLED)"
```

---

### Task 2: `require_token` decorator + CORS namespace guard

**Files:**
- Modify: `server.py` — add `require_token` decorator after the `SYNC_TOKEN = _resolve_sync_token()` line from Task 1; modify the existing `_cors` function (search for `def _cors(resp):`).
- Create: `tests/test_sync_auth.py`

**Interfaces:**
- Consumes: `server.SYNC_TOKEN` (Task 1).
- Produces: `server.require_token` — a decorator for Flask view functions. On call: if `SYNC_TOKEN` is `None` → `503 {"error": "sync not enabled"}`. If `Authorization` header missing/malformed or token doesn't match → `401 {"error": "unauthorized"}` (logged via `app.logger.warning`). Otherwise calls the wrapped view.
- Produces (test-only route): none yet — this task tests the decorator against a throwaway route registered inside the test file itself, since no `/api/sync/*` routes exist until Task 4. This keeps Task 2 self-contained and avoids forward-referencing routes that don't exist yet.

- [ ] **Step 1: Write the failing test**

`tests/test_sync_auth.py`:
```python
import server


def _register_probe_route():
    if "sync_probe" not in server.app.view_functions:
        @server.app.route("/api/sync/__probe", methods=["GET"])
        @server.require_token
        def sync_probe():
            return {"ok": True}


def test_disabled_returns_503(monkeypatch):
    _register_probe_route()
    monkeypatch.setattr(server, "SYNC_TOKEN", None)
    client = server.app.test_client()
    resp = client.get("/api/sync/__probe", headers={"Authorization": "Bearer whatever"})
    assert resp.status_code == 503
    assert resp.get_json() == {"error": "sync not enabled"}


def test_missing_header_returns_401(monkeypatch):
    _register_probe_route()
    monkeypatch.setattr(server, "SYNC_TOKEN", "s3cr3t")
    client = server.app.test_client()
    resp = client.get("/api/sync/__probe")
    assert resp.status_code == 401
    assert resp.get_json() == {"error": "unauthorized"}


def test_wrong_token_returns_401(monkeypatch):
    _register_probe_route()
    monkeypatch.setattr(server, "SYNC_TOKEN", "s3cr3t")
    client = server.app.test_client()
    resp = client.get("/api/sync/__probe", headers={"Authorization": "Bearer nope"})
    assert resp.status_code == 401


def test_correct_token_returns_200(monkeypatch):
    _register_probe_route()
    monkeypatch.setattr(server, "SYNC_TOKEN", "s3cr3t")
    client = server.app.test_client()
    resp = client.get("/api/sync/__probe", headers={"Authorization": "Bearer s3cr3t"})
    assert resp.status_code == 200
    assert resp.get_json() == {"ok": True}


def test_sync_namespace_drops_cors_header(monkeypatch):
    _register_probe_route()
    monkeypatch.setattr(server, "SYNC_TOKEN", "s3cr3t")
    client = server.app.test_client()
    resp = client.get("/api/sync/__probe", headers={"Authorization": "Bearer s3cr3t"})
    assert "Access-Control-Allow-Origin" not in resp.headers


def test_local_namespace_keeps_cors_header():
    client = server.app.test_client()
    resp = client.get("/api/checklist")
    assert resp.headers.get("Access-Control-Allow-Origin") == "*"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_sync_auth.py -v`
Expected: `AttributeError: module 'server' has no attribute 'require_token'`.

- [ ] **Step 3: Implement `require_token` in server.py**

Add `import functools` to the imports:
```python
import functools
import hmac
import json
import os
import threading
import uuid
```

After `SYNC_TOKEN = _resolve_sync_token()` (end of Task 1's block):

```python
def require_token(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        if SYNC_TOKEN is None:
            return jsonify({"error": "sync not enabled"}), 503
        auth = request.headers.get("Authorization", "")
        prefix = "Bearer "
        supplied = auth[len(prefix):] if auth.startswith(prefix) else None
        if not supplied or not hmac.compare_digest(supplied, SYNC_TOKEN):
            app.logger.warning("sync auth failed from %s on %s", request.remote_addr, request.path)
            return jsonify({"error": "unauthorized"}), 401
        return fn(*args, **kwargs)
    return wrapper
```

- [ ] **Step 4: Update `_cors` to drop headers on `/api/sync/*`**

Find the existing `_cors` function:
```python
@app.after_request
def _cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp
```

Replace with:
```python
@app.after_request
def _cors(resp):
    if request.path.startswith("/api/sync/"):
        return resp
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_sync_auth.py -v`
Expected: 6 passed.

- [ ] **Step 6: Run the full suite so far**

Run: `.venv/bin/python -m pytest tests/ -v`
Expected: all tests from Task 1 and Task 2 pass (11 total).

- [ ] **Step 7: Commit**

```bash
git add server.py tests/test_sync_auth.py
git commit -m "feat: add require_token decorator and drop CORS headers on /api/sync/*"
```

---

### Task 3: Swagger `Sync` tag + `securityDefinitions`

**Files:**
- Modify: `server.py` — the `Swagger(app, template={...})` call (currently lines 18–32).

**Interfaces:**
- Consumes: none new.
- Produces: `/apidocs` now shows a `Sync` tag and a `bearerAuth` security scheme that Task 4's route docstrings reference via `security: [{bearerAuth: []}]`.

- [ ] **Step 1: Write the failing test**

`tests/test_swagger_docs.py`:
```python
import server


def test_apispec_declares_sync_tag_and_bearer_auth():
    client = server.app.test_client()
    resp = client.get("/apispec_1.json")
    assert resp.status_code == 200
    spec = resp.get_json()
    tag_names = [t["name"] for t in spec.get("tags", [])]
    assert "Sync" in tag_names
    assert "bearerAuth" in spec.get("securityDefinitions", {})
    assert spec["securityDefinitions"]["bearerAuth"]["type"] == "apiKey"
    assert spec["securityDefinitions"]["bearerAuth"]["name"] == "Authorization"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_swagger_docs.py -v`
Expected: FAIL — `"Sync" in tag_names` is `False` (tag not present yet).

- [ ] **Step 3: Update the Swagger template**

Find:
```python
Swagger(app, template={
    "info": {
        "title": "Dashboard API",
        "description": "REST API backing the personal dashboard (checklist, announcements, news, music).",
        "version": "1.0.0",
    },
    "tags": [
        {"name": "Checklist"},
        {"name": "Announcements"},
        {"name": "News"},
        {"name": "Music"},
        {"name": "Personal"},
        {"name": "Sessions"},
    ],
})
```

Replace with:
```python
Swagger(app, template={
    "info": {
        "title": "Dashboard API",
        "description": "REST API backing the personal dashboard (checklist, announcements, news, music).",
        "version": "1.0.0",
    },
    "tags": [
        {"name": "Checklist"},
        {"name": "Announcements"},
        {"name": "News"},
        {"name": "Music"},
        {"name": "Personal"},
        {"name": "Sessions"},
        {"name": "Sync"},
    ],
    "securityDefinitions": {
        "bearerAuth": {
            "type": "apiKey",
            "name": "Authorization",
            "in": "header",
            "description": "Pass as 'Bearer <token>'. Required for all /api/sync/* routes.",
        }
    },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_swagger_docs.py -v`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add server.py tests/test_swagger_docs.py
git commit -m "docs: add Sync tag and bearerAuth securityDefinition to Swagger"
```

---

### Task 4: `GET /api/sync/reports` and `GET /api/sync/reports/<name>`

**Files:**
- Modify: `server.py` — add `REPORTS_DIR` / `REPORTS_INDEX_PATH` constants near `DATA` (top of file); add a new `# ── Sync ──` section with two routes, placed after the `# ── Session Registry ─` section and before `# ── Static files ─` (i.e., right before `@app.route("/", defaults=...)`).
- Create: `tests/test_sync_reports.py`

**Interfaces:**
- Consumes: `server.require_token` (Task 2), `server._read` (existing helper, already used throughout `server.py`).
- Produces: `server.REPORTS_DIR: Path` (= `BASE / "reports"`), `server.REPORTS_INDEX_PATH: Path` (= `REPORTS_DIR / "reports-index.json"`). Later tasks don't consume these, but tests monkeypatch them for isolation — same pattern later tasks reuse for `DATA`.

- [ ] **Step 1: Write the failing tests**

`tests/test_sync_reports.py`:
```python
import json

import pytest

import server


@pytest.fixture
def client(tmp_path, monkeypatch):
    reports_dir = tmp_path / "reports"
    reports_dir.mkdir()
    monkeypatch.setattr(server, "REPORTS_DIR", reports_dir)
    monkeypatch.setattr(server, "REPORTS_INDEX_PATH", reports_dir / "reports-index.json")
    monkeypatch.setattr(server, "SYNC_TOKEN", "test-token")
    return server.app.test_client()


AUTH = {"Authorization": "Bearer test-token"}


def test_list_reports_returns_index_contents(client):
    index = [{"name": "foo", "file": "reports/foo.html", "title": "Foo", "mtime": "2026-01-01T00:00:00"}]
    server.REPORTS_INDEX_PATH.write_text(json.dumps(index), encoding="utf-8")
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
    server.REPORTS_INDEX_PATH.write_text(json.dumps(index), encoding="utf-8")
    server.REPORTS_DIR.joinpath("foo.html").write_text("<html>hi</html>", encoding="utf-8")
    resp = client.get("/api/sync/reports/foo", headers=AUTH)
    assert resp.status_code == 200
    assert b"hi" in resp.data


def test_get_report_unknown_name_returns_404(client):
    server.REPORTS_INDEX_PATH.write_text("[]", encoding="utf-8")
    resp = client.get("/api/sync/reports/does-not-exist", headers=AUTH)
    assert resp.status_code == 404
    assert resp.get_json() == {"error": "not found"}


def test_get_report_path_traversal_via_encoded_slash_is_rejected(client):
    index = [{"name": "foo", "file": "reports/foo.html", "title": "Foo", "mtime": "x"}]
    server.REPORTS_INDEX_PATH.write_text(json.dumps(index), encoding="utf-8")
    resp = client.get("/api/sync/reports/..%2f..%2fetc%2fpasswd", headers=AUTH)
    assert resp.status_code == 404


def test_get_report_name_not_matching_any_index_entry_cannot_read_arbitrary_file(client):
    # A file exists on disk but isn't listed in the index — must not be servable.
    index = []
    server.REPORTS_INDEX_PATH.write_text(json.dumps(index), encoding="utf-8")
    server.REPORTS_DIR.joinpath("secret.html").write_text("nope", encoding="utf-8")
    resp = client.get("/api/sync/reports/secret", headers=AUTH)
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_sync_reports.py -v`
Expected: FAIL — `404 NOT FOUND` from Flask routing (no `/api/sync/reports` route registered yet), since the route itself doesn't exist.

- [ ] **Step 3: Implement the routes**

Add constants right after the existing `DATA = BASE / "data"` / `DATA.mkdir(exist_ok=True)` lines (top of file, near line 12–13):

```python
DATA = BASE / "data"
DATA.mkdir(exist_ok=True)
REPORTS_DIR = BASE / "reports"
REPORTS_INDEX_PATH = REPORTS_DIR / "reports-index.json"
```

Add the new section in `server.py`, immediately before `# ── Static files ─` / `@app.route("/", defaults={"path": "dashboard-work.html"})`:

```python
# ── Sync (read-only, bearer-token auth, for aggregating multiple instances) ──

def _find_report(name: str) -> dict | None:
    for entry in _read(REPORTS_INDEX_PATH):
        if entry.get("name") == name:
            return entry
    return None


@app.route("/api/sync/reports", methods=["GET"])
@require_token
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
      503:
        description: Sync not enabled on this instance
    """
    return jsonify(_read(REPORTS_INDEX_PATH))


@app.route("/api/sync/reports/<name>", methods=["GET"])
@require_token
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
      503:
        description: Sync not enabled on this instance
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

- [ ] **Step 5: Run the full suite**

Run: `.venv/bin/python -m pytest tests/ -v`
Expected: all prior tests plus these 7 pass, none broken.

- [ ] **Step 6: Commit**

```bash
git add server.py tests/test_sync_reports.py
git commit -m "feat: add GET /api/sync/reports and /api/sync/reports/<name>"
```

---

### Task 5: `GET /api/sync/sessions` and `GET /api/sync/checklist`

**Files:**
- Modify: `server.py` — add two more routes in the same `# ── Sync ──` section from Task 4, after `sync_get_report`.
- Create: `tests/test_sync_sessions_checklist.py`

**Interfaces:**
- Consumes: `server.require_token` (Task 2), `server._read` (existing), `server.DATA` (existing constant).
- Produces: `GET /api/sync/sessions` → JSON array (same shape as `data/sessions-registry.json`). `GET /api/sync/checklist` → `{"checklist": [...], "personal_checklist": [...]}`.

- [ ] **Step 1: Write the failing tests**

`tests/test_sync_sessions_checklist.py`:
```python
import json

import pytest

import server


@pytest.fixture
def client(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setattr(server, "DATA", data_dir)
    monkeypatch.setattr(server, "SYNC_TOKEN", "test-token")
    return server.app.test_client()


AUTH = {"Authorization": "Bearer test-token"}


def test_sync_sessions_returns_registry_contents(client):
    server.DATA.joinpath("sessions-registry.json").write_text(
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


def test_sync_checklist_combines_both_lists(client):
    server.DATA.joinpath("checklist.json").write_text(
        json.dumps([{"id": "1", "text": "a", "checked": False}]), encoding="utf-8"
    )
    server.DATA.joinpath("personal-checklist.json").write_text(
        json.dumps([{"id": "2", "text": "b", "checked": True}]), encoding="utf-8"
    )
    resp = client.get("/api/sync/checklist", headers=AUTH)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body == {
        "checklist": [{"id": "1", "text": "a", "checked": False}],
        "personal_checklist": [{"id": "2", "text": "b", "checked": True}],
    }


def test_sync_checklist_empty_lists_when_files_missing(client):
    resp = client.get("/api/sync/checklist", headers=AUTH)
    assert resp.status_code == 200
    assert resp.get_json() == {"checklist": [], "personal_checklist": []}


def test_sync_checklist_requires_auth(client):
    resp = client.get("/api/sync/checklist")
    assert resp.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_sync_sessions_checklist.py -v`
Expected: FAIL — `404 NOT FOUND` (routes not registered yet).

- [ ] **Step 3: Implement the routes**

Append to the `# ── Sync ──` section in `server.py`, after `sync_get_report`:

```python
@app.route("/api/sync/sessions", methods=["GET"])
@require_token
def sync_sessions():
    """List registered sessions for sync.
    ---
    tags: [Sync]
    security:
      - bearerAuth: []
    responses:
      200:
        description: Same shape as GET /api/sessions
      401:
        description: Missing or invalid bearer token
      503:
        description: Sync not enabled on this instance
    """
    return jsonify(_read(DATA / "sessions-registry.json"))


@app.route("/api/sync/checklist", methods=["GET"])
@require_token
def sync_checklist():
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
      503:
        description: Sync not enabled on this instance
    """
    return jsonify({
        "checklist": _read(DATA / "checklist.json"),
        "personal_checklist": _read(DATA / "personal-checklist.json"),
    })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_sync_sessions_checklist.py -v`
Expected: 6 passed.

- [ ] **Step 5: Run the full suite**

Run: `.venv/bin/python -m pytest tests/ -v`
Expected: all tests across all files pass (30 total across Tasks 1–5).

- [ ] **Step 6: Commit**

```bash
git add server.py tests/test_sync_sessions_checklist.py
git commit -m "feat: add GET /api/sync/sessions and /api/sync/checklist"
```

---

### Task 6: Manual verification against a live server

This task has no automated test — it's a smoke check that the whole feature works end-to-end through the real Flask dev server, not just the test client, and that `/apidocs` renders correctly.

**Files:** none (verification only).

- [ ] **Step 1: Start the server with sync enabled**

```bash
DASHBOARD_SYNC_ENABLED=true DASHBOARD_SYNC_TOKEN=dev-secret .venv/bin/python server.py
```
Expected: starts cleanly on port 8765, no `SystemExit`.

- [ ] **Step 2: Confirm unauthenticated sync request is rejected**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8765/api/sync/sessions
```
Expected: `401`

- [ ] **Step 3: Confirm authenticated sync request succeeds**

```bash
curl -s -H "Authorization: Bearer dev-secret" http://localhost:8765/api/sync/checklist
```
Expected: `{"checklist": [...], "personal_checklist": [...]}` (real content from your local `data/` dir).

- [ ] **Step 4: Confirm existing local routes are unaffected**

```bash
curl -s -i http://localhost:8765/api/checklist | grep -i "access-control-allow-origin"
```
Expected: header present (`*`), proving CORS wasn't broken on the non-sync namespace.

- [ ] **Step 5: Confirm Swagger UI shows the Sync tag**

Open `http://localhost:8765/apidocs` in a browser (or `curl -s http://localhost:8765/apispec_1.json | grep -o '"Sync"'`) and confirm the `Sync` tag and its four endpoints are listed with a lock icon (bearer auth).

- [ ] **Step 6: Confirm the boot-time fail-fast works**

```bash
DASHBOARD_SYNC_ENABLED=true .venv/bin/python server.py
```
Expected: process exits immediately with the `SystemExit` message about missing token (no `DASHBOARD_SYNC_TOKEN` set in this shell). Stop the Step 1 server first (Ctrl-C) if still running, to avoid a stale process holding port 8765.

- [ ] **Step 7: Stop the dev server**

Ctrl-C the process from Step 1 (or Step 6, whichever is still running).

---

## Out of scope for this plan (explicitly, per the issue)

- **Cloudflare tunnel config** — mapping only `/api/sync/*` and `/apidocs` externally is an infra/ops change (cloudflared config, not part of this repo) and isn't automatable here.
- **POST/mirror-back sync routes** — v2 concern per the issue's non-goals; write-conflict resolution across instances is undesigned.
- **Rate limiting** — the issue accepts "rate-limit or at least log"; this plan implements logging only (`app.logger.warning` on every auth failure) to avoid pulling in a new dependency (e.g. Flask-Limiter) for a single-user tool exposed to a small, known set of aggregating instances.
- **Per-instance tokens** — the issue's own open question resolves to "one shared secret for all," which is what `DASHBOARD_SYNC_TOKEN` implements.
