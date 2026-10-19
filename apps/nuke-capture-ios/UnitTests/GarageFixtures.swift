// GarageFixtures.swift — reader answers in their live shapes, read-only on 2026-10-19 as a signed-in
// account (vehicle identities, ids and image paths replaced with fixture values).

enum GarageFixtures {
    /// my_unorganized_photo_count for an account with more than its 1,000 cap: a bare integer.
    static let unorganizedAtCap = "1000"
    static let unorganizedSome = "37"

    /// get_user_garage: one row per relationship the record holds, as the owner's own reader returns them.
    static let garage = #"""
    [
      {"vehicle_id":"00000000-0000-4000-8000-000000000001","year":1966,"make":"Fixture","model":"Coupe","trim_name":null,
       "image_url":"https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-photos/fixture/a.jpg",
       "current_value":null,"purchase_price":null,"image_count":1863,"relationship":"owner"},
      {"vehicle_id":"00000000-0000-4000-8000-000000000002","year":1965,"make":"Fixture","model":"Roadster","trim_name":null,
       "image_url":null,"current_value":null,"purchase_price":null,"image_count":24,"relationship":"previously_owned"},
      {"vehicle_id":"00000000-0000-4000-8000-000000000003","year":1931,"make":"Fixture","model":"Hot Rod","trim_name":null,
       "image_url":null,"current_value":null,"purchase_price":null,"image_count":1,"relationship":"contributor"}
    ]
    """#

    /// get_my_garage_owner_corrections: the account states a current interest in vehicle 1, under dispute.
    static let disputedOwnerStatement = #"""
    [{"id":"c1","vehicle_id":"00000000-0000-4000-8000-000000000001",
      "correction":{"relationship":{"roles":["owner_current"],"ownership_denied":false,"title_status":"in_name",
                                    "disputed":true,"start_date":null,"end_date":null},"cover_image_id":null},
      "observed_at":"2026-10-18T00:00:00+00:00","cover_image_url":null}]
    """#

    /// vehicle_row_read for an insider: the whole vehicles row (abridged here; the garage ignores the rest).
    static let vehicleRow = #"""
    {"id":"00000000-0000-4000-8000-000000000001","year":1966,"make":"Fixture","model":"Coupe","normalized_model":"Coupe",
     "trim":null,"status":"active","is_public":true,"deleted_at":null,"merged_into_vehicle_id":null,
     "updated_at":"2026-10-17T13:03:11.884159+00:00","license_plate":null,"purchase_price":null,"owner_id":null,
     "bat_bids":null,"image_count":1863,"data_gaps":[],"equipment":null}
    """#

    static let vehicleRowPrivateMerged = #"""
    {"id":"00000000-0000-4000-8000-000000000004","year":null,"make":"Fixture","model":"truck","normalized_model":"Pickup",
     "trim":"Custom","is_public":null,"deleted_at":"2026-10-12T08:00:00+00:00",
     "merged_into_vehicle_id":"00000000-0000-4000-8000-000000000005"}
    """#

    /// vehicle_row_read for a vehicle that doesn't exist or isn't shared with the viewer.
    static let vehicleRowHidden = "null"
}
