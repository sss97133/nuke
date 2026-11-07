"""Shared helpers for the client-evidence producers (stdlib only, no I/O)."""
import hashlib, json, re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

SHA_RE = re.compile(r'^[a-f0-9]{64}$')
IBAN_LIKE = re.compile(r'[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}')   # mirrors the writer's refusal
FORBIDDEN_KEYS = {'ocr_text', 'raw_text', 'full_ocr', 'full_text', 'iban', 'bank_iban', 'full_iban', 'redacted_source'}
CREDENTIAL_KEYS = re.compile(r'(token|password|passwd|secret|api_?key|authorization|cookie|credential|refresh|bearer)', re.I)
BODY_KEYS = {'body', 'body_text', 'html', 'snippet', 'content', 'text'}


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
        return Decimal(str(value).replace(',', '').replace('$', '').strip())
    except InvalidOperation:
        raise ContractError(f'{field}: not a decimal: {value!r}')


def money(d):
    return str(Decimal(d).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


def walk(obj, path='$'):
    yield path, obj
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from walk(v, f'{path}.{k}')
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk(v, f'{path}[{i}]')


def privacy_scan(obj):
    """Return refusals for credentials, raw bodies, bank identifiers anywhere in a payload."""
    out = []
    for path, v in walk(obj):
        key = path.rsplit('.', 1)[-1].split('[')[0]
        if isinstance(v, dict):
            continue
        if CREDENTIAL_KEYS.search(key):
            out.append(f'{path}: credential-like key')
        elif key.lower() in FORBIDDEN_KEYS or key.lower() in BODY_KEYS:
            out.append(f'{path}: raw content key')
        if isinstance(v, str) and (IBAN_LIKE.search(v) or len(v) > 2000):
            out.append(f'{path}: bank identifier or oversized text')
    return out
