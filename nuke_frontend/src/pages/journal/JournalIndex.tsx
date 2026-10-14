import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { readVehicleNames } from "./vehicleNames";

// Discovery surface for /journal: the last 90 days that hold a public record, one row per day with its photos,
// receipts and payments (counts only) and the vehicle most photographed that day, named and linked when the
// vehicle is public. Backed by /api/journal -> vw_journal_density.

interface DensityRow {
  date: string;
  photo_count: number;
  receipt_count: number;
  payment_count: number;
  top_vehicle_id: string | null;
}

const styles: Record<string, React.CSSProperties> = {
  page: { fontFamily: "Arial, sans-serif", color: "#000", background: "#fff", minHeight: "100vh", padding: "12px" },
  chrome: { fontSize: 8, textTransform: "uppercase", letterSpacing: "0.08em", color: "#666", borderBottom: "2px solid #000", paddingBottom: 8, marginBottom: 16, display: "flex", justifyContent: "space-between" },
  header: { fontSize: 24, fontWeight: 700, margin: "8px 0", letterSpacing: "-0.01em" },
  meta: { fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "#666", marginBottom: 24 },
  table: { borderTop: "2px solid #000", borderBottom: "2px solid #000", fontFamily: "Courier New, monospace", fontSize: 11 },
  row: { display: "grid", gridTemplateColumns: "120px 40px 80px 80px 80px 1fr", gap: 8, padding: "6px 8px", borderBottom: "1px solid #ddd", alignItems: "center", textDecoration: "none", color: "#000" },
  date: { fontWeight: 700 },
  num: { textAlign: "right" as const },
  vehicleLink: { color: "#000", textDecoration: "underline" },
  footer: { marginTop: 32, paddingTop: 12, borderTop: "2px solid #000", fontSize: 8, textTransform: "uppercase", letterSpacing: "0.08em", color: "#666" },
};

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const hasRecord = (r: DensityRow) => r.photo_count > 0 || r.receipt_count > 0 || r.payment_count > 0;

export default function JournalIndex() {
  const [rows, setRows] = useState<DensityRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    setLoading(true);
    fetch("/api/journal")
      .then(async (r) => {
        if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
        return (await r.json()) as { rows: DensityRow[] };
      })
      .then((d) => {
        const days = (d.rows ?? []).filter(hasRecord);
        setRows(days);
        const ids = [...new Set(days.map((r) => r.top_vehicle_id).filter((x): x is string => !!x))];
        return readVehicleNames(ids).then(setNames, () => undefined);
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={styles.page}>
      <div style={styles.chrome}>
        <span>NUKE · JOURNAL</span>
        <span>LAST 90 DAYS</span>
      </div>
      <h1 style={styles.header}>JOURNAL</h1>
      <div style={styles.meta}>
        A DAY OF SHOP WORK AS ITS PHOTOS, RECEIPTS AND PAYMENTS RECORD IT.
      </div>

      {loading && <div style={styles.meta}>LOADING…</div>}
      {error && <div style={styles.meta}>ERROR · {error}</div>}

      {!loading && !error && rows.length === 0 && (
        <div style={styles.meta}>NO PUBLIC WORK-LOG ENTRIES IN THE LAST 90 DAYS.</div>
      )}
      {!loading && !error && rows.length > 0 && (
        <div style={styles.table}>
          {rows.map((r) => {
            const dt = new Date(r.date + "T12:00:00Z");
            const wkday = WEEKDAYS[dt.getUTCDay()];
            const vehicleName = r.top_vehicle_id ? names[r.top_vehicle_id] : undefined;
            return (
              <div key={r.date} style={styles.row}>
                <Link to={`/journal/${r.date}`} style={styles.date}>{r.date}</Link>
                <span>{wkday}</span>
                <span style={styles.num}>{r.photo_count > 0 ? `${r.photo_count} P` : "·"}</span>
                <span style={styles.num}>{r.receipt_count > 0 ? `${r.receipt_count} R` : "·"}</span>
                <span style={styles.num}>{r.payment_count > 0 ? `${r.payment_count} PAY` : "·"}</span>
                <span>
                  {r.top_vehicle_id && vehicleName ? (
                    <Link to={`/vehicle/${r.top_vehicle_id}`} style={styles.vehicleLink}>{vehicleName}</Link>
                  ) : (
                    "·"
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div style={styles.footer}>
        PUBLIC VIEW · DAYS WITH NO PUBLIC RECORD ARE NOT LISTED
      </div>
    </div>
  );
}
