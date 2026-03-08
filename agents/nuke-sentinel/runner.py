#!/usr/bin/env python3
"""
Nuke Sentinel Runner
Main loop for the persistent monitoring agent.
Designed to run on Orgo VM with Claude API access.
"""

import os
import json
import time
import subprocess
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional

# Import live feed monitor
from feeds import run_live_feed

AGENT_DIR = Path(__file__).parent
CONFIG_FILE = AGENT_DIR / "config.json"
TASKS_DIR = AGENT_DIR / "tasks"
LOGS_DIR = AGENT_DIR / "logs"
REPORTS_DIR = AGENT_DIR / "reports"
ALERTS_DIR = AGENT_DIR / "alerts"


class NukeSentinel:
    def __init__(self):
        self.config = self._load_config()
        self.running = True

    def _load_config(self):
        with open(CONFIG_FILE) as f:
            return json.load(f)

    def _load_tasks(self):
        """Load all tasks, sorted by priority."""
        tasks = []
        for task_file in TASKS_DIR.glob("*.json"):
            with open(task_file) as f:
                task = json.load(f)
                task["_file"] = task_file
                tasks.append(task)
        return sorted(tasks, key=lambda t: t.get("priority", 99))

    def _should_run_task(self, task: dict) -> bool:
        """Check if task is due to run based on schedule."""
        if task.get("status") == "disabled":
            return False

        last_run = task.get("last_run")
        if not last_run:
            return True

        schedule = task.get("schedule", "")
        last_dt = datetime.fromisoformat(last_run)
        now = datetime.now()

        if "hours" in schedule:
            hours = int(schedule.split()[1])
            return now > last_dt + timedelta(hours=hours)
        elif "minutes" in schedule or "mins" in schedule:
            mins = int(schedule.split()[1])
            return now > last_dt + timedelta(minutes=mins)
        elif schedule == "daily":
            return now.date() > last_dt.date()

        return True

    def _update_task(self, task: dict, updates: dict):
        """Update task file with new values."""
        task_file = task["_file"]
        del task["_file"]
        task.update(updates)
        with open(task_file, 'w') as f:
            json.dump(task, f, indent=2)

    def _log(self, message: str, level: str = "INFO"):
        """Write to log file."""
        timestamp = datetime.now().isoformat()
        log_line = f"[{timestamp}] [{level}] {message}"
        print(log_line)

        log_file = LOGS_DIR / f"{datetime.now().strftime('%Y-%m-%d')}.log"
        with open(log_file, 'a') as f:
            f.write(log_line + "\n")

    def _create_alert(self, severity: str, alert_type: str, message: str, data: dict = None):
        """Create an alert."""
        alert = {
            "timestamp": datetime.now().isoformat(),
            "severity": severity,
            "type": alert_type,
            "message": message,
            "data": data or {},
            "acknowledged": False
        }

        alert_file = ALERTS_DIR / f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{severity}.json"
        with open(alert_file, 'w') as f:
            json.dump(alert, f, indent=2)

        self._log(f"ALERT [{severity}]: {message}", "ALERT")

        # TODO: Send to Supabase, Telegram, etc.
        return alert

    # Task Handlers

    def run_tool_scout(self, task: dict) -> dict:
        """Search for new Claude tools and resources."""
        self._log("Starting tool-scout task")

        params = task.get("params", {})
        keywords = params.get("keywords", ["claude code"])

        findings = []

        # Search Hacker News
        for keyword in keywords[:3]:  # Limit to avoid rate limits
            self._log(f"  Searching HN for: {keyword}")
            # In real implementation, use web search API
            # findings.extend(self._search_hn(keyword))

        # Generate report
        report = {
            "generated_at": datetime.now().isoformat(),
            "task_id": task["id"],
            "keywords_searched": keywords,
            "findings": findings,
            "summary": f"Searched {len(keywords)} keywords, found {len(findings)} items"
        }

        report_file = REPORTS_DIR / f"tool-scout-{datetime.now().strftime('%Y%m%d-%H%M')}.json"
        with open(report_file, 'w') as f:
            json.dump(report, f, indent=2)

        self._log(f"  Report saved: {report_file.name}")
        return {"status": "completed", "report": str(report_file)}

    def run_pipeline_health(self, task: dict) -> dict:
        """Check Nuke extraction pipeline health."""
        self._log("Starting pipeline-health task")

        # Get coordinator brief
        supabase_url = os.getenv(self.config["nuke"]["supabase_url_env"])
        supabase_key = os.getenv(self.config["nuke"]["supabase_key_env"])

        if not supabase_url or not supabase_key:
            self._log("  Supabase credentials not available", "WARN")
            return {"status": "skipped", "reason": "no credentials"}

        # Call coordinator
        try:
            import urllib.request
            import urllib.error

            url = f"{supabase_url}/functions/v1/{self.config['nuke']['coordinator_function']}"
            data = json.dumps({"action": "brief"}).encode()

            req = urllib.request.Request(url, data=data, method='POST')
            req.add_header('Authorization', f'Bearer {supabase_key}')
            req.add_header('Content-Type', 'application/json')

            with urllib.request.urlopen(req, timeout=30) as resp:
                brief = json.loads(resp.read().decode())

            self._log(f"  Got coordinator brief")

            # Check for alert conditions
            params = task.get("params", {}).get("alert_on", {})

            # Check error rate
            if brief.get("error_rate", 0) > params.get("error_rate_above", 0.10):
                self._create_alert(
                    "warning",
                    "pipeline",
                    f"High error rate: {brief['error_rate']:.1%}",
                    {"brief": brief}
                )

            return {"status": "completed", "brief": brief}

        except Exception as e:
            self._log(f"  Error checking pipeline: {e}", "ERROR")
            return {"status": "error", "error": str(e)}

    def run_source_discovery(self, task: dict) -> dict:
        """Find new vehicle data sources."""
        self._log("Starting source-discovery task")

        params = task.get("params", {})
        queries = params.get("search_queries", [])

        discoveries = []

        for query in queries[:2]:
            self._log(f"  Searching: {query}")
            # In real implementation, use web search
            # discoveries.extend(self._search_web(query))

        # Save discoveries
        disc_file = REPORTS_DIR / f"sources-{datetime.now().strftime('%Y%m%d')}.json"
        with open(disc_file, 'w') as f:
            json.dump({
                "generated_at": datetime.now().isoformat(),
                "queries": queries,
                "discoveries": discoveries
            }, f, indent=2)

        return {"status": "completed", "count": len(discoveries)}

    def run_live_feed(self, task: dict) -> dict:
        """Monitor YouTube and X in near real-time."""
        self._log("Starting live-feed task")
        params = task.get("params", {})

        try:
            result = run_live_feed(params)

            # Create alert for important new items
            new_count = result.get("new_count", 0)
            if new_count > 0:
                items = result.get("items", [])
                # Alert on high-relevance items
                priority_items = [i for i in items if i.get("relevance") == "priority_account"]
                if priority_items:
                    self._create_alert(
                        "info",
                        "live-feed",
                        f"New from priority sources: {len(priority_items)} items",
                        {"items": priority_items[:5]}
                    )

            self._log(f"  Found {new_count} new items")
            return result

        except Exception as e:
            self._log(f"  Live feed error: {e}", "ERROR")
            return {"status": "error", "error": str(e)}

    def run_task(self, task: dict) -> Optional[dict]:
        """Execute a task based on its type."""
        task_type = task.get("type")

        handlers = {
            "tool-scout": self.run_tool_scout,
            "pipeline-health": self.run_pipeline_health,
            "source-discovery": self.run_source_discovery,
            "live-feed": self.run_live_feed,
        }

        handler = handlers.get(task_type)
        if not handler:
            self._log(f"Unknown task type: {task_type}", "WARN")
            return None

        try:
            result = handler(task)
            self._update_task(task, {
                "last_run": datetime.now().isoformat(),
                "status": "completed",
                "last_result": result
            })
            return result
        except Exception as e:
            self._log(f"Task failed: {e}", "ERROR")
            self._update_task(task, {
                "last_run": datetime.now().isoformat(),
                "status": "error",
                "last_error": str(e)
            })
            return None

    def run_cycle(self):
        """Run one cycle through all due tasks."""
        self._log("Starting cycle")
        tasks = self._load_tasks()

        for task in tasks:
            if self._should_run_task(task):
                self._log(f"Running task: {task['id']} ({task['type']})")
                self.run_task(task)
            else:
                self._log(f"Skipping task: {task['id']} (not due)")

        self._log("Cycle complete")

    def run_forever(self, cycle_interval_secs: int = 60):
        """Main loop - run cycles forever."""
        self._log("Sentinel starting persistent loop")

        while self.running:
            try:
                self.run_cycle()
            except Exception as e:
                self._log(f"Cycle error: {e}", "ERROR")

            self._log(f"Sleeping {cycle_interval_secs}s until next cycle")
            time.sleep(cycle_interval_secs)

    def run_once(self):
        """Run a single cycle and exit."""
        self.run_cycle()


def main():
    import sys

    sentinel = NukeSentinel()

    if len(sys.argv) > 1 and sys.argv[1] == "--once":
        sentinel.run_once()
    else:
        sentinel.run_forever()


if __name__ == "__main__":
    main()
