/**
 * Read-only Supabase client wrapper for the advisor regression harness.
 * - Table reads pass through; insert/update/upsert/delete throw.
 * - RPCs pass through only when allow-listed as reads; log_listing_coverage (the advisor's
 *   coverage write + import_queue enqueue) is swallowed so harness runs never write production rows.
 */
// deno-lint-ignore-file no-explicit-any
export const READ_RPCS = new Set([
  "get_comps_combined",
  "vehicle_price_facts",
  "all_in_buyer_cost_for_vehicles",
]);
export const SWALLOWED_RPCS = new Set(["log_listing_coverage"]);

export function readOnlyClient(
  client: any,
  log: (m: string) => void = () => {},
): any {
  return {
    from(table: string) {
      const b = client.from(table);
      return new Proxy(b, {
        get(target, prop) {
          if (
            prop === "insert" || prop === "update" || prop === "upsert" ||
            prop === "delete"
          ) {
            return () => {
              throw new Error(
                `harness is read-only: ${String(prop)} on ${table} blocked`,
              );
            };
          }
          const v = (target as any)[prop];
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
    },
    rpc(name: string, args?: Record<string, unknown>) {
      if (SWALLOWED_RPCS.has(name)) {
        log(`rpc ${name} swallowed (write)`);
        return Promise.resolve({ data: null, error: null });
      }
      if (!READ_RPCS.has(name)) {
        log(`rpc ${name} blocked (not on read allow-list)`);
        return Promise.resolve({
          data: null,
          error: { message: `harness blocked rpc ${name}` },
        });
      }
      return client.rpc(name, args);
    },
  };
}
