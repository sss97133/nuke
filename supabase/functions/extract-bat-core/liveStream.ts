// Ordered rollout compatibility: the implementation belongs to canonical intake.
// Core still uses its unchanged HTTP adapter until its one-handoff PR deploys.
export { closingBatTargets, collectBatLive, batStreamIO, type BatStreamIO } from "../ingest-observation/batLiveCollector.ts";
