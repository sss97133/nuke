// CloseoutFixtures.swift — completion, invoice, evidence and the widened signature queue, for tests.
// DEBUG-only (unit tests and the UI-test fixture backend); never compiled into Release. Keys mirror pg_get_functiondef / the B8 backend receipt and
// live anon output on 2026-10-19; values synthetic. No writer is ever called with these.

#if DEBUG
enum CloseoutFixtures {
    static let workOrderId = "00000000-0000-4000-8000-000000000001"
    static let completionId = "00000000-0000-4000-8000-0000000000c7"
    static let completionHash = String(repeating: "ef", count: 32)
    static let scopeHash = String(repeating: "12", count: 32)
    static let invoiceId = "00000000-0000-4000-8000-0000000000f7"

    static func completionStage(attested: Bool, accepted: Bool) -> String {
        let att = attested ? """
        {"completion_id":"\(completionId)","completion_hash":"\(completionHash)","signed_at":"2026-10-18T17:00:00Z",
         "signer_role":"accepted_provider","scope_basis":"accepted_quote","quote_id":"q1","evidence_count":2,"basis":"authenticated_sign"}
        """ : "null"
        let acc = accepted ? #"{"acceptance_id":"a1","signed_at":"2026-10-19T09:00:00Z","basis":"authenticated_sign"}"# : "null"
        return """
        {"state":"\(attested ? "recorded" : "absent")","state_basis":"\(attested ? "provider_completion_attestation" : "no_completion_sign")",
         "status":"in_progress","completion_clock":null,"status_history_rows":0,
         "provider_attestation":\(att),"customer_acceptance":"\(accepted ? "established" : "not_established")",
         "customer_acceptance_sign":\(acc),"attestations_withheld":0,"acceptances_withheld":0,
         "scope_basis":{"basis":"accepted_quote","quote_id":"q1","scope_hash":"\(scopeHash)"},
         "gaps":\(accepted ? "[]" : (attested ? #"["no_customer_completion_acceptance"]"# : #"["no_provider_completion_attestation"]"#)),
         "inconsistencies":[]}
        """
    }

    static func jobPath(attested: Bool, accepted: Bool, customer: Bool) -> String {
        """
        {"work_order_id":"\(workOrderId)","vehicle_id":"v1","as_of":"2026-10-19T12:00:00Z","display_title":"Brake service",
         "stages":{"completion":\(completionStage(attested: attested, accepted: accepted))},
         "viewer":{"context":"\(customer ? "client" : "provider")","slots":\(customer ? #"["customer"]"# : #"["performer"]"#),"actions":[]}}
        """
    }

    static func invoices(party: Bool, asPayer: Bool = true) -> String {
        let partyBlock = party ? """
        "payments":[
         {"payment_witness_id":"pw1","invoice_id":"\(invoiceId)","witness_side":"payer","witness_role":"customer","amount":300,"currency":"USD",
          "method":"bank_transfer","paid_at":"2026-10-18T00:00:00Z","reference":"INV-1","witnessed_at":"2026-10-18T01:00:00Z",
          "witness":{"kind":"user","handle":"fixture_owner","user_id":"u1"}},
         {"payment_witness_id":"pw2","invoice_id":"\(invoiceId)","witness_side":"payee","witness_role":"accepted_provider","amount":300,"currency":"USD",
          "method":"bank_transfer","paid_at":"2026-10-18T00:00:00Z","reference":null,"witnessed_at":"2026-10-18T02:00:00Z",
          "witness":{"kind":"user","handle":"fixture_tech","user_id":"u2"}}],
        "reconciliation":{"invoice_id":"\(invoiceId)","invoice_version":2,"currency":"USD","invoice_total":500,"confirmed_received":300,
          "payer_reported":300,"balance_due":200,"overpaid_by":0,"payee_witnesses":1,"payer_witnesses":1,"state":"partially_paid"},
        "release":{"met":false,"conditions":[
          {"key":"quote_accepted_by_customer","met":true,"basis":"quote_acceptance:x"},
          {"key":"completion_attested_by_provider","met":true,"basis":"completion_attestation:x"},
          {"key":"completion_accepted_by_customer","met":false,"basis":null},
          {"key":"invoice_current","met":true,"basis":"invoice:x:v2"},
          {"key":"invoice_settled_by_payee_witness","met":false,"basis":"reconciliation:partially_paid"}],
          "payment_authorized":false,"disbursement":"not_performed"},
        "payments_visibility":"shown_to_party",
        "viewer":{"context":"\(asPayer ? "client" : "provider")","slots":\(asPayer ? #"["customer"]"# : #"["payee"]"#),"party":true,
          "actions":[\(asPayer ? "" : #"{"action":"issue_invoice","rpc":"issue_work_order_invoice","args":{"p_work_order_id":"\#(workOrderId)"}},"#)
                     {"action":"record_payment","rpc":"record_work_order_payment","args":{"p_invoice_id":"\(invoiceId)"},"as":"\(asPayer ? "payer" : "payee")"}]},
        """ : """
        "payments":null,"reconciliation":null,"release":null,"payments_visibility":"withheld_not_party",
        "viewer":{"context":"visitor","slots":[],"party":false,"actions":[]},
        """
        return """
        {"vehicle_label":{"text":"1983 GMC K2500 Sierra Classic"},"display_title":"Brake service","work_order_id":"\(workOrderId)",
         "as_of":"2026-10-19T12:00:00Z",
         "invoices":[
          {"invoice_id":"\(invoiceId)","version":2,"current":true,"status":"current","issued_at":"2026-10-17T12:00:00Z","due_at":"2026-10-31T00:00:00Z",
           "invoice_hash":"\(String(repeating: "aa", count: 32))","issuer":{"kind":"user","handle":"fixture_tech","role":"accepted_provider"},
           "quote":{"quote_id":"q1","quote_hash":"h","quote_version":2},"currency":"USD",
           "lines":[
            {"line":0,"quote_line":0,"description":"Front brake job","pricing_basis":"flat","amount":300,"currency":"USD","unit":null,"quantity":null,
             "line_total":300,"change":"unchanged","changed_fields":[],"quote_line_total":300},
            {"line":1,"quote_line":1,"description":"Labor","pricing_basis":"hourly","amount":100,"currency":"USD","unit":"hour","quantity":1.5,
             "line_total":150,"change":"changed","changed_fields":["quantity"],"quote_line_total":100},
            {"line":2,"quote_line":null,"description":"Brake fluid","pricing_basis":"flat","amount":50,"currency":"USD","unit":null,"quantity":null,
             "line_total":50,"change":"added","changed_fields":[],"quote_line_total":null}],
           "total":500,
           "changes_from_quote":{"basis":"accepted_quote","unchanged":1,"changed":1,"added":1,"omitted_quote_lines":[],"quote_total":440,
             "quote_total_complete":true,"delta_from_quote":60,"totals_basis":"text"},
           "attribution":"authenticated_sign"},
          {"invoice_id":"old","version":1,"current":false,"status":"superseded_by_later_version","currency":"USD","lines":[],"total":440}],
         "current_invoice_id":"\(invoiceId)",
         \(partyBlock)
         "coverage":{"invoice_versions":2},"money_moved":false,"payment_authorized":false,"disbursement":"not_performed"}
        """
    }

    static let evidence = """
    {"viewer":{"context":"self","slots":[]},"as_of":"2026-10-19T12:00:00Z",
     "work_orders":[
      {"work_order_id":"\(workOrderId)","role":"accepted_provider","window":{"from":"2026-10-01T00:00:00Z","until":"2026-10-20T00:00:00Z"},
       "display_title":"Brake service","vehicle_label":{"text":"1983 GMC K2500 Sierra Classic"}},
      {"work_order_id":"00000000-0000-4000-8000-000000000002","role":"customer","window":{},"display_title":null,"vehicle_label":{"text":"1969 Ford Mustang"}}],
     "items":[
      {"image_id":"img-1","work_order_id":"\(workOrderId)","captured_at":"2026-10-05T15:00:00Z","clock_basis":"taken_at","image_url":"https://example.test/a.jpg","vision_gate_status":"approved"},
      {"image_id":"img-2","work_order_id":"\(workOrderId)","captured_at":"2026-10-05T15:10:00Z","clock_basis":"taken_at","image_url":"https://example.test/b.jpg","vision_gate_status":"approved"},
      {"image_id":"img-3","work_order_id":"00000000-0000-4000-8000-000000000002","captured_at":"2026-10-06T10:00:00Z"}],
     "next_after":null,
     "coverage":{"returned":3,"limit":200,"work_orders_considered":2,"not_attachable_excluded":4},
     "sign":{"rpc":"attach_job_evidence","args_hint":{},"binds":["your statement that these own photos document this job"],
             "does_not_bind":["image visibility or ownership","completion","payment"]}}
    """

    static let queue = """
    {"viewer":{"context":"self","slots":[]},"as_of":"2026-10-19T12:00:00Z",
     "items":[
      {"kind":"completion_to_accept","ref_id":"\(completionId)","work_order_id":"\(workOrderId)","display_title":"Brake service",
       "vehicle_label":{"text":"1983 GMC K2500 Sierra Classic"},"clock":"2026-10-18T17:00:00Z","summary":"@fixture_tech marked the work done.",
       "sign":{"rpc":"accept_work_completion","args_hint":{"p_work_order_id":"\(workOrderId)"},
               "binds":["you agree the work is done as attested"],"does_not_bind":["payment","disbursement"]}},
      {"kind":"invoice_payment_to_confirm","ref_id":"pw1","work_order_id":"\(workOrderId)","display_title":"Brake service",
       "clock":"2026-10-18T00:00:00Z","summary":"The customer reported paying $300.00.",
       "sign":{"rpc":"record_work_order_payment","binds":["you received this payment"],"does_not_bind":["money movement"]}},
      {"kind":"contact_request","ref_id":"c1","work_order_id":null,"display_title":null,"clock":"2026-10-19T08:00:00Z","summary":"@fixture_owner wants to reach you.",
       "sign":{"rpc":"respond_contact_request","binds":["you accept or decline being contacted"],"does_not_bind":["contact details"]}},
      {"kind":"work_session","ref_id":"s1","work_order_id":null,"vehicle":{"year":1977,"make":"Chevrolet","model":"Blazer"},
       "clock":{"session_date":"2026-10-17"},"capture_span_minutes":90,"evidence_counts":{"session_images":5},
       "sign":{"rpc":"confirm_work_session","binds":"self-confirmation of a photo-derived work day","does_not_bind":["payment"]}},
      {"kind":"teleport_request","ref_id":"z1","display_title":"Something new"}
     ],
     "coverage":{"returned":5,"total":5,"kinds":["completion_to_accept","invoice_payment_to_confirm","contact_request","work_session"],"kinds_not_yet_available":[]}}
    """
}
#endif
