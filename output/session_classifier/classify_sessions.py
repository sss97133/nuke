#!/usr/bin/env python3
"""
Classify Claude Code session JSONLs by primary topic and attach to vehicle profiles.

Reads every JSONL across ~/.claude/projects/-* directories, identifies session topic
via keyword match on firstPrompt + first ~5 turns + subagent first-content fallback,
and writes rows to public.session_topic.

Vehicle ID registry (verified from DB 2026-05-23):
- 1977 K5 Blazer      e08bf694-970f-4cbe-8a74-8715158a0f2e  VIN CKR187F127263
- 1966 Mustang        83f6f033-a3c3-4cf4-a85e-a60d2c588838  VIN 6F07C219593
- 1974 K20 Cheyenne   d7adb919-93d8-4fc3-af1b-afb4e027acb3  (Doug's customer build)
- 1932 Ford Hot Rod   21ee373f-765e-4e24-a69d-e59e2af4f467  VIN AZ370615 (sold 2025-01-14 skylarwilliams)
- 1932 Ford Roadster  2aff6e54-f38f-414a-b485-35304e148fe9  (skylarwilliams)
- 1983 GMC K2500      a90c008a-3379-41d8-9eb2-b4eda365d74c  VIN 1GTGK24M1DJ514592 (Granholm $31K)
- 1995 Suburban 2500  1db5daca-526e-42c6-99ae-7faee79b5bad  VIN 1GNGK26N7SJ349264 (sold 2025-10-22)
- 1984 K10            d47d1c55-5d0a-4a04-96af-8b335f4fdc30
"""
import json
import os
import sys
import re
import glob
import time
from pathlib import Path
from collections import Counter, defaultdict

PROJECTS_ROOT = os.path.expanduser("~/.claude/projects")
SESSIONS_INDEX = os.path.expanduser("~/.claude/projects/-Users-skylar-nuke/sessions-index.json")

# Vehicle registry — (vehicle_id, topic_label, keyword_patterns_list)
VEHICLES = [
    ("e08bf694-970f-4cbe-8a74-8715158a0f2e", "vehicle:k5_blazer_1977", [
        r"\bk5\b", r"\b77\s*k5\b", r"\b1977\s*k5\b", r"\b1977\s*blazer\b",
        r"\bckr187f127263\b", r"\bk5.?blazer\b", r"\bblazer\b.*\b1977\b",
        r"\bblazer.{0,30}wiring\b", r"\bk5.{0,30}wiring\b",
        r"e08bf694", r"\bls3\b.*\bblazer\b", r"\bmotec\b",
    ]),
    ("83f6f033-a3c3-4cf4-a85e-a60d2c588838", "vehicle:mustang_1966", [
        r"\b66\s*mustang\b", r"\b1966\s*mustang\b", r"\b1965\s*mustang\b",
        r"\b6f07c219593\b", r"\bmustang\b",
        r"83f6f033",
    ]),
    ("d7adb919-93d8-4fc3-af1b-afb4e027acb3", "vehicle:k20_doug_1974", [
        r"\bdoug.{0,15}k20\b", r"\bk20\b.{0,15}doug",
        r"\b74\s*k20\b", r"\b1974\s*k20\b",
        r"\bcheyenne super k20\b", r"\bcky244z103570\b",
        r"\bk20\b",  # bare k20 — Doug's is the only K20 in Skylar's universe
        r"d7adb919",
    ]),
    ("21ee373f-765e-4e24-a69d-e59e2af4f467", "vehicle:hot_rod_1932", [
        r"\b1932\s*ford\b", r"\b32\s*ford\b", r"\bhot\s*rod\b.*\b1932\b",
        r"\bskylarwilliams\b.*hot rod", r"\baz370615\b",
        r"21ee373f", r"\broadster\b.*\b1932\b",
    ]),
    ("a90c008a-3379-41d8-9eb2-b4eda365d74c", "vehicle:k2500_1983", [
        r"\bk2500\b", r"\b83\s*gmc\b", r"\b1983\s*gmc\b", r"\bsierra classic\b",
        r"\bgranholm\b", r"\b1gtgk24m1dj514592\b",
        r"a90c008a",
    ]),
    ("1db5daca-526e-42c6-99ae-7faee79b5bad", "vehicle:suburban_1995", [
        r"\b95\s*suburban\b", r"\b1995\s*suburban\b", r"\bsuburban 2500\b",
        r"\b1gngk26n7sj349264\b", r"1db5daca",
    ]),
    ("d47d1c55-5d0a-4a04-96af-8b335f4fdc30", "vehicle:k10_1984", [
        r"\b84\s*k10\b", r"\b1984\s*k10\b", r"\b1984\b.*\bk10\b",
        r"d47d1c55",
    ]),
]

# Other topic patterns. First match wins after vehicles.
TOPIC_PATTERNS = [
    ("finance:taxes", [
        r"\btax(es|\s+return)\b", r"\bturbotax\b", r"\birs\b", r"\b1040\b",
        r"\bschedule\s*c\b", r"\b1099(-nec|-misc|-k)?\b", r"\bfailure[-\s]to[-\s]file\b",
        r"\bnol\b", r"\btaxable income\b", r"\bw-?2\b",
    ]),
    ("finance:invoices_and_collections", [
        r"\binvoice\b", r"\bquickbooks\b", r"\bqb\b", r"\baccounts receivable\b",
        r"\bcollect(ions?|ing)\b.{0,30}(money|debt|owed)\b",
        r"\bowes me\b", r"\bowes him\b", r"\bowes us\b",
        r"\bgranholm.*\$", r"\b\$\d{3,4}\b.*owe",
        r"\binv-", r"\bdoug.{0,30}(owe|pay|invoice)",
    ]),
    ("finance:bookkeeping", [
        r"\bbookkeep(ing)?\b", r"\bbank statement\b", r"\bafcu\b",
        r"\boverdraft\b", r"\bzelle\b", r"\bvenmo\b", r"\bpaypal\b",
        r"\breceipts?\b.{0,30}(ocr|catalog|process)",
        r"\bcommingling\b", r"\bmercury\b", r"\bwells fargo\b", r"\bapple card\b",
    ]),
    ("platform:nuke_engineering", [
        r"\bedge function\b", r"\bsupabase\b", r"\bdeploy\b",
        r"\bpr #?\d+\b", r"\bpull request\b", r"\bmerge\b.*\bbranch\b",
        r"\bvercel\b", r"\bbuild\b.*\b(fail|broke|error)",
        r"\bnpm\b", r"\bpnpm\b", r"\btsc\b", r"\btypescript\b",
        r"\bvite\b", r"\breact\b", r"\bnext\.js\b",
    ]),
    ("platform:architecture_design", [
        r"\barchitect(ure|ural)\b", r"\bsubstrate\b", r"\bschema\b",
        r"\bdesign decision\b", r"\baxiom\b", r"\bencyclopedia\b",
        r"\bmcp\b", r"\bontology\b", r"\bdoctrine\b",
        r"\bprovenance\b.*\bschema\b", r"\bvocabulary\b",
    ]),
    ("platform:data_pipelines", [
        r"\bextraction\b", r"\bscrap(ing|er|e)\b", r"\bbacat\b", r"\bfirecrawl\b",
        r"\bbat\b.*\bcomment", r"\bingest\b", r"\bbackfill\b",
        r"\bcraigslist\b", r"\bfacebook marketplace\b", r"\bcars and bids\b",
        r"\brennlist\b", r"\bclassic\.com\b",
    ]),
    ("vehicles:other", [
        r"\bvehicle\b", r"\bcar\b", r"\btruck\b", r"\bvin\b",
        r"\bauction\b", r"\bbring a trailer\b", r"\bbat\b",
    ]),
    ("personal:scheduling_and_admin", [
        r"\bschedule\b", r"\bcalendar\b", r"\bappointment\b",
        r"\bemail\b.*\b(send|draft|reply)\b", r"\bgmail\b",
        r"\bshipping\b", r"\bship station\b", r"\bpackage\b",
    ]),
    ("personal:health_etc", [
        r"\bdoctor\b", r"\bhealth\b", r"\bmedical\b",
    ]),
]


def load_sessions_index():
    """Pre-existing firstPrompt data (covers ~47 sessions, may be partial)."""
    try:
        d = json.load(open(SESSIONS_INDEX))
        return {e["sessionId"]: e for e in d.get("entries", [])}
    except Exception as e:
        print(f"WARN: sessions-index.json load failed: {e}", file=sys.stderr)
        return {}


def extract_text_from_message_content(content):
    """Handle both string and list-of-blocks content."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    parts.append(block.get("text", ""))
                elif block.get("type") == "tool_use":
                    # tool name + input might carry topic signal
                    name = block.get("name", "")
                    inp = block.get("input", {})
                    parts.append(f"[tool:{name}] {json.dumps(inp)[:200]}")
        return " ".join(parts)
    return ""


def read_jsonl_sample(path, max_user_turns=8, max_topic_chars=120000):
    """Read user/assistant turns building a topic-detection sample.

    Strategy: take full text of first N user turns + a wider scan of all messages
    for vehicle / VIN / keyword detection. Cap by character budget, not turn count,
    so long-running sessions still contribute their topic signal.
    """
    early_user_turns = []  # for first_prompt
    topic_text = []  # for keyword matching across whole session
    user_turns_seen = 0
    first_prompt = None
    turn_count = 0
    last_timestamp = None
    chars_acc = 0
    try:
        with open(path, "r", errors="replace") as f:
            for line in f:
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                t = obj.get("type")
                if t in ("user", "assistant"):
                    turn_count += 1
                if obj.get("timestamp"):
                    last_timestamp = obj["timestamp"]
                if t == "user":
                    msg = obj.get("message", {})
                    if msg.get("role") == "user":
                        txt = extract_text_from_message_content(msg.get("content", ""))
                        if txt and not txt.lstrip().startswith("[") and "<system-reminder>" not in txt[:200]:
                            if first_prompt is None:
                                first_prompt = txt[:500]
                            user_turns_seen += 1
                            if user_turns_seen <= max_user_turns:
                                early_user_turns.append(txt[:2000])
                            if chars_acc < max_topic_chars:
                                snippet = txt[:3000]
                                topic_text.append(snippet)
                                chars_acc += len(snippet)
                elif t == "assistant":
                    msg = obj.get("message", {})
                    txt = extract_text_from_message_content(msg.get("content", ""))
                    if txt and chars_acc < max_topic_chars:
                        snippet = txt[:1500]
                        topic_text.append(snippet)
                        chars_acc += len(snippet)
    except Exception as e:
        return {"error": str(e), "turn_count": turn_count}
    return {
        "first_prompt": first_prompt,
        "sample_text": " ".join(topic_text),
        "early_user_text": " ".join(early_user_turns),
        "turn_count": turn_count,
        "last_timestamp": last_timestamp,
    }


def read_subagent_sample(subagent_dir, max_files=3, max_bytes=50000):
    """Fallback: pull first content from a few subagent jsonls."""
    text_acc = []
    last_timestamp = None
    files = sorted(glob.glob(os.path.join(subagent_dir, "*.jsonl")))[:max_files]
    bytes_acc = 0
    for path in files:
        try:
            with open(path, "r", errors="replace") as f:
                for line in f:
                    bytes_acc += len(line)
                    if bytes_acc > max_bytes:
                        break
                    try:
                        obj = json.loads(line)
                    except Exception:
                        continue
                    if obj.get("timestamp"):
                        last_timestamp = obj["timestamp"]
                    msg = obj.get("message", {})
                    txt = extract_text_from_message_content(msg.get("content", ""))
                    if txt:
                        text_acc.append(txt[:1500])
        except Exception:
            continue
    return {
        "sample_text": " ".join(text_acc)[:20000],
        "last_timestamp": last_timestamp,
    }


def classify_text(sample_text, first_prompt, early_user_text=None):
    """Return (primary_topic, secondary_topics, vehicle_ids, confidence, method, scores).

    Weighting: first_prompt hits count 5x, early-user-turn hits count 3x, deep-scan
    hits count 1x. This means a session whose opening question is "alternator on my
    1966 Mustang" beats out incidental K5 mentions later, but a long session that
    genuinely pivots to K5 still gets K5 as secondary.
    """
    fp_text = (first_prompt or "").lower()
    early_text = (early_user_text or "").lower()
    deep_text = (sample_text or "").lower()
    combined = fp_text + " " + early_text + " " + deep_text

    if not combined.strip():
        return ("other", [], [], 0.2, "empty_session", {})

    scores = Counter()
    matched_vehicle_ids = []

    def weighted_hits(patterns):
        h = 0
        for pat in patterns:
            h += 5 * len(re.findall(pat, fp_text, re.IGNORECASE))
            h += 3 * len(re.findall(pat, early_text, re.IGNORECASE))
            h += 1 * len(re.findall(pat, deep_text, re.IGNORECASE))
        return h

    for vid, label, patterns in VEHICLES:
        hits = weighted_hits(patterns)
        if hits > 0:
            scores[label] = hits
            matched_vehicle_ids.append((vid, label, hits))

    for label, patterns in TOPIC_PATTERNS:
        hits = weighted_hits(patterns)
        if hits > 0:
            scores[label] = hits

    if not scores:
        return ("other", [], [], 0.3, "no_keyword_match", {})

    # Primary = highest score; ties broken by vehicle > finance > platform > personal > other
    priority = ["vehicle:", "finance:", "platform:", "personal:", "vehicles:other", "other"]
    def sort_key(item):
        label, score = item
        pri = next((i for i, p in enumerate(priority) if label.startswith(p)), 99)
        return (-score, pri)
    sorted_topics = sorted(scores.items(), key=sort_key)
    primary = sorted_topics[0][0]
    primary_score = sorted_topics[0][1]

    secondaries = [t for t, s in sorted_topics[1:] if s >= max(2, primary_score * 0.4)][:3]

    # Vehicle IDs: include all matched vehicles (not just primary)
    vehicle_ids_out = [vid for vid, label, hits in matched_vehicle_ids if hits >= 1]

    # Confidence: more hits + clear margin = higher
    total = sum(scores.values())
    margin = primary_score / total if total > 0 else 0
    confidence = min(0.95, 0.4 + 0.4 * margin + 0.05 * min(primary_score, 5))
    if primary_score == 1 and total <= 2:
        confidence = 0.45  # weak

    return (primary, secondaries, vehicle_ids_out, round(confidence, 2),
            "firstPrompt_keyword", dict(scores))


def enumerate_all_sessions():
    """Return list of (session_id, project_dir, jsonl_path_or_None, subagent_dir_or_None)."""
    sessions = {}
    project_dirs = sorted(glob.glob(os.path.join(PROJECTS_ROOT, "-*")))
    for pdir in project_dirs:
        if not os.path.isdir(pdir):
            continue
        # Top-level JSONLs = main session transcripts
        for jpath in glob.glob(os.path.join(pdir, "*.jsonl")):
            sid = os.path.basename(jpath).replace(".jsonl", "")
            key = (sid, pdir)
            sessions[key] = (sid, pdir, jpath, None)
        # Subdirs = sessions whose main JSONL was cleaned but subagents persist
        for entry in os.listdir(pdir):
            full = os.path.join(pdir, entry)
            if os.path.isdir(full):
                sid = entry
                key = (sid, pdir)
                sub_dir = os.path.join(full, "subagents")
                sub_dir = sub_dir if os.path.isdir(sub_dir) else None
                if key in sessions:
                    sid_existing, pdir_existing, jpath_existing, _ = sessions[key]
                    sessions[key] = (sid_existing, pdir_existing, jpath_existing, sub_dir)
                else:
                    sessions[key] = (sid, pdir, None, sub_dir)
    return list(sessions.values())


def main():
    start = time.time()
    print(f"[{time.strftime('%H:%M:%S')}] Enumerating sessions...", file=sys.stderr)
    sessions = enumerate_all_sessions()
    print(f"  found {len(sessions)} session-records", file=sys.stderr)

    sessions_index = load_sessions_index()
    print(f"  sessions-index.json: {len(sessions_index)} entries", file=sys.stderr)

    results = []
    issues = []

    for i, (sid, pdir, jpath, sub_dir) in enumerate(sessions):
        if i % 50 == 0:
            print(f"[{time.strftime('%H:%M:%S')}] {i}/{len(sessions)}...", file=sys.stderr)

        first_prompt = None
        sample_text = ""
        early_user_text = ""
        turn_count = 0
        last_timestamp = None
        method = "no_source"

        # Source 1: index entry (lightweight)
        idx_entry = sessions_index.get(sid)
        if idx_entry:
            first_prompt = idx_entry.get("firstPrompt")
            turn_count = idx_entry.get("messageCount", 0)
            last_timestamp = idx_entry.get("modified")
            method = "sessions_index"

        # Source 2: main JSONL (overrides idx)
        if jpath and os.path.exists(jpath):
            try:
                sz = os.path.getsize(jpath)
                if sz == 0:
                    issues.append(f"empty_jsonl: {jpath}")
                else:
                    sample = read_jsonl_sample(jpath)
                    if "error" in sample:
                        issues.append(f"jsonl_read_error: {jpath} -> {sample['error']}")
                    else:
                        first_prompt = sample.get("first_prompt") or first_prompt
                        sample_text = sample.get("sample_text", "")
                        early_user_text = sample.get("early_user_text", "")
                        turn_count = sample.get("turn_count") or turn_count
                        last_timestamp = sample.get("last_timestamp") or last_timestamp
                        method = "first_5_turns_keyword"
            except Exception as e:
                issues.append(f"jsonl_exception: {jpath} -> {e}")

        # Source 3: subagent fallback (when no main JSONL)
        if not sample_text and sub_dir:
            sub_sample = read_subagent_sample(sub_dir)
            sample_text = sub_sample.get("sample_text", "")
            last_timestamp = last_timestamp or sub_sample.get("last_timestamp")
            method = "subagent_fallback" if method == "no_source" else method + "+subagent"

        # Source 4: mtime as last resort timestamp
        if not last_timestamp:
            try:
                mtime = None
                if jpath and os.path.exists(jpath):
                    mtime = os.path.getmtime(jpath)
                elif sub_dir and os.path.isdir(sub_dir):
                    mtime = os.path.getmtime(sub_dir)
                if mtime:
                    last_timestamp = time.strftime(
                        "%Y-%m-%dT%H:%M:%SZ", time.gmtime(mtime))
            except Exception:
                pass

        primary, secondaries, vehicle_ids, confidence, classify_method, scores = \
            classify_text(sample_text, first_prompt, early_user_text)

        # Method tag combines source + classify
        final_method = f"{method}/{classify_method}"

        results.append({
            "session_id": sid,
            "project_dir": pdir,
            "jsonl_path": jpath or (sub_dir or pdir),
            "first_prompt": (first_prompt or "")[:800],
            "modified_at": last_timestamp,
            "turn_count": turn_count or 0,
            "primary_topic": primary,
            "secondary_topics": secondaries,
            "vehicle_ids": vehicle_ids,
            "classification_confidence": confidence,
            "classification_method": final_method,
            "scores": scores,
        })

    out_dir = "/Users/skylar/nuke/output/session_classifier"
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "classifications.json"), "w") as f:
        json.dump(results, f, indent=2, default=str)
    with open(os.path.join(out_dir, "ISSUES.md"), "w") as f:
        f.write("# Session classifier issues\n\n")
        if not issues:
            f.write("No file-level issues encountered.\n")
        else:
            for line in issues:
                f.write(f"- {line}\n")

    # Summary
    topic_counts = Counter(r["primary_topic"] for r in results)
    print(f"\n[{time.strftime('%H:%M:%S')}] Done. {len(results)} sessions in {time.time()-start:.1f}s",
          file=sys.stderr)
    print("\nTopic breakdown:", file=sys.stderr)
    for t, c in topic_counts.most_common():
        print(f"  {c:4d}  {t}", file=sys.stderr)
    low_conf = sum(1 for r in results if r["classification_confidence"] < 0.6)
    print(f"\n  low confidence (<0.6): {low_conf}", file=sys.stderr)
    print(f"  with vehicle attached: {sum(1 for r in results if r['vehicle_ids'])}", file=sys.stderr)


if __name__ == "__main__":
    main()
