// ProfileStripView.swift — the vehicle header's document, rendered through the app's one primitive.
//
// The web's ProfileHeader renders `vehicle_profile_read`'s ProfileDocument with the kit: the
// masthead's one headline price as a Claim, then the strip of recorded facts with its coverage.
// This is the same header on the phone. Every value goes through RootedValueView (the trust
// ladder every row in the app already speaks), every clock prints the way the kit prints it, and
// the strip ends with its denominator: how many of its facts are attributed, as of when. Nothing
// here reads a table; the document is the only input, so the phone cannot show a fact the
// database did not hand it for this viewer.

import SwiftUI
import Supabase

/// Additive lot & broadcast provenance enriched from `auction_events` / `vehicle_events` (`ProfileHeader.tsx` #1823).
struct LotProvenance: Equatable {
    var sourceUrl: String?
    var lotNumber: String?
    var auctionName: String?
    var observedAt: String?
    var videoUrl: String?
    var startSeconds: Int?
    var endSeconds: Int?
}

/// A tapped claim awaiting its source sheet.
struct ClaimDrill: Identifiable {
    let title: String
    let claim: Claim
    /// The existing field-provenance drill, when the claim's dimension is a record field.
    let spec: SpecDrill?
    var id: String { title + claim.value.text }
}

/// The header block: headline price (unless a live auction owns it) and the strip.
struct ProfileHeaderBlock: View {
    let vehicleId: String
    let read: ProfileRead
    /// True while a live auction banner shows the current bid: then the masthead price stays off,
    /// the same rule as the web's priceOwnedByLiveStack.
    let priceOwnedByLiveStack: Bool

    @State private var drill: ClaimDrill?
    @State private var descriptionExpanded = false
    @State private var lotProvenance: LotProvenance?

    /// The strip's dimensions map onto record fields the spec table also knows; the
    /// table drops those rows when the strip owns them (state each datum once).
    static func field(for dimension: String) -> String? {
        switch dimension {
        case "body_style": return "body_style"
        case "engine": return "engine_size"
        case "transmission": return "transmission"
        case "drivetrain": return "drivetrain"
        default: return nil
        }
    }

    private static func name(for dimension: String) -> String {
        switch dimension {
        case "body_style": return "Body"
        case "engine": return "Engine"
        case "transmission": return "Transmission"
        case "drivetrain": return "Drivetrain"
        case "location": return "Location"
        default: return dimension.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let m = read.masthead, let price = m.price, !priceOwnedByLiveStack {
                priceRow(enrichedPriceClaim(price, masthead: m), label: m.priceLabel ?? "Recorded price")
            }
            if let strip = read.strip, !strip.facets.isEmpty || strip.odometer != nil {
                stripCard(strip)
            }
            if let desc = read.description, !desc.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                descriptionCard(desc)
            }
        }
        .task(id: vehicleId) { await loadLotProvenance() }
        // The sheet rides this subview, not the page: the page already hosts provenance + comments.
        .sheet(item: $drill) { d in ClaimSourceSheet(vehicleId: vehicleId, drill: d) }
    }

    private func enrichedPriceClaim(_ base: Claim, masthead: ProfileSection.Masthead) -> Claim {
        guard let lp = lotProvenance else { return base }
        var c = base
        if c.observed_at == nil || c.observed_at?.isEmpty == true {
            c.observed_at = lp.observedAt
        }
        if c.source.url == nil || c.source.url?.isEmpty == true {
            c.source.url = lp.sourceUrl
        }
        if c.source.lotNumber == nil || c.source.lotNumber?.isEmpty == true {
            c.source.lotNumber = lp.lotNumber
        }
        if c.source.auctionName == nil || c.source.auctionName?.isEmpty == true {
            c.source.auctionName = lp.auctionName
        }
        if c.source.video == nil {
            let vTitle = [
                masthead.year.map { String($0) },
                masthead.make,
                masthead.model
            ].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
            let sourceLabel = c.source.label ?? "Auction"
            let lotNum = c.source.effectiveLotNumber
            let aucName = c.source.effectiveAuctionName
            let sq = [
                sourceLabel,
                aucName,
                lotNum.map { "Lot \($0)" },
                vTitle.isEmpty ? nil : vTitle
            ].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
            c.source.video = SaleVideoMoment(
                url: lp.videoUrl,
                startSeconds: lp.startSeconds,
                endSeconds: lp.endSeconds,
                lotNumber: lotNum,
                auctionName: aucName,
                searchQuery: sq,
                lotUrl: c.source.url,
                title: vTitle.isEmpty ? nil : vTitle,
                priceText: Self.money(c)
            )
        }
        return c
    }

    private struct AuctionLotRow: Decodable {
        let lot_number: String?
        let source_url: String?
        let auction_end_date: String?
        let auction_start_date: String?
        let broadcast_video_url: String?
        let broadcast_video_id: String?
        let broadcast_timestamp_start: Int?
        let broadcast_timestamp_end: Int?
    }

    private struct VehicleEventLotRow: Decodable {
        struct Meta: Decodable {
            let lot_number: String?
            let auction_name: String?
            let event_name: String?
            let video_url: String?
        }
        let source_url: String?
        let sold_at: String?
        let ended_at: String?
        let extracted_at: String?
        let metadata: Meta?
    }

    /// Additive provenance enrichment from `auction_events` and `vehicle_events` (`ProfileHeader.tsx` #1823).
    private func loadLotProvenance() async {
        async let auctionTask: [AuctionLotRow]? = try? SupabaseService.client
            .from("auction_events")
            .select("lot_number, source_url, auction_end_date, auction_start_date, broadcast_video_url, broadcast_video_id, broadcast_timestamp_start, broadcast_timestamp_end")
            .eq("vehicle_id", value: vehicleId)
            .order("auction_end_date", ascending: false, nullsFirst: false)
            .limit(1)
            .execute()
            .value
        async let eventTask: [VehicleEventLotRow]? = try? SupabaseService.client
            .from("vehicle_events")
            .select("source_url, sold_at, ended_at, extracted_at, metadata")
            .eq("vehicle_id", value: vehicleId)
            .order("extracted_at", ascending: false, nullsFirst: false)
            .limit(1)
            .execute()
            .value
        let (auctionRows, eventRows) = await (auctionTask, eventTask)
        let a = auctionRows?.first
        let e = eventRows?.first
        let m = e?.metadata
        if a == nil && e == nil { return }
        lotProvenance = LotProvenance(
            sourceUrl: a?.source_url ?? e?.source_url,
            lotNumber: a?.lot_number ?? m?.lot_number,
            auctionName: m?.auction_name ?? m?.event_name,
            observedAt: a?.auction_end_date ?? a?.auction_start_date ?? e?.sold_at ?? e?.ended_at ?? e?.extracted_at,
            videoUrl: a?.broadcast_video_url ?? a?.broadcast_video_id ?? m?.video_url,
            startSeconds: a?.broadcast_timestamp_start,
            endSeconds: a?.broadcast_timestamp_end
        )
    }

    @ViewBuilder private func descriptionCard(_ desc: ProfileDescription) -> some View {
        let trimmed = desc.text.trimmingCharacters(in: .whitespacesAndNewlines)
        let sourceLabel = desc.source.label ?? desc.source.kind.displayName
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("RECORDED DESCRIPTION")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 4)
                if let url = desc.source.openableURL {
                    Link("Source ↗", destination: url)
                        .font(.system(size: 10, design: .monospaced))
                }
            }
            Text(trimmed)
                .font(.footnote)
                .foregroundStyle(.primary)
                .lineLimit(descriptionExpanded ? nil : 5)
            if trimmed.count > 240 {
                Button(descriptionExpanded ? "Show less" : "Read full description (\(desc.length.formatted()) chars)") {
                    descriptionExpanded.toggle()
                }
                .font(.caption2.monospaced())
            }
            let attrParts = [
                sourceLabel,
                desc.source.method,
                ProfileClock.day(desc.observed_at).map { "observed \($0)" }
            ].compactMap { $0 }.filter { !$0.isEmpty }
            Text(attrParts.joined(separator: " · "))
                .font(.system(size: 9, design: .monospaced))
                .foregroundStyle(.tertiary)
        }
        .nukeCard()
    }

    // The one headline result: what kind of price, from which platform, as of when.
    @ViewBuilder private func priceRow(_ price: Claim, label: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            RootedValueView(
                label: label,
                value: Self.money(price),
                status: price.rootStatus,
                decay: price.decayLine,
                onDrill: { drill = ClaimDrill(title: label, claim: price, spec: nil) }
            )
        }
        .nukeCard()
    }

    @ViewBuilder private func stripCard(_ strip: ProfileSection.Strip) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("RECORDED CONFIGURATION")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
                .padding(.bottom, 4)
            VStack(spacing: 0) {
                if let odo = strip.odometer {
                    claimRow(label: "Odometer", value: Self.odometer(odo), claim: odo,
                             spec: SpecDrill(label: "Odometer", value: Self.odometer(odo), field: "mileage"))
                    Divider()
                }
                ForEach(strip.facets, id: \.dimension) { f in
                    let name = Self.name(for: f.dimension)
                    claimRow(label: name, value: f.label, claim: f.member,
                             spec: Self.field(for: f.dimension).map { SpecDrill(label: name, value: f.label, field: $0) })
                    Divider()
                }
            }
            // The denominator, always last and always present: a strip without coverage does not exist.
            Text(strip.coverage.sentence)
                .font(.system(size: 9, design: .monospaced))
                .foregroundStyle(.tertiary)
                .padding(.top, 8)
        }
        .nukeCard()
    }

    @ViewBuilder private func claimRow(label: String, value: String, claim: Claim, spec: SpecDrill?) -> some View {
        RootedValueView(
            label: label,
            value: value,
            status: claim.rootStatus,
            decay: claim.decayLine,
            onDrill: { drill = ClaimDrill(title: label, claim: claim, spec: spec) }
        )
    }

    /// USD gets a dollar sign; a classified's unrecorded currency prints the bare number, as on the web.
    static func money(_ claim: Claim) -> String {
        guard let n = claim.value.number else { return claim.value.text }
        if claim.unit == "USD" {
            return n.formatted(.currency(code: "USD").precision(.fractionLength(0)))
        }
        return Int(n.rounded()).formatted()
    }

    static func odometer(_ claim: Claim) -> String {
        guard let n = claim.value.number else { return claim.value.text }
        return "\(Int(n.rounded()).formatted()) \(claim.unit ?? "mi")"
    }
}

/// The read's timeline section (#1033): the record's dated events by day and kind, with its
/// coverage. The build instrument above it is the owner's work rhythm (photos and sessions);
/// this is the record's event ledger (service, maintenance, modification, repair, pending
/// analysis), the same grain the web's day pages read. Renders the kind totals, the latest
/// days, and the denominator last; nothing is shown that the document did not carry.
struct ProfileTimelineCard: View {
    let timeline: ProfileSection.Timeline
    /// How many days to list before the rest is stated as a count.
    var shownDays = 6

    private var kindTotals: [(kind: String, n: Int)] {
        var totals: [String: Int] = [:]
        for d in timeline.days { for (k, n) in d.kinds { totals[k, default: 0] += n } }
        return totals.map { (kind: $0.key, n: $0.value) }.sorted { $0.n == $1.n ? $0.kind < $1.kind : $0.n > $1.n }
    }

    private static func name(_ kind: String) -> String {
        kind.replacingOccurrences(of: "_", with: " ")
    }

    private static func day(_ s: String) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: s) else { return s }
        let out = DateFormatter(); out.locale = Locale(identifier: "en_US_POSIX"); out.timeZone = TimeZone(identifier: "UTC")
        out.dateFormat = "MMM d, yyyy"
        return out.string(from: d)
    }

    var body: some View {
        if !timeline.days.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text("RECORD EVENTS")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 6)
                // Kind totals: what the record's events are, by count.
                Text(kindTotals.map { "\(Self.name($0.kind)) \($0.n.formatted())" }.joined(separator: " · "))
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.primary)
                    .padding(.bottom, 8)
                VStack(spacing: 0) {
                    ForEach(Array(timeline.days.prefix(shownDays)), id: \.day) { d in
                        LabeledContent {
                            Text(d.kinds.sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }
                                    .map { "\(Self.name($0.key)) \($0.value)" }.joined(separator: " · "))
                                .font(.system(.footnote, design: .monospaced))
                                .multilineTextAlignment(.trailing)
                        } label: {
                            Text(Self.day(d.day)).font(.footnote).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 5)
                        Divider()
                    }
                }
                if timeline.days.count > shownDays {
                    Text("\(timeline.days.count - shownDays) earlier days")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(.tertiary)
                        .padding(.top, 6)
                }
                Text(timeline.coverage.sentence)
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.tertiary)
                    .padding(.top, 8)
            }
            .nukeCard()
        }
    }
}

/// The evidence behind a claim, as the web's SourceView states it: when it was observed, who said
/// it, how far it is trusted, where to read it. A record field also opens the existing full
/// provenance drill, so the kit's popover and the app's deep drill are one path, not two.
struct ClaimSourceSheet: View {
    let vehicleId: String
    let drill: ClaimDrill
    @Environment(\.dismiss) private var dismiss
    @State private var fullProvenance: SpecDrill?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Value") {
                        Text(drill.claim.value.text + (drill.claim.unit.map { $0 == "USD" || $0.isEmpty ? "" : " \($0)" } ?? ""))
                            .font(.system(.footnote, design: .monospaced))
                    }
                    LabeledContent("Observed") {
                        Text(ProfileClock.day(drill.claim.observed_at) ?? "unknown date")
                            .font(.system(.footnote, design: .monospaced))
                    }
                    LabeledContent("Source") {
                        Text(drill.claim.sourceLine)
                            .font(.system(.footnote, design: .monospaced))
                            .multilineTextAlignment(.trailing)
                    }
                    if let lotLine = drill.claim.source.lotLine {
                        LabeledContent("Lot") {
                            Text(lotLine)
                                .font(.system(.footnote, design: .monospaced))
                                .multilineTextAlignment(.trailing)
                        }
                    }
                    LabeledContent("Trust") {
                        Text("\(drill.claim.trustPercent)%")
                            .font(.system(.footnote, design: .monospaced))
                    }
                } footer: {
                    Text(drill.claim.source.kind == .legacy
                         ? "A legacy value comes from the vehicle record itself, with no observation beneath it."
                         : "Trust is the reader's calibration for this evidence class, or the row's own confidence when it carries one.")
                }
                if drill.claim.source.openableURL != nil || drill.claim.isAuctionSaleClaim {
                    Section {
                        if let videoUrl = drill.claim.source.video?.watchableURL {
                            Link(destination: videoUrl) {
                                let ts = drill.claim.source.video?.startLabel.map { " (@ \($0))" } ?? ""
                                Label("Watch sale moment\(ts)", systemImage: "play.rectangle.fill")
                            }
                        } else if drill.claim.isAuctionSaleClaim, let ytUrl = drill.claim.youtubeSearchURL() {
                            Link(destination: ytUrl) {
                                Label("Find sale moment on YouTube", systemImage: "play.tv")
                            }
                        }
                        if let url = drill.claim.source.openableURL {
                            Link(destination: url) {
                                Label("Open source", systemImage: "arrow.up.right")
                            }
                        }
                    }
                }
                if let spec = drill.spec, drill.claim.source.kind != .legacy {
                    Section {
                        Button {
                            fullProvenance = spec
                        } label: {
                            Label("Full provenance", systemImage: "doc.text.magnifyingglass")
                        }
                    }
                }
            }
            .navigationTitle(drill.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .sheet(item: $fullProvenance) { spec in FieldProvenanceSheet(vehicleId: vehicleId, drill: spec) }
    }
}
