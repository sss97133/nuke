// Pure deterministic preparation for test_bat_public_live_events.sql; no network.
import fixture from "../functions/_shared/batLiveEvents.fixture.json" with { type: "json" };
import { prepareBatLiveFrame } from "../functions/_shared/batLiveEvents.ts";
const target = { id: "00000000-0000-0000-0000-000000000001", vehicle_id: "00000000-0000-0000-0000-000000000002",
  post_id: fixture.post_id, source_url: fixture.source_url, last_comment_id: 0 };
const frames = await Promise.all(fixture.events.map(f => prepareBatLiveFrame({ ...f,
  monitored_auction_id: target.id, transport: "public_pusher" }, target)));
await Deno.writeTextFile("/private/tmp/nuke-bat-prepared-fixture.json", JSON.stringify({ frames }));
