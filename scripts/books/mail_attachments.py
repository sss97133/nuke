#!/usr/bin/env python3
"""Fetch purchase-agreement and bill-of-sale attachments from the owner's mail, for scripts/books/vehicle_evidence.py.

The path is the one already on this Mac: Mail.app keeps every message of the owner's Gmail accounts as an .emlx file and indexes
them in its Envelope Index (the same store scripts/mail-app-intake.mjs reads). No Gmail credential, token or API call is used,
so nothing here can leak one. (scripts/gmail-poller.mjs needs a GOOGLE_REFRESH_TOKEN that the environment does not hold, and it
polls a different mailbox.)

  python3 scripts/books/mail_attachments.py --out ~/nuke-logs/vehicle-evidence/mail --cursor ~/nuke-logs/vehicle-evidence/mail/cursor.json

Incremental: the cursor is the highest Envelope Index message row already scanned, so each run reads only new mail. For each new
message with a PDF attachment whose file name or subject says purchase agreement, bill of sale, BOS or sales agreement, it writes
  <out>/pdf/mail-<message row>-<attachment name>.pdf    (the extractor's --pdf-root; its ref names the message)
  <out>/emails.json                                      (the extractor's --emails: id, date, from, to, subject, body, attachments)
Private data stays in <out>, outside the repo. Mail the Mac has not synced yet is not seen; the run reports the newest row it scanned.
"""
import argparse, datetime as dt, json, os, re, sqlite3, subprocess, sys
from urllib.parse import unquote

MAIL = os.path.expanduser('~/Library/Mail/V10')
WANT = re.compile(r'purchase (agreement|order)|bill of sale|\bBOS\b|sales? agreement|buyer.?s order|vehicle sale', re.I)


def fetch_with_mail_app(account, mailbox, header, outdir, prefix):
    """Ask Mail.app (already signed in to the account; no credential here) for the message by its Message-ID header and save its
    PDF attachments. The .emlx on disk holds the body only: Mail fetches the attachment bytes from the server on demand.
    -> (names saved, plain body)"""
    script = '''on run argv
  tell application "Mail"
    set acct to first account whose id is (item 1 of argv)
    set mb to first mailbox of acct whose name is (item 2 of argv)
    set ms to (messages of mb whose message id is (item 3 of argv))
    if (count of ms) is 0 then return ""
    set m to item 1 of ms
    set saved to ""
    repeat with a in mail attachments of m
      set nm to name of a
      if nm ends with ".pdf" or nm ends with ".PDF" then
        save a in POSIX file ((item 4 of argv) & (item 5 of argv) & nm)
        set saved to saved & nm & linefeed
      end if
    end repeat
    return saved & "<<BODY>>" & (content of m)
  end tell
end run'''
    r = subprocess.run(['osascript', '-e', script, account, mailbox, header.strip('<>'), outdir + '/', prefix], capture_output=True, text=True, timeout=90)
    if r.returncode:
        raise RuntimeError(r.stderr[-300:])
    names, _, body = r.stdout.partition('<<BODY>>')
    return [n for n in names.splitlines() if n], body


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', required=True)
    ap.add_argument('--cursor', required=True)
    ap.add_argument('--limit', type=int, default=20, help='load budget: messages fetched from Mail per run (about 10 s each)')
    ap.add_argument('--since-row', type=int, help='scan from this Envelope Index row (default: the cursor)')
    a = ap.parse_args()
    out, cpath = os.path.expanduser(a.out), os.path.expanduser(a.cursor)
    os.makedirs(os.path.join(out, 'pdf'), exist_ok=True)
    cur = json.load(open(cpath)) if os.path.exists(cpath) else {'row': 0}
    start = a.since_row if a.since_row is not None else cur['row']
    db = sqlite3.connect(f"file:{MAIL}/MailData/Envelope%20Index?mode=ro", uri=True)
    rows = db.execute("""select m.ROWID, mb.url, g.message_id_header, s.subject, m.date_sent, ad.address, group_concat(at.name, '|')
        from messages m join mailboxes mb on mb.ROWID = m.mailbox join subjects s on s.ROWID = m.subject
        left join addresses ad on ad.ROWID = m.sender join message_global_data g on g.ROWID = m.global_message_id join attachments at on at.message = m.ROWID
        where m.ROWID > ? and m.deleted = 0 group by m.ROWID order by m.ROWID limit ?""", (start, 200000)).fetchall()
    emails_path = os.path.join(out, 'emails.json')
    emails = json.load(open(emails_path)) if os.path.exists(emails_path) else []
    have = {e['id'] for e in emails}
    failed = cur.get('failed', {})
    scanned = opened = saved = 0
    last = start
    for row, url, header, subject, sent, sender, names in rows:
        if opened >= a.limit:
            break
        last = row
        scanned += 1
        pdfs = [n for n in (names or '').split('|') if n.lower().endswith('.pdf')]
        if not pdfs or not (WANT.search(subject or '') or any(WANT.search(n) for n in pdfs)):
            continue
        acct, mbpath = re.match(r'imap://([0-9A-F-]+)/(.*)', url).groups()
        mbpath = unquote(mbpath)
        if not header:
            continue
        if failed.get(str(row), 0) >= 3:
            continue
        opened += 1
        mid = f'mail:{row}'
        try:
            names_saved, body = fetch_with_mail_app(acct, mbpath.split('/')[-1], header, os.path.join(out, 'pdf'), f'mail-{row}-')
        except Exception as e:   # Mail could not hand it over (timeout, offline): retry on later runs, give up after 3 tries
            failed[str(row)] = failed.get(str(row), 0) + 1
            print(json.dumps(dict(error=str(e)[:200], row=row, tries=failed[str(row)])), file=sys.stderr)
            continue
        saved += len(names_saved)
        if mid not in have:
            emails.append({'id': mid, 'date': dt.datetime.fromtimestamp(sent, dt.timezone.utc).isoformat() if sent else None, 'from': sender,
                           'to': [''], 'subject': subject, 'body': body[:6000], 'attachments': names_saved})
    json.dump(emails, open(emails_path + '.tmp', 'w'))
    os.replace(emails_path + '.tmp', emails_path)
    exhausted = (not rows) or last == rows[-1][0]
    cur = {'row': last, 'failed': failed, 'last_run': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')}
    json.dump(cur, open(cpath + '.tmp', 'w'))
    os.replace(cpath + '.tmp', cpath)
    print(json.dumps(dict(from_row=start, to_row=last, scanned_with_attachments=scanned, opened=opened, pdfs_saved=saved, caught_up=exhausted)))


if __name__ == '__main__':
    main()
