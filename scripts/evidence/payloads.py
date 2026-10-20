"""The writer contract: argument names, CHECK vocabularies and payload builders for the image-evidence writers.

Source: draft.sql blocks M1a (tables and CHECKs), M1w (writers, readers) and M1p (promotion path), design v3 of
2026-10-20. Every pass builds its rows here, and checks.py validates against the same CONTRACT, so a later design
revision that renames a field or a value is one edit in this module, or a JSON override passed as the case's
`contract_overrides` (merged key by key; `renames` maps writer -> {old field: new field} and is applied to every row
a builder emits).

File-mode line shapes (one JSON object per line):
  row writers            {"key", "writer", "p_run_id": "@run:<pass>", "row": {...}}
  propose_change_claim   {"key", "writer", "p_run_id", "p_claim": {...}, "p_support": [...], "p_supersedes": null}
  propose_claim_support  {"key", "writer", "p_run_id", "p_claim_id": "@key:<claim key>", "p_support": [...]}
  run.json runs[]        {"key": "run:<pass>", "writer": "evidence_open_run", "args": {...}}
Placeholders the loader resolves at load time: @config.user_id, @run:<pass>, @key:<line key>,
@amount:<amount source>:<ref> (amounts never appear in a file).
"""
import copy
import json
import re

import common

CONTRACT = {
    'version': 'draft-v3-2026-10-20',
    'pass_names': [
        'listing_class', 'time_offset', 'photos_join', 'photos_album', 'file_hash_twin', 'exif_neighbour',
        'day_context', 'legacy_suggestion', 'claim_import', 'jev_choice', 'paid_vision', 'combined', 'owner_review',
        'audit_sample', 'ledger_vendor_date', 'pnl_allocation', 'gmail_order', 'messages_mention',
        'receipt_vehicle_id', 'qb_correlation', 'deal_document', 'vin_decode', 'identity_compare', 'account_map',
        'custody_bounds', 'listing_watch', 'change_infer', 'loop', 'time_rule_gate', 'exit_test', 'review_sheet',
        'promote', 'repin', 'publication', 'probe'],
    'run_kinds': ['daily', 'backfill', 'pilot', 'audit', 'calibration', 'exit_test', 'review', 'review_answers',
                  'probe', 'promote', 'repin'],
    'run_kinds_own_writer': ['probe', 'review_answers'],      # evidence_open_run refuses these
    'verdicts': ['is_vehicle', 'not_vehicle', 'other_vehicle', 'ambiguous', 'listing_evidence'],
    'vehicle_verdicts': ['is_vehicle', 'listing_evidence'],
    'no_vehicle_verdicts': ['not_vehicle', 'other_vehicle'],
    'frame_roles': ['subject', 'also_in_frame'],
    'image_classes': ['own', 'third_party', 'listing', 'document', 'unknown'],
    'time_rules': ['photos_exif_join', 'batch_offset_v1', 'owner'],
    'allowed_offset_hours': [0, 3, 4, 6, 7, 8],
    'source_kinds': ['bank_line', 'ledger_line', 'pnl_line', 'gmail_order', 'gmail_message', 'message', 'receipt',
                     'qb_transaction', 'payment_event', 'journal_entry', 'deal_jacket', 'deal_document',
                     'photos_album', 'work_session', 'listing', 'calendar_item', 'note', 'vehicle_field',
                     'owner_statement'],
    'anchor_required': ['deal_jacket', 'deal_document', 'journal_entry', 'vehicle_field'],
    'payment_sources': ['bank_line', 'ledger_line', 'payment_event', 'qb_transaction'],
    'directions': ['out', 'in', 'none'],
    'cost_categories': ['purchase', 'parts', 'paint', 'transport', 'storage', 'fees', 'other'],
    'roles': ['payment_out', 'payment_in', 'assertion', 'supports', 'contradicts', 'context'],
    'payment_roles': {'payment_out': 'out', 'payment_in': 'in'},
    'payment_key_re': r'^(bank|ledger|payment_event|qb|owner):[A-Za-z0-9_.:#-]+$',
    'entity_key_re': r'^(owner|owner_business:[a-z0-9_]+|third_party:[a-z0-9_]+|unknown)$',
    'account_ref_re': r'^(ledger_account|bank_account|nuke_org):[A-Za-z0-9_.:-]+$',
    'subject_key_re': r'^(vin|album|label):[A-Za-z0-9_.:-]+$',
    'claim_domains': ['physical', 'custody', 'money', 'record'],
    'claim_kinds': ['acquisition', 'sale', 'listing', 'transport', 'worked_on', 'work_performed', 'part_installed',
                    'part_removed', 'paint', 'body', 'lift', 'suspension', 'engine', 'interior', 'detail', 'repair',
                    'inspection', 'same_vehicle_as', 'vin_is', 'model_is', 'other'],
    'party_kinds': ['work_performed', 'worked_on', 'acquisition', 'sale'],
    'trade_in_kinds': ['sale', 'acquisition'],
    'scope_claim_kinds': ['same_vehicle_as', 'sale', 'acquisition'],   # evidence_scope_vehicle_ids (b)
    'support_kinds': ['image_candidate', 'evidence_link', 'capture_time_claim', 'vehicle_image', 'work_session',
                      'change_claim'],
    'stances': ['supports', 'contradicts'],
    'about': ['date', 'amount', 'party', 'vehicle', 'identity', 'condition', 'other'],
    'day_basis': ['custody_window', 'confirmed_photo_pm14d', 'album_items_that_day', 'open_change_claim',
                  'work_session', 'worked_on', 'owner', 'proposed_photo_that_day', 'gps_place_match'],
    'target_kinds': ['image_candidate', 'capture_time_claim', 'evidence_link', 'album_map', 'change_claim',
                     'day_context', 'account_entity', 'image_publication'],
    'review_methods': ['owner_chat_review', 'owner_page', 'owner_app', 'owner_physical_check'],
    'label_max': 60, 'summary_max': 60, 'note_max': 120,
    'confidence_places': 3,
    'writers': {
        'evidence_open_run': {'args': ['p_user_id', 'p_run_kind', 'p_pass', 'p_producer', 'p_code_version',
                                       'p_config', 'p_scope', 'p_from', 'p_to', 'p_parent_run_id']},
        'evidence_close_run': {'args': ['p_run_id', 'p_status', 'p_counts', 'p_input_tokens', 'p_scoreboard',
                                        'p_gap_picked']},
        'evidence_record_answers': {'args': ['p_user_id', 'p_sheet_run', 'p_message_ref', 'p_rows', 'p_producer',
                                             'p_code_version']},
        'propose_image_candidates': {'args': ['p_run_id', 'p_rows'], 'max_rows': 500, 'row': 'candidate'},
        'propose_capture_time_claims': {'args': ['p_run_id', 'p_rows'], 'max_rows': 500, 'row': 'capture_time'},
        'confirm_capture_times_by_rule': {'args': ['p_gate_run_id', 'p_claim_ids'], 'max_rows': 1000},
        'propose_evidence_links': {'args': ['p_run_id', 'p_rows'], 'max_rows': 500, 'row': 'link'},
        'propose_account_entities': {'args': ['p_run_id', 'p_rows'], 'max_rows': 200, 'row': 'account_entity'},
        'propose_change_claim': {'args': ['p_run_id', 'p_claim', 'p_support', 'p_supersedes'], 'row': 'claim'},
        'propose_claim_support': {'args': ['p_run_id', 'p_claim_id', 'p_support'], 'max_rows': 50},
        'record_day_context': {'args': ['p_run_id', 'p_rows'], 'max_rows': 500, 'row': 'day_context'},
        'decide_evidence': {'args': ['p_target_kind', 'p_target_ids', 'p_decision', 'p_reason', 'p_review_ref',
                                     'p_review_method', 'p_actor_user_id', 'p_expected', 'p_reassign_vehicle_id',
                                     'p_agent_session', 'p_answer_ref'], 'max_rows': 200},
        'evidence_record_reverts': {'args': ['p_user_id']},
        'evidence_probe_write': {'args': ['p_parent_run_id', 'p_user_id', 'p_vehicle_id', 'p_image_id',
                                          'p_sibling_vehicle_id']},
        'promote_image': {'args': ['p_run_id', 'p_image_id', 'p_actor_user_id', 'p_options']},
        'record_promotion_failure': {'args': ['p_run_id', 'p_actor_user_id', 'p_image_id', 'p_sqlstate',
                                              'p_message', 'p_step']},
        'evidence_repin_after_merge': {'args': ['p_run_id', 'p_user_id', 'p_limit']},
        'publish_image': {'args': ['p_run_id', 'p_actor_user_id', 'p_image_id']},
    },
    'readers': {
        'vehicle_accounting_evidence': ['p_vehicle_id', 'p_from', 'p_to'],
        'get_vehicle_day_records': ['p_vehicle_id', 'p_from', 'p_to'],
        'get_user_day_record': ['p_user_id', 'p_day'],
        'evidence_revert_watch': ['p_user_id'],
    },
    # The row fields each row writer reads (x->>'<field>' in draft.sql). Builders emit nothing else.
    'fields': {
        'candidate': ['image_id', 'vehicle_id', 'verdict', 'frame_role', 'subject_key', 'join_key', 'confidence',
                      'probabilities', 'candidate_set', 'ambiguity_group', 'evidence', 'image_class',
                      'album_link_id', 'pass_captured_on'],
        'capture_time': ['image_id', 'stored_taken_at', 'corrected_taken_at', 'offset_seconds',
                         'local_offset_minutes', 'captured_on', 'rule', 'batch_key', 'witness', 'confidence'],
        'link': ['vehicle_id', 'subject_key', 'source_kind', 'source_table', 'source_row_id', 'external_ref',
                 'anchor', 'source_sha256', 'source_label', 'occurred_on', 'transaction_on', 'direction',
                 'amount_cents', 'allocated_cents', 'cost_category', 'counterparty_label', 'role', 'payment_key',
                 'payer_entity', 'payee_entity', 'from_account_ref', 'to_account_ref', 'join_key', 'confidence',
                 'payment_join_confidence', 'evidence', 'summary'],
        'account_entity': ['account_ref', 'entity_key', 'confidence', 'evidence'],
        'day_context': ['day', 'place_cluster', 'vehicle_id', 'confidence', 'basis'],
        'claim': ['vehicle_id', 'claim_domain', 'kind', 'occurred_from', 'occurred_to', 'amount_cents',
                  'trade_in_cents', 'related_vehicle_id', 'survivor_vehicle_id', 'party_entity', 'asserted_value',
                  'summary', 'confidence'],
        'support': ['evidence_kind', 'evidence_id', 'stance', 'about', 'weight', 'note'],
    },
    'renames': {},
    # Canonical files, the writer each holds, and the load order (listing_class last: it waits for the dedupe).
    'files': [
        ['time_claims.jsonl', 'propose_capture_time_claims'],
        ['links.album.jsonl', 'propose_evidence_links'],
        ['candidates.photos_album.jsonl', 'propose_image_candidates'],
        ['candidates.combined.jsonl', 'propose_image_candidates'],
        ['day_context.jsonl', 'record_day_context'],
        ['links.jsonl', 'propose_evidence_links'],
        ['account_entities.jsonl', 'propose_account_entities'],
        ['change_claims.jsonl', 'propose_change_claim'],
        ['claim_support.jsonl', 'propose_claim_support'],
        ['candidates.listing_class.jsonl', 'propose_image_candidates'],
    ],
}


def _merge(base, over):
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _merge(base[k], v)
        else:
            base[k] = v
    return base


def load_contract(overrides=None):
    """CONTRACT, with overrides (a dict, or a path to a JSON file) merged in."""
    c = copy.deepcopy(CONTRACT)
    if isinstance(overrides, str):
        overrides = common.load_json(overrides)
    return _merge(c, overrides)


C = CONTRACT


def use_contract(c):
    """Make the builders emit for contract c (checks and passes call this with the case's merged contract)."""
    global C
    C = c


def _clean(kind, row, writer=None):
    allowed = C['fields'][kind]
    extra = set(row) - set(allowed)
    if extra:
        raise ValueError('%s row has fields the writer does not read: %s' % (kind, sorted(extra)))
    out = {k: row[k] for k in allowed if k in row and row[k] is not None}
    for old, new in (C.get('renames') or {}).get(writer or kind, {}).items():
        if old in out:
            out[new] = out.pop(old)
    return out


def conf(x):
    """numeric(4,3): three places, 0..1."""
    v = round(float(x), C['confidence_places'])
    if not 0 <= v <= 1:
        raise ValueError('confidence %r outside 0..1' % x)
    return v


# ---------------------------------------------------------------------------------------------------- keys
def source_key(source_table=None, source_row_id=None, external_ref=None, anchor=None):
    """el_source_key_ok: coalesce(source_table || ':' || source_row_id, external_ref) || coalesce('#' || anchor, '')."""
    base = ('%s:%s' % (source_table, source_row_id)) if source_table and source_row_id else external_ref
    if not base:
        raise ValueError('a link names its source (source_table + source_row_id, or external_ref)')
    return base + (('#' + anchor) if anchor else '')


def link_key(skey, vehicle_id=None, subject_key=None):
    return 'link:%s@%s' % (skey, vehicle_id[:8] if vehicle_id else (subject_key or 'none'))


def cand_key(pass_name, image_id, vehicle_id=None):
    return 'cand:%s:%s' % (pass_name, image_id) + (('@' + vehicle_id[:8]) if vehicle_id else '')


def run_ref(pass_name):
    return '@run:' + pass_name


def key_ref(key):
    return '@key:' + key


def amount_ref(source, ref):
    return '@amount:%s:%s' % (source, ref)


# ---------------------------------------------------------------------------------------------------- row builders
def line(key, writer, pass_name, row):
    return {'key': key, 'writer': writer, 'p_run_id': run_ref(pass_name), 'row': row}


def candidate(image_id, vehicle_id, verdict, join_key, confidence, evidence, image_class='own', frame_role='subject',
              subject_key=None, candidate_set=None, ambiguity_group=None, album_link_id=None, pass_captured_on=None,
              probabilities=None):
    return _clean('candidate', {
        'image_id': image_id, 'vehicle_id': vehicle_id, 'verdict': verdict, 'frame_role': frame_role,
        'subject_key': subject_key, 'join_key': join_key, 'confidence': conf(confidence),
        'probabilities': probabilities, 'candidate_set': candidate_set, 'ambiguity_group': ambiguity_group,
        'evidence': evidence, 'image_class': image_class, 'album_link_id': album_link_id,
        'pass_captured_on': pass_captured_on}, 'propose_image_candidates')


def whole_hour_offset(stored, corrected):
    """The writer's offset rule (v3, FM-1): stored - corrected in seconds; a whole number of hours when the residual
    is under 1 s (the residual then goes to the witness), else the rounded raw value. -> (offset_seconds, residual)"""
    raw = (common.parse_ts(stored) - common.parse_ts(corrected)).total_seconds()
    whole = common.pg_round(raw / 3600) * 3600
    off = int(whole) if abs(raw - whole) < 1 else common.pg_round(raw)
    return off, round(raw - off, 3)


def capture_time_claim(image_id, stored_taken_at, corrected_taken_at, captured_on, rule, witness, confidence,
                       local_offset_minutes=None, batch_key=None, offset_seconds=None):
    if offset_seconds is None and stored_taken_at is not None:
        offset_seconds = whole_hour_offset(stored_taken_at, corrected_taken_at)[0]
    return _clean('capture_time', {
        'image_id': image_id, 'stored_taken_at': common.iso_utc(stored_taken_at) if stored_taken_at else None,
        'corrected_taken_at': common.iso_utc(corrected_taken_at), 'offset_seconds': offset_seconds,
        'local_offset_minutes': local_offset_minutes, 'captured_on': captured_on, 'rule': rule,
        'batch_key': batch_key, 'witness': witness, 'confidence': conf(confidence)}, 'propose_capture_time_claims')


def evidence_link(vehicle_id, source_kind, role, join_key, confidence, evidence, external_ref=None, anchor=None,
                  source_table=None, source_row_id=None, subject_key=None, source_sha256=None, source_label=None,
                  occurred_on=None, transaction_on=None, direction=None, amount_cents=None, allocated_cents=None,
                  cost_category=None, counterparty_label=None, payment_key=None, payer_entity=None,
                  payee_entity=None, from_account_ref=None, to_account_ref=None, payment_join_confidence=None,
                  summary=None):
    if role in C['payment_roles'] and direction is None:
        direction = C['payment_roles'][role]
    return _clean('link', {
        'vehicle_id': vehicle_id, 'subject_key': subject_key, 'source_kind': source_kind,
        'source_table': source_table, 'source_row_id': source_row_id, 'external_ref': external_ref,
        'anchor': anchor, 'source_sha256': source_sha256,
        'source_label': source_label[:C['label_max']] if source_label else None,
        'occurred_on': occurred_on, 'transaction_on': transaction_on, 'direction': direction,
        'amount_cents': amount_cents, 'allocated_cents': allocated_cents, 'cost_category': cost_category,
        'counterparty_label': counterparty_label, 'role': role, 'payment_key': payment_key,
        # 'unknown' is a real entity value; a NULL lets the reader resolve the side from the confirmed account map
        'payer_entity': None if payer_entity == 'unknown' else payer_entity,
        'payee_entity': None if payee_entity == 'unknown' else payee_entity,
        'from_account_ref': from_account_ref, 'to_account_ref': to_account_ref, 'join_key': join_key,
        'confidence': conf(confidence),
        'payment_join_confidence': conf(payment_join_confidence) if payment_join_confidence is not None else None,
        'evidence': evidence, 'summary': summary[:C['summary_max']] if summary else None}, 'propose_evidence_links')


def account_entity(account_ref, entity_key, confidence, evidence):
    return _clean('account_entity', {'account_ref': account_ref, 'entity_key': entity_key,
                                     'confidence': conf(confidence), 'evidence': evidence},
                  'propose_account_entities')


def day_context(day, place_cluster, vehicle_id, confidence, basis):
    return _clean('day_context', {'day': day, 'place_cluster': place_cluster, 'vehicle_id': vehicle_id,
                                  'confidence': conf(confidence), 'basis': list(basis)}, 'record_day_context')


def change_claim(vehicle_id, claim_domain, kind, summary, confidence, occurred_from=None, occurred_to=None,
                 amount_cents=None, trade_in_cents=None, related_vehicle_id=None, survivor_vehicle_id=None,
                 party_entity=None, asserted_value=None):
    return _clean('claim', {
        'vehicle_id': vehicle_id, 'claim_domain': claim_domain, 'kind': kind, 'occurred_from': occurred_from,
        'occurred_to': occurred_to, 'amount_cents': amount_cents, 'trade_in_cents': trade_in_cents,
        'related_vehicle_id': related_vehicle_id, 'survivor_vehicle_id': survivor_vehicle_id,
        'party_entity': party_entity, 'asserted_value': asserted_value, 'summary': summary,
        'confidence': conf(confidence)}, 'propose_change_claim')


def support(evidence_kind, evidence_id, stance, about, note=None, weight=None):
    if note and len(note) > C['note_max']:
        note = note[:C['note_max']]
    return _clean('support', {'evidence_kind': evidence_kind, 'evidence_id': evidence_id, 'stance': stance,
                              'about': about, 'weight': conf(weight) if weight is not None else None,
                              'note': note}, 'support')


def claim_line(key, pass_name, claim, supports, supersedes=None):
    return {'key': key, 'writer': 'propose_change_claim', 'p_run_id': run_ref(pass_name), 'p_claim': claim,
            'p_support': supports, 'p_supersedes': supersedes}


def support_line(key, pass_name, claim_key, supports):
    return {'key': key, 'writer': 'propose_claim_support', 'p_run_id': run_ref(pass_name),
            'p_claim_id': key_ref(claim_key), 'p_support': supports}


# ---------------------------------------------------------------------------------------------------- run and decision args
def open_run(user_id, run_kind, pass_name, producer, code_version, config, scope=None, date_from=None, date_to=None,
             parent=None):
    if run_kind in C['run_kinds_own_writer']:
        raise ValueError('run kind %s is written only by its own writer' % run_kind)
    return {'p_user_id': user_id, 'p_run_kind': run_kind, 'p_pass': pass_name, 'p_producer': producer,
            'p_code_version': code_version, 'p_config': config or {}, 'p_scope': scope or {}, 'p_from': date_from,
            'p_to': date_to, 'p_parent_run_id': parent}


def close_run(run_id, status, counts, input_tokens=0, scoreboard=None, gap_picked=None):
    if status not in ('done', 'failed', 'aborted'):
        raise ValueError('close status must be done, failed or aborted')
    return {'p_run_id': run_id, 'p_status': status, 'p_counts': counts, 'p_input_tokens': input_tokens,
            'p_scoreboard': scoreboard, 'p_gap_picked': gap_picked}


def record_answers(user_id, sheet_run, message_ref, rows, producer, code_version):
    """rows: {"<sheet row>": "<verbatim answer>"} -> the evidence_record_answers args ({"<row>": {"verbatim"}})."""
    return {'p_user_id': user_id, 'p_sheet_run': sheet_run, 'p_message_ref': message_ref,
            'p_rows': {str(k): {'verbatim': v} for k, v in rows.items()}, 'p_producer': producer,
            'p_code_version': code_version}


def decide(target_kind, target_ids, decision, reason, sheet_run, row, answers_run, owner, agent_session,
           expected=None, reassign_vehicle_id=None):
    """decide_evidence on the agent channel: the question is review:<sheet run>#<row>; the answer cited is
    answers:<answers run>#<same row> (ed_agent_traceable)."""
    if target_kind not in C['target_kinds'] or decision not in ('confirmed', 'rejected'):
        raise ValueError('decide: bad target kind or decision')
    if not re.match(r'^[A-Za-z0-9_.-]{3,64}$', agent_session or ''):
        raise ValueError('agent session must match [A-Za-z0-9_.-]{3,64}')
    if target_kind == 'image_candidate' and not expected:
        raise ValueError('image decisions need expected {candidate_id: vehicle the owner saw}')
    return {'p_target_kind': target_kind, 'p_target_ids': list(target_ids), 'p_decision': decision,
            'p_reason': reason, 'p_review_ref': 'review:%s#%d' % (sheet_run, int(row)),
            'p_review_method': 'owner_chat_review', 'p_actor_user_id': owner, 'p_expected': expected,
            'p_reassign_vehicle_id': reassign_vehicle_id, 'p_agent_session': agent_session,
            'p_answer_ref': 'answers:%s#%d' % (answers_run, int(row))}


def rpc_args(writer, values):
    """Order and check RPC args against the contract (an arg the writer does not take is an error)."""
    names = C['writers'][writer]['args']
    extra = set(values) - set(names)
    if extra:
        raise ValueError('%s does not take %s' % (writer, sorted(extra)))
    return {k: values[k] for k in names if k in values}


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True)
