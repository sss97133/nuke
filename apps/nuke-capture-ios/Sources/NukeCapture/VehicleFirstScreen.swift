// VehicleFirstScreen.swift — what the vehicle page answers before you scroll: what it is (one
// tappable title line on the photos), what it is worth or asking (the price, large), how old that
// number is, and where it comes from (the source's real mark). Pure helpers are unit-tested.

import SwiftUI
import UIKit
import Supabase

// MARK: Plain formatting (unit-tested)

enum VehicleFirstScreen {
    /// How long ago a clock was: "just now", "12m ago", "5h ago", "3d ago", "4mo ago", "2y ago".
    /// nil when the clock is missing, unparseable, or in the future (an unknown age is not shown).
    static func age(_ raw: String?, now: Date) -> String? {
        guard let raw, let date = parse(raw) else { return nil }
        let s = Int(now.timeIntervalSince(date).rounded(.down))
        if s < -60 { return nil }
        if s < 60 { return "just now" }
        if s < 3600 { return "\(s / 60)m ago" }
        if s < 86_400 { return "\(s / 3600)h ago" }
        let days = s / 86_400
        if days < 30 { return "\(days)d ago" }
        if days < 365 { return "\(days / 30)mo ago" }
        return "\(days / 365)y ago"
    }

    private static let dayOnly: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private static func parse(_ raw: String) -> Date? {
        let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return nil }
        if let d = ProfileClock.date(t) { return d }
        if let d = ProfileClock.date(t.replacingOccurrences(of: " ", with: "T")) { return d }
        return dayOnly.date(from: String(t.prefix(10)))
    }

    /// The title's words: the document's identity tokens when present, else year · make · model · trim.
    static func titleWords(year: Int?, make: String?, model: String?, trim: String?, tokens: [String]?) -> [String] {
        if let tokens {
            let present = tokens.compactMap { NukeDisplay.text($0) }
            if !present.isEmpty { return present }
        }
        return [year.map { String($0) }, make, model, trim].compactMap { NukeDisplay.text($0) }
    }

    /// Splits the title around the make so its wordmark can sit in place:
    /// ("1967", "Chevrolet", "C10 Custom"). No make word → everything is `before`.
    static func splitTitle(_ words: [String], make: String?) -> (before: String, make: String?, after: String) {
        guard let make = NukeDisplay.text(make),
              let i = words.firstIndex(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines)
                  .caseInsensitiveCompare(make) == .orderedSame })
        else { return (words.joined(separator: " "), nil, "") }
        return (words[..<i].joined(separator: " "), words[i], words[(i + 1)...].joined(separator: " "))
    }

    /// Source label → the mark nuke.ag hosts (the files the web's source board shows). A claim's own
    /// https logo wins; otherwise the label is matched loosely ("Bring a Trailer", "bat", "bringatrailer").
    static func sourceMarkURL(label: String?, logoUrl: String? = nil) -> URL? {
        if let raw = NukeDisplay.text(logoUrl), let url = URL(string: raw), url.scheme?.lowercased() == "https" {
            return url
        }
        guard let label = NukeDisplay.text(label) else { return nil }
        let key = label.lowercased().filter { $0.isLetter || $0.isNumber }
        return markFiles[key].flatMap { URL(string: "https://nuke.ag/source-logos/\($0).png") }
    }

    /// Normalized label → file in nuke_frontend/public/source-logos.
    private static let markFiles: [String: String] = [
        "bringatrailer": "bat", "bat": "bat",
        "carsbids": "cars-and-bids", "carsandbids": "cars-and-bids", "carsandbidscom": "cars-and-bids",
        "craigslist": "craigslist",
        "facebookmarketplace": "facebook_marketplace",
        "ksl": "ksl", "kslcars": "ksl",
        "mecum": "mecum",
        "barrettjackson": "barrett-jackson",
    ]
}

// MARK: Title

/// The identity as ONE line and ONE door (to the model's market cohort), with the make's
/// wordmark in place when bundled and a single trailing chevron. Flat text when the cohort
/// node isn't real, so nothing looks tappable that isn't.
struct VehicleIdentityTitle: View {
    let words: [String]
    let make: String?
    var onScrim = true
    let onDrill: (() -> Void)?

    var body: some View {
        if let onDrill {
            Button(action: onDrill) { line(chevron: true) }
                .buttonStyle(.plain)
                .accessibilityHint(Text("Opens how this model is selling"))
        } else {
            line(chevron: false)
        }
    }

    private func line(chevron: Bool) -> some View {
        let parts = VehicleFirstScreen.splitTitle(words, make: make)
        return HStack(alignment: .center, spacing: 6) {
            if !parts.before.isEmpty { Text(parts.before) }
            if let m = parts.make { MakeIdentityView(make: m, height: 22, maxWidth: 150) }
            if !parts.after.isEmpty { Text(parts.after) }
            if chevron {
                Image(systemName: "chevron.right")
                    .font(.subheadline.weight(.bold))
                    .opacity(0.8)
            }
        }
        .font(.nukeHeadline)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .foregroundStyle(onScrim ? Color.white : Color.primary)
        .frame(minHeight: NukeSize.minTap, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

// MARK: Source mark

/// The source's real mark at row height: no plate, no circle, no grey pill. Until it loads the
/// slot holds still; with no known mark the source's name is printed plainly.
struct VehicleSourceMark: View {
    let label: String?
    var logoUrl: String? = nil

    var body: some View {
        if let url = VehicleFirstScreen.sourceMarkURL(label: label, logoUrl: logoUrl) {
            CachedAsyncImage(url: url, maxPixel: 160) { image in
                image.resizable().scaledToFit()
                    .frame(height: 28)
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            } placeholder: {
                Color.clear.frame(width: 28, height: 28)
            }
            .accessibilityLabel(Text(label ?? "Source"))
        } else if let name = NukeDisplay.text(label) {
            Text(name)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
                .lineLimit(1)
        }
    }
}

// MARK: Price

/// The first-screen price: the masthead's one headline price at Explore's 28-pt treatment (label
/// above), how long ago it was observed, and the source's mark, as ONE door to the claim's source
/// sheet. The page leaves it off while a live auction's banner owns the number.
struct VehiclePriceHeadline: View {
    let vehicleId: String
    let masthead: ProfileSection.Masthead
    let price: Claim

    @State private var drill: ClaimDrill?
    @State private var lotProvenance: LotProvenance?

    var body: some View {
        let claim = enrichedPriceClaim(price, masthead: masthead)
        let label = masthead.priceLabel ?? "Recorded price"
        let status = claim.rootStatus
        Button {
            if status.isDrillable { drill = ClaimDrill(title: label, claim: claim, spec: nil) }
        } label: {
            HStack(alignment: .center, spacing: NukeSpace.md) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text(ProfileHeaderBlock.money(claim))
                        .font(.nukeBigNumber)
                        .foregroundStyle(status.valueColor)
                        .strikethrough(status.strikethrough)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
                .layoutPriority(1)
                Spacer(minLength: NukeSpace.sm)
                if let age = VehicleFirstScreen.age(claim.observed_at, now: Date()) {
                    Text(age)
                        .font(.nukePill)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                VehicleSourceMark(label: claim.source.label, logoUrl: claim.source.logoUrl)
            }
            .frame(minHeight: NukeSize.minTap)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, NukeSpace.lg)
        .padding(.top, NukeSpace.md)
        .accessibilityHint(Text("Shows where this price comes from"))
        .contextMenu {
            Button { UIPasteboard.general.string = ProfileHeaderBlock.money(claim) } label: {
                Label("Copy \(label)", systemImage: "doc.on.doc")
            }
        }
        .task(id: vehicleId) { await loadLotProvenance() }
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
                priceText: ProfileHeaderBlock.money(c)
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
}
