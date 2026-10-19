// NotificationFixtures.swift — user_notifications rows for tests. Test-only; never in the app bundle.
// Columns and metadata keys mirror the live table read-only on 2026-10-19 (one row per kind and
// link shape: profile_import_ready, vehicle_merged with and without notification_type,
// vehicle_update, welcome) plus the notify_payment_received trigger's insert shape. Ids, handles
// and text are synthetic; nothing here is ever sent to production.

enum NotificationFixtures {
    static let vehicleId = "00000000-0000-4000-8000-0000000000a1"
    static let mergedVehicleId = "00000000-0000-4000-8000-0000000000a2"
    static let organizationId = "00000000-0000-4000-8000-0000000000b1"
    static let workOrderId = "00000000-0000-4000-8000-000000000001"
    static let contactRequestId = "00000000-0000-4000-8000-0000000000c1"

    static let page = """
    [
     {"id":"00000000-0000-4000-8000-00000000f001","type":"profile_import_ready","notification_type":"profile_import_ready",
      "title":"Your fixture profile is ready","message":"Claim it to link your history.","vehicle_id":null,"organization_id":null,
      "action_url":"/claim-identity?platform=bat&handle=fixture_handle",
      "metadata":{"handle":"fixture_handle","platform":"bat","profile_url":"https://example.invalid/member/fixture_handle"},
      "is_read":false,"read_at":null,"created_at":"2026-02-28T21:25:25.137191+00:00"},
     {"id":"00000000-0000-4000-8000-00000000f002","type":"vehicle_merged","notification_type":null,
      "title":"Duplicate merged","message":"Two records of the same fixture car were merged.","vehicle_id":null,"organization_id":null,
      "action_url":"/vehicle/\(mergedVehicleId)",
      "metadata":{"type":"vehicle_merged","merged_at":"2026-01-11T20:39:38Z","confidence":95,"match_type":"vin",
                  "primary_vehicle_id":"\(mergedVehicleId)","duplicate_vehicle_id":"00000000-0000-4000-8000-0000000000a3"},
      "is_read":true,"read_at":"2026-01-12T08:00:00+00:00","created_at":"2026-01-11T20:39:38.970109+00:00"},
     {"id":"00000000-0000-4000-8000-00000000f003","type":"vehicle_merged","notification_type":"vehicle_merged",
      "title":"Duplicate merged","message":"Merged into the primary record.","vehicle_id":null,"organization_id":null,
      "action_url":null,
      "metadata":{"type":"vehicle_merged","merged_at":"2025-11-28T14:39:22Z","action_url":"/vehicle/\(mergedVehicleId)",
                  "confidence":90,"match_type":"vin","vehicle_id":"\(mergedVehicleId)",
                  "primary_vehicle_id":"\(mergedVehicleId)","duplicate_vehicle_id":"00000000-0000-4000-8000-0000000000a3"},
      "is_read":true,"read_at":"2025-11-29T08:00:00+00:00","created_at":"2025-11-28T14:39:22.163517+00:00"},
     {"id":"00000000-0000-4000-8000-00000000f004","type":"vehicle_update","notification_type":"vehicle_update",
      "title":"New comparable found","message":"A fixture comparable was added.","vehicle_id":"\(vehicleId)","organization_id":null,
      "action_url":"/vehicle/\(vehicleId)",
      "metadata":{"event":"comp_found","source":"fixture","comp_price":1,"vehicle_id":"\(vehicleId)","estimated_value":1},
      "is_read":false,"read_at":null,"created_at":"2026-03-08T04:43:53.833432+00:00"},
     {"id":"00000000-0000-4000-8000-00000000f005","type":"welcome","notification_type":"welcome",
      "title":"Welcome to Fixture Garage","message":"You were added to the team.","vehicle_id":null,"organization_id":"\(organizationId)",
      "action_url":null,
      "metadata":{"user_role":"member","organization_id":"\(organizationId)","notification_type":"welcome","organization_name":"Fixture Garage"},
      "is_read":false,"read_at":null,"created_at":"2025-11-25T00:03:43.048068+00:00"},
     {"type":"welcome","title":"A row without an id"}
    ]
    """

    /// notify_payment_received's insert: type only, the link in metadata.link_url, no action_url.
    static let paymentReceived = """
    {"id":"00000000-0000-4000-8000-00000000f006","type":"payment_received","notification_type":null,
     "title":"Payment Received: $1","message":"You received $1 via fixture","vehicle_id":null,"organization_id":null,
     "action_url":null,"metadata":{"amount_cents":100,"payment_method":"fixture","reference_id":null,"link_url":"/wallet"},
     "is_read":false,"read_at":null,"created_at":"2025-10-21T17:27:28.433325+00:00"}
    """

    static func row(actionUrl: String? = nil, vehicleId: String? = nil, organizationId: String? = nil,
                    metadata: String = "{}", type: String = "vehicle_update") -> String {
        func q(_ s: String?) -> String { s.map { "\"\($0)\"" } ?? "null" }
        return """
        {"id":"00000000-0000-4000-8000-00000000f0ff","type":"\(type)","notification_type":null,"title":"Fixture","message":null,
         "vehicle_id":\(q(vehicleId)),"organization_id":\(q(organizationId)),"action_url":\(q(actionUrl)),"metadata":\(metadata),
         "is_read":false,"read_at":null,"created_at":"2026-10-19T08:00:00Z"}
        """
    }
}
