"""Messages pass (messages_mention): chat.db opened read-only (mode=ro); counts and message GUIDs, never text.

A chat is named by 'chat-' + sha1(chat ROWID)[:6], so no handle, phone number or address is read. The case lists the
mentions to cite as (chat ref, local time) pairs; this pass resolves each to its GUID and direction by time only (no
text column is selected) and writes:
  supports      a link per mention (role supports), e.g. a sale-window message;
  contradicts   one link per group, carrying the payment_key it disputes (v3, ET2-4: the payment then reads
                'disputed', never summed, until the owner answers).
It also reports per-chat message counts per day in the case's window (counts only).
"""
import datetime as dt
import hashlib
import sqlite3

import common
import payloads

PASSES = ['messages_mention']
APPLE_EPOCH = dt.datetime(2001, 1, 1, tzinfo=dt.timezone.utc)


def chat_ref(rowid):
    return 'chat-' + hashlib.sha1(str(rowid).encode()).hexdigest()[:6]


def _tz(name):
    if not name:
        return dt.datetime.now().astimezone().tzinfo
    from zoneinfo import ZoneInfo
    return ZoneInfo(name)


def _apple(t):
    """aware datetime -> chat.db message.date (nanoseconds since 2001-01-01 UTC)."""
    return int((t - APPLE_EPOCH).total_seconds() * 1_000_000_000)


def open_chat_db(path):
    return sqlite3.connect('file:%s?mode=ro' % path, uri=True)


def resolve(con, wanted, tz):
    """[(chat ref, 'YYYY-MM-DD HH:MM:SS' local)] -> {(ref, local): {'guid', 'from_me'}}; exactly one message each."""
    chats = {}
    refs = {r for r, _ in wanted}
    for (rid,) in con.execute('select ROWID from chat'):
        h = chat_ref(rid)
        if h in refs:
            chats[h] = rid
    out = {}
    for ref, local in wanted:
        if ref not in chats:
            raise common.EvidenceError('messages: chat %s not found' % ref)
        t0 = dt.datetime.strptime(local, '%Y-%m-%d %H:%M:%S').replace(tzinfo=tz).astimezone(dt.timezone.utc)
        lo, hi = _apple(t0), _apple(t0 + dt.timedelta(seconds=1))
        rows = con.execute('select m.guid, m.is_from_me from message m join chat_message_join cj on '
                           'cj.message_id = m.ROWID where cj.chat_id = ? and m.date >= ? and m.date < ?',
                           (chats[ref], lo, hi)).fetchall()
        if len(rows) != 1:
            raise common.EvidenceError('messages: %s %s matches %d messages' % (ref, local, len(rows)))
        out[(ref, local)] = {'guid': rows[0][0], 'from_me': bool(rows[0][1])}
    return out


def day_counts(con, refs, tz, date_from, date_to):
    chats = {chat_ref(rid): rid for (rid,) in con.execute('select ROWID from chat') if chat_ref(rid) in refs}
    lo = _apple(dt.datetime.fromisoformat(date_from).replace(tzinfo=tz))
    hi = _apple((dt.datetime.fromisoformat(date_to) + dt.timedelta(days=1)).replace(tzinfo=tz))
    out = {}
    for ref, rid in chats.items():
        c = {}
        for (d,) in con.execute('select m.date from message m join chat_message_join cj on cj.message_id = m.ROWID '
                                'where cj.chat_id = ? and m.date >= ? and m.date < ?', (rid, lo, hi)):
            day = (APPLE_EPOCH + dt.timedelta(microseconds=d / 1000)).astimezone(tz).date().isoformat()
            c[day] = c.get(day, 0) + 1
        out[ref] = dict(sorted(c.items()))
    return out


def build(ctx, built):
    cfg = ctx.pass_cfg('messages_mention')
    if not cfg:
        return {}
    tz = _tz(cfg.get('tz'))
    wanted = [(r, t) for m in cfg['mentions'] for r, t in m['refs']]
    cache = {tuple(k.split('|', 1)): v for k, v in (cfg.get('resolved') or {}).items()}
    counts, source = {}, 'chat.db'
    db = ctx.input_path('chat_db')
    try:
        con = open_chat_db(db)
        guid = resolve(con, wanted, tz)
        w = cfg.get('counts_window')
        if w:
            counts = day_counts(con, {r for r, _ in wanted}, tz, w['from'], w['to'])
        con.close()
    except (sqlite3.Error, TypeError) as e:
        # chat.db cannot be opened or read from this process (no path, or no disk access): use the GUIDs the case
        # caches from an earlier resolution. A mention that does not resolve in a readable chat.db is an error.
        if not all(k in cache for k in wanted):
            raise common.EvidenceError('messages: chat.db unreadable (%s) and no cached GUIDs for every mention'
                                       % type(e).__name__)
        guid, source = cache, 'cached GUIDs (chat.db unreadable here)'
        ctx.note('messages_mention: chat.db not readable from this process; used the GUIDs the case caches')
    n = 0
    for m in cfg['mentions']:
        veh = ctx.vid(m['vehicle'])
        refs = [(r, t) for r, t in m['refs']]
        first = guid[refs[0]]['guid']
        ext = 'messages:' + first
        ev = [{'kind': 'message', 'ref': guid[k]['guid'], 'chat_ref': k[0], 'from_me': guid[k]['from_me']}
              for k in refs]
        role = m.get('role', 'supports')
        row = payloads.evidence_link(
            veh, 'message', role, m.get('join_key', 'keyword + date'), m['confidence'], ev, external_ref=ext,
            source_label=m.get('source_label'), occurred_on=refs[0][1][:10],
            counterparty_label=m.get('counterparty_label'),
            payment_key=m.get('payment_key') if role in ('contradicts', 'supports') else None,
            summary=m.get('summary'))
        built.add('links.jsonl', payloads.line(payloads.link_key(ext, veh), 'propose_evidence_links',
                                               'messages_mention', row))
        n += 1
    return {'messages_mention': {'emitted': n, 'config': {
        'source': 'chat.db mode=ro', 'ids': 'message GUIDs', 'resolved_from': source,
        'summaries': '<= 60 chars, own words; no message text'},
        'counts': {'links': n, 'messages_cited': len(wanted), 'per_chat_day': counts}}}


if __name__ == '__main__':
    import passlib
    passlib.pass_main(PASSES, __doc__)
