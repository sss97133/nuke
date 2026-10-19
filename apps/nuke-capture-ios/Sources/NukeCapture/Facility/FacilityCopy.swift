// FacilityCopy.swift — plain words for shop space, bookings and licenses.

import Foundation
import Supabase

enum FacilityCopy {
    static let kinds: [(key: String, title: String, plural: String)] = [
        ("bay", "Bay", "Bays"),
        ("lift", "Lift", "Lifts"),
        ("paint_booth", "Paint booth", "Paint booths"),
        ("compressor", "Compressor", "Compressors"),
        ("parking", "Parking", "Parking"),
        ("other", "Other", "Other space"),
    ]

    static func kind(_ k: String) -> String { kinds.first { $0.key == k }?.title ?? JobCopy.sentence(k) }
    static func kindPlural(_ k: String) -> String { kinds.first { $0.key == k }?.plural ?? JobCopy.sentence(k) }

    /// "holds 2 at a time" — capacity is vehicles at once, never a count of tools.
    static func capacity(_ n: Int) -> String { n == 1 ? "one at a time" : "\(n) at a time" }

    /// "Licensed: Auto repair, valid until Mar 1, 2027". Numbers and documents are never shown.
    static func license(_ l: FacilityRead.License) -> String {
        let type = l.licenseType.map(JobCopy.sentence) ?? "License"
        switch l.state {
        case "expired"?: return "License expired: \(type)" + (JobCopy.day(l.expirationDate).map { ", \($0)" } ?? "")
        case "inactive"?: return "License inactive: \(type)"
        case "active_expiry_unknown"?: return "Licensed: \(type), no expiry on record"
        default: return "Licensed: \(type)" + (JobCopy.day(l.expirationDate).map { ", valid until \($0)" } ?? "")
        }
    }

    static func licenseDetail(_ l: FacilityRead.License) -> String {
        [l.issuingAuthority.map { "issued by \($0)" }, l.verified ? "checked" : "as stated by the shop, not checked"]
            .compactMap { $0 }.joined(separator: " · ")
    }

    static func relation(_ r: String?) -> String { r == "owner" ? "Owner" : "Member" }

    // MARK: Time

    static func date(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        if let d = f.date(from: s) { return d }
        let pg = DateFormatter()
        pg.locale = Locale(identifier: "en_US_POSIX")
        for fmt in ["yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXXXX", "yyyy-MM-dd HH:mm:ssXXXXX", "yyyy-MM-dd HH:mm:ss.SSSSSSXXXXX"] {
            pg.dateFormat = fmt
            if let d = pg.date(from: s) { return d }
        }
        return nil
    }

    /// "Tue Oct 21, 9 AM–12 PM", or "Tue Oct 21, 9 AM – Thu Oct 23, 5 PM" across days.
    static func window(_ from: String?, _ until: String?, timeZone: TimeZone = .current) -> String? {
        guard let a = date(from), let b = date(until) else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let day = DateFormatter()
        day.locale = Locale(identifier: "en_US_POSIX")
        day.timeZone = timeZone
        day.dateFormat = "EEE MMM d"
        let time = DateFormatter()
        time.locale = Locale(identifier: "en_US_POSIX")
        time.timeZone = timeZone
        func t(_ d: Date) -> String {
            time.dateFormat = cal.component(.minute, from: d) == 0 ? "h a" : "h:mm a"
            return time.string(from: d)
        }
        if cal.isDate(a, inSameDayAs: b) { return "\(day.string(from: a)), \(t(a))–\(t(b))" }
        return "\(day.string(from: a)), \(t(a)) – \(day.string(from: b)), \(t(b))"
    }

    /// Days from `start` covered by a busy window, as offsets 0..<days.
    static func busyDays(_ busy: [FacilityRead.Busy], start: Date, days: Int = 60, timeZone: TimeZone = .current) -> Set<Int> {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let d0 = cal.startOfDay(for: start)
        var out = Set<Int>()
        for b in busy {
            guard let a = date(b.from), let z = date(b.until), z > a else { continue }
            let first = max(0, cal.dateComponents([.day], from: d0, to: cal.startOfDay(for: a)).day ?? 0)
            let lastDay = cal.startOfDay(for: z.addingTimeInterval(-1))
            let last = min(days - 1, cal.dateComponents([.day], from: d0, to: lastDay).day ?? -1)
            if first <= last { out.formUnion(first...last) }
        }
        return out
    }

    static func terms(basis: String?, amount: Double?, currency: String?) -> String? {
        guard let basis, let amount else { return nil }
        let price = JobMoney.format(amount, currency)
        switch basis {
        case "hourly": return "\(price) / hour"
        case "day_rate": return "\(price) / day"
        default: return "\(price) flat"
        }
    }

    static func requester(_ role: String?) -> String {
        switch role {
        case "customer"?: return "the customer"
        case "accepted_provider"?: return "a technician accepted on the job"
        default: return "someone on the job"
        }
    }

    // MARK: Job page

    static func requested(shop: String?, window: String?) -> String {
        "Requested at \(shop ?? "the shop") — waiting for the shop" + (window.map { " · \($0)" } ?? "")
    }

    static func booked(_ b: JobFacility.Booking, timeZone: TimeZone = .current) -> String {
        "Booked: \(b.assetLabel)" + (window(b.from, b.until, timeZone: timeZone).map { ", \($0)" } ?? "")
    }

    /// The facility input in plain words, from the reader's own result and reason.
    static func match(_ m: FacilityMatch) -> String {
        let r = m.reason ?? ""
        if r.hasPrefix("not required for a") { return "Not needed for this" }
        let what = m.kinds.isEmpty ? "space" : m.kinds.map { kind($0).lowercased() }.joined(separator: " or ")
        switch m.result {
        case "pass":
            return r.contains("no job window") ? "A shop you can use has a matching \(what); times aren't checked yet"
                : "A matching \(what) is free then at a shop you can use"
        case "fail":
            return "Every matching \(what) is booked then"
        default:
            if r.contains("not a declared facility asset kind") { return "This isn't shop space a shop can declare" }
            return "No shop you can use has listed a \(what) yet"
        }
    }

    // MARK: Says / does not say

    static let requestSays = [
        "You're asking this shop for this space, for this job, at this time.",
        "The shop must confirm. Nothing is reserved until then.",
    ]
    static let requestDoesNotSay = [
        "That the space is reserved",
        "Any payment — a fee here is only what you propose",
        "Access to the vehicle",
    ]
    static let declareSays = [
        "Your shop has this asset and can take bookings on it.",
        "Nuke never guesses assets from photos; this comes only from you.",
    ]
    static let declareDoesNotSay = [
        "What it's worth, or its condition",
        "That it's free at any particular time",
    ]

    private static let binds: [String: String] = [
        "one capacity slot of this asset for the window": "One space on this asset is held for this job at that time.",
        "your organization's facility offer on the job's facility requirement": "Your shop offers this space on the job, at the requested fee.",
    ]
    private static let doesNotBind: [String: String] = [
        "payment": "Any payment",
        "vehicle access": "Access to the vehicle",
        "other windows": "Any other time",
    ]
    static func signBinds(_ s: String) -> String { binds[s] ?? JobCopy.sentence(s) }
    static func signDoesNotBind(_ s: String) -> String { doesNotBind[s] ?? JobCopy.sentence(s) }

    // MARK: Failures

    static func failure(_ error: Error) -> String {
        let message = (error as? PostgrestError)?.message ?? ""
        let table: [(String, String)] = [
            ("Authentication required", "Sign in first."),
            ("reserves a facility for this job", "Only the customer or a technician accepted on this job can book shop space."),
            ("need an open, vehicle-bound work order", "This job is closed or has no vehicle, so it can't book shop space."),
            ("not a declared, in-service facility asset", "The shop no longer lists that space."),
            ("Window must be future", "Pick a future time that ends after it starts, at most 31 days."),
            ("Terms must be", "The fee needs an amount and a 3-letter currency."),
            ("confirm its reservations", "Only the shop's owners and members can confirm bookings."),
            ("Reservation hash does not match", "This request changed since you opened it. Refresh and review it again."),
            ("Only a current, unexpired request", "This request was cancelled or has expired."),
            ("fully booked", "That space is fully booked for that time."),
            ("declare its facility assets", "Only the shop's owners and members can declare its assets."),
            ("Kind must be", "Choose what it is."),
            ("Label must be one line", "Give it a short name on one line."),
            ("Capacity must be", "It holds 1 to 500 vehicles at a time."),
            ("Evidence must be", "The link has to start with https://."),
            ("cancels this reservation", "Only the person who asked or the shop can cancel this."),
            ("Organization unavailable", "This shop isn't available."),
        ]
        if let hit = table.first(where: { message.contains($0.0) }) { return hit.1 }
        return ReadFailure.text(error)
    }
}
