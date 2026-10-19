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
        case .unknown: return "Needs a newer app version"
        }
    }

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

    static func gap(_ code: String) -> String { gaps[code] ?? sentence(code) }
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

    /// Reader bookkeeping that means nothing to a person; never shown.
    static let hiddenFacts: Set<String> = ["source_scope"]

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
                if JobClock.date(s) != nil { return JobClock.text(s) ?? s }
                return s.contains("_") ? sentence(s) : s
            }
        case .object(let o):
            if o.isEmpty { return "None" }
            return o.keys.sorted().map { "\(sentence($0).lowercased()) \(o[$0]!.text)" }.joined(separator: " · ")
        case .array(let a): return a.isEmpty ? "None" : a.map(value).joined(separator: ", ")
        case .number: return v.text
        }
    }

    // MARK: People

    private static let slots: [String: String] = [
        "customer": "customer",
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

    // MARK: Actions

    private static let actions: [String: String] = [
        "accept_terms": "Accept quote",
        "accept_quote": "Accept quote",
        "accept_offer": "Accept offer",
        "offer_on_requirement": "Make an offer",
        "attest_completion": "Confirm completion",
        "co_sign": "Co-sign",
        "accept_change_order": "Accept change order",
        "pay_deposit": "Pay deposit",
        "contact_via_nuke": "Contact via Nuke",
        "contact_request": "Contact via Nuke",
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
