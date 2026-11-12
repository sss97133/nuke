// VehicleLiveBanner.swift — the words the vehicle page's LIVE banner prints, kept pure so they
// are unit-tested: the countdown as days/hours/minutes/seconds (a lot two days out reads
// "2d 00h 00m 00s", never "2880:00"), and the bid, which reads "unknown" when the live row
// carries no amount rather than a dash that looks like a value.

import Foundation

enum VehicleLiveBanner {
    /// Time left on the banner's clock. Same words as the Explore card's clock sheet
    /// (`ExploreCardDrill.preciseRemaining`) so one auction reads the same everywhere.
    static func countdown(_ ends: Date, now: Date) -> String {
        ExploreCardDrill.preciseRemaining(ends, now: now)
    }

    /// The bid as recorded, or "unknown" when the live row carries none (or a non-positive amount).
    static func bid(_ amount: Double?) -> String {
        NukeDisplay.money(amount) ?? "unknown"
    }
}
