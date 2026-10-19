// ContactFixtures.swift — Contact via Nuke JSON for tests. DEBUG-only (unit tests and the UI-test fixture backend); never compiled into Release.
// Keys mirror pg_get_functiondef (my_contact_requests, contact_request_item, contact_thread_read,
// request_contact and the readers' contact blocks) on 2026-10-19; values synthetic. Nothing here
// is ever sent to production.

#if DEBUG
enum ContactFixtures {
    static let profileId = "00000000-0000-4000-8000-0000000000c1"

    static let availableBlock = """
    {"action":"contact_via_nuke","available":true,
     "request":{"writer":"request_contact","context_kind":"profile","context_id":"\(profileId)",
                "recipient_user_id":"\(profileId)","recipient_actor_id":null},
     "basis":"contact between users is brokered by Nuke; contact fields are never exposed"}
    """

    static let unavailableBlock = """
    {"action":"contact_via_nuke","available":false,
     "request":{"writer":"request_contact","context_kind":"work_order","context_id":"00000000-0000-4000-8000-000000000001"}}
    """

    static let requirementBlock = """
    {"action":"contact_via_nuke","available":true,
     "request":{"writer":"request_contact","context_kind":"requirement","context_id":"requirement_id of the row"}}
    """

    private static func item(id: String, direction: String, counterpart: String, status: String, actions: String,
                             context: String, message: String, messages: Int) -> String {
        """
        {"request_id":"\(id)","direction":"\(direction)","counterpart":\(counterpart),"recipient_kind":"user",
         "context":\(context),"message":"\(message)","status":"\(status)","created_at":"2026-10-19T08:00:00Z",
         "responded_at":null,"withdrawn_at":null,"thread":{"messages":\(messages),"last_message_at":null},"actions":\(actions)}
        """
    }

    static let inbox = """
    {"viewer":{"context":"self","slots":[]},"as_of":"2026-10-19T09:00:00Z",
     "incoming":[
      \(item(id: "00000000-0000-4000-8000-00000000c001", direction: "incoming",
             counterpart: #"{"kind":"user","profile_id":"p2","handle":"fixture_owner"}"#, status: "pending",
             actions: #"["respond_contact_request"]"#,
             context: #"{"kind":"work_order","id":"00000000-0000-4000-8000-000000000001","label":"Exhaust fabrication"}"#,
             message: "Could you look at the exhaust hangers next week?", messages: 0)),
      \(item(id: "00000000-0000-4000-8000-00000000c002", direction: "incoming",
             counterpart: #"{"kind":"user","label":"unnamed party"}"#, status: "accepted",
             actions: #"["post_contact_message"]"#,
             context: #"{"kind":"profile","id":"p1","label":null}"#,
             message: "Do you take K5 wiring jobs?", messages: 3)),
      {"broken":"item"}
     ],
     "outgoing":[
      \(item(id: "00000000-0000-4000-8000-00000000c003", direction: "outgoing",
             counterpart: #"{"kind":"organization","organization_id":"o1","name":"Fixture Garage"}"#, status: "pending",
             actions: #"["withdraw_contact_request"]"#,
             context: #"{"kind":"vehicle","id":"v1","label":"1983 GMC K2500"}"#,
             message: "Is the truck still for sale?", messages: 0))
     ],
     "limits":{"requests_per_day":10,"requests_sent_last_day":3,"messages_per_thread_per_day":200},
     "delivery":"in_app only; no e-mail, SMS or push","contact_fields":"never exposed"}
    """

    static let thread = """
    {"viewer":{"context":"self","slots":[]},"as_of":"2026-10-19T09:00:00Z",
     "request":\(item(id: "00000000-0000-4000-8000-00000000c002", direction: "incoming",
                      counterpart: #"{"kind":"user","profile_id":"p3","handle":"fixture_owner"}"#, status: "accepted",
                      actions: #"["post_contact_message"]"#, context: #"{"kind":"profile","id":"p1","label":null}"#,
                      message: "Do you take K5 wiring jobs?", messages: 2)),
     "messages":[
      {"message_id":"m1","author":{"kind":"user","profile_id":"p3","handle":"fixture_owner"},"body":"Do you have time this month?","created_at":"2026-10-19T08:10:00Z"},
      {"message_id":"m2","author":{"kind":"you"},"body":"Yes, after the 25th.","created_at":"2026-10-19T08:30:00Z"}
     ],
     "can_post":true,"visibility":"the two parties only (and the recipient organization's owners and members)"}
    """

    static let sendReceipt = """
    {"request_id":"00000000-0000-4000-8000-00000000c009","status":"pending",
     "recipient":{"kind":"user","profile_id":"\(profileId)","handle":"fixture_tech"},"delivery":"in_app"}
    """
}
#endif
