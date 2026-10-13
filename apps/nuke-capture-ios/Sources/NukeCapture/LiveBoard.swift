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
    let band: Band?

    struct Band {
        let p10: Double
        let p50: Double
        let p90: Double
        let tier: String
        let comps: Int
    }

    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        id = try c.decode(String.self)
        year = try c.decodeIfPresent(Int.self)
        make = try c.decodeIfPresent(String.self)
        model = try c.decodeIfPresent(String.self)
        currentBid = try c.decodeIfPresent(Double.self)
        endsAt = try c.decodeIfPresent(String.self)
        updatedAt = try c.decodeIfPresent(String.self)
        listedAt = try c.decodeIfPresent(String.self)
        imageUrl = try c.decodeIfPresent(String.self)
        noReserve = (try c.decodeIfPresent(Bool.self)) ?? false
        listingUrl = try c.decodeIfPresent(String.self)
        title = try c.decodeIfPresent(String.self)
        let p10 = try c.decodeIfPresent(Double.self)
        let p50 = try c.decodeIfPresent(Double.self)
        let p90 = try c.decodeIfPresent(Double.self)
        let tier = try c.decodeIfPresent(String.self)
        let comps = try c.decodeIfPresent(Int.self)
        if let p10, let p50, let p90 {
            band = Band(p10: p10, p50: p50, p90: p90, tier: tier ?? "", comps: comps ?? 0)
        } else {
            band = nil
        }
    }

    var endsAtDate: Date? { ProfileClock.date(endsAt) }

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

/// The board: its clock, its source sentence and its lots.
struct LiveBoard: Decodable {
    let synced_at: String?
    let source: String?
    let auctions: [LiveAuction]

    /// The population line (fleet-relative reporting): how many open lots, whose page, read when.
    var coverageSentence: String {
        let clock = ProfileClock.date(synced_at).map { d -> String in
            let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "UTC")
            f.dateFormat = "MMM d, HH:mm"
            return f.string(from: d) + "Z"
        } ?? "clock missing"
        return "\(auctions.count.formatted()) open lots · recorded \(clock) · \(source ?? "source unnamed")"
    }

    static func fetch() async throws -> LiveBoard {
        try await SupabaseService.client.rpc("market_pulse_live").execute().value
    }
}

/// The board as a list ending soonest first, refetched every minute as on the web.
struct LiveBoardView: View {
    @State private var board: LiveBoard?
    @State private var loadError = false

    private var lots: [LiveAuction] {
        (board?.auctions ?? []).sorted { ($0.endsAtDate ?? .distantFuture) < ($1.endsAtDate ?? .distantFuture) }
    }

    var body: some View {
        Group {
            if let board {
                List {
                    Section {
                        ForEach(lots) { lot in
                            NavigationLink(value: VehicleHeaderRow(id: UUID(uuidString: lot.id) ?? UUID(), year: lot.year, make: lot.make,
                                                                   model: lot.model, trim: nil, primary_image_url: lot.imageUrl,
                                                                   city: nil, state: nil)) {
                                row(lot)
                            }
                        }
                    } header: {
                        Text(board.coverageSentence)
                            .font(.system(size: 9, design: .monospaced))
                            .textCase(nil)
                    } footer: {
                        Text("Current bids as the board recorded them; a band is the expected hammer from comparable sales on the lot's model page and shows only when the lot is priced.")
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
                    if let bid = lot.currentBid {
                        Text(bid.formatted(.currency(code: "USD").precision(.fractionLength(0))))
                            .font(.system(.footnote, design: .monospaced).weight(.semibold)).monospacedDigit()
                        Text("bid").font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
                    } else {
                        Text("no bid recorded").font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
                    }
                    if lot.noReserve {
                        Text("NO RESERVE").font(.system(size: 9, weight: .semibold, design: .monospaced)).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    if let ends = lot.endsAtDate {
                        TimelineView(.periodic(from: .now, by: 30)) { ctx in
                            Text(Self.remaining(ends, now: ctx.date))
                                .font(.system(size: 10, design: .monospaced)).monospacedDigit()
                                .foregroundStyle(ends.timeIntervalSince(ctx.date) < 3600 ? .red : .secondary)
                        }
                    }
                }
                if let b = lot.band {
                    Text("expected \(Self.k(b.p10)) – \(Self.k(b.p90)) · mid \(Self.k(b.p50)) · \(b.comps) comps")
                        .font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private static func k(_ v: Double) -> String {
        v >= 1000 ? "$\((v / 1000).formatted(.number.precision(.fractionLength(v < 10_000 ? 1 : 0))))k"
                  : v.formatted(.currency(code: "USD").precision(.fractionLength(0)))
    }

    static func remaining(_ ends: Date, now: Date) -> String {
        let s = Int(ends.timeIntervalSince(now))
        if s <= 0 { return "closing" }
        if s < 3600 { return "\(s / 60)m left" }
        if s < 86_400 { return "\(s / 3600)h \((s % 3600) / 60)m left" }
        return "\(s / 86_400)d \((s % 86_400) / 3600)h left"
    }
}
