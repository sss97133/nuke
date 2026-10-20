"""The writer contract: argument names, CHECK vocabularies and payload builders for the image-evidence writers.

Source: draft.sql blocks M1a (tables and CHECKs), M1w (writers, readers) and M1p (promotion path), design v8 of
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

v5 rules the builders apply (DESIGN-v5 "Changes from v4"): a pass names only third parties as payer, payee or party
(the owner's entities come from his confirmed account map, or from his own decision in the app); only payment-source
runs record coverage_to, always with covers_accounts; review runs store per-row targets.
v6 (DESIGN-v6 "Changes from v5"): each review row asks one question (one decision kind; 'place' or 'party'), and a
reading names only a place of the row's dimension, never inverted ("no" to the asked place is bare); a payment-source
run may record closed_accounts (a subset of covers_accounts).
v7: one spelling per message, '<source>:<message id>' with exactly one colon and no path (stored lower-cased; the
message id is unique across every answers run); a row whose own targets place nothing asks about place 'none'; a
statement cannot cover days that have not happened.
v8 (the agent decision channel does not ship): no job decides. The runner never calls decide_evidence (service_role
has no EXECUTE on it), never writes his word (an owner_statement link, an 'owner:' payment key or a rule 'owner'
capture time is owner_answer_missing) and never opens an owner_review run. His chat answers are stored word for word
(evidence_record_answers, with an optional reading) and wait for him to confirm them in the app.
"""
import copy
import datetime as dt
import json
import re

import common

CONTRACT = {
    'version': 'draft-v8-2026-10-20',
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
                     'owner_statement', 'photos_item'],
    'anchor_required': ['deal_jacket', 'deal_document', 'journal_entry', 'vehicle_field'],
    'payment_sources': ['bank_line', 'ledger_line', 'payment_event', 'qb_transaction'],
    # er_coverage_source: only these runs record config.coverage_to, always with config.covers_accounts
    'payment_source_passes': ['ledger_vendor_date', 'qb_correlation', 'receipt_vehicle_id'],
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
    'owner_party_kinds': ['work_performed', 'worked_on'],          # vcc_party_not_entity: 'owner' as the worker only
    'subject_claim_kinds': ['worked_on', 'work_performed'],        # vcc_subject: a truck with no row
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
    # evidence_open_run (review): rows.<n>.targets name ids of these kinds, or keys of the key kinds
    'review_id_kinds': ['image', 'image_candidate', 'evidence_link', 'album_map', 'change_claim', 'capture_time_claim',
                        'day_context', 'account_entity', 'image_publication'],
    'review_key_kinds': ['payment', 'source', 'account'],
    # (v6, AC1) the one decision kind a sheet row asks about (evidence_sheet_row)
    'review_questions': ['image_candidate', 'image_publication', 'capture_time_claim', 'evidence_link', 'album_map',
                         'account_entity', 'change_claim', 'day_context'],
    'image_questions': ['image_candidate', 'image_publication', 'capture_time_claim'],
    # evidence_record_answers: an optional reading, {"decision": confirmed|rejected|unsure, and at most one place of
    # the row's dimension}; (v8) a row stored with his words alone reads {"decision": "unsure", "unread": true}
    'answer_decisions': ['confirmed', 'rejected', 'unsure'],
    'answer_places': ['vehicle_id', 'subject_key', 'entity_key', 'captured_on'],
    'answer_ref_re': r'^answers:[0-9a-f-]{36}#[0-9]+$',
    # (v6, AC10; v7, D4) one transcription per message: '<source>:<message id>', exactly one colon, no path, at most
    # 200 characters; the writer stores it lower-cased and keys uniqueness on the message id
    'message_ref_re': r'^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$',
    # Per-row results the writers return that are reported and never retried (PLAN section 1, runner notes); the next
    # sheet or the next run asks again. (v8) owner_answer_missing: a job never writes his word.
    'reported_outcomes': ['already_decided', 'already_rejected', 'owner_answer_missing', 'kept_stronger',
                          'entity_is_owners_call', 'unchanged'],
    # evidence_writer_names(): the only functions that may be the outermost caller of a write to the nine tables
    # ('writers' below are the ones this runner calls: (v8) never decide_evidence, his own session's writer)
    'writer_names': ['evidence_open_run', 'evidence_close_run', 'evidence_record_answers', 'propose_image_candidates',
                     'propose_capture_time_claims', 'confirm_capture_times_by_rule', 'propose_evidence_links',
                     'propose_account_entities', 'propose_change_claim', 'propose_claim_support', 'record_day_context',
                     'decide_evidence', 'evidence_record_reverts', 'evidence_probe_write', 'promote_image',
                     'record_promotion_failure', 'evidence_repin_after_merge', 'publish_image'],
    'guard_triggers': 27,                                           # M1a-a: every guard trigger fires ALWAYS
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
        'evidence_record_reverts': {'args': ['p_user_id']},
        'evidence_probe_write': {'args': ['p_parent_run_id', 'p_user_id', 'p_vehicle_id', 'p_image_id',
                                          'p_sibling_vehicle_id']},
        'promote_image': {'args': ['p_run_id', 'p_image_id', 'p_actor_user_id', 'p_options']},
        'record_promotion_failure': {'args': ['p_run_id', 'p_actor_user_id', 'p_image_id', 'p_sqlstate',
                                              'p_message', 'p_step']},
        'evidence_repin_after_merge': {'args': ['p_run_id', 'p_user_id', 'p_limit']},
        'publish_image': {'args': ['p_run_id', 'p_actor_user_id', 'p_image_id']},
    },
    # (v5, readers v4 #1) every reader is keyed by user: the runner always passes p_user_id
    'readers': {
        'vehicle_accounting_evidence': ['p_vehicle_id', 'p_from', 'p_to', 'p_user_id'],
        'get_vehicle_day_records': ['p_vehicle_id', 'p_from', 'p_to', 'p_user_id'],
        'evidence_candidates_for_images': ['p_image_ids', 'p_user_id'],
        'evidence_custody': ['p_ids', 'p_user_id'],
        'evidence_identity_set': ['p_vehicle_id', 'p_user_id'],
        'get_user_day_record': ['p_user_id', 'p_day'],
        'evidence_revert_watch': ['p_user_id'],
        'evidence_answers_to_confirm': ['p_user_id'],         # (v8) his stored answers waiting for his app (M15)
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
        'claim': ['vehicle_id', 'subject_key', 'claim_domain', 'kind', 'occurred_from', 'occurred_to', 'amount_cents',
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
    if rule == 'owner':
        # (v8) his day for a photo is written only by his own decision in the app (decide_evidence), never by a job:
        # propose_capture_time_claims counts such a row as owner_answer_missing
        raise ValueError("a job never proposes a rule 'owner' capture time: his day comes from his decision in the app")
    if offset_seconds is None and stored_taken_at is not None:
        offset_seconds = whole_hour_offset(stored_taken_at, corrected_taken_at)[0]
    return _clean('capture_time', {
        'image_id': image_id, 'stored_taken_at': common.iso_utc(stored_taken_at) if stored_taken_at else None,
        'corrected_taken_at': common.iso_utc(corrected_taken_at), 'offset_seconds': offset_seconds,
        'local_offset_minutes': local_offset_minutes, 'captured_on': captured_on, 'rule': rule,
        'batch_key': batch_key, 'witness': witness, 'confidence': conf(confidence)}, 'propose_capture_time_claims')


def third_party(entity):
    """A party a pass may name (v5, rules-channels v4 #4): 'third_party:<x>', else None. Whether money was his or one
    of his businesses' is his call (his confirmed account map, or his own who-paid decision in the app), so 'owner',
    'owner_business:*' and 'unknown' become NULL and the reader resolves the side from the account map."""
    return entity if isinstance(entity, str) and entity.startswith('third_party:') else None


def claim_party(kind, entity):
    """vcc_party_not_entity: a third party the source names, or 'owner' as the one who did the work."""
    if entity == 'owner' and kind in C['owner_party_kinds']:
        return entity
    return third_party(entity)


def answer_ref(answers_run, row):
    """A stored answer as his app decision cites it (p_answer_ref)."""
    return 'answers:%s#%d' % (answers_run, int(row))


def link_class(role, allocated, source_kind):
    """(v6, AC2/AC7/AC12) evidence_link_class: placement (unallocated payment or figure), share (allocated), album,
    contradicts or other; it decides which places a reading of a money row may name."""
    if source_kind == 'photos_album':
        return 'album'
    if role in ('payment_out', 'payment_in', 'assertion'):
        return 'placement' if allocated is None else 'share'
    return 'contradicts' if role == 'contradicts' else 'other'


def evidence_link(vehicle_id, source_kind, role, join_key, confidence, evidence, external_ref=None, anchor=None,
                  source_table=None, source_row_id=None, subject_key=None, source_sha256=None, source_label=None,
                  occurred_on=None, transaction_on=None, direction=None, amount_cents=None, allocated_cents=None,
                  cost_category=None, counterparty_label=None, payment_key=None, payer_entity=None,
                  payee_entity=None, from_account_ref=None, to_account_ref=None, payment_join_confidence=None,
                  summary=None):
    if role in C['payment_roles'] and direction is None:
        direction = C['payment_roles'][role]
    if source_kind == 'owner_statement' or (payment_key or '').startswith('owner:'):
        # (v8) his word ("the shop paid") is written only by his own who-paid decision in the app; propose_evidence_links
        # returns owner_answer_missing for any job row carrying it
        raise ValueError('a job never writes an owner statement or an owner: payment key (his decision in the app does)')
    payer_entity, payee_entity = third_party(payer_entity), third_party(payee_entity)
    return _clean('link', {
        'vehicle_id': vehicle_id, 'subject_key': subject_key, 'source_kind': source_kind,
        'source_table': source_table, 'source_row_id': source_row_id, 'external_ref': external_ref,
        'anchor': anchor, 'source_sha256': source_sha256,
        'source_label': source_label[:C['label_max']] if source_label else None,
        'occurred_on': occurred_on, 'transaction_on': transaction_on, 'direction': direction,
        'amount_cents': amount_cents, 'allocated_cents': allocated_cents, 'cost_category': cost_category,
        'counterparty_label': counterparty_label, 'role': role, 'payment_key': payment_key,
        'payer_entity': payer_entity, 'payee_entity': payee_entity,
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
                 party_entity=None, asserted_value=None, subject_key=None):
    """vcc_subject: exactly one of vehicle_id and subject_key, and a subject_key only on worked_on / work_performed."""
    if (vehicle_id is None) == (subject_key is None) or (subject_key and kind not in C['subject_claim_kinds']):
        raise ValueError('a %s claim names a vehicle (or, on %s only, a subject_key)'
                         % (kind, ' / '.join(C['subject_claim_kinds'])))
    return _clean('claim', {
        'vehicle_id': vehicle_id, 'subject_key': subject_key, 'claim_domain': claim_domain, 'kind': kind,
        'occurred_from': occurred_from, 'occurred_to': occurred_to, 'amount_cents': amount_cents,
        'trade_in_cents': trade_in_cents, 'related_vehicle_id': related_vehicle_id,
        'survivor_vehicle_id': survivor_vehicle_id, 'party_entity': claim_party(kind, party_entity),
        'asserted_value': asserted_value, 'summary': summary, 'confidence': conf(confidence)}, 'propose_change_claim')


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
def coverage_problem(pass_name, config, today=None):
    """er_coverage_source: coverage_to only on a payment-source run, as a date, with a non-empty covers_accounts;
    (v6, RU4/RU9) closed_accounts only with coverage_to, a subset of covers_accounts; (v7, F7c) given the day of the run
    (today), coverage_to is not later than it."""
    config = config or {}
    if 'coverage_to' not in config and 'covers_accounts' not in config:
        return 'closed_accounts goes with coverage_to on a payment-source run' if 'closed_accounts' in config else None
    if pass_name not in C['payment_source_passes']:
        return 'coverage_to is recorded only by payment-source runs (%s), not %s' % (
            ', '.join(C['payment_source_passes']), pass_name)
    if not re.match(r'^[0-9]{4}-[0-9]{2}-[0-9]{2}$', str(config.get('coverage_to') or '')):
        return 'coverage_to must be a date (YYYY-MM-DD)'
    accts = config.get('covers_accounts')
    if not (isinstance(accts, list) and accts and all(isinstance(a, str) and re.match(C['account_ref_re'], a)
                                                      for a in accts)):
        return 'coverage_to needs covers_accounts: the account refs the export covers'
    try:
        cover = dt.date.fromisoformat(config['coverage_to'])
    except ValueError:
        return 'coverage_to %s is not a date' % config['coverage_to']
    if today is not None and cover > today:
        return 'coverage_to %s is later than the run day %s (a statement covers only days that have happened)' % (
            cover, today)
    closed = config.get('closed_accounts')
    if closed is not None and not (isinstance(closed, list) and set(closed) <= set(accts)):
        return 'closed_accounts must be a subset of covers_accounts (accounts whose final statement the export is)'
    return None


def review_target(kind, ident=None, key=None):
    """One target of a review-sheet row: {"kind", "id"} for an evidence row or image, {"kind", "key"} for a payment,
    a source or an account (evidence_open_run checks the shapes)."""
    if kind in C['review_id_kinds'] and common.is_uuid(ident or ''):
        return {'kind': kind, 'id': ident}
    if kind in C['review_key_kinds'] and key and (kind != 'account' or re.match(C['account_ref_re'], key)):
        return {'kind': kind, 'key': key}
    raise ValueError('review target %s %r is not an id or key evidence_open_run accepts' % (kind, ident or key))


def row_question(row):
    """(v6, AC1) The one decision kind a sheet row asks about, from its targets as evidence_sheet_row derives it (a
    payment or source key asks about links, an account about its map row, an image adds no kind), or the row's own
    'question' when it lists only images. Raises when the targets imply two kinds or a stated question disagrees."""
    kinds = set()
    for t in row.get('targets') or []:
        k = t.get('kind')
        if k in C['review_questions']:
            kinds.add(k)
        elif k in ('payment', 'source'):
            kinds.add('evidence_link')
        elif k == 'account':
            kinds.add('account_entity')
    if len(kinds) > 1:
        raise ValueError('the row asks about more than one kind of thing (%s): one question per row' % sorted(kinds))
    q = next(iter(kinds), None)
    if row.get('question') is not None:
        if q is not None and row['question'] != q:
            raise ValueError('question %s does not match its targets (%s)' % (row['question'], q))
        q = row['question']
    if q not in C['review_questions']:
        raise ValueError('a row that lists only images names its question (%s)' % ', '.join(C['image_questions']))
    if any(t.get('kind') == 'image' for t in row.get('targets') or []) and q not in C['image_questions']:
        raise ValueError('the row lists an image but asks about %s' % q)
    if row.get('asks', 'place') not in ('place', 'party'):
        raise ValueError('asks is place or party')
    if row.get('asks') == 'party' and not (len(row.get('targets') or []) == 1
                                           and row['targets'][0].get('kind') in ('evidence_link', 'change_claim')):
        # (v7, D2; v8) a who-paid row lists exactly one target: a link of money no payment source carries, or the
        # acquisition / sale claim (evidence_sheet_row checks the rest against the rows)
        raise ValueError('a who-paid row lists exactly one target: one placement link or one acquisition/sale claim')
    return q


def review_rows_problem(config):
    """The review run's per-row targets (v4) and (v6) one question per row: rows.<1..items>.targets, each a valid
    target, implying one decision kind (or naming it when the row lists only images), asks 'place' or 'party'."""
    rows, items = config.get('rows'), str(config.get('items', ''))
    if not isinstance(rows, dict) or not items.isdigit() or len(rows) != int(items) or not 1 <= int(items) <= 500:
        return 'a review run lists targets for every row (rows.<n>.targets, n = 1..items, at most 500)'
    for k, v in rows.items():
        if not (str(k).isdigit() and 1 <= int(k) <= int(items)):
            return 'row %s is not 1..%s' % (k, items)
        ts = (v or {}).get('targets')
        if not (isinstance(ts, list) and 1 <= len(ts) <= 200):
            return 'row %s lists 1..200 targets' % k
        for t in ts:
            try:
                review_target(t.get('kind'), t.get('id'), t.get('key'))
            except (ValueError, AttributeError) as e:
                return 'row %s: %s' % (k, e)
        try:
            row_question(v)
        except ValueError as e:
            return 'row %s: %s' % (k, e)
    return None


def open_run(user_id, run_kind, pass_name, producer, code_version, config, scope=None, date_from=None, date_to=None,
             parent=None):
    if run_kind in C['run_kinds_own_writer']:
        raise ValueError('run kind %s is written only by its own writer' % run_kind)
    if pass_name == 'owner_review':
        # (v8) owner_review rows are written only by his own decisions in the app (42501 owner_answer_missing)
        raise ValueError('a job never opens an owner_review run: those rows come only from his decisions in the app')
    bad = coverage_problem(pass_name, config)
    if bad:
        raise ValueError(bad)
    if run_kind == 'review':
        bad = review_rows_problem(config or {})
        if bad or 'sheet_sha256' not in (config or {}):
            raise ValueError(bad or 'a review run stores its sheet_sha256')
    return {'p_user_id': user_id, 'p_run_kind': run_kind, 'p_pass': pass_name, 'p_producer': producer,
            'p_code_version': code_version, 'p_config': config or {}, 'p_scope': scope or {}, 'p_from': date_from,
            'p_to': date_to, 'p_parent_run_id': parent}


def close_run(run_id, status, counts, input_tokens=0, scoreboard=None, gap_picked=None):
    if status not in ('done', 'failed', 'aborted'):
        raise ValueError('close status must be done, failed or aborted')
    return {'p_run_id': run_id, 'p_status': status, 'p_counts': counts, 'p_input_tokens': input_tokens,
            'p_scoreboard': scoreboard, 'p_gap_picked': gap_picked}


def answer_problem(answer, row=None):
    """evidence_record_answers' rule for a structured reading of one answer (v5, rules-channels v4 #1; (v8) the
    reading is optional and decides nothing: it is what the app may show him as "you said X"):
    {"decision": confirmed|rejected|unsure} plus at most one place he named; 'unsure' carries no place. With the sheet
    row's profile (review_sheet: question, asks, asked_place, frame, link_class), the v6/v7 rules too (AC1/AC3/AC4,
    D6): only a place of the row's own dimension; a yes names the asked place or none, "no" to the asked place is bare,
    a "where?" row takes {confirmed, <place>}, a row in several places takes a bare yes or no, a row whose targets
    place nothing ('none') takes a bare yes or no or "no, it is Y", a who-paid row takes {confirmed, entity_key}.
    Returns the problem, or None."""
    if not isinstance(answer, dict) or answer.get('decision') not in C['answer_decisions']:
        return 'answer needs decision confirmed | rejected | unsure'
    extra = set(answer) - {'decision'} - set(C['answer_places'])
    if extra:
        return 'answer carries %s (only decision and one of %s)' % (sorted(extra), ', '.join(C['answer_places']))
    places = [k for k in C['answer_places'] if k in answer]
    if len(places) > 1:
        return 'answer names more than one place: %s' % places
    if answer['decision'] == 'unsure' and places:
        return "an 'unsure' answer names no place"
    if 'vehicle_id' in answer and not common.is_uuid(answer['vehicle_id'] or ''):
        return 'vehicle_id is not a vehicle uuid'
    if 'subject_key' in answer and not re.match(C['subject_key_re'], answer['subject_key'] or ''):
        return 'subject_key is not vin:|album:|label:<name>'
    if 'entity_key' in answer and not re.match(C['entity_key_re'], answer['entity_key'] or ''):
        return 'entity_key is not owner | owner_business:<x> | third_party:<x> | unknown'
    if 'captured_on' in answer:
        try:
            dt.date.fromisoformat(answer['captured_on'])
        except (TypeError, ValueError):
            return 'captured_on is a date'
    if row is None:
        return None
    allowed = answer_dimension(row)
    if places and places[0] not in allowed:
        return 'row %s asks %s about %s: its answer names %s' % (
            row.get('row', '?'), row.get('asks', 'place'), row.get('question'),
            ('at most one of ' + ', '.join(allowed)) if allowed else 'no place (a bare yes, no or not sure)')
    if answer['decision'] == 'unsure':
        return None
    place, asked = answer_place(answer), row.get('asked_place')
    if row.get('asks') == 'party':
        if answer['decision'] != 'confirmed' or 'entity_key' not in answer:
            return 'a who-paid row takes {"decision": "confirmed", "entity_key": <who>} or unsure'
        return None
    if not allowed:
        return None
    if asked is not None and answer['decision'] == 'confirmed' and place is not None and place != asked:
        return 'a yes names the place the row asks about (%s); another place is {"decision": "rejected", <place>}' % asked
    if asked is not None and answer['decision'] == 'rejected' and place is not None and place == asked:
        return '"no" to the place the row asks about is a bare {"decision": "rejected"}'
    if asked is None and (answer['decision'] == 'rejected' or place is None):
        return 'the row asks where: {"decision": "confirmed", <the place he named>} or unsure'
    return None


def answer_dimension(row):
    """(v6, AC3) The places a reading may name on this row (evidence_record_answers' v_allowed)."""
    if row.get('asks') == 'party':
        return ['entity_key']
    if row.get('asked_place') == 'multi' or row.get('frame') == 'mixed' or row.get('link_class') == 'mixed':
        return []
    q = row.get('question')
    if q == 'image_candidate' or (q == 'evidence_link' and row.get('link_class') == 'placement'):
        return ['vehicle_id', 'subject_key']
    return {'album_map': ['vehicle_id'], 'account_entity': ['entity_key'],
            'capture_time_claim': ['captured_on']}.get(q, [])


def answer_place(answer):
    """Where his answer says the subject belongs (evidence_answer_place): the vehicle, the subject_key,
    'entity:<key>' or 'day:<date>'; None for a bare yes / no."""
    if answer.get('vehicle_id'):
        return answer['vehicle_id']
    if answer.get('subject_key'):
        return answer['subject_key']
    if answer.get('entity_key'):
        return 'entity:' + answer['entity_key']
    if answer.get('captured_on'):
        return 'day:' + answer['captured_on']
    return None


def norm_ref(ref):
    """A chat message as the store keeps it: stripped and lower-cased ('<source>:<message id>')."""
    return (ref or '').strip().lower()


def message_id(ref):
    """The message id of a ref (the part after '<source>:'): unique across every answers run of every user."""
    return norm_ref(ref).partition(':')[2]


def message_ref_problem(ref):
    """(v6, AC10; v7, D4) '<source>:<message id>' with exactly one colon and no path, at most 200 characters: the one
    chat message an answers run transcribes (for a Claude session, the session id and the message's own uuid)."""
    ref = norm_ref(ref)
    if len(ref) > 200 or not re.match(C['message_ref_re'], ref):
        return ('message_ref is <source>:<message id> (e.g. <claude session id>:<message uuid>): one colon, no path, '
                'at most 200 characters')
    return None


def record_answers(user_id, sheet_run, message_ref, rows, producer, code_version):
    """rows: {"<sheet row>": {"verbatim": "<his words>"[, "answer": {...}]}} -> the evidence_record_answers args. The
    reading is optional (v8): without one the store keeps his words alone, marked unread. One answer set per sheet and
    per message: a later answer goes on a new sheet. Storing decides nothing."""
    bad = message_ref_problem(message_ref)
    if bad:
        raise ValueError(bad)
    out = {}
    for k, v in rows.items():
        if not (isinstance(v, dict) and isinstance(v.get('verbatim'), str) and v['verbatim'].strip()):
            raise ValueError('answer row %s has no verbatim text' % k)
        out[str(int(k))] = {'verbatim': v['verbatim']}
        if v.get('answer') is not None:
            bad = answer_problem(v['answer'])
            if bad:
                raise ValueError('answer row %s: %s' % (k, bad))
            out[str(int(k))]['answer'] = v['answer']
    return {'p_user_id': user_id, 'p_sheet_run': sheet_run, 'p_message_ref': norm_ref(message_ref), 'p_rows': out,
            'p_producer': producer, 'p_code_version': code_version}


def rpc_args(writer, values):
    """Order and check RPC args against the contract (an arg the writer does not take is an error)."""
    names = C['writers'][writer]['args']
    extra = set(values) - set(names)
    if extra:
        raise ValueError('%s does not take %s' % (writer, sorted(extra)))
    return {k: values[k] for k in names if k in values}


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True)
