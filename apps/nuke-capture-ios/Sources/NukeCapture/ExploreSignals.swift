// ExploreSignals.swift — what a person does with Explore cards, kept on the phone as a local log.
//
// One JSON object per line in Application Support/explore-signals.jsonl, the newest 5,000 kept. The
// events are the ordinary signals a feed has (a card was in view, how long, which page it reached,
// which photo, a press, a choice, a follow, a share). They are the raw material for recommendations;
// nothing in the app reads them back to rank anything yet.
//
// Upload is behind a flag that is off: UserDefaults bool "explore.signals.upload". When it is on, a
// signed-in session sends batches of at most 200 to the RPC `record_feed_signals(p_events jsonb)`.
// That function is drafted separately and may not be deployed: a failed send keeps the events and the
// next flush tries again. A signed-out session, and any fixture-backend run, never sends.

import Foundation
import Supabase

/// One signal. Field names are the wire names (snake_case) so a line in the file is the row the RPC takes.
struct ExploreSignalEvent: Codable, Equatable {
    enum Kind: String, Codable, Equatable {
        case impression, dwell, page, photo, press, choice, follow, share
        /// A Browse tuning change; `tuned` names the filters that changed, never their values.
        case tune
        case openListing = "open_listing"
        case openProfile = "open_profile"
        case commentOpen = "comment_open"
    }
    enum Choice: String, Codable, Equatable { case more, less, hide }

    let id: String
    /// ISO 8601, UTC.
    let at: String
    let sessionId: String
    /// The card's id in the feed ("ask:…" / "live:…").
    let itemId: String
    let vehicleId: String?
    let source: String
    let kind: Kind
    /// "photos", "location", "analytics" or "listing" (ExplorePageKind raw values).
    var pageKind: String? = nil
    var pageIndex: Int? = nil
    var photoIndex: Int? = nil
    var dwellMs: Int? = nil
    var choice: Choice? = nil
    /// The card's index in the feed when the event was made.
    var position: Int? = nil
    /// For kind "tune": comma-separated filter names (place, radius, era, make, price).
    var tuned: String? = nil

    private enum CodingKeys: String, CodingKey {
        case id, at, source, kind, choice, position, tuned
        case sessionId = "session_id"
        case itemId = "item_id"
        case vehicleId = "vehicle_id"
        case pageKind = "page_kind"
        case pageIndex = "page_index"
        case photoIndex = "photo_index"
        case dwellMs = "dwell_ms"
    }

    /// A new event stamped now, in this launch's session.
    static func make(_ kind: Kind, item: ExploreFeedItem, position: Int? = nil, now: Date = Date()) -> ExploreSignalEvent {
        ExploreSignalEvent(id: UUID().uuidString.lowercased(), at: now.formatted(.iso8601),
                           sessionId: ExploreSignalLog.sessionID, itemId: item.id,
                           vehicleId: item.vehicleId?.uuidString.lowercased(), source: item.source,
                           kind: kind, position: position)
    }

    /// A tuning change: no card, so the item id is the sheet's name.
    static func makeTune(_ fields: [String], now: Date = Date()) -> ExploreSignalEvent {
        ExploreSignalEvent(id: UUID().uuidString.lowercased(), at: now.formatted(.iso8601),
                           sessionId: ExploreSignalLog.sessionID, itemId: "browse-tuning", vehicleId: nil,
                           source: "explore", kind: .tune, tuned: fields.joined(separator: ","))
    }
}

actor ExploreSignalLog {
    static let shared = ExploreSignalLog()
    /// The newest events kept. The file is rewritten when it passes this by `trimSlack`, so a busy
    /// session does not rewrite it on every event.
    static let maxEvents = 5_000
    static let trimSlack = 250
    static let uploadBatch = 200
    static let uploadFlagKey = "explore.signals.upload"
    /// One id per app launch, carried on every event.
    static let sessionID = UUID().uuidString.lowercased()

    private struct Stored { let id: String; let line: String }

    private let fileURL: URL?
    private var stored: [Stored]?
    private var uploading = false

    init(fileURL: URL? = ExploreSignalLog.defaultFileURL()) {
        self.fileURL = fileURL
    }

    static func defaultFileURL() -> URL? {
        guard let dir = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                     appropriateFor: nil, create: true) else { return nil }
        return dir.appendingPathComponent("explore-signals.jsonl")
    }

    // MARK: Pure pieces (unit-tested)

    /// One event as one line of JSON (keys sorted, absent fields left out), nil if it cannot be encoded.
    static func encode(_ event: ExploreSignalEvent) -> String? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(event) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func decode(_ line: String) -> ExploreSignalEvent? {
        try? JSONDecoder().decode(ExploreSignalEvent.self, from: Data(line.utf8))
    }

    /// The newest `keep` items, order kept.
    static func trimmed<T>(_ items: [T], keep: Int) -> [T] {
        guard keep >= 0, items.count > keep else { return items }
        return Array(items.suffix(keep))
    }

    /// True only when the writer's answer says ok:true.
    static func accepted(_ data: Data) -> Bool {
        struct Answer: Decodable { let ok: Bool? }
        return (try? JSONDecoder().decode(Answer.self, from: data))?.ok == true
    }

    // MARK: Log

    func append(_ event: ExploreSignalEvent) {
        guard let line = Self.encode(event) else { return }
        var all = load()
        all.append(Stored(id: event.id, line: line))
        if all.count >= Self.maxEvents + Self.trimSlack {
            all = Self.trimmed(all, keep: Self.maxEvents)
            stored = all
            rewrite()
        } else {
            stored = all
            appendToFile(line)
        }
    }

    /// Every event kept, oldest first.
    func events() -> [ExploreSignalEvent] {
        load().compactMap { Self.decode($0.line) }
    }

    var count: Int { load().count }

    private func load() -> [Stored] {
        if let stored { return stored }
        var out: [Stored] = []
        if let fileURL, let data = try? Data(contentsOf: fileURL), let text = String(data: data, encoding: .utf8) {
            for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
                if let e = Self.decode(String(line)) { out.append(Stored(id: e.id, line: String(line))) }
            }
        }
        out = Self.trimmed(out, keep: Self.maxEvents)
        stored = out
        return out
    }

    private func appendToFile(_ line: String) {
        guard let fileURL else { return }
        let data = Data((line + "\n").utf8)
        if !FileManager.default.fileExists(atPath: fileURL.path) {
            FileManager.default.createFile(atPath: fileURL.path, contents: data)
            return
        }
        guard let handle = try? FileHandle(forWritingTo: fileURL) else { return }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: data)
        try? handle.close()
    }

    private func rewrite() {
        guard let fileURL else { return }
        let text = (stored ?? []).map { $0.line + "\n" }.joined()
        try? Data(text.utf8).write(to: fileURL, options: .atomic)
    }

    // MARK: Upload (off by default)

    private struct Params: Encodable { let p_events: [ExploreSignalEvent] }

    /// Sends up to 200 events when the flag is on and someone is signed in; the events leave the file only
    /// after the RPC answers. Any failure keeps them for the next flush.
    func flushIfEnabled(defaults: UserDefaults = .standard) async {
        guard defaults.bool(forKey: Self.uploadFlagKey), !uploading else { return }
        #if DEBUG
        if FixtureBackend.isActive { return }
        #endif
        guard SupabaseService.currentUserId != nil else { return }
        let batch = Array(load().prefix(Self.uploadBatch))
        let events = batch.compactMap { Self.decode($0.line) }
        guard !events.isEmpty else { return }
        uploading = true
        defer { uploading = false }
        do {
            // The drafted writer answers {"ok":false,...} for a refused batch instead of raising, so only an
            // explicit ok:true removes events from the file.
            let data = try await SupabaseService.client
                .rpc("record_feed_signals", params: Params(p_events: events))
                .execute().data
            guard Self.accepted(data) else {
                NSLog("NukeCapture explore signals refused: %@", String(data: data, encoding: .utf8) ?? "")
                return
            }
            let sent = Set(batch.map(\.id))
            stored = load().filter { !sent.contains($0.id) }
            rewrite()
        } catch {
            NSLog("NukeCapture explore signals not sent: %@", String(describing: error))
        }
    }
}
