// LiveBoard.swift — the open board, read from the same door as the web Market tab.
//
// nuke.ag's Market tab stands on `market_pulse_live()` for open lots: one call, the whole board,
// with the clock it was read at (`synced_at`) and the sentence naming its source. The rows are
// compact positional arrays (supabase/migrations/20260927193000_market_pulse_live_board.sql);
// nuke_frontend/src/pages/market/useMarketPulse.ts is the web's decoder and this file keeps the
// same positions. The phone shows the board as a list that ends soonest first, with the count,
// the source and the clock above it, so "one spot for listings" (owner anchor O15) is one spot
// on the phone too: the same population, the same clock, nothing invented in between.

import SwiftUI
import Supabase

/// One open lot, as the board returns it.
struct LiveAuction: Decodable, Identifiable {
    let id: String
    let year: Int?
    let make: String?
    let model: String?
    let currentBid: Double?
    let endsAt: String?
    let updatedAt: String?
    let listedAt: String?
    let imageUrl: String?
    let noReserve: Bool
    let listingUrl: String?
    let title: String?
    /// Expected-price band from comparable sales on the lot's model page; nil when the lot is not priced.
    /// Parsed once at decode time: the list sorts on it, and parsing an ISO string per
    /// comparison cost about 100 ms of main thread per evaluation over 1,100 lots.
    let endsAtDate: Date?
    /// The expected-price band (positions 12 to 16) is decoded on the web and rendered
    /// nowhere; the phone does not read it either. Owner call before a graded band shows.

    /// One row is a positional array; a value whose type drifted is read as missing, never
    /// as a reason to drop the whole board (the web coerces with Number()).
    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        func str() -> String? { (try? c.decodeIfPresent(String.self)) ?? { _ = try? c.decode(AnyScalar.self); return nil }() }
        func num() -> Double? {
            if let d = try? c.decodeIfPresent(Double.self) { return d }
            if let s = try? c.decodeIfPresent(String.self) { return Double(s) }
            _ = try? c.decode(AnyScalar.self); return nil
        }
        func int() -> Int? { num().map { Int($0) } }
        id = try c.decode(String.self)
        year = int()
        make = str()
        model = str()
        currentBid = num()
        endsAt = str()
        updatedAt = str()
        listedAt = str()
        imageUrl = str()
        noReserve = (try? c.decodeIfPresent(Bool.self)) ?? false
        listingUrl = str()
        title = str()
        endsAtDate = ProfileClock.date(endsAt)
    }

    /// Only a row with a real vehicle id can navigate; a malformed id is skipped, never replaced by a random one.
    var vehicleUUID: UUID? { UUID(uuidString: id) }

    /// The listing's own title, else the identity the board carries. BaT publishes titles
    /// with HTML entities ("Chairs &#038; Flares"); the few that occur are decoded here.
    var headline: String {
        if let t = title, !t.isEmpty { return Self.decodeEntities(t) }
        return [year.map(String.init), make, model].compactMap { $0 }.joined(separator: " ")
    }

    static func decodeEntities(_ s: String) -> String {
        guard s.contains("&") else { return s }
        var out = s
        for (code, ch) in [("&#038;", "&"), ("&amp;", "&"), ("&#8217;", "\u{2019}"), ("&#8216;", "\u{2018}"),
                           ("&#8220;", "\u{201C}"), ("&#8221;", "\u{201D}"), ("&quot;", "\""), ("&#039;", "'"),
                           ("&lt;", "<"), ("&gt;", ">"), ("&#8211;", "\u{2013}"), ("&#8212;", "\u{2014}")] {
            out = out.replacingOccurrences(of: code, with: ch)
        }
        return out
    }
}

/// A scalar of any JSON type, consumed and discarded when a positional value is not what the row promised.
struct AnyScalar: Decodable {
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { return }
        if (try? c.decode(Double.self)) != nil { return }
        if (try? c.decode(String.self)) != nil { return }
        if (try? c.decode(Bool.self)) != nil { return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "not a scalar")
    }
}

/// An array whose undecodable elements are skipped and counted instead of failing the whole array.
struct LossyArray<Element: Decodable>: Decodable {
    let elements: [Element]
    let skipped: Int
    private struct Any_: Decodable { init(from decoder: Decoder) throws {} }
    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        var out: [Element] = []
        var bad = 0
        while !c.isAtEnd {
            if let e = try? c.decode(Element.self) { out.append(e) } else { _ = try? c.decode(Any_.self); bad += 1 }
        }
        elements = out; skipped = bad
    }
}

/// The board: its clock, its source sentence and its lots.
struct LiveBoard: Decodable {
    let synced_at: String?
    let source: String?
    private let rows: LossyArray<LiveAuction>
    var auctions: [LiveAuction] { rows.elements }
    var skippedRows: Int { rows.skipped }

    private enum CodingKeys: String, CodingKey { case synced_at, source, rows = "auctions" }

    /// `synced_at` is max(vehicles.updated_at) over live rows: the last record write by any
    /// writer, not the source read time (which the board does not carry). The web says both;
    /// so does the phone, and warns when that write clock is more than 45 minutes behind.
    var syncedAtDate: Date? { ProfileClock.date(synced_at) }
    static let staleAfter: TimeInterval = 45 * 60

    /// Lots still open at `now`, the web's count (`endsAt > now`); a lot that closed since the
    /// last poll is not an open lot.
    func open(at now: Date) -> [LiveAuction] {
        auctions.filter { ($0.endsAtDate ?? .distantFuture) > now }
    }

    /// The population line (fleet-relative reporting): how many open lots, the record clock
    /// and what it is, the source read time's absence, and a lag warning when it applies.
    func coverageSentence(at now: Date) -> String {
        let clock = syncedAtDate.map { d -> String in
            let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "UTC")
            f.dateFormat = "MMM d, HH:mm"
            return f.string(from: d) + "Z"
        } ?? "clock missing"
        var parts = ["\(open(at: now).count.formatted()) open lots · source bid units unverified",
                     "record updated \(clock) by a writer · source read time unavailable"]
        if let d = syncedAtDate, now.timeIntervalSince(d) > Self.staleAfter { parts.append("recent record writes are behind") }
        if skippedRows > 0 { parts.append("\(skippedRows) rows unreadable, skipped") }
        return parts.joined(separator: " · ")
    }

    // One read per 30 seconds across lens switches, as the web caches it (useMarketPulse staleTime).
    private static var cached: (board: LiveBoard, at: Date)?
    static func fetch(maxAge: TimeInterval = 30) async throws -> LiveBoard {
        if let c = cached, Date().timeIntervalSince(c.at) < maxAge { return c.board }
        let board: LiveBoard = try await SupabaseService.client.rpc("market_pulse_live").execute().value
        cached = (board, Date())
        return board
    }
}

/// The board as a list ending soonest first, refetched every minute as on the web.
struct LiveBoardView: View {
    @State private var board: LiveBoard?
    @State private var loadError = false
    // The map's selection narrows the list to one brand, then one decade: one population, one
    // filter, never a second read. The web Market tab's mapFocus/mapChild do the same.
    @State private var filterMake: String? = {
        #if DEBUG
        if let m = ProcessInfo.processInfo.environment["NUKE_DEBUG_LIVE_MAKE"], !m.isEmpty { return m }
        #endif
        return nil
    }()
    @State private var filterDecade: String? = nil

    /// The clock the board is read against; set when a read lands so one evaluation shares it.
    @State private var now = Date()

    /// The web's population: lots still open now (`endsAt > now`), ending soonest first.
    private var openLots: [LiveAuction] { board?.open(at: now) ?? [] }

    private var lots: [LiveAuction] {
        openLots
            .filter { filterMake == nil || LiveInventory.make($0) == filterMake }
            .filter { filterDecade == nil || LiveInventory.decade($0) == filterDecade }
            .sorted { ($0.endsAtDate ?? .distantFuture) < ($1.endsAtDate ?? .distantFuture) }
    }

    private var filterLine: String? {
        guard let m = filterMake else { return nil }
        return [m, filterDecade].compactMap { $0 }.joined(separator: " · ") + " · \(lots.count.formatted()) of \(openLots.count.formatted()) open lots"
    }

    var body: some View {
        Group {
            if let board {
                List {
                    // The board drawn as the web draws it: brands as boxes, decades inside.
                    Section {
                        LiveInventoryMapView(lots: openLots) { make, decade in
                            filterMake = make; filterDecade = decade
                        }
                        .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
                        .listRowBackground(Color.clear)
                        if let f = filterLine {
                            HStack(spacing: 8) {
                                Text(f).font(.caption2.monospaced()).foregroundStyle(.secondary).lineLimit(1)
                                Spacer(minLength: 0)
                                Button("All") { filterMake = nil; filterDecade = nil }.font(.caption2)
                            }
                            .listRowBackground(Color.clear)
                        }
                    } header: {
                        Text(board.coverageSentence(at: now))
                            .font(.caption2.monospaced())
                            .textCase(nil)
                    }
                    Section {
                        ForEach(lots) { lot in
                            if let uuid = lot.vehicleUUID {
                                NavigationLink(value: VehicleHeaderRow(id: uuid, year: lot.year, make: lot.make,
                                                                       model: lot.model, trim: nil, primary_image_url: lot.imageUrl,
                                                                       city: nil, state: nil)) {
                                    row(lot)
                                }
                            } else {
                                row(lot)   // a row without a readable vehicle id opens nothing, never a random record
                            }
                        }
                    } header: {
                        Text(filterMake == nil ? "Ending soonest" : "Ending soonest in the selection")
                            .font(.caption2.monospaced())
                            .textCase(nil)
                    } footer: {
                        Text("Bids as the board recorded them, in the source's units, which the reader does not verify. The record clock is the last write to the row, not the source read time.")
                    }
                }
                .listStyle(.plain)
            } else if loadError {
                ContentUnavailableView {
                    Label("Couldn't read the board", systemImage: "wifi.exclamationmark")
                } description: {
                    Text("Check your connection.")
                } actions: {
                    Button("Retry") { Task { await load() } }.buttonStyle(.borderedProminent)
                }
            } else {
                VStack(spacing: 10) {
                    ProgressView()
                    Text("Reading the open board…")
                        .font(.system(.footnote, design: .monospaced)).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(60))
            }
        }
    }

    /// One read of the board. A failed refresh never wipes a board already on screen.
    private func load() async {
        do {
            board = try await LiveBoard.fetch()
            now = Date()
            loadError = false
        } catch {
            if board == nil { loadError = true }
            NSLog("NukeCapture live board read failed: %@", String(describing: error))
        }
    }

    @ViewBuilder private func row(_ lot: LiveAuction) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Color(.secondarySystemFill)
                .frame(width: 64, height: 48)
                .overlay {
                    CachedAsyncImage(url: NukeImage.thumb(lot.imageUrl, width: 200)) { i in
                        i.resizable().scaledToFill()
                    } placeholder: { Image(systemName: "car.side").foregroundStyle(.secondary) }
                }
                .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 3) {
                Text(lot.headline).font(.subheadline.weight(.semibold)).lineLimit(2)
                HStack(spacing: 8) {
                    // The web's bidNumber: a bare number, no currency sign, under "bid units unverified".
                    if let bid = lot.currentBid, bid.isFinite {
                        Text(Int(bid.rounded()).formatted())
                            .font(.system(.footnote, design: .monospaced).weight(.semibold)).monospacedDigit()
                        Text("bid").font(.caption2.monospaced()).foregroundStyle(.secondary)
                    } else {
                        Text("no bid recorded").font(.caption2.monospaced()).foregroundStyle(.secondary)
                    }
                    if lot.noReserve {
                        Text("NO RESERVE").font(.caption2.monospaced().weight(.semibold)).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    if let ends = lot.endsAtDate {
                        TimelineView(.periodic(from: .now, by: 30)) { ctx in
                            Text(Self.remaining(ends, now: ctx.date))
                                .font(.caption2.monospaced()).monospacedDigit()
                                .foregroundStyle(ends.timeIntervalSince(ctx.date) < 3600 ? .red : .secondary)
                        }
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    static func remaining(_ ends: Date, now: Date) -> String {
        let s = Int(ends.timeIntervalSince(now))
        if s <= 0 { return "closing" }
        if s < 3600 { return "\(s / 60)m left" }
        if s < 86_400 { return "\(s / 3600)h \((s % 3600) / 60)m left" }
        return "\(s / 86_400)d \((s % 86_400) / 3600)h left"
    }
}
