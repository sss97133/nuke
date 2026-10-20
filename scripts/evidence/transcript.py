"""Chat transcripts (v6, AC10; PLAN M10b): find the message a message_ref names and check a stored answer against it.

A message_ref is '<source>:<message id>'. For a Claude Code session the source is the session id (the transcript
<session id>.jsonl under ~/.claude/projects/*/, or EVIDENCE_TRANSCRIPTS) and the message id is the entry's uuid. The
checks: the sheet's delivery message carries the sheet as sent (a text block hashing to the sheet's sha256), the
reply comes after it, and the reply holds each row's verbatim words. Only booleans and refs leave this module: no
message text is copied anywhere.
"""
import json
import os
import re
from pathlib import Path

import common


def roots():
    r = os.environ.get('EVIDENCE_TRANSCRIPTS')
    return [Path(x).expanduser() for x in r.split(os.pathsep)] if r else [Path.home() / '.claude' / 'projects']


def _texts(entry):
    """The text blocks of a transcript entry (a user message's string, an assistant message's text blocks)."""
    c = (entry.get('message') or {}).get('content')
    if isinstance(c, str):
        return [c]
    return [b.get('text') or '' for b in c or [] if isinstance(b, dict) and b.get('type') == 'text']


def find(ref, where=None):
    """-> {session, uuid, index, timestamp, role, texts} for the message the ref names, or None when no transcript
    under the roots holds it (another channel, or a transcript not on this Mac)."""
    m = re.match(r'^([A-Za-z0-9_.-]+):(.+)$', (ref or '').strip())
    if not m:
        return None
    session, uid = m.group(1), m.group(2)
    for root in where or roots():
        for path in sorted(Path(root).glob('*/%s.jsonl' % session)) + sorted(Path(root).glob('%s.jsonl' % session)):
            with open(path, encoding='utf-8', errors='replace') as f:
                for i, ln in enumerate(f):
                    if uid not in ln:
                        continue
                    try:
                        e = json.loads(ln)
                    except ValueError:
                        continue
                    if e.get('uuid') == uid:
                        return {'session': session, 'uuid': uid, 'index': i, 'timestamp': e.get('timestamp'),
                                'role': (e.get('message') or {}).get('role') or e.get('type'), 'texts': _texts(e)}
    return None


def _norm(s):
    return ' '.join((s or '').split())


def carries_sheet(msg, sheet_sha256):
    texts = msg['texts']
    return any(common.sha256_text(t) == sheet_sha256 or common.sha256_text(t.strip()) == sheet_sha256
               for t in texts + ['\n'.join(texts)])


def check(sheet_sha256, delivery_ref, reply_ref, verbatims, where=None):
    """-> {'checked': bool, 'problems': [...]}: unchecked when either message is not in a local transcript."""
    if not delivery_ref:
        return {'checked': False, 'problems': ['no delivery message recorded for the sheet']}
    delivery, reply = find(delivery_ref, where), find(reply_ref, where)
    if delivery is None or reply is None:
        return {'checked': False, 'problems': [], 'missing': [r for r, m in ((delivery_ref, delivery), (reply_ref, reply))
                                                              if m is None]}
    problems = []
    if not carries_sheet(delivery, sheet_sha256):
        problems.append('the delivery message does not carry the sheet as issued (no text hashes to its sha256)')
    later = (reply['index'] > delivery['index']) if reply['session'] == delivery['session'] else \
        ((reply.get('timestamp') or '') > (delivery.get('timestamp') or ''))
    if not later:
        problems.append('the reply does not come after the delivery of the sheet')
    body = _norm('\n'.join(reply['texts']))
    for row, words in sorted((verbatims or {}).items(), key=lambda x: int(x[0])):
        if _norm(words) not in body:
            problems.append('row %s: his verbatim words are not in the reply message' % row)
    return {'checked': True, 'problems': problems}
