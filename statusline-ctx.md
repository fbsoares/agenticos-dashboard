# Claude Code — Status Line: Context Usage (`ctx: X%`)

Shows current context window usage in the Claude Code status bar, e.g. `ctx: 20%`.

## Files

### `~/.claude/statusline-command.sh`

```bash
#!/usr/bin/env bash
input=$(cat)
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
if [ -n "$used" ]; then
  printf 'ctx: %.0f%%' "$used"
fi
```

### `~/.claude/settings.json` (relevant section)

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash /home/snake/.claude/statusline-command.sh"
  }
}
```

## Setup

**1. Install dependency**

```bash
sudo apt install jq   # Debian/Ubuntu
brew install jq       # macOS
```

**2. Create the script**

```bash
cat > ~/.claude/statusline-command.sh << 'EOF'
#!/usr/bin/env bash
input=$(cat)
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
if [ -n "$used" ]; then
  printf 'ctx: %.0f%%' "$used"
fi
EOF
chmod +x ~/.claude/statusline-command.sh
```

**3. Configure settings.json**

Add the `statusLine` key to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash ~/.claude/statusline-command.sh"
  }
}
```

If the file already exists, merge the `statusLine` key into the existing JSON.

## How it works

Claude Code passes a JSON payload to the command via stdin. The script extracts `.context_window.used_percentage` (a number 0–100) and prints it formatted as `ctx: X%`. If the field is absent the script outputs nothing.
