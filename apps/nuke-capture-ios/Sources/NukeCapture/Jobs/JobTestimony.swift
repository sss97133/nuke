// JobTestimony.swift — what retained work messages say about a job, shown as testimony.
//
// work_order_job_path_read adds a retained_testimony block to the terms, execution, completion and
// accounting stages (work_order_retained_testimony_overlay, migration 20261020003000): counts of
// attributed lifecycle claims quoted from retained work messages, by speaker side (client,
// provider) and by claim (terms_accepted, work_paused, operation_completed, invoice_issued,
// payment_reported), the operations they name and the latest message clock. It returns no
// message text. A claim is a report, not a Sign: it sets no approval, start, completion or
// payment and the stage state ignores it. The phone says so in words and renders it on the
// attributed rung, never as accepted, done or paid.

import SwiftUI

struct JobTestimony: Equatable {
    let claims: Int
    let bySide: [String: Int]
    let byStage: [String: Int]
    /// Distinct operations the claims name.
    let operations: Int
    let latestMessageAt: String?

    static let factKey = "retained_testimony"

    init(claims: Int, bySide: [String: Int] = [:], byStage: [String: Int] = [:], operations: Int = 0, latestMessageAt: String? = nil) {
        self.claims = claims; self.bySide = bySide; self.byStage = byStage
        self.operations = operations; self.latestMessageAt = latestMessageAt
    }

    init?(_ value: JobJSON?) {
        guard case .object(let o)? = value else { return nil }
        func counts(_ k: String) -> [String: Int] {
            guard case .object(let m)? = o[k] else { return [:] }
            return m.compactMapValues(\.intValue).filter { $0.value > 0 }
        }
        self.init(claims: o["claims"]?.intValue ?? 0, bySide: counts("by_side"), byStage: counts("by_stage"),
                  operations: o["operations"]?.intValue ?? 0, latestMessageAt: o["latest_message_at"]?.stringValue)
    }

    init?(stage: JobStage) {
        self.init(stage.facts.first { $0.key == Self.factKey }?.value)
    }
}

enum JobTestimonyCopy {
    static let label = "In retained messages"

    /// One line per claim kind, most first: "3 messages from the shop say operations were finished · 3 operations named".
    static func lines(_ t: JobTestimony) -> [String] {
        t.byStage.sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }
            .map { line($0.key, $0.value, t) }
    }

    static func line(_ claim: String, _ n: Int, _ t: JobTestimony) -> String {
        let messages = n == 1 ? "1 message" : "\(n) messages"
        let says = n == 1 ? "says" : "say"
        switch claim {
        case "terms_accepted":
            return "\(messages) from the customer \(says) they agreed to the price or scope"
        case "work_paused":
            return "\(messages) from the shop \(says) work was paused"
        case "operation_completed":
            let named = t.operations > 0 ? " · \(t.operations) operation\(t.operations == 1 ? "" : "s") named" : ""
            return "\(messages) from the shop \(says) work was finished\(named)"
        case "invoice_issued":
            return "\(messages) from the shop \(says) an invoice was sent"
        case "payment_reported":
            return "\(messages)\(side(t)) \(says) a payment was made"
        default:
            return "\(messages) \(says): \(JobCopy.sentence(claim).lowercased())"
        }
    }

    /// " from the customer" when every claim of the block comes from one side; otherwise nothing.
    private static func side(_ t: JobTestimony) -> String {
        guard t.bySide.count == 1, let s = t.bySide.keys.first else { return "" }
        switch s {
        case "client": return " from the customer"
        case "provider": return " from the shop"
        default: return ""
        }
    }

    /// The rung in words, with the newest message's day.
    static func decay(_ t: JobTestimony) -> String {
        ["quoted reports, not Signs · not verified", JobCopy.day(t.latestMessageAt).map { "latest \($0)" }]
            .compactMap { $0 }.joined(separator: " · ")
    }
}

/// The stage's testimony rows, under its own facts. Nothing when the stage carries no claim.
struct JobTestimonyRows: View {
    let stage: JobStage

    var body: some View {
        if stage.state != .withheld, let t = JobTestimony(stage: stage), t.claims > 0 {
            ForEach(JobTestimonyCopy.lines(t), id: \.self) { line in
                RootedValueView(label: JobTestimonyCopy.label, value: line, status: .attributed, decay: JobTestimonyCopy.decay(t))
            }
        }
    }
}
