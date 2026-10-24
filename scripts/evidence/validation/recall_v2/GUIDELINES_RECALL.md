# Recall labeling (graded-v2), 2026-10-23, Grok Bot agent (NOT human)
Read only blind.md (whole description + model year); extractor output and vehicles.mileage never opened before freeze.
Per listing, label every applicable fact:
- cond: 1 concours award, 2 no current flaw disclosed, 3 current unrepaired flaw(s), 4 severe cue (non-running, project, rust-through, salvage, seized NOW). Past repaired items don't count.
- repaint: full | partial | false (original paint claim) | none. Wheels/calipers/bumpers/touch-ups excluded.
- own: year the current seller/selling dealer acquired the car (explicit or 'since YYYY'), 'rel:N' for 'N years ago/within the last year', or none.
- work: yes if maintenance/repair/restoration/rebuild work is stated as performed (dated, attributed, 'said to', or with records); bolt-on mods alone = no.
- nm: true (numbers-matching claim) | false (engine replaced/swapped/non-original) | none.
- mi: odometer reading in miles (km converted ~ if given), or none.
