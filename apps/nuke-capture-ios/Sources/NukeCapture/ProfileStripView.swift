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

/// Vetted, period-correct factory marque emblem, series badge, trim plate, or model script (`public.resolve_vehicle_identity_marks`).
struct VehicleIdentityMark: Decodable, Identifiable, Equatable {
    let id: String
    let brand: String
    let family: String?
    let seriesCode: String?
    let trimPackage: String?
    let bodyStyle: String?
    let yearStart: Int
    let yearEnd: Int
    let markKind: String
    let displayLabel: String
    let subLabel: String?
    let rpoCode: String?
    let fenderPlacement: String?
    let typographyStyle: String?
    let borderTreatment: String?
    let primaryColor: String?
    let secondaryColor: String?
    let accentColor: String?
    let svgMarkup: String
    let provenanceNote: String
    let vetted: Bool

    private enum CodingKeys: String, CodingKey {
        case id, brand, family, vetted
        case seriesCode, series_code
        case trimPackage, trim_package
        case bodyStyle, body_style
        case yearStart, year_start
        case markKind, mark_kind
        case yearEnd, year_end
        case displayLabel, display_label
        case subLabel, sub_label
        case rpoCode, rpo_code
        case fenderPlacement, fender_placement
        case typographyStyle, typography_style
        case borderTreatment, border_treatment
        case primaryColor, primary_color
        case secondaryColor, secondary_color
        case accentColor, accent_color
        case svgMarkup, svg_markup
        case provenanceNote, provenance_note
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let brandVal = (try? c.decode(String.self, forKey: .brand)) ?? ""
        let famVal = try? c.decodeIfPresent(String.self, forKey: .family)
        let seriesVal = (try? c.decodeIfPresent(String.self, forKey: .series_code))
            ?? (try? c.decodeIfPresent(String.self, forKey: .seriesCode))
        let trimVal = (try? c.decodeIfPresent(String.self, forKey: .trim_package))
            ?? (try? c.decodeIfPresent(String.self, forKey: .trimPackage))
        let bodyVal = (try? c.decodeIfPresent(String.self, forKey: .body_style))
            ?? (try? c.decodeIfPresent(String.self, forKey: .bodyStyle))
        let yStart = (try? c.decodeIfPresent(Int.self, forKey: .year_start))
            ?? (try? c.decodeIfPresent(Int.self, forKey: .yearStart))
            ?? 1900
        let yEnd = (try? c.decodeIfPresent(Int.self, forKey: .year_end))
            ?? (try? c.decodeIfPresent(Int.self, forKey: .yearEnd))
            ?? 2035
        let kindVal = (try? c.decodeIfPresent(String.self, forKey: .mark_kind))
            ?? (try? c.decodeIfPresent(String.self, forKey: .markKind))
            ?? "marque_emblem"
        let labelVal = (try? c.decodeIfPresent(String.self, forKey: .display_label))
            ?? (try? c.decodeIfPresent(String.self, forKey: .displayLabel))
            ?? brandVal

        self.id = (try? c.decodeIfPresent(String.self, forKey: .id))
            ?? "\(brandVal.lowercased())|\(famVal?.lowercased() ?? "")|\(seriesVal?.lowercased() ?? "")|\(trimVal?.lowercased() ?? "")|\(bodyVal?.lowercased() ?? "")|\(yStart)|\(yEnd)|\(kindVal)"
        self.brand = brandVal
        self.family = famVal
        self.seriesCode = seriesVal
        self.trimPackage = trimVal
        self.bodyStyle = bodyVal
        self.yearStart = yStart
        self.yearEnd = yEnd
        self.markKind = kindVal
        self.displayLabel = labelVal
        self.subLabel = (try? c.decodeIfPresent(String.self, forKey: .sub_label))
            ?? (try? c.decodeIfPresent(String.self, forKey: .subLabel))
        self.rpoCode = (try? c.decodeIfPresent(String.self, forKey: .rpo_code))
            ?? (try? c.decodeIfPresent(String.self, forKey: .rpoCode))
        self.fenderPlacement = (try? c.decodeIfPresent(String.self, forKey: .fender_placement))
            ?? (try? c.decodeIfPresent(String.self, forKey: .fenderPlacement))
        self.typographyStyle = (try? c.decodeIfPresent(String.self, forKey: .typography_style))
            ?? (try? c.decodeIfPresent(String.self, forKey: .typographyStyle))
        self.borderTreatment = (try? c.decodeIfPresent(String.self, forKey: .border_treatment))
            ?? (try? c.decodeIfPresent(String.self, forKey: .borderTreatment))
        self.primaryColor = (try? c.decodeIfPresent(String.self, forKey: .primary_color))
            ?? (try? c.decodeIfPresent(String.self, forKey: .primaryColor))
        self.secondaryColor = (try? c.decodeIfPresent(String.self, forKey: .secondary_color))
            ?? (try? c.decodeIfPresent(String.self, forKey: .secondaryColor))
        self.accentColor = (try? c.decodeIfPresent(String.self, forKey: .accent_color))
            ?? (try? c.decodeIfPresent(String.self, forKey: .accentColor))
        self.svgMarkup = (try? c.decodeIfPresent(String.self, forKey: .svg_markup))
            ?? (try? c.decodeIfPresent(String.self, forKey: .svgMarkup))
            ?? ""
        self.provenanceNote = (try? c.decodeIfPresent(String.self, forKey: .provenance_note))
            ?? (try? c.decodeIfPresent(String.self, forKey: .provenanceNote))
            ?? ""
        self.vetted = (try? c.decodeIfPresent(Bool.self, forKey: .vetted)) ?? true
    }

    /// Drillable model facet token (`HomePage.tsx`: `mark.trimPackage ?? mark.seriesCode ?? mark.bodyStyle`).
    var targetModel: String? {
        if let t = trimPackage, !t.isEmpty { return t }
        if let s = seriesCode, !s.isEmpty { return s }
        if let b = bodyStyle, !b.isEmpty { return b }
        return nil
    }

    /// Two-digit year range (`'73–'80`), matching `HomePage.tsx`.
    var eraShortLabel: String {
        String(format: "'%02d–'%02d", yearStart % 100, yearEnd % 100)
    }

    var yearRangeLabel: String {
        "\(yearStart)–\(yearEnd)"
    }

    var kindLabel: String {
        switch markKind {
        case "marque_emblem": return "Marque Emblem"
        case "series_badge": return "Series Badge"
        case "trim_badge": return "Trim Badge"
        case "model_wordmark": return "Model Wordmark"
        case "body_silhouette": return "Body Silhouette"
        default: return markKind.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    /// Calls `public.resolve_vehicle_identity_marks` and applies optional era-window filtering (`eraId = "YYYY-YYYY"`).
    static func resolve(
        brand: String?,
        family: String? = nil,
        year: Int? = nil,
        series: String? = nil,
        trim: String? = nil,
        body: String? = nil,
        eraId: String? = nil
    ) async -> [VehicleIdentityMark] {
        guard let b = brand?.trimmingCharacters(in: .whitespacesAndNewlines), !b.isEmpty else { return [] }
        var params: [String: AnyJSON] = ["p_brand": .string(b)]
        if let f = family?.trimmingCharacters(in: .whitespacesAndNewlines), !f.isEmpty {
            params["p_family"] = .string(f)
        }
        if let y = year {
            params["p_year"] = .integer(y)
        }
        if let s = series?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty {
            params["p_series"] = .string(s)
        }
        if let t = trim?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty {
            params["p_trim"] = .string(t)
        }
        if let bd = body?.trimmingCharacters(in: .whitespacesAndNewlines), !bd.isEmpty {
            params["p_body"] = .string(bd)
        }
        guard let data = try? await SupabaseService.client
            .rpc("resolve_vehicle_identity_marks", params: params)
            .execute()
            .data,
              let decoded = try? JSONDecoder().decode([VehicleIdentityMark].self, from: data)
        else { return [] }

        return filterByEra(decoded, year: year, eraId: eraId)
    }

    static func filterByEra(_ marks: [VehicleIdentityMark], year: Int?, eraId: String?) -> [VehicleIdentityMark] {
        if let y = year {
            return marks.filter { y >= $0.yearStart && y <= $0.yearEnd }
        }
        if let era = eraId?.trimmingCharacters(in: .whitespacesAndNewlines) {
            let parts = era.split(separator: "-")
            if parts.count == 2, let yMin = Int(parts[0]), let yMax = Int(parts[1]) {
                return marks.filter { $0.yearEnd >= yMin && $0.yearStart <= yMax }
            }
        }
        return marks
    }
}

/// Compact HUD chip model rendered in the vehicle profile header strip (`ProfileHeaderBlock`),
/// matching web `VehicleBadgeBar.tsx`.
struct ProfileHeaderHUDChip: Identifiable, Equatable {
    enum Kind: String, Equatable {
        case identityMark = "identity_mark"
        case series = "series"
        case trimFacet = "trim_facet"
        case bodyFacet = "body_facet"
    }

    let id: String
    let kind: Kind
    let prefix: String?
    let label: String
    let subLabel: String?
    let rpoCode: String?
    let mark: VehicleIdentityMark?

    /// Formatted HUD label matching web `VehicleBadgeBar` (e.g. `"CUSTOM DELUXE 10"` or `"SERIES · C10 (1/2-Ton 2WD)"`).
    var displayText: String {
        if let prefix, !prefix.isEmpty {
            return "\(prefix) · \(label)"
        }
        return label
    }
}

extension ProfileVehicleFacets {
    /// Orthogonal facet HUD chips (`SERIES · ...`, `TRIM · ...`, `BODY · ...`) matching web `VehicleBadgeBar`.
    var hudChips: [ProfileHeaderHUDChip] {
        var chips: [ProfileHeaderHUDChip] = []
        if let series, !series.isEmpty {
            chips.append(ProfileHeaderHUDChip(
                id: "facet:series:\(series)",
                kind: .series,
                prefix: "SERIES",
                label: series,
                subLabel: nil,
                rpoCode: nil,
                mark: nil
            ))
        }
        if let trim_facet, !trim_facet.isEmpty {
            chips.append(ProfileHeaderHUDChip(
                id: "facet:trim_facet:\(trim_facet)",
                kind: .trimFacet,
                prefix: "TRIM",
                label: trim_facet,
                subLabel: nil,
                rpoCode: nil,
                mark: nil
            ))
        }
        if let body_facet, !body_facet.isEmpty {
            chips.append(ProfileHeaderHUDChip(
                id: "facet:body_facet:\(body_facet)",
                kind: .bodyFacet,
                prefix: "BODY",
                label: body_facet,
                subLabel: nil,
                rpoCode: nil,
                mark: nil
            ))
        }
        return chips
    }
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
    @State private var identityMarks: [VehicleIdentityMark] = []
    @State private var selectedIdentityMark: VehicleIdentityMark?

    /// Builds the ordered HUD chips (`identityMarks` up to 4 + orthogonal `SERIES`, `TRIM`, `BODY` facets)
    /// rendered in the vehicle profile header strip, matching web `VehicleBadgeBar`.
    static func hudChips(read: ProfileRead, runtimeMarks: [VehicleIdentityMark] = []) -> [ProfileHeaderHUDChip] {
        let marks = !runtimeMarks.isEmpty ? runtimeMarks : read.resolvedIdentityMarks
        var chips: [ProfileHeaderHUDChip] = marks.prefix(4).map { mark in
            ProfileHeaderHUDChip(
                id: "mark:\(mark.id)",
                kind: .identityMark,
                prefix: nil,
                label: mark.displayLabel,
                subLabel: mark.eraShortLabel,
                rpoCode: mark.rpoCode,
                mark: mark
            )
        }
        chips.append(contentsOf: read.resolvedFacets.hudChips)
        return chips
    }

    private var headerHUDChips: [ProfileHeaderHUDChip] {
        Self.hudChips(read: read, runtimeMarks: identityMarks)
    }

    /// The strip's dimensions map onto record fields the spec table also knows; the
    /// table drops those rows when the strip owns them (state each datum once).
    static func field(for dimension: String) -> String? {
        switch dimension {
        case "series", "series_facet": return "series"
        case "trim", "trim_facet": return "trim"
        case "body_style", "body_facet": return "body_style"
        case "engine": return "engine_size"
        case "transmission": return "transmission"
        case "drivetrain": return "drivetrain"
        default: return nil
        }
    }

    private static func name(for dimension: String) -> String {
        switch dimension {
        case "series", "series_facet": return "Series"
        case "trim", "trim_facet": return "Trim"
        case "body_style", "body_facet": return "Body"
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
            if !headerHUDChips.isEmpty {
                vehicleBadgeStrip
            }
            if let strip = read.strip, !strip.facets.isEmpty || strip.odometer != nil {
                stripCard(strip)
            }
            if let desc = read.description, !desc.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                descriptionCard(desc)
            }
        }
        .task(id: vehicleId) {
            async let lpTask: Void = loadLotProvenance()
            async let marksTask: Void = loadIdentityMarks()
            _ = await (lpTask, marksTask)
        }
        // The sheet rides this subview, not the page: the page already hosts provenance + comments.
        .sheet(item: $drill) { d in ClaimSourceSheet(vehicleId: vehicleId, drill: d) }
        .sheet(item: $selectedIdentityMark) { mark in IdentityMarkSheet(mark: mark) }
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

    /// Seeds decoded `identityMarks` from `vehicle_profile_read` when present, and otherwise
    /// resolves vetted era emblems and fender badges from `public.resolve_vehicle_identity_marks`.
    private func loadIdentityMarks() async {
        let embedded = read.resolvedIdentityMarks
        if !embedded.isEmpty {
            identityMarks = embedded
            return
        }
        guard let m = read.masthead else { return }
        let facets = read.resolvedFacets
        let brand = m.make ?? m.identity_source.make
        let family = m.identity_source.normalized_model ?? m.model ?? m.identity_source.model
        let year = m.year ?? m.identity_source.year
        let series = m.identity_source.series ?? facets.series
        let trim = m.identity_source.trim ?? facets.trim_facet
        let body = read.strip?.facets.first(where: { $0.dimension == "body_style" })?.label ?? facets.body_facet
        identityMarks = await VehicleIdentityMark.resolve(
            brand: brand,
            family: family,
            year: year,
            series: series,
            trim: trim,
            body: body
        )
    }

    @ViewBuilder private var vehicleBadgeStrip: some View {
        let chips = headerHUDChips
        VStack(alignment: .leading, spacing: 6) {
            Text("IDENTITY MARKS & FACETS")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(chips) { chip in
                        if let mark = chip.mark {
                            Button {
                                selectedIdentityMark = mark
                            } label: {
                                HStack(spacing: 5) {
                                    Text(chip.label)
                                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                                        .foregroundStyle(.primary)
                                    if let sub = chip.subLabel, !sub.isEmpty {
                                        Text(sub)
                                            .font(.system(size: 9, design: .monospaced))
                                            .foregroundStyle(.secondary)
                                    }
                                    if let rpo = chip.rpoCode, !rpo.isEmpty {
                                        Text(rpo)
                                            .font(.system(size: 8, weight: .semibold, design: .monospaced))
                                            .foregroundStyle(.tertiary)
                                    }
                                }
                                .padding(.horizontal, 8)
                                .padding(.vertical, 5)
                                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 6))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 6)
                                        .strokeBorder(Color.secondary.opacity(0.3), lineWidth: 0.75)
                                )
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("vehicle-identity-mark-\(mark.id)")
                        } else {
                            HStack(spacing: 4) {
                                if let prefix = chip.prefix, !prefix.isEmpty {
                                    Text("\(prefix) ·")
                                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                                        .foregroundStyle(.secondary)
                                }
                                Text(chip.label)
                                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                                    .foregroundStyle(.primary)
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 6))
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .strokeBorder(Color.secondary.opacity(0.25), lineWidth: 0.5)
                            )
                            .accessibilityElement(children: .combine)
                            .accessibilityLabel(chip.displayText)
                            .accessibilityIdentifier("vehicle-facet-\(chip.kind.rawValue)")
                        }
                    }
                }
            }
        }
        .nukeCard()
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
                            Label("Where this came from", systemImage: "doc.text.magnifyingglass")
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

/// Detail sheet for a vetted period-correct factory emblem or fender badge (`VehicleIdentityMark`).
struct IdentityMarkSheet: View {
    let mark: VehicleIdentityMark
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Mark") {
                        Text(mark.displayLabel)
                            .font(.system(.footnote, design: .monospaced).weight(.semibold))
                    }
                    LabeledContent("Kind") {
                        Text(mark.kindLabel)
                            .font(.system(.footnote, design: .monospaced))
                    }
                    LabeledContent("Era") {
                        Text(mark.yearRangeLabel)
                            .font(.system(.footnote, design: .monospaced))
                    }
                    if let sub = mark.subLabel, !sub.isEmpty {
                        LabeledContent("Variant") {
                            Text(sub)
                                .font(.system(.footnote, design: .monospaced))
                                .multilineTextAlignment(.trailing)
                        }
                    }
                    if let rpo = mark.rpoCode, !rpo.isEmpty {
                        LabeledContent("RPO / Code") {
                            Text(rpo)
                                .font(.system(.footnote, design: .monospaced))
                        }
                    }
                    if let placement = mark.fenderPlacement, !placement.isEmpty {
                        LabeledContent("Placement") {
                            Text(placement)
                                .font(.system(.footnote, design: .monospaced))
                                .multilineTextAlignment(.trailing)
                        }
                    }
                }
                if !mark.provenanceNote.isEmpty {
                    Section("Factory Provenance") {
                        Text(mark.provenanceNote)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle(mark.displayLabel)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}
