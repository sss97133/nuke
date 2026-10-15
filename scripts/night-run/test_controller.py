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
           "blocker": "", "unblock_condition": "", "ready_actions": [], "prs": [], "superseded_prs": [], "evidence": []}
READER_INSPECTION = ("Read loadVehicleData.ts and useVehicleHeaderData.ts to identify the existing anon RPC "
                     "and acceptance criterion 4 evidence, independently of PR review.")


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

    def invoke(self, output=None, rc=0, sleep=0, tick=False):
        payload = output if output is not None else {"session_id": self.controller.state["session_id"], "structured_output": HANDOFF}
        # Actual child process; captures the selected session flags, then returns CLI-shaped JSON.
        program = "import sys,time; time.sleep(float(sys.argv[1])); print(sys.argv[2]); sys.exit(int(sys.argv[3]))"
        with patch.object(self.controller, "agent_command", return_value=[sys.executable, "-c", program, str(sleep), json.dumps(payload), str(rc)]) as cmd, patch.object(self.controller, "worktree", return_value=self.wt):
            result = self.controller.tick(self.lock.fileno()) if tick else self.controller.invoke(self.wt, 5, self.lock.fileno())
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

    def test_completed_step_can_advance_mandate_with_remaining_daily_budget(self):
        self.controller.state.update(status="complete", completed_day=c.budget_day(time.time()), spent_seconds=100)
        with patch.object(self.controller, "prepare") as prepare, patch.object(self.controller, "worktree", return_value=self.wt), patch.object(self.controller, "invoke", return_value=0) as invoke:
            self.controller.tick(self.lock.fileno())
            prepare.assert_called_once()
            self.assertEqual(invoke.call_args.args[1], 2600)

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

    def test_pending_review_continues_independent_reader_inspection_in_same_session(self):
        self.invoke()
        first = copy.deepcopy(self.controller.state)
        pending = [{"number": 123, "state": "OPEN", "headRefOid": "a"}]
        handoff = {**HANDOFF, "status": "waiting_review", "prs": [123], "ready_actions": [READER_INSPECTION],
                   "next_action": "Independent of review: " + READER_INSPECTION,
                   "blocker": "Merge requires review and remains held for the unattended runner",
                   "unblock_condition": "The authorized owner merges the reviewed PR"}
        payload = {"session_id": first["session_id"], "structured_output": handoff}
        with patch.object(self.controller, "pr_state", return_value=pending):
            self.assertEqual(self.invoke(payload)[0], 0)
        self.controller = c.Controller()
        with patch.object(self.controller, "pr_state", return_value=pending):
            result, identity = self.invoke(payload, tick=True)
        self.assertEqual(result, 0)
        self.assertEqual(identity, ["--resume", first["session_id"]])
        self.assertEqual(self.controller.state["status"], "active")
        self.assertEqual(self.controller.state["worktree"], first["worktree"])
        self.assertEqual(self.controller.state["handoff"]["acceptance"], first["handoff"]["acceptance"])
        self.assertEqual(self.controller.state["handoff"]["blocker"], handoff["blocker"])
        self.assertGreater(self.controller.state["spent_seconds"], first["spent_seconds"])

    def test_ready_work_does_not_remove_dependent_production_hold(self):
        handoff = {**HANDOFF, "status": "blocked", "ready_actions": [READER_INSPECTION],
                   "blocker": "Production writes are not authorized", "unblock_condition": "Explicit owner authorization"}
        self.controller.accept(handoff, self.wt)
        self.assertEqual(self.controller.state["status"], "active")
        self.assertEqual(self.controller.state["handoff"]["status"], "blocked")
        self.assertEqual(self.controller.state["handoff"]["unblock_condition"], "Explicit owner authorization")
        # Once independent work is exhausted, the production hold still stops invocation.
        self.controller.accept({**handoff, "ready_actions": []}, self.wt)
        with patch.object(self.controller, "invoke") as invoke:
            self.controller.tick(self.lock.fileno())
            invoke.assert_not_called()
        self.assertEqual(self.controller.state["status"], "blocked")

    def test_identical_blocked_handoffs_with_ready_work_still_trigger_stagnation_stop(self):
        self.invoke()
        handoff = {**HANDOFF, "status": "blocked", "ready_actions": [READER_INSPECTION],
                   "blocker": "Production write held", "unblock_condition": "Owner approval"}
        for _ in range(3):
            self.controller.accept(handoff, self.wt)
        self.assertEqual(self.controller.state["status"], "blocked")
        self.assertIn("Three identical", self.controller.state["reason"])
        with patch.object(self.controller, "invoke") as invoke:
            self.controller.tick(self.lock.fileno())
            invoke.assert_not_called()

    def legacy_checkpoint(self, status="waiting_review"):
        handoff = {**HANDOFF, "status": status, "next_action": "Independent of review: " + READER_INSPECTION,
                   "blocker": "Review-dependent change held", "unblock_condition": "Review resolves",
                   "prs": [123] if status == "waiting_review" else []}
        del handoff["ready_actions"]
        pending = [{"number": 123, "state": "OPEN", "headRefOid": "a"}]
        self.controller.state.update(status=status, handoff=handoff, session_started=True, pr_snapshot=pending)
        self.controller.save()
        return handoff, pending

    def test_legacy_waiting_checkpoint_gets_one_reassessment_then_cheap_wait(self):
        legacy, pending = self.legacy_checkpoint()
        sid = self.controller.state["session_id"]
        with patch.object(self.controller, "pr_state", return_value=pending):
            result, identity = self.invoke({"session_id": sid, "structured_output": {**legacy, "ready_actions": []}}, tick=True)
        self.assertEqual(result, 0)
        self.assertEqual(identity, ["--resume", sid])
        self.assertTrue(self.controller.state["ready_actions_reassessed"])
        self.assertEqual(self.controller.state["handoff"]["objective"], legacy["objective"])
        self.controller = c.Controller()
        with patch.object(self.controller, "pr_state", return_value=pending), patch.object(self.controller, "invoke") as invoke:
            self.controller.tick(self.lock.fileno())
            invoke.assert_not_called()

    def test_legacy_agent_blocked_checkpoint_can_identify_independent_ready_work(self):
        legacy, _ = self.legacy_checkpoint("blocked")
        result, _ = self.invoke({"session_id": self.controller.state["session_id"],
                                "structured_output": {**legacy, "ready_actions": [READER_INSPECTION]}}, tick=True)
        self.assertEqual(result, 0)
        self.assertEqual(self.controller.state["status"], "active")
        self.assertEqual(self.controller.state["handoff"]["blocker"], legacy["blocker"])

    def test_legacy_blocked_assessment_restores_hold_when_no_ready_work_remains(self):
        legacy, _ = self.legacy_checkpoint("blocked")
        self.assertEqual(self.invoke({"session_id": self.controller.state["session_id"],
                                      "structured_output": {**legacy, "ready_actions": []}}, tick=True)[0], 0)
        self.assertEqual(self.controller.state["status"], "blocked")
        self.assertEqual(self.controller.state["handoff"]["blocker"], legacy["blocker"])
        with patch.object(self.controller, "invoke") as invoke:
            self.controller.tick(self.lock.fileno())
            invoke.assert_not_called()

    def test_legacy_reassessment_respects_budget_backoff_and_controller_stops(self):
        for overrides in ({"spent_seconds": 2700}, {"next_check": time.time() + 21600},
                          {"failures": 3}, {"stagnant": 2}):
            with self.subTest(overrides=overrides):
                self.legacy_checkpoint("blocked")
                self.controller.state.update(spent_seconds=0, next_check=0, failures=0, stagnant=0,
                                             ready_actions_reassessed=False)
                self.controller.state.update(overrides)
                with patch.object(self.controller, "invoke") as invoke:
                    self.controller.tick(self.lock.fileno())
                    invoke.assert_not_called()
                self.assertFalse(self.controller.state["ready_actions_reassessed"])

    def test_interrupted_legacy_reassessment_resumes_same_session_after_budget_renews(self):
        legacy, pending = self.legacy_checkpoint()
        sid = self.controller.state["session_id"]
        self.assertEqual(self.invoke({}, rc=124, tick=True)[0], 0)
        self.controller = c.Controller()
        self.assertTrue(self.controller.state["ready_actions_reassessed"])
        self.assertEqual(self.controller.state["status"], "active")
        self.assertEqual(self.controller.state["handoff"], legacy)
        self.controller.state["spent_seconds"] = self.controller.cap
        with patch.object(self.controller, "invoke") as invoke:
            self.controller.tick(self.lock.fileno())
            invoke.assert_not_called()
        resume_at = self.controller.state["next_check"] + 1
        self.controller = c.Controller()
        with patch.object(c.time, "time", return_value=resume_at), patch.object(self.controller, "pr_state", return_value=pending):
            result, identity = self.invoke({"session_id": sid, "structured_output": {**legacy, "ready_actions": []}}, tick=True)
        self.assertEqual(result, 0)
        self.assertEqual(identity, ["--resume", sid])
        self.assertEqual(self.controller.state["worktree"], str(self.wt))
        self.assertTrue(self.controller.state["ready_actions_reassessed"])
        self.assertLess(self.controller.state["spent_seconds"], self.controller.cap)
        self.assertEqual(self.controller.state["budget_day"], c.budget_day(resume_at))
        self.assertEqual(self.controller.state["status"], "waiting_review")
        with patch.object(c.time, "time", return_value=resume_at + 1), patch.object(self.controller, "pr_state", return_value=pending), patch.object(self.controller, "invoke") as invoke:
            self.controller.tick(self.lock.fileno())
            invoke.assert_not_called()

    def test_crashed_legacy_reassessment_retains_active_state_and_reserved_budget(self):
        legacy, _ = self.legacy_checkpoint("blocked")
        with patch.object(self.controller, "worktree", return_value=self.wt), patch.object(c.subprocess, "run", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.controller.tick(self.lock.fileno())
        self.controller = c.Controller()
        self.assertTrue(self.controller.state["ready_actions_reassessed"])
        self.assertEqual(self.controller.state["status"], "active")
        self.assertEqual(self.controller.state["handoff"], legacy)
        self.assertEqual(self.controller.state["spent_seconds"], self.controller.cap)
        with patch.object(self.controller, "invoke") as invoke:
            self.controller.tick(self.lock.fileno())
            invoke.assert_not_called()
        self.assertNotIn("in_flight", self.controller.state)
        self.assertEqual(self.controller.state["spent_seconds"], self.controller.cap)

    def test_usage_refusal_defers_active_legacy_reassessment_for_six_hours(self):
        self.legacy_checkpoint()
        self.assertEqual(self.invoke({"is_error": True, "result": "You've hit your limit"}, rc=1, tick=True)[0], 0)
        self.assertTrue(self.controller.state["ready_actions_reassessed"])
        self.assertEqual(self.controller.state["status"], "active")
        self.assertGreater(self.controller.state["next_check"], time.time() + 21000)
        with patch.object(self.controller, "invoke") as invoke:
            self.controller.tick(self.lock.fileno())
            invoke.assert_not_called()

    def test_ready_action_types_and_nonempty_descriptions_are_required(self):
        for actions in (None, "inspect", {}, [None], [True], [1], [""], ["   "], [{}]):
            with self.subTest(actions=actions), self.assertRaisesRegex(ValueError, "ready_actions"):
                self.controller.accept({**HANDOFF, "ready_actions": actions}, self.wt)
        missing = dict(HANDOFF)
        del missing["ready_actions"]
        with self.assertRaisesRegex(ValueError, "structured handoff"):
            self.controller.accept(missing, self.wt)

    def test_completion_with_ready_work_is_rejected_without_losing_objective(self):
        self.invoke()
        original = copy.deepcopy(self.controller.state["handoff"])
        with self.assertRaisesRegex(ValueError, "ready actions"):
            self.controller.accept({**HANDOFF, "status": "complete", "ready_actions": [READER_INSPECTION]}, self.wt)
        self.assertEqual(self.controller.state["handoff"], original)
        self.assertEqual(self.controller.state["status"], "active")

    def test_premature_completion_does_not_erase_goal(self):
        with patch.object(self.controller, "pr_state", return_value=[{"state": "OPEN"}]):
            with self.assertRaisesRegex(ValueError, "unmerged"):
                self.controller.accept({**HANDOFF, "status": "complete", "prs": [123]}, self.wt)
        self.assertEqual(self.controller.state["handoff"]["objective"], HANDOFF["objective"])
        self.assertEqual(self.controller.state["status"], "active")

    def test_closed_superseded_pr_requires_a_recorded_merged_replacement(self):
        (self.wt / "receipt.md").write_text("Accepted evidence")
        complete = {**HANDOFF, "status": "complete", "prs": [123, 124],
                    "evidence": [{"criterion": HANDOFF["acceptance"][0], "receipt": "receipt.md"}]}
        prs = [{"number": 123, "state": "CLOSED"}, {"number": 124, "state": "MERGED"}]
        with patch.object(self.controller, "pr_state", return_value=prs), patch.object(c, "command", return_value=""):
            with self.assertRaisesRegex(ValueError, "unmerged"):
                self.controller.accept(complete, self.wt)
            self.controller.accept({**complete, "superseded_prs": [{"pr": 123, "replacement": 124}]}, self.wt)
        self.assertEqual(self.controller.state["status"], "complete")
        self.assertEqual(self.controller.state["handoff"]["prs"], [123, 124])

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
