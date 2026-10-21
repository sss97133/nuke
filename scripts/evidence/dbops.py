"""Shared db-mode steps for promote, repin, publish and probe: a job run that always closes, the IO gate, the daily
testimony-write count, the revert watch read, and recording a statement timeout the database cannot catch.

Writes go through common.Rest (PostgREST, the writers in draft.sql M1p); reads through common.Reader (q.sh).
"""
import time

import common
import payloads

TIMEOUT_CODES = ('57014',)


class JobRun:
    """evidence_open_run on enter; evidence_close_run on exit ('done', or 'aborted' with the stop reason)."""

    def __init__(self, rest, user, kind, pass_name, script, config=None, parent=None):
        self.rest, self.user, self.kind, self.pass_name = rest, user, kind, pass_name
        self.script, self.config, self.parent = script, config or {}, parent
        self.id = None
        self.counts = {}

    def __enter__(self):
        self.id = self.rest.rpc('evidence_open_run', payloads.open_run(
            self.user, self.kind, self.pass_name, common.producer(self.script), common.code_version(), self.config,
            parent=self.parent))
        return self

    def __exit__(self, et, ev, tb):
        status, counts = 'done', dict(self.counts)
        if isinstance(ev, common.StopLoop):
            status, counts['stop_reason'] = 'aborted', ev.reason
        elif ev is not None:
            status, counts['error'] = 'failed', str(ev)[:300]
        try:
            self.rest.rpc('evidence_close_run', payloads.close_run(self.id, status, counts))
        except common.EvidenceError as e:
            common.eprint('closing run %s failed: %s' % (self.id, e))
        return False


def io_waiters(reader):
    return int(reader.read("select count(*) n from pg_stat_activity where wait_event_type = 'IO' and state = 'active'",
                           tag='io_gate')[0]['n'])


def io_gate(reader, limit=3, wait_s=600, sleep=time.sleep, clock=time.time):
    """Wait while IO waiters are above the limit; StopLoop after wait_s (PLAN section 5: above 3 for 10 minutes)."""
    start = clock()
    while True:
        n = io_waiters(reader)
        if n <= limit:
            return n
        if clock() - start >= wait_s:
            raise common.StopLoop('io_pressure', '%d IO waiters for %d s' % (n, wait_s))
        sleep(60)


def testimony_writes_today(reader, uid):
    return int(reader.read("select count(*) n from evidence_decisions where user_id = :uid and decision = 'promoted' "
                           "and created_at >= date_trunc('day', now()) and detail->>'writes_testimony' = 'true'",
                           {'uid': uid}, tag='daily_cap')[0]['n'])


def watch(reader, uid):
    return reader.read('select image_id, kind, halting, mode from public.evidence_revert_watch(:uid)', {'uid': uid},
                       tag='revert_watch')


def record_failure(rest, run_id, uid, image_id, err, step):
    """A 57014 cancels the whole call and rolls it back; record it (record_promotion_failure, step promote|repin|
    publish) so the scoreboard sees it and the next run retries."""
    return rest.rpc('record_promotion_failure', {'p_run_id': run_id, 'p_actor_user_id': uid, 'p_image_id': image_id,
                                                 'p_sqlstate': err.code or 'unknown', 'p_message': (err.message or '')[:200],
                                                 'p_step': step})


def stop_on(err):
    """Stop conditions in a writer error: 42501 (refused, or a guard fired)."""
    if isinstance(err, common.RpcError) and err.code == '42501':
        msg = (err.message or '').lower()
        reason = 'guard_fired' if ('append-only' in msg or 'written only by the evidence writers' in msg) \
            else 'writer_refused_42501'
        raise common.StopLoop(reason, '%s: %s' % (err.fn, err.message))
