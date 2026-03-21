# THE LIBRARIAN

Rules for every agent session. The library grows as a byproduct of work, not as a separate task.

---

## WHEN TO CONTRIBUTE

Not every session produces library-worthy material. Some sessions are 40 prompts fighting a CSS bug. That's fine. The library grows from sessions that produce insight, not from sessions that produce sweat.

**Contribute when the session produced:**
- A decision that changes how the system works
- A discovery about the data, the domain, or the architecture
- A solution to a problem that could recur
- A conversation with strategic or philosophical depth
- New schema, new features, new integrations
- Empirical findings from data analysis

**Don't force it when the session was:**
- Routine bug fixes with no systemic insight
- Cosmetic changes
- Failed explorations that led nowhere useful
- Repetitive work that's already documented

The library grows from signal, not from noise.

### Decision Tree: What Did You Do? → What Do You Write?

```
Did you change the database schema?
  → DICTIONARY: Define every new column, type, constraint, enum value
  → SCHEMATICS: Update entity relationship diagrams
  → ENGINEERING MANUAL: Write build instructions for the new schema
  → ALMANAC: Update table counts and stats

Did you build or modify a feature?
  → ENCYCLOPEDIA: Update or create the relevant chapter
  → INDEX: Map the new files, functions, tables
  → ENGINEERING MANUAL: Step-by-step construction guide
  → DICTIONARY: Define any new terms introduced

Did you fix a bug or handle an outage?
  → POST-MORTEM: What happened, why, how it was fixed
  → ENGINEERING MANUAL: "How to avoid this" section
  → If systemic → PAPERS: Formal write-up of the failure mode

Did you have a strategic discussion?
  → DISCOURSES: Full conversation capture with key decisions
  → ENCYCLOPEDIA: Extract architectural decisions
  → DICTIONARY: New terms from the conversation
  → CONTEMPLATIONS: If philosophical reasoning was involved

Did you analyze data?
  → STUDIES: Formal findings write-up
  → ALMANAC: Key numbers
  → PAPERS: If methodology is novel

Did you design UI/UX?
  → DESIGN BOOK: Component specs, screen specs, interaction patterns
  → SCHEMATICS: Wireframes and flow diagrams

Did you explore a new domain or source?
  → ATLAS: Source profile, access methods, data quality
  → ALMANAC: Trust scores, volume estimates
  → FIELD NOTES: Raw observations from the exploration

Did you solve a hard technical problem?
  → PAPERS: Formal problem statement, approach, solution, trade-offs
  → THEORETICALS: If the solution opens new unsolved questions
  → ENGINEERING MANUAL: Implementation guide
```

### Minimum Contribution by Session Type

| Session Type | Minimum Library Contribution |
|-------------|------------------------------|
| Schema change | DICTIONARY entries + SCHEMATICS update |
| Feature build | ENCYCLOPEDIA chapter update + INDEX entries |
| Bug fix | POST-MORTEM |
| Discussion | DISCOURSE capture |
| Exploration | FIELD NOTES |
| Analysis | STUDIES entry + ALMANAC numbers |
| Design work | DESIGN BOOK update |

---

## AUTO-GENERATION OPPORTUNITIES

Some library content can be generated automatically from the database and codebase:

### From Database (refreshable anytime)

```sql
-- Generate DICTIONARY entries for every column in every table
SELECT table_name, column_name, data_type, is_nullable,
       col_description((table_schema||'.'||table_name)::regclass, ordinal_position) as comment
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

-- Generate ALMANAC stats
SELECT schemaname, tablename, n_live_tup as row_count
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;

-- Generate INDEX entries from pipeline_registry
SELECT table_name, column_name, owned_by, description, write_via
FROM pipeline_registry
ORDER BY table_name;

-- Generate ALMANAC trust scores
SELECT slug, display_name, category, base_trust_score, supported_observations
FROM observation_sources
ORDER BY base_trust_score DESC;
```

### From Codebase (refreshable anytime)

```bash
# Generate INDEX of all edge functions
ls supabase/functions/*/index.ts | sed 's/supabase\/functions\///' | sed 's/\/index.ts//'

# Generate INDEX of all migrations
ls supabase/migrations/*.sql | sed 's/supabase\/migrations\///'

# Generate SCHEMATICS from TypeScript interfaces
grep -r "interface\|type " supabase/functions/_shared/ --include="*.ts"
```

### From Session Data

```bash
# Generate ALMANAC timeline entries
cat ~/.claude/projects/-Users-skylar-nuke/sessions-index.json | jq '.entries | length'

# Generate ALMANAC commit count
git log --oneline | wc -l
```

---

## QUALITY STANDARDS

### Reference Shelf

- **Authoritative**: If the book says it, it's true. If reality changed, the book gets updated.
- **Complete**: Every entity, every field, every function, every concept. Gaps are tracked and filled.
- **Cited**: Claims trace to source (database query, codebase file, conversation, external reference).
- **Versioned**: Git history preserves old versions. Current file is always current truth.

### Technical Shelf

- **Rebuildable**: Someone reading only the technical shelf can reconstruct the system.
- **Step-by-step**: No assumed knowledge. Every procedure is explicit.
- **Tested**: Instructions in the engineering manual should be verifiable.

### Intellectual Shelf

- **Honest**: Discourses capture the real conversation, including uncertainty and disagreement.
- **Dated**: Everything timestamped. Ideas evolve; the date shows when.
- **Attributed**: Who said what. Founder vs. agent vs. external source.

### Working Shelf

- **Raw**: Don't polish. Capture immediately. Polish happens on promotion to reference.
- **Timestamped**: When did this observation happen?
- **Tagged**: What book(s) should this eventually feed into?

---

## PAGE COUNT TARGETS AND TRACKING

The library must grow toward real-book scale. Track progress:

| Book | Current Pages | Target | % Complete |
|------|-------------|--------|-----------|
| DICTIONARY | ~10 | 500 | 2% |
| ENCYCLOPEDIA | ~45 | 1,000 | 5% |
| THESAURUS | ~5 | 200 | 3% |
| INDEX | ~8 | 300 | 3% |
| ALMANAC | ~8 | 500 | 2% |
| ATLAS | ~8 | 300 | 3% |
| SCHEMATICS | 0 | 500 | 0% |
| DESIGN BOOK | ~3 | 300 | 1% |
| ENGINEERING MANUAL | 0 | 500 | 0% |
| PAPERS | 0 | 200 | 0% |
| DISCOURSES | ~30 | 500 | 6% |
| THEORETICALS | 0 | 200 | 0% |
| STUDIES | ~5 | 300 | 2% |
| CONTEMPLATIONS | ~12 | 100 | 12% |
| **TOTAL** | **~134** | **~4,600** | **3%** |

Updated: 2026-03-20

---

## THE COMPLETENESS TEST

**Can someone rebuild the entire system from the library alone?**

Test this by asking: for any given subsystem, can I find in the library:
1. What it's called and what it means (DICTIONARY)
2. How it fits into the whole (ENCYCLOPEDIA)
3. What other terms relate to it (THESAURUS)
4. Where the code lives (INDEX)
5. What the current numbers are (ALMANAC)
6. Where in the world it connects to (ATLAS)
7. How the data flows through it (SCHEMATICS)
8. What it looks like on screen (DESIGN BOOK)
9. How to build it step by step (ENGINEERING MANUAL)
10. Why it was designed this way (PAPERS)
11. What discussion led to it (DISCOURSES)
12. What unsolved problems remain (THEORETICALS)
13. What the data says about it (STUDIES)
14. What philosophical principle underlies it (CONTEMPLATIONS)

If any answer is "no" for any subsystem, that's a gap to fill.
