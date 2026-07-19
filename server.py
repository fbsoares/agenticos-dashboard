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
        {"name": "Agent Projects"},
    ],
})

AGENT_PROJECT_AGENTS = {"claude", "gemini", "spinnable", "edgar"}


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


@app.after_request
def _cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


@app.route("/api/<path:_>", methods=["OPTIONS"])
def _preflight(_):
    return "", 204


# ── Checklist ────────────────────────────────────────────────────────────────

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
    return jsonify(_list("checklist.json"))


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
    return jsonify(_add("checklist.json", item)), 201


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
    """
    body = request.get_json(force=True) or {}
    def mutate(item):
        item["checked"] = bool(body["checked"]) if "checked" in body else not item.get("checked", False)
    item = _patch("checklist.json", item_id, mutate)
    if item is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(item)


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
    """
    if not _delete("checklist.json", item_id):
        return jsonify({"error": "not found"}), 404
    return "", 204


# ── Announcements ─────────────────────────────────────────────────────────────

@app.route("/api/announcements", methods=["GET"])
def get_announcements():
    """Get all non-dismissed announcements.
    ---
    tags: [Announcements]
    responses:
      200:
        description: List of active announcements
        schema:
          type: array
          items:
            $ref: '#/definitions/Announcement'
    definitions:
      Announcement:
        type: object
        properties:
          id:
            type: string
            example: a1b2c3d4
          text:
            type: string
            example: Deployment scheduled for Friday
          source:
            type: string
            example: manual
          dismissed:
            type: boolean
          created_at:
            type: string
            format: date-time
    """
    return jsonify(_list("announcements.json", lambda i: not i.get("dismissed")))


@app.route("/api/announcements", methods=["POST"])
def add_announcement():
    """Add an announcement.
    ---
    tags: [Announcements]
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
              example: Deployment scheduled for Friday
            source:
              type: string
              example: manual
    responses:
      201:
        description: Created announcement
        schema:
          $ref: '#/definitions/Announcement'
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
    return jsonify(_add("announcements.json", item)), 201


@app.route("/api/announcements/<item_id>/dismiss", methods=["PATCH"])
def dismiss_announcement(item_id):
    """Dismiss an announcement.
    ---
    tags: [Announcements]
    parameters:
      - in: path
        name: item_id
        type: string
        required: true
    responses:
      200:
        description: Dismissed announcement
        schema:
          $ref: '#/definitions/Announcement'
      404:
        description: Not found
    """
    item = _patch("announcements.json", item_id, lambda i: i.__setitem__("dismissed", True))
    if item is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(item)


# ── News ─────────────────────────────────────────────────────────────────────

@app.route("/api/news", methods=["GET"])
def get_news():
    """Get all news articles.
    ---
    tags: [News]
    responses:
      200:
        description: List of articles, newest first
        schema:
          type: array
          items:
            $ref: '#/definitions/NewsItem'
    definitions:
      NewsItem:
        type: object
        properties:
          id:
            type: string
            example: a1b2c3d4
          title:
            type: string
            example: New feature released
          url:
            type: string
            example: https://example.com/article
          source:
            type: string
            example: TechCrunch
          date:
            type: string
            format: date
            example: "2026-06-07"
          read:
            type: boolean
    """
    return jsonify(_list("news.json"))


@app.route("/api/news", methods=["POST"])
def add_news():
    """Add a news article.
    ---
    tags: [News]
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
              example: New feature released
            url:
              type: string
              example: https://example.com/article
            source:
              type: string
              example: TechCrunch
            date:
              type: string
              format: date
              example: "2026-06-07"
    responses:
      201:
        description: Created article
        schema:
          $ref: '#/definitions/NewsItem'
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
    return jsonify(_add_first("news.json", item)), 201


@app.route("/api/news/<item_id>", methods=["DELETE"])
def delete_news(item_id):
    """Delete a news article.
    ---
    tags: [News]
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
    if not _delete("news.json", item_id):
        return jsonify({"error": "not found"}), 404
    return "", 204


@app.route("/api/news/<item_id>/read", methods=["PATCH"])
def mark_news_read(item_id):
    """Mark a news article as read.
    ---
    tags: [News]
    parameters:
      - in: path
        name: item_id
        type: string
        required: true
    responses:
      200:
        description: Updated article
        schema:
          $ref: '#/definitions/NewsItem'
      404:
        description: Not found
    """
    item = _patch("news.json", item_id, lambda i: i.__setitem__("read", True))
    if item is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(item)


# ── Music ─────────────────────────────────────────────────────────────────────

@app.route("/api/music", methods=["GET"])
def get_music():
    """Get all music links.
    ---
    tags: [Music]
    responses:
      200:
        description: List of music links
        schema:
          type: array
          items:
            $ref: '#/definitions/MusicItem'
    definitions:
      MusicItem:
        type: object
        properties:
          id:
            type: string
            example: a1b2c3d4
          title:
            type: string
            example: Chill Mix
          url:
            type: string
            example: https://open.spotify.com/playlist/...
          artist:
            type: string
            example: Various
          icon:
            type: string
            example: 🎵
    """
    return jsonify(_list("music.json"))


@app.route("/api/music", methods=["POST"])
def add_music():
    """Add a music link.
    ---
    tags: [Music]
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
              example: Chill Mix
            url:
              type: string
              example: https://open.spotify.com/playlist/...
            artist:
              type: string
              example: Various
            icon:
              type: string
              example: 🎵
    responses:
      201:
        description: Created music link
        schema:
          $ref: '#/definitions/MusicItem'
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
    return jsonify(_add("music.json", item)), 201


@app.route("/api/music/<item_id>", methods=["DELETE"])
def delete_music(item_id):
    """Delete a music link.
    ---
    tags: [Music]
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
    if not _delete("music.json", item_id):
        return jsonify({"error": "not found"}), 404
    return "", 204


# ── Agent Projects ────────────────────────────────────────────────────────────

@app.route("/api/agent-projects", methods=["GET"])
def get_agent_projects():
    """Get all agent projects.
    ---
    tags: [Agent Projects]
    responses:
      200:
        description: List of agent projects
        schema:
          type: array
          items:
            $ref: '#/definitions/AgentProject'
    definitions:
      AgentProject:
        type: object
        properties:
          id:
            type: string
            example: a1b2c3d4
          title:
            type: string
            example: Dashboard revamp
          project_url:
            type: string
            example: https://claude.ai/project/xyz
          conversation_url:
            type: string
            example: https://claude.ai/chat/xyz
          agent:
            type: string
            enum: [claude, gemini, spinnable, edgar]
          created_at:
            type: string
            format: date-time
    """
    return jsonify(_list("agent-projects.json"))


@app.route("/api/agent-projects", methods=["POST"])
def add_agent_project():
    """Add an agent project.
    ---
    tags: [Agent Projects]
    parameters:
      - in: body
        name: body
        required: true
        schema:
          type: object
          required: [title, project_url, agent]
          properties:
            title:
              type: string
              example: Dashboard revamp
            project_url:
              type: string
              example: https://claude.ai/project/xyz
            conversation_url:
              type: string
              example: https://claude.ai/chat/xyz
            agent:
              type: string
              enum: [claude, gemini, spinnable, edgar]
    responses:
      201:
        description: Created agent project
        schema:
          $ref: '#/definitions/AgentProject'
      400:
        description: title, project_url and a valid agent are required
    """
    body = request.get_json(force=True) or {}
    title = str(body.get("title", "")).strip()
    project_url = str(body.get("project_url", "")).strip()
    conversation_url = str(body.get("conversation_url", "")).strip()
    agent = str(body.get("agent", "")).strip().lower()
    if not title or not project_url:
        return jsonify({"error": "title and project_url required"}), 400
    if agent not in AGENT_PROJECT_AGENTS:
        return jsonify({"error": f"agent must be one of {sorted(AGENT_PROJECT_AGENTS)}"}), 400
    item = {
        "id": uuid.uuid4().hex[:8],
        "title": title,
        "project_url": project_url,
        "conversation_url": conversation_url,
        "agent": agent,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return jsonify(_add("agent-projects.json", item)), 201


@app.route("/api/agent-projects/<item_id>", methods=["DELETE"])
def delete_agent_project(item_id):
    """Delete an agent project.
    ---
    tags: [Agent Projects]
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
    if not _delete("agent-projects.json", item_id):
        return jsonify({"error": "not found"}), 404
    return "", 204


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


# ── Static files ─────────────────────────────────────────────────────────────
# Serves dashboard-work.html, session-data.json, reports/*, skills-data.js, etc.

@app.route("/", defaults={"path": "dashboard-work.html"})
@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(str(BASE), path)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8765, debug=False)
