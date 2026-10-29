# Category run validation policy (from 2026-10-25)
Every category/identity run is validated per rule class, never only in aggregate:
- Tag each row with the rule class that produced it (issues: `<extractor>_rule:<class>`).
- Hand-check a fresh held-out random 150 per class (all rows if fewer; exclude every earlier sample).
- Apply/keep a class only at >=95%. Classes without 150 held-out rows are not applied.
- Retire by run_id + rule tag via retired_at; never delete. Revert SQL with no COMMIT.
