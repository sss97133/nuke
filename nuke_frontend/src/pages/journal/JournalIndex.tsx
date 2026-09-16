import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

// Discovery surface for /journal. 90-day density table — one row per day with
// photos / receipts / dollars out / dollars in / top-vehicle. Empty days in
// #999. Backed by /api/journal -> vw_journal_density.

interface DensityRow {
  date: string;
  photo_count: number;
  receipt_count: number;
  receipt_total: number | string;
  payment_total: number | string;
  top_vehicle_id: string | null;
}

const styles: Record<string, React.CSSProperties> = {
  page: { fontFamily: "Arial, sans-serif", color: "#000", background: "#fff", minHeight: "100vh", padding: "12px" },
  chrome: { fontSize: 8, textTransform: "uppercase", letterSpacing: "0.08em", color: "#666", borderBottom: "2px solid #000", paddingBottom: 8, marginBottom: 16, display: "flex", justifyContent: "space-between" },
  header: { fontSize: 24, fontWeight: 700, margin: "8px 0", letterSpacing: "-0.01em" },
  meta: { fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "#666", marginBottom: 24 },
  table: { borderTop: "2px solid #000", borderBottom: "2px solid #000", fontFamily: "Courier New, monospace", fontSize: 11 },
  row: { display: "grid", gridTemplateColumns: "120px 40px 80px 80px 110px 110px 1fr", gap: 8, padding: "6px 8px", borderBottom: "1px solid #ddd", alignItems: "center", textDecoration: "none", color: "#000" },
  rowEmpty: { color: "#999" },
  date: { fontWeight: 700 },
  num: { textAlign: "right" as const },
  vehicleLink: { color: "#000", textDecoration: "underline" },
  footer: { marginTop: 32, paddingTop: 12, borderTop: "2px solid #000", fontSize: 8, textTransform: "uppercase", letterSpacing: "0.08em", color: "#666" },
};

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function fmtUsd(n: number | string): string {
  const v = Number(n) || 0;
  if (v === 0) return "$0";
  return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export default function JournalIndex() {
  const [rows, setRows] = useState<DensityRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/journal")
      .then(async (r) => {
        if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
        return (await r.json()) as { rows: DensityRow[] };
      })
      .then((d) => setRows(d.rows ?? []))
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={styles.page}>
      <div style={styles.chrome}>
        <span>NUKE · JOURNAL</span>
        <span>SUBSTRATE-PROJECTED · LAST 90 DAYS</span>
      </div>
      <h1 style={styles.header}>JOURNAL</h1>
      <div style={styles.meta}>
        EACH DATE PROJECTS A SHOP WORK-LOG FROM SUBSTRATE.<br />
        ATOM-ATTRIBUTED · ARCHIVE-HORIZON COMPLIANT.
      </div>

      {loading && <div style={styles.meta}>LOADING…</div>}
      {error && <div style={styles.meta}>ERROR · {error}</div>}

      {!loading && !error && (
        <div style={styles.table}>
          {rows.map((r) => {
            const dt = new Date(r.date + "T12:00:00Z");
            const wkday = WEEKDAYS[dt.getUTCDay()];
            const empty = r.photo_count === 0 && r.receipt_count === 0 && Number(r.payment_total) === 0;
            const rowStyle = empty ? { ...styles.row, ...styles.rowEmpty } : styles.row;
            return (
              <Link key={r.date} to={`/journal/${r.date}`} style={rowStyle}>
                <span style={styles.date}>{r.date}</span>
                <span>{wkday}</span>
                <span style={styles.num}>{r.photo_count > 0 ? `${r.photo_count} P` : "·"}</span>
                <span style={styles.num}>{r.receipt_count > 0 ? `${r.receipt_count} R` : "·"}</span>
                <span style={styles.num}>{Number(r.receipt_total) > 0 ? `${fmtUsd(r.receipt_total)} OUT` : "·"}</span>
                <span style={styles.num}>{Number(r.payment_total) > 0 ? `${fmtUsd(r.payment_total)} IN` : "·"}</span>
                <span>
                  {r.top_vehicle_id ? (
                    <span style={styles.vehicleLink}>{r.top_vehicle_id.slice(0, 8)}</span>
                  ) : (
                    "·"
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <div style={styles.footer}>
        SURFACE ADAPTED TO: PUBLIC VIEWER · SUBSTRATE COMPOSED VIA vw_journal_density + project_work_log
      </div>
    </div>
  );
}
