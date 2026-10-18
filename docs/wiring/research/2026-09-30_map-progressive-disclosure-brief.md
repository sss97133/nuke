# The wiring page, eased in: a redesign brief (pieces lane, 2026-09-30)

For the lead, before anyone builds. Evidence is from three cold, logged-out user simulations (a first-time visitor, a
harness builder, the owner) and my own re-checks on the live page (nuke.ag/vehicle/e08bf694-970f-4cbe-8a74-8715158a0f2e/wiring?tab=map,
headless, no cookies). Where a sim claim did not reproduce, it is not used.

## 1. What Skylar said, and the design book he already wrote

Design book, docs/library/technical/design-book/vehicle-profile-computation-surface.md, "Owner notes, 2026-09-29" (#440):
- The north star is the vintage service manual: "information was so concise and finite ... if you had the service man
  you had everything". Everything a technician needs, however many pages, every page pertinent and well made.
- "Done" for a subject is every bit of its data; options as toggles with instant recalculation; the same records seen by role
  (client, owner, builder); financial, labour and means-of-production data live on the profile.

New, 2026-09-30, in the pieces lane window:
- "the site nav is overwhelming. you need to run sims on it see what they think becasue its a rough ride."
- "its kind if like if you walk into a workshop and ALL the tools are already sitting out and ALL the parts are there, it
  doesnt really help you get started you need to ease into it case by case."
- "because its agent made design its not been thought thru and developed in a natural method of function rather all the
  seemingly useful stuff get crammed together and old things that conflict stay and then all the sudden crazy things like
  putting a pdf page in the horizontally long frame becomes a thing... the we designer is a not good."

Read together: the page should start from what a person is trying to do, reveal a tool when the task needs it, hold each kind
of content in the frame its shape needs (a manual page is a portrait page), and have exactly one of everything.

## 2. What the sims found (verified unless marked)

| Finding | Evidence | Who |
|---|---|---|
| 40 controls visible on the first screen | counted live | me |
| Two tab rows: FORMBOARD / SCHEMATICS / 3D / DATA / TOPOLOGY / WORKBENCH / CONNECTORS / MAP, and inside MAP: PLAN / 3D / CONNECTOR / SCHEMATIC / LIBRARY. Two 3Ds, two schematics, three "CONNECTORS", WORKBENCH is a second plan | live text | visitor, owner, me |
| The legacy SCHEMATICS tab is empty: "0 DEVICES / 0 WIRES" | live | me |
| The legacy 3D tab shows the old "TWIN V3" engine | live text | me |
| The legacy tabs' shared header disagrees with MAP (141 devices / 133 wires / 971 ft / "ECU M150" vs 229 connectors / 532 wires / 93.0 m) and shows a cost total; DATA and WORKBENCH show prices. A leak, reported separately | live | owner, me |
| The URL stays ?tab=map on every tab (no linking, reload returns to MAP) | live | me |
| The coverage line's caret opens on hover only, never on click or tap | live | owner, me |
| Nothing answers "how far along is the job": counts read as drawing completeness; "built" and "installed" don't exist in the page | sims; page text | visitor, owner |
| Selecting a part doesn't say where it is: no label on the plan, no words, "NO 3D MODEL YET" for the ECU in the frame that should show it | sims | visitor, owner |
| Three entries for the ECU (M130, Motec_M130, MoTeC M130 engine computer); a phantom "M130 - LIGHTING REAR - no model - 0" row; typing "ECU" lists pin matches with the device | live table + sims | owner, me |
| "68 NO MODEL" rows in the connectors list vs "18 with no model" on the strip (18 placed ends + 50 unplaced nodes) | live table | owner |
| PAPER / LEDGER / CAD / SHOP recolour the page; nothing says so; four search boxes | live | visitor, owner |
| The 3D is a tiny frame; 532 wires show in a six-row table frame | screenshots | owner |
| Landing is scrolled 77 px, hiding the site header (the visitor sim said "scrolled to the bottom"; that did not reproduce) | live | me |
| **A builder could not build the loom from the page.** Injector 1's wire got three different answers: the MAP said "22 AWG white M22759/16, 1624 ±339 mm (an estimate)"; the legacy CONNECTORS table said "#13 18 AWG GRN M22759/32 5.09 ft"; the legacy CUT LIST said "W9 18 AWG TXL GRN 4.6 ft". The sim "trusted none". (Since #469 a visitor sees only the MAP answer; the owner still sees all three) | live sim | tech |
| The wire card stops short of the build: injector end shows cavity 1 and terminal "68102", seal "—", and no crimp tool anywhere; no strip length; cut length is an estimate with ±21 % and can't be exported | sim | tech |
| Firewall: the legacy CONNECTORS tab lists "#20 CONTACTS (20-24 AWG)" with 18 and 16 AWG wires on them, "61/61 used = 0 spare", "OVERFLOW" wires with no cavity and 16 "DIRECT FEED". That is the pre-#452 plan. The MAP says 58 cavities used, plus a stray "Firewall" node with 1 cavity | sim; live | tech |
| Search doesn't look through the chain: filtering "firewall" finds only wires whose end is the firewall; through-wires like #13 show it only under VIA | sim (17 rows on the MAP at my check, all direct ends) | tech, me |
| Four search boxes; plan labels too small to read; the legacy PRINT tab shows a developer command ("cd ... && npm run wiring:connector-sheets") and no download; the builder's real pages (CONNECTORS table and build view, the cut list) sit behind the legacy tabs, while the profile's link lands on MAP | sim | tech |
| Header numbers disagree between the legacy tabs and the MAP: 133 vs 532 wires; 971 ft, 1280.8 ft and 93.0 m; "ECU M150" vs the M130 | live | tech, owner, me |
| #469 is deployed (I checked at about 06:50Z logged out): no legacy tab names in the header, no "COST $" on the page | live | me |

## 3. Principles

1. **One question at a time.** The first screen answers "what is this, and how far along is it?" and offers four doors. Nothing
   else is on screen.
2. **A tool appears when its task starts, and leaves when it ends.** Zoom and view buttons live in the 3D. The wire table
   lives with the wire. Filters open on demand.
3. **Each kind of content in its natural frame.** A manual page is a portrait page with a contents list. A 3D view gets the
   big frame. A table is a table with its own scroll.
4. **One of everything.** One tab row, one header, one search, one theme switch, one count per fact and one source for it.
   Old views that duplicate a new one are retired, not kept beside it.
5. **Say what's missing, in words.** A part with no model says "no model yet" in the place the model would be. A wire with an
   open end says which end.
6. **Results for everyone; the workshop for the owner.** Visitors see results only. His layer adds the calls, sources and
   the still-open items, in the same places, not a second page.

## 4. The shape

**First screen (visitor and owner):**
- A title, and one status line in plain words, computed from the same index and registry the page already reads, e.g.
  "161 of 179 connection points have a 3D model (128 complete). 131 of 532 wires still have an open end." Its caret opens the
  split on click or tap, and the split explains each word.
- Four doors, each a sentence, not a tab (the owner and builder roles get a fifth, "Build sheets", see below):
  1. **See the truck** (plan and 3D).
  2. **Follow a wire** (search or pick a system, then the wire and its two ends).
  3. **Read the manual** (the service-manual pages).
  4. **What's still missing** (the list, by system).
- Nothing else: no tree, no tables, no colourway, no four search boxes.

**Inside a door, tools appear as needed:**
- *See the truck:* a large plan or 3D with a compact view picker (Front / Side / Top / Engine bay) and Fit. Picking a part flies
  to it and shows a name tag and one line of where it sits ("driver side of the firewall, 37 in above the ground"). Zoom and pan
  buttons sit behind "more". The parts list is collapsed until asked for.
- *Follow a wire:* one search box. Device names rank above pin matches, and the search looks through the whole chain (a
  "firewall" search finds every wire that crosses it, not only those that end there). The result is the wire's card, built
  for the builder's question, in this order:
  1. its two ends (connector and cavity), and the hops between (the firewall pair, splices);
  2. gauge, colour, spec, and cut length with its ± and its basis in words ("estimated from the twin", "routed", "measured");
  3. per end: terminal part number, seal, plug or boot, crimp tool and its setting, strip length;
  4. a "show it on the truck" button (opens the plan with the wire lit), and a download of the cut list or the connector
     sheet, in one click, for a whole system.
  Any of those the data doesn't have yet reads "not on file: <what closes it>", never a blank or a dash. Tables are a slide-up
  drawer, not a permanent frame.
- *Build sheets (owner and builder role):* the fifth door. The cut list, the connector service sheets (terminals, seals, tools per
  connector), the BOM and the firewall map, each computed from the same registry as the wire card, so they can't disagree. This
  is the pages the builder sim said were buried behind the legacy CONNECTORS and DATA tabs.
- *Read the manual:* a portrait page reader with a contents list, previous and next, the section's figure and its callouts.
  Every row still selects its part, wire or pin. Wide tables scroll inside the page, not the page inside a strip.
- *What's still missing:* the list the owner sim asked for. Each item names the thing and what closes it; it opens the part in the
  first door.

**Retire, don't stack (after the new views can do their job):**
- FORMBOARD, SCHEMATICS, 3D, DATA, TOPOLOGY, WORKBENCH, CONNECTORS become owner-only now (approved), and are deleted when each
  has a home in the new structure.
- PAPER / LEDGER / CAD / SHOP become one light/dark switch, named as such.
- Four search boxes become one (with ⌘K).
- The wire, pin and connector tables move into the drawer.

**Phone:** one column; the door list, then the door; a drawer for the tree; nothing wider than the screen. The owner sim did one
task on a 390 px phone and found the tree behind "TREE ▸" and the table far down; each step of the redesign gets a phone pass.

**Owner layer (his login):** the same doors, plus "Needs you" (money, hands, legal, credentials), the calls and decisions list, and
"why" and "sources" on each item. It is a layer on the page, not a second page.

## 5. Order of work (each step ships alone)

1. **Tonight, approved:** legacy tabs owner-only (closes the amounts leak); ?tab= written on switch; the split opens on click or
   tap; 3D nav and selection (minimal).
2. The status line, and "What's still missing" as the first screen. (The data for both exists in the index and registry.)
3. One source of truth. Every number the page shows (spec, colour, gauge, length, counts, the ECU's name) comes from the
   registry through one reader; the legacy views that read older data are the ones that disagreed, so they go owner-only
   (done) and are retired as their function moves. This is the fix for "the same wire gets three different answers".
4. The four doors as the landing; "See the truck" and "Follow a wire" folded from what MAP has, with the wire card in §4.
5. The manual reader, and "Build sheets" with the exports.
6. Retire the legacy tabs and the extra search and theme controls.
7. Phone pass.
After each step, re-run the same three sims. Send the lead the deltas.

## 6. How we will know it works

Fresh, logged-out, 15-minute, no coaching:
- The visitor's 5-second sentence matches what the page is; they find the ECU's place on the truck in 3 steps or fewer.
- The builder gets injector 1's full record (both ends, gauge, colour, spec, length, terminal, seal, tool) in 4 steps or fewer,
  gets ONE answer for it, and can download the cut list for the injector system.
- The owner reads how much is missing on the first screen and opens the list in one click.
- Nobody uses the word "confusing" for a duplicate.

## 7. For the lead and Skylar

- The wording of the status line: "designed", "modelled", "built", "installed". The page doesn't know what's built or installed
  today; that is a data gap, not a design one. Until it does, say "drawn" and "modelled" and don't imply more.
- The amounts on the legacy tabs are in DB rows those tabs read; masking them in the DB is a registry-pass item and belongs near
  the top of that list.
- Data items the sims surfaced, for the registry pass (not design work): the phantom "M130 - LIGHTING REAR" row; the stray
  "Firewall" node with 1 cavity; the three ECU entries (M130, Motec_M130, MoTeC M130 engine computer); "ECU M150" in the legacy
  header and BOM; injector 1's seal shown as "—" and the injector crimp tool missing (the registry names the terminal, 68102);
  cut lengths that are all estimates (±21 %), which the wire card should keep labelling honestly until a formboard or truck measure
  replaces them.
- Whether the first four doors are public and "Build sheets" is owner/builder-only, or all five are public. The sims
  argue for the builder pages being public results (a builder or a client should be able to see them); the cost and order
  data they used to carry must stay masked either way.
