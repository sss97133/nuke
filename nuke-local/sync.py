#!/usr/bin/env python3
"""
Nuke Box Sync - Background uploader for scanned images
Reads manifest, uploads to Nuke cloud, updates status.
"""

import os
import sys
import json
import time
import argparse
import mimetypes
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any, List
from concurrent.futures import ThreadPoolExecutor
import threading

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

try:
    from rich.console import Console
    from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn, TimeRemainingColumn
    from rich.live import Live
    from rich.table import Table
    HAS_RICH = True
    console = Console()
except ImportError:
    HAS_RICH = False
    console = None

# ============================================================================
# Configuration
# ============================================================================

NUKE_API_URL = os.getenv("NUKE_API_URL", "https://qkgaybvrernstplzjaam.supabase.co")
NUKE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjU0OTQ4MDAsImV4cCI6MjA0MTA3MDgwMH0.LXGP_mwSz9BD57FV4OukZPy7PhTgBA9cLihEVPJzgps"
CHUNK_SIZE = 1024 * 1024  # 1MB chunks for upload
MAX_CONCURRENT_UPLOADS = 3
RETRY_ATTEMPTS = 3

# ============================================================================
# Authentication
# ============================================================================

def login(email: str, password: str, api_url: str = NUKE_API_URL) -> Optional[str]:
    """Login to Nuke and get access token."""
    if not HAS_REQUESTS:
        log("requests library required for authentication", "error")
        return None

    try:
        response = requests.post(
            f"{api_url}/auth/v1/token?grant_type=password",
            headers={
                "apikey": NUKE_ANON_KEY,
                "Content-Type": "application/json"
            },
            json={
                "email": email,
                "password": password
            },
            timeout=30
        )

        if response.status_code == 200:
            data = response.json()
            return data.get("access_token")
        else:
            log(f"Login failed: {response.status_code} - {response.text[:200]}", "error")
            return None

    except Exception as e:
        log(f"Login error: {e}", "error")
        return None


def load_saved_token() -> Optional[str]:
    """Load saved access token from config file."""
    config_path = Path.home() / ".nuke-box" / "auth.json"
    if config_path.exists():
        try:
            with open(config_path) as f:
                data = json.load(f)
                return data.get("access_token")
        except:
            pass
    return None


def save_token(access_token: str):
    """Save access token for future use."""
    config_dir = Path.home() / ".nuke-box"
    config_dir.mkdir(exist_ok=True)
    config_path = config_dir / "auth.json"

    with open(config_path, 'w') as f:
        json.dump({"access_token": access_token}, f)

    # Restrict permissions
    config_path.chmod(0o600)
    log(f"Token saved to {config_path}", "info")


# ============================================================================
# Upload Manager
# ============================================================================

class UploadManager:
    """Manages background uploads to Nuke cloud."""

    def __init__(self, manifest_path: str, api_url: str = NUKE_API_URL, access_token: str = None):
        self.manifest_path = Path(manifest_path)
        self.api_url = api_url
        self.access_token = access_token  # User's JWT from login
        self.manifest = None
        self.queue: List[Dict] = []
        self.completed: List[Dict] = []
        self.failed: List[Dict] = []
        self.stats = {
            "total": 0,
            "uploaded": 0,
            "failed": 0,
            "bytes_uploaded": 0,
            "start_time": None,
            "eta_seconds": None
        }
        self._lock = threading.Lock()

    def load_manifest(self):
        """Load manifest from file."""
        if not self.manifest_path.exists():
            raise FileNotFoundError(f"Manifest not found: {self.manifest_path}")

        with open(self.manifest_path) as f:
            self.manifest = json.load(f)

        # Build upload queue from manifest
        self._build_queue()
        log(f"Loaded {len(self.queue)} images from manifest", "info")

    def _build_queue(self):
        """Build prioritized upload queue from manifest."""
        if not self.manifest:
            return

        for img in self.manifest.get("images", []):
            if img.get("upload_status") == "uploaded":
                continue  # Skip already uploaded

            metadata = img.get("metadata", {})
            classification = img.get("classification", {})

            # Determine priority
            priority = 3
            if classification and classification.get("is_document"):
                priority = 1
                if classification.get("document_type") == "title":
                    priority = 0  # Highest
            elif img.get("vehicle_group") and not img["vehicle_group"].startswith("_"):
                priority = 2

            self.queue.append({
                "path": metadata.get("path"),
                "priority": priority,
                "metadata": metadata,
                "classification": classification,
                "vehicle_group": img.get("vehicle_group"),
                "status": "pending",
                "retries": 0
            })

        # Sort by priority
        self.queue.sort(key=lambda x: x["priority"])
        self.stats["total"] = len(self.queue)

    def start_sync(self, dry_run: bool = False, max_uploads: Optional[int] = None):
        """Start background sync process."""
        if not self.queue:
            log("No images to upload", "warning")
            return

        if not self.access_token and not dry_run:
            log("Not authenticated. Run with --login first, or use --dry-run.", "error")
            return

        self.stats["start_time"] = time.time()

        # Limit queue if specified
        if max_uploads:
            self.queue = self.queue[:max_uploads]
            self.stats["total"] = len(self.queue)

        log(f"Starting sync: {len(self.queue)} images", "info")

        if HAS_RICH:
            self._sync_with_progress(dry_run)
        else:
            self._sync_simple(dry_run)

        self._print_summary()
        self._save_manifest()

    def _sync_with_progress(self, dry_run: bool):
        """Sync with rich progress display."""
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            TimeRemainingColumn(),
            console=console
        ) as progress:
            task = progress.add_task(
                f"Uploading images...",
                total=len(self.queue)
            )

            with ThreadPoolExecutor(max_workers=MAX_CONCURRENT_UPLOADS) as executor:
                futures = []
                for item in self.queue:
                    future = executor.submit(self._upload_image, item, dry_run)
                    futures.append(future)

                for future in futures:
                    result = future.result()
                    progress.update(task, advance=1)

                    # Update description with current stats
                    elapsed = time.time() - self.stats["start_time"]
                    rate = self.stats["uploaded"] / elapsed if elapsed > 0 else 0
                    progress.update(
                        task,
                        description=f"Uploading... ({self.stats['uploaded']}/{self.stats['total']}, {rate:.1f}/s)"
                    )

    def _sync_simple(self, dry_run: bool):
        """Simple sync without rich progress."""
        for i, item in enumerate(self.queue):
            if i % 5 == 0:
                print(f"Uploading {i+1}/{len(self.queue)}...")
            self._upload_image(item, dry_run)

    def _upload_image(self, item: Dict, dry_run: bool = False) -> bool:
        """Upload a single image."""
        path = item.get("path")
        if not path or not Path(path).exists():
            with self._lock:
                self.stats["failed"] += 1
                item["status"] = "failed"
                item["error"] = "File not found"
                self.failed.append(item)
            return False

        try:
            if dry_run:
                # Simulate upload
                time.sleep(0.1)
                with self._lock:
                    self.stats["uploaded"] += 1
                    self.stats["bytes_uploaded"] += Path(path).stat().st_size
                    item["status"] = "uploaded"
                    self.completed.append(item)
                return True

            # Real upload
            success = self._upload_to_nuke(item)

            with self._lock:
                if success:
                    self.stats["uploaded"] += 1
                    self.stats["bytes_uploaded"] += Path(path).stat().st_size
                    item["status"] = "uploaded"
                    self.completed.append(item)
                else:
                    self.stats["failed"] += 1
                    item["status"] = "failed"
                    self.failed.append(item)

            return success

        except Exception as e:
            with self._lock:
                self.stats["failed"] += 1
                item["status"] = "failed"
                item["error"] = str(e)
                self.failed.append(item)
            return False

    def _upload_to_nuke(self, item: Dict) -> bool:
        """Upload image to Nuke API."""
        path = item["path"]
        metadata = item.get("metadata", {})
        classification = item.get("classification", {})

        # Prepare multipart upload
        mime_type = mimetypes.guess_type(path)[0] or 'image/jpeg'

        try:
            with open(path, 'rb') as f:
                files = {
                    'file': (Path(path).name, f, mime_type)
                }
                data = {
                    'metadata': json.dumps(metadata),
                    'classification': json.dumps(classification) if classification else '{}',
                    'vehicle_group': item.get('vehicle_group', ''),
                    'source': 'nuke-box'
                }

                response = requests.post(
                    f"{self.api_url}/functions/v1/nuke-box-upload",
                    headers={
                        "Authorization": f"Bearer {self.access_token}",
                        "apikey": NUKE_ANON_KEY
                    },
                    files=files,
                    data=data,
                    timeout=60
                )

                if response.status_code in (200, 201):
                    result = response.json()
                    item["upload_result"] = result
                    return True
                else:
                    item["error"] = f"HTTP {response.status_code}: {response.text[:200]}"
                    return False

        except Exception as e:
            item["error"] = str(e)
            return False

    def _print_summary(self):
        """Print upload summary."""
        elapsed = time.time() - self.stats["start_time"] if self.stats["start_time"] else 0

        log("\n" + "="*60, "info")
        log("SYNC COMPLETE", "success")
        log("="*60, "info")
        log(f"Total: {self.stats['total']}", "info")
        log(f"Uploaded: {self.stats['uploaded']}", "success")
        log(f"Failed: {self.stats['failed']}", "warning" if self.stats['failed'] > 0 else "info")
        log(f"Bytes: {self.stats['bytes_uploaded'] / 1024 / 1024:.1f} MB", "info")
        log(f"Time: {elapsed:.1f}s", "info")
        if elapsed > 0:
            log(f"Rate: {self.stats['uploaded'] / elapsed:.1f} images/s", "info")

        # Show titles uploaded
        titles = [c for c in self.completed
                  if c.get('classification', {}).get('document_type') == 'title']
        if titles:
            log(f"\nTITLES UPLOADED: {len(titles)}", "success")
            for t in titles:
                log(f"  - {Path(t['path']).name}", "info")

    def _save_manifest(self):
        """Update manifest with upload status."""
        if not self.manifest:
            return

        # Update image statuses in manifest
        path_to_status = {}
        for item in self.completed:
            path_to_status[item["path"]] = "uploaded"
        for item in self.failed:
            path_to_status[item["path"]] = "failed"

        for img in self.manifest.get("images", []):
            path = img.get("metadata", {}).get("path")
            if path in path_to_status:
                img["upload_status"] = path_to_status[path]

        # Save updated manifest
        self.manifest["last_sync"] = datetime.now().isoformat()
        self.manifest["sync_stats"] = self.stats

        with open(self.manifest_path, 'w') as f:
            json.dump(self.manifest, f, indent=2)

        log(f"\nManifest updated: {self.manifest_path}", "info")

# ============================================================================
# Utility
# ============================================================================

def log(message: str, level: str = "info"):
    """Log message."""
    if HAS_RICH and console:
        colors = {"info": "white", "success": "green", "warning": "yellow", "error": "red"}
        console.print(f"[{colors.get(level, 'white')}]{message}[/{colors.get(level, 'white')}]")
    else:
        print(message)

# ============================================================================
# CLI
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Nuke Box Sync - Upload scanned images to Nuke cloud"
    )
    parser.add_argument(
        "manifest",
        nargs="?",
        help="Path to manifest.json from scanner"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate uploads without actually uploading"
    )
    parser.add_argument(
        "--max",
        type=int,
        help="Maximum number of images to upload"
    )
    parser.add_argument(
        "--login",
        action="store_true",
        help="Login to Nuke (will prompt for email/password)"
    )
    parser.add_argument(
        "--logout",
        action="store_true",
        help="Clear saved authentication"
    )

    args = parser.parse_args()

    # Handle logout
    if args.logout:
        config_path = Path.home() / ".nuke-box" / "auth.json"
        if config_path.exists():
            config_path.unlink()
            log("Logged out successfully", "success")
        else:
            log("Not logged in", "info")
        return

    # Handle login
    if args.login:
        import getpass
        log("Login to Nuke", "info")
        email = input("Email: ").strip()
        password = getpass.getpass("Password: ")

        token = login(email, password)
        if token:
            save_token(token)
            log("Login successful!", "success")
        else:
            sys.exit(1)
        return

    # Need manifest for sync
    if not args.manifest:
        parser.print_help()
        log("\nError: manifest path required for sync", "error")
        log("First login:  python sync.py --login", "info")
        log("Then sync:    python sync.py ./scan_results/manifest.json", "info")
        sys.exit(1)

    # Load saved token
    access_token = load_saved_token()
    if not access_token and not args.dry_run:
        log("Not logged in. Run: python sync.py --login", "error")
        sys.exit(1)

    # Create upload manager
    manager = UploadManager(
        args.manifest,
        access_token=access_token
    )

    try:
        manager.load_manifest()
        manager.start_sync(dry_run=args.dry_run, max_uploads=args.max)
    except FileNotFoundError as e:
        log(str(e), "error")
        sys.exit(1)
    except Exception as e:
        log(f"Error: {e}", "error")
        sys.exit(1)

if __name__ == "__main__":
    main()
