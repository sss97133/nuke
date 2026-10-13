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
    /// The expected-price band (positions 12 to 16) from comparable BaT sales on the lot's model
    /// page (scripts/market/live-bands.mjs), present only when p10, p50 and p90 all came, as
    /// useMarketPulse.ts maps it. The web renders it inside the heat reading, not as a graded
    /// band on the row; the phone does the same.
    struct Band { let p10: Double; let p50: Double; let p90: Double; let tier: String; let comps: Int }
    let band: Band?

    /// One row is a positional array; a value whose type drifted is read as missing, never
    /// as a reason to drop the whole board (the web coerces with Number()).
    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        // Each helper consumes exactly one position. A null is consumed by decodeNil; a value of
        // the wrong type is consumed by AnyScalar. (The first version used decodeIfPresent under
        // `try?`, whose flattened nil could not tell "null" from "threw", so a null was consumed
        // twice and every field after it shifted one place: a lot with no image URL read its
        // listing URL as its title and its band one position off. Caught by the band test, 2026-10-13.)
        func str() -> String? {
            if (try? c.decodeNil()) == true { return nil }
            if let s = try? c.decode(String.self) { return s }
            _ = try? c.decode(AnyScalar.self); return nil
        }
        func num() -> Double? {
            if (try? c.decodeNil()) == true { return nil }
            if let d = try? c.decode(Double.self) { return d }
            if let s = try? c.decode(String.self) { return Double(s) }
            _ = try? c.decode(AnyScalar.self); return nil
        }
        func int() -> Int? { num().map { Int($0) } }
        func bool() -> Bool {
            if (try? c.decodeNil()) == true { return false }
            if let b = try? c.decode(Bool.self) { return b }
            _ = try? c.decode(AnyScalar.self); return false
        }
        id = try c.decode(String.self)
        year = int()
        make = str()
        model = str()
        currentBid = num()
        endsAt = str()
        updatedAt = str()
        listedAt = str()
        imageUrl = str()
        noReserve = bool()
        listingUrl = str()
        title = str()
        let p10 = num(), p50 = num(), p90 = num(), tier = str(), comps = int()
        if let p10, let p50, let p90 { band = Band(p10: p10, p50: p50, p90: p90, tier: tier ?? "", comps: comps ?? 0) } else { band = nil }
        endsAtDate = ProfileClock.date(endsAt)
    }

    // ─── Hot / cold: the bid against where comparable sales usually sit at this point in the
    // auction, exactly MarketPulse.tsx heatOf (#1064): the curve gives, per price tier, the median
    // share of the final price that sold cars had been bid to with this many hours left; typical
    // now = band p50 × that share; hot at 1.25× typical or more, cold at 0.8× or less; past 120 h
    // the curve rests on thin early data, so no verdict. The track record of lots tagged this way
    // is typed into the web page today, not carried by any read; the phone shows the tag and the
    // reading and leaves that sentence until a read carries it (market lane, 2026-10-13).
    struct Heat {
        enum State { case hot, cold, inLine }
        let ratio: Double, state: State, typicalNow: Double, share: Double, hoursLeft: Double
    }
    static let heatMaxHours = 120.0, hotAt = 1.25, coldAt = 0.8

    func heat(curve: BidCurve?, at now: Date) -> Heat? {
        guard let curve, let band, let bid = currentBid, bid.isFinite, bid > 0, let ends = endsAtDate else { return nil }
        let hoursLeft = ends.timeIntervalSince(now) / 3600
        guard hoursLeft > 0, hoursLeft <= Self.heatMaxHours else { return nil }
        guard let share = curve.share(tier: band.tier, hours: hoursLeft), share > 0, band.p50 > 0 else { return nil }
        let typical = band.p50 * share
        let ratio = bid / typical
        return Heat(ratio: ratio, state: ratio >= Self.hotAt ? .hot : ratio <= Self.coldAt ? .cold : .inLine,
                    typicalNow: typical, share: share, hoursLeft: hoursLeft)
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
/// Per price tier, [hours left, median share of the final price bid by then], hours descending.
/// Measured on 36,700 BaT sales (migration 20260927230000). A malformed curve reads as absent.
struct BidCurve: Decodable {
    let tiers: [String: [[Double]]]
    init(from decoder: Decoder) throws {
        tiers = (try? decoder.singleValueContainer().decode([String: [[Double]]].self)) ?? [:]
    }
    /// The web's curveAt: clamp to the measured hours, interpolate between the two marks around it.
    func share(tier: String, hours: Double) -> Double? {
        guard let pts = tiers[tier], !pts.isEmpty, pts.allSatisfy({ $0.count >= 2 }) else { return nil }
        let h = max(pts[pts.count - 1][0], min(pts[0][0], hours))
        for i in 0..<(pts.count - 1) {
            let (h1, v1, h2, v2) = (pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
            if h <= h1, h >= h2, h1 != h2 { return v1 + ((v2 - v1) * (h1 - h)) / (h1 - h2) }
        }
        return pts[pts.count - 1][1]
    }
}

/// The board a week ago (BAT-LIVE-BIDS index reading): bids across the board and the lot count
/// at that hour, from the live reading or rebuilt from BaT bid history ("archive").
struct WeekAgo: Decodable {
    let at: String?, bids: Double?, n: Int?, source: String?
    private enum K: String, CodingKey { case at, bids, n, source }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        at = try? c.decodeIfPresent(String.self, forKey: .at)
        bids = (try? c.decodeIfPresent(Double.self, forKey: .bids)) ?? nil
        n = (try? c.decodeIfPresent(Int.self, forKey: .n)) ?? nil
        source = try? c.decodeIfPresent(String.self, forKey: .source)
    }
}
struct Baseline: Decodable {
    let week_ago: WeekAgo?
    private enum K: String, CodingKey { case week_ago }
    init(from decoder: Decoder) throws {
        week_ago = (try? decoder.container(keyedBy: K.self).decodeIfPresent(WeekAgo.self, forKey: .week_ago)) ?? nil
    }
}

struct LiveBoard: Decodable {
    let synced_at: String?
    let source: String?
    private let rows: LossyArray<LiveAuction>
    let curve: BidCurve?
    let baseline: Baseline?
    var auctions: [LiveAuction] { rows.elements }
    var skippedRows: Int { rows.skipped }
    var weekAgo: WeekAgo? { baseline?.week_ago.flatMap { $0.bids == nil ? nil : $0 } }

    private enum CodingKeys: String, CodingKey { case synced_at, source, rows = "auctions", curve, baseline }

    /// `synced_at` is max(vehicles.updated_at) over live rows: the last record write by any
    /// writer, not the source read time (which the board does not carry). The web says both;
    /// so does the phone, and warns when that write clock is more than 45 minutes behind.
    var syncedAtDate: Date? { ProfileClock.date(synced_at) }
    static let staleAfter: TimeInterval = 45 * 60

    /// Lots still open at `now`, the web's count (`endsAt > now`): a lot that closed since the
    /// last poll is not an open lot, and neither is one with no recorded end time (the web's
    /// `Date.parse(null) > now` is false).
    func open(at now: Date) -> [LiveAuction] {
        auctions.filter { lot in
            guard let end = lot.endsAtDate else { return false }
            return end > now
        }
    }

    /// The population line (fleet-relative reporting): how many open lots, the record clock
    /// and what it is, the source read time's absence, and a lag warning when it applies.
    func coverageSentence(at now: Date) -> String {
        let clock = syncedAtDate.map { d -> String in
            let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "UTC")
            f.dateFormat = "MMM d, HH:mm"
            return f.string(from: d) + "Z"
        } ?? "clock missing"
        var parts = ["\(open(at: now).count.formatted()) open lots",
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

    /// The web's head line: the board's current bids against the same hour a week ago, only on
    /// the whole board (the baseline is board-wide), "≈" when the week-ago reading was rebuilt.
    private var weekAgoLine: String? {
        guard filterMake == nil, let board, let wk = board.weekAgo, let before = wk.bids, before > 0 else { return nil }
        let nowBids = openLots.reduce(0.0) { $0 + ($1.currentBid ?? 0) }
        let pct = (nowBids - before) / before * 100
        let signed = (pct >= 0 ? "+" : "") + LedgerMap.oneDecimal(pct) + "%"
        return "vs same time last week \(wk.source == "archive" ? "≈" : "")\(signed) from \(Self.bidNumber(before, compact: true))"
    }

    /// The web's bidNumber: BaT runs every auction in US dollars and reports the bid as one (#1061).
    static func bidNumber(_ n: Double?, compact: Bool = false) -> String {
        guard let n, n.isFinite else { return "—" }
        if compact, abs(n) >= 1_000_000 { return "$" + LedgerMap.oneDecimal(n / 1_000_000) + "M" }
        if compact, abs(n) >= 10_000 { return "$\(Int((n / 1_000).rounded()))K" }
        return "$" + Int(n.rounded()).formatted()
    }
    /// Three significant figures: about $166,000, not $166,323.
    static func about(_ n: Double) -> Double {
        let step = pow(10.0, max(0, floor(log10(max(n, 1))) - 2))
        return (n / step).rounded() * step
    }
    /// Past 3× the comps mostly do not describe the car, so it reads as 3×+ rather than a precise number.
    static func multiple(_ ratio: Double) -> String {
        ratio >= 3 ? "3×+" : ratio < 0.1 ? "<0.1×" : LedgerMap.oneDecimal(ratio) + "×"
    }

    @State private var reading: LiveAuction?

    var body: some View {
        Group {
            if let board {
                List {
                    // The Market tab's first section on the web: the ledger as a map (every record
                    // with a recorded price), the open board below it.
                    Section {
                        LedgerMapView()
                            .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 4, trailing: 12))
                            .listRowBackground(Color.clear)
                    }
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
                        if let w = weekAgoLine {
                            Text(w).font(.caption2.monospaced()).foregroundStyle(.secondary)
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
                        Text("Bring a Trailer runs every auction in US dollars; bids are as the board recorded them. Running hot or cold compares the bid with the typical bid at this point in the auction for cars priced like its comparable sales; tap the tag for the reading. The record clock is the last write to the row, not the source read time.")
                    }
                }
                .listStyle(.plain)
                .sheet(item: $reading) { lot in
                    if let heat = lot.heat(curve: board.curve, at: now) { HeatReadingSheet(lot: lot, heat: heat, now: now) }
                }
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
            #if DEBUG
            // Screenshot loop: NUKE_DEBUG_LIVE_READING=1 opens the reading of the first lot running
            // hot or cold once the board lands (DEBUG only, never ships).
            if ProcessInfo.processInfo.environment["NUKE_DEBUG_LIVE_READING"] == "1", reading == nil,
               let first = lots.first(where: { ($0.heat(curve: board?.curve, at: now)?.state ?? .inLine) != .inLine }) {
                reading = first
            }
            #endif
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
                    // The web's bidNumber: dollars, as BaT reports every bid (#1061).
                    if let bid = lot.currentBid, bid.isFinite {
                        Text(Self.bidNumber(bid))
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
                // The web's HeatTag: shown only when the reading is hot or cold, the reasoning one tap away.
                if let heat = lot.heat(curve: board?.curve, at: now), heat.state != .inLine {
                    Button {
                        reading = lot
                    } label: {
                        Text((heat.state == .hot ? "Running hot" : "Running cold") + " · " + Self.multiple(heat.ratio))
                            .font(.caption2.monospaced().weight(.semibold))
                            .foregroundStyle(heat.state == .hot ? Color.orange : Color.teal)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Why \(lot.headline) is running \(heat.state == .hot ? "hot" : "cold")")
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

/// The reasoning behind a heat tag, the rows the web's HeatTag popover shows: the bid, the comps,
/// their middle, the typical bid at this point in the auction, the multiple. The track record
/// sentence waits for a read that carries it.
struct HeatReadingSheet: View {
    let lot: LiveAuction
    let heat: LiveAuction.Heat
    let now: Date
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("The reading") {
                    line("Current bid", "\(LiveBoardView.bidNumber(lot.currentBid)) · \(lot.endsAtDate.map { LiveBoardView.remaining($0, now: now) } ?? "close unknown")")
                    if let b = lot.band {
                        line("Comparable sales", "\(b.comps.formatted()) on its BaT model page, weighted toward the same version, year, mileage and gearbox")
                        line("Their middle", "\(LiveBoardView.bidNumber(b.p50)) (80% range \(LiveBoardView.bidNumber(b.p10))–\(LiveBoardView.bidNumber(b.p90)))")
                    }
                    line("Typical bid now", "about \(LiveBoardView.bidNumber(LiveBoardView.about(heat.typicalNow))): with this much time left, cars at this price are usually bid to about \(Int((heat.share * 100).rounded()))% of their final")
                    line("This bid", "\(LiveBoardView.multiple(heat.ratio)) typical")
                }
                if let b = lot.band, let bid = lot.currentBid, bid > b.p90 {
                    Section {
                        Text("The bid already tops 90% of those sales: this car is bringing more than its model page usually does (a rarer version, very low miles, or prices that have risen since).")
                            .font(.footnote)
                    }
                }
                Section {
                    Text("Hot is 1.25× the typical bid or more; cold is 0.8× or less. The curve is the median share of the final price bid at each hours-left mark, per price tier, over 36,700 BaT sales; past 120 hours left there is no verdict. How lots tagged this way finished is shown on nuke.ag from a table typed into its page; it joins here when a read carries it.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .navigationTitle((heat.state == .hot ? "Running hot · " : "Running cold · ") + lot.headline)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func line(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased()).font(.caption2.monospaced()).foregroundStyle(.secondary)
            Text(value).font(.footnote)
        }
        .padding(.vertical, 2)
    }
}
