#!/usr/bin/env python3
"""Durable, bounded subscription CLI continuation; no third-party dependencies."""
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid

ALLOWED = ["Read", "Edit", "Write", "Grep", "Glob"] + [f"Bash({s}*)" for s in (
    "git status", "git diff", "git log", "git show", "git fetch", "git switch",
    "git checkout", "git add", "git commit", "git push -u origin night/",
    "gh pr create", "gh pr view", "gh pr list", "gh pr checks",
    "scripts/data/q.sh", "node --test", "ls", "date", "wc")]
DENIED = [f"Bash({s}*)" for s in (
    "gh pr merge", "git push origin main", "git push --force", "launchctl",
    "supabase", "psql", "curl")]
FIELDS = {
    "objective": {"type": "string", "minLength": 1},
    "acceptance": {"type": "array", "minItems": 1, "items": {"type": "string", "minLength": 1}},
    "status": {"enum": ["active", "waiting_review", "blocked", "complete"]},
    "next_action": {"type": "string"},
    "progress": {"type": "string"},
    "blocker": {"type": "string"},
    "unblock_condition": {"type": "string"},
    "prs": {"type": "array", "items": {"type": "integer", "minimum": 1}},
    "superseded_prs": {"type": "array", "items": {"type": "object", "properties": {
        "pr": {"type": "integer", "minimum": 1}, "replacement": {"type": "integer", "minimum": 1}},
        "required": ["pr", "replacement"], "additionalProperties": False}},
    "evidence": {"type": "array", "items": {"type": "object", "properties": {
        "criterion": {"type": "string"}, "receipt": {"type": "string"}},
        "required": ["criterion", "receipt"], "additionalProperties": False}},
}
SCHEMA = {"type": "object", "properties": FIELDS, "required": list(FIELDS), "additionalProperties": False}


def seconds(value):
    match = re.fullmatch(r"([1-9][0-9]*)([smh]?)", value)
    if not match:
        raise ValueError("NIGHT_RUN_CAP must be a positive integer with optional s/m/h")
    return int(match[1]) * {"": 1, "s": 1, "m": 60, "h": 3600}[match[2]]


def budget_day(now):
    local = dt.datetime.fromtimestamp(now).astimezone()
    if (local.hour, local.minute) < (1, 30):
        local -= dt.timedelta(days=1)
    return local.date().isoformat()


def atomic_json(path, value):
    tmp = path.with_suffix(".tmp")
    with tmp.open("w") as out:
        json.dump(value, out, indent=2)
        out.write("\n")
        out.flush()
        os.fsync(out.fileno())
    tmp.replace(path)


def command(args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, text=True, stderr=subprocess.PIPE, timeout=60).strip()


class Controller:
    def __init__(self):
        self.repo = Path(os.environ.get("NIGHT_RUN_REPO", str(Path.home() / "nuke"))).resolve()
        self.logs = Path(os.environ.get("NIGHT_RUN_LOG_DIR", str(Path.home() / "nuke-logs/night-run"))).resolve()
        self.cap = seconds(os.environ.get("NIGHT_RUN_CAP", "45m"))
        self.state_file = self.logs / "state.json"
        self.state = json.loads(self.state_file.read_text()) if self.state_file.exists() else {
            "version": 1, "status": "idle", "spent_seconds": 0, "attempts": 0}
        if self.state.get("version") != 1:
            raise ValueError("unsupported state version; preserve state and inspect")

    def save(self):
        self.state["updated_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
        atomic_json(self.state_file, self.state)

    def note(self, message):
        stamp = dt.datetime.now(dt.timezone.utc)
        with (self.logs / f"{stamp.date()}.md").open("a") as report:
            report.write(f"\n- {stamp.isoformat()} {message}\n")
        print(message, flush=True)

    def fail(self, reason):
        count = self.state.get("failures", 0) + 1
        self.state.update(failures=count, reason=reason, next_check=time.time() + min(21600, 900 * 2 ** (count - 1)))
        if count >= 3:
            self.state["status"] = "blocked"
            self.state["reason"] = f"Three consecutive controller failures: {reason}. Inspect then use --resume."
        self.save()
        self.note(self.state["reason"])
        return 1

    def prepare(self):
        command(["git", "fetch", "-q", "origin", "main"], self.repo)
        task_id = uuid.uuid4().hex[:12]
        wt = Path.home() / ".worktrees" / f"night-run-task-{task_id}"
        # Persist ownership before creation; never replace or prune an unfinished worktree.
        self.state.update(status="active", task_id=task_id, worktree=str(wt),
                          session_id=str(uuid.uuid4()), session_started=False, handoff=None,
                          failures=0, stagnant=0, next_check=0)
        self.save()
        command(["git", "worktree", "add", "-q", "--detach", str(wt), "origin/main"], self.repo)
        deps = wt / "nuke_frontend/node_modules"
        if not deps.exists():
            deps.symlink_to(self.repo / "nuke_frontend/node_modules", target_is_directory=True)
        (wt / ".night").mkdir()
        law = Path.home() / "lofficiel-concierge/supabase/SCHEMA_LAW.md"
        if law.exists():
            shutil.copyfile(law, wt / ".night/SCHEMA_LAW.md")
        exclude = Path(command(["git", "rev-parse", "--path-format=absolute", "--git-path", "info/exclude"], wt))
        with exclude.open("a+") as out:
            out.seek(0)
            if ".night/" not in out.read().splitlines():
                out.write("\n.night/\n")

    def worktree(self):
        wt = Path(self.state["worktree"])
        if not wt.is_dir():
            raise ValueError("unfinished worktree is missing; refusing to recreate it")
        owner = command(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], wt)
        expected = command(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], self.repo)
        if owner != expected:
            raise ValueError("worktree belongs to a different repository")
        return wt

    def pr_state(self, prs):
        return [json.loads(command(["gh", "pr", "view", str(pr), "--repo", "sss97133/nuke", "--json",
            "number,state,headRefOid,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup"])) for pr in prs]

    def accept(self, handoff, wt):
        if not isinstance(handoff, dict) or set(handoff) != set(FIELDS):
            raise ValueError("missing or malformed structured handoff")
        for key in ("objective", "next_action", "progress", "blocker", "unblock_condition"):
            if not isinstance(handoff[key], str):
                raise ValueError(f"invalid {key}")
        if not handoff["objective"].strip() or not isinstance(handoff["acceptance"], list) or not handoff["acceptance"] or any(
                not isinstance(c, str) or not c.strip() for c in handoff["acceptance"]):
            raise ValueError("objective and acceptance criteria are required")
        if handoff["status"] not in FIELDS["status"]["enum"]:
            raise ValueError("unknown handoff status")
        if not isinstance(handoff["prs"], list) or any(type(p) is not int or p < 1 for p in handoff["prs"]):
            raise ValueError("invalid PR numbers")
        if not isinstance(handoff["superseded_prs"], list) or any(not isinstance(e, dict)
                or set(e) != {"pr", "replacement"} or any(type(v) is not int or v not in handoff["prs"] for v in e.values())
                or e["pr"] == e["replacement"] for e in handoff["superseded_prs"]):
            raise ValueError("superseded PRs must name distinct recorded original/replacement PRs")
        if not isinstance(handoff["evidence"], list) or any(not isinstance(e, dict) or set(e) != {"criterion", "receipt"}
                or any(not isinstance(v, str) for v in e.values()) for e in handoff["evidence"]):
            raise ValueError("invalid evidence")
        previous = self.state.get("handoff")
        if previous and any(handoff[k] != previous[k] for k in ("objective", "acceptance")):
            raise ValueError("unfinished objective/acceptance changed; preserve it and report a blocker instead")
        if previous and not set(previous["prs"]).issubset(handoff["prs"]):
            raise ValueError("previous PRs disappeared from the handoff")
        if handoff["status"] != "complete" and not handoff["next_action"].strip():
            raise ValueError("unfinished work needs a concrete next action")
        if handoff["status"] == "blocked" and not (handoff["blocker"].strip() and handoff["unblock_condition"].strip()):
            raise ValueError("blocked needs a reason and unblock condition")
        if not previous:
            # Even a premature completion claim must not erase the selected objective.
            self.state["handoff"] = {**handoff, "status": "active"}
            self.save()
        prs = self.pr_state(handoff["prs"]) if handoff["prs"] else []
        if handoff["status"] == "waiting_review" and not any(p["state"] == "OPEN" for p in prs):
            raise ValueError("waiting_review requires an open PR")
        if handoff["status"] == "complete":
            # Mechanical minimum, NOT an independent proof of the model's semantic claims.
            merged = {p["number"] for p in prs if p["state"] == "MERGED"}
            replaced = {e["pr"] for e in handoff["superseded_prs"] if e["replacement"] in merged}
            if any(p["state"] != "MERGED" and not (p["state"] == "CLOSED" and p["number"] in replaced) for p in prs):
                raise ValueError("unmerged PRs need review or a closed supersession with a merged replacement")
            evidenced = {e["criterion"] for e in handoff["evidence"] if e["receipt"] and (wt / e["receipt"]).is_file()}
            if not set(handoff["acceptance"]).issubset(evidenced):
                raise ValueError("completion needs an existing receipt for every acceptance criterion")
            if command(["git", "status", "--porcelain"], wt):
                raise ValueError("uncommitted work cannot be reported as complete")
        stagnant = self.state.get("stagnant", 0) + 1 if previous == handoff else 0
        self.state.update(handoff=handoff, status=handoff["status"], pr_snapshot=prs,
                          stagnant=stagnant, failures=0, reason=handoff["blocker"], next_check=0)
        if stagnant >= 2 and handoff["status"] == "active":
            self.state.update(status="blocked", reason="Three identical handoffs without progress; inspect then --resume.")
        if self.state["status"] == "complete":
            self.state["completion_basis"] = "agent-reported acceptance receipts; clean worktree; linked PRs merged or closed with recorded merged replacements"
            self.state["completed_day"] = self.state["budget_day"]
            atomic_json(self.logs / f"task-{self.state['task_id']}.json", self.state)
        self.save()
        self.note(f"{self.state['status']}: {handoff['objective']} | next: {handoff['next_action']} | {self.state['reason']}")

    def agent_command(self, prompt, identity, remaining):
        return ["/usr/bin/caffeinate", "-i", "/opt/homebrew/bin/gtimeout", "-k", "10", f"{int(remaining)}s",
                "/opt/homebrew/bin/dotenvx", "run", "-q", "-f", str(self.repo / ".env"), "--", "env", "-u", "ANTHROPIC_API_KEY",
                "claude", "-p", prompt, *identity, "--model", os.environ.get("NIGHT_RUN_MODEL", "claude-opus-5-5"),
                "--permission-mode", "acceptEdits", "--allowedTools", *ALLOWED, "--disallowedTools", *DENIED,
                "--output-format", "json", "--json-schema", json.dumps(SCHEMA)]

    def invoke(self, wt, remaining, lock_fd):
        self.state["attempts"] += 1
        attempt = self.state["attempts"]
        prompt = (f"Today: {dt.datetime.now().astimezone().isoformat()}. Task: {self.state['task_id']}. "
                  f"Remaining allowance: {int(remaining)} seconds. Report: {self.logs / (str(dt.datetime.now(dt.timezone.utc).date()) + '.md')}.\n"
                  f"Shared lane/history location: {self.repo}/.claude/LANES.md and {self.repo}/DONE.md (targeted recent reads).\n"
                  f"Controller feedback: {self.state.get('reason', '')}\n"
                  f"Persistent handoff (preserve objective and acceptance exactly):\n{json.dumps(self.state.get('handoff'))}\n\n"
                  + command(["git", "show", "origin/main:scripts/night-run/work-order.md"], self.repo))
        identity = ["--resume", self.state["session_id"]] if self.state["session_started"] else ["--session-id", self.state["session_id"]]
        args = self.agent_command(prompt, identity, remaining)
        # Reserve before spawn. An interrupted controller never refunds an unknown attempt.
        self.state.update(spent_seconds=self.state["spent_seconds"] + remaining,
                          session_started=True, in_flight={"attempt": attempt, "reserved_seconds": remaining, "started_at": time.time()})
        self.save()
        started = time.monotonic()
        out_path = self.logs / f"{self.state['task_id']}-{attempt}.json"
        err_path = out_path.with_suffix(".stderr.txt")
        with out_path.open("w") as out, err_path.open("w") as err:
            # gtimeout bounds the entire foreground process group even if this supervisor dies.
            # The inherited lock also prevents another wake-up while the child still holds it.
            result = subprocess.run(args, cwd=wt, stdout=out, stderr=err, stdin=subprocess.DEVNULL,
                                    start_new_session=True, pass_fds=(lock_fd,))
        elapsed = min(remaining, time.monotonic() - started)
        self.state["spent_seconds"] -= remaining - elapsed
        self.state.pop("in_flight", None)
        self.state.update(last_exit_code=result.returncode, last_attempt_seconds=elapsed)
        self.save()
        if result.returncode in (124, 137):
            self.note(f"Invocation interrupted by deadline/kill (exit {result.returncode}); objective retained, budget not reset.")
            return 0
        try:
            envelope = json.loads(out_path.read_text())
        except (ValueError, OSError):
            return self.fail(f"CLI exit {result.returncode}; no valid JSON result. See {out_path.name} / {err_path.name}.")
        if not isinstance(envelope, dict):
            return self.fail(f"CLI exit {result.returncode}; JSON result is not an object. See {out_path.name}.")
        if envelope.get("is_error") and re.search(
                r"rate.?limit|usage.?limit|hit your limit|quota exceeded", json.dumps(envelope), re.I):
            self.state.update(next_check=time.time() + 21600, reason="Subscription limit; retry in six hours with the same objective/session.")
            self.save()
            self.note(self.state["reason"])
            return 0
        if result.returncode or envelope.get("is_error") or envelope.get("session_id") != self.state["session_id"]:
            # Never switch to API billing or fresh context to evade a subscription/auth/resume error.
            return self.fail(f"CLI exit {result.returncode}, subtype {envelope.get('subtype', 'unknown')}; see {out_path.name}.")
        try:
            self.accept(envelope.get("structured_output"), wt)
        except (ValueError, OSError, subprocess.SubprocessError) as exc:
            return self.fail(str(exc))
        return 0

    def tick(self, lock_fd):
        now = time.time()
        day = budget_day(now)
        if self.state.get("budget_day") != day:
            self.state.update(budget_day=day, spent_seconds=0)
        if self.state.pop("in_flight", None):
            self.note("Recovered interrupted invocation; reservation retained, session will resume within budget.")
        self.save()
        if self.state["status"] == "blocked":
            print(f"blocked: {self.state.get('reason')}")
            return 0
        if now < self.state.get("next_check", 0):
            return 0
        if self.state["status"] == "waiting_review":
            snapshot = self.pr_state(self.state["handoff"]["prs"])
            if snapshot == self.state.get("pr_snapshot"):
                return 0  # no inference for an unchanged review/check/deployment gate
            self.state.update(pr_snapshot=snapshot, status="active", reason="PR state changed; inspect it and continue the same objective.")
            self.save()
        remaining = int(self.cap - self.state["spent_seconds"])
        if remaining <= 0:
            local = dt.datetime.fromtimestamp(now)
            next_window = local.replace(hour=1, minute=30, second=0, microsecond=0) + dt.timedelta(days=1)
            self.state.update(next_check=next_window.timestamp(), reason="Daily execution allowance exhausted; resume at next 01:30 local window.")
            self.save()
            return 0
        if self.state["status"] in ("idle", "complete"):
            self.prepare()
        return self.invoke(self.worktree(), remaining, lock_fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="show state/config; no model, fetch or worktree mutation")
    parser.add_argument("--resume", action="store_true", help="retry a resolved blocker, preserving objective/session and budget")
    args = parser.parse_args()
    controller = Controller()
    if args.dry_run:
        print(json.dumps({"state": controller.state, "daily_cap_seconds": controller.cap,
                          "budget_window": "01:30 local to next 01:30", "logs": str(controller.logs)}, indent=2))
        return 0
    controller.logs.mkdir(parents=True, exist_ok=True)
    with (controller.logs / "controller.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Another night-run invocation owns the lock; no work started.")
            return 0
        # Read only after locking: another process may have committed a newer checkpoint.
        controller = Controller()
        if args.resume:
            controller.state.update(status="active" if controller.state.get("worktree") else "idle", failures=0, stagnant=0, next_check=0)
            controller.save()
        try:
            return controller.tick(lock.fileno())
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            return controller.fail(f"{type(exc).__name__}: {exc}")


if __name__ == "__main__":
    sys.exit(main())
