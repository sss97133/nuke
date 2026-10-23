-- revert graded-v2 mileage fill run ee6d30a3-1601-4e10-b883-92089e6d7fa3 (no deletes)
update evidence_claim_values o set status='active', superseded_by=null from evidence_claim_values n where n.run_id='ee6d30a3-1601-4e10-b883-92089e6d7fa3' and o.superseded_by=n.id and o.status='superseded';
update evidence_claim_values set status='rejected' where run_id='ee6d30a3-1601-4e10-b883-92089e6d7fa3' and status='active';
update evidence_extractor_runs set notes=coalesce(notes,'')||' REVERTED' where run_id='ee6d30a3-1601-4e10-b883-92089e6d7fa3';
