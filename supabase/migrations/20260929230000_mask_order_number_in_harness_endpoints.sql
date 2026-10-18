-- Privacy: two K5 harness_endpoints rows (PCS-TCM) are public and their name carried the owner's Zero Gravity order
-- number, copied from the registry on 2026-09-28 before the repo redaction (#437). The loader leaves existing rows
-- alone, so they are masked here. The pattern names no digits, so this public file holds no order number.
-- Receipt: docs/wiring/receipts/2026-09-29_redact-order-numbers-round-2.md
set lock_timeout = '5s';
set statement_timeout = '30s';

update harness_endpoints
   set name = regexp_replace(name, '\(Zero Gravity order [0-9]+\)', '(Zero Gravity order, delivered 2024-09-12)')
 where id in ('a65d57c5-94b7-4929-9f88-142ed7b805f4', '492ddd9c-6804-44e4-bca8-99cae645d4ab')
   and name ~ 'Zero Gravity order [0-9]+';
