#!/usr/bin/env bash
set -e
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_SKILLS="$SCRIPT_DIR/.claude/skills"
LOCAL_SKILLS="$HOME/.claude/skills"

CMD="${1:-status}"

case "$CMD" in
  pull)
    echo "=== Syncing repo skills → ~/.claude/skills/ ==="
    if [ ! -d "$REPO_SKILLS" ]; then
      echo "No .claude/skills/ in repo, nothing to pull."
      exit 0
    fi
    CHANGED=0
    while IFS= read -r -d '' src; do
      rel="${src#$REPO_SKILLS/}"
      dst="$LOCAL_SKILLS/$rel"
      mkdir -p "$(dirname "$dst")"
      if [ ! -f "$dst" ] || ! diff -q "$src" "$dst" >/dev/null 2>&1; then
        cp "$src" "$dst"
        echo "  ✓ $rel"
        CHANGED=1
      fi
    done < <(find "$REPO_SKILLS" -type f -print0)
    [ "$CHANGED" -eq 0 ] && echo "  Already up to date."
    echo "Pull complete."
    ;;

  push)
    echo "=== Syncing ~/.claude/skills/ → repo ==="
    if [ ! -d "$LOCAL_SKILLS" ]; then
      echo "No ~/.claude/skills/, nothing to push."
      exit 0
    fi
    mkdir -p "$REPO_SKILLS"
    CHANGED=0
    while IFS= read -r -d '' src; do
      rel="${src#$LOCAL_SKILLS/}"
      dst="$REPO_SKILLS/$rel"
      mkdir -p "$(dirname "$dst")"
      if [ ! -f "$dst" ] || ! diff -q "$src" "$dst" >/dev/null 2>&1; then
        cp "$src" "$dst"
        git -C "$SCRIPT_DIR" add "$dst" 2>/dev/null || true
        echo "  ✓ $rel"
        CHANGED=1
      fi
    done < <(find "$LOCAL_SKILLS" -type f -print0)
    [ "$CHANGED" -eq 0 ] && echo "  Already up to date."
    echo "Push complete. Review staged files and commit only team-shared skills."
    ;;

  status)
    echo "=== Skills sync status ==="
    FOUND=0
    if [ -d "$LOCAL_SKILLS" ]; then
      while IFS= read -r -d '' src; do
        rel="${src#$LOCAL_SKILLS/}"
        dst="$REPO_SKILLS/$rel"
        if [ ! -f "$dst" ]; then
          echo "  local-only : $rel"
          FOUND=1
        elif ! diff -q "$src" "$dst" >/dev/null 2>&1; then
          echo "  modified   : $rel"
          FOUND=1
        fi
      done < <(find "$LOCAL_SKILLS" -type f -print0 2>/dev/null || true)
    fi
    if [ -d "$REPO_SKILLS" ]; then
      while IFS= read -r -d '' src; do
        rel="${src#$REPO_SKILLS/}"
        if [ ! -f "$LOCAL_SKILLS/$rel" ]; then
          echo "  repo-only  : $rel"
          FOUND=1
        fi
      done < <(find "$REPO_SKILLS" -type f -print0 2>/dev/null || true)
    fi
    [ "$FOUND" -eq 0 ] && echo "  In sync."
    ;;

  *)
    echo "Usage: sync-skills.sh pull|push|status"
    exit 1
    ;;
esac
