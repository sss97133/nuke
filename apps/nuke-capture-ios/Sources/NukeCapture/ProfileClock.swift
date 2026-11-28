import Foundation

/// Clocks as the kit prints them (kit day()): short month, day, year. A timestamp prints in the viewer's own time
/// zone (a reader stamped 02:48 UTC on Nov 25 is Nov 24 in Las Vegas; lead, 2026-11-24). nil when the clock is missing
/// or unparseable.
enum ProfileClock {
    private static let out: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "MMM d, yyyy"
        f.timeZone = .current
        return f
    }()
    /// The zone the clocks print in: the viewer's own. Tests pin it to keep their fixtures' days fixed.
    static var timeZone: TimeZone {
        get { out.timeZone }
        set { out.timeZone = newValue }
    }
    private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let plain = ISO8601DateFormatter()

    static func date(_ iso: String?) -> Date? {
        guard let iso, !iso.isEmpty else { return nil }
        // Postgres prints "+00:00" with microseconds; ISO8601DateFormatter accepts up to fractional seconds.
        let trimmed = iso.replacingOccurrences(of: #"(\.\d{3})\d+"#, with: "$1", options: .regularExpression)
        return fractional.date(from: trimmed) ?? plain.date(from: trimmed)
    }

    static func day(_ iso: String?) -> String? {
        date(iso).map { out.string(from: $0) }
    }

    static func Absolute(_ iso: String?) -> String {
        day(iso) ?? iso ?? "unknown date"
    }
}
