// IngestionStatus.swift — the profile's ingestion card, derived from the phone's live state
// (SyncEngine, LibraryIngest, on-device photo evidence) merged with the server ledger
// (get_user_sync_status, refreshed periodically while the profile is visible).
//
// Pure value types so the derivation is unit-tested (UnitTests/IngestionStatusTests.swift).

import Foundation

struct IngestionSnapshot: Equatable {
    // Phone (live)
    var isPaused = false
    var thermalHold = false          // hot, or Low Power Mode (SyncEngine.thermalHold)
    var authProblem: String?
    var isSyncing = false
    var uploadsPending = 0           // SyncEngine.backfillRemaining
    var uploadsThisPass = 0          // SyncEngine.totalSynced (lifetime on this device)
    var scanning = false             // LibraryIngest.running or SyncEngine.isReconciling
    var scanned = 0
    var scanTarget = 0
    var lastDeviceSync: Date?
    // On-device evidence
    var matched = 0                  // photos with exactly one candidate vehicle
    var suggested = 0                // photos with several candidate vehicles
    var unresolved = 0               // vehicle frames with no candidate
    // Server ledger
    var serverSynced: Int?
    var serverAnalyzed: Int?
    var serverPending = 0
    var serverFiled: Int?
    var lastServerSync: Date?
    var serverError = false
    // Photo reading, as the server states it: the same reading the bar at the top of the app shows.
    var photoReading: PhotoReadingStatus?

    var needsReview: Int { suggested + unresolved }
    /// The most recent of the device's and the server's last-sync clocks.
    var lastSync: Date? { [lastDeviceSync, lastServerSync].compactMap { $0 }.max() }
}

enum IngestionState: Equatable {
    case signInNeeded
    case paused
    case pausedHot
    case uploading(Int)
    case scanning(done: Int, total: Int)
    case analyzing(Int)
    /// Photo reading on the server, in the server's own words: moving, or stalled with its first reason.
    case photoReading(headline: String, reason: String?, stalled: Bool)
    case needsReview(Int)
    case upToDate
    case unknown

    /// Highest-priority state wins: a blocker first, then active work, then what's left for the owner.
    static func derive(_ s: IngestionSnapshot) -> Self {
        if s.authProblem != nil { return .signInNeeded }
        if s.isPaused { return .paused }
        let work = s.isSyncing || s.uploadsPending > 0 || s.scanning
        if s.thermalHold && work { return .pausedHot }
        if s.isSyncing || s.uploadsPending > 0 { return .uploading(s.uploadsPending) }
        if s.scanning { return .scanning(done: s.scanned, total: s.scanTarget) }
        // A reading that is moving or has stalled speaks for the server, where the card would
        // otherwise say "Analyzing N on the server" or "Up to date". Nothing else changes place.
        let reading = serverReading(s.photoReading)
        if s.serverPending > 0 { return reading ?? .analyzing(s.serverPending) }
        if s.needsReview > 0 { return .needsReview(s.needsReview) }
        if s.serverSynced == nil && s.serverError { return .unknown }
        return reading ?? .upToDate
    }

    /// The reading as a card state; nil unless the server says moving or stalled, so a reading that
    /// is waiting, off or absent leaves the card exactly as it was.
    static func serverReading(_ status: PhotoReadingStatus?) -> IngestionState? {
        guard PhotoReadingWords.leads(status), let words = PhotoReadingWords.headline(status) else { return nil }
        let stalled = PhotoReadingWords.tone(status) == .stalled
        return .photoReading(headline: words, reason: stalled ? PhotoReadingWords.reasons(status).first : nil, stalled: stalled)
    }

    var title: String {
        switch self {
        case .signInNeeded: return "Sign in again to sync"
        case .paused: return "Paused"
        case .pausedHot: return "Paused · phone hot or Low Power Mode"
        case .uploading(let n): return n > 0 ? "Uploading \(n.formatted())" : "Uploading"
        case .scanning(let done, let total):
            return total > 0 ? "Scanning library · \(done.formatted()) of \(total.formatted())" : "Scanning library"
        case .analyzing(let n): return "Analyzing \(n.formatted()) on the server"
        case .photoReading(let headline, _, _): return headline
        case .needsReview(let n): return "\(n.formatted()) need review"
        case .upToDate: return "Up to date"
        case .unknown: return "Status unavailable"
        }
    }

    /// A second line under the title: why photo reading has stalled, in the server's words.
    /// nil for every other state.
    var detail: String? {
        if case .photoReading(_, let reason, _) = self { return reason }
        return nil
    }

    var systemImage: String {
        switch self {
        case .signInNeeded: return "person.crop.circle.badge.exclamationmark"
        case .paused: return "pause.circle"
        case .pausedHot: return "thermometer.high"
        case .uploading: return "arrow.up.circle"
        case .scanning: return "magnifyingglass"
        case .analyzing: return "hourglass"
        case .photoReading(_, _, let stalled): return stalled ? "exclamationmark.triangle" : "eye"
        case .needsReview: return "questionmark.circle"
        case .upToDate: return "checkmark.circle"
        case .unknown: return "exclamationmark.triangle"
        }
    }

    /// Work this phone can watch finish. Photo reading is not in the list: it has its own slower
    /// refresh (CaptureIngestStore), so it never speeds up the profile's.
    var isActive: Bool {
        switch self { case .uploading, .scanning, .analyzing: return true; default: return false }
    }
}

/// While visible, refresh the server ledger every `interval` seconds; faster while work is active.
enum IngestionRefresh {
    static let interval: TimeInterval = 45
    static let activeInterval: TimeInterval = 30
    static func next(for state: IngestionState) -> TimeInterval { state.isActive ? activeInterval : interval }

    static func parse(_ raw: String?) -> Date? {
        guard let raw else { return nil }
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: raw) { return d }
        if let d = ISO8601DateFormatter().date(from: raw) { return d }
        // Postgres text form: "2026-10-22 20:01:02.123+00"
        let p = DateFormatter(); p.locale = Locale(identifier: "en_US_POSIX")
        for format in ["yyyy-MM-dd HH:mm:ss.SSSSSSXXXXX", "yyyy-MM-dd HH:mm:ss.SSSXXXXX", "yyyy-MM-dd HH:mm:ssXXXXX", "yyyy-MM-dd HH:mm:ss.SSSSSSX"] {
            p.dateFormat = format; if let d = p.date(from: raw) { return d }
        }
        return nil
    }
}
