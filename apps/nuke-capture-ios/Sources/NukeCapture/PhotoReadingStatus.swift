// PhotoReadingStatus.swift — the phone's end of the photo reading status (migration 20261113170000).
//
// THE ONE FILE that knows the reader's name (`photo_reading_status`) and the keys it returns.
// The server decides whether photo reading is moving, stalled, waiting or off, and writes the
// headline, the reasons and the detail lines as finished sentences, so the phone and the website
// cannot disagree. The phone shows those sentences as given: it never rewords them, never does
// arithmetic on the counts, and never shows a state word or a key name.
//
// The answer is one object, or null when the server has no reading for the caller; on an older
// server the function does not exist and the call fails. All three mean "no reading", and every
// surface then stays exactly as it was before this file existed.

import Foundation
import Supabase

// MARK: - The payload

/// What `photo_reading_status` returns. Every field is optional: a missing key, a null or a value
/// of the wrong shape leaves that one field empty and never costs the rest.
struct PhotoReadingStatus: Equatable {
    /// When the server worked this out.
    var as_of: String?
    /// "moving", "stalled", "idle" or "off". Read through `PhotoReadingTone`, never shown.
    var state: String?
    /// A short plain sentence fragment, such as "Reading your photos".
    var headline: String?
    /// One short line for the collapsed bar; when reading has stalled it is the first reason.
    var summary: String?
    /// Why reading has stalled, in plain sentences. Empty unless it has stalled.
    var reasons: [String]?
    /// Detail sentences, in the order to show them.
    var lines: [String]?

    // The counts and clocks behind those sentences. They are decoded so the whole contract is in
    // one place; the phone shows the server's sentences and does no arithmetic on these.
    var photos_total: Int?
    var worked_through: Int?
    var read_since_start: Int?
    var counting_since: String?
    var could_not_read: Int?
    var skipped: Int?
    var retrying: Int?
    /// Photos handed to the reader right now. A hand-out window, not what is left to read.
    var with_reader: Int?
    var read_1h: Int?
    var read_24h: Int?
    var last_read_at: String?
    var last_attempt_at: String?
    var reading_from: String?
    var library_from: String?
    var library_to: String?
    var library_walked_at: String?
    var reader_checked_in_at: String?
}

extension PhotoReadingStatus: Decodable {
    enum CodingKeys: String, CodingKey {
        case as_of, state, headline, summary, reasons, lines
        case photos_total, worked_through, read_since_start, counting_since
        case could_not_read, skipped, retrying, with_reader, read_1h, read_24h
        case last_read_at, last_attempt_at, reading_from, library_from, library_to
        case library_walked_at, reader_checked_in_at
    }

    /// Key by key, so one missing, null or malformed field never sinks the others.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        as_of = try? c.decode(String.self, forKey: .as_of)
        state = try? c.decode(String.self, forKey: .state)
        headline = try? c.decode(String.self, forKey: .headline)
        summary = try? c.decode(String.self, forKey: .summary)
        reasons = (try? c.decode([Lossy<String>].self, forKey: .reasons))?.compactMap(\.value)
        lines = (try? c.decode([Lossy<String>].self, forKey: .lines))?.compactMap(\.value)
        photos_total = try? c.decode(Int.self, forKey: .photos_total)
        worked_through = try? c.decode(Int.self, forKey: .worked_through)
        read_since_start = try? c.decode(Int.self, forKey: .read_since_start)
        counting_since = try? c.decode(String.self, forKey: .counting_since)
        could_not_read = try? c.decode(Int.self, forKey: .could_not_read)
        skipped = try? c.decode(Int.self, forKey: .skipped)
        retrying = try? c.decode(Int.self, forKey: .retrying)
        with_reader = try? c.decode(Int.self, forKey: .with_reader)
        read_1h = try? c.decode(Int.self, forKey: .read_1h)
        read_24h = try? c.decode(Int.self, forKey: .read_24h)
        last_read_at = try? c.decode(String.self, forKey: .last_read_at)
        last_attempt_at = try? c.decode(String.self, forKey: .last_attempt_at)
        reading_from = try? c.decode(String.self, forKey: .reading_from)
        library_from = try? c.decode(String.self, forKey: .library_from)
        library_to = try? c.decode(String.self, forKey: .library_to)
        library_walked_at = try? c.decode(String.self, forKey: .library_walked_at)
        reader_checked_in_at = try? c.decode(String.self, forKey: .reader_checked_in_at)
    }
}

// MARK: - Tone

/// How a reading should look on screen. `absent` means there is no reading: none came, or it named no state.
enum PhotoReadingTone: Equatable {
    case moving, stalled, idle, off, absent

    /// A state word this build does not know is treated as waiting: the server's sentences are still
    /// shown, with no warning and no claim that reading is moving. The word itself is never shown.
    init(serverValue: String?) {
        guard let word = CaptureParse.normalizedKey(serverValue) else {
            self = .absent
            return
        }
        switch word {
        case "moving": self = .moving
        case "stalled": self = .stalled
        case "off": self = .off
        default: self = .idle
        }
    }
}

// MARK: - Words (what the bar and the profile card show)

/// Pure functions from a reading to what is drawn. Every sentence is the server's own.
enum PhotoReadingWords {
    /// A reading older than this says when it was checked, so a failed refresh never looks live.
    static let staleAfter: TimeInterval = 10 * 60

    static func tone(_ reading: PhotoReadingStatus?) -> PhotoReadingTone {
        PhotoReadingTone(serverValue: reading?.state)
    }

    /// True while reading is moving or has stalled: the two states that take the bar's first line
    /// and the profile card's title. Waiting, off and no reading stay out of the way.
    static func leads(_ reading: PhotoReadingStatus?) -> Bool {
        let look = tone(reading)
        return look == .moving || look == .stalled
    }

    /// The server's headline. Only a moving or stalled reading that arrived without one gets plain
    /// stand-in words, so a stall is never silent.
    static func headline(_ reading: PhotoReadingStatus?) -> String? {
        let look = tone(reading)
        if look == .absent { return nil }
        if let given = CaptureParse.string(reading?.headline) { return given }
        switch look {
        case .moving: return "Reading your photos"
        case .stalled: return "Photo reading has stalled"
        case .idle, .off, .absent: return nil
        }
    }

    /// Why reading has stalled, as the server wrote it.
    static func reasons(_ reading: PhotoReadingStatus?) -> [String] {
        if tone(reading) == .absent { return [] }
        return (reading?.reasons ?? []).compactMap { CaptureParse.string($0) }
    }

    /// The detail sentences, in the server's order.
    static func lines(_ reading: PhotoReadingStatus?) -> [String] {
        if tone(reading) == .absent { return [] }
        return (reading?.lines ?? []).compactMap { CaptureParse.string($0) }
    }

    /// The one short line under the headline while the bar is collapsed. A stalled reading that
    /// arrived without one uses its first reason, which is what the server puts there.
    static func summary(_ reading: PhotoReadingStatus?) -> String? {
        if tone(reading) == .absent { return nil }
        return CaptureParse.string(reading?.summary) ?? reasons(reading).first
    }

    /// The collapsed bar as one string: the headline, then the summary when there is one.
    static func collapsed(_ reading: PhotoReadingStatus?) -> String? {
        guard let lead = headline(reading) else { return nil }
        guard let tail = summary(reading) else { return lead }
        return lead + " · " + tail
    }

    /// What the expanded bar lists first: every reason, then the detail lines.
    static func rows(_ reading: PhotoReadingStatus?) -> [String] {
        reasons(reading) + lines(reading)
    }

    /// "Checked 14 min ago", worked out on the phone from the server's clock. nil while the reading
    /// is ten minutes old or newer, and when the clock is missing or unreadable.
    static func checkedAgo(_ reading: PhotoReadingStatus?, now: Date = Date()) -> String? {
        if tone(reading) == .absent { return nil }
        guard let at = ProfileClock.date(reading?.as_of) else { return nil }
        let seconds = now.timeIntervalSince(at)
        guard seconds > staleAfter else { return nil }
        let minutes = Int(seconds / 60)
        if minutes < 60 { return "Checked \(minutes) min ago" }
        let hours = minutes / 60
        return hours < 48 ? "Checked \(hours) h ago" : "Checked \(hours / 24) days ago"
    }

    /// The bar's visibility rule: hidden when this session has no photos to list and reading is
    /// waiting, off or absent.
    static func barIsHidden(hasRows: Bool, reading: PhotoReadingStatus?) -> Bool {
        !hasRows && !leads(reading)
    }
}

// MARK: - The read

enum PhotoReadingReader {
    static let functionName = "photo_reading_status"
    /// Seconds between reads while the app is in front, and the longest wait after failed reads.
    static let interval: TimeInterval = 120
    static let longestWait: TimeInterval = 600

    /// The wait before the next read: two minutes after a read that worked, double the last wait
    /// (ten minutes at most) after one that failed.
    static func nextWait(after wait: TimeInterval, succeeded: Bool) -> TimeInterval {
        succeeded ? interval : min(wait * 2, longestWait)
    }

    /// One read for the signed-in account. The server takes the caller from the session, never from
    /// an argument; the time zone only shapes the dates inside its sentences. Returns nil when the
    /// server has no reading for this account, and throws when the read itself failed.
    static func read() async throws -> PhotoReadingStatus? {
        let response = try await SupabaseService.client
            .rpc(functionName, params: ["p_tz": TimeZone.current.identifier])
            .execute()
        return CaptureLedgerReporter.decodeOptional(PhotoReadingStatus.self, from: response.data)
    }
}
