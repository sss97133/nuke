// MarketHealthSection.swift — the Work tab's "How Nuke's job market is forming" card over job_market_health_read().
//
// Four rows (demand, supply, matching, jobs moving) in the web's words, each with a sparkline of its history key once
// the daily snapshots cover two days. The whole count opens nuke.ag/work/market in an in-app browser.

import SwiftUI
import Charts
import SafariServices

struct MarketHealthSection: View {
    let market: JobLoad<MarketHealth>

    @State private var showWeb = false

    var body: some View {
        switch market {
        case .loading:
            EmptyView()
        case .refused(let r):
            Section {
                Text("Not available yet. \(r.text)").font(.footnote).foregroundStyle(.secondary)
            } header: {
                Text(MarketHealthCopy.title)
            }
        case .loaded(let m):
            Section {
                row("Demand", MarketHealthCopy.demand(m), trend: m.trend("open_requirements"), id: "market.demand")
                row("Supply", MarketHealthCopy.supply(m), trend: m.trend("evidenced_provider_accounts"), id: "market.supply")
                row("Matching", MarketHealthCopy.matching(m), trend: m.trend("with_plan_b_supplier"), id: "market.matching")
                row("Jobs moving", MarketHealthCopy.flow(m), trend: nil, id: "market.flow")
                Button {
                    showWeb = true
                } label: {
                    Label("See the whole count", systemImage: "chart.bar.xaxis")
                }
            } header: {
                Text(MarketHealthCopy.title)
            } footer: {
                Text(([MarketHealthCopy.note, MarketHealthCopy.history(m), MarketHealthCopy.money].compactMap { $0 }
                      + (JobClock.text(m.asOf).map { ["As of \($0)."] } ?? [])).joined(separator: " "))
            }
            .sheet(isPresented: $showWeb) { InAppBrowser(url: MarketHealthCopy.webURL).ignoresSafeArea() }
        }
    }

    private func row(_ label: String, _ text: String, trend: [Int]?, id: String) -> some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(text).font(.footnote).accessibilityIdentifier(id)
            }
            Spacer(minLength: 4)
            if let trend { Sparkline(points: trend).frame(width: 64, height: 24) }
        }
    }
}

/// A daily count as a bare line: no axes, oldest at the left.
struct Sparkline: View {
    let points: [Int]

    var body: some View {
        Chart {
            ForEach(Array(points.enumerated()), id: \.offset) { i, v in
                LineMark(x: .value("Day", i), y: .value("Count", v)).interpolationMethod(.monotone)
            }
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartYScale(domain: .automatic(includesZero: true))
        .foregroundStyle(Color.accentColor)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Trend over \(points.count) days, from \(points.first ?? 0) to \(points.last ?? 0)")
        .accessibilityIdentifier("market.sparkline")
    }
}

/// A web page in Safari's in-app view (nuke.ag pages the app has no native screen for).
struct InAppBrowser: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}
