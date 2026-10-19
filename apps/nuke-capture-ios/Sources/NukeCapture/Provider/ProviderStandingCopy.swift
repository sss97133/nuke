// ProviderStandingCopy.swift — the provider-standing readers' values in plain words.
//
// Every number here is one the reader stated; nothing is summed, multiplied or inferred on the
// phone. A rate is an open term shown with its currency and its agreed days, never as a total.

import Foundation

enum ProviderStandingCopy {
    // MARK: Coverage

    /// "Jul 21, 2026 – Oct 19, 2026" for the reader's range; nil when it sent none.
    static func range(_ p: ProviderProductivity) -> String? {
        guard let from = JobCopy.day(p.rangeFrom), let to = JobCopy.day(p.rangeTo) else { return nil }
        return "\(from) – \(to)"
    }

    /// The coverage line under a productivity measure: its range and who it covers.
    static func coverage(_ p: ProviderProductivity) -> String {
        let scope = p.isSelf ? "all your activity" : "public vehicles and cleared photos only"
        return [range(p), scope].compactMap { $0 }.joined(separator: " · ")
    }

    /// "2 of 9 days with activity"; the count alone when the reader sent no denominator.
    static func ofActiveDays(_ n: Int?, _ p: ProviderProductivity) -> String {
        guard let n else { return "Not reported" }
        guard let total = p.totals?.daysWithActivity else { return JobCopy.count(n) }
        return "\(JobCopy.count(n)) of \(JobCopy.count(total)) days with activity"
    }

    // MARK: Days

    /// "61 photos · 2 operations · 1 completion accepted"; "Signed only" when the day has no counts.
    static func dayActivity(_ d: ProviderProductivity.Day) -> String {
        var parts: [String] = []
        if let n = d.imageEvidence, n > 0 { parts.append(plural(n, "photo")) }
        if let n = d.operationsCompleted, n > 0 { parts.append(plural(n, "operation")) }
        if let n = d.specsReportedPerformed, n > 0 { parts.append(plural(n, "spec reported performed", "specs reported performed")) }
        if let n = d.completionsAccepted, n > 0 { parts.append(plural(n, "completion accepted", "completions accepted")) }
        return parts.isEmpty ? "No counted activity" : parts.joined(separator: " · ")
    }

    /// "Confirmed by you · accepted by the customer · 3h 10m of photos".
    static func daySigned(_ d: ProviderProductivity.Day, isSelf: Bool) -> String {
        var parts: [String] = []
        if d.selfConfirmed { parts.append(isSelf ? "confirmed by you" : "confirmed by them") }
        if d.customerAccepted { parts.append("accepted by the customer") }
        if parts.isEmpty { parts.append("not signed") }
        if let m = d.captureSpanMinutes, let span = JobCopy.span(Int(m.rounded())) { parts.append(span) }
        let line = parts.joined(separator: " · ")
        return String(line.prefix(1)).uppercased() + String(line.dropFirst())
    }

    static func dayStatus(_ d: ProviderProductivity.Day) -> RootStatus {
        if d.customerAccepted { return .proven }
        if d.selfConfirmed { return .attributed }
        return .recorded
    }

    // MARK: Day-rate jobs

    /// "$200.00 a day · 3 days agreed" — the open term, never multiplied out.
    static func term(_ t: ProviderProductivity.DayRateTerm) -> String {
        var parts: [String] = []
        if let rate = t.rate { parts.append(JobMoney.format(rate, t.currency) + " a day") } else { parts.append("Rate not stated") }
        if let q = t.quantityDays { parts.append("\(JobCopy.plainNumber(q)) day\(q == 1 ? "" : "s") agreed") }
        return parts.joined(separator: " · ")
    }

    static func termSource(_ s: String?) -> String {
        switch s {
        case "accepted_offer"?: return "from your accepted offer"
        case "accepted_quote"?: return "from your accepted quote"
        default: return "accepted terms"
        }
    }

    /// "2 confirmed by you · 1 accepted by the customer · in Mar 19, 2026 – Apr 2, 2026".
    static func jobSigned(_ j: ProviderProductivity.DayRateJob, isSelf: Bool) -> String {
        var parts: [String] = []
        if let n = j.selfConfirmedDays { parts.append("\(plural(n, "day")) \(isSelf ? "confirmed by you" : "confirmed by them")") }
        if let n = j.customerAcceptedDays { parts.append("\(plural(n, "day")) accepted by the customer") }
        if let from = JobCopy.day(j.windowFrom), let until = JobCopy.day(j.windowUntil) { parts.append("in \(from) – \(until)") }
        return parts.isEmpty ? "Signed days not reported" : parts.joined(separator: " · ")
    }

    // MARK: Claim evidence

    static func evidenceKind(_ k: String) -> String {
        switch k {
        case "work_session": return "Work session"
        case "observation": return "Observation"
        case "org_membership": return "Shop membership"
        default: return JobCopy.sentence(k)
        }
    }

    static func strength(_ s: String?) -> String {
        switch s {
        case "direct"?: return "Direct"
        case "corroborating"?: return "Corroborating"
        case let other?: return JobCopy.sentence(other)
        case nil: return "Strength not stated"
        }
    }

    /// What approval could accept the item for, or that it is context only.
    static func approvable(_ rungs: [String]) -> String {
        guard !rungs.isEmpty else { return "context for the reviewer" }
        return "can support: " + rungs.map { JobCopy.claimRung($0).lowercased() }.joined(separator: ", ")
    }

    /// "37 items · 2 direct · 35 corroborating".
    static func counts(_ c: ActorClaimEvidence.Counts?) -> String {
        guard let c, let total = c.total else { return "Not counted" }
        var parts = [plural(total, "item")]
        if let d = c.direct { parts.append("\(JobCopy.count(d)) direct") }
        if let k = c.corroborating { parts.append("\(JobCopy.count(k)) corroborating") }
        return parts.joined(separator: " · ")
    }

    /// "Showing 50 of 335"; nil when everything stated is shown.
    static func shown(_ shown: Int, of total: Int?) -> String? {
        guard let total, total > shown else { return nil }
        return "Showing \(JobCopy.count(shown)) of \(JobCopy.count(total))"
    }

    // MARK: Delegated signs

    private static let rpcs: [String: String] = [
        "confirm_work_session": "Confirmed a work day",
        "account_link_claims_self_claim": "Filed a technician-profile link",
        "approve_actor_link_claim_owner_delegated": "Approved the owner's own technician-profile link",
        "approve_ownership_verification": "Approved an ownership verification",
        "ownership_verifications_review": "Reviewed an ownership verification",
    ]

    static func rpc(_ name: String) -> String { rpcs[name] ?? JobCopy.sentence(name) }

    /// "1 sign · last Oct 19, 2026 17:14 UTC" (rolled back stated when any).
    static func rpcLine(_ r: DelegatedSigns.ByRpc) -> String {
        var parts: [String] = []
        if let n = r.rolledBack, n > 0 { parts.append("\(JobCopy.count(n)) rolled back") }
        if let last = JobClock.text(r.lastSignedAt) { parts.append("last \(last)") }
        return parts.joined(separator: " · ")
    }

    static func signs(_ n: Int?) -> String {
        guard let n else { return "Not reported" }
        return plural(n, "sign")
    }

    static func withheld(_ items: [String]) -> String? {
        guard !items.isEmpty else { return nil }
        return "Not shown: " + items.joined(separator: ", ") + "."
    }

    // MARK: Words

    /// The reader's sentence with its first letter capitalized and a closing period.
    static func sentence(_ s: String) -> String {
        let first = String(s.prefix(1)).uppercased()
        let body = first + String(s.dropFirst())
        return body.hasSuffix(".") ? body : body + "."
    }

    static func plural(_ n: Int, _ one: String, _ many: String? = nil) -> String {
        "\(JobCopy.count(n)) \(n == 1 ? one : (many ?? one + "s"))"
    }
}
