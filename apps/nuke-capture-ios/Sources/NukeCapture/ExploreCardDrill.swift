// ExploreCardDrill.swift — the three things on an Explore card you can tap, each its own door.
//
//   • the source's mark   → which house this is and the original listing, one tap out
//   • the red countdown   → when the auction closes on the clock (local, absolute), to the second,
//                           how long it has run, and the bid count the vehicle's live row records
//   • the current bid     → the existing bid reading (HeatReadingSheet): comparable sales, the Model 33
//                           finish estimate and finish analogs — the same sheet the Market board opens
//
// Serve each fact once: the card already says the bid and "3h 4m left", so none of these sheets
// opens on those words again; each shows what the card could not. Nothing here writes, and every
// read is one the app already makes elsewhere (vehicle_pulse, live_finish_estimates).

import SwiftUI

/// Which door on a card was tapped. Identifiable so it drives one `.sheet(item:)` for the feed.
struct ExploreCardDrill: Identifiable, Equatable {
    enum Kind: String, Equatable { case source, clock, bid }
    let kind: Kind
    let item: ExploreFeedItem
    var id: String { kind.rawValue + "|" + item.id }

    // MARK: Plain formatting (unit-tested)

    /// The absolute close in the reader's own zone, e.g. "Tue, Nov 10, 2026 at 3:45 PM AST".
    static func absolute(_ date: Date, timeZone: TimeZone = .current, locale: Locale = .current) -> String {
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = timeZone
        f.setLocalizedDateFormatFromTemplate("EEE MMM d yyyy h:mm a zzz")
        return f.string(from: date)
    }

    /// Time left to the second, the precision the card's minute pill leaves out:
    /// "2d 03h 04m 05s", "3h 04m 05s", "4m 05s", "closed" once it has passed.
    static func preciseRemaining(_ ends: Date, now: Date) -> String {
        let s = Int(ends.timeIntervalSince(now).rounded(.down))
        if s <= 0 { return "closed" }
        let d = s / 86_400, h = (s % 86_400) / 3600, m = (s % 3600) / 60, sec = s % 60
        func two(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }
        if d > 0 { return "\(d)d \(two(h))h \(two(m))m \(two(sec))s" }
        if h > 0 { return "\(h)h \(two(m))m \(two(sec))s" }
        return "\(m)m \(two(sec))s"
    }

    /// How long the auction runs, listed → close, when both ends are recorded: "7 days", "6 days 23 hours".
    static func runLength(listed: Date?, ends: Date?) -> String? {
        guard let listed, let ends, ends > listed else { return nil }
        let hours = Int((ends.timeIntervalSince(listed) / 3600).rounded())
        let d = hours / 24, h = hours % 24
        let days = d == 1 ? "1 day" : "\(d) days"
        let hrs = h == 1 ? "1 hour" : "\(h) hours"
        if d == 0 { return hrs }
        return h == 0 ? days : "\(days) \(hrs)"
    }

    /// The listing's host as a reader would say it ("bringatrailer.com"), nil without a link.
    static func host(_ url: URL?) -> String? {
        guard let host = url?.host?.lowercased(), !host.isEmpty else { return nil }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    /// VoiceOver for each door: what it is, then where it goes.
    static func accessibilityLabel(_ kind: Kind, item: ExploreFeedItem, now: Date) -> String {
        switch kind {
        case .source: return "Source, \(item.source)"
        case .clock: return "Time left, \(item.timeLeft(now: now) ?? "close time unknown")"
        case .bid: return "\(item.amountLabel), \(LiveBoardView.bidNumber(item.amount))"
        }
    }
    static func accessibilityHint(_ kind: Kind) -> String {
        switch kind {
        case .source: return "Opens the source and the original listing."
        case .clock: return "Opens the auction close time and bid count."
        case .bid: return "Opens comparable sales and the finish estimate."
        }
    }
}

/// A card door: at least 44 by 44 points, a drill haptic, VoiceOver label and hint. No chrome of its
/// own — the pill, the mark or the number it wraps is the whole visible control.
struct ExploreDoor<Content: View>: View {
    let kind: ExploreCardDrill.Kind
    let item: ExploreFeedItem
    var alignment: Alignment = .leading
    let open: (ExploreCardDrill) -> Void
    @ViewBuilder let label: () -> Content

    var body: some View {
        Button {
            Haptics.drill(depth: 1)
            open(ExploreCardDrill(kind: kind, item: item))
        } label: {
            label()
                .frame(minWidth: 44, minHeight: 44, alignment: alignment)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(ExploreCardDrill.accessibilityLabel(kind, item: item, now: Date())))
        .accessibilityHint(Text(ExploreCardDrill.accessibilityHint(kind)))
        .accessibilityAddTraits(.isButton)
    }
}

/// The sheet for a tapped door.
struct ExploreCardDrillSheet: View {
    let drill: ExploreCardDrill
    /// The open lot behind a live card (the bid door needs its band and id); nil for a classified.
    let lot: LiveAuction?

    var body: some View {
        switch drill.kind {
        case .source: ExploreSourceSheet(item: drill.item)
        case .clock: ExploreClockSheet(item: drill.item)
        case .bid:
            if let lot { ExploreBidSheet(lot: lot) } else { ExploreSourceSheet(item: drill.item) }
        }
    }
}

/// Source door: the house's mark and name, what kind of record this is, and the original listing.
struct ExploreSourceSheet: View {
    let item: ExploreFeedItem
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: NukeSpace.md) {
                        if let url = item.sourceLogoURL { NukeSourceLogo(url: url, name: item.source) }
                        Text(item.source).font(.headline)
                    }
                    .accessibilityElement(children: .combine)
                    drillLine("Record", item.kind == .live ? "Open auction lot" : "Classified listing")
                    if let listed = item.listedAt {
                        drillLine("Listed", ExploreCardDrill.absolute(listed))
                    }
                }
                if let link = item.link {
                    Section {
                        Button {
                            Haptics.drill(depth: 1)
                            openURL(link)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Original listing").font(.body.weight(.semibold))
                                Text(ExploreCardDrill.host(link) ?? link.absoluteString)
                                    .font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1)
                            }
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint(Text("Opens \(item.source) in the browser."))
                    } footer: {
                        Text("The listing as \(item.source) publishes it.")
                    }
                } else {
                    Section { Text("No listing link is recorded for this card.").font(.footnote).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle(item.source)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

/// Clock door: the close on the wall clock, to the second, how long the auction runs and its bid count.
struct ExploreClockSheet: View {
    let item: ExploreFeedItem
    @State private var pulse: VehiclePulse?
    @State private var pulseRead = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let ends = item.endsAt {
                    Section {
                        drillLine("Closes", ExploreCardDrill.absolute(ends))
                        TimelineView(.periodic(from: .now, by: 1)) { ctx in
                            drillLine("Remaining", ExploreCardDrill.preciseRemaining(ends, now: ctx.date))
                                .foregroundStyle(Color.red)
                        }
                        if let run = ExploreCardDrill.runLength(listed: item.listedAt, ends: ends) {
                            drillLine("Auction length", run)
                        }
                    } footer: {
                        Text("Shown in your time zone. The house may extend the close when bids arrive in the final minutes.")
                    }
                }
                Section {
                    if let p = pulse, p.is_live, p.bid_count > 0 {
                        drillLine("Bids recorded", p.bid_count.formatted())
                    } else if pulseRead {
                        Text("No bid count is recorded for this lot.").font(.footnote).foregroundStyle(.secondary)
                    } else {
                        ProgressView()
                    }
                }
            }
            .navigationTitle("Auction clock")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await loadPulse() }
        }
        .presentationDetents([.medium, .large])
    }

    /// The same row the vehicle page's live header reads (public.vehicle_pulse); read-only.
    private func loadPulse() async {
        defer { pulseRead = true }
        guard let id = item.vehicleId else { return }
        let rows: [VehiclePulse]? = try? await SupabaseService.client
            .from("vehicle_pulse").select()
            .eq("vehicle_id", value: id.uuidString).limit(1)
            .execute().value
        pulse = rows?.first
    }
}

/// Bid door: the Market board's own bid reading for this lot, without the bid line the card already shows.
struct ExploreBidSheet: View {
    let lot: LiveAuction
    @State private var estimate: FinishEstimate?

    var body: some View {
        HeatReadingSheet(lot: lot, heat: nil, finishEstimate: estimate, now: Date(), showsCurrentBid: false)
            .task {
                // The same board read the Market tab makes; a miss leaves the estimate out.
                estimate = await FinishBoard.fetch()?.byId[lot.id]
            }
    }
}

private func drillLine(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
        Text(label.uppercased()).font(.caption2.monospaced()).foregroundStyle(.secondary)
        Text(value).font(.footnote)
    }
    .padding(.vertical, 2)
    .accessibilityElement(children: .combine)
}
