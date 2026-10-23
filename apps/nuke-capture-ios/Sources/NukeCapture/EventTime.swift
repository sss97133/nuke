// EventTime.swift — order and label things by when they happened, not when they were uploaded.
//
// created_at is upload time. A camera-roll backlog uploaded today was taken weeks ago; sorting or
// labelling it by created_at made old photos read as current. The event clock is taken_at (EXIF) or
// occurred_at. A row with neither is undated: it sorts last and is labelled "Undated", never "recent".

import Foundation

enum EventTime {
    /// The event clock: taken_at, then occurred_at. Never created_at.
    static func clock(takenAt: String?, occurredAt: String? = nil) -> Date? {
        ProfileClock.date(takenAt) ?? ProfileClock.date(occurredAt)
    }

    /// Newest first; undated last; ties broken by the given key so the order is stable.
    static func newestFirst(_ a: Date?, _ b: Date?, tie: (String, String)) -> Bool {
        switch (a, b) {
        case let (x?, y?): return x != y ? x > y : tie.0 > tie.1
        case (.some, nil): return true
        case (nil, .some): return false
        case (nil, nil): return tie.0 > tie.1
        }
    }

    /// Oldest first; undated last.
    static func oldestFirst(_ a: Date?, _ b: Date?, tie: (String, String)) -> Bool {
        switch (a, b) {
        case let (x?, y?): return x != y ? x < y : tie.0 < tie.1
        case (.some, nil): return true
        case (nil, .some): return false
        case (nil, nil): return tie.0 < tie.1
        }
    }

    /// "Taken Oct 15, 2026 at 10:55 AM", or "Undated".
    static func label(_ date: Date?, verb: String = "Taken") -> String {
        guard let date else { return "Undated" }
        return "\(verb) " + date.formatted(date: .abbreviated, time: .shortened)
    }
}
