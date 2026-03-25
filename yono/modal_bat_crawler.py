"""
BaT Full Catalog Crawler — Modal Parallel Workers

Crawls bringatrailer.com/models/ to discover ALL listing URLs,
deduplicates against existing vehicles, queues missing ones.

Deploy:
  modal run yono/modal_bat_crawler.py

Fast mode (50 parallel workers):
  modal run yono/modal_bat_crawler.py --workers 50
"""

import json
import os
import re
import time
from typing import Optional

import modal

app = modal.App("nuke-bat-crawler")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("httpx", "selectolax", "psycopg2-binary")
)

# DB connection from env
DB_URL = os.environ.get("DATABASE_URL", "")


@app.function(
    image=image,
    timeout=300,
    retries=2,
    secrets=[modal.Secret.from_name("nuke-db")],
)
def crawl_bat_make_page(make_url: str, page: int = 1) -> list[str]:
    """Crawl a single BaT make page and return listing URLs."""
    import httpx
    from selectolax.parser import HTMLParser

    # BaT uses AJAX for pagination: /wp-json/bringatrailer/1.0/data/listings
    # But we can also just fetch the make page with ?page=N
    url = make_url if page == 1 else f"{make_url}page/{page}/"

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml",
    }

    try:
        resp = httpx.get(url, headers=headers, follow_redirects=True, timeout=30)
        if resp.status_code != 200:
            return []

        tree = HTMLParser(resp.text)
        urls = []

        # BaT listing URLs: /listing/SLUG/
        for a in tree.css("a[href]"):
            href = a.attributes.get("href", "")
            if "/listing/" in href and "bringatrailer.com" in href:
                # Normalize
                clean = href.split("?")[0].split("#")[0]
                if not clean.endswith("/"):
                    clean += "/"
                urls.append(clean)

        return list(set(urls))
    except Exception as e:
        print(f"Error crawling {url}: {e}")
        return []


@app.function(
    image=image,
    timeout=600,
    secrets=[modal.Secret.from_name("nuke-db")],
)
def crawl_bat_make_all_pages(make_url: str) -> list[str]:
    """Crawl ALL pages for a make, following pagination."""
    import httpx
    from selectolax.parser import HTMLParser

    all_urls = []
    page = 1
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml",
    }

    while True:
        url = make_url if page == 1 else f"{make_url}page/{page}/"
        try:
            resp = httpx.get(url, headers=headers, follow_redirects=True, timeout=30)
            if resp.status_code != 200:
                break

            tree = HTMLParser(resp.text)
            urls = []
            for a in tree.css("a[href]"):
                href = a.attributes.get("href", "")
                if "/listing/" in href and "bringatrailer.com" in href:
                    clean = href.split("?")[0].split("#")[0]
                    if not clean.endswith("/"):
                        clean += "/"
                    urls.append(clean)

            unique = list(set(urls))
            if not unique:
                break

            all_urls.extend(unique)
            print(f"  {make_url} page {page}: {len(unique)} listings (total: {len(all_urls)})")

            # Check for next page
            has_next = tree.css_first("a.next, a.page-numbers.next, .pagination .next")
            if not has_next:
                break

            page += 1
            time.sleep(0.5)  # Be polite

        except Exception as e:
            print(f"Error on {url}: {e}")
            break

    return list(set(all_urls))


@app.function(
    image=image,
    timeout=120,
    secrets=[modal.Secret.from_name("nuke-db")],
)
def get_makes_from_models_page() -> list[str]:
    """Fetch all make URLs from bringatrailer.com/models/"""
    import httpx
    from selectolax.parser import HTMLParser

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    }

    resp = httpx.get("https://bringatrailer.com/models/", headers=headers, follow_redirects=True, timeout=30)
    tree = HTMLParser(resp.text)

    makes = []
    for a in tree.css("a[href]"):
        href = a.attributes.get("href", "")
        # Make pages look like: /brand/ or /make-name/
        if re.match(r"https://bringatrailer\.com/[a-z0-9-]+/$", href):
            # Skip known non-make pages
            skip = {"models", "auctions", "about", "contact", "faq", "how-it-works",
                    "sell", "login", "register", "terms", "privacy", "listing",
                    "members", "wp-content", "wp-admin", "feed", "comments"}
            slug = href.rstrip("/").split("/")[-1]
            if slug not in skip and len(slug) > 1:
                makes.append(href)

    return list(set(makes))


@app.function(
    image=image,
    timeout=60,
    secrets=[modal.Secret.from_name("nuke-db")],
)
def get_existing_bat_urls() -> set[str]:
    """Get all BaT URLs we already have in the database."""
    import psycopg2

    db_url = os.environ.get("DATABASE_URL")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    cur.execute("""
        SELECT COALESCE(bat_auction_url, listing_url, discovery_url)
        FROM vehicles
        WHERE source = 'bat' AND deleted_at IS NULL
        AND (bat_auction_url IS NOT NULL OR listing_url IS NOT NULL OR discovery_url IS NOT NULL)
    """)

    existing = set()
    for row in cur:
        if row[0]:
            url = row[0].rstrip("/") + "/"
            existing.add(url)
            # Also add without trailing slash
            existing.add(row[0].rstrip("/"))

    cur.close()
    conn.close()
    return existing


@app.function(
    image=image,
    timeout=120,
    secrets=[modal.Secret.from_name("nuke-db")],
)
def queue_missing_urls(urls: list[str]) -> int:
    """Insert missing URLs into import_queue."""
    import psycopg2

    if not urls:
        return 0

    db_url = os.environ.get("DATABASE_URL")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    queued = 0
    batch_size = 500
    for i in range(0, len(urls), batch_size):
        batch = urls[i:i + batch_size]
        values = [(url, "bat", "pending") for url in batch]
        try:
            from psycopg2.extras import execute_values
            execute_values(
                cur,
                "INSERT INTO import_queue (source_url, source_id, status) VALUES %s ON CONFLICT DO NOTHING",
                values,
            )
            queued += len(batch)
            conn.commit()
        except Exception as e:
            print(f"Queue batch error: {e}")
            conn.rollback()

    cur.close()
    conn.close()
    return queued


@app.local_entrypoint()
def main(workers: int = 30):
    """Main: discover all BaT makes, crawl each in parallel, queue missing."""
    print("=== BaT Full Catalog Crawler ===")
    print(f"Workers: {workers}")

    # Step 1: Get all make URLs
    print("\n1. Fetching make index from /models/...")
    makes = get_makes_from_models_page.remote()
    print(f"   Found {len(makes)} makes")

    # Step 2: Get existing URLs
    print("\n2. Loading existing BaT URLs from DB...")
    existing = get_existing_bat_urls.remote()
    print(f"   {len(existing)} existing URLs")

    # Step 3: Crawl all makes in parallel
    print(f"\n3. Crawling {len(makes)} makes with {workers} parallel workers...")
    all_discovered = []

    # Use Modal's map for parallel execution
    for i, urls in enumerate(crawl_bat_make_all_pages.map(makes)):
        if urls:
            new = [u for u in urls if u not in existing and u.rstrip("/") not in existing]
            all_discovered.extend(new)
            make_slug = makes[i].rstrip("/").split("/")[-1]
            if new:
                print(f"   {make_slug}: {len(urls)} total, {len(new)} NEW")

    all_discovered = list(set(all_discovered))
    print(f"\n4. Total discovered: {len(all_discovered)} new URLs")

    # Step 4: Queue missing URLs
    if all_discovered:
        print(f"\n5. Queuing {len(all_discovered)} URLs to import_queue...")
        queued = queue_missing_urls.remote(all_discovered)
        print(f"   Queued: {queued}")

    print(f"\n=== COMPLETE ===")
    print(f"Makes crawled: {len(makes)}")
    print(f"New URLs found: {len(all_discovered)}")
    print(f"Existing URLs: {len(existing)}")
