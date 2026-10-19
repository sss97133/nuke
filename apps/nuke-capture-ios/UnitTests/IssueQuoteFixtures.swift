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
     "current_quote":{"quote_id":"q1","version":1,"quote_hash":"\(String(repeating: "c2", count: 32))","quoting_party":{"kind":"organization","name":"Fixture Garage"},
       "lines":[{"ref_kind":"operation","ref_id":"op1","description":"Replace front pads and rotors","pricing_basis":"flat","amount":420,"currency":"USD"},
                {"ref_kind":"fee","ref_id":null,"description":"Shop supplies","pricing_basis":"flat","amount":25,"currency":"USD"},
                {"ref_kind":"requirement","ref_id":"rq2","description":"Road test","pricing_basis":"hourly","amount":160,"currency":"USD","unit":"hour","quantity":0.5}],
       "totals_by_currency":[{"currency":"USD","total":525,"complete":true}],"release_conditions":null},
     "history":[],"acceptance":{"state":"not_accepted"},
     "viewer":{"context":"provider","slots":["organization_owner"],"party":true,"actions":[],"issuer_actions":[\(issueAction(supersedes: "q1"))]}}
    """

    static let resources = """
    {"work_order_id":"\(workOrderId)","requirements":[
      {"id":"rq1","line_item_id":"op1","requirement_kind":"skill","description":"Brake service","quantity":null,"unit":null},
      {"id":"rq2","line_item_id":"op2","requirement_kind":"inspection","description":"Road test after the brake bleed","quantity":null,"unit":null},
      {"id":"rq3","line_item_id":"op2","requirement_kind":"skill","description":"  "}],
     "fulfillments":[],"specifications":[]}
    """

    static let operations = """
    [{"id":"op1","line_number":1,"task_description":"Replace front pads and rotors"},
     {"id":"op2","line_number":2,"task_description":"Bleed the brake lines"},
     {"id":"op3","line_number":3,"task_description":null}]
    """

    static let issued = """
    {"quote_id":"q2","version":2,"quote_hash":"\(quoteHash)","work_order_id":"\(workOrderId)","supersedes_quote_id":"q1",
     "quoting_party":{"kind":"user","id":"u1"},"issued_by_role":"organization_owner","issued_at":"2026-10-19T17:05:00Z",
     "duplicate":false,"payment_authorized":false,"customer_notified":false}
    """
}
