// VehicleValueTrajectory.swift — the investment timeline read and its trajectory view.
// Moved verbatim out of VehicleDetailView.swift (no behavior change).

import SwiftUI
import Supabase
import Charts

// ─── VALUE TRAJECTORY ────────────────────────────────────────────────────────
// The thesis: a built car has ONE sale (the purchase) then ACCRUING documented
// investment — value you BUILD over time, not wait for a resale to reveal. Reads
// get_vehicle_investment_timeline (receipts, dated). Undated receipts are summarized
// honestly, never plotted (no date to place them). Headline includes the acquisition
// so the curve total ($33.5K) doesn't look broken next to the parts-only proof ledger.
struct InvestmentTimeline: Decodable {
    let points: [Point]?
    let final_cumulative_dated: Double?
    let total_with_undated: Double?
    let baseline: Point?
    let undated: Undated?
    struct Point: Decodable, Identifiable {
        let date: String?; let kind: String?; let delta: Double?
        let proven: Bool?; let cumulative: Double?
        var id: String { (date ?? "") + (kind ?? "") + String(cumulative ?? 0) }
        var day: Date? {
            guard let s = date else { return nil }
            let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.date(from: String(s.prefix(10)))
        }
    }
    struct Undated: Decodable { let n: Int?; let total: Double? }
}

struct ValueTrajectoryView: View {
    let vehicleId: String
    @State private var t: InvestmentTimeline?

    private func money(_ v: Double) -> String { v.formatted(.currency(code: "USD").precision(.fractionLength(0))) }
    private func moneyK(_ v: Double) -> String {
        v >= 1000 ? "$\((v/1000).formatted(.number.precision(.fractionLength(v < 10000 ? 1 : 0))))k" : money(v)
    }

    var body: some View {
        Group {
        if let t, let pts = (t.points ?? []).filter({ $0.day != nil && $0.cumulative != nil }) as [InvestmentTimeline.Point]?,
           pts.count >= 2 {
            VStack(alignment: .leading, spacing: 8) {
                Text("VALUE BUILT")
                    .font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
                    .padding(.horizontal, 16)

                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(moneyK(t.total_with_undated ?? t.final_cumulative_dated ?? 0))
                        .font(.system(.title, design: .monospaced).weight(.semibold))
                    Text("invested").font(.caption2).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 16)
                if let b = t.baseline?.delta {
                    Text("incl. \(money(b)) acquisition · the value you build, not wait to sell")
                        .font(.system(size: 10, design: .monospaced)).foregroundStyle(.tertiary)
                        .padding(.horizontal, 16)
                }

                Chart {
                    ForEach(pts) { p in
                        AreaMark(x: .value("Date", p.day!), y: .value("Invested", p.cumulative!))
                            .foregroundStyle(.linearGradient(colors: [Color.accentColor.opacity(0.28), Color.accentColor.opacity(0.02)],
                                                             startPoint: .top, endPoint: .bottom))
                        LineMark(x: .value("Date", p.day!), y: .value("Invested", p.cumulative!))
                            .foregroundStyle(Color.accentColor).interpolationMethod(.monotone)
                    }
                    if let first = pts.first, let d = first.day {
                        PointMark(x: .value("Date", d), y: .value("Invested", first.cumulative!))
                            .foregroundStyle(Color.accentColor).symbolSize(40)
                            .annotation(position: .topLeading) {
                                Text("bought").font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
                            }
                    }
                }
                .chartYScale(domain: 0...((pts.compactMap { $0.cumulative }.max() ?? 1) * 1.12))
                .chartYAxis {
                    AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { v in
                        AxisGridLine(); AxisValueLabel { if let d = v.as(Double.self) { Text(moneyK(d)) } }
                    }
                }
                .frame(height: 170).padding(.horizontal, 16)

                if let u = t.undated, let ut = u.total, ut > 0 {
                    Text("+ \(money(ut)) from \(u.n ?? 0) undated receipts — real spend, no date to place it on the curve")
                        .font(.system(size: 10, design: .monospaced)).foregroundStyle(.tertiary)
                        .padding(.horizontal, 16)
                }
            }
            .padding(.bottom, 16)
        }
        }
        .task(id: vehicleId) { await fetch() }
    }

    private func fetch() async {
        struct P: Encodable { let p_vehicle: String }
        t = try? await SupabaseService.client
            .rpc("get_vehicle_investment_timeline", params: P(p_vehicle: vehicleId))
            .execute().value
    }
}
