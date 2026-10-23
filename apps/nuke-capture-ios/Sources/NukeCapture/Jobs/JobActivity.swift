// JobActivity.swift — the live activity feed of one job (work_order_activity_read).
//
// Events newest first, each with when it happened, how it is known (a Sign, a record, the card processor, or a
// retained message that is not verified) and the role that did it; never a user id, an amount or message text.
// The `live` block carries a version that changes when anything is added and the poll interval the server
// suggests for the job's current phase. JobLiveView polls with `since` and merges what is new.

import Foundation

struct JobActivity: Decodable, Equatable {
    struct Media: Decodable, Equatable {
        let thumbnails: [String]
        let withheld: Int

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            thumbnails = (try? c.decode([String].self, forKey: .init("thumbnails"))) ?? []
            withheld = (try? c.decode(Int.self, forKey: .init("withheld"))) ?? 0
        }
        init(thumbnails: [String], withheld: Int) { self.thumbnails = thumbnails; self.withheld = withheld }
    }

    struct Event: Decodable, Equatable, Identifiable {
        let kind: String
        let refId: String
        let at: String
        let recordedAt: String?
        let basis: String
        let role: String?
        let title: String
        let media: Media?
        var id: String { kind + ":" + refId }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            kind = try c.decode(String.self, forKey: .init("kind"))
            refId = try c.decode(String.self, forKey: .init("ref_id"))
            at = try c.decode(String.self, forKey: .init("at"))
            recordedAt = try? c.decode(String.self, forKey: .init("recorded_at"))
            basis = (try? c.decode(String.self, forKey: .init("basis"))) ?? "record"
            role = try? c.decode(String.self, forKey: .init("role"))
            title = (try? c.decode(String.self, forKey: .init("title"))) ?? ActivityCopy.fallbackTitle(kind)
            media = try? c.decode(Media.self, forKey: .init("media"))
        }

        init(kind: String, refId: String, at: String, recordedAt: String? = nil, basis: String, role: String? = nil,
             title: String, media: Media? = nil) {
            self.kind = kind; self.refId = refId; self.at = at; self.recordedAt = recordedAt; self.basis = basis
            self.role = role; self.title = title; self.media = media
        }
    }

    struct Live: Decodable, Equatable {
        let latestAt: String?
        let latestRecordedAt: String?
        let eventsTotal: Int
        let version: String
        let phase: String
        let pollAfterSeconds: Int

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            latestAt = try? c.decode(String.self, forKey: .init("latest_at"))
            latestRecordedAt = try? c.decode(String.self, forKey: .init("latest_recorded_at"))
            eventsTotal = (try? c.decode(Int.self, forKey: .init("events_total"))) ?? 0
            version = (try? c.decode(String.self, forKey: .init("version"))) ?? ""
            phase = (try? c.decode(String.self, forKey: .init("phase"))) ?? "requested"
            pollAfterSeconds = (try? c.decode(Int.self, forKey: .init("poll_after_seconds"))) ?? 60
        }
    }

    let asOf: String?
    let events: [Event]
    let live: Live
    let party: Bool

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        asOf = try? c.decode(String.self, forKey: .init("as_of"))
        // One undecodable event never blanks the feed.
        events = (try? c.decode(LossyArray<Event>.self, forKey: .init("events")))?.elements ?? []
        live = try c.decode(Live.self, forKey: .init("live"))
        party = ((try? c.nestedContainer(keyedBy: JobCodingKey.self, forKey: .init("viewer")))
            .flatMap { try? $0.decode(Bool.self, forKey: .init("party")) }) ?? false
    }
}

enum ActivityReaders {
    static let name = "work_order_activity_read"

    static func read(workOrderId: String, since: String? = nil) async -> JobLoad<JobActivity> {
        struct P: Encodable { let p_work_order_id: String; let p_since: String?; let p_limit: Int }
        return await JobReaders.call(name) {
            try await SupabaseService.client.rpc(name, params: P(p_work_order_id: workOrderId, p_since: since, p_limit: 100))
                .execute().data
        }
    }
}

/// Plain words and feed arithmetic for the live screen. Pure, unit-tested.
enum ActivityCopy {
    /// The big status line for a phase. The phase is the latest kind of event on record, not a stage verdict.
    static func headline(_ phase: String) -> String {
        switch phase {
        case "requested": return "No provider booked yet"
        case "booking": return "Getting booked"
        case "in_progress": return "Work in progress"
        case "closing": return "Wrapping up"
        case "settled": return "Paid"
        default: return "On record"
        }
    }

    static func phaseSymbol(_ phase: String) -> String {
        switch phase {
        case "requested": return "magnifyingglass"
        case "booking": return "calendar.badge.clock"
        case "in_progress": return "wrench.and.screwdriver.fill"
        case "closing": return "checkmark.circle"
        case "settled": return "creditcard.fill"
        default: return "clock"
        }
    }

    /// Whether the screen should show the pulsing live dot: the job can still change soon.
    static func isActive(_ phase: String) -> Bool { phase != "settled" }

    static func symbol(_ kind: String) -> String {
        switch kind {
        case "requested": return "plus.bubble"
        case "offer": return "hand.raised"
        case "quote": return "doc.text"
        case "quote_accepted": return "signature"
        case "provider_booked": return "person.crop.circle.badge.checkmark"
        case "work_started": return "play.circle.fill"
        case "evidence": return "camera.fill"
        case "completion_attested": return "checkmark.seal"
        case "completion_accepted": return "checkmark.seal.fill"
        case "invoice_issued": return "doc.richtext"
        case "paid": return "creditcard.fill"
        case "payment_witnessed": return "banknote"
        case "status_changed": return "arrow.triangle.2.circlepath"
        case "message": return "text.bubble"
        default: return "circle"
        }
    }

    static func fallbackTitle(_ kind: String) -> String { JobWords.humanize(kind).capitalized }

    /// How the event is known, in one or two words.
    static func basisLabel(_ basis: String) -> String {
        switch basis {
        case "authenticated_sign": return "Signed"
        case "record": return "Recorded"
        case "processor_record": return "Card processor"
        case "message_testimony": return "Message · not verified"
        default: return JobWords.humanize(basis)
        }
    }

    static func roleLabel(_ role: String?) -> String? {
        switch role {
        case nil, "": return nil
        case "client", "customer": return "Customer"
        case "provider", "accepted_provider": return "Provider"
        case "organization", "shop", "organization_owner": return "Shop"
        case "payer": return "Payer"
        case "payee": return "Payee"
        case let r?: return JobWords.humanize(r).capitalized
        }
    }

    /// "just now", "5 min ago", "3 h ago", "yesterday", "Oct 2" for an event clock relative to `now`.
    static func relative(_ clock: String, now: Date) -> String {
        guard let d = JobClock.date(clock) else { return clock }
        let s = max(0, now.timeIntervalSince(d))
        if s < 60 { return "just now" }
        if s < 3600 { return "\(Int(s / 60)) min ago" }
        if s < 86_400 { return "\(Int(s / 3600)) h ago" }
        if s < 172_800 { return "yesterday" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = Calendar.current.isDate(d, equalTo: now, toGranularity: .year) ? "MMM d" : "MMM d, yyyy"
        return f.string(from: d)
    }

    /// New events merged into the feed: one row per event, newest first.
    static func merge(_ existing: [JobActivity.Event], _ incoming: [JobActivity.Event]) -> [JobActivity.Event] {
        var byId: [String: JobActivity.Event] = [:]
        for e in existing + incoming { byId[e.id] = e }
        return byId.values.sorted {
            let a = JobClock.date($0.at) ?? .distantPast, b = JobClock.date($1.at) ?? .distantPast
            return a == b ? $0.id > $1.id : a > b
        }
    }

    /// Ids in `incoming` that the feed did not have yet (they animate in).
    static func fresh(_ existing: [JobActivity.Event], _ incoming: [JobActivity.Event]) -> Set<String> {
        Set(incoming.map(\.id)).subtracting(existing.map(\.id))
    }

    /// Share of the tracker reached, 0...1, from the server's steps (reached counts fully, partial half).
    static func progress(_ steps: [JobProviderPlace.Step]) -> Double {
        guard !steps.isEmpty else { return 0 }
        let score = steps.reduce(0.0) { acc, s in
            switch s.state {
            case .reached: return acc + 1
            case .partial: return acc + 0.5
            default: return acc
            }
        }
        return min(1, score / Double(steps.count))
    }

    /// Seconds to wait before the next poll, bounded so a bad value cannot spin or stall the screen.
    static func pollInterval(_ live: JobActivity.Live?) -> Int {
        min(max(live?.pollAfterSeconds ?? 60, 10), 600)
    }

    /// The server's interval doubled for each quiet poll in a row, capped at 10 minutes, so an open
    /// screen on a job with no news stops waking the radio every few seconds.
    static func backoffInterval(_ base: Int, idlePolls: Int) -> Int {
        let doubled = base << min(max(idlePolls, 0), 6)
        return min(max(doubled, base), 600)
    }
}
