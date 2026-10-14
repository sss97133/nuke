import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { callTool } from "../../lib/mcp";
import { readVehicleNames } from "./vehicleNames";

interface Atom {
  attribute: string;
  label: unknown;
  confidence: number | string;
  result_kind: string;
  caller_slug: string;
  caller_base_trust: number | string;
  recorded_at: string;
}
interface Photo {
  id: string;
  url: string;
  angle: string | null;
  vehicle_id: string | null;
  taken_at: string | null;
  atoms?: Atom[];
}
interface WorkOrderRef {
  id: string;
  title: string | null;
  status: string | null;
  vehicle_id: string | null;
}
interface Receipt {
  id: string;
  date: string | null;
  vehicle_id: string | null;
  scope_type: string | null;
  scope_id: string | null;
}
interface Summary {
  photo_count: number;
  work_order_count: number;
  labor_lines: number;
  parts_lines: number;
  payment_count: number | null;
  receipt_count?: number;
}
interface WorkLog {
  date: string;
  vehicle_id: string | null;
  audience: string;
  photos: Photo[];
  work_orders: WorkOrderRef[];
  receipts?: Receipt[];
  summary: Summary;
}

const NUKE_LTD_ID = "f32ea08c-c2c5-4ca9-896d-cb99ce6c7bfb";
const VIVA_ID = "c433d27e-2159-4f8c-b4ae-32a5e44a77cf";

function scopeLabel(r: Receipt): string {
  if (r.scope_id === NUKE_LTD_ID) return "NUKE LTD";
  if (r.scope_id === VIVA_ID) return "VIVA";
  if (r.scope_id === "skylar-personal-1040") return "PERSONAL";
  if (r.scope_id === "williams-household") return "HOUSEHOLD";
  if (r.scope_type === "vehicle" && r.scope_id) return "VEH:" + r.scope_id.slice(-4).toUpperCase();
  if (r.scope_type === "income_1099_NEC") return "1099-NEC";
  return "UNSCOPED";
}

function isUnscoped(r: Receipt): boolean {
  return !r.scope_id;
}

interface Response {
  projection_event_id?: string;
  recorded_at?: string;
  date?: string;
  audience?: string;
  confidence?: number;
  observation_count?: number;
  work_log?: WorkLog;
  result?: string;
  note?: string;
}

const styles: Record<string, React.CSSProperties> = {
  page: { fontFamily: "Arial, sans-serif", color: "#000", background: "#fff", minHeight: "100vh", padding: "12px" },
  chrome: { fontSize: 8, textTransform: "uppercase", letterSpacing: "0.08em", color: "#666", borderBottom: "2px solid #000", paddingBottom: 8, marginBottom: 16, display: "flex", justifyContent: "space-between" },
  header: { fontSize: 24, fontWeight: 700, margin: "8px 0", letterSpacing: "-0.01em" },
  meta: { fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "#666", marginBottom: 16 },
  section: { marginTop: 24 },
  sectionLabel: { fontSize: 8, textTransform: "uppercase", letterSpacing: "0.08em", color: "#666", marginBottom: 8 },
  photoGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 },
  photoCell: { border: "2px solid #000", background: "#fafafa", overflow: "hidden", display: "flex", flexDirection: "column" },
  photoImg: { width: "100%", aspectRatio: "4/3", objectFit: "cover", background: "#eee", display: "block" },
  photoCaption: { fontSize: 9, padding: "6px 8px", borderTop: "2px solid #000", color: "#666", textTransform: "uppercase", letterSpacing: "0.06em" },
  atomList: { borderTop: "2px solid #000", padding: "6px 8px", fontSize: 8, fontFamily: "Courier New, monospace", color: "#000", letterSpacing: "0.04em", display: "flex", flexDirection: "column", gap: 2 },
  atomRow: { display: "flex", justifyContent: "space-between", gap: 8 },
  atomCaller: { color: "#666" },
  woRow: { borderBottom: "2px solid #000", padding: "8px 0", fontSize: 14, display: "flex", justifyContent: "space-between" },
  empty: { padding: 24, border: "2px solid #000", background: "#fafafa", fontSize: 14, color: "#000" },
  footer: { marginTop: 32, paddingTop: 12, borderTop: "2px solid #000", fontSize: 8, textTransform: "uppercase", letterSpacing: "0.08em", color: "#666" },
  link: { color: "#000", textDecoration: "underline" },
};

export default function JournalPage() {
  const { date } = useParams<{ date: string }>();
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    setData(null);
    setLoading(true);
    setError(null);
    callTool<Response>("project_work_log", { date })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        const log = result?.work_log;
        const ids = [...new Set([...(log?.photos ?? []), ...(log?.work_orders ?? []), ...(log?.receipts ?? [])]
          .map((x) => x.vehicle_id).filter((x): x is string => !!x))];
        readVehicleNames(ids).then((n) => { if (!cancelled) setNames(n); }, () => undefined);
      })
      .catch((e) => { if (!cancelled) setError(String(e?.message || e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [date]);

  if (!date) return <div style={styles.page}>missing date</div>;

  return (
    <div style={styles.page}>
      <div style={styles.chrome}>
        <span>NUKE · JOURNAL</span>
        <span>PUBLIC VIEW</span>
      </div>

      <h1 style={styles.header}>{date}</h1>
      <div style={styles.meta}>
        {loading && <span>LOADING…</span>}
        {error && <span>ERROR · {error}</span>}
        {data && data.confidence != null && (
          <span>
            CONFIDENCE {(data.confidence * 100).toFixed(0)}% ·{" "}
            {data.observation_count} ATOMS
          </span>
        )}
      </div>

      {data?.result === "insufficient_substrate" && (
        <div style={styles.empty}>
          NO SHOP WORK IN THE PUBLIC RECORD FOR {date}.<br />
          <span style={styles.meta}>{data.note}</span>
        </div>
      )}

      {data?.work_log && (
        <>
          {data.work_log.photos.length > 0 && (
            <div style={styles.section}>
              <div style={styles.sectionLabel}>PHOTOS · {data.work_log.summary.photo_count}</div>
              <div style={styles.photoGrid}>
                {data.work_log.photos.map((p) => (
                  <div key={p.id} style={styles.photoCell}>
                    {p.url ? (
                      <img src={p.url} alt={p.angle ?? "photo"} loading="lazy" style={styles.photoImg} />
                    ) : (
                      <div style={{ ...styles.photoImg, display: "flex", alignItems: "center", justifyContent: "center", color: "#999" }}>NO URL</div>
                    )}
                    <div style={styles.photoCaption}>
                      {p.angle ?? "—"} ·{" "}
                      {p.vehicle_id && names[p.vehicle_id] ? (
                        <Link to={`/vehicle/${p.vehicle_id}`} style={styles.link}>
                          {names[p.vehicle_id]}
                        </Link>
                      ) : p.vehicle_id ? (
                        "PRIVATE VEHICLE"
                      ) : (
                        "UNATTRIBUTED"
                      )}
                    </div>
                    {p.atoms && p.atoms.length > 0 && (
                      <div style={styles.atomList}>
                        {p.atoms.map((a, i) => (
                          <div key={i} style={styles.atomRow}>
                            <span>
                              {a.attribute.replace(/^(image|vehicle)\./, "")}: {String(a.label).slice(0, 24)}
                            </span>
                            <span style={styles.atomCaller}>
                              {a.caller_slug.slice(0, 16)} · {String(a.confidence).slice(0, 4)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.work_log.work_orders.length > 0 && (
            <div style={styles.section}>
              <div style={styles.sectionLabel}>WORK ORDERS · {data.work_log.summary.work_order_count}</div>
              {data.work_log.work_orders.map((w) => (
                <div key={w.id} style={styles.woRow}>
                  <span>{w.title ?? "(untitled)"}</span>
                  <span style={styles.meta}>{w.status ?? "—"}</span>
                </div>
              ))}
            </div>
          )}

          {data.work_log.receipts && data.work_log.receipts.length > 0 && (
            <div style={styles.section}>
              <div style={styles.sectionLabel}>
                EXPENSES · {data.work_log.summary.receipt_count ?? data.work_log.receipts.length}
              </div>
              {data.work_log.receipts.map((r) => {
                const unscoped = isUnscoped(r);
                const badgeStyle: React.CSSProperties = {
                  border: "2px solid #000",
                  padding: "2px 6px",
                  fontSize: 8,
                  fontFamily: "Courier New, monospace",
                  letterSpacing: "0.04em",
                  color: unscoped ? "#999" : "#000",
                  borderColor: unscoped ? "#999" : "#000",
                };
                return (
                  <div key={r.id} style={styles.woRow}>
                    <span style={{ flex: 1 }}>RECEIPT · {r.date ?? "undated"}</span>
                    <span style={badgeStyle}>{scopeLabel(r)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div style={styles.footer}>
        PUBLIC VIEW · EACH ENTRY IS ATTRIBUTED TO THE PHOTO, RECEIPT OR PAYMENT IT CAME FROM
      </div>
    </div>
  );
}
