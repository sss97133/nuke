# HANDOFF — 2026-03-06

## What I Was Working On
Planning infrastructure for a Nuke data server at the 707 Yucca property. User has 11 SSDs to consolidate and a 2011-2013 27" iMac with fiber internet at the property.

## What's Complete
- **Storage audit**: Mapped current disk usage (13GB nuke, 151GB YONO cache, 113GB Photos, 4TB+2TB externals)
- **Architecture decision**: Ubuntu Server 24.04 on the iMac, with Tailscale + MinIO + YONO sidecar + Syncthing
- **Cost analysis**: Replaces Modal (~$20-50/mo), Dropbox/iCloud (~$15-30/mo), reduces Supabase egress
- **Delivery plan**: Prep an SSD "renovation package" — CLAUDE.md + setup.sh + all configs — so Claude on the iMac can execute the full setup

## What's NOT Built Yet
- No scripts written, no configs created, no drive prepped
- This was purely a planning/advisory session

## What's Next
1. **User decides which drive** to use as the delivery drive (one of the 11 SSDs or the new 10TB)
2. **Prep the renovation package** on that drive:
   - `CLAUDE.md` — instructions for Claude on the iMac
   - `setup.sh` — master post-Ubuntu install script
   - Systemd service files for: YONO sidecar, MinIO, Tailscale, Syncthing
   - Caddy/nginx reverse proxy config
   - YONO ONNX model files (`yono/models/yono_make_v1.onnx` + hierarchical models)
   - Firewall (ufw) config
3. **User creates Ubuntu USB boot drive** and installs Ubuntu on the iMac (manual, ~15 min)
4. **Plug in the prepped drive**, Claude on iMac executes setup
5. **Configure Tailscale** mesh between M4 Max and iMac
6. **Migrate YONO sidecar** from Modal to iMac
7. **Catalog all 11 SSDs** — deduplicate, consolidate Nuke-relevant data to 10TB drive

## Key Context
- iMac is 2011 or 2013 — needs Ubuntu, can't run modern macOS
- User's M4 Max is the primary dev/training machine — iMac is storage + services only
- Fiber internet at Yucca property (Cox)
- 33M vehicle images in Supabase, 884K labeled for YONO training
