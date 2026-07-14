# 1977 K5 Blazer — Session Feed

Vehicle ID: `e08bf694-970f-4cbe-8a74-8715158a0f2e`  
VIN: `CKR187F127263`  
Active build — LS3 swap, MoTeC, ongoing wiring harness fabrication.  

**16 primary K5 sessions + 36 secondary mentions = 52 total sessions touching this vehicle.**

Query:
```sql
SELECT * FROM session_topic
WHERE 'e08bf694-970f-4cbe-8a74-8715158a0f2e' = ANY(vehicle_ids)
ORDER BY modified_at DESC;
```

---

## Primary K5 sessions (chronological, newest first)

Sessions where the K5 was the dominant topic. These contain build decisions, reviewer feedback (PDM manuals, harness layouts, ProWire orders), and wiring approach iterations.

### 2026-05-24 — conf 0.83 — `c5b986a7`
- turns: 134
- secondary: vehicles:other, vehicle:mustang_1966
- jsonl: `/Users/skylar/.claude/projects/-Users-skylar/c5b986a7-ca8d-4108-82d6-0d3c136c2bda.jsonl`
- opening prompt: I need to better understand alternators charging I've got two cases potential use cases on my 1966 Mustang and my 1977 K5 blazer LS three build in both cases I'm considering doing electric air-conditioning OK but I'm concerned about the transmission of power it's a 12 V AC compressor you can find th

### 2026-05-17 — conf 0.82 — `ea7cc02b`
- turns: 1547
- secondary: platform:architecture_design, personal:scheduling_and_admin
- jsonl: `/Users/skylar/.claude/projects/-Users-skylar/ea7cc02b-bfb3-4c4d-9a2c-bdb1df30c2da.jsonl`
- opening prompt: i need a absolute base starting point for a supply list of the wiring harness. the stuff that cant be mistaken.. so basically just the wires... so i can map out their groups and end points what might that cost me

### 2026-05-11 — conf 0.81 — `b6e6a594`
- turns: 415
- secondary: vehicles:other, platform:nuke_engineering
- jsonl: `/Users/skylar/.claude/projects/-Users-skylar/b6e6a594-22c9-4a75-8831-b90028d43f2b.jsonl`
- opening prompt: i need to see the wiring harness plan for the k5 blazer

### 2026-05-11 — conf 0.84 — `2199630d`
- turns: 521
- secondary: vehicles:other, platform:nuke_engineering
- jsonl: `/Users/skylar/.claude/projects/-Users-skylar/2199630d-7965-4810-a794-cd080e646cf4.jsonl`
- opening prompt: https://nuke.ag/vehicle/e08bf694-970f-4cbe-8a74-8715158a0f2e/wiring therese supposed to show the rendered truck in 3d

### 2026-05-11 — conf 0.89 — `5507c426`
- turns: 162
- secondary: platform:architecture_design
- jsonl: `/Users/skylar/.claude/projects/-Users-skylar/5507c426-9803-463f-8bb1-7ff6553153b0.jsonl`
- opening prompt: i need an order list for all the materials i need to order from prowire usa for the wiring harness motec style build

### 2026-05-08 — conf 0.76 — `52b3d5f1`
- turns: 572
- secondary: vehicles:other
- jsonl: `/Users/skylar/.claude/projects/-Users-skylar/52b3d5f1-9b79-49c2-a113-da66dfb949f2.jsonl`
- opening prompt: whats on the docket

### 2026-05-08 — conf 0.95 — `aae8612e`
- turns: 164
- jsonl: `/Users/skylar/.claude/projects/-Users-skylar/aae8612e-097a-4bf9-aaec-7ca4634c08ee.jsonl`
- opening prompt: i need a parts list to build a comparable drivetrain of the 77 k5 (ls3 Dels3 with 6l90) i need all the stuff so we can drop in the engine ASAP. will need to source a 6l80,6l90 or 8l90 or similar.  but priority is the engine. need to get an engine so itll go in excess of 500HP dyno... so thats actual

### 2026-05-07 — conf 0.86 — `ce331b16`
- turns: 1178
- jsonl: `/Users/skylar/.claude/projects/-Users-skylar/ce331b16-9106-4505-83d0-8c9d252986bb.jsonl`
- opening prompt: can we figure out what we are doing with the wiring harness for the k5 blazer. is it ready to send to be produced

### 2026-05-05 — conf 0.95 — `c1b964f1`
- turns: 541
- jsonl: `/Users/skylar/.claude/projects/-Users-skylar/c1b964f1-73b1-41cf-b8d1-0072315a1c84.jsonl`
- opening prompt: k5_harness_workspace i want you to put the old tires back on it, get rid of othe currents they are horrific. remove the "1978 Balzer" license plate bothe of them

### 2026-05-04 — conf 0.91 — `d2768800`
- turns: 827
- jsonl: `/Users/skylar/.claude/projects/-Users-skylar/d2768800-d42a-4e9f-81a5-d85bc6716284.jsonl`
- opening prompt: OK is blender MCP ready I wanna work on the K5 blazer we have a blender file and we've been trying to build a wiring harness and this might be the tool that we need to build the wiring harness and also finish off the incomplete areas of the blender file because honestly it may be CAD or ketchup woul

### 2026-05-02 — conf 0.78 — `56aceca5`
- turns: 1798
- secondary: vehicle:k20_doug_1974, platform:architecture_design, vehicles:other
- jsonl: `/Users/skylar/.claude/projects/-Users-skylar/56aceca5-455e-4c1c-8464-303871a5fd41.jsonl`
- opening prompt: open the m1 build for the k5 blazer

### 2026-04-26 — conf 0.86 — `c6a7c92a`
- turns: 391
- secondary: vehicles:other
- jsonl: `/Users/skylar/.claude/projects/-Users-skylar/c6a7c92a-b30d-4cff-8a33-2f77fad7ee64.jsonl`
- opening prompt: can we set up an order to get the wiring we need for the blazer the raw wire and all the colors that we need what would cost me can we order it like by the foot or do we have to like you know order spools I don't want to order spools it would be too expensive but give me both prices of the nice stuf

### 2026-04-26 — conf 0.9 — `c3933cd3`
- turns: 155
- jsonl: `/Users/skylar/.claude/projects/-Users-skylar/c3933cd3-05ab-4954-bb2b-38e3bcd2f196.jsonl`
- opening prompt: how much of a challenge is it to create a replica of crossover because obviously that's fucking awesome and it's the reason we're able to do anything and like crossover seems to be pretty simple it should just be baked into our methods for the for whatever we're doing right now

### 2026-04-25 — conf 0.84 — `40bb7b29`
- turns: 2121
- secondary: platform:nuke_engineering
- jsonl: `/Users/skylar/.claude/projects/-Users-skylar/40bb7b29-2ee2-4d99-9c9c-4287cc56566f.jsonl`
- opening prompt:  Final packet inventory                                                                                                                                                                                                                                                                              ┌──────

### 2026-04-24 — conf 0.92 — `bf11fe6a`
- turns: 2376
- jsonl: `/Users/skylar/.claude/projects/-Users-skylar/bf11fe6a-904a-4195-8acb-ec943195fd18.jsonl`
- opening prompt: i wanna work on  m1build, anf function outputs 77 blaxzer is our work proto

### 2026-04-23 — conf 0.86 — `cb03d7b0`
- turns: 74
- jsonl: `/Users/skylar/.claude/projects/-Users-skylar/cb03d7b0-027a-4454-849c-f545ca1aaf05.jsonl`
- opening prompt: ⏺ Wave 3 done. Read the rest of the PDM User Manual (pages 33-61) and produced the first concrete compile target — a complete K5 PDM30   configuration specification in PDM Manager's native idiom.                                                                                                         

---

## Secondary K5 mentions (K5 came up but was not the primary topic)

| date | primary topic | conf | session | first prompt |
|---|---|---|---|---|
| 2026-05-24 | platform:architecture_design | 0.79 | `75284484` | if you look at my latest session logs and my sessions that are currently happening the main underline issue is image ana |
| 2026-05-24 | vehicles:other | 0.83 | `fdcc355f` | this sucks everything crashed I fucking hate you |
| 2026-05-24 | platform:architecture_design | 0.81 | `654465f6` | well we're making good progress but unfortunately we had a major crash |
| 2026-05-24 | vehicle:mustang_1966 | 0.84 | `9fcdd38f` | have you been automatically ingesting my images and do you have an update on my Mustang. This is an example of a typical |
| 2026-05-23 | platform:nuke_engineering | 0.87 | `dad763dd` | look at supabase. be a db engineer expert,      supabase expert. and consultant to help me      figure out what to do wi |
| 2026-05-12 | platform:data_pipelines | 0.81 | `0932b364` | what were we trying to do today? |
| 2026-05-12 | vehicles:other | 0.95 | `500209e3` | i need to build a roll down window for a gm squarebody truck. ideall it can crank and electric. and be able to connect a |
| 2026-05-11 | vehicles:other | 0.83 | `f20d6523` | whys the lead image completely wrong https://nuke.ag/vehicle/e08bf694-970f-4cbe-8a74-8715158a0f2e |
| 2026-05-08 | vehicles:other | 0.81 | `2d0b9ae0` | need to continue on making data better need to look at the work weve done in the last few days need to look at the sessi |
| 2026-05-08 | platform:nuke_engineering | 0.87 | `392c7727` | need to do a massive audit on the ui |
| 2026-05-07 | vehicles:other | 0.77 | `020dee28` | need to audit user garage im seeing its sloppy  how do we inspect from the db level the attributios are wrong the ui is  |
| 2026-05-05 | vehicles:other | 0.93 | `3e0d96b8` | what were what were we working on |
| 2026-05-05 | vehicles:other | 0.86 | `bb9f565b` | i need the 1978 pickup truck blender file and i wanna find the other version suburban, 81-87 body styles and other grill |
| 2026-05-04 | vehicle:k2500_1983 | 0.77 | `a96f32d4` | pick up |
| 2026-05-03 | platform:nuke_engineering | 0.81 | `4835c2c0` | /Users/skylar/Downloads/files/claude-code-kickoff.md  andddd make sure to know our rules anfd my frofile |
| 2026-05-03 | platform:nuke_engineering | 0.81 | `9127c3d9` | pick up |
| 2026-05-03 | vehicles:other | 0.83 | `f9e0cd84` | http://localhost:5173/vehicle/8592950e-f083-4332-a85e-6ff1cf201f56 what the fuck happened with all the comments on this |
| 2026-05-03 | platform:architecture_design | 0.83 | `f94d6401` | agents need to read my entire library on startup and we need to be making sure that the library always has a brief log o |
| 2026-05-03 | finance:taxes | 0.79 | `aefe49ba` | terminal crash and I had a lot of super important things in process |
| 2026-05-03 | vehicle:k20_doug_1974 | 0.8 | `fa80a76a` | I need you to upload the dry ice work video |
| 2026-05-03 | platform:architecture_design | 0.81 | `2b5a333c` | with the whole Internet getting filled with a ice lock on all of the social medias shouldn't we just start AI slapping p |
| 2026-05-03 | platform:architecture_design | 0.72 | `e669bbe3` | OK what have you learned from all the OCR that you did for like 2000 pictures of Jenny cave and what's the timeframe tha |
| 2026-05-02 | platform:nuke_engineering | 0.78 | `309660fe` | ycombinator.com/apply its another batch so do you think we should submit or not |
| 2026-05-02 | platform:architecture_design | 0.79 | `5d0848ba` | OK card crash was doing a bunch of useful things and I'm super annoyed because I've been on claude all fucking day and I |
| 2026-05-02 | platform:data_pipelines | 0.81 | `9f949946` | we probably shouldnt be messing with modal right now |
| 2026-05-02 | vehicles:other | 0.86 | `ceff2a16` | little annoying design issu [Image #1] [Image #2] images are heavily cropped |
| 2026-04-30 | vehicles:other | 0.8 | `4078eae4` | its time to pivot our homepage. nuke.ag. we need to first look at what we are. read the docs and see if theres a signal  |
| 2026-04-28 | vehicles:other | 0.81 | `97744e5d` | my wife is asking for receipts that doug is supposed to pay. im very dissorganized. i have two years of improperly kept  |
| 2026-04-27 | platform:architecture_design | 0.86 | `3e74ea02` | https://www.palantir.com/platforms/foundry/digital-twin/#foundry-digital-twin-or-form im looking at their digitla twin p |
| 2026-04-26 | vehicles:other | 0.84 | `1aa7acdd` | can you look at my pictures and emails but mainly my and jennys location to figure out how much time ive been away from  |
| 2026-04-26 | platform:nuke_engineering | 0.79 | `499d64ce` | /Volumes/Untitled/DCIM/100GOPRO have we done anything with these video files yet? they are timelapses of vehicles ive wo |
| 2026-04-26 | platform:nuke_engineering | 0.86 | `a4ac4c1e` | http://localhost:5173/vehicle/e04bf9c5-b488-433b-be9a-3d307861d90b/wiring  we need to get the real product images anf ge |
| 2026-04-26 | vehicles:other | 0.73 | `2f61b420` |  Bash(sleep 2                                                    open "http://localhost:5173/vehicle/e04bf9c5-b488-433b- |
| 2026-03-06 | vehicles:other | 0.86 | `75315b6f` |  |
| 2026-02-26 | vehicles:other | 0.8 | `87737ab6` |  |
| 2026-02-02 | finance:bookkeeping | 0.89 | `39febae4` |  |
