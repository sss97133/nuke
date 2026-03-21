"""
Export Squarebody Intelligence — Deep training on 73-91 GM trucks

4,062 vehicles, 457K images, 88K comments. Every C/K, Blazer, Jimmy,
Suburban, El Camino, Caballero, 454 SS in the database.

Trains the model to be the world's foremost squarebody expert.

Usage:
    modal run yono/export_squarebody_intelligence.py
"""

import modal
import os

app = modal.App("nuke-squarebody-export")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(["supabase", "tqdm"])
)

volume = modal.Volume.from_name("yono-data", create_if_missing=True)

SQUAREBODY_MODELS = [
    '%C10%', '%C20%', '%C30%', '%K10%', '%K20%', '%K30%',
    '%Blazer%', '%Jimmy%', '%Suburban%', '%Pickup%', '%Scottsdale%',
    '%Silverado%', '%Custom Deluxe%', '%Sierra%', '%Cheyenne%',
    '%R10%', '%R20%', '%V10%', '%V20%', '%Square%',
    '%El Camino%', '%Caballero%', '%454 SS%',
    '%1500%', '%2500%', '%3500%', '%C1500%', '%K1500%',
    '%Stepside%', '%Fleetside%', '%Crew Cab%',
]


def dispatch(msg):
    import urllib.request, json
    print(msg)
    t = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    c = os.environ.get("TELEGRAM_CHAT_ID", "")
    if t and c:
        try:
            data = json.dumps({"chat_id": c, "text": msg, "parse_mode": "Markdown"}).encode()
            req = urllib.request.Request(f"https://api.telegram.org/bot{t}/sendMessage", data=data, headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=10)
        except Exception:
            pass


@app.function(
    image=image,
    timeout=14400,
    volumes={"/data": volume},
    secrets=[
        modal.Secret.from_name("supabase-credentials"),
        modal.Secret.from_name("nuke-sidecar-secrets"),
    ],
    memory=32768,
)
def export_squarebody_data():
    import json
    import random
    from collections import defaultdict
    from supabase import create_client

    dispatch("*Squarebody Intelligence Export*\n4,062 trucks, 457K images, 88K comments")

    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    examples = []
    stats = defaultdict(int)

    # ── Load ALL squarebodies ────────────────────────────────────
    dispatch("Loading all squarebodies...")
    all_vehicles = []
    offset = 0
    page_size = 1000

    while True:
        resp = supabase.table("vehicles").select(
            "id, year, make, model, trim, vin, sale_price, mileage, "
            "color, interior_color, transmission, engine_type, engine_size, "
            "drivetrain, body_style, description, highlights, equipment, "
            "auction_source, comment_count, bid_count, high_bid, "
            "reserve_status, data_quality_score, completion_percentage, "
            "image_count, condition_rating, known_flaws, modifications, "
            "horsepower, displacement"
        ).gte("year", 1973).lte("year", 1991).in_(
            "make", ["Chevrolet", "GMC"]
        ).in_("status", ["active", "sold"]).range(offset, offset + page_size - 1).execute()

        if not resp.data:
            break

        # Filter to squarebody models
        for v in resp.data:
            model = (v.get("model") or "").lower()
            if any(pat.strip('%').lower() in model for pat in SQUAREBODY_MODELS):
                all_vehicles.append(v)

        offset += page_size
        if offset % 5000 == 0:
            dispatch(f"  ...scanned {offset}, found {len(all_vehicles)} squarebodies")

    dispatch(f"Loaded {len(all_vehicles)} squarebodies")

    # ── 1. EVERY VEHICLE AS A TRAINING EXAMPLE ──────────────────
    # The model should know every single truck in the database
    dispatch("Phase 1: Individual vehicle profiles...")

    for v in all_vehicles:
        price = v.get("sale_price") or 0
        if price < 500:
            continue

        year = v.get("year") or "?"
        make = v.get("make") or ""
        model = v.get("model") or ""
        desc = (v.get("description") or "")[:2000]

        profile_parts = [f"{year} {make} {model}"]
        if v.get("trim"): profile_parts.append(v["trim"])
        profile = " ".join(profile_parts)

        # Build rich vehicle card
        specs = {}
        for field in ["mileage", "color", "interior_color", "transmission",
                       "engine_type", "engine_size", "drivetrain", "body_style",
                       "horsepower", "displacement", "condition_rating"]:
            val = v.get(field)
            if val is not None and val != "":
                specs[field] = val

        engagement = {
            "comments": v.get("comment_count") or 0,
            "bids": v.get("bid_count") or 0,
            "high_bid": v.get("high_bid") or 0,
            "images": v.get("image_count") or 0,
            "completion": v.get("completion_percentage") or 0,
        }

        extras = {}
        if v.get("highlights"): extras["highlights"] = v["highlights"]
        if v.get("equipment"): extras["equipment"] = v["equipment"]
        if v.get("known_flaws"): extras["known_flaws"] = v["known_flaws"]
        if v.get("modifications"): extras["modifications"] = v["modifications"]

        vehicle_data = {
            "vehicle": profile,
            "sale_price": f"${price:,.0f}",
            "specs": specs,
            "engagement": engagement,
            "extras": extras,
        }

        if desc:
            vehicle_data["description_excerpt"] = desc[:800]

        examples.append({
            "messages": [
                {"role": "system", "content": "You are a squarebody GM truck expert. You know every 1973-1991 Chevrolet and GMC truck, Blazer, Jimmy, Suburban, El Camino, and Caballero in the market. Given a vehicle profile, explain what it is, what makes it valuable or not, and how it compares to others in the segment."},
                {"role": "user", "content": f"Tell me about this truck: {profile}, ${price:,.0f}"},
                {"role": "assistant", "content": json.dumps(vehicle_data, indent=2)},
            ]
        })
        stats["vehicle_profiles"] += 1

    dispatch(f"Phase 1 done: {stats['vehicle_profiles']} vehicle profiles")

    # ── 2. YEAR-BY-YEAR COMPARISONS ─────────────────────────────
    dispatch("Phase 2: Year-by-year analysis...")

    by_year = defaultdict(list)
    for v in all_vehicles:
        if (v.get("sale_price") or 0) > 500:
            by_year[v.get("year")].append(v)

    for year, vehicles in sorted(by_year.items()):
        if not year or len(vehicles) < 5:
            continue

        prices = sorted([(v.get("sale_price") or 0) for v in vehicles])
        models = defaultdict(int)
        for v in vehicles:
            models[v.get("model") or "unknown"] += 1

        top_3 = sorted(vehicles, key=lambda x: (x.get("sale_price") or 0), reverse=True)[:3]
        bot_3 = sorted(vehicles, key=lambda x: (x.get("sale_price") or 0))[:3]

        analysis = {
            "year": year,
            "total_vehicles": len(vehicles),
            "price_range": f"${prices[0]:,.0f} - ${prices[-1]:,.0f}",
            "median_price": f"${prices[len(prices)//2]:,.0f}",
            "model_breakdown": dict(sorted(models.items(), key=lambda x: -x[1])[:10]),
            "top_3": [
                f"{v.get('year')} {v.get('make')} {v.get('model')} — ${(v.get('sale_price') or 0):,.0f} ({v.get('transmission') or '?'}, {v.get('engine_type') or '?'})"
                for v in top_3
            ],
            "bottom_3": [
                f"{v.get('year')} {v.get('make')} {v.get('model')} — ${(v.get('sale_price') or 0):,.0f}"
                for v in bot_3
            ],
        }

        examples.append({
            "messages": [
                {"role": "system", "content": "You are a squarebody GM truck market analyst. Provide detailed year-by-year market analysis showing price distributions, model popularity, and what drives value."},
                {"role": "user", "content": f"What does the {year} GM truck market look like?"},
                {"role": "assistant", "content": json.dumps(analysis, indent=2)},
            ]
        })
        stats["year_analyses"] += 1

    dispatch(f"Phase 2 done: {stats['year_analyses']} year analyses")

    # ── 3. COMMENTS — EVERY COMMENT THREAD ──────────────────────
    dispatch("Phase 3: Comment intelligence...")

    # Get vehicles with most comments
    commented = sorted(all_vehicles, key=lambda x: (x.get("comment_count") or 0), reverse=True)
    commented = [v for v in commented if (v.get("comment_count") or 0) > 10]

    for v in commented[:300]:  # Top 300 most-commented squarebodies
        comments_resp = supabase.table("auction_comments").select(
            "comment_text, author_username, comment_likes, sentiment, key_claims, comment_type"
        ).eq("vehicle_id", v["id"]).order("comment_likes", desc=True).limit(30).execute()

        if not comments_resp.data or len(comments_resp.data) < 5:
            continue

        profile = f"{v.get('year', '?')} {v.get('make', '')} {v.get('model', '')}"
        price = v.get("sale_price") or 0

        # Top comments by likes
        top_comments = "\n".join(
            f"@{c.get('author_username') or 'anon'} ({c.get('comment_likes') or 0} likes): {(c.get('comment_text') or '')[:300]}"
            for c in comments_resp.data[:15]
        )

        # Extract claims and sentiment
        all_claims = []
        sentiment_counts = defaultdict(int)
        for c in comments_resp.data:
            if c.get("key_claims"):
                kc = c["key_claims"]
                if isinstance(kc, list):
                    all_claims.extend(kc)
                elif isinstance(kc, str):
                    all_claims.append(kc)
            if c.get("sentiment"):
                sentiment_counts[c["sentiment"]] += 1

        comment_analysis = {
            "vehicle": profile,
            "sale_price": f"${price:,.0f}",
            "total_comments": v.get("comment_count") or 0,
            "analyzed": len(comments_resp.data),
            "sentiment": dict(sentiment_counts) if sentiment_counts else "not analyzed",
            "community_claims": all_claims[:15] if all_claims else [],
            "top_comment_themes": "Extracted from the most-liked comments in this thread",
        }

        examples.append({
            "messages": [
                {"role": "system", "content": "You are a squarebody auction comment analyst. Analyze what the community is saying about this truck — what they noticed, what concerns they raised, what expertise they shared, and how that affected the sale outcome."},
                {"role": "user", "content": f"Here's the comment thread for a {profile} (sold ${price:,.0f}, {v.get('comment_count') or 0} comments):\n\n{top_comments}"},
                {"role": "assistant", "content": json.dumps(comment_analysis, indent=2)},
            ]
        })
        stats["comment_threads"] += 1

        if stats["comment_threads"] % 50 == 0:
            dispatch(f"  ...{stats['comment_threads']} comment threads analyzed")

    dispatch(f"Phase 3 done: {stats['comment_threads']} comment threads")

    # ── 4. PRICE DRIVER ANALYSIS ─────────────────────────────────
    dispatch("Phase 4: Price driver analysis...")

    # Compare 4x4 vs 2WD
    k_trucks = [v for v in all_vehicles if 'K' in (v.get("model") or "").upper()[:2] and (v.get("sale_price") or 0) > 1000]
    c_trucks = [v for v in all_vehicles if 'C' in (v.get("model") or "").upper()[:2] and (v.get("sale_price") or 0) > 1000]

    if k_trucks and c_trucks:
        k_avg = sum((v.get("sale_price") or 0) for v in k_trucks) / len(k_trucks)
        c_avg = sum((v.get("sale_price") or 0) for v in c_trucks) / len(c_trucks)

        examples.append({
            "messages": [
                {"role": "user", "content": "What's the 4x4 premium on squarebody trucks?"},
                {"role": "assistant", "content": json.dumps({
                    "finding": f"4x4 (K-series) squarebodies average ${k_avg:,.0f} vs 2WD (C-series) at ${c_avg:,.0f}",
                    "premium": f"${k_avg - c_avg:,.0f} ({((k_avg/max(c_avg,1))-1)*100:.0f}% premium)",
                    "sample_size": f"{len(k_trucks)} K-series vs {len(c_trucks)} C-series",
                    "caveat": "Premium varies by model — K5 Blazer 4x4 commands the highest premium. K10 short bed 4x4 is the most sought-after configuration in the segment.",
                }, indent=2)},
            ]
        })
        stats["price_drivers"] += 1

    # Compare by transmission
    manual = [v for v in all_vehicles if v.get("transmission") and "manual" in str(v["transmission"]).lower() and (v.get("sale_price") or 0) > 1000]
    auto = [v for v in all_vehicles if v.get("transmission") and "auto" in str(v["transmission"]).lower() and (v.get("sale_price") or 0) > 1000]

    if manual and auto:
        m_avg = sum((v.get("sale_price") or 0) for v in manual) / len(manual)
        a_avg = sum((v.get("sale_price") or 0) for v in auto) / len(auto)

        examples.append({
            "messages": [
                {"role": "user", "content": "Manual vs automatic on squarebodies — what's the price difference?"},
                {"role": "assistant", "content": json.dumps({
                    "manual_avg": f"${m_avg:,.0f} ({len(manual)} vehicles)",
                    "automatic_avg": f"${a_avg:,.0f} ({len(auto)} vehicles)",
                    "difference": f"${m_avg - a_avg:,.0f}",
                    "insight": "Manual transmissions (SM465 4-speed, NV4500) are increasingly rare and command a premium from enthusiasts. The SM465 'granny low' is the most desirable configuration for off-road and utility use.",
                }, indent=2)},
            ]
        })
        stats["price_drivers"] += 1

    # Compare Blazer vs trucks
    blazers = [v for v in all_vehicles if "blazer" in (v.get("model") or "").lower() and (v.get("sale_price") or 0) > 1000]
    trucks_only = [v for v in all_vehicles if any(x in (v.get("model") or "").lower() for x in ["c10", "k10", "c20", "k20", "pickup"]) and (v.get("sale_price") or 0) > 1000]

    if blazers and trucks_only:
        b_avg = sum((v.get("sale_price") or 0) for v in blazers) / len(blazers)
        t_avg = sum((v.get("sale_price") or 0) for v in trucks_only) / len(trucks_only)

        examples.append({
            "messages": [
                {"role": "user", "content": "K5 Blazer vs C/K10 pickup — which segment is stronger?"},
                {"role": "assistant", "content": json.dumps({
                    "blazer_avg": f"${b_avg:,.0f} ({len(blazers)} vehicles)",
                    "truck_avg": f"${t_avg:,.0f} ({len(trucks_only)} vehicles)",
                    "premium": f"Blazers command ${b_avg - t_avg:,.0f} more on average",
                    "why": "The removable top creates a unique value proposition — part truck, part SUV, part convertible. The Blazer market has a strong enthusiast community and the body style is iconic. Supply is also lower than C/K pickups.",
                }, indent=2)},
            ]
        })
        stats["price_drivers"] += 1

    dispatch(f"Phase 4 done: {stats['price_drivers']} price driver analyses")

    # ── 5. ADD USER-FACING EXAMPLES ──────────────────────────────
    dispatch("Phase 5: Adding user-facing examples...")

    uf_path = "/data/nuke-agent/user_facing.jsonl"
    # Upload the handcrafted examples if they exist locally
    # These were written to the repo at yono/training_data_user_facing.jsonl
    # For now, add squarebody-specific user-facing examples inline

    user_facing = [
        {
            "messages": [
                {"role": "system", "content": "You are Nuke, a squarebody GM truck intelligence system. A user uploaded photos and info about their truck. Tell them exactly where they stand and what to do."},
                {"role": "user", "content": "I have a 1979 Chevrolet K10 Scottsdale, short bed, 350/TH350 auto, 4x4. Factory blue and white two-tone. 112,000 miles. I uploaded 8 photos. What should I do with this truck?"},
                {"role": "assistant", "content": "Your 79 K10 Scottsdale short bed 4x4 is in one of the strongest squarebody configurations. Here's your playbook:\n\n**Where you stand:**\n- Short bed + 4x4 + Scottsdale trim = top 15% of squarebody desirability\n- Factory two-tone is a major plus — single-color trucks are common, factory two-tone is not\n- 350/TH350 is the expected drivetrain — not a premium, but not a penalty\n- 112K miles = normal for a driver-grade truck, no concerns\n\n**Your 8 photos are not enough.** You need 40+ minimum:\n- Frame rails (both sides, especially behind cab mounts)\n- Rocker panels and cab corners (rust hotspots)\n- Engine bay (prove the 350, show condition)\n- Interior (dash, headliner, seats, carpet)\n- Bed floor with mat removed\n- Transfer case and front axle\n- All glass (original date-coded glass adds value)\n- VIN plate and RPO sticker (usually in glove box)\n\n**Value range for your spec:**\n- As-is with 8 photos: $18K-$24K (you're leaving money on the table)\n- With full photo documentation: $26K-$32K\n- With service records + RPO decode + full detail: $30K-$38K\n\n**Action plan:**\n1. Pull the RPO sticker from the glove box — decode it. Every option on that sticker is a value data point\n2. Photograph EVERYTHING. Every angle, every detail. The gap between $24K and $35K is literally just showing what you have\n3. If the two-tone paint is original, do NOT repaint. Document it as survivor paint — that's worth more than a fresh respray\n4. Get the 350 casting number — if it's the original engine (matching VIN), that's your strongest selling point\n5. Check the cab corners and rocker panels. If they're clean, photograph them and emphasize it. If they need work, get quotes — $2-3K for proper cab corners/rockers unlocks $5-8K in value"},
            ]
        },
        {
            "messages": [
                {"role": "system", "content": "You are Nuke, a squarebody GM truck intelligence system. Help users understand what they're looking at in the market."},
                {"role": "user", "content": "I'm seeing a 1987 GMC Jimmy Sierra Classic 4x4 listed for $15,000. 454 swap, lift kit, 35s, aftermarket bumpers. Looks cool. Is this a good buy?"},
                {"role": "assistant", "content": "Slow down. Here's what you're actually looking at:\n\n**Red flags:**\n- 454 swap = NOT original drivetrain. The factory engine was a 305 or 350. This kills matching-numbers value permanently\n- Lift kit + 35s = modified suspension, modified gearing (or should be — if they didn't re-gear, the trans is suffering), modified driveshaft angles\n- Aftermarket bumpers = original bumpers are gone. Sourcing factory chrome bumpers is $800-1500\n\n**What this really is:** A built truck, not a collector truck. Nothing wrong with that if you want to wheel it, but don't expect it to appreciate like a stock example.\n\n**Fair value for a modified Jimmy:**\n- $15K is fair IF: the 454 swap was done properly (correct motor mounts, trans adapter, cooling, wiring), the lift is quality (not a body lift with spacers), and the truck is otherwise solid\n- $15K is too much IF: hack job swap, cheap lift, electrical gremlins, rust under the cool bumpers\n\n**What to verify before buying:**\n1. Pull the VIN — decode it. Know what the truck WAS from the factory\n2. Check the 454 install quality — proper motor mounts? Correct radiator? Clean wiring? If the swap was done by a shop, get their name\n3. Look behind the aftermarket bumpers — are they hiding damage?\n4. Check the transfer case and front axle — 454 torque breaks weak links\n5. Inspect frame — lifts stress frames, especially at the body mounts\n\n**The real question:** Do you want a driver/wheeler or an investment? At $15K, a STOCK Sierra Classic 4x4 in good condition would be worth $25-32K and appreciating. This one is worth $15K now and will be worth $15K in 5 years."},
            ]
        },
    ]

    examples.extend(user_facing)
    stats["user_facing"] = len(user_facing)

    # ── WRITE TO VOLUME ──────────────────────────────────────────
    dispatch("Writing to volume...")

    total = len(examples)
    random.shuffle(examples)
    split = int(total * 0.9)
    train = examples[:split]
    val = examples[split:]

    os.makedirs("/data/nuke-squarebody", exist_ok=True)

    with open("/data/nuke-squarebody/train.jsonl", "w") as f:
        for ex in train:
            f.write(json.dumps(ex) + "\n")

    with open("/data/nuke-squarebody/val.jsonl", "w") as f:
        for ex in val:
            f.write(json.dumps(ex) + "\n")

    volume.commit()

    summary = (
        f"*Squarebody Intelligence Export Complete*\n\n"
        f"Vehicle profiles: {stats['vehicle_profiles']}\n"
        f"Year analyses: {stats['year_analyses']}\n"
        f"Comment threads: {stats['comment_threads']}\n"
        f"Price drivers: {stats['price_drivers']}\n"
        f"User-facing: {stats['user_facing']}\n\n"
        f"Total: {total}\n"
        f"Train: {len(train)} / Val: {len(val)}\n"
        f"Location: /data/nuke-squarebody/"
    )
    dispatch(summary)

    return {"total": total, "train": len(train), "val": len(val), "stats": dict(stats)}


@app.local_entrypoint()
def main():
    print("Exporting squarebody intelligence...")
    result = export_squarebody_data.remote()
    import json
    print(f"\nResult: {json.dumps(result, indent=2)}")
