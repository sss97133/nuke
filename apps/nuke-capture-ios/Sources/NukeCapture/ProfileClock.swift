import Foundation

/// Clocks as the kit prints them: short month, day, year, in UTC. nil when the clock is missing or unparseable.
enum ProfileClock {
    private static let out: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "MMM d, yyyy"
        return f
    }()
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
