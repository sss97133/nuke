#!/usr/bin/env python3
"""landing_drain_loop.py: bounded, resumable driver for the landing pipeline's own day queue (capture_sets_drain).

capture_set_rescore_queue is the cursor: each call scores up to 3 queued days into proposals and, for clear sets, a
pre_gate sample (capture_landing_finalize_plan). Nothing is filed here; filing waits for the visual gate. Safe beside
the 5-minute cron (the drain claims rows FOR UPDATE SKIP LOCKED).

Network errors, timeouts and 5xx answers never end the loop: each call retries with capped exponential backoff
(with_retry), and a call that still fails is logged and the loop waits and goes on. When the owner's queue is empty it
idles and re-polls (--idle) so newly queued days are picked up; --exit-when-empty restores the old one-shot behaviour.
Ends after --hours; subscription-gate-supervise.sh restarts it from the same cursor if it exits.

  SUPABASE_URL=... SUPABASE_SECRET_KEY=... python3 scripts/photo-pipeline/landing_drain_loop.py [--owner UUID] [--hours 40]
"""
import os, json, urllib.request, urllib.error, time, datetime, argparse, socket, http.client

RETRYABLE_HTTP = {408, 425, 429, 500, 502, 503, 504, 520, 522, 524}


class Retryable(Exception):
    pass


def is_retryable(exc):
    """Transient: connection/timeouts/resets, URLError wrappers of those, and gateway or rate-limit HTTP codes."""
    if isinstance(exc, urllib.error.HTTPError):
        return exc.code in RETRYABLE_HTTP
    return isinstance(exc, (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError,
                            http.client.HTTPException, OSError, Retryable))


def with_retry(fn, attempts=6, base=5.0, cap=300.0, sleep=time.sleep, log=None):
    """Call fn(); on a retryable error wait base*2**i (capped) and try again, up to attempts. Re-raises otherwise."""
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 - classified below
            if not is_retryable(e) or i == attempts - 1:
                raise
            wait = min(cap, base * (2 ** i))
            if log:
                log({'ev': 'retry', 'attempt': i + 1, 'wait': wait, 'error': str(e)[:200]})
            sleep(wait)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--owner', default=os.environ.get('NUKE_OWNER_ID', '0b9f107a-d124-49de-9ded-94698f63c1c4'))
    ap.add_argument('--hours', type=float, default=40)
    ap.add_argument('--delay', type=int, default=0)
    ap.add_argument('--per-call', type=int, default=3)
    ap.add_argument('--idle', type=int, default=600, help='seconds between polls while the queue is empty')
    ap.add_argument('--exit-when-empty', action='store_true')
    a = ap.parse_args()
    url = os.environ['SUPABASE_URL'].rstrip('/')
    key = os.environ.get('SUPABASE_SECRET_KEY') or os.environ['SUPABASE_SERVICE_ROLE_KEY']
    hdr = {'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Prefer': 'count=exact'}

    def log(d):
        print(json.dumps({'at': datetime.datetime.now().isoformat(timespec='seconds'), **d})[:600], flush=True)

    def rpc(fn, body):
        r = urllib.request.Request(f'{url}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), headers=hdr, method='POST')
        with urllib.request.urlopen(r, timeout=320) as x:
            return json.load(x)

    def pending():
        r = urllib.request.Request(f"{url}/rest/v1/capture_set_rescore_queue?user_id=eq.{a.owner}&done_at=is.null&select=day",
                                   headers={**hdr, 'Range': '0-0'})
        with urllib.request.urlopen(r, timeout=60) as x:
            return int(x.headers.get('Content-Range', '*/0').split('/')[-1])

    end = time.time() + a.hours * 3600
    time.sleep(a.delay)
    while time.time() < end:
        try:
            n = with_retry(pending, log=log)
        except Exception as e:  # noqa: BLE001 - never crash the loop on one bad poll
            log({'ev': 'poll_failed', 'error': str(e)[:300]}); time.sleep(120); continue
        if n == 0:
            if a.exit_when_empty:
                log({'ev': 'queue_empty'}); break
            log({'ev': 'queue_empty_idle', 'next_poll_secs': a.idle}); time.sleep(a.idle); continue
        t = time.time()
        try:
            r = with_retry(lambda: rpc('capture_sets_drain', {'p_max': min(max(a.per_call, 1), 5)}), attempts=3, base=30, log=log)
        except urllib.error.HTTPError as e:
            r = {'error': e.code, 'body': e.read().decode(errors='replace')[:300]}
        except Exception as e:  # noqa: BLE001
            r = {'error': str(e)[:200]}
        log({'pending': n, 'secs': round(time.time() - t), 'r': r})
        time.sleep(20 if 'error' not in r else 120)
    log({'ev': 'window_end'})


if __name__ == '__main__':
    main()
