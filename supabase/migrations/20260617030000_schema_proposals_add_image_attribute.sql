-- Phase 7.1: allow propose_attribute (mcp-connector) to record novel IMAGE-attribute
-- proposals (attribute-registry.ts checklist vocabulary — distinct from observation_properties).
-- Additive: extends the proposal_type CHECK with 'add_image_attribute'; no data change.
alter table schema_proposals drop constraint schema_proposals_proposal_type_check;
alter table schema_proposals add constraint schema_proposals_proposal_type_check
  check (proposal_type = any (array[
    'add_property','fork_property','deprecate_property','modify_property',
    'add_source','modify_trust_tier','add_observation_kind','add_source_category',
    'add_image_attribute'
  ]));
