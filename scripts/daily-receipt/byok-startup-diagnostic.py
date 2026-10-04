"""Temporary feature-branch diagnostic. No prompt, image analysis or database calls.

Raw CLI/account diagnostics are encrypted to a task-specific public certificate;
the private key stays on the owner's Mac. Only encrypted output is uploaded.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request
import urllib.error

with tempfile.TemporaryDirectory(prefix="byok-startup-") as temporary:
    work = Path(temporary)
    report = {}
    environment = os.environ.copy()
    # Match the batch's current command selection, including its PATH prepend.
    environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + str(Path.home() / ".local/bin") + ":" + environment["PATH"]
    environment.pop("CLAUDE_EFFORT", None)
    def capture(name, command):
        try:
            result = subprocess.run(command, env=environment, stdin=subprocess.DEVNULL,
                                    capture_output=True, text=True, timeout=25)
            report[name] = {"exit": result.returncode, "stdout": result.stdout, "stderr": result.stderr}
        except Exception as error:
            report[name] = {"exception": type(error).__name__}
    report["executables"] = {name: shutil.which(name, path=environment["PATH"]) for name in ["node", "claude"]}
    capture("node_version", ["node", "--version"])
    capture("claude_version", ["claude", "--version"])
    capture("auth_status", ["claude", "auth", "status", "--json"])
    # Empty stdin exercises startup only: the CLI rejects missing input, not a model task.
    capture("empty_input_startup", ["claude", "--print", "--output-format", "json",
        "--model", environment.get("BYOK_MODEL", "claude-sonnet-4-6"),
        "--permission-mode", "bypassPermissions", "--add-dir", str(work)])
    token = environment.get("CLAUDE_CODE_OAUTH_TOKEN", "")
    if token:
        request = urllib.request.Request("https://api.anthropic.com/api/oauth/profile",
            headers={"Authorization": "Bearer " + token, "anthropic-beta": "oauth-2025-04-20"})
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                report["oauth_profile"] = {"status": response.status, "body": response.read(32768).decode("utf8", errors="replace")}
        except urllib.error.HTTPError as error:
            report["oauth_profile"] = {"status": error.code, "body": error.read(32768).decode("utf8", errors="replace")}
        except Exception as error:
            report["oauth_profile"] = {"exception": type(error).__name__}
    source = work / "diagnostic.json"
    source.write_text(json.dumps(report))
    target = Path(os.environ["NUKE_LOG_DIR"]) / "byok-startup-diagnostic.enc"
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["openssl", "cms", "-encrypt", "-binary", "-aes256", "-in", str(source),
        "-outform", "DER", "-out", str(target),
        "scripts/daily-receipt/byok-diagnostic-public-cert.txt"], check=True, capture_output=True)
    print("Read-only startup diagnostic captured and encrypted. No analysis or database calls.")
