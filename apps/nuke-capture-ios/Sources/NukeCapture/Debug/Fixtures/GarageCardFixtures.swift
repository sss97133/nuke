// GarageCardFixtures.swift — the garage cards' readers in their live shapes (get_user_garage with
// last_activity_at, get_vehicle_contribution_days_batch, vehicle_profile_read, vehicle_statements), with fixture
// identities and ids. Shapes read live 2026-11-20 (batch reader rows: [date, photos, work, events, documents];
// masthead.price a Claim). DEBUG only; shared with the unit tests. Scenario "garage-cards".

#if DEBUG
import Foundation

enum GarageCardFixtures {
    static let owned = "00000000-0000-4000-8000-00000000c101"
    static let contributed = "00000000-0000-4000-8000-00000000c102"
    static let previous = "00000000-0000-4000-8000-00000000c103"
    static let older = "00000000-0000-4000-8000-00000000c104"
    static let undated = "00000000-0000-4000-8000-00000000c105"

    /// The owned car's cover and reel: fixture urls (they load nothing; the pager and its count are what is tested).
    static let cover = "https://fixture.nuke.invalid/garage/cover.jpg"
    static func reel(now: Date = Date()) -> String {
        """
        [{"image_url":"\(cover)","taken_at":"\(day(16, now: now))T10:00:00Z","is_sensitive":false},
         {"image_url":"https://fixture.nuke.invalid/garage/2.jpg","taken_at":"\(day(2, now: now))T10:00:00Z","is_sensitive":null},
         {"image_url":"https://fixture.nuke.invalid/garage/3.jpg","taken_at":null,"is_sensitive":false}]
        """
    }

    /// "yyyy-MM-dd", `days` before today (UTC).
    static func day(_ daysAgo: Int, now: Date = Date()) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(secondsFromGMT: 0)
        return f.string(from: now.addingTimeInterval(-Double(daysAgo) * 86_400))
    }

    /// get_user_garage: the server's order is not the garage's; the client orders by last_activity_at.
    static func garage(now: Date = Date()) -> String {
        """
        [{"vehicle_id":"\(older)","year":1966,"make":"Fixture","model":"Roadster","trim_name":null,"image_url":null,
          "current_value":45000,"purchase_price":null,"image_count":12,"relationship":"owner","last_activity_at":"2024-05-02T17:00:00+00:00"},
         {"vehicle_id":"\(undated)","year":1984,"make":"Fixture","model":"Wagon","trim_name":null,"image_url":null,
          "current_value":null,"purchase_price":null,"image_count":0,"relationship":"profile_record","last_activity_at":null},
         {"vehicle_id":"\(owned)","year":1973,"make":"Fixture","model":"Coupe","trim_name":"Formula","image_url":"\(cover)",
          "current_value":99999,"purchase_price":null,"image_count":240,"relationship":"owner","last_activity_at":"\(day(2, now: now))T15:00:00+00:00"},
         {"vehicle_id":"\(contributed)","year":1972,"make":"Fixture","model":"Pickup","trim_name":null,"image_url":null,
          "current_value":null,"purchase_price":null,"image_count":64,"relationship":"contributor","last_activity_at":"\(day(40, now: now))T15:00:00+00:00"},
         {"vehicle_id":"\(previous)","year":1979,"make":"Fixture","model":"Sedan","trim_name":null,"image_url":null,
          "current_value":null,"purchase_price":null,"image_count":8,"relationship":"previously_owned","last_activity_at":null}]
        """
    }

    /// vehicles metadata for the same ids (VINs only where the record has one).
    static let metadata = """
    [{"id":"\(owned)","year":1973,"make":"Fixture","model":"Coupe","normalized_model":null,"trim":"Formula","vin":"FX87X3N100001","primary_image_url":null,"image_count":240},
     {"id":"\(contributed)","year":1972,"make":"Fixture","model":"Pickup","normalized_model":null,"trim":null,"vin":null,"primary_image_url":null,"image_count":64},
     {"id":"\(previous)","year":1979,"make":"Fixture","model":"Sedan","normalized_model":null,"trim":null,"vin":"FX79S000000000009","primary_image_url":null,"image_count":8},
     {"id":"\(older)","year":1966,"make":"Fixture","model":"Roadster","normalized_model":null,"trim":null,"vin":null,"primary_image_url":null,"image_count":12},
     {"id":"\(undated)","year":1984,"make":"Fixture","model":"Wagon","normalized_model":null,"trim":null,"vin":null,"primary_image_url":null,"image_count":0}]
    """

    /// get_vehicle_contribution_days_batch: the owned car busy this year, the contribution a few days, the
    /// previous car dated only by its timeline (last_activity_at null), the older car outside the window.
    static func timelines(now: Date = Date()) -> String {
        func cells(_ rows: [(Int, Int, Int, Int, Int)]) -> String {
            rows.map { "[\"\(day($0.0, now: now))\", \($0.1), \($0.2), \($0.3), \($0.4)]" }.joined(separator: ", ")
        }
        let busy: [(Int, Int, Int, Int, Int)] = [(2, 40, 1, 0, 0), (5, 12, 0, 1, 0), (9, 3, 1, 0, 2), (16, 60, 1, 0, 0),
            (30, 6, 0, 0, 0), (44, 18, 1, 0, 1), (71, 2, 0, 1, 0), (98, 25, 1, 0, 0), (130, 9, 0, 0, 0),
            (160, 1, 0, 0, 0), (200, 33, 1, 0, 0), (260, 4, 0, 1, 0), (300, 14, 0, 0, 0), (340, 7, 1, 0, 0)]
        let few: [(Int, Int, Int, Int, Int)] = [(40, 30, 0, 0, 0), (41, 20, 0, 0, 0), (120, 14, 0, 0, 0)]
        return """
        [{"vehicle_id":"\(owned)","first_day":"2021-03-14","last_day":"\(day(2, now: now))","active_days":\(busy.count),
          "photos":234,"work_days":7,"events":4,"documents":3,"days":[["2021-03-14", 6, 0, 0, 0], \(cells(busy))]},
         {"vehicle_id":"\(contributed)","first_day":"\(day(120, now: now))","last_day":"\(day(40, now: now))","active_days":3,
          "photos":64,"work_days":0,"events":0,"documents":0,"days":[\(cells(few))]},
         {"vehicle_id":"\(previous)","first_day":"2019-06-01","last_day":"2023-08-19","active_days":2,
          "photos":8,"work_days":0,"events":1,"documents":0,"days":[["2019-06-01", 0, 0, 1, 0], ["2023-08-19", 8, 0, 0, 0]]},
         {"vehicle_id":"\(older)","first_day":"2024-05-02","last_day":"2024-05-02","active_days":1,
          "photos":12,"work_days":0,"events":0,"documents":0,"days":[["2024-05-02", 12, 0, 0, 0]]}]
        """
    }

    /// vehicle_profile_read: the owned car has a recorded sale (a Claim); the others only their strip.
    static func profileRead(_ vehicleId: String) -> String {
        let price = vehicleId == owned ? """
            {"kind":"masthead","identity_source":{"year":1973,"make":"Fixture","model":"Coupe"},
             "price":{"value":41500,"unit":"USD","source":{"kind":"listing","label":"Fixture auction","method":"sold","url":"https://example.com/fixture-lot"},
                      "trust":0.9,"observed_at":"2022-01-20T00:00:00+00:00"},"priceLabel":"Last recorded sale"},
            """ : ""
        let facets = vehicleId == owned
            ? [("body_style", "Coupe"), ("engine", "455 V8"), ("transmission", "4-speed Manual"), ("drivetrain", "RWD"), ("location", "Las Vegas, NV")]
            : vehicleId == contributed ? [("engine", "350 V8"), ("location", "Henderson, NV")] : []
        let facetJSON = facets.map { dim, label in
            #"{"dimension":"\#(dim)","label":"\#(label)","member":{"value":"\#(label)","source":{"kind":"listing","label":"Fixture listing"},"trust":0.6}}"#
        }.joined(separator: ",")
        return """
        {"vehicle_id":"\(vehicleId)","viewer":"owner","read_at":"2026-11-20T12:00:00Z",
         "sections":[\(price){"kind":"strip","coverage":{"n":\(facets.count),"of":6,"grain":"facts attributed","as_of":"2026-11-20T12:00:00Z"},
           "facets":[\(facetJSON)]}]}
        """
    }

    /// vehicle_statements for a tied viewer: words shown.
    /// get_my_garage_owner_corrections: one account-stated vehicle no photo has identified yet (Identity pending).
    static let corrections = """
    [{"id":"00000000-0000-4000-8000-00000000d301","vehicle_id":null,"observed_at":"2026-11-10T18:00:00+00:00",
      "cover_image_url":null,"source_excerpt":null,
      "correction":{"relationship":null,"cover_image_id":null,
        "unresolved_vehicle":{"label":"Fixture pending pickup","stated_roles":["owner"]}}}]
    """

    static let statements = """
    {"vehicle_id":"\(owned)","tied":true,"rule":"A statement is a person's own claim, recorded whole and unsigned.",
     "statements":[{"statement_id":"00000000-0000-4000-8000-00000000d201","class":"claim","speaker_role":"owner",
       "statement_kind":"recollection","said_on":"2026-11-18","recorded_at":"2026-11-18T20:00:00+00:00",
       "target_status":"none","target_label":null,"target_key":null,"value":null,"value_note":null,
       "words":"Fixture note: rear end rebuilt over the winter."}]}
    """
}
#endif
