---
paths:
  - "docs/library/**"
  - "supabase/migrations/**"
  - "supabase/functions/**"
  - "nuke_frontend/src/**"
---

# Library Contribution Rules

The library at `docs/library/` is the source of truth. Code is an implementation of the library.

## When to Contribute

Every session that produces insight must append to at least one book. See `docs/library/LIBRARIAN.md` for the full decision tree.

| Session Type | Minimum Contribution |
|-------------|---------------------|
| Schema change | DICTIONARY entries + SCHEMATICS update |
| Feature build | ENCYCLOPEDIA chapter + INDEX entries |
| Bug fix | POST-MORTEM in working/ |
| Discussion | DISCOURSE capture |
| Data analysis | STUDIES entry + ALMANAC numbers |
| Design work | DESIGN BOOK update |

## Before Building Anything

```
1. docs/library/reference/encyclopedia/README.md  — What the system IS
2. docs/library/reference/dictionary/README.md     — What every term means
3. docs/library/reference/index/README.md          — Where everything lives
4. docs/library/technical/schematics/              — How things connect
5. docs/library/technical/engineering-manual/       — How things were built
6. TOOLS.md                                        — What already exists
```

## The Rule
Do not build things that already exist. Fix what's there.
- Exists but broken → fix it
- Exists but incomplete → complete it
- Exists but wrong architecture → migrate it (strangler fig)
- Nothing exists → then and only then, build new
