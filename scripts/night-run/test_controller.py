#!/usr/bin/env python3
"""Offline process/state contracts: no models, network, production DB or downloads."""
import copy
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("night_controller", Path(__file__).with_name("controller.py"))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

HANDOFF = {"objective": "Make an existing source failure diagnosable", "acceptance": ["receipt demonstrates the source failure"],
           "status": "active", "next_action": "Inspect the retained capture and its writer", "progress": "Located the writer",
           "blocker": "", "unblock_condition": "", "prs": [], "evidence": []}


class ContinuationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.logs = self.root / "logs"
        self.logs.mkdir()
        self.wt = self.root / "worktree"
        self.wt.mkdir()
        self.env = patch.dict(os.environ, {"NIGHT_RUN_LOG_DIR": str(self.logs), "NIGHT_RUN_REPO": str(self.root), "NIGHT_RUN_CAP": "45m"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.controller = c.Controller()
        self.controller.state.update(status="active", task_id="test-task", worktree=str(self.wt),
            session_id="53fefc57-ea50-400d-978d-ed86efce7a6c", session_started=False, handoff=None,
            budget_day=c.budget_day(time.time()), spent_seconds=0)
        self.controller.save()
        self.lock = (self.logs / "controller.lock").open("a")
        self.addCleanup(self.lock.close)
        self.command = patch.object(c, "command", return_value="test work order")
        self.command.start()
        self.addCleanup(self.command.stop)

    def invoke(self, output=None, rc=0, sleep=0):
        payload = output if output is not None else {"session_id": self.controller.state["session_id"], "structured_output": HANDOFF}
        # Actual child process; captures the selected session flags, then returns CLI-shaped JSON.
        program = "import sys,time; time.sleep(float(sys.argv[1])); print(sys.argv[2]); sys.exit(int(sys.argv[3]))"
        with patch.object(self.controller, "agent_command", return_value=[sys.executable, "-c", program, str(sleep), json.dumps(payload), str(rc)]) as cmd:
            result = self.controller.invoke(self.wt, 5, self.lock.fileno())
            return result, cmd.call_args.args[1]

    def test_two_independent_invocations_resume_same_goal_and_session(self):
        result, identity = self.invoke()
        self.assertEqual(result, 0)
        self.assertEqual(identity[0], "--session-id")
        first = copy.deepcopy(self.controller.state)
        # Reload from disk as a subsequent timer process would, with no in-memory continuation.
        self.controller = c.Controller()
        payload = {"session_id": first["session_id"], "structured_output": {**HANDOFF, "progress": "Reproduced the failure", "next_action": "Repair existing parser"}}
        result, identity = self.invoke(payload)
        self.assertEqual(identity, ["--resume", first["session_id"]])
        self.assertEqual(result, 0)
        self.assertEqual(self.controller.state["handoff"]["objective"], first["handoff"]["objective"])
        self.assertEqual(self.controller.state["worktree"], first["worktree"])
        self.assertEqual(self.controller.state["status"], "active")
        self.assertGreater(self.controller.state["spent_seconds"], first["spent_seconds"])

    def test_invalid_envelope_and_three_failures_never_complete(self):
        self.invoke()
        goal = copy.deepcopy(self.controller.state["handoff"])
        for _ in range(3):
            self.assertEqual(self.invoke([])[0], 1)
        self.assertEqual(self.controller.state["handoff"], goal)
        self.assertEqual(self.controller.state["status"], "blocked")
        self.assertIn("Three consecutive", self.controller.state["reason"])

    def test_usage_limit_waits_and_preserves_session_without_permanent_block(self):
        self.invoke()
        sid = self.controller.state["session_id"]
        for _ in range(4):
            self.assertEqual(self.invoke({"is_error": True, "result": "You've hit your limit; resets later"}, rc=1)[0], 0)
        self.assertEqual(self.controller.state["status"], "active")
        self.assertGreater(self.controller.state["next_check"], time.time() + 21000)
        self.assertEqual(self.controller.state["session_id"], sid)

    def test_timeout_preserves_objective_and_records_elapsed_budget(self):
        self.invoke()
        self.assertEqual(self.invoke({}, rc=124)[0], 0)
        self.assertEqual(self.controller.state["status"], "active")
        self.assertIsNotNone(self.controller.state["handoff"])
        self.assertNotIn("in_flight", self.controller.state)

    def test_real_deadline_terminates_descendant_process(self):
        timeout = shutil.which("gtimeout") or shutil.which("timeout")
        self.assertIsNotNone(timeout, "GNU timeout is required by this runner")
        marker = self.root / "orphan-write"
        child = "import time; from pathlib import Path; time.sleep(2); Path(" + repr(str(marker)) + ").write_text('orphan')"
        parent = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',sys.argv[1]]); time.sleep(10)"
        with patch.object(self.controller, "agent_command", return_value=[timeout, "-k", "1", "1s", sys.executable, "-c", parent, child]):
            self.assertEqual(self.controller.invoke(self.wt, 5, self.lock.fileno()), 0)
        time.sleep(1.3)
        self.assertFalse(marker.exists(), "a descendant survived the deadline")
        self.assertEqual(self.controller.state["last_exit_code"], 124)

    def test_crash_reservation_prevents_relaunch(self):
        self.controller.state.update(spent_seconds=2700, in_flight={"attempt": 1, "reserved_seconds": 2700})
        self.controller.save()
        restarted = c.Controller()
        with patch.object(restarted, "invoke") as invoke:
            self.assertEqual(restarted.tick(self.lock.fileno()), 0)
            invoke.assert_not_called()
        self.assertEqual(restarted.state["spent_seconds"], 2700)

    def test_budget_renews_without_discarding_unfinished_goal(self):
        self.invoke()
        goal = self.controller.state["handoff"]
        self.controller.state.update(budget_day="2000-01-01", spent_seconds=2700)
        with patch.object(self.controller, "worktree", return_value=self.wt), patch.object(self.controller, "invoke", return_value=0) as invoke:
            self.controller.tick(self.lock.fileno())
            self.assertEqual(invoke.call_args.args[1], 2700)
        self.assertEqual(self.controller.state["handoff"], goal)

    def test_pending_review_is_cheap_and_merge_resumes_same_objective(self):
        self.invoke()
        pending = [{"number": 123, "state": "OPEN", "headRefOid": "a"}]
        handoff = {**HANDOFF, "status": "waiting_review", "prs": [123]}
        with patch.object(self.controller, "pr_state", return_value=pending):
            self.controller.accept(handoff, self.wt)
            with patch.object(self.controller, "invoke") as invoke:
                self.controller.tick(self.lock.fileno())
                invoke.assert_not_called()
        with patch.object(self.controller, "pr_state", return_value=[{**pending[0], "state": "MERGED"}]), patch.object(self.controller, "worktree", return_value=self.wt), patch.object(self.controller, "invoke", return_value=0) as invoke:
            self.controller.tick(self.lock.fileno())
            invoke.assert_called_once()
        self.assertEqual(self.controller.state["handoff"]["objective"], HANDOFF["objective"])

    def test_premature_completion_does_not_erase_goal(self):
        with patch.object(self.controller, "pr_state", return_value=[{"state": "OPEN"}]):
            with self.assertRaisesRegex(ValueError, "unmerged"):
                self.controller.accept({**HANDOFF, "status": "complete", "prs": [123]}, self.wt)
        self.assertEqual(self.controller.state["handoff"]["objective"], HANDOFF["objective"])
        self.assertEqual(self.controller.state["status"], "active")

    def test_missing_receipt_dirty_work_or_redefined_goal_cannot_complete(self):
        self.invoke()
        with self.assertRaisesRegex(ValueError, "changed"):
            self.controller.accept({**HANDOFF, "acceptance": ["just open a PR"]}, self.wt)
        complete = {**HANDOFF, "status": "complete", "evidence": [{"criterion": HANDOFF["acceptance"][0], "receipt": ".night/receipt.md"}]}
        with self.assertRaisesRegex(ValueError, "receipt"):
            self.controller.accept(complete, self.wt)
        (self.wt / ".night").mkdir()
        (self.wt / ".night/receipt.md").write_text("Measured evidence")
        with self.assertRaisesRegex(ValueError, "uncommitted"):
            self.controller.accept(complete, self.wt)
        with patch.object(c, "command", return_value=""):
            self.controller.accept(complete, self.wt)
        self.assertEqual(self.controller.state["status"], "complete")
        self.assertTrue((self.logs / "task-test-task.json").exists())

    def test_missing_worktree_is_not_recreated(self):
        self.wt.rmdir()
        with self.assertRaisesRegex(ValueError, "missing"):
            self.controller.worktree()
        self.assertFalse(self.wt.exists())

    def test_concurrent_timer_process_does_not_start_agent(self):
        fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        proc = subprocess.run([sys.executable, str(Path(c.__file__))], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0)
        self.assertIn("owns the lock", proc.stdout)
        self.assertEqual(c.Controller().state["attempts"], 0)

    def test_piped_launchd_entry_point_loads_controller_from_git(self):
        repo = self.root / "repo"
        repo.mkdir()
        source = Path(c.__file__).parent
        target = repo / "scripts/night-run"
        target.mkdir(parents=True)
        for name in ("run.sh", "controller.py"):
            shutil.copyfile(source / name, target / name)
        def git(*args):
            return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)
        git("init", "-q")
        git("add", ".")
        git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false",
            "-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture")
        git("update-ref", "refs/remotes/origin/main", "HEAD")
        with patch.dict(os.environ, {"NIGHT_RUN_REPO": str(repo)}):
            proc = subprocess.run(["bash", "-s", "--", "--dry-run"], input=(target / "run.sh").read_text(), capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["daily_cap_seconds"], 2700)

    def test_dry_run_is_read_only(self):
        before = self.controller.state_file.read_bytes()
        proc = subprocess.run([sys.executable, str(Path(c.__file__)), "--dry-run"], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(self.controller.state_file.read_bytes(), before)
        self.assertEqual(json.loads(proc.stdout)["daily_cap_seconds"], 2700)


if __name__ == "__main__":
    unittest.main()
