# Receipt — 2026-09-25 — K5 orders staged (ProWire + KSV Looms + ICT Billet)

change_type: procurement (orders staged, not placed; owner pays)
amends: 2026-09-24_gemini-thread-distillation.md (ordering state §0f)
owner surface: Claude Doc "K5 Parts & Build Book" rev 26 — https://claude.ai/code/artifact/8f135f4e-6bc9-429c-b314-4eb4072f05c9

## What was staged

| Vendor | State | Lines | Total | Evidence |
|---|---|---|---|---|
| ProWire, cart Q27156 | Loaded on the owner's account, not checked out | 29 | $2,126.63 | **Read back line by line 12:16** from the /cart page after the ban lifted (12:15): 29 items, quantities, and extended prices match. The add-by-add tally of $2,125.73 was $0.90 low on DR-25-1/4-0 ($36.90). |
| KSV Looms | Shopify cart permalink in the doc | 12 | $273.87 | Variant IDs, prices, and stock from KSV's own products.json (11:55). Permalink returned 302 → checkout with all 12 variant:qty pairs encoded. |
| ICT Billet | Single product link in the doc | 1 | $23.00 | suggest.json: "LS Wire Connector - Oil Pressure for Gen 4", available. |

The line lists live in the doc and in `K5_WIRING_STATE.md` §3 0f(e).

## Matches confirmed this session
- LS coolant sensor plug = Delphi GT150 2-way 15449028, 22–20 AWG (EFI Hardware "GM LS ECT 2 Pin Female"). KSV kit OE10588 is listed as fitting ACDelco 19236568.
- LS3 oil pressure sensor (Gen IV, large round 3-terminal, 2 keyways) takes neither the ProWire kits nor KSV's "LS1" (Gen III flat) kit → ICT Billet Gen 4 kit.
- M800-KIT-N uses "SOLID CONTACT, SUPERSEAL 1.0, NICKEL". KSV lists the same part at 24–16 AWG and MME at 24–18 AWG, so it takes both the 22 AWG signal wires and the 16 AWG power feeds. No change needed.
- M27500 "SB" = AS22759/32 Tefzel (Farnell NEMA WC27500-*SB datasheet). ProWire lists M27500/22SB2T23, but our saved catalog shows it out of stock. The ML (Spec 55) cable stays in the cart, with a swap note in the doc.
- MiniSeal D-609-03/04/05 (26–22 / 20–16 / 18–12 AWG) crimp with the Raychem AD-1377.

## Incident: ProWire WAF IP ban (agent error)
~10:20: a fetch() loop of ~40 requests (probing p-2060…p-2100) triggered "403 Request forbidden by administrative rules" for the house IP, which also blocks the owner's browser. It was still 403 at 11:26 and 11:51; it lifted at 12:15 (the 2.4→5 GHz band switch = same public IP). The owner asked about a VPN. I declined, because it would evade their bot protection. Remaining small parts were rerouted to KSV via a single-permalink cart (0 cart API calls, ~5 throttled catalog requests). Read-back done after the lift.
Lesson → memory `feedback_script_vendor_sites_throttled.md`: resolve from the DB and bulk listings first; serial requests 8–15 s apart; stop on the first 403/429; cache.

## Substrate inconsistency surfaced (not fixed inline)
38 `vehicle_build_manifest` rows on e08bf694 cite a 2019 Desert Performance invoice as purchase proof. that invoice is for another customer's coupe (appendix-c; Gmail, 2024-12-24). → state §3 0g. It needs a `substrate_correction` pass. Owner-facing: the doc's "Not proven yet" list.

## Unknowns (block nothing in the carts)
- Pedal socket 6 vs 9 pins (photo).
- Quantum hanger top (photo).
- Lug stud sizes (battery + disconnect picks).
- D38999 source (Dave).
- Label naming (Dave).
- Fuel-pressure, oil-temp, and IAT sensors not owned → their plugs follow the sensor pick.

## Addendum 13:00 — owner challenge: "no 0 AWG? no colors?" (answered with citations)
- **Cranking loop, 2 AWG vs 1/0:**
  - Sources: canon ch.16 §2.4 (≤3% = 0.42 V); ProWire M22759/16 table (2 AWG 0.182, 1/0 0.116 Ω/kft); ch.17 (starter 200 A peak).
  - Break-even round trip for 2 AWG at 200 A is 11.5 ft; 1/0 holds to 18 ft. The cut list estimate is ~14 ft (#63 4.6 + #6 4.6 + ground ~5, unmeasured) → owner measures.
  - Alternator 150 A exceeds 2 AWG's 100 A (35 °C-rise) chart rating.
- **1/0 Tefzel availability:** ProWire's M22759/16 range ends at 2 AWG. IEWC M22759/16-01-0 has a 100 ft minimum at ~$46/ft. The eBay (Nassau) listing is white only and near sold out.
- **Colors:** Dave's M130 sheet has a Color column (brown 0V, brown/black 0VB, orange 5V, orange/black 5VB, green+stripe AV, yellow+stripe AT, red power, black chassis gnd, white numbered coils/injectors, yellow CAN-H, green CAN-L).
  - ProWire "On The Shelf Striped Wire" 22 AWG has 82 combos, sold per foot (1 ft min, $0.67–0.77/ft, 123,755 ft ships in 1–2 days). Every stripe Dave's scheme needs is present.
  - **Substrate correction:** `output/K5_wire_spec_and_costs.md` lists a "100 ft min" for striped. That is stale for on-shelf stripes.
- **ProWire cart put on HOLD in the doc (rev 31)** pending the Chapter 1 pages. A background agent is building them into `output/lego-book/`.

## Addendum — big-cable lengths from the 3D twin (owner: "devise the best rough measurements that can be cited")
- **Method:** `output/lego-book/twin_bbox.py` (headless Blender on `~/k5-harness-pull/K5_harness_workspace_v2.blend`) → `twin_bbox.json` → `spine_lengths.py` → `power_spine_twin_lengths.txt`.
- **Battery placement:** the twin's battery (driver-front placeholder, x=+0.65) mirrored to the owner's passenger firewall corner at (−0.65, −1.62, 0.95).
- **Holley alternator:** passenger/upper in the twin (−0.30, −2.06, 1.03). Its side is not stated in the Holley 20-185 guide text (it's in the images) → photo-confirmable.
- **Runs** (Manhattan + 0.10 m loop per end):
  - #63: 13.4"
  - #6: 36.7"
  - #59: 41.7"
  - #PDM_BPOS: 22.8"
  - BAT−→block: 41.7"
- **Cranking loop:** 7.6 ft → 2 AWG drop 0.28 V at 200 A (0.35 V at 250 A) vs the 0.42 V ceiling → **2 AWG passes; the 1/0 question is closed.** Break-even 11.5 ft.
- **Holley guide p.3:** the accessories ground through the water-pump manifold → the block → battery negative. So the block ground also carries alternator current.
- **Cart change (verified by reload):** M22759/16-2-2 20→13 ft ($208.85), M22759/16-2-0 15→10 ft ($183.48). Q27156 total $2,126.63 → **$1,922.44** (29 lines).
- **Still missing from the cut list:** block→frame strap, battery→body ground.

## Addendum — Chapter 1 pages landed; color order; missing grounds (agent k5-lego-book-ch1)
- **Pages:** `output/lego-book/` (build_ch1.py).
  - VALIDATION: 174/174 IDs exactly once, 1143.5 ft; M130 43/60 pins; 0 double-assigned.
  - PDM30: 5 landings out of the 24–16 AWG contact range → 16× 16 AWG pigtails for the eight 20 A outputs.
  - Grounds G1/G2/G3 missing from the cut list.
  - Ethernet B23–B26 unwired; TB 12699160 pinout conflicts; unassigned PDM channels.
- **Published** to the doc (rev 42): power spine PNG, WireViz PNG (88 wires), M130 pinout grid (Dave format), findings.
- **ProWire color order** (Dave's convention; all codes verified on ProWire's on-shelf listings, 22 AWG 82 combos, 20 AWG incl. 91/92), added via the site's own addItemToCart request replayed serially at 12–20 s with stop-on-error:
  - brown 22 AWG ×45 (UI)
  - 28 lines (22 AWG solids 2/3/4/5/6/8 + 16 stripes; 20 AWG red + white/brown + white/red; 18/14/12 AWG red)
- **Held back:** audio colored lines (16 & 18 AWG violet / white-violet), because audio in/out is undecided and white audio wire is already in the cart. Also held: the BOM's 1/0 (superseded by the twin 2 AWG decision), 10 AWG yellow/gray subwoofer (red/black already carted), and 10 AWG blower (canon 12 AWG).
- **White kept** as Dave-method prototype stock (the owner said keep it).
- **KSV:** yellow MiniSeal 10→20 (PDM pigtail joins + 4 rail splices). New permalink tested 302; KSV $297.37.
- **ProWire final state (fresh /cart load, 14:00):** 60 lines, **$2,649.47**. The sum of line prices equals the page total. 0 duplicate item codes.
  - 16 AWG red merged to 110 ft ($80.41, price break).
  - Grounds added: M22759/16-4-0 ×5 ft ($51.19, G2 battery→frame) and M22759/16-8-0 ×5 ft ($20.24, G3 engine→firewall strap).
  - The in-page queue died once on a tab reload after 24 of 28 lines. Reconciled from the cart read-back and resumed with the remaining 5 + 3 lines: 0 dupes, 0 failures.
- **Three orders now:** ProWire $2,649.47 + KSV $297.37 + ICT $23.00 = **$2,969.84** before tax/shipping. The doc (rev 55) hold is lifted: "Ready to pay."
- **14:05 trim:** The agent's page 1 (twin-primary) sizes 2 AWG black at 10 ft only if G2/G3 are cut from 2 AWG. G2 (4 AWG) and G3 (8 AWG) are separate lines per the ch.17 canon gauges, so the 2 AWG black covers G1 only (41.7" twin → 4.5 ft ×1.3). M22759/16-2-0 10→6 ft.
  - Reload: 60 lines, **$2,576.08**, sum of lines = total.
  - Totals: ProWire $2,576.08 + KSV $297.37 + ICT $23 = **$2,896.45**.
  - Doc rev 64: v2 drawings replace v1 (old assets deleted); alternator note corrected. The PDM 100 A cap does not bound the alternator (off-PDM iBooster/pump/amp + recharge) → builder call.

## Addendum 17:30 — audio decided IN (owner: "jbl 10" compact woofers, an amp not sure which and then the appropriate other speakers")
- Cut-list audio layout kept (5-ch amp: front 18 AWG, rear 16 AWG, sub 10 AWG, #31 head unit, #96 amp turn-on). Colors from the agent's color_bom: violet (+) / white-violet (−). Both stripes verified on the ProWire shelf (16 AWG p1, 18 AWG p3).
- Amp power: the cut list's #32 8 AWG × 18.4 ft fails the 3% rule (lego-book p1). Replaced with 4 AWG red M22759/16-4-2 ×24 ft (sized for amps up to ~1,000 W), plus a 4 AWG black amp ground (+5 ft on the G2 line). The amp fuse follows the amp choice (not in any cart).
- Two woofers: 10 AWG red/black +5 ft each for the inter-woofer jumper.
- **Fresh reload:** 65 lines, **$3,041.74**, sum of lines = total, 0 dupes. Audio adds +$465.66.
- **Totals:** ProWire $3,041.74 + KSV $297.37 + ICT $23 = **$3,362.11**. Doc rev 80.

## Addendum 2026-09-26 — Dave's DC primary (owner photos) → hardware added
- **Evidence:**
  - Jun 18 photos at 35.9773, −114.854, 19:15 PDT (Photos.sqlite); owner-pasted battery box and harness sketch.
  - iMessage to Jenny 19:16 PDT: "Dc primary wiring". The chat.db text was decoded from attributedBody.
- **ProWire adds (fresh reload: 74 lines, $3,165.45, sum = total, 0 dupes):**
  - PRO-IDENT-KIT ×1
  - Lugs: 238LTP ×10, 2516LTP ×4, DL214 ×2, DL438 ×4, 838TP ×4
  - Red shrink: CPA-100-3/4-RED, CPA-100-1/2-RED, CPA-100-3/8-RED (×1 each)
  - +$123.71
- **Incident:** 214LTP and 4516LTP are on backorder. Their pages' only "Add To Cart" buttons belong to related crimp items, so a first-button click added 19284-0034 ($217.63) and 19294-0008 ($72.89) by mistake. Both were removed and verified by reload. The script now requires the main item's own button to follow its qty input and skips "Add To Backorder".
- **Outside ProWire (owner buys):**
  - Blue Sea 2019 ×2
  - MS25171-3S 6-pack
  - DMC AFM8 + K43 (eBay $365–415)
- **Totals:** ProWire $3,165.45 + KSV $297.37 + ICT $23 = **$3,485.82**. Doc rev 85.

## Addendum 2026-09-26 — 61-pin crimper picked (owner eBay finds, plates verified)
- **Buy:** AFM8 M22520/2-01 frame, $50 (eBay 336813500716). Genuine Daniels, no positioner, no returns.
- **Buy:** K43 M22520/2-10, $30 (eBay 178217121942). Plate: MS27490-20…MS27655-20. Cross-ref: MS27490-20 = M39029/56-351, MS27493-20 = M39029/58-363. Selector: 20 AWG = 6, 22 AWG = 5, 24 AWG = 4.
- **Rejected:** $39 "K43-1" (eBay 236804051669). Plate reads "BENDIX JTR-20 P&S", a different contact.
- **Rejected:** $169 DMC AF8 M22520/1-01 (eBay 137760728655). Wrong frame; the K43 fits the AFM8 only.

## Addendum 2026-09-26 PM — carts filled round 2 (owner: "do some more rnd and lets get some carts ready and filled"; "i dont want marine")
- **ProWire Q27156** (read back: 77 lines, 0 dupes, **$3,186.90**, previously $3,165.45).
  - Adds: M81969/14-10 ×3 ($1.08 each). This is the size-20 insertion/removal tool **for MIL-C-38999**; /14-11 is NOT for 38999 (Farnell "Installing and Removal Tools" datasheet 1992545.pdf).
  - Adds: 810TP ×5 (8 AWG to the MIDI M5 studs), 410LTP ×3 (4 AWG amp to MIDI M5), 2516LTP +4 (now 8; 2 AWG to the MEGA M8 studs).
  - ProWire carries no 1/2" lugs and no MEGA/MIDI holders. Its power studs are rated 60 °C max ("Max Operating Temp: 140ºF", c-210 page), so they're not for the battery corner.
- **DigiKey guest cart** (this Chrome profile; read back: 8 PNs, **$253.28**):
  - M39029/58-363 ×70 ($46.51) and M39029/56-351 ×70 ($75.03), Amphenol.
  - Littelfuse 02980900TXN MEGA holder ×2 ($44.42) and 0498900.TXN MIDI holder w/ cover ×3 ($48.75).
  - MEGA 0298125.ZXEH ×2, 0298175.ZXEH ×1, 0298200.ZXEH ×1 (alternator fuse = builder pick at install; canon ch.17 §17.3.2 "size TBD").
  - MIDI 0498040.M ×3 (iBooster, pump, spare).
  - Amp fuse still follows the amp choice.
- **D38999 pair, eBay (owner clicks; eBay ignores automated Add-to-cart, 3 methods tried):**
  - /24WJ61SN, $25 + $10.60 (335514195501).
  - AERO /26WJ61PN, $45 + $10.60 (395558321750).
  - Both from Test Gear Nation (15.5K feedback, 100%), new/unused surplus, 30-day returns. Seller is away until Sep 30, so shipping ships Oct 1–6.
  - Contacts not shown in the photos, hence the DigiKey contacts.
  - Distributor comparison: DigiKey /24WJ61SN is $548.61 (2 in stock); /26WJ61PN is $138.07 with 0 stock and a 16-week lead.
- **Amazon (owner clicks; automated adds did not land; owner's existing cart untouched):**
  - Blue Sea 2019 PowerBar dual 3/8" stud ×2, $23.83 each (B0026KWM58). Marine brand, kept by exception: it matches Dave's photographed block, and the only non-marine studs found (ProWire) are 60 °C-rated.
  - MS25171-3S boot 6-pack, $14.45 (B097NP9CLX; only 4 left).
- **Isolator (PICK 4) — not carted:**
  - Rec: Moroso 74102, $106.99 at moroso.com, OUT OF STOCK there. 300 A continuous / 2000 A intermittent; 1/2"-20 main studs plus a 10-32 pair rated 20 A = the MoTeC "secondary switch" to the M130 shutdown input (MoTeC PDM manual p.7). Needs 2 AWG × 1/2" lugs (not at ProWire).
  - Rejected: Cartek XR. It switches battery NEGATIVE; MoTeC p.7 says battery positive; standby draw 7 mA off / 50 mA on.
  - Rejected: TE Kilovac LEV200 contactor. The coil draws current whenever ON.
- **MoTeC GPR cruise:** a search snippet claims cruise for DBW. The GPR M1 datasheet (milspecwiring copy) does not list it, so UNKNOWN; ask MoTeC.
- Owner doc updated to rev 91: BUY NOW totals, DigiKey section 4, eBay/Amazon section 5, Not-in-any-cart trimmed, PICK 4 = Moroso 74102, new 'Under the dash' section with the PCS crossing-wire table. Read back: total paragraph and PICK 4 cell render correctly.

## Addendum 2026-09-26 PM (2) — pre-payment audit (owner: "are you sure its all correct?", "anything useful or overlooked")
- **ICT** (verified on ictbillet.com): $23, in stock. "3 wire 'Round' style connector"; fitment 2009+ Corvette/Camaro/Silverado/Escalade. ICT says "We recommend using Delphi/Aptiv GT150 series crimper and 18AWG wire". Our oil-PSI wires are 22 AWG Tefzel, so KSV GT150 3-way kits ×2 (variant 14552479531050, 22–20 AWG terminals and seals) were added for their terminals and seals.
- **KSV:** permalink v3 has 13 lines, $304.05. Curl showed 302 → checkout on Sep 26. The coolant plug fits ACDelco 213-4514 / 19236568, the LS 4.8–6.2 ECT (Michigan Motorsports listing).
- **DigiKey:** 0498040.M is the M5-hole MIDI (the .MXM6 variant is M6). The MEGA and MIDI holders use the same Littelfuse series as the fuses.
- **ProWire:** +4-1437284-3 Super Seal 1.0 sealing plug ×40 ($7.28). Superseal kits for the M130 generally don't include cavity plugs. Read back: **78 lines, $3,194.18**, 0 dupes.
- **Engine endpoint reconciliation** (original list: `output/K5_shopping_list.md` + `K5_connector_shopping_list.txt`, 2026-04-05, partly stale; cross-checked against `output/K5_ENGINE_START_MINIMUM.md`): 27 endpoints, 13 covered, 14 open. The open ones are MAP, IAT, oil temp and fuel-pressure sensors; wideband LTCD; pump hanger; pedal plug; SPAL fans; Dakota sender rings; starter S ring; ground rings; M130 Ethernet port; PDM30 CAN port + UTC #61059 (state 0d, found 2026-07-12, never ordered); VSS (optional).
- Owner doc updated to **rev 94**.

## Addendum 2026-09-26 night — owner: "i got tax exemption for prowireusa… seals and connector boots… 61pin boot… connectors to the m130"; building it himself; no LTCD/UTC; M130+PDM bought last via Dave
- **KSV dropped.** Everything moved to ProWire (tax-exempt, AS9120B):
  - DR-25-3/16-0 ×25 ft, DR-25-1-0 ×10 ft (added via the FT API)
  - SCL-1875-1 / -250-1250 / -375-1250 / -500-1250 ×1 pack each
  - D-609-03/04/05 ×20/25/20. ProWire's page: stub splices "need to be covered with either SCL, ATUM, or W5DL"; recommended crimp tool "3137 CT".
  - S02-03-R (M83519/2-3, 22 AWG lead) ×8
  - GT150-WTR-TEMP-KIT ×2; 12191818 (GT150 F 20–22) ×12; 15366021 (GT150 seal 22–20) ×12
- **61-pin boot system** (canon ch.18: "AS85049 backshell+boot (D38999 side only)"):
  - Adapter M85049/69-25N ×2 at DigiKey (Amphenol PCD, $22.74). Datasheet: accessory shell 25 "C Ø max 1.44 in".
  - Raychem 202K163-25-0 ×2 at ProWire ($16.43). Dimensions (core-ics): unshrunk 43 mm; recovers to 28.2 mm connector-end and 9.9 mm cable-end. That grips the ~11–12 mm 61×22 AWG bundle; 202K174 (15.7 mm) would not.
  - ADHESIVES-KIT (RT125 epoxy, dispenser, mixers) ×1. ProWire: "It is necessary to use adhesive when attaching the shrink boot".
- **Superseal (M130/PDM30):** ProWire SuperSealSystem backshells SSB-34BS-PA66 ×2 and SSB-26BS-PA66 ×2 ($7.07). Boot angle (straight/70°/90°) is HELD pending the M130 mount decision. ProWire: SSC solid contacts "can be crimped with any tool that can crimp size 20 DTM/MIL contacts", so the AFM8 frame covers the M130/PDM contacts too (positioner to confirm).
- **Comms ports (MoTeC docs):**
  - M1 Tune manual p.10 (manualsdir): IPv6 Ethernet, Cat5, "wired as crossover from the ECU to the loom side socket"; MoTeC panel-mount Cat5 cable.
  - PDM user manual p.48: UTC #61059 via a "5 pin XLR Female" wired to CAN (1 = 0V, 4 = CAN-LO, 5 = CAN-HI, twisted, 100R); "Neutrik NC5FDL1 (Latching)". Added NC5FD-L-1 ×1 at DigiKey ($14.61). **Corrects state 0d's "DTM-4 style" guess.**
- **Read-backs:** ProWire **96 lines, $3,620.23**, 0 dupes, all 18 new lines at the intended quantities. DigiKey 10 lines, **$313.37**. Carts total with ICT: **$3,956.60**.
- **Nuke index check:** `docs/wiring/calc-data/prowire_index.md` shows catalog_parts holds 1,248 ProWire rows, last refreshed 2026-05-11, mostly wire/Deutsch. None of today's 13 probe PNs appear in the index summary. The live DB timed out on two read-only queries (execute_sql: "Connection terminated due to connection timeout"; then "canceling statement due to statement timeout"). Six parallel ProWire scrapers exist in scripts/.
- Owner doc **rev 104**.
