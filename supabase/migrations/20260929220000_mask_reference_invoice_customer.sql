-- Privacy: harness_templates e3d9c454 is public (is_public = true, readable logged out) and its source_reference
-- named a private customer of Desert Performance and the invoice number (probed 2026-09-29 with the anon key).
-- Mask, don't hide: the row stays public, and the reference now says what the source is without naming the person.
-- The invoice itself stays where it is (invoice_learned_pricing and the owner's records).
-- Receipt: docs/wiring/receipts/2026-09-29_redact-order-numbers-round-2.md
set lock_timeout = '5s';
set statement_timeout = '30s';

update harness_templates
   set source_reference = 'Desert Performance reference invoice, March 2019 (another customer''s car; customer and invoice number withheld)'
 where id = 'e3d9c454-8a1d-41cd-a7eb-88f446ef630e'
   and source_reference is distinct from 'Desert Performance reference invoice, March 2019 (another customer''s car; customer and invoice number withheld)';
