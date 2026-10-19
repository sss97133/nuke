// ToolActionShotsFixtures.swift — user_tool_action_shots_read JSON for tests. Test-only; never in the
// app bundle. The shape follows supabase/migrations/20261020104500_tool_action_shots_read.sql and a
// read-only live capture of its keys on 2026-10-19; every id, URL, vehicle and count is synthetic.

import Foundation

enum ToolActionShotsFixtures {
    static let userId = "00000000-0000-4000-8000-0000000000e1"
    private static let base = "https://fixture.supabase.example/storage/v1/object/public/vehicle-photos/users/fixture"

    static func shot(_ n: Int, taken: String? = "2026-10-12T15:30:00+00:00", vehicle: String) -> String {
        let t = taken.map { "\"\($0)\"" } ?? "null"
        return #"{"image_id":"00000000-0000-4000-8000-00000000f0\#(String(format: "%02d", n))","image_url":"\#(base)/\#(n).jpg","thumbnail_url":"\#(base)/\#(n)-thumb.jpg","taken_at":\#(t),"vehicle":\#(vehicle)}"#
    }

    static let publicVehicle = #"{"label":"1970 Fixture Coupe","vehicle_id":"00000000-0000-4000-8000-0000000000c7"}"#
    static let privateVehicle = #"{"label":"1985 Fixture Pickup"}"#

    static func read(isSelf: Bool) -> String {
        """
        {"user_id":"\(userId)","as_of":"2026-10-19T22:00:00+00:00","viewer":{"self":\(isSelf)},"label_filter":null,
         "groups":[
           {"label":"two-post lift","photos":12,"shots":[\(shot(1, vehicle: publicVehicle)),\(shot(2, taken: nil, vehicle: isSelf ? privateVehicle : "null")),
              {"image_id":"00000000-0000-4000-8000-00000000f099","image_url":null,"thumbnail_url":null}]},
           {"label":"air compressor","photos":1,"shots":[\(shot(3, vehicle: publicVehicle))]},
           {"label":"empty group","photos":0,"shots":[]},
           {"photos":3,"shots":[\(shot(4, vehicle: publicVehicle))]}],
         "coverage":{"recent_photos":5000,"images_scanned":1000,"frames_analyzed":640,"photos_with_tools":13,
                     "scan_cap":1000,"recent_cap":5000,"per_label":6},
         "basis":{"label":"a tool type the image analysis saw in the frame (image_deep_byok workshop_signals); not an identified tool from the toolbox",
                  "photos":"distinct photos per label among the scanned photos; not distinct objects",
                  "eligibility":"approved, non-external, non-sensitive gallery photos; public vehicles only unless the viewer is the person"}}
        """
    }

    static let filtered = """
    {"user_id":"\(userId)","as_of":"2026-10-19T22:00:00+00:00","viewer":{"self":false},"label_filter":"floor jack",
     "groups":[{"label":"floor jack","photos":2,"shots":[\(shot(5, vehicle: publicVehicle)),\(shot(6, vehicle: publicVehicle))]}],
     "coverage":{"recent_photos":120,"images_scanned":80,"frames_analyzed":60,"photos_with_tools":2,
                 "scan_cap":1000,"recent_cap":5000,"per_label":48},
     "basis":{}}
    """
}
