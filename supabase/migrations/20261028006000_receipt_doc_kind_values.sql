-- New receipt document kinds (enum values must commit before use, so they ship in their own migration).
alter type public.receipt_doc_kind add value if not exists 'vehicle_sale';
alter type public.receipt_doc_kind add value if not exists 'shipping';
alter type public.receipt_doc_kind add value if not exists 'general_merchandise';
-- Revert: enum values cannot be dropped in place; they are unused after the data revert of 20261028006500.
