"""Shared helpers for the client-evidence producers (stdlib only, no I/O)."""
import hashlib, json, re
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

SHA_RE = re.compile(r'^[a-f0-9]{64}$')
IBAN_LIKE = re.compile(r'[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}')   # mirrors the writer's refusal exactly
IBAN_WHOLE_LOWER = re.compile(r'^[a-z]{2}[0-9]{2}[a-z0-9]{11,30}$')
EMAIL_LIKE = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+')
PHONE_LIKE = re.compile(r'(?<![\w-])(\+\d{8,15}|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})(?![\w-])')
ISO_TIME = re.compile(r'^\d{4}-\d{2}-\d{2}([T ][0-9:.]+([+-]\d{2}:\d{2}|Z)?)?$')
HEX_ONLY = re.compile(r'^[a-f0-9]{16,}$')
FORBIDDEN_KEYS = {'ocr_text', 'raw_text', 'full_ocr', 'full_text', 'iban', 'bank_iban', 'full_iban', 'redacted_source'}
CREDENTIAL_KEYS = re.compile(r'(token|password|passwd|secret|api_?key|authorization|cookie|credential|refresh|bearer)', re.I)
BODY_KEYS = {'body', 'body_text', 'html', 'snippet', 'content', 'text'}
# Opaque ids may look like an e-mail (RFC Message-ID, Gmail ids); these keys are exempt from the address/phone scan only.
ID_KEYS = {'rfc_message_id', 'gmail_message_id', 'gmail_thread_id', 'origin_key', 'part_id', 'attachment_part_id',
           'account_ref', 'idempotency_key', 'source_line_key', 'storage_path', 'locator', 'value_raw', 'event_key'}
ORIGINAL_EXT = re.compile(r'\.(pdf|png|jpe?g|webp|heic|csv|numbers)$', re.I)   # the writer's storage_path whitelist


class ContractError(ValueError):
    """The input breaks a contract; nothing is planned from it."""


def sha256_hex(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode()).hexdigest()


def canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=True)


def dec(value, field='amount'):
    """Exact decimal from a string/int; floats are refused so no binary rounding enters money or hours."""
    if isinstance(value, float) or isinstance(value, bool) or value is None:
        raise ContractError(f'{field}: use a decimal string, not {type(value).__name__}')
    try:
        d = Decimal(str(value).replace(',', '').replace('$', '').strip())
    except InvalidOperation:
        raise ContractError(f'{field}: not a decimal: {value!r}')
    if not d.is_finite():
        raise ContractError(f'{field}: not finite: {value!r}')
    return d


def money(d):
    return str(Decimal(d).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


def parse_time(value, field, *, tz='any'):
    """ISO-8601 parse. tz: 'required' (aware only), 'any'. Returns (datetime, is_aware). Anything else is refused:
    a string that is not a date never becomes an interval."""
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f'{field}: ISO-8601 string required, got {value!r}')
    try:
        d = datetime.fromisoformat(value.strip().replace('Z', '+00:00'))
    except ValueError:
        raise ContractError(f'{field}: not ISO-8601: {value!r}')
    aware = d.tzinfo is not None and d.utcoffset() is not None
    if tz == 'required' and not aware:
        raise ContractError(f'{field}: timezone required')
    return d, aware


def walk(obj, path='$'):
    yield path, obj
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from walk(v, f'{path}.{k}')
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk(v, f'{path}[{i}]')


def privacy_scan(obj):
    """Refusals for credentials, raw bodies, bank identifiers, e-mail addresses and phone numbers anywhere in a payload.
    Fail-closed: a refusal is a stop, never a redaction."""
    out = []
    for path, v in walk(obj):
        key = path.rsplit('.', 1)[-1].split('[')[0]
        lk = key.lower()
        if CREDENTIAL_KEYS.search(key):                       # dict-valued credential keys are refused too
            out.append(f'{path}: credential-like key')
            continue
        if lk in FORBIDDEN_KEYS or lk in BODY_KEYS:
            out.append(f'{path}: raw content key')
            continue
        if isinstance(v, str):
            if ISO_TIME.match(v) or HEX_ONLY.match(v):
                continue                                           # dates and content hashes look like phone numbers / IBANs
            if IBAN_LIKE.search(v) or IBAN_WHOLE_LOWER.match(v) or len(v) > 2000:
                out.append(f'{path}: bank identifier or oversized text')
            elif lk not in ID_KEYS and (EMAIL_LIKE.search(v) or PHONE_LIKE.search(v)):
                out.append(f'{path}: e-mail address or phone number')
    return out
