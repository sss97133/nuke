// JobCopy.swift — the words a person reads on the job screens.
//
// Readers speak in codes (stage states, gap codes, fact keys); the screen speaks trade language:
// request, inspection, estimate, quote, work order, change order, completion, invoice, payment,
// receipt. The trust ladder is unchanged (RootStatus carries it); only the wording lives here.
// An unmapped code falls back to plain words from its snake_case, never to a blank.

import Foundation

enum JobCopy {
    // MARK: Stages

    static func title(_ key: JobStageKey) -> String {
        switch key {
        case .intake: return "Request"
        case .inspection: return "Inspection"
        case .plan: return "Plan & estimate"
        case .terms: return "Quote & terms"
        case .execution: return "Work"
        case .completion: return "Completion"
        case .accounting: return "Invoice & payment"
        }
    }

    /// The rail's one-word label under each dot.
    static func shortTitle(_ key: JobStageKey) -> String {
        switch key {
        case .intake: return "Request"
        case .inspection: return "Inspection"
        case .plan: return "Estimate"
        case .terms: return "Quote"
        case .execution: return "Work"
        case .completion: return "Done"
        case .accounting: return "Payment"
        }
    }

    static func initial(_ key: JobStageKey) -> String {
        switch key {
        case .intake: return "R"
        case .inspection: return "I"
        case .plan: return "E"
        case .terms: return "Q"
        case .execution: return "W"
        case .completion: return "C"
        case .accounting: return "P"
        }
    }

    /// Short state words for headers and the rail.
    static func state(_ s: JobStageState) -> String {
        switch s {
        case .recorded: return "Recorded"
        case .partial: return "In progress"
        case .statusOnly: return "Marked only"
        case .absent: return "Not started"
        case .withheld: return "People on this job only"
        case .unknown: return "Needs a newer app version"
        }
    }

    /// The state as a full value line: honest about what is and is not verified.
    static func stateLine(_ s: JobStageState) -> String {
        switch s {
        case .recorded: return "Recorded — not yet verified"
        case .partial: return "In progress"
        case .statusOnly: return "Marked, but no record behind it"
        case .absent: return "Not started"
        case .withheld: return withheldPayments
        case .unknown: return "Needs a newer app version"
        }
    }

    static let withheldPayments = "Payments are shown to the people on this job"

    static let notVerifiedNote = "Stages show what's on record — not yet verified."

    // MARK: Gaps and conflicts

    private static let gaps: [String: String] = [
        "no_vehicle": "No vehicle attached",
        "no_scope": "No description of the work",
        "no_inspection_requirement": "No inspection requested",
        "inspection_performer_unresolved": "No inspector found yet",
        "no_operations": "No operations planned",
        "operations_without_requirements": "Some operations have no requirements",
        "parts_without_operation_link": "Some parts aren't tied to an operation",
        "conflicting_specification": "Specifications disagree",
        "no_approval_clock": "Quote not accepted yet",
        "no_assignment": "No technician assigned",
        "no_schedule_window": "No schedule set",
        "no_start_clock": "No start date",
        "no_operation_record": "No work logged",
        "no_status_history": "No status history",
        "no_payment_record": "No payment recorded",
        "no_payout_record": "No payout recorded",
    ]

    private static let conflicts: [String: String] = [
        "assignment_accepted_status_without_clock": "Marked accepted, but no acceptance date",
        "assignment_completed_status_without_clock": "Assignment marked complete, but no completion date",
        "done_status_without_completion_clock": "Marked done, but no completion date",
        "paid_status_without_payment_record": "Marked paid, but no payment recorded",
        "payments_without_vehicle": "Payments recorded without a vehicle",
    ]

    private static let withheldReasons: [String: String] = [
        "acceptance_source_withdrawn": "the acceptance was withdrawn",
        "quote_source_withdrawn": "the quote was withdrawn",
        "quote_superseded": "a newer quote replaced the accepted one",
        "signer_no_longer_customer": "the person who accepted is no longer the customer",
        "scope_changed_since_quote": "the work changed since the quote",
    ]

    /// "Acceptance on hold: the work changed since the quote".
    static func acceptanceOnHold(_ reason: String?) -> String {
        guard let reason else { return "Acceptance on hold" }
        return "Acceptance on hold: " + (withheldReasons[reason] ?? sentence(reason).lowercased())
    }

    static func gap(_ code: String) -> String {
        if code.hasPrefix("acceptance_withheld_") { return acceptanceOnHold(String(code.dropFirst("acceptance_withheld_".count))) }
        return gaps[code] ?? sentence(code)
    }
    static func conflict(_ code: String) -> String { conflicts[code] ?? sentence(code) }

    // MARK: Facts

    private static let facts: [String: String] = [
        "vehicle_bound": "Vehicle attached",
        "scope_stated": "Work described",
        "request_source": "Requested from",
        "created_at": "Requested",
        "inspection_requirements": "Inspections requested",
        "with_performer_candidate": "Inspections with a candidate inspector",
        "operations": "Operations",
        "operations_with_requirements": "Operations with requirements",
        "requirements": "Requirements",
        "requirements_with_candidates": "Requirements with a candidate",
        "specifications": "Specifications",
        "conflicting_specifications": "Specifications that disagree",
        "parts": "Parts",
        "parts_with_operation_code": "Parts tied to an operation",
        "parts_by_status": "Parts by status",
        "labor_rows": "Labor lines",
        "labor_rows_with_hours": "Labor lines with hours",
        "labor_rows_ai_estimated": "Labor lines estimated automatically",
        "executable": "Ready to start",
        "quote_clock": "Quoted",
        "estimate_recorded": "Estimate on record",
        "approval_clock": "Quote accepted",
        "quote_versions": "Quote versions",
        "approval_signer": "Accepted by",
        "schedule_window_recorded": "Schedule set",
        "assignments": "Technicians assigned",
        "assignments_by_status": "Assignments by status",
        "assignments_with_accept_clock": "Assignments accepted (dated)",
        "customer_acceptance": "Customer acceptance",
        "start_clock": "Work started",
        "component_events": "Operations logged",
        "operations_complete_status": "Operations marked complete",
        "assignments_started": "Assignments started",
        "measured_usage": "Measured usage",
        "status": "Status",
        "completion_clock": "Completed",
        "status_history_rows": "Status changes on record",
        "payment_records": "Payments on record",
        "payment_records_by_status": "Payments by status",
        "vehicle_scoped_payment_events": "Vehicle payments on record",
        "vehicle_payment_job_attribution": "Vehicle payments tied to this job",
        "payouts_recorded": "Payouts on record",
        "payout_status": "Payouts by status",
        "labor_value_calculated": "Labor value calculated",
        "cost_allocated": "Cost allocated",
        "disbursement": "Paid out",
        "recorded_requirements": "Requirements on record",
        "recorded_specifications": "Specifications on record",
        "requested_specifications": "Specifications requested",
        "requested_specifications_compared": "Requested specifications compared",
        "requirement_population": "Requirement list complete",
        "specification_population": "Specification list complete",
    ]

    /// Reader bookkeeping that means nothing to a person (or that carries ids); never shown.
    static let hiddenFacts: Set<String> = ["source_scope", "current_quote", "quote_clock_basis", "approval_clock_basis",
                                           "stored_approval_clock", "visibility", "basis"]

    /// A value that is an id or a content hash: never primary text.
    static func isIdentifier(_ s: String) -> Bool {
        let uuid = #"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"#
        let hash = #"^[0-9a-f]{40,64}$"#
        return s.range(of: uuid, options: .regularExpression) != nil || s.range(of: hash, options: .regularExpression) != nil
    }

    /// Fact values that need their own words before the generic ones.
    static func factValue(_ key: String, _ v: JobJSON) -> String? {
        switch key {
        case "approval_signer":
            guard case .object(let o) = v else { return v == .null ? "Not accepted yet" : nil }
            let role = o["role"]?.stringValue.map(slot) ?? "customer"
            return o["basis"]?.stringValue == "authenticated_sign" ? "The \(role), signed through Nuke" : "The \(role)"
        case "customer_acceptance":
            switch v.stringValue {
            case "signed"?: return "Signed"
            case "withheld"?: return "On hold"
            default: return nil
            }
        default:
            return nil
        }
    }

    static func fact(_ key: String) -> String { facts[key] ?? sentence(key) }

    /// A reader value in plain words: yes/no, "Not on record", "Not assessed yet".
    static func value(_ v: JobJSON) -> String {
        switch v {
        case .bool(let b): return b ? "Yes" : "No"
        case .null: return "Not on record"
        case .string(let s):
            switch s {
            case "not_assessed": return "Not assessed yet"
            case "not_established": return "Not established yet"
            case "not_performed": return "Not yet"
            default:
                if isIdentifier(s) { return "On record" }
                if JobClock.date(s) != nil { return JobClock.text(s) ?? s }
                return s.contains("_") ? sentence(s) : s
            }
        case .object(let o):
            let keys = o.keys.sorted().filter { !$0.hasSuffix("_id") && !$0.hasSuffix("_hash") && $0 != "basis" }
            if keys.isEmpty { return "None" }
            return keys.map { "\(sentence($0).lowercased()) \(value(o[$0]!))" }.joined(separator: " · ")
        case .array(let a): return a.isEmpty ? "None" : a.map(value).joined(separator: ", ")
        case .number: return v.text
        }
    }

    // MARK: People

    private static let slots: [String: String] = [
        "customer": "customer",
        "org_owner": "shop owner",
        "vehicle_access": "has access to this vehicle",
        "admin": "Nuke admin",
        "performer": "technician",
        "inspector": "inspector",
        "tool_supplier": "tool supplier",
        "facility": "shop",
        "co_signer": "co-signer",
    ]

    static func slot(_ s: String) -> String { slots[s] ?? sentence(s).lowercased() }

    /// "customer · technician", or the context in plain words when the reader names no slot.
    static func viewingAs(_ viewer: JobViewer) -> String {
        if !viewer.slots.isEmpty { return viewer.slots.map(slot).joined(separator: " · ") }
        switch viewer.context {
        case .visitor: return "visitor"
        case .selfView: return "you"
        case .client: return "customer"
        case .provider: return "provider"
        case .orgMember: return "shop member"
        case .admin: return "Nuke admin"
        case .unknown: return "visitor"
        }
    }

    /// The technician-profile link, said plainly. nil when the reader did not say.
    static func technicianLink(_ rung: String?) -> String? {
        switch rung {
        case nil: return nil
        case "none"?, "unknown"?: return "Your account isn't linked to a technician profile yet"
        case "claimed"?, "self_claim"?: return "Linked by you — not yet backed by work"
        case "evidenced"?, "work_evidence"?: return "Linked and backed by your work"
        case "co_sign"?: return "Linked and vouched for"
        case "authenticated_sign"?: return "Linked and signed"
        case let other?: return sentence(other)
        }
    }

    // MARK: Technician profile claims

    static func claimStatus(_ status: String?) -> String {
        switch status {
        case "pending"?: return "Waiting for your work to back it up"
        case "approved"?: return "Confirmed"
        case "rejected"?: return "Not confirmed"
        case "expired"?: return "Expired"
        default: return "Status not available"
        }
    }

    static func claimRung(_ rung: String?) -> String {
        switch rung {
        case "self_claim"?, "unknown"?, nil: return "Linked by you"
        case "work_evidence"?: return "Backed by your work"
        case "co_sign"?: return "Vouched for by someone you worked with"
        case "authenticated_sign"?: return "Signed"
        case let other?: return sentence(other)
        }
    }

    static let linkExplainer = "Linked by you — Nuke confirms the link when your work backs it up."

    // MARK: Signing a work day

    private static let binds: [String: String] = [
        "self-confirmation of a photo-derived work day": "You worked on this vehicle that day, as your photos show.",
    ]
    private static let doesNotBind: [String: String] = [
        "counterparty acceptance": "That the customer agreed",
        "labor value": "A price for the labor",
        "payment": "Any payment",
    ]

    static func signBinds(_ s: String?) -> String {
        guard let s else { return "You worked on this vehicle that day." }
        return binds[s] ?? s.prefix(1).uppercased() + s.dropFirst()
    }

    static func signDoesNotBind(_ s: String) -> String { doesNotBind[s] ?? s.prefix(1).uppercased() + s.dropFirst() }

    /// Kinds the queue does not carry yet, in words: "quotes, offers, completion sign-offs".
    static func comingKinds(_ kinds: [String]) -> String? {
        let words: [String: String] = ["terms": "quotes", "offer": "offers",
                                       "completion_attestation": "completion sign-offs", "co_sign_request": "co-sign requests"]
        let list = kinds.map { words[$0] ?? sentence($0).lowercased() }
        guard !list.isEmpty else { return nil }
        let joined = list.count > 1 ? list.dropLast().joined(separator: ", ") + " and " + list.last! : list[0]
        return joined.prefix(1).uppercased() + joined.dropFirst() + " will appear here as they become available."
    }

    /// "3h 10m of photos" for a capture span.
    static func span(_ minutes: Int?) -> String? {
        guard let m = minutes, m > 0 else { return nil }
        return (m >= 60 ? "\(m / 60)h \(m % 60)m" : "\(m) min") + " of photos"
    }

    /// "Oct 17, 2026" for a yyyy-MM-dd day; the input when it does not parse.
    static func day(_ ymd: String?) -> String? {
        guard let ymd, !ymd.isEmpty else { return nil }
        let inF = DateFormatter()
        inF.locale = Locale(identifier: "en_US_POSIX")
        inF.timeZone = TimeZone(identifier: "UTC")
        inF.dateFormat = "yyyy-MM-dd"
        guard let d = inF.date(from: String(ymd.prefix(10))) else { return ymd }
        let out = DateFormatter()
        out.locale = Locale(identifier: "en_US_POSIX")
        out.timeZone = TimeZone(identifier: "UTC")
        out.dateFormat = "MMM d, yyyy"
        return out.string(from: d)
    }

    private static let evidence: [String: String] = [
        "session_images": "in this session",
        "vehicle_photos_that_day": "of this vehicle that day",
    ]

    /// "12 photos in this session · 41 photos of this vehicle that day".
    static func evidenceLine(_ counts: [String: JobJSON]) -> String? {
        guard !counts.isEmpty else { return nil }
        return counts.keys.sorted().map { key in
            let n = counts[key]!.text
            if let words = evidence[key] { return "\(n) photos \(words)" }
            return "\(n) \(sentence(key).lowercased())"
        }.joined(separator: " · ")
    }

    // MARK: Request source

    static func requestSource(_ code: String) -> String {
        switch code {
        case "ios": return "Nuke app"
        case "web": return "Nuke website"
        default: return code.contains("_") ? sentence(code) : code
        }
    }

    // MARK: Quotes

    /// "$160.00 / hour × 3", "$450.00", "Not priced".
    static func linePrice(_ line: QuoteLine) -> String {
        guard let amount = line.amount else { return "Not priced" }
        let money = JobMoney.format(amount, line.currency)
        let per: String? = {
            switch line.pricingBasis {
            case "hourly"?: return "hour"
            case "day_rate"?: return "day"
            case "per_operation"?: return "operation"
            default: return line.unit
            }
        }()
        guard let per, line.pricingBasis != "flat" else { return money }
        if let q = line.quantity {
            let qty = q == q.rounded() ? String(Int(q)) : String(q)
            return "\(money) / \(per) × \(qty)"
        }
        return "\(money) / \(per)"
    }

    static func lineLabel(_ line: QuoteLine) -> String {
        if let d = line.description { return d }
        if line.descriptionVisibility == "withheld_personal_info" { return "Line (details hidden to protect a name)" }
        return line.refKind.map(sentence) ?? "Line"
    }

    /// "$1,230.00", or the floor with a note when a rate line has no quantity.
    static func total(_ t: QuoteTotal) -> (value: String, note: String?) {
        let money = t.total.map { JobMoney.format($0, t.currency) } ?? "Not priced"
        return (money, t.complete ? nil : "At least — some lines are priced by rate without a quantity")
    }

    static func acceptance(_ a: QuoteAcceptance?) -> String {
        switch a?.state {
        case "accepted"?:
            let who = a?.acceptedByViewer == true ? "you" : "the customer"
            let when = JobCopy.day(a?.signedAt).map { " · \($0)" } ?? ""
            return "Accepted by \(who)\(when)"
        case "withheld"?: return acceptanceOnHold(a?.withheldReason)
        default: return "Not accepted yet"
        }
    }

    // MARK: Statement

    static func workStatus(_ s: String?) -> String {
        switch s {
        case "completed"?: return "Completed"
        case "paid"?: return "Paid"
        case "in_progress"?: return "In progress"
        case "pending"?, "draft"?: return "Not started"
        case "approved"?: return "Quote accepted"
        case "cancelled"?: return "Cancelled"
        case let other?: return sentence(other)
        case nil: return "Status not recorded"
        }
    }

    // MARK: Provider face

    /// The technician-profile link of someone else, in the third person.
    static func technicianLinkOf(_ rung: String?) -> String {
        switch rung {
        case "evidenced"?: return "Linked to a technician profile, backed by their work"
        case "claimed"?: return "Linked by them — not yet backed by work"
        default: return "Not linked to a technician profile"
        }
    }

    static func role(_ r: String) -> String {
        switch r {
        case "shop_owner": return "shop owner"
        default: return slot(r)
        }
    }

    static func relationState(_ s: String?) -> String? {
        switch s {
        case "live"?: return "active now"
        case "stalling"?: return "quiet lately"
        case "dormant"?: return "dormant"
        default: return nil
        }
    }

    /// "install 3 · paint 1", most first.
    static func operations(_ kinds: [String: Int]) -> String? {
        guard !kinds.isEmpty else { return nil }
        return kinds.sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }
            .map { "\(sentence($0.key).lowercased()) \($0.value)" }.joined(separator: " · ")
    }

    /// "1,396 h" for a capture span in hours.
    static func hours(_ h: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = h < 10 ? 1 : 0
        return (f.string(from: NSNumber(value: h)) ?? String(h)) + " h"
    }

    static func count(_ n: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        return f.string(from: NSNumber(value: n)) ?? String(n)
    }

    // MARK: Actions

    private static let actions: [String: String] = [
        "accept_terms": "Accept quote",
        "contact_request": "Contact via Nuke",
        "accept_quote": "Accept quote",
        "accept_offer": "Accept offer",
        "offer_on_requirement": "Make an offer",
        "attest_completion": "Confirm completion",
        "co_sign": "Co-sign",
        "accept_change_order": "Accept change order",
        "pay_deposit": "Pay deposit",
        "contact_via_nuke": "Contact via Nuke",
        "work_day": "Confirm work day",
        "work_session": "Confirm work day",
        "session": "Confirm photo session",
        "photo_session": "Confirm photo session",
    ]

    static func action(_ kind: String) -> String { actions[kind] ?? sentence(kind) }

    // MARK: Helpers

    /// "operations_without_requirements" → "Operations without requirements".
    static func sentence(_ code: String) -> String {
        let words = code.replacingOccurrences(of: "_", with: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }

    static func newerVersion(_ n: Int) -> String { "Some items need a newer app version (\(n))" }

    static func updated(_ clock: String?) -> String? { JobClock.text(clock).map { "Updated \($0)" } }
}
