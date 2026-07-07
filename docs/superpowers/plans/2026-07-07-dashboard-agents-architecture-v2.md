# Dashboard Agents Architecture v2 (Antigravity auto-parse, 3-page split) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single `dashboard.html` into Work/Personal/Agents pages with a shared nav bar, add namespaced personal data (checklist/announcements/news/music), and auto-detect Antigravity CLI (`agy`) sessions alongside Claude sessions in the Agents page's live session panel.

**Architecture:** Backend (`server.py`) gains generic per-resource CRUD helpers reused by both `/api/*` (work, unchanged paths) and new `/api/personal/*` routes, plus a `/api/sessions` registry for tools that can't self-report. `build-session-data.mjs` gains a second parser (`parseAntigravityTranscript`) that reads Antigravity's plain-jsonl transcript logs — no protobuf/SQLite involved. Frontend logic shared across pages (clock, session banner, config-driven section renderer, checklist/announcements/news/music widgets) is extracted from the current `dashboard.html` into `dashboard-common.js`, parameterized by a `data-tab` / `data-api-base` pair on its own `<script>` tag so each of the three thin page shells can reuse it without duplicating ~450 lines of JS three times.

**Tech Stack:** Flask + vanilla JS (no build step, no framework) — matches existing codebase exactly. No test framework exists in this repo; verification is manual `curl`/`node` runs per the design spec's Testing Plan (§11), not pytest — introducing a test framework is out of scope (YAGNI).

## Global Constraints

- **No git repository in this project** (confirmed: `is_git_repo: false`). Every task below ends with a "Mark task complete" step instead of a `git commit` step — do not run `git init` unless the user asks for it.
- Design spec: `docs/superpowers/specs/2026-07-07-dashboard-agents-architecture-v2-design.md` — every task below implements a section of it; read it if a step's rationale is unclear.
- Existing work API routes (`/api/checklist`, `/api/announcements`, `/api/news`, `/api/music`) must keep their exact current paths and JSON shapes — no breaking changes.
- `data/*.json` files are lazily created by `_read()`/`_write()` in `server.py` (missing file → `[]`, confirmed at `server.py:33-41`) — no task pre-creates `data/personal-*.json` or `data/sessions-registry.json`.
- Antigravity web entry point is `TBD` (confirmed with user: CLI-only tool today, no hosted URL) — every reference uses the literal string `TBD` or JSON `null`, not a placeholder to "fill in later."
- Server runs on `http://localhost:8765` (from `serve.sh` / `dashboard.service`) — all curl verification commands below target that.

---

### Task 1: Extract CRUD helpers in `server.py` (refactor, no behavior change)

**Files:**
- Modify: `server.py:33-189` (checklist + shared helpers), `server.py:192-298` (announcements), `server.py:301-445` (news), `server.py:448-559` (music)

**Interfaces:**
- Produces: `_list(filename, filter_fn=None)`, `_add(filename, item)`, `_patch(filename, item_id, mutate_fn)`, `_delete(filename, item_id)` — used by Task 2's personal routes and by the now-thin existing work route handlers.

This is a pure refactor: existing routes must return byte-identical responses before and after. It exists so Task 2 doesn't duplicate ~200 lines of checklist/announcements/news/music logic for the personal namespace.

- [ ] **Step 1: Capture current behavior with curl (baseline)**

Start the server in one terminal: `python3 server.py`. In another:

```bash
curl -s http://localhost:8765/api/checklist
curl -s -X POST http://localhost:8765/api/checklist -H 'Content-Type: application/json' -d '{"text":"baseline test item"}'
curl -s http://localhost:8765/api/checklist
```

Expected: first call returns current list (whatever's in `data/checklist.json` today), second returns `{"id": "...", "text": "baseline test item", "checked": false, "created_at": "..."}` with HTTP 201, third shows the new item appended. Note the returned `id` — you'll delete it at the end of Step 4 to leave `data/checklist.json` unchanged.

- [ ] **Step 2: Add generic helper functions**

In `server.py`, immediately after the existing `_write` function (after line 41), add:

```python
def _list(filename: str, filter_fn=None) -> list:
    items = _read(DATA / filename)
    if filter_fn:
        return [i for i in items if filter_fn(i)]
    return items


def _add(filename: str, item: dict) -> dict:
    with _lock:
        items = _read(DATA / filename)
        items.append(item)
        _write(DATA / filename, items)
    return item


def _add_first(filename: str, item: dict) -> dict:
    with _lock:
        items = _read(DATA / filename)
        items.insert(0, item)
        _write(DATA / filename, items)
    return item


def _patch(filename: str, item_id: str, mutate_fn):
    with _lock:
        items = _read(DATA / filename)
        for item in items:
            if item["id"] == item_id:
                mutate_fn(item)
                _write(DATA / filename, items)
                return item
    return None


def _delete(filename: str, item_id: str) -> bool:
    with _lock:
        items = _read(DATA / filename)
        new_items = [i for i in items if i["id"] != item_id]
        if len(new_items) == len(items):
            return False
        _write(DATA / filename, new_items)
        return True
```

- [ ] **Step 3: Rewire existing route bodies to call the helpers (behavior-preserving)**

Replace the body of `add_checklist` (`server.py:114-128`) — keep the docstring, change only the code after it:

```python
    body = request.get_json(force=True) or {}
    text = str(body.get("text", "")).strip()
    if not text:
        return jsonify({"error": "text required"}), 400
    item = {
        "id": uuid.uuid4().hex[:8],
        "text": text,
        "checked": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return jsonify(_add("checklist.json", item)), 201
```

Replace the body of `patch_checklist` (`server.py:156-164`):

```python
    body = request.get_json(force=True) or {}
    def mutate(item):
        item["checked"] = bool(body["checked"]) if "checked" in body else not item.get("checked", False)
    item = _patch("checklist.json", item_id, mutate)
    if item is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(item)
```

Replace the body of `delete_checklist` (`server.py:183-189`):

```python
    if not _delete("checklist.json", item_id):
        return jsonify({"error": "not found"}), 404
    return "", 204
```

Replace the body of `get_checklist` (`server.py:87`):

```python
    return jsonify(_list("checklist.json"))
```

Repeat the same pattern for announcements — replace `get_announcements` body (`server.py:225`):

```python
    return jsonify(_list("announcements.json", lambda i: not i.get("dismissed")))
```

Replace `add_announcement` body (`server.py:255-270`):

```python
    body = request.get_json(force=True) or {}
    text = str(body.get("text", "")).strip()
    if not text:
        return jsonify({"error": "text required"}), 400
    item = {
        "id": uuid.uuid4().hex[:8],
        "text": text,
        "source": str(body.get("source", "manual")),
        "dismissed": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return jsonify(_add("announcements.json", item)), 201
```

Replace `dismiss_announcement` body (`server.py:291-298`):

```python
    item = _patch("announcements.json", item_id, lambda i: i.__setitem__("dismissed", True))
    if item is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(item)
```

For news — replace `get_news` body (`server.py:338`):

```python
    return jsonify(_list("news.json"))
```

Replace `add_news` body (`server.py:375-392`):

```python
    body = request.get_json(force=True) or {}
    title = str(body.get("title", "")).strip()
    url = str(body.get("url", "")).strip()
    if not title or not url:
        return jsonify({"error": "title and url required"}), 400
    item = {
        "id": uuid.uuid4().hex[:8],
        "title": title,
        "url": url,
        "source": str(body.get("source", "")),
        "date": str(body.get("date", datetime.now(timezone.utc).date().isoformat())),
        "read": False,
    }
    return jsonify(_add_first("news.json", item)), 201
```

Replace `delete_news` body (`server.py:411-417`):

```python
    if not _delete("news.json", item_id):
        return jsonify({"error": "not found"}), 404
    return "", 204
```

Replace `mark_news_read` body (`server.py:438-445`):

```python
    item = _patch("news.json", item_id, lambda i: i.__setitem__("read", True))
    if item is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(item)
```

For music — replace `get_music` body (`server.py:482`):

```python
    return jsonify(_list("music.json"))
```

Replace `add_music` body (`server.py:518-534`):

```python
    body = request.get_json(force=True) or {}
    title = str(body.get("title", "")).strip()
    url = str(body.get("url", "")).strip()
    if not title or not url:
        return jsonify({"error": "title and url required"}), 400
    item = {
        "id": uuid.uuid4().hex[:8],
        "title": title,
        "url": url,
        "artist": str(body.get("artist", "")),
        "icon": str(body.get("icon", "🎵")),
    }
    return jsonify(_add("music.json", item)), 201
```

Replace `delete_music` body (`server.py:553-559`):

```python
    if not _delete("music.json", item_id):
        return jsonify({"error": "not found"}), 404
    return "", 204
```

- [ ] **Step 4: Re-run the same curl commands, verify identical output**

Restart the server (`Ctrl+C`, then `python3 server.py` again), re-run:

```bash
curl -s http://localhost:8765/api/checklist
```

Expected: same list as Step 1's third call (helper refactor didn't change the file). Clean up the baseline test item:

```bash
curl -s -X DELETE http://localhost:8765/api/checklist/<id-from-step-1>
curl -s http://localhost:8765/api/checklist
```

Expected: 204, then list no longer contains "baseline test item".

- [ ] **Step 5: Mark task complete**

No git repo — just check the box above and move to Task 2.

---

### Task 2: Personal API routes (`server.py`)

**Files:**
- Modify: `server.py` — insert new section after the Music section (after line 559, before "Static files" comment at line 562)

**Interfaces:**
- Consumes: `_list`, `_add`, `_add_first`, `_patch`, `_delete` from Task 1.
- Produces: `GET/POST/PATCH/DELETE /api/personal/checklist`, `GET/POST/PATCH /api/personal/announcements`, `GET/POST/DELETE/PATCH /api/personal/news`, `GET/POST/DELETE /api/personal/music` — same JSON shapes as their work equivalents.

- [ ] **Step 1: Write curl checks against not-yet-existing routes**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8765/api/personal/checklist
```

Expected: `404` (route doesn't exist yet).

- [ ] **Step 2: Add the personal routes**

In `server.py`, insert this whole block after line 559 (end of Music section) and before the `# ── Static files ──` comment:

```python
# ── Personal Checklist ───────────────────────────────────────────────────────

@app.route("/api/personal/checklist", methods=["GET"])
def get_personal_checklist():
    """Get all personal checklist items.
    ---
    tags: [Personal]
    responses:
      200:
        description: List of checklist items
        schema:
          type: array
          items:
            $ref: '#/definitions/ChecklistItem'
    """
    return jsonify(_list("personal-checklist.json"))


@app.route("/api/personal/checklist", methods=["POST"])
def add_personal_checklist():
    """Add a personal checklist item.
    ---
    tags: [Personal]
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
    responses:
      201:
        description: Created item
      400:
        description: text required
    """
    body = request.get_json(force=True) or {}
    text = str(body.get("text", "")).strip()
    if not text:
        return jsonify({"error": "text required"}), 400
    item = {
        "id": uuid.uuid4().hex[:8],
        "text": text,
        "checked": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return jsonify(_add("personal-checklist.json", item)), 201


@app.route("/api/personal/checklist/<item_id>", methods=["PATCH"])
def patch_personal_checklist(item_id):
    """Toggle or set checked state of a personal checklist item.
    ---
    tags: [Personal]
    parameters:
      - in: path
        name: item_id
        type: string
        required: true
    responses:
      200:
        description: Updated item
      404:
        description: Not found
    """
    body = request.get_json(force=True) or {}
    def mutate(item):
        item["checked"] = bool(body["checked"]) if "checked" in body else not item.get("checked", False)
    item = _patch("personal-checklist.json", item_id, mutate)
    if item is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(item)


@app.route("/api/personal/checklist/<item_id>", methods=["DELETE"])
def delete_personal_checklist(item_id):
    """Delete a personal checklist item.
    ---
    tags: [Personal]
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
    """
    if not _delete("personal-checklist.json", item_id):
        return jsonify({"error": "not found"}), 404
    return "", 204


# ── Personal Announcements ───────────────────────────────────────────────────

@app.route("/api/personal/announcements", methods=["GET"])
def get_personal_announcements():
    """Get all non-dismissed personal announcements.
    ---
    tags: [Personal]
    responses:
      200:
        description: List of active announcements
    """
    return jsonify(_list("personal-announcements.json", lambda i: not i.get("dismissed")))


@app.route("/api/personal/announcements", methods=["POST"])
def add_personal_announcement():
    """Add a personal announcement.
    ---
    tags: [Personal]
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
            source:
              type: string
    responses:
      201:
        description: Created announcement
      400:
        description: text required
    """
    body = request.get_json(force=True) or {}
    text = str(body.get("text", "")).strip()
    if not text:
        return jsonify({"error": "text required"}), 400
    item = {
        "id": uuid.uuid4().hex[:8],
        "text": text,
        "source": str(body.get("source", "manual")),
        "dismissed": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return jsonify(_add("personal-announcements.json", item)), 201


@app.route("/api/personal/announcements/<item_id>/dismiss", methods=["PATCH"])
def dismiss_personal_announcement(item_id):
    """Dismiss a personal announcement.
    ---
    tags: [Personal]
    parameters:
      - in: path
        name: item_id
        type: string
        required: true
    responses:
      200:
        description: Dismissed announcement
      404:
        description: Not found
    """
    item = _patch("personal-announcements.json", item_id, lambda i: i.__setitem__("dismissed", True))
    if item is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(item)


# ── Personal News ────────────────────────────────────────────────────────────

@app.route("/api/personal/news", methods=["GET"])
def get_personal_news():
    """Get all personal news articles.
    ---
    tags: [Personal]
    responses:
      200:
        description: List of articles, newest first
    """
    return jsonify(_list("personal-news.json"))


@app.route("/api/personal/news", methods=["POST"])
def add_personal_news():
    """Add a personal news article.
    ---
    tags: [Personal]
    parameters:
      - in: body
        name: body
        required: true
        schema:
          type: object
          required: [title, url]
          properties:
            title:
              type: string
            url:
              type: string
            source:
              type: string
            date:
              type: string
    responses:
      201:
        description: Created article
      400:
        description: title and url required
    """
    body = request.get_json(force=True) or {}
    title = str(body.get("title", "")).strip()
    url = str(body.get("url", "")).strip()
    if not title or not url:
        return jsonify({"error": "title and url required"}), 400
    item = {
        "id": uuid.uuid4().hex[:8],
        "title": title,
        "url": url,
        "source": str(body.get("source", "")),
        "date": str(body.get("date", datetime.now(timezone.utc).date().isoformat())),
        "read": False,
    }
    return jsonify(_add_first("personal-news.json", item)), 201


@app.route("/api/personal/news/<item_id>", methods=["DELETE"])
def delete_personal_news(item_id):
    """Delete a personal news article.
    ---
    tags: [Personal]
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
    """
    if not _delete("personal-news.json", item_id):
        return jsonify({"error": "not found"}), 404
    return "", 204


@app.route("/api/personal/news/<item_id>/read", methods=["PATCH"])
def mark_personal_news_read(item_id):
    """Mark a personal news article as read.
    ---
    tags: [Personal]
    parameters:
      - in: path
        name: item_id
        type: string
        required: true
    responses:
      200:
        description: Updated article
      404:
        description: Not found
    """
    item = _patch("personal-news.json", item_id, lambda i: i.__setitem__("read", True))
    if item is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(item)


# ── Personal Music ───────────────────────────────────────────────────────────

@app.route("/api/personal/music", methods=["GET"])
def get_personal_music():
    """Get all personal music links.
    ---
    tags: [Personal]
    responses:
      200:
        description: List of music links
    """
    return jsonify(_list("personal-music.json"))


@app.route("/api/personal/music", methods=["POST"])
def add_personal_music():
    """Add a personal music link.
    ---
    tags: [Personal]
    parameters:
      - in: body
        name: body
        required: true
        schema:
          type: object
          required: [title, url]
          properties:
            title:
              type: string
            url:
              type: string
            artist:
              type: string
            icon:
              type: string
    responses:
      201:
        description: Created music link
      400:
        description: title and url required
    """
    body = request.get_json(force=True) or {}
    title = str(body.get("title", "")).strip()
    url = str(body.get("url", "")).strip()
    if not title or not url:
        return jsonify({"error": "title and url required"}), 400
    item = {
        "id": uuid.uuid4().hex[:8],
        "title": title,
        "url": url,
        "artist": str(body.get("artist", "")),
        "icon": str(body.get("icon", "🎵")),
    }
    return jsonify(_add("personal-music.json", item)), 201


@app.route("/api/personal/music/<item_id>", methods=["DELETE"])
def delete_personal_music(item_id):
    """Delete a personal music link.
    ---
    tags: [Personal]
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
    """
    if not _delete("personal-music.json", item_id):
        return jsonify({"error": "not found"}), 404
    return "", 204
```

Also register the `Personal` tag in the `Swagger(...)` call near the top of the file (`server.py:24-29`) — add `{"name": "Personal"}` to the `"tags"` list.

- [ ] **Step 3: Re-run curl, verify routes now work and are isolated from work data**

Restart the server, then:

```bash
curl -s http://localhost:8765/api/personal/checklist
# Expected: []  (new file, empty)

curl -s -X POST http://localhost:8765/api/personal/checklist -H 'Content-Type: application/json' -d '{"text":"buy groceries"}'
# Expected: 201, {"id": "...", "text": "buy groceries", "checked": false, "created_at": "..."}

curl -s http://localhost:8765/api/checklist
# Expected: unchanged — "buy groceries" must NOT appear here (proves namespace isolation)

ls data/personal-checklist.json
# Expected: file now exists
```

- [ ] **Step 4: Mark task complete**

---

### Task 3: Session Registry API (`server.py`)

**Files:**
- Modify: `server.py` — insert after the Personal Music section from Task 2, still before `# ── Static files ──`

**Interfaces:**
- Produces: `GET /api/sessions` (supports `?active=true`), `POST /api/sessions`, `PATCH /api/sessions/:id`, `DELETE /api/sessions/:id`. Stored shape: `{id, provider, name, notes, status, started_at, ended_at}`.

- [ ] **Step 1: Write curl check against not-yet-existing route**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8765/api/sessions
```

Expected: `404`.

- [ ] **Step 2: Add the registry routes**

Insert after the Personal Music block, still before `# ── Static files ──`:

```python
# ── Session Registry (manual sessions: Edgar, other) ─────────────────────────

@app.route("/api/sessions", methods=["GET"])
def get_sessions():
    """List manually registered sessions.
    ---
    tags: [Sessions]
    parameters:
      - in: query
        name: active
        type: string
        required: false
    responses:
      200:
        description: List of registered sessions
    """
    sessions = _read(DATA / "sessions-registry.json")
    if request.args.get("active") == "true":
        sessions = [s for s in sessions if s.get("status") != "ended"]
    return jsonify(sessions)


@app.route("/api/sessions", methods=["POST"])
def add_session():
    """Register a manual session.
    ---
    tags: [Sessions]
    parameters:
      - in: body
        name: body
        required: true
        schema:
          type: object
          required: [provider, name]
          properties:
            provider:
              type: string
              example: edgar
            name:
              type: string
            notes:
              type: string
    responses:
      201:
        description: Registered session
      400:
        description: provider and name required
    """
    body = request.get_json(force=True) or {}
    provider = str(body.get("provider", "")).strip()
    name = str(body.get("name", "")).strip()
    if not provider or not name:
        return jsonify({"error": "provider and name required"}), 400
    item = {
        "id": uuid.uuid4().hex[:8],
        "provider": provider,
        "name": name,
        "notes": str(body.get("notes", "")),
        "status": "active",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "ended_at": None,
    }
    return jsonify(_add("sessions-registry.json", item)), 201


@app.route("/api/sessions/<item_id>", methods=["PATCH"])
def patch_session(item_id):
    """Update a registered session (status/notes).
    ---
    tags: [Sessions]
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
            status:
              type: string
            notes:
              type: string
    responses:
      200:
        description: Updated session
      404:
        description: Not found
    """
    body = request.get_json(force=True) or {}
    def mutate(item):
        if "status" in body:
            item["status"] = body["status"]
            if body["status"] == "ended":
                item["ended_at"] = datetime.now(timezone.utc).isoformat()
        if "notes" in body:
            item["notes"] = body["notes"]
    item = _patch("sessions-registry.json", item_id, mutate)
    if item is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(item)


@app.route("/api/sessions/<item_id>", methods=["DELETE"])
def delete_session(item_id):
    """Remove a registered session entry.
    ---
    tags: [Sessions]
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
    """
    if not _delete("sessions-registry.json", item_id):
        return jsonify({"error": "not found"}), 404
    return "", 204
```

Add `{"name": "Sessions"}` to the Swagger `"tags"` list alongside `"Personal"`.

- [ ] **Step 3: Verify full CRUD roundtrip**

```bash
curl -s -X POST http://localhost:8765/api/sessions -H 'Content-Type: application/json' -d '{"provider":"edgar","name":"test run","notes":"testing registry"}'
# Expected: 201, note the returned "id"

curl -s http://localhost:8765/api/sessions?active=true
# Expected: array containing the session just created, status "active"

curl -s -X PATCH http://localhost:8765/api/sessions/<id> -H 'Content-Type: application/json' -d '{"status":"ended"}'
# Expected: 200, "status":"ended", "ended_at" now set

curl -s http://localhost:8765/api/sessions?active=true
# Expected: empty array (session no longer active)

curl -s -X DELETE http://localhost:8765/api/sessions/<id>
# Expected: 204
```

- [ ] **Step 4: Mark task complete**

---

### Task 4: Antigravity session auto-parsing (`build-session-data.mjs`)

**Files:**
- Modify: `build-session-data.mjs`

**Interfaces:**
- Produces: `parseAntigravityTranscript(brainDir, historyMap)` returning the same session-object shape as `parseTranscript`, plus `provider: "claude"` added to `parseTranscript`'s existing return value. Both feed into the same `sessions` array written to `session-data.json`.

- [ ] **Step 1: Run the script once to capture baseline output**

```bash
node build-session-data.mjs
python3 -c "import json; d=json.load(open('session-data.json')); print(len(d['sessions'])); print(d['sessions'][0] if d['sessions'] else None)"
```

Expected: some number of Claude sessions, none with a `provider` field yet (field doesn't exist).

- [ ] **Step 2: Add `provider: "claude"` to the Claude parser**

In `build-session-data.mjs`, modify the `session` object literal at the top of `parseTranscript` (`build-session-data.mjs:17-25`):

```javascript
  const session = {
    session_id: basename(filePath, '.jsonl'),
    provider: 'claude',
    name: null, cwd: null, rc_url: null,
    first_active: null, last_active: null,
    git_branch: null, model: null,
    last_prompt: null,
    ctx_tokens: 0, ctx_pct: 0,
    total_turns: 0,
  };
```

- [ ] **Step 3: Add the Antigravity constants and history-map loader**

After the existing constants (`build-session-data.mjs:9-14`), add:

```javascript
const ANTIGRAVITY_DIR = join(homedir(), '.gemini', 'antigravity-cli');
const ANTIGRAVITY_BRAIN_DIR = join(ANTIGRAVITY_DIR, 'brain');
const ANTIGRAVITY_HISTORY_FILE = join(ANTIGRAVITY_DIR, 'history.jsonl');
```

After the `parseTranscript` function (after its closing `}` and before `function loadHookSessions()`), add:

```javascript
function loadAntigravityHistoryMap() {
  const map = {};
  let lines;
  try { lines = readFileSync(ANTIGRAVITY_HISTORY_FILE, 'utf8').split('\n'); }
  catch { return map; }
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.conversationId && obj.workspace) map[obj.conversationId] = obj.workspace;
  }
  return map;
}

async function parseAntigravityTranscript(brainDir, historyMap) {
  const sessionId = basename(brainDir);
  const transcriptPath = join(brainDir, '.system_generated', 'logs', 'transcript.jsonl');
  const session = {
    session_id: sessionId,
    provider: 'antigravity',
    name: null,
    cwd: historyMap[sessionId] || null,
    rc_url: null,
    first_active: null, last_active: null,
    git_branch: null, model: null,
    last_prompt: null,
    ctx_tokens: 0, ctx_pct: 0,
    total_turns: 0,
  };

  try {
    const rl = createInterface({ input: createReadStream(transcriptPath), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }

      if (obj.created_at) {
        if (!session.first_active) session.first_active = obj.created_at;
        session.last_active = obj.created_at;
      }

      if (obj.source === 'USER_EXPLICIT' && obj.type === 'USER_INPUT' && obj.content) {
        const inner = obj.content.replace(/^<USER_REQUEST>\n?/, '').replace(/\n?<\/USER_REQUEST>[\s\S]*$/, '');
        if (inner.trim()) {
          session.last_prompt = inner.slice(0, 160).replace(/\n+/g, ' ').trim();
          session.total_turns++;
        }
      }
    }
  } catch { /* unreadable file or missing transcript */ }

  return session;
}
```

- [ ] **Step 4: Wire the Antigravity scan into `main()`**

In `main()`, after the existing Claude project-directory loop and before `sessions.sort(...)` (`build-session-data.mjs:154-156`), add:

```javascript
  const antigravityHistoryMap = loadAntigravityHistoryMap();
  let brainDirs;
  try { brainDirs = readdirSync(ANTIGRAVITY_BRAIN_DIR); } catch { brainDirs = []; }
  for (const dir of brainDirs) {
    const brainPath = join(ANTIGRAVITY_BRAIN_DIR, dir);
    let stat;
    try { stat = statSync(brainPath); } catch { continue; }
    if (!stat.isDirectory()) continue;

    const s = await parseAntigravityTranscript(brainPath, antigravityHistoryMap);
    if (!s.last_active) continue;
    if (new Date(s.last_active) < cutoff) continue;

    const age = Date.now() - new Date(s.last_active).getTime();
    s.active = age < 2 * 3600_000;
    s.ended = null;

    sessions.push(s);
  }
```

- [ ] **Step 5: Run the script, verify Antigravity sessions appear**

```bash
node build-session-data.mjs
python3 -c "
import json
d = json.load(open('session-data.json'))
ag = [s for s in d['sessions'] if s['provider'] == 'antigravity']
cl = [s for s in d['sessions'] if s['provider'] == 'claude']
print('claude:', len(cl), 'antigravity:', len(ag))
if ag:
    s = ag[0]
    print('sample antigravity session:', s['session_id'], '| cwd:', s['cwd'], '| active:', s['active'], '| last_prompt:', s['last_prompt'])
"
```

Expected: both `claude` and `antigravity` counts > 0 (given this machine's data), sample session has a non-null `session_id`, `cwd` populated where `history.jsonl` had a matching entry, `last_prompt` a short trimmed string with no `<USER_REQUEST>` tags in it.

- [ ] **Step 6: Mark task complete**

---

### Task 5: `dashboard-config.json` — tab fields, personal sections, agents section update

**Files:**
- Modify: `dashboard-config.json` (live, gitignored)
- Modify: `dashboard-config.example.json` (committed template — keep in sync)

**Interfaces:**
- Produces: every section object gains `"tab"` (`"work" | "personal" | "agents"`); new sections `personal-checklist`, `personal-announcements`, `personal-news`, `personal-music` (tab `"personal"`); `home` and `gaming` move to tab `"personal"`; `agents` section (existing links list) moves to tab `"agents"` and gains an Antigravity entry; new section `agent-sessions` (tab `"agents"`, `type: "agent-sessions"`) for Task 10's Panel 2+3.

- [ ] **Step 1: Add `"tab": "work"` to the 10 sections staying on the Work page**

In `dashboard-config.json`, add `"tab": "work"` to each of: `checklist`, `announcements`, `code`, `work`, `wip`, `data`, `infra`, `reports`, `news`, `music`. Example for `checklist` (`dashboard-config.json:26-32`):

```json
    {
      "id": "checklist",
      "type": "checklist",
      "label": "Checklist do dia",
      "accent": "checklist",
      "tab": "work",
      "grid": { "col": "1 / 7", "row": "2" }
    },
```

Repeat identically (add `"tab": "work",` right after `"accent"` or `"label"`, whichever the section has) for `announcements`, `code`, `work`, `wip`, `data`, `infra`, `reports`, `news`, `music`.

- [ ] **Step 2: Move `home` and `gaming` to the Personal tab with new grid coordinates**

Replace the `home` section (`dashboard-config.json:104-113`):

```json
    {
      "id": "home",
      "label": "Home",
      "accent": "home",
      "tab": "personal",
      "grid": { "col": "1 / 7", "row": "3" },
      "links": [
        { "icon": "🏠", "name": "Daily Management", "url": "https://www.notion.so/Daily-Management-235294f28d9780a78b12eee8a92bc09d?pvs=12" },
        { "icon": "🤖", "name": "Reddit",           "url": "https://www.reddit.com/" }
      ]
    },
```

Replace the `gaming` section (`dashboard-config.json:114-124`):

```json
    {
      "id": "gaming",
      "label": "Gaming",
      "accent": "gaming",
      "tab": "personal",
      "grid": { "col": "7 / 13", "row": "3" },
      "links": [
        { "icon": "🎮", "name": "Playline", "url": "https://www.notion.so/Gaming-Playline-300294f28d978042a699d354d0c17a34?showMoveTo=true" },
        { "icon": "📡", "name": "Twitch",   "url": "https://www.twitch.tv/" },
        { "icon": "💬", "name": "Discord",  "url": "https://discord.com/channels/795244159211405323/813003465856516126" }
      ]
    },
```

- [ ] **Step 3: Add the four new Personal sections**

Add these four objects to the `sections` array (any position — grid placement, not array order, controls layout):

```json
    {
      "id": "personal-checklist",
      "type": "checklist",
      "label": "Personal Checklist",
      "accent": "checklist",
      "tab": "personal",
      "grid": { "col": "1 / 7", "row": "2" }
    },
    {
      "id": "personal-announcements",
      "type": "announcements",
      "label": "Personal Announcements",
      "accent": "announcements",
      "tab": "personal",
      "grid": { "col": "7 / 13", "row": "2" }
    },
    {
      "id": "personal-news",
      "type": "news",
      "label": "Personal News",
      "accent": "news",
      "tab": "personal",
      "grid": { "col": "1 / 9", "row": "1" }
    },
    {
      "id": "personal-music",
      "type": "music",
      "label": "Personal Music",
      "accent": "music",
      "tab": "personal",
      "grid": { "col": "9 / 13", "row": "1" }
    },
```

- [ ] **Step 4: Update the `agents` section (moves to Agents page, gains Antigravity link)**

Replace the `agents` section (`dashboard-config.json:40-53`):

```json
    {
      "id": "agents",
      "label": "Agent Tools",
      "accent": "agents",
      "tab": "agents",
      "grid": { "col": "1 / 13", "row": "1" },
      "links": [
        { "icon": "◈",  "name": "Claude",           "url": "https://claude.ai/new" },
        { "icon": "🪐", "name": "Antigravity",       "url": null },
        { "icon": "⚡", "name": "Edgar",            "url": "https://edgar.dig-in.io/" },
        { "icon": "🌀", "name": "Spinnable",        "url": "https://www.spinnable.ai/" },
        { "icon": "✦",  "name": "Gemini",           "url": "https://gemini.google.com/" },
        { "icon": "⚡", "name": "Skills Dashboard", "url": "skills.html" },
        { "icon": "◈",  "name": "Sessions",         "url": "session-dashboard.html" }
      ]
    },
```

(`url: null` for Antigravity: `renderSection`'s links filter in Task 7 already treats falsy `url` as "don't render a clickable link" — no code change needed there, verify in Task 7 Step 2.)

- [ ] **Step 5: Add the `agent-sessions` section (Task 10's Panel 2+3 container)**

Add:

```json
    {
      "id": "agent-sessions",
      "type": "agent-sessions",
      "label": "Active Sessions",
      "accent": "agents",
      "tab": "agents",
      "grid": { "col": "1 / 13", "row": "2" }
    },
```

- [ ] **Step 6: Repeat all edits in `dashboard-config.example.json`**

Apply the identical changes to `dashboard-config.example.json` (same section list, same `tab` additions, same new sections) so the committed template stays in sync with the live config. Use `Filipe`'s existing name/locale in that file — do not change `user` block values there.

- [ ] **Step 7: Validate JSON syntax**

```bash
python3 -c "import json; json.load(open('dashboard-config.json')); print('OK')"
python3 -c "import json; json.load(open('dashboard-config.example.json')); print('OK')"
```

Expected: `OK` printed twice, no `JSONDecodeError`.

- [ ] **Step 8: Mark task complete**

---

### Task 6: `nav.js` — shared top nav bar

**Files:**
- Create: `nav.js`

**Interfaces:**
- Produces: `renderNav(activeTab)` — global function, called by `dashboard-common.js` (Task 7) once config has loaded.

- [ ] **Step 1: Write `nav.js`**

```javascript
function renderNav(activeTab) {
  const tabs = [
    { id: 'work',     label: 'Work',     accent: '#4a9eff', href: 'dashboard-work.html' },
    { id: 'personal', label: 'Personal', accent: '#f59e0b', href: 'dashboard-personal.html' },
    { id: 'agents',   label: 'Agents',   accent: '#a78bfa', href: 'dashboard-agents.html' },
  ];

  const style = document.createElement('style');
  style.id = 'nav-style';
  style.textContent = `
    #top-nav {
      display: flex; gap: 4px;
      padding: 8px 40px 0;
      max-width: 1280px; margin: 0 auto;
    }
    .nav-tab {
      font-family: 'DM Mono', monospace;
      font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase;
      color: var(--muted, #5a6070);
      text-decoration: none;
      padding: 8px 16px;
      border-radius: 8px 8px 0 0;
      border: 1px solid transparent;
      border-bottom: none;
      transition: color 0.15s, background 0.15s;
    }
    .nav-tab:hover { color: var(--text, #e8eaf0); }
    .nav-tab.on {
      color: var(--tab-accent);
      background: var(--surface, #13161b);
      border-color: var(--border, rgba(255,255,255,0.06));
    }
  `;
  document.head.appendChild(style);

  const nav = document.createElement('nav');
  nav.id = 'top-nav';
  nav.innerHTML = tabs.map(t =>
    `<a href="${t.href}" class="nav-tab${t.id === activeTab ? ' on' : ''}" style="--tab-accent:${t.accent}">${t.label}</a>`
  ).join('');
  document.body.insertBefore(nav, document.body.firstChild);
}
```

- [ ] **Step 2: Verify in isolation**

```bash
python3 -c "
import re
src = open('nav.js').read()
assert 'function renderNav(activeTab)' in src
assert src.count('dashboard-work.html') == 1
assert src.count('dashboard-personal.html') == 1
assert src.count('dashboard-agents.html') == 1
print('OK')
"
```

Expected: `OK`. Full visual verification happens in Task 8-10 once a page actually calls `renderNav`.

- [ ] **Step 3: Mark task complete**

---

### Task 7: `dashboard-common.js` — shared page logic extracted from `dashboard.html`

**Files:**
- Create: `dashboard-common.js`
- Reference (read-only, do not modify yet): `dashboard.html:552-1017` (source of the extraction)

**Interfaces:**
- Consumes: `renderNav(activeTab)` from Task 6 (nav.js must load before this script).
- Consumes (own script tag's `dataset`): `data-tab` (`"work" | "personal" | "agents"`), `data-api-base` (`""` or `"/personal"`).
- Produces: boots itself on `DOMContentLoaded` — no exported functions needed by other files, but `escHtml`/`escAttr` become globals other inline page scripts (Task 10) reuse.

- [ ] **Step 1: Create `dashboard-common.js` with the extracted + parameterized logic**

```javascript
// ── Page config (read from this script's own tag) ──────────────────────────
const PAGE_TAB = document.currentScript.dataset.tab || 'work';
const API_BASE = document.currentScript.dataset.apiBase || '';

// ── Locale ──────────────────────────────────────────────────────────────
const LOCALE_DATA = {
  pt: {
    days:      ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'],
    months:    ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'],
    dateFmt:   (day, date, month, year) => `${day}, ${date} de ${month} de ${year}`,
    tips:      ['Semana começa amanhã.','Bom trabalho, segunda!','Quarta-feira, meio da semana.','Já passou do meio!','Sexta está perto.','Fim de semana! 🎉','Descansas, mereces.'],
    greetings: ['Bom dia.','Boa tarde.','Boa noite.'],
  },
  en: {
    days:      ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
    months:    ['January','February','March','April','May','June','July','August','September','October','November','December'],
    dateFmt:   (day, date, month, year) => `${day}, ${month} ${date}, ${year}`,
    tips:      ['Week starts tomorrow.','Good work, Monday!','Hump day.','Past the middle!','Friday is near.','Weekend! 🎉','Rest, you deserve it.'],
    greetings: ['Good morning.','Good afternoon.','Good evening.'],
  },
};

let appLocale = 'pt';
let appCity   = 'Lisboa';
let appName   = '';

function pad(n) { return String(n).padStart(2, '0'); }

function tick() {
  const now = new Date();
  const h = pad(now.getHours()), m = pad(now.getMinutes());
  document.getElementById('clock').textContent = `${h}:${m}`;

  const L = LOCALE_DATA[appLocale] || LOCALE_DATA.pt;
  const day   = L.days[now.getDay()];
  const month = L.months[now.getMonth()];
  document.getElementById('dateline').textContent = L.dateFmt(day, now.getDate(), month, now.getFullYear());

  const hr = now.getHours();
  const greet = hr < 12 ? L.greetings[0] : hr < 18 ? L.greetings[1] : L.greetings[2];
  document.getElementById('greeting').textContent = appName ? greet.replace(/\.$/, '') + ', ' + appName + '.' : greet;
  document.getElementById('day-tip').textContent  = L.tips[now.getDay()];
  document.getElementById('focus-text').textContent = `${appCity} · ${h}:${m}`;
}

// ── Session polling (global — same feed on all pages) ───────────────────
function shortModel(m) {
  if (!m) return '';
  if (m.includes('opus'))   return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku'))  return 'haiku';
  return '';
}

function pollSessions() {
  fetch('session-data.json?t=' + Date.now())
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(data => {
      const sessions = (data.sessions || []).filter(s => s.active);
      const banner = document.getElementById('session-banner');
      const list   = document.getElementById('session-list');
      if (sessions.length === 0) { banner.classList.remove('active'); return; }
      banner.classList.add('active');
      list.innerHTML = sessions.map(s => {
        const folder   = s.cwd ? s.cwd.replace(/\/+$/, '').split('/').pop() : '—';
        const fullPath = s.cwd || '—';
        const shortId  = s.session_id ? s.session_id.slice(0, 8) : '';
        const time     = s.last_active ? new Date(s.last_active).toLocaleTimeString('pt-PT', {hour:'2-digit', minute:'2-digit'}) : '';
        const name     = s.name || folder;
        const branch   = s.git_branch ? s.git_branch.replace(/^feature\/[^/]+\//, '') : '';
        const model    = shortModel(s.model);
        return `<div class="session-item">
          <span class="session-pulse"></span>
          <span class="session-label">Active</span>
          <span class="session-name">${name}</span>
          <span class="session-cwd" title="${fullPath}">${fullPath}</span>
          ${branch ? `<span class="session-id">⎇ ${branch}</span>` : `<span class="session-id">${shortId}</span>`}
          ${model  ? `<span class="session-time">${model}</span>` : ''}
          <span class="session-time">${time}</span>
          ${s.rc_url && /^https?:\/\//.test(s.rc_url) ? `<a class="session-rc-link" href="${s.rc_url}" target="_blank">↗ RC</a>` : ''}
        </div>`;
      }).join('');
    })
    .catch(() => {});
}

function pollReports() {
  fetch('reports/reports-index.json?t=' + Date.now())
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(data => {
      const el = document.getElementById('reports-links');
      if (!el) return;
      if (!data.length) {
        el.innerHTML = '<span style="color:var(--muted);font-size:0.78rem;font-family:\'DM Mono\',monospace;">No reports yet.</span>';
        return;
      }
      el.innerHTML = data.filter(r => r.file && !/^(?!https?:\/\/)[\w+.-]+:/i.test(r.file)).map(r => `<a class="link" href="${r.file}" target="_blank">
        <span class="link-icon">📄</span>
        <span class="link-name">${r.title || r.name}</span>
        <span class="link-arrow">↗</span>
      </a>`).join('');
    })
    .catch(() => {
      const el = document.getElementById('reports-links');
      if (el) el.innerHTML = '<span style="color:var(--muted);font-size:0.78rem;font-family:\'DM Mono\',monospace;">No reports found.</span>';
    });
}

// ── Escaping helpers (used by this file and by dashboard-agents.html's own script) ──
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Checklist ────────────────────────────────────────────────────────────
function pollChecklist() {
  fetch(`${API_BASE}/api/checklist?t=` + Date.now())
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(items => {
      const el = document.getElementById('checklist-items');
      if (!el) return;
      el.innerHTML = items.map(item => `
        <div class="checklist-item${item.checked ? ' done' : ''}" onclick="toggleChecklist('${escAttr(item.id)}', this)">
          <span class="checklist-check">${item.checked ? '✓' : ''}</span>
          <span class="checklist-text">${escHtml(item.text)}</span>
          <button class="checklist-copy" onclick="event.stopPropagation();copyChecklistItem(this,'${escAttr(item.text)}')" title="Copy">⎘</button>
          <button class="checklist-delete" onclick="event.stopPropagation();deleteChecklistItem('${escAttr(item.id)}',this)">✕</button>
        </div>`).join('');
    })
    .catch(() => {});
}

function toggleChecklist(id, el) {
  const done = el.classList.contains('done');
  fetch(`${API_BASE}/api/checklist/${id}`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({checked: !done}),
  })
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(item => {
      el.classList.toggle('done', item.checked);
      el.querySelector('.checklist-check').textContent = item.checked ? '✓' : '';
    })
    .catch(() => {});
}

function copyChecklistItem(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    const prev = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = prev; }, 1200);
  }).catch(() => {});
}

function deleteChecklistItem(id, btn) {
  fetch(`${API_BASE}/api/checklist/${id}`, { method: 'DELETE' })
    .then(r => { if (!r.ok && r.status !== 404) throw new Error(r.statusText); })
    .then(() => { btn.closest('.checklist-item').remove(); })
    .catch(() => {});
}

function addChecklistItem(input) {
  const text = input.value.trim();
  if (!text) return;
  fetch(`${API_BASE}/api/checklist`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({text}),
  })
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(() => { input.value = ''; pollChecklist(); })
    .catch(() => {});
}

// ── Announcements ─────────────────────────────────────────────────────────
function pollAnnouncements() {
  fetch(`${API_BASE}/api/announcements?t=` + Date.now())
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(items => {
      const el = document.getElementById('announcements-items');
      if (!el) return;
      if (!items.length) {
        el.innerHTML = '<div class="announcement-empty">No announcements.</div>';
        return;
      }
      el.innerHTML = items.map(item => `
        <div class="announcement-item" data-id="${escAttr(item.id)}">
          <div class="announcement-body">
            <div class="announcement-source">${escHtml(item.source || 'manual')}</div>
            <div class="announcement-text">${escHtml(item.text)}</div>
          </div>
          <button class="announcement-dismiss" onclick="dismissAnnouncement('${escAttr(item.id)}',this)" title="Dismiss">✕</button>
        </div>`).join('');
    })
    .catch(() => {});
}

function dismissAnnouncement(id, btn) {
  fetch(`${API_BASE}/api/announcements/${id}/dismiss`, { method: 'PATCH' })
    .then(r => { if (!r.ok) throw new Error(r.statusText); })
    .then(() => { btn.closest('.announcement-item').remove(); })
    .catch(() => {});
}

// ── News ──────────────────────────────────────────────────────────────────
function pollNews() {
  fetch(`${API_BASE}/api/news?t=` + Date.now())
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(items => {
      const el = document.getElementById('news-items');
      if (!el) return;
      if (!items.length) { el.innerHTML = '<div class="news-empty">No articles yet.</div>'; return; }
      el.innerHTML = items.map(item => `
        <div class="news-item${item.read ? ' read' : ''}" data-id="${escAttr(item.id)}" data-url="${escAttr(item.url)}" onclick="openNews(this)">
          <div style="flex:1;min-width:0;">
            <div class="news-meta">
              ${item.source ? `<span>${escHtml(item.source)}</span>` : ''}
              ${item.date   ? `<span>${escHtml(item.date)}</span>`   : ''}
            </div>
            <div class="news-title">${escHtml(item.title)}</div>
          </div>
          <button class="news-delete" onclick="event.stopPropagation();deleteNews('${escAttr(item.id)}',this)" title="Remove">✕</button>
        </div>`).join('');
    }).catch(() => {});
}

function openNews(el) {
  const url = el.dataset.url;
  if (!url || !/^https?:\/\//i.test(url)) return;
  fetch(`${API_BASE}/api/news/${el.dataset.id}/read`, { method: 'PATCH' }).catch(() => {});
  window.open(url, '_blank', 'noopener');
  el.classList.add('read');
}

function deleteNews(id, btn) {
  fetch(`${API_BASE}/api/news/${id}`, { method: 'DELETE' })
    .then(r => { if (!r.ok && r.status !== 404) throw new Error(r.statusText); })
    .then(() => { btn.closest('.news-item').remove(); })
    .catch(() => {});
}

function addNewsItem() {
  const urlEl   = document.getElementById('news-add-url');
  const titleEl = document.getElementById('news-add-title');
  const url   = (urlEl?.value || '').trim();
  const title = (titleEl?.value || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) { urlEl?.focus(); return; }
  const body = { url, title: title || new URL(url).hostname };
  fetch(`${API_BASE}/api/news`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(() => {
      if (urlEl)   urlEl.value   = '';
      if (titleEl) titleEl.value = '';
      pollNews();
    })
    .catch(() => {});
}

// ── Music ─────────────────────────────────────────────────────────────────
function pollMusic() {
  fetch(`${API_BASE}/api/music?t=` + Date.now())
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(items => {
      const el = document.getElementById('music-items');
      if (!el) return;
      if (!items.length) { el.innerHTML = '<div class="news-empty">No tracks yet.</div>'; return; }
      el.innerHTML = items.map(item => {
        if (!/^https?:\/\//i.test(item.url)) return '';
        return `<a class="music-item" href="${escAttr(item.url)}" target="_blank" rel="noopener">
          <span class="music-icon">${escHtml(item.icon || '🎵')}</span>
          <div class="music-body">
            <div class="music-title">${escHtml(item.title)}</div>
            ${item.artist ? `<div class="music-artist">${escHtml(item.artist)}</div>` : ''}
          </div>
          <span class="music-arrow">↗</span>
        </a>`;
      }).join('');
    }).catch(() => {});
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function buildGridStylesheet(sections) {
  const rules = sections.map(s =>
    `#${s.id} { grid-column: ${s.grid.col}; grid-row: ${s.grid.row}; }`
  ).join('\n');
  const mobileRules = sections.map(s => `#${s.id} { grid-column: 1 / -1; }`).join('\n  ');
  return `${rules}\n@media (max-width: 900px) {\n  .grid { grid-template-columns: repeat(6, 1fr); }\n}\n@media (max-width: 600px) {\n  ${mobileRules}\n}`;
}

function renderSection(section) {
  const colStyle = section.linksColumns > 1
    ? ` style="grid-template-columns: repeat(${section.linksColumns}, 1fr);"`
    : '';

  if (section.type === 'checklist') {
    return `<div id="${section.id}" class="section">
      <div class="label">
        <span class="dot"></span>
        <span class="label-text">${section.label}</span>
      </div>
      <div class="checklist-list" id="checklist-items"></div>
      <div class="checklist-add">
        <input class="checklist-input" id="checklist-input" type="text" placeholder="Add item…"
          onkeydown="if(event.key==='Enter') addChecklistItem(this)">
        <button class="checklist-btn" onclick="addChecklistItem(document.getElementById('checklist-input'))">+</button>
      </div>
    </div>`;
  }

  if (section.type === 'announcements') {
    return `<div id="${section.id}" class="section">
      <div class="label">
        <span class="dot"></span>
        <span class="label-text">${section.label}</span>
      </div>
      <div class="announcement-list" id="announcements-items">
        <div class="announcement-empty">Loading…</div>
      </div>
    </div>`;
  }

  if (section.type === 'news') {
    return `<div id="${section.id}" class="section">
      <div class="label"><span class="dot"></span><span class="label-text">${section.label}</span></div>
      <div class="news-list" id="news-items"><div class="news-empty">Loading…</div></div>
      <div class="news-add">
        <input class="news-add-url" id="news-add-url" type="url" placeholder="URL…"
          onkeydown="if(event.key==='Enter') addNewsItem()">
        <input class="news-add-title" id="news-add-title" type="text" placeholder="Title (optional)"
          onkeydown="if(event.key==='Enter') addNewsItem()">
        <button class="news-add-btn" onclick="addNewsItem()" title="Add article">+</button>
      </div>
    </div>`;
  }

  if (section.type === 'music') {
    return `<div id="${section.id}" class="section">
      <div class="label"><span class="dot"></span><span class="label-text">${section.label}</span></div>
      <div class="music-list" id="music-items"><div class="news-empty">Loading…</div></div>
    </div>`;
  }

  if (section.type === 'dynamic') {
    return `<div id="${section.id}" class="section">
      <div class="label">
        <span class="dot"></span>
        <span class="label-text">${section.label}</span>
      </div>
      <div class="links" id="${section.id}-links">
        <span style="color:var(--muted);font-size:0.78rem;font-family:'DM Mono',monospace;">Loading…</span>
      </div>
    </div>`;
  }

  if (section.type === 'agent-sessions') {
    return `<div id="${section.id}" class="section">
      <div class="label">
        <span class="dot"></span>
        <span class="label-text">${section.label}</span>
      </div>
      <div class="agent-session-grid" id="agent-session-cards">
        <span style="color:var(--muted);font-size:0.78rem;font-family:'DM Mono',monospace;">Loading…</span>
      </div>
      <div class="agent-register-form">
        <select id="agent-reg-provider">
          <option value="edgar">Edgar</option>
          <option value="other">Other</option>
        </select>
        <input id="agent-reg-name" type="text" placeholder="Name…">
        <input id="agent-reg-notes" type="text" placeholder="Notes — what I'm doing…">
        <button onclick="startAgentSession()">Start Session</button>
      </div>
    </div>`;
  }

  const links = (section.links || []).filter(link => link.url && !/^(?!https?:\/\/)[\w+.-]+:/i.test(link.url)).map(link =>
    `<a class="link" href="${link.url}" target="_blank">
      <span class="link-icon">${escHtml(link.icon)}</span>
      <span class="link-name">${link.name}</span>
      <span class="link-arrow">↗</span>
    </a>`
  ).join('');

  return `<div id="${section.id}" class="section">
    <div class="label">
      <span class="dot"></span>
      <span class="label-text">${section.label}</span>
    </div>
    <div class="links"${colStyle}>${links}</div>
  </div>`;
}

async function loadConfig() {
  let config;
  try {
    const r = await fetch('dashboard-config.json?t=' + Date.now());
    if (!r.ok) throw new Error(r.status);
    config = await r.json();
  } catch {
    document.getElementById('grid').innerHTML =
      `<div style="grid-column:1/-1;padding:32px;color:var(--muted);font-family:'DM Mono',monospace;font-size:0.82rem;line-height:1.8;">
        <strong style="color:var(--text)">dashboard-config.json not found</strong><br>
        Run <code style="color:var(--text);background:var(--surface2);padding:2px 6px;border-radius:4px;">./install.sh</code> from the repo root to set up.
      </div>`;
    return;
  }

  // Apply user
  if (config.user?.locale) appLocale = config.user.locale;
  if (config.user?.city)   appCity   = config.user.city;
  if (config.user?.name)   appName   = config.user.name;
  tick();

  // Inject accent + glow CSS vars into :root
  const root = document.documentElement;
  if (config.theme?.accents) {
    for (const [key, hex] of Object.entries(config.theme.accents)) {
      root.style.setProperty(`--accent-${key}`, hex);
      root.style.setProperty(`--glow-${key}`, hexToRgba(hex, 0.15));
    }
  }

  // Filter to this page's tab
  const sections = (config.sections || []).filter(s => s.tab === PAGE_TAB);

  // Generate grid placement stylesheet
  const styleEl = document.createElement('style');
  styleEl.id = 'grid-layout';
  styleEl.textContent = buildGridStylesheet(sections);
  document.head.appendChild(styleEl);

  // Render sections
  const grid = document.getElementById('grid');
  grid.innerHTML = sections.map(renderSection).join('');

  // Apply per-section CSS custom properties
  for (const section of sections) {
    const el = document.getElementById(section.id);
    if (!el) continue;
    const accentKey = section.accent || section.id;
    const hex = config.theme?.accents?.[accentKey];
    if (hex) {
      el.style.setProperty('--section-accent',  hex);
      el.style.setProperty('--section-glow',    hexToRgba(hex, 0.15));
      el.style.setProperty('--section-icon-bg', hexToRgba(hex, 0.12));
    }
  }

  // Nav bar
  if (typeof renderNav === 'function') renderNav(PAGE_TAB);

  // Start reports polling now that the reports section exists (no-op if absent on this page)
  pollReports();
  setInterval(pollReports, 30000);

  if (sections.some(s => s.type === 'checklist')) {
    pollChecklist();
    setInterval(pollChecklist, 10000);
  }
  if (sections.some(s => s.type === 'announcements')) {
    pollAnnouncements();
    setInterval(pollAnnouncements, 15000);
  }
  if (sections.some(s => s.type === 'news')) {
    pollNews();
    setInterval(pollNews, 60000);
  }
  if (sections.some(s => s.type === 'music')) {
    pollMusic();
    setInterval(pollMusic, 300000);
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  tick();
  setInterval(tick, 1000);
  pollSessions();
  setInterval(pollSessions, 5000);
  loadConfig();
});
```

- [ ] **Step 2: Verify `url: null` (Antigravity link, Task 5) renders without a clickable link**

```bash
node -e "
const link = { icon: '🪐', name: 'Antigravity', url: null };
const filtered = [link].filter(l => l.url && !/^(?!https?:\/\/)[\w+.-]+:/i.test(l.url));
console.log('rendered count:', filtered.length);
"
```

Expected: `rendered count: 0` — confirms the existing links filter (copied verbatim into `renderSection`'s default branch) already drops falsy URLs, so Antigravity's `TBD`/`null` link is silently omitted from Panel 1 with no extra code needed.

- [ ] **Step 3: Mark task complete**

(Full runtime verification of this file happens in Tasks 8-10, once an actual HTML page loads it.)

---

### Task 8: `dashboard-work.html`

**Files:**
- Create: `dashboard-work.html` (content = current `dashboard.html`'s `<head>`/`<style>`/`<body>` shell, with the inline `<script>` block replaced)
- Do not delete `dashboard.html` yet — Task 11 covers final cleanup/redirect decision with the user present to verify nothing else links to the old filename.

**Interfaces:**
- Consumes: `nav.js` (Task 6), `dashboard-common.js` (Task 7) with `data-tab="work"` `data-api-base=""`.

- [ ] **Step 1: Create `dashboard-work.html`**

Copy `dashboard.html` verbatim from line 1 through line 551 (the `<!DOCTYPE html>` through `</div>` closing `.shell`, i.e. everything except the final `<script>...</script>` block) into a new file `dashboard-work.html`, with two edits:

1. Change `<title>Dashboard</title>` (line 6) to `<title>Work — Dashboard</title>`.
2. Replace the entire `<script>...</script>` block (original lines 552-1018) with:

```html
<script src="nav.js"></script>
<script src="dashboard-common.js" data-tab="work" data-api-base=""></script>
```

- [ ] **Step 2: Start server, load page, verify manually**

```bash
python3 server.py &
```

Open `http://localhost:8765/dashboard-work.html` in a browser. Verify:
- Clock/date/greeting render (confirms `dashboard-common.js` loaded and `tick()` ran).
- Nav bar shows Work/Personal/Agents tabs with "Work" highlighted (confirms `renderNav('work')` fired).
- Checklist, announcements, news, music, and all link sections render (confirms `PAGE_TAB` filter matches `"tab": "work"` sections from Task 5).
- Home and Gaming sections are **gone** from this page (moved to Personal — confirms the filter excludes `tab: "personal"` sections).
- Agents/Agent Tools links section is **gone** from this page (moved to Agents tab).
- Adding a checklist item via the UI persists after a page refresh (confirms `API_BASE=""` hits `/api/checklist` correctly).

- [ ] **Step 3: Mark task complete**

---

### Task 9: `dashboard-personal.html`

**Files:**
- Create: `dashboard-personal.html`

**Interfaces:**
- Consumes: `nav.js`, `dashboard-common.js` with `data-tab="personal"` `data-api-base="/personal"`.

- [ ] **Step 1: Create `dashboard-personal.html`**

Same shell as `dashboard-work.html` (identical `<style>` block, identical body skeleton — header/clock/session-banner/`<div class="grid" id="grid">`/footer), with:

1. `<title>Personal — Dashboard</title>`
2. Scripts:

```html
<script src="nav.js"></script>
<script src="dashboard-common.js" data-tab="personal" data-api-base="/personal"></script>
```

- [ ] **Step 2: Verify**

Open `http://localhost:8765/dashboard-personal.html`. Verify:
- Nav bar shows "Personal" highlighted.
- Personal Checklist, Personal Announcements, Personal News, Personal Music, Home, Gaming sections render (from Task 5's `tab: "personal"` sections).
- Adding an item to Personal Checklist here, then reloading `dashboard-work.html` (Task 8) — confirm the **work** checklist is unaffected (namespace isolation, same check as Task 2 Step 3 but end-to-end through the UI).

- [ ] **Step 3: Mark task complete**

---

### Task 10: `dashboard-agents.html`

**Files:**
- Create: `dashboard-agents.html`

**Interfaces:**
- Consumes: `nav.js`, `dashboard-common.js` with `data-tab="agents"` `data-api-base=""` (Agent Tools links section only — Panels 2/3 use their own script below), `escHtml`/`escAttr` globals from `dashboard-common.js`, `/api/sessions` (Task 3), `session-data.json` (Task 4).

- [ ] **Step 1: Create `dashboard-agents.html`**

Same shell as Task 8/9, with `<title>Agents — Dashboard</title>`, plus one extra CSS block appended right before `</style>` (agent-session-grid/card/register-form styling — page-specific, not needed on Work/Personal):

```css
  /* AGENT SESSIONS (agents page only) */
  .agent-session-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 10px;
    margin-bottom: 14px;
  }
  .agent-card {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
  }
  .agent-card-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .agent-card-badge {
    font-family: 'DM Mono', monospace; font-size: 0.6rem;
    letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--badge-color, var(--muted));
    border: 1px solid var(--badge-color, var(--muted));
    border-radius: 4px; padding: 1px 6px;
  }
  .agent-card-name { font-size: 0.85rem; font-weight: 500; }
  .agent-card-sub {
    font-family: 'DM Mono', monospace; font-size: 0.7rem; color: var(--muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px;
  }
  .agent-card-prompt {
    font-size: 0.78rem; color: var(--muted); font-style: italic;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 8px;
  }
  .agent-card-bottom { display: flex; align-items: center; justify-content: space-between; }
  .agent-card-tag {
    font-family: 'DM Mono', monospace; font-size: 0.6rem;
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted);
  }
  .agent-card-end {
    background: none; border: 1px solid var(--border); border-radius: 6px;
    color: var(--muted); cursor: pointer; padding: 2px 8px; font-size: 0.68rem;
    transition: border-color 0.15s, color 0.15s;
  }
  .agent-card-end:hover { border-color: var(--border-hover); color: var(--text); }
  .agent-register-form { display: flex; gap: 8px; flex-wrap: wrap; }
  .agent-register-form select, .agent-register-form input {
    background: var(--surface2); border: 1px solid var(--border); border-radius: 8px;
    padding: 8px 12px; color: var(--text); font-family: 'Outfit', sans-serif; font-size: 0.85rem;
    outline: none;
  }
  .agent-register-form input { flex: 1; min-width: 140px; }
  .agent-register-form button {
    background: var(--surface2); border: 1px solid var(--border); border-radius: 8px;
    padding: 8px 14px; cursor: pointer; color: var(--text); font-size: 0.82rem;
  }
  .agent-register-form button:hover { border-color: var(--border-hover); }
```

Body scripts (two, in this order):

```html
<script src="nav.js"></script>
<script src="dashboard-common.js" data-tab="agents" data-api-base=""></script>
<script>
let manualSessions = [];
let fileSessions = [];

function providerColor(p) {
  return { claude: '#fb7360', antigravity: '#f59e0b', edgar: '#22c55e', other: '#5a6070' }[p] || '#5a6070';
}

function renderAgentCard(s) {
  const color = providerColor(s.provider);
  const name = s.name || (s.cwd ? s.cwd.replace(/\/+$/,'').split('/').pop() : s.provider);
  const subLine = s.cwd || s.notes || '';
  const canEnd = s.provider === 'edgar' || s.provider === 'other';
  return `<div class="agent-card" style="--badge-color:${color}">
    <div class="agent-card-top">
      <span class="agent-card-badge">${escHtml(s.provider)}</span>
      <span class="agent-card-name">${escHtml(name)}</span>
    </div>
    ${subLine ? `<div class="agent-card-sub" title="${escAttr(subLine)}">${escHtml(subLine)}</div>` : ''}
    ${s.last_prompt ? `<div class="agent-card-prompt" title="${escAttr(s.last_prompt)}">${escHtml(s.last_prompt)}</div>` : ''}
    <div class="agent-card-bottom">
      <span class="agent-card-tag">active</span>
      ${canEnd ? `<button class="agent-card-end" onclick="endAgentSession('${escAttr(s.id)}')">End</button>` : ''}
    </div>
  </div>`;
}

function renderAgentSessions() {
  const el = document.getElementById('agent-session-cards');
  if (!el) return;
  const all = [...fileSessions, ...manualSessions].filter(s => s.active);
  if (!all.length) {
    el.innerHTML = '<span style="color:var(--muted);font-size:0.78rem;font-family:\'DM Mono\',monospace;">No active sessions.</span>';
    return;
  }
  el.innerHTML = all.map(renderAgentCard).join('');
}

function pollAgentSessions() {
  Promise.all([
    fetch('session-data.json?t=' + Date.now()).then(r => r.ok ? r.json() : {sessions:[]}).catch(() => ({sessions:[]})),
    fetch('/api/sessions?active=true&t=' + Date.now()).then(r => r.ok ? r.json() : []).catch(() => []),
  ]).then(([fileData, manual]) => {
    fileSessions = (fileData.sessions || []).map(s => ({ ...s, id: s.session_id }));
    manualSessions = (manual || []).map(s => ({ ...s, active: s.status !== 'ended' }));
    renderAgentSessions();
  });
}

function startAgentSession() {
  const providerEl = document.getElementById('agent-reg-provider');
  const nameEl = document.getElementById('agent-reg-name');
  const notesEl = document.getElementById('agent-reg-notes');
  const name = nameEl.value.trim();
  if (!name) { nameEl.focus(); return; }
  fetch('/api/sessions', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ provider: providerEl.value, name, notes: notesEl.value.trim() }),
  })
    .then(r => r.json())
    .then(() => {
      nameEl.value = '';
      notesEl.value = '';
      pollAgentSessions();
    })
    .catch(() => {});
}

function endAgentSession(id) {
  fetch(`/api/sessions/${id}`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ status: 'ended' }),
  }).then(() => pollAgentSessions()).catch(() => {});
}

document.addEventListener('DOMContentLoaded', () => {
  pollAgentSessions();
  setInterval(pollAgentSessions, 30000);
});
</script>
```

- [ ] **Step 2: Verify**

Open `http://localhost:8765/dashboard-agents.html`. Verify:
- Nav bar shows "Agents" highlighted.
- Agent Tools links section (Panel 1) renders Claude/Edgar/Spinnable/Gemini/Skills/Sessions as clickable links; Antigravity shows with no clickable link (icon+name only, per Task 6 Step 2's `url: null` behavior) — confirm visually.
- Active Sessions panel shows cards for any currently-active Claude and/or Antigravity sessions found by `build-session-data.mjs` (Task 4) — run `node build-session-data.mjs` first if `session-data.json` is stale.
- Register form: type a name (e.g. "manual test"), select "Other", click "Start Session" — a new card appears within 30s (or immediately after a manual `pollAgentSessions()` call in devtools console) with an "End" button. Click "End" — card disappears.
- Confirm via `curl http://localhost:8765/api/sessions` that the ended session now has `"status": "ended"` and an `"ended_at"` timestamp (not deleted — matches Task 3's PATCH semantics).

- [ ] **Step 3: Mark task complete**

---

### Task 11: End-to-end verification and cleanup decision

**Files:** none (verification only)

- [ ] **Step 1: Run the full manual test matrix from the design spec (§11)**

```bash
node build-session-data.mjs
python3 -c "import json; d=json.load(open('session-data.json')); print('providers:', set(s['provider'] for s in d['sessions']))"
# Expected: {'claude', 'antigravity'} (or just {'claude'} if no recent antigravity activity — acceptable)

curl -s http://localhost:8765/api/personal/checklist
curl -s http://localhost:8765/api/sessions
# Expected: both return valid JSON arrays
```

Then in a browser, click through all three pages via the nav bar (Work → Personal → Agents → Work), confirming:
- Nav highlight follows the active page correctly each time.
- No console errors (`mcp__claude-in-chrome__read_console_messages` or browser devtools).
- Work checklist and Personal checklist stay independent (add to one, confirm absent from the other).

- [ ] **Step 2: Decide what happens to the old `dashboard.html` and `session-dashboard.html`'s "← Dashboard" link**

`session-dashboard.html:322` links back to `dashboard.html` (`<a class="back-link" href="dashboard.html">← Dashboard</a>`). Ask the user: point it at `dashboard-work.html` instead, or leave `dashboard.html` in place as an alias? Do not delete `dashboard.html` without explicit confirmation — other bookmarks/shortcuts (`install.sh`, OS shortcuts, browser bookmarks) may reference it directly.

- [ ] **Step 3: Mark task complete — plan finished**

---

## Self-Review Notes (completed during plan authoring)

- **Spec coverage:** §1 (nav) → Task 6. §2 (Work) → Tasks 5, 8. §3 (Personal) → Tasks 2, 5, 9. §4 (Agents panels) → Tasks 5, 10. §5 (Session Registry API) → Task 3. §5a (Antigravity parsing) → Task 4. §6 (Gemini dropped) → no task, correctly absent. §8 (config changes) → Task 5. §11 (testing) → Task 11. No gaps found.
- **Placeholder scan:** none — every code block is complete and runnable; the one legitimate `TBD`/`null` (Antigravity URL) is a documented, deliberate value per the design spec, not an unfinished step.
- **Type consistency:** `provider` field spelled identically across Task 4 (`build-session-data.mjs`), Task 10 (`providerColor`, `renderAgentCard`), and the design spec. `PAGE_TAB`/`API_BASE` names consistent across Tasks 7-10. Helper function names (`_list`, `_add`, `_add_first`, `_patch`, `_delete`) consistent between Task 1's definitions and Tasks 2-3's call sites.
