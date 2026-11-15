"""Frozen cached-unit resume for keys_lane; no model, no new intake or vocabulary."""
import argparse
import hashlib
import json
import os
import time
from urllib.parse import urlencode


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


class Hold(Exception):
    pass


def require(value, reason):
    if not value:
        raise Hold(reason)


def content_hash(body):
    # Same ordered fields/omitted optional keys as observationContentHash.ts.
    data = dict(source=body['source_slug'], kind=body['kind'], vehicle_id=body.get('vehicle_id') or '',
                source_url=body.get('source_url') or '', source_identifier=body.get('source_identifier') or '',
                observed_at=body['observed_at'], text=body.get('content_text') or '',
                data=body.get('structured_data') or {}, observer=body.get('observer_raw') or {})
    for key, name in [('descriptor_key', 'descriptor'), ('property_key', 'property'), ('source_comment_id', 'source_comment')]:
        if key in body:
            data[name] = body[key]
    return hashlib.sha256(json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def prepare(plan, lane):
    """Revalidate cached answers; keep body attribution fixed to cached-result hash."""
    require(plan.get('version') == 1, 'unsupported_plan_version')
    require(plan.get('registry_version') == digest(plan['registry']), 'registry_version_changed')
    require(plan.get('decisions_version') == digest(plan['decisions']), 'decisions_version_changed')
    limits = plan['limits']
    require(limits['model_calls'] == 0 and limits['model_tokens'] == 0, 'cached_only_model_budget')
    require(0 < limits['units'] <= 99 and 0 <= limits['requests'] <= 594, 'invalid_caps')
    require(len(plan['units']) <= limits['units'], 'unit_budget_exhausted')
    require(set(plan['registry']['subjects']) == set(plan['registry']['subject_ids']) and set(plan['registry']['conditions']) == set(plan['registry']['condition_ids']), 'registry_identity_missing')
    lane.check_units.use_registry(plan['registry']['subjects'], plan['registry']['conditions'])
    claims, dependencies = [], []
    for unit in plan['units']:
        photo, source = unit['photo'], unit['source']
        require(unit['source_version'] == digest(source) and unit['photo_version'] == digest(photo), 'source_version_changed')
        require(source.get('vehicle_id') == plan['vehicle_id'] == photo.get('vehicle_id'), 'foreign_vehicle')
        require(source.get('is_superseded') is False and source.get('superseded_by') is None and 'superseded_by' in source, 'source_withdrawn')
        require(photo.get('is_superseded') is False and photo.get('superseded_by') is None and 'superseded_by' in photo, 'image_withdrawn')
        require(source.get('extraction_method') == 'reviewed_image_analysis_v1', 'unsupported_source_method')
        require(source.get('structured_data', {}).get('image_id') == photo['id'], 'source_image_binding_changed')
        require(source.get('source_url') == photo.get('image_url') and photo.get('user_id') == plan['user_id'], 'source_binding_changed')
        require(bool(source.get('content_hash')) and bool(photo.get('file_hash')), 'source_version_unavailable')
        require(all(photo.get(k) is False for k in ['is_sensitive','is_document','is_duplicate']), 'image_privacy_or_duplicate')
        if not lane.said(photo) or photo.get('scene') == 'receipt_document':
            dependencies.append({'image': photo['id'], 'reason': 'unsupported_damage_callout_source'}); continue
        texts = {f'c{i}': lane.ws(t) for i, t in lane.said(photo)}
        problems, _ = lane.check_units.check_unit(unit['cached'], plan['decisions']['parts'], plan['decisions']['states'], texts=texts)
        if problems:
            dependencies.append({'image': photo['id'], 'reason': 'cached_unit_invalid_or_vocabulary_missing'}); continue
        rows = lane.rows_of(photo, unit['cached'], plan['decisions']['parts'])
        keep, left = lane.landable(rows)
        if left:
            dependencies.append({'image': photo['id'], 'reason': 'vocabulary_or_scope_dependency', 'categories': dict(left)})
        require(not lane.refused_here(unit['cached'], keep, texts), 'negation_or_claim_scope_refused')
        for row in keep:
            # The exact retained parent scalar must support the image metadata
            # quote; common image identity alone is not a source lineage link.
            selector = unit.get('selectors', {}).get(str(row['idx']))
            if not selector:
                dependencies.append({'image': photo['id'], 'reason': 'retained_scalar_binding_missing'}); continue
            value = source['structured_data']
            try:
                for key in selector:
                    value = value[int(key)] if isinstance(value, list) else value[key]
            except (KeyError, IndexError, ValueError, TypeError):
                raise Hold('retained_scalar_binding_changed') from None
            require(value == photo['callouts'][row['idx']], 'retained_scalar_binding_changed')
            require(row['part_from'] == 'registry', 'part_vocabulary_dependency')
            body = lane.body_for(plan['vehicle_id'], photo, row, source, unit['keying_model'], 'cached:' + digest(unit['cached']))
            require(body['observed_at'] is not None, 'source_clock_unavailable')
            body['structured_data']['retained_source_version'] = unit['source_version']
            body['structured_data']['retained_photo_version'] = unit['photo_version']
            # An exact retained historical payload may be reused, never silently
            # regenerated with a new run date when the stable identity exists.
            historical = unit.get('historical_payloads', {}).get(body['source_identifier'])
            if historical is not None:
                require({k:v for k,v in historical.items() if k != 'structured_data'} == {k:v for k,v in body.items() if k != 'structured_data'}, 'historical_payload_changed')
                h, b = dict(historical['structured_data']), dict(body['structured_data'])
                h.pop('placed_by', None); b.pop('placed_by', None)
                if 'retained_source_version' not in h:
                    require(unit.get('historical_source_versions', {}).get(body['source_identifier']) == unit['source_version'], 'historical_source_version_unproven')
                    b.pop('retained_source_version'); b.pop('retained_photo_version')
                require(h == b, 'historical_payload_changed'); body = historical
            claims.append({'body': body, 'content_hash': content_hash(body), 'descriptor_id': plan['registry']['condition_ids'][row['state']], 'unit': unit})
    ids = [c['body']['source_identifier'] for c in claims]
    require(len(ids) == len(set(ids)), 'duplicate_plan_identity')
    return claims, dependencies


def resume(plan, checkpoint, transport, save, lane, write=False, now=time.time):
    """One frozen plan, per-claim reconciliation, at most one request per identity."""
    version = digest(plan)
    state = checkpoint if checkpoint is not None else {'plan_hash': version, 'deadline': plan['deadline'], 'requests': 0, 'model_calls': 0,
                           'model_tokens': 0, 'claims': {}, 'phase': 'prepared'}
    require(isinstance(state, dict) and all(k in state for k in ('plan_hash', 'deadline', 'requests', 'claims')), 'checkpoint_invalid')
    require(state['plan_hash'] == version and state['deadline'] == plan['deadline'], 'checkpoint_plan_changed')
    save(state)
    active = None
    def within():
        require(now() < state['deadline'], 'deadline_exhausted')
    try:
        within(); claims, dependencies = prepare(plan, lane); state['dependencies'] = dependencies
        for claim in claims:
            within(); body, unit = claim['body'], claim['unit']; identity = body['source_identifier']
            entry = state['claims'].setdefault(identity, {'attempts': 0, 'phase': 'pending'})
            active = entry
            transport.qualify(unit, body, state['deadline'])
            rows = transport.find(body, state['deadline'])
            require(len(rows) <= 1, 'multiple_identity_rows')
            if not rows:
                require(entry['attempts'] == 0, 'unknown_commit_no_resend')
                if not write:
                    entry['phase'] = 'preflight_missing'; save(state); continue
                require(state['requests'] < plan['limits']['requests'], 'request_budget_exhausted')
                within(); entry['attempts'] = 1; entry['phase'] = 'request_pending'; state['requests'] += 1; save(state)
                try:
                    transport.post(body, state['deadline'])
                except Exception:
                    entry['phase'] = 'transport_unknown'; save(state)
                within(); rows = transport.find(body, state['deadline'])
                require(len(rows) == 1, 'unknown_or_partial_commit_no_resend')
            row = rows[0]
            transport.qualify(unit, body, state['deadline'])
            require(row.get('descriptor_id') == claim['descriptor_id'] and lane.utc_ms(row.get('observed_at')) == body['observed_at'], 'typed_claim_or_clock_changed')
            require(row.get('is_superseded') is False and row.get('superseded_by') is None and 'superseded_by' in row, 'child_withdrawn')
            require(row.get('content_hash') == claim['content_hash'], 'identity_payload_conflict')
            for key in ['vehicle_id', 'source_identifier', 'source_url', 'kind', 'extraction_method', 'raw_source_ref', 'content_text', 'structured_data']:
                require(row.get(key) == body.get(key), 'identity_payload_conflict')
            require(transport.witness(row['id'], unit['photo']['id'], state['deadline']), 'partial_commit_witness_missing')
            entry.update(phase='admission_verified', observation_id=row['id']); save(state)
            if transport.consumer(row, body, state['deadline']):
                entry['phase'] = 'consumer_verified'
            else:
                entry['phase'] = 'consumer_unresolved'
                entry['dependency'] = 'existing_reader_has_no_verified_typed_claim_projection'
                state['phase'] = 'consumer_unresolved'; save(state); return state
            save(state)
        state['phase'] = 'consumer_verified' if not dependencies and claims and all(e['phase'] == 'consumer_verified' for e in state['claims'].values()) else 'dependencies_remaining'
        save(state); return state
    except Exception as error:
        if active is not None:
            active['prior_phase'] = active['phase']; active['phase'] = 'held'
        state['phase'] = 'held'; state['reason'] = str(error) if isinstance(error, Hold) else 'transport_or_storage_failure'; save(state)
        raise


class LiveTransport:
    """Bounded exact reads and the existing ingest-observation writer only."""
    def __init__(self, env, lane, registry):
        self.env, self.lane, self.registry = env, lane, registry

    def request(self, path, deadline, body=None):
        require(time.time() < deadline, 'deadline_exhausted')
        headers = {'apikey': self.env['SUPABASE_SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + self.env['SUPABASE_SERVICE_ROLE_KEY'], 'Content-Type': 'application/json'}
        status, _, text = self.lane.http('GET' if body is None else 'POST', self.env['SUPABASE_URL'].rstrip('/') + path,
                                        headers, None if body is None else json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode(),
                                        timeout=min(20, max(.1, deadline-time.time())))
        require(status == 200, 'backend_read_or_write_rejected')
        return json.loads(text)

    def rows(self, table, params, deadline):
        return self.request('/rest/v1/' + table + '?' + urlencode(params), deadline)

    def qualify(self, unit, body, deadline):
        source = unit['source']; photo = unit['photo']
        sources = self.rows('vehicle_observations', {'select':'id,vehicle_id,source_url,extraction_method,is_superseded,superseded_by,content_hash,structured_data,agent_model', 'id':'eq.'+source['id'], 'limit':2}, deadline)
        require(len(sources) == 1 and sources[0] == source, 'source_changed')
        # Explicit projection, including source-stored scalar aliases, not a whole-library scan.
        columns = 'id,vehicle_id,user_id,taken_at,created_at,image_url,file_hash,is_superseded,superseded_by,is_sensitive,is_document,is_duplicate'
        columns += ',scene:ai_scan_metadata->byok_deep_analysis->>scene_type,callouts:ai_scan_metadata->byok_deep_analysis->state_observations->damage_callouts'
        columns += ',reader_model:ai_scan_metadata->byok_deep_analysis->provenance->>agent_model,prompt_version:ai_scan_metadata->byok_deep_analysis->>prompt_version'
        images = self.rows('vehicle_images', {'select':columns,'id':'eq.'+photo['id'],'vehicle_image_gallery_eligible':'eq.true','limit':2}, deadline)
        require(len(images) == 1 and images[0] == photo, 'image_changed_or_unavailable')
        require(self.witness(source['id'], photo['id'], deadline), 'parent_witness_missing')
        descriptors = self.rows('condition_taxonomy', {'select':'descriptor_id,canonical_key','canonical_key':'eq.'+body['descriptor_key'],'deprecated_at':'is.null','limit':2}, deadline)
        parts = self.rows('subject_taxonomy', {'select':'subject_id,subject_key','subject_key':'eq.'+body['structured_data']['part_key'],'is_active':'eq.true','limit':2}, deadline)
        require(len(descriptors) == len(parts) == 1, 'vocabulary_dependency')
        require(descriptors[0]['descriptor_id'] == self.registry['condition_ids'][body['descriptor_key']] and parts[0]['subject_id'] == self.registry['subject_ids'][body['structured_data']['part_key']], 'registry_identity_changed')

    def find(self, body, deadline):
        source = self.rows('observation_sources', {'select':'id','slug':'eq.'+body['source_slug'],'limit':2}, deadline)
        require(len(source) == 1, 'source_registry_dependency')
        return self.rows('vehicle_observations', {'select':'id,vehicle_id,source_identifier,source_url,kind,extraction_method,raw_source_ref,content_text,structured_data,content_hash,is_superseded,superseded_by,descriptor_id,observed_at', 'source_id':'eq.'+source[0]['id'], 'source_identifier':'eq.'+body['source_identifier'],'limit':2}, deadline)

    def post(self, body, deadline):
        # Client-side before/after reads cannot enforce source currentness at
        # admission. Enable only once this claim shape has an atomic writer
        # contract and a qualified consumer; offline transports exercise resume.
        raise Hold('atomic_source_admission_and_consumer_dependency')

    def witness(self, observation, image, deadline):
        return bool(self.rows('observation_witnesses', {'select':'id','observation_id':'eq.'+observation,'image_id':'eq.'+image,'limit':1}, deadline))

    def consumer(self, row, body, deadline):
        # Existing facet/component readers do not expose this lane's inferred
        # descriptor+text part as a qualified component claim. Do not invent a
        # reader, match an arbitrary JSON substring, or call admission usability.
        return False


def atomic_save(path, state):
    temporary = path + '.tmp'
    fd = os.open(temporary, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as file:
        file.write(canonical(state)); file.flush(); os.fsync(file.fileno())
    os.replace(temporary, path)
    fd = os.open(os.path.dirname(os.path.abspath(path)), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def cli(argv, env, lane, out=print):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resume-plan', required=True); parser.add_argument('--plan-sha256', required=True)
    parser.add_argument('--checkpoint', required=True); parser.add_argument('--write', action='store_true')
    args = parser.parse_args(argv)
    lock = args.checkpoint + '.lock'
    # Never reset/steal a crashed run's lock or checkpoint.
    os.mkdir(lock, 0o700)
    try:
        with open(args.resume_plan, 'rb') as file:
            raw = file.read()
        require(hashlib.sha256(raw).hexdigest() == args.plan_sha256, 'frozen_file_hash_changed')
        plan = json.loads(raw)
        require(not args.write, 'atomic_source_admission_and_consumer_dependency')
        require(all(env.get(k) for k in ('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')), 'backend_credentials_missing')
        try:
            with open(args.checkpoint) as file:
                checkpoint = json.load(file)
        except FileNotFoundError:
            checkpoint = None
        state = resume(plan, checkpoint, LiveTransport(env, lane, plan['registry']), lambda value: atomic_save(args.checkpoint, value), lane, write=args.write)
        out('keys resume: ' + state['phase'])
        return 0 if state['phase'] == 'consumer_verified' else 5
    except Hold as error:
        out('keys resume: ' + str(error)); return 1
    finally:
        os.rmdir(lock)
