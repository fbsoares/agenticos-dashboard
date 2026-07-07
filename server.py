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
    ],
})


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


# ── Static files ─────────────────────────────────────────────────────────────
# Serves dashboard.html, session-data.json, reports/*, skills-data.js, etc.

@app.route("/", defaults={"path": "dashboard.html"})
@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(str(BASE), path)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8765, debug=False)
