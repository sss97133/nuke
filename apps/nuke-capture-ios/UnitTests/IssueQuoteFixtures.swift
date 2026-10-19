// IssueQuoteFixtures.swift — the quoting side's issue_quote action, the job's scope and the answer.
// Keys mirror pg_get_functiondef (work_order_quote_issue_action, issue_work_order_quote,
// project_work_order_quote_event line rules, work_order_quote_scope_snapshot, read_work_order_resources)
// on 2026-10-19; values synthetic. No writer is ever called with these.

enum IssueQuoteFixtures {
    static let workOrderId = JobFixtures.workOrderId
    static let quoteHash = "3f9a1c0e" + String(repeating: "ab", count: 28)

    private static func issueAction(supersedes: String?) -> String {
        """
        {"action":"issue_quote","rpc":"issue_work_order_quote",
         "args":{"p_work_order_id":"\(workOrderId)","p_lines":[],"p_deposit":null,"p_valid_until":null,
                 "p_supersedes_quote_id":\(supersedes.map { "\"\($0)\"" } ?? "null"),"p_release_conditions":null},
         "release_conditions_vocabulary":["customer_completion_sign","inspector_attestation","installed_parts_witness","photos_in_window",
                                          {"kind":"days_signed","days":"1..90"}],
         "release_conditions_basis":"optional; captured in the quote hash"}
        """
    }

    /// The shop owner on a job with no quote yet.
    static let noQuote = """
    {"work_order_id":"\(workOrderId)","as_of":"2026-10-19T17:00:00Z","current_quote":null,"history":[],
     "acceptance":{"state":"not_accepted"},"release_conditions":{"current":null,"accepted":null,"declared_by":"platform_standard"},
     "viewer":{"context":"provider","slots":["organization_owner"],"party":true,"actions":[],"issuer_actions":[\(issueAction(supersedes: nil))]}}
    """

    /// The same shop with its version 1 out and not accepted: issue_quote supersedes it.
    static let withQuote = """
    {"work_order_id":"\(workOrderId)","as_of":"2026-10-19T17:00:00Z",
     "current_quote":{"quote_id":"q1","version":1,"quote_hash":"\(String(repeating: "c2", count: 32))","quoting_party":{"kind":"organization","name":"Fixture Garage"},"issued_by_viewer":true,
       "lines":[{"ref_kind":"operation","ref_id":"op1","description":"Replace front pads and rotors","pricing_basis":"flat","amount":420,"currency":"USD"},
                {"ref_kind":"fee","ref_id":null,"description":"Shop supplies","pricing_basis":"flat","amount":25,"currency":"USD"},
                {"ref_kind":"requirement","ref_id":"rq2","description":"Road test","pricing_basis":"hourly","amount":160,"currency":"USD","unit":"hour","quantity":0.5}],
       "totals_by_currency":[{"currency":"USD","total":525,"complete":true}],"release_conditions":null},
     "history":[],"acceptance":{"state":"not_accepted"},
     "viewer":{"context":"provider","slots":["organization_owner"],"party":true,"actions":[],"issuer_actions":[\(issueAction(supersedes: "q1"))]}}
    """

    /// work_order_operations_read for an accepted technician (a party): every row carries its quote_ref.
    static let operationsRead = """
    {"work_order_id":"\(workOrderId)","as_of":"2026-10-19T17:50:00Z","work_order_status":"in_progress","display_title":"Front brake service",
     "operations":[
      {"id":"op1","line_number":1,"task_type":"replace","status":"pending","description":"Replace front pads and rotors","description_basis":"scope_description",
       "requested_by_role":"customer","requested_by_basis":"authenticated_sign",
       "requirements":[{"id":"rq1","requirement_kind":"skill","description":"Brake service","quantity":null,"unit":null,"quote_ref":{"ref_kind":"requirement","ref_id":"rq1"}}],
       "specifications":[],"quote_ref":{"ref_kind":"operation","ref_id":"op1"}},
      {"id":"op2","line_number":2,"task_type":"other","status":"pending","description":"Bleed the brake lines","requested_by_role":"accepted_provider",
       "requirements":[{"id":"rq2","requirement_kind":"inspection","description":"Road test after the brake bleed","quote_ref":{"ref_kind":"requirement","ref_id":"rq2"}},
                       {"id":"rq3","requirement_kind":"skill","description":"  ","quote_ref":{"ref_kind":"requirement","ref_id":"rq3"}}],
       "specifications":[],"quote_ref":{"ref_kind":"operation","ref_id":"op2"}},
      {"id":"op3","line_number":3,"task_type":"other","description":null,"description_visibility":"withheld_personal_info","requested_by_role":"scope_text_interpretation",
       "requirements":[],"specifications":[],"quote_ref":{"ref_kind":"operation","ref_id":"op3"}}],
     "scope_specifications":[],
     "parts":[{"id":"pt1","part_name":"Front rotor pair","part_number":"R-123","brand":"Fixture","quantity":2,"unit_price":85,"total_price":170,
               "status":"ordered","is_comped":false,"quote_ref":{"ref_kind":"part","ref_id":"pt1"}},
              {"id":"pt2","part_name":"Brake fluid","quantity":1,"unit_price":null,"total_price":null,"is_comped":true,"quote_ref":{"ref_kind":"part","ref_id":"pt2"}}],
     "labor":[{"id":"lb1","task_name":"Brake job labor","hours":2.5,"hourly_rate":140,"total_cost":350,"is_comped":false,"quote_ref":{"ref_kind":"labor","ref_id":"lb1"}}],
     "quote_line_refs":{"ref_kinds":["operation","requirement","part","labor","fee"],"fee":"fee lines carry no ref_id"},
     "viewer":{"context":"provider","slots":["accepted_provider"],"party":true,"quote_issuer_role":"accepted_provider","actions":[]},
     "payment_authorized":false}
    """

    static let issued = """
    {"quote_id":"q2","version":2,"quote_hash":"\(quoteHash)","work_order_id":"\(workOrderId)","supersedes_quote_id":"q1",
     "quoting_party":{"kind":"user","id":"u1"},"issued_by_role":"organization_owner","issued_at":"2026-10-19T17:05:00Z",
     "duplicate":false,"payment_authorized":false,"customer_notified":false}
    """
}

extension IssueQuoteFixtures {
    /// The same current quote issued by someone else: the viewer's version replaces it, but it isn't "theirs" to revise.
    static let withOthersQuote = withQuote.replacingOccurrences(of: #""issued_by_viewer":true"#, with: #""issued_by_viewer":false"#)
}
