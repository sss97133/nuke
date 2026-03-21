"""
Export Nuke Market Intelligence Training Data

This exports what makes vehicles sell for more or less — the patterns, not just the fields.

Training examples teach the model:
1. COHORT KNOWLEDGE — "73-87 GM trucks: what separates $15K from $80K"
2. PRICE DRIVERS — "matching numbers = +60%, factory A/C = +$8K on this cohort"
3. PRESENTATION GAPS — "this vehicle has 3 photos, top sellers in cohort average 42"
4. COMMENT INTELLIGENCE — "comments reveal hidden value or red flags"
5. VALUE ENGINEERING — "what to fix, in what order, to maximize ROI"

Usage:
    modal run yono/export_nuke_market_intelligence.py
    modal run yono/export_nuke_market_intelligence.py --limit 50000
"""

import modal
import os

app = modal.App("nuke-market-intelligence-export")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(["supabase", "tqdm"])
)

volume = modal.Volume.from_name("yono-data", create_if_missing=True)


def send_telegram(message: str):
    import urllib.request, json
    t = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    c = os.environ.get("TELEGRAM_CHAT_ID", "")
    if not t or not c:
        return
    try:
        data = json.dumps({"chat_id": c, "text": message, "parse_mode": "Markdown"}).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{t}/sendMessage",
            data=data, headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass


def dispatch(msg):
    print(msg)
    send_telegram(msg)


@app.function(
    image=image,
    timeout=14400,  # 4 hours
    volumes={"/data": volume},
    secrets=[
        modal.Secret.from_name("supabase-credentials"),
        modal.Secret.from_name("nuke-sidecar-secrets"),
    ],
    memory=32768,
)
def export_market_intelligence(limit: int = 50000):
    """Export market intelligence training data from Nuke."""
    import json
    import random
    from datetime import datetime
    from collections import defaultdict
    from supabase import create_client

    dispatch("*Nuke Market Intelligence Export*\nBuilding training data...")

    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    examples = []
    stats = defaultdict(int)

    # ── 1. COHORT ANALYSIS EXAMPLES ─────────────────────────────
    # Group by make+model, teach the model what drives price within a cohort
    dispatch("Phase 1: Cohort price analysis...")

    # Get cohorts with enough data
    cohort_query = """
        SELECT make, model,
            count(*) as cnt,
            avg(sale_price) as avg_price,
            min(sale_price) as min_price,
            max(sale_price) as max_price,
            percentile_cont(0.25) WITHIN GROUP (ORDER BY sale_price) as p25,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY sale_price) as p75,
            avg(comment_count) as avg_comments,
            avg(bid_count) as avg_bids
        FROM vehicles
        WHERE status IN ('active','sold') AND sale_price > 1000
            AND make IS NOT NULL AND model IS NOT NULL
        GROUP BY make, model
        HAVING count(*) > 15
        ORDER BY count(*) DESC
        LIMIT 200
    """
    page_size = 1000
    all_vehicles = []
    offset = 0

    dispatch("  Loading vehicles with price data...")
    while len(all_vehicles) < limit:
        resp = supabase.table("vehicles").select(
            "id, year, make, model, trim, vin, sale_price, mileage, "
            "color, interior_color, transmission, engine_type, engine_size, "
            "drivetrain, body_style, description, highlights, equipment, "
            "auction_source, comment_count, bid_count, high_bid, "
            "reserve_status, data_quality_score, completion_percentage, "
            "image_count, condition_rating, known_flaws, modifications"
        ).gt("sale_price", 1000).not_.is_("make", "null").not_.is_("model", "null").not_.is_("description", "null").order("sale_price", desc=True).range(offset, offset + page_size - 1).execute()

        if not resp.data:
            break
        all_vehicles.extend(resp.data)
        offset += page_size
        if offset % 10000 == 0:
            dispatch(f"  ...{len(all_vehicles):,} vehicles loaded")

    dispatch(f"  Loaded {len(all_vehicles):,} vehicles with prices")

    # Group into cohorts
    cohorts = defaultdict(list)
    for v in all_vehicles:
        key = f"{v.get('make', '')} {v.get('model', '')}".strip()
        if key:
            cohorts[key].append(v)

    # ── Generate cohort comparison examples ──────────────────────
    dispatch("Phase 2: Generating cohort comparisons...")

    for cohort_name, vehicles in cohorts.items():
        if len(vehicles) < 10:
            continue

        vehicles_sorted = sorted(vehicles, key=lambda x: x.get("sale_price", 0), reverse=True)
        top_5 = vehicles_sorted[:5]
        bottom_5 = vehicles_sorted[-5:]
        median_price = vehicles_sorted[len(vehicles_sorted) // 2].get("sale_price", 0)

        def vehicle_summary(v):
            parts = []
            if v.get("year"): parts.append(str(v["year"]))
            if v.get("trim"): parts.append(v["trim"])
            parts.append(f"${v.get('sale_price', 0):,.0f}")
            if v.get("mileage"): parts.append(f"{v['mileage']:,} mi")
            if v.get("color"): parts.append(v["color"])
            if v.get("transmission"): parts.append(v["transmission"])
            if v.get("engine_type"): parts.append(v["engine_type"])
            if v.get("comment_count"): parts.append(f"{v['comment_count']} comments")
            if v.get("bid_count"): parts.append(f"{v['bid_count']} bids")
            if v.get("completion_percentage"): parts.append(f"{v['completion_percentage']}% complete")
            return ", ".join(parts)

        top_block = "\n".join(f"  TOP: {vehicle_summary(v)}" for v in top_5)
        bottom_block = "\n".join(f"  LOW: {vehicle_summary(v)}" for v in bottom_5)

        # Build the analysis — what separates top from bottom
        top_avg_comments = sum((v.get("comment_count") or 0) for v in top_5) / 5
        bot_avg_comments = sum((v.get("comment_count") or 0) for v in bottom_5) / 5
        top_avg_completion = sum((v.get("completion_percentage") or 0) or 0 for v in top_5) / 5
        bot_avg_completion = sum((v.get("completion_percentage") or 0) or 0 for v in bottom_5) / 5
        top_avg_price = sum((v.get("sale_price") or 0) for v in top_5) / 5
        bot_avg_price = sum((v.get("sale_price") or 0) for v in bottom_5) / 5

        # Collect attribute differences
        top_transmissions = [v.get("transmission") for v in top_5 if v.get("transmission")]
        bot_transmissions = [v.get("transmission") for v in bottom_5 if v.get("transmission")]
        top_has_desc = sum(1 for v in top_5 if v.get("description") and len(str(v["description"])) > 200)
        bot_has_desc = sum(1 for v in bottom_5 if v.get("description") and len(str(v["description"])) > 200)

        analysis = {
            "cohort": cohort_name,
            "sample_size": len(vehicles),
            "price_range": f"${vehicles_sorted[-1].get('sale_price', 0):,.0f} - ${vehicles_sorted[0].get('sale_price', 0):,.0f}",
            "median_price": f"${median_price:,.0f}",
            "top_5_avg": f"${top_avg_price:,.0f}",
            "bottom_5_avg": f"${bot_avg_price:,.0f}",
            "spread_ratio": round(top_avg_price / max(bot_avg_price, 1), 1),
            "what_top_performers_have": {
                "avg_comments": round(top_avg_comments),
                "avg_completion": round(top_avg_completion),
                "detailed_descriptions": f"{top_has_desc}/5",
                "common_transmissions": top_transmissions,
            },
            "what_bottom_performers_lack": {
                "avg_comments": round(bot_avg_comments),
                "avg_completion": round(bot_avg_completion),
                "detailed_descriptions": f"{bot_has_desc}/5",
                "common_transmissions": bot_transmissions,
            },
            "key_insight": f"Top {cohort_name} sell for {round(top_avg_price / max(bot_avg_price, 1), 1)}x more. "
                           f"They average {round(top_avg_comments)} comments vs {round(bot_avg_comments)} — more engagement = more confidence = higher price."
        }

        examples.append({
            "messages": [
                {"role": "system", "content": "You are a collector vehicle market analyst. You understand what makes vehicles in the same cohort sell for dramatically different prices. You analyze the gap between top performers and underperformers and identify actionable improvements."},
                {"role": "user", "content": f"Analyze the {cohort_name} market. Here are the highest and lowest sellers:\n\n{top_block}\n\n{bottom_block}\n\nWhat separates the top from the bottom?"},
                {"role": "assistant", "content": json.dumps(analysis, indent=2)},
            ]
        })
        stats["cohort_comparisons"] += 1

    dispatch(f"  Generated {stats['cohort_comparisons']} cohort comparisons")

    # ── 2. INDIVIDUAL VEHICLE ANALYSIS + GAP IDENTIFICATION ──────
    dispatch("Phase 3: Vehicle gap analysis...")

    for cohort_name, vehicles in cohorts.items():
        if len(vehicles) < 10:
            continue

        vehicles_sorted = sorted(vehicles, key=lambda x: x.get("sale_price", 0), reverse=True)
        median_price = vehicles_sorted[len(vehicles_sorted) // 2].get("sale_price", 0)
        top_avg = sum((v.get("sale_price") or 0) for v in vehicles_sorted[:5]) / 5

        # Pick vehicles in the bottom half — these are the "fixable" ones
        bottom_half = vehicles_sorted[len(vehicles_sorted) // 2:]
        sample = random.sample(bottom_half, min(3, len(bottom_half)))

        for v in sample:
            desc_text = (str(v.get("description") or ""))[:1500]
            price = (v.get("sale_price") or 0)

            gaps = []
            potential = []

            if not v.get("trim"):
                gaps.append("Missing trim specification — buyers can't verify configuration")
            if not v.get("engine_type"):
                gaps.append("No engine details — critical for matching-numbers verification")
            if not v.get("mileage"):
                gaps.append("Mileage not listed — creates uncertainty, depresses bids")
            if (v.get("comment_count") or 0) < 20:
                top_avg_c = round(sum((x.get("comment_count") or 0) for x in vehicles_sorted[:5]) / 5)
                gaps.append(f"Only {v.get('comment_count') or 0} comments — top performers average {top_avg_c}")
            if (v.get("completion_percentage") or 0) < 60:
                gaps.append(f"Profile only {v.get('completion_percentage') or 0}% complete — missing data = missing value")
            if not v.get("highlights"):
                gaps.append("No highlights listed — not communicating what makes this one special")
            if not v.get("equipment"):
                gaps.append("Equipment list empty — factory options are major value drivers")

            value_gap = top_avg - price
            if value_gap > 0:
                potential.append(f"Top {cohort_name} sell for ${top_avg:,.0f} avg. This sold for ${price:,.0f}. Gap: ${value_gap:,.0f}")

            vehicle_profile = f"{v.get('year', '?')} {cohort_name}"
            if v.get("trim"):
                vehicle_profile += f" {v['trim']}"
            vehicle_profile += f" — ${price:,.0f}"

            analysis = {
                "vehicle": vehicle_profile,
                "cohort_position": f"Bottom half of {len(vehicles)} {cohort_name} listings",
                "median_cohort_price": f"${median_price:,.0f}",
                "top_performer_avg": f"${top_avg:,.0f}",
                "value_gap": f"${value_gap:,.0f}" if value_gap > 0 else "At or above average",
                "gaps_identified": gaps,
                "improvement_priority": [
                    g.split(" — ")[0] if " — " in g else g.split(" — ")[0] for g in gaps[:5]
                ],
                "estimated_impact": f"Closing these gaps could move this vehicle from ${price:,.0f} toward the ${median_price:,.0f} median — a ${median_price - price:,.0f} improvement opportunity" if median_price > price else "Vehicle is performing above median",
            }

            examples.append({
                "messages": [
                    {"role": "system", "content": "You are a vehicle value engineer. Given a vehicle's profile and its cohort data, identify what's holding it back and what specific actions would increase its value. Be specific — name the gaps, estimate the impact, prioritize the fixes."},
                    {"role": "user", "content": f"Analyze this vehicle against its cohort:\n\nVehicle: {vehicle_profile}\nMileage: {v.get('mileage') or 'unknown'}\nColor: {v.get('color') or 'unknown'}\nTransmission: {v.get('transmission') or 'unknown'}\nComments: {v.get('comment_count') or 0}\nBids: {v.get('bid_count') or 0}\nCompletion: {v.get('completion_percentage') or 0}%\n\nDescription excerpt: {desc_text[:500]}\n\nCohort: {len(vehicles)} {cohort_name} with median ${median_price:,.0f}"},
                    {"role": "assistant", "content": json.dumps(analysis, indent=2)},
                ]
            })
            stats["gap_analyses"] += 1

    dispatch(f"  Generated {stats['gap_analyses']} vehicle gap analyses")

    # ── 3. COMMENT-TO-INSIGHT EXAMPLES ───────────────────────────
    dispatch("Phase 4: Comment intelligence (batch)...")

    # Get vehicles with rich comment data and sale outcomes
    comment_vehicles = supabase.table("vehicles").select(
        "id, year, make, model, sale_price, comment_count"
    ).gt("comment_count", 30).gt("sale_price", 5000).order(
        "comment_count", desc=True
    ).limit(500).execute()

    if comment_vehicles.data:
        # Batch fetch comments for these vehicles
        vehicle_ids = [v["id"] for v in comment_vehicles.data[:200]]

        for vid_batch_start in range(0, len(vehicle_ids), 10):
            vid_batch = vehicle_ids[vid_batch_start:vid_batch_start + 10]

            for vid in vid_batch:
                vehicle = next((v for v in comment_vehicles.data if v["id"] == vid), None)
                if not vehicle:
                    continue

                comments_resp = supabase.table("auction_comments").select(
                    "comment_text, author_username, comment_likes, sentiment, key_claims"
                ).eq("vehicle_id", vid).order("comment_likes", desc=True).limit(20).execute()

                if not comments_resp.data or len(comments_resp.data) < 5:
                    continue

                comment_block = "\n".join(
                    f"@{c.get('author_username', 'anon')} ({c.get('comment_likes', 0)} likes): {(c.get('comment_text') or '')[:250]}"
                    for c in comments_resp.data
                )

                # Extract key claims if available
                claims = []
                sentiments = []
                for c in comments_resp.data:
                    if c.get("key_claims"):
                        if isinstance(c["key_claims"], list):
                            claims.extend(c["key_claims"])
                        elif isinstance(c["key_claims"], str):
                            claims.append(c["key_claims"])
                    if c.get("sentiment"):
                        sentiments.append(c["sentiment"])

                v_desc = f"{vehicle.get('year', '?')} {vehicle.get('make', '')} {vehicle.get('model', '')}"
                price = vehicle.get("sale_price", 0)

                analysis = {
                    "vehicle": v_desc,
                    "sale_price": f"${price:,.0f}",
                    "comment_count": vehicle.get("comment_count", 0),
                    "top_comments_analyzed": len(comments_resp.data),
                    "sentiment_distribution": dict((s, sentiments.count(s)) for s in set(sentiments)) if sentiments else "not analyzed",
                    "key_claims_from_community": claims[:10] if claims else "none extracted",
                    "what_comments_reveal": f"High engagement ({vehicle.get('comment_count', 0)} comments) on this {v_desc} suggests strong market interest. Top-liked comments often contain expert knowledge about provenance, condition, and comparable sales.",
                }

                examples.append({
                    "messages": [
                        {"role": "system", "content": "You are an auction comment analyst for collector vehicles. Comments are intelligence — they reveal what the community knows about this vehicle, what concerns exist, what makes it special, and how the market perceives its value. Extract the signal from the noise."},
                        {"role": "user", "content": f"Analyze the comment thread for this {v_desc} (sold for ${price:,.0f}, {vehicle.get('comment_count', 0)} total comments):\n\n{comment_block}"},
                        {"role": "assistant", "content": json.dumps(analysis, indent=2)},
                    ]
                })
                stats["comment_intelligence"] += 1

            if stats["comment_intelligence"] % 50 == 0:
                dispatch(f"  ...{stats['comment_intelligence']} comment analyses")

    dispatch(f"  Generated {stats['comment_intelligence']} comment intelligence examples")

    # ── 4. ERA/SEGMENT KNOWLEDGE ─────────────────────────────────
    dispatch("Phase 5: Era and segment knowledge...")

    era_examples = [
        {
            "messages": [
                {"role": "user", "content": "What defines the 1973-1987 GM truck market and what drives value in this segment?"},
                {"role": "assistant", "content": json.dumps({
                    "segment": "1973-1987 GM C/K Series Trucks (Square Body)",
                    "why_it_matters": "Peak collectibility era for GM trucks. The square body design is iconic, aftermarket support is massive, and they bridge utility and style.",
                    "price_drivers": [
                        "Factory 4x4 (K-series) commands 40-60% premium over 2WD (C-series)",
                        "Short bed > long bed for collectibility",
                        "Original paint survivors outperform restorations",
                        "Factory A/C adds $5-10K",
                        "454 big block > 350 > 305 for value",
                        "Blazer/Jimmy (removable top) commands highest premiums",
                        "Scottsdale and Silverado trims add $3-8K over Custom Deluxe"
                    ],
                    "red_flags": [
                        "Frame rust (especially behind cab mounts)",
                        "Non-matching engine (check casting numbers vs VIN)",
                        "Converted 2WD to 4WD (common, verify transfer case tag)",
                        "Diesel swaps (kills value in this segment)"
                    ],
                    "value_engineering": [
                        "Repaint to factory color = best ROI mod",
                        "Source correct rally wheels = instant $2-3K value add",
                        "Factory seat upholstery restoration = $1-2K add",
                        "Document everything — window sticker, build sheet, service records"
                    ],
                    "market_trend": "Prices peaked 2021-2022, corrected 15-20%, now stabilizing. Short bed 4x4s still appreciating."
                }, indent=2)},
            ]
        },
        {
            "messages": [
                {"role": "user", "content": "How do Ferrari values work? What patterns should I know?"},
                {"role": "assistant", "content": json.dumps({
                    "segment": "Ferrari (all eras)",
                    "core_principle": "Ferrari values are driven by scarcity, provenance, and cultural moment more than mechanical condition.",
                    "price_drivers": [
                        "Classiche certification = +20-40% (proves factory originality)",
                        "Matching numbers is table stakes — non-matching is essentially a different vehicle",
                        "Color: Rosso Corsa is most common, rare colors (Azzurro/Grigio) can command premiums",
                        "Books, tools, jack = surprisingly significant ($5-15K for complete sets)",
                        "Service history at authorized dealers signals proper care",
                        "Low production numbers beat low mileage for investment value"
                    ],
                    "comment_patterns": [
                        "Ferrari BaT threads are longest — average 83 comments vs 52 platform-wide",
                        "Commenters split into 'drive it' vs 'preserve it' camps — sentiment predicts bid ceiling",
                        "Expert commenters (Ferraristi) identify incorrect parts that sellers miss",
                        "Negative comments about maintenance history depress final bids 10-15%"
                    ],
                    "value_engineering": [
                        "Belt service ($3-5K) is expected — unlisted belt service is a red flag, not a savings",
                        "Sticky interiors (common on 90s-2000s) — professional restoration $2-5K, adds $10-15K",
                        "Classiche application if eligible — $5K investment for 20-40% value increase"
                    ],
                    "market_trend": "Gated manual Ferraris (F430, 360) are the current hot segment. Sub-$100K Ferraris (Mondial, 348) getting collector attention as entry points."
                }, indent=2)},
            ]
        },
    ]

    examples.extend(era_examples)
    stats["era_knowledge"] = len(era_examples)

    # ── 5. SCHEMA + PLATFORM KNOWLEDGE ───────────────────────────
    # Keep a smaller set of these from the original export
    dispatch("Phase 6: Schema knowledge...")

    schema_examples = [
        {
            "messages": [
                {"role": "user", "content": "How do I find undervalued vehicles in the database?"},
                {"role": "assistant", "content": json.dumps({
                    "approach": "Compare each vehicle's sale_price against its cohort median, weighted by completeness",
                    "sql": "SELECT v.id, v.year, v.make, v.model, v.sale_price,\n  cohort.median_price,\n  v.sale_price / NULLIF(cohort.median_price, 0) as price_ratio,\n  v.completion_percentage,\n  v.data_quality_score\nFROM vehicles v\nJOIN LATERAL (\n  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY sale_price) as median_price\n  FROM vehicles\n  WHERE make = v.make AND model = v.model AND sale_price > 1000\n) cohort ON true\nWHERE v.sale_price > 0\n  AND v.sale_price < cohort.median_price * 0.6\n  AND v.completion_percentage < 50\nORDER BY cohort.median_price - v.sale_price DESC\nLIMIT 50;",
                    "insight": "Vehicles selling below 60% of cohort median WITH low completion scores are likely undervalued due to poor presentation, not poor quality. These are the value engineering opportunities.",
                    "next_steps": [
                        "Check photo count — if < 20, presentation gap is likely",
                        "Check comment sentiment — negative sentiment = real problem, low comments = visibility problem",
                        "Compare equipment list to top performers in cohort"
                    ]
                }, indent=2)},
            ]
        },
    ]
    examples.extend(schema_examples)
    stats["schema"] = len(schema_examples)

    # ── SHUFFLE AND SPLIT ────────────────────────────────────────
    total = len(examples)
    random.shuffle(examples)
    split = int(total * 0.9)
    train = examples[:split]
    val = examples[split:]

    os.makedirs("/data/nuke-agent", exist_ok=True)

    with open("/data/nuke-agent/train.jsonl", "w") as f:
        for ex in train:
            f.write(json.dumps(ex) + "\n")

    with open("/data/nuke-agent/val.jsonl", "w") as f:
        for ex in val:
            f.write(json.dumps(ex) + "\n")

    volume.commit()

    summary = (
        f"*Nuke Market Intelligence Export Complete*\n\n"
        f"Cohort comparisons: {stats['cohort_comparisons']}\n"
        f"Gap analyses: {stats['gap_analyses']}\n"
        f"Comment intelligence: {stats['comment_intelligence']}\n"
        f"Era knowledge: {stats['era_knowledge']}\n"
        f"Schema examples: {stats['schema']}\n\n"
        f"Total: {total} examples\n"
        f"Train: {len(train)} / Val: {len(val)}\n\n"
        f"Next: modal run yono/modal_nuke_agent_train.py --action full"
    )
    dispatch(summary)

    return {"total": total, "train": len(train), "val": len(val), "stats": dict(stats)}


@app.local_entrypoint()
def main(limit: int = 50000):
    print(f"Exporting market intelligence ({limit:,} vehicle limit)...")
    result = export_market_intelligence.remote(limit=limit)
    import json
    print(f"\nResult: {json.dumps(result, indent=2)}")
