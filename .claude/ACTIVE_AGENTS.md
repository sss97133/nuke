# Active Agents

**This file is a pointer. Per-agent state lives in `.claude/agents/active/`.**

## Check who's active
```bash
cat .claude/agents/active/*.md 2>/dev/null
```

## Register yourself
```bash
echo "$(date +%H:%M) | YOUR-TASK | description | files/areas" > .claude/agents/active/$PPID.md
```

## Deregister when done
```bash
rm -f .claude/agents/active/$PPID.md
```

## Find stale agents (>2 hours)
```bash
find .claude/agents/active/ -name "*.md" -mmin +120
```

---

## Background Processes (manually maintained)
- LaunchAgent `com.nuke.fb-saved-sync` — every 30 min
