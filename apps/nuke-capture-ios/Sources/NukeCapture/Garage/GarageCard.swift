// GarageCard.swift — one garage card, the web's GarageVehicleCard grid card on the phone: the photo (a pager
// through the car's reel, "n / N"), the car and its price, one lane of what the record says (relationship,
// activity, configuration), its year of day squares, the record's span and counts, and the VIN.
//
// Readers (GarageTimeline.swift): the garage-wide day reader, the profile's own header read (price and
// configuration, once the card appears) and the reel (gallery-eligible photos, on the first swipe). The price is
// the masthead's Claim and opens its source, as on the profile; a card never shows current_value.
//
// The card's menu (long press) carries Garage details, the log book (vehicle_statements read,
// record_vehicle_statement write on Save) and the car's agent (vehicle-agent). Both writes happen only on an
// explicit press. Merge, adding photos and pinch resize stay on the web.

import Supabase
import SwiftUI

struct GarageCard: View {
    let vehicle: GarageVehicle
    let timeline: GarageTimeline?
    /// The day reader failed: the card says so instead of drawing an empty year.
    let timelineFailed: Bool
    let axis: GarageAxis
    let onOpen: () -> Void

    @State private var header: GarageCardHeader?
    @State private var reel: [GarageReelPhoto]?
    @State private var reelAsked = false
    @State private var page = 0
    @State private var drill: ClaimDrill?
    @State private var vinCopied = false

    private var pages: [(url: String, day: String?)] {
        GarageCardReads.pages(cover: vehicle.image_url, reel: reel ?? [])
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            photo
            VStack(alignment: .leading, spacing: 4) {
                head
                lane
                grid
                record
                foot
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 14)
            // The whole card opens the profile; the price and VIN buttons keep their own taps.
            .contentShape(Rectangle())
            .onTapGesture(perform: onOpen)
        }
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: NukeRadius.card))
        .clipShape(RoundedRectangle(cornerRadius: NukeRadius.card))
        .task(id: vehicle.id) { header = await GarageCardReads.header(vehicle.id) }
        .sheet(item: $drill) { d in ClaimSourceSheet(vehicleId: vehicle.vehicle_id, drill: d) }
    }

    // MARK: Photo

    /// Until the reel is read, a car with more than one photo gets one waiting page after its cover: the first swipe
    /// onto it reads the reel (the web reads it on the first touch). No count shows until the reel is known.
    private var awaitingReel: Bool { reel == nil && vehicle.image_count > 1 && vehicle.image_url?.isEmpty == false }

    @ViewBuilder private var photo: some View {
        let pages = pages
        Color(.tertiarySystemFill)
            .frame(maxWidth: .infinity)
            .aspectRatio(4.0 / 3.0, contentMode: .fit)
            .overlay {
                if pages.isEmpty {
                    // No cover was read. The stored image_count can't say whether the car has photos, so the
                    // card says only what it knows.
                    Text("No cover photo").font(.caption).foregroundStyle(.secondary)
                } else {
                    TabView(selection: $page) {
                        ForEach(Array(pages.enumerated()), id: \.element.url) { i, p in
                            pagePhoto(p.url)
                                .tag(i)
                                .onTapGesture(perform: onOpen)
                                .accessibilityLabel(Text(reel == nil ? "Photo" : "Photo \(i + 1) of \(pages.count)"))
                        }
                        if awaitingReel {
                            Color(.tertiarySystemFill)
                                .overlay { ProgressView() }
                                .tag(pages.count)
                                .accessibilityLabel(Text("More photos"))
                        }
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))
                    .onChange(of: page) { _, now in if now > 0 { loadReel() } }
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if reel != nil && pages.count > 1 {
                    Text("\(min(page, pages.count - 1) + 1) / \(pages.count)")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 7).padding(.vertical, 1)
                        .background(.black.opacity(0.55), in: Capsule())
                        .padding(8)
                        .allowsHitTesting(false)
                }
            }
            .clipped()
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("garage.card.photo.\(vehicle.vehicle_id)")
    }

    // A fixed-size box is the sizer and the image an overlay that fills and clips (BuildStoryHero.pager).
    private func pagePhoto(_ url: String) -> some View {
        Color(.secondarySystemFill)
            .overlay {
                CachedAsyncImage(url: NukeImage.thumb(url, width: 800)) { image in
                    image.resizable().scaledToFill()
                } placeholder: { Color(.tertiarySystemFill) }
            }
            .clipped()
            .contentShape(Rectangle())
    }

    private func loadReel() {
        guard !reelAsked, vehicle.image_url?.isEmpty == false else { return }
        reelAsked = true
        Task {
            let rows = await GarageCardReads.reel(vehicle.vehicle_id)
            if let rows {
                reel = rows
                // The reel may hold only the cover; never leave the pager on a page that no longer exists.
                let count = GarageCardReads.pages(cover: vehicle.image_url, reel: rows).count
                if page >= count { page = max(0, count - 1) }
            } else {
                reelAsked = false
                page = 0
            }
        }
    }

    // MARK: Head, lane

    private var head: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(vehicle.title.isEmpty ? "Unknown vehicle" : vehicle.title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.primary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture(perform: onOpen)
                .accessibilityHint(Text("Opens the vehicle profile"))
            if let claim = header?.price {
                let label = header?.priceLabel ?? "Recorded price"
                Button {
                    if claim.rootStatus.isDrillable { drill = ClaimDrill(title: label, claim: claim, spec: nil) }
                } label: {
                    Text(ProfileHeaderBlock.money(claim))
                        .font(.system(size: 16, weight: .semibold).monospacedDigit())
                        .foregroundStyle(claim.rootStatus.valueColor)
                        .strikethrough(claim.rootStatus.strikethrough)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
                .fixedSize()
                .accessibilityLabel(Text("\(label), \(ProfileHeaderBlock.money(claim))"))
                .accessibilityHint(Text("Shows where this price comes from"))
            }
        }
    }

    private var laneItems: [String] {
        let day = GarageOrder.lastDay(vehicle, timeline: timeline)
        return GarageCardText.laneItems(relationship: GarageCardText.relationship(vehicle),
                                        active: GarageCardText.activeAgo(day, now: Date()),
                                        facets: header?.facets ?? [])
    }

    /// One line, most important first; what the width cannot hold drops off the end.
    private var lane: some View {
        let prefixes = GarageCardText.lanePrefixes(laneItems)
        return ViewThatFits(in: .horizontal) {
            ForEach(prefixes, id: \.count) { items in
                HStack(spacing: 14) {
                    ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                        Text(item).lineLimit(1).fixedSize(horizontal: items.count > 1, vertical: false)
                    }
                }
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, minHeight: 22, alignment: .leading)
    }

    // MARK: Grid, record, foot

    @ViewBuilder private var grid: some View {
        if timelineFailed {
            Text("Timeline unavailable")
                .font(.caption).foregroundStyle(.secondary)
                .padding(.vertical, 6)
        } else {
            let lit = pages.isEmpty ? nil : pages[min(page, pages.count - 1)].day
            GarageDayGrid(timeline: timeline, axis: axis, litDay: lit)
                .padding(.top, 8).padding(.bottom, 4)
        }
    }

    @ViewBuilder private var record: some View {
        let span = GarageCardText.span(timeline)
        let counts = GarageCardText.counts(timeline)
        if span != nil || !counts.isEmpty {
            // Wraps like the web's record line instead of cutting the last count.
            let spanText = Text(span ?? "").foregroundStyle(.primary)
            let countText = Text(counts.joined(separator: " · ")).foregroundStyle(.secondary)
            Text("\(spanText)\(span != nil && !counts.isEmpty ? "   " : "")\(countText)")
                .font(.caption.monospacedDigit())
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private var foot: some View {
        if let vin = vehicle.vin, !vin.isEmpty {
            Button {
                UIPasteboard.general.string = vin
                vinCopied = true
                Task { try? await Task.sleep(for: .seconds(1.5)); vinCopied = false }
            } label: {
                Text(vinCopied ? "Copied" : String(vin.prefix(17)))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
            .accessibilityLabel(Text("Copy VIN \(vin)"))
        } else {
            Text("No VIN recorded").font(.caption).foregroundStyle(.secondary).padding(.top, 4)
        }
    }
}

// MARK: The log book

/// vehicle_statements answers this; words show only to people tied to the car.
struct GarageStatements: Decodable {
    struct Row: Decodable, Identifiable {
        let statement_id: String?
        let speaker_role: String?
        let statement_kind: String?
        let said_on: String?
        let recorded_at: String?
        let words: String?
        var id: String { statement_id ?? "\(recorded_at ?? "")|\(words ?? "")" }

        /// "2026-11-20 · owner · assertion"
        var line: String {
            [said_on ?? recorded_at.map { String($0.prefix(10)) },
             speaker_role?.replacingOccurrences(of: "_", with: " "), statement_kind]
                .compactMap { $0 }.joined(separator: " · ")
        }
    }
    let statements: [Row]

    private enum CodingKeys: String, CodingKey { case statements }
    init(statements: [Row]) { self.statements = statements }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        statements = (try? c.decodeIfPresent([Row].self, forKey: .statements)) ?? []
    }

    /// The reader answers null for a vehicle the viewer cannot see; that is an empty book, not a failure.
    static func decode(_ data: Data) throws -> GarageStatements {
        let body = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        if body.isEmpty || body == "null" { return GarageStatements(statements: []) }
        return try JSONDecoder().decode(GarageStatements.self, from: data)
    }
}

/// The web's GarageCardActions LogBook: a note in the person's own words, kept whole with the date.
struct GarageLogBookView: View {
    let vehicle: GarageVehicle

    static let roles: [(String, String)] = [("owner", "Owner"), ("representative", "Representative"), ("shop", "Shop"),
                                            ("previous_owner", "Previous owner"), ("seller_agent", "Seller's agent")]
    static let kinds: [(String, String)] = [("assertion", "A fact"), ("recollection", "From memory"), ("estimate", "An estimate")]

    /// The role the note is said as, by default from the record's relationship (the web's rule).
    static func defaultRole(_ v: GarageVehicle) -> String {
        switch v.relationship {
        case "owner": return "owner"
        case "previously_owned": return "previous_owner"
        default: return "representative"
        }
    }

    @Environment(\.dismiss) private var dismiss
    @State private var rows: [GarageStatements.Row]?
    @State private var text = ""
    @State private var role: String
    @State private var kind = "assertion"
    @State private var busy = false
    @State private var notice: String?
    /// One key per draft, so a retry of the same note never stores it twice.
    @State private var requestId = UUID()

    init(vehicle: GarageVehicle) {
        self.vehicle = vehicle
        _role = State(initialValue: Self.defaultRole(vehicle))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("What happened, what you know, what needs fixing", text: $text, axis: .vertical)
                        .lineLimit(3...8)
                        .accessibilityIdentifier("garage.log.text")
                    Picker("Said as", selection: $role) {
                        ForEach(Self.roles, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    Picker("It is", selection: $kind) {
                        ForEach(Self.kinds, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    Button(busy ? "Saving…" : "Save note") { Task { await save() } }
                        .disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("garage.log.save")
                } footer: {
                    Text("Your own words about this car, kept whole with the date. A note is your claim: it never outranks a document or a photo, and only people tied to the car read it.")
                }
                if let notice {
                    Section { Text(notice).font(.footnote).foregroundStyle(.secondary) }
                }
                Section("Log book") {
                    if let rows {
                        if rows.isEmpty {
                            Text("No notes yet").font(.footnote).foregroundStyle(.secondary)
                        }
                        ForEach(rows) { row in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(row.line).font(.caption).foregroundStyle(.secondary)
                                if let words = row.words { Text(words).font(.callout) }
                            }
                        }
                    } else {
                        Text("Reading the log book…").font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle(vehicle.title.isEmpty ? "Log book" : vehicle.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await read() }
        }
    }

    private func read() async {
        do {
            let data = try await SupabaseService.client.rpc("vehicle_statements", params: ["p_vehicle_id": vehicle.vehicle_id]).execute().data
            rows = try GarageStatements.decode(data).statements
        } catch {
            NSLog("NukeCapture vehicle_statements failed: %@", String(describing: error))
            notice = "The log book could not be read."
            rows = []
        }
    }

    private struct Params: Encodable {
        let p_request_id: String
        let p_vehicle_id: String
        let p_statement: String
        let p_speaker_role: String
        let p_statement_kind: String
        let p_said_at_basis: String
        let p_recording_agent: String
        let p_said_at: String
    }

    private func save() async {
        let note = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !note.isEmpty, !busy else { return }
        busy = true; notice = nil
        let params = Params(p_request_id: requestId.uuidString.lowercased(), p_vehicle_id: vehicle.vehicle_id,
                            p_statement: note, p_speaker_role: role, p_statement_kind: kind,
                            p_said_at_basis: "typed into the garage log book at the recorded time",
                            p_recording_agent: "garage log book",
                            p_said_at: ISO8601DateFormatter().string(from: Date()))
        do {
            _ = try await SupabaseService.client.rpc("record_vehicle_statement", params: params).execute()
            requestId = UUID()
            text = ""
            notice = "Saved to this car’s log book."
            busy = false
            await read()
        } catch {
            busy = false
            notice = (error as? PostgrestError)?.message ?? "The note was not saved."
        }
    }
}
