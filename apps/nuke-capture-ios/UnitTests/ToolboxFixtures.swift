// ToolboxFixtures.swift — user_toolbox_read JSON for tests. Test-only; never in the app bundle.
// The shape follows supabase/migrations/20261020103000_tool_toolbox_read.sql. Every id, brand, part
// number, name, URL and amount is synthetic; nothing is copied from a person's records.

enum ToolboxFixtures {
    static let userId = "00000000-0000-4000-8000-0000000000e1"

    /// `owner` sets viewer.owner. `leakPaid` puts paid blocks in a visitor body, which the reader never
    /// does, to prove the phone still drops them.
    static func read(owner: Bool, leakPaid: Bool = false, currency: String? = "USD") -> String {
        let paid = owner || leakPaid
        let cur = currency.map { "\"\($0)\"" } ?? "null"
        return """
        {"user_id":"\(userId)","as_of":"2026-10-19T21:00:00+00:00","viewer":{"owner":\(owner)},
         "items":[
           {"user_tool_id":"00000000-0000-4000-8000-0000000000a1","tool_catalog_id":"00000000-0000-4000-8000-0000000000b1",
            "brand":"Fixture Tools","part_number":"FX-100","name":"Fixture ratcheting wrench set","name_basis":"maker_page",
            "category":"Wrenches","quantity":2,
            "pack_shot":{"image_url":"https://fixture.imgix.net/FX100.jpg","basis":"maker's catalog photo of the product, not a photo of this tool"},
            "list_price":{"amount":120.00,"currency":"USD","page_url":"https://shop.fixture.example/fx-100","captured_at":"2026-10-19T18:00:00+00:00"},
            "list_value":240.00,"match_basis":"same_brand_exact_part_number"
            \(paid ? #","paid":{"total":199.50,"receipts":2,"first_purchase":"2026-03-01","last_purchase":"2026-04-02","basis":"your receipts"}"# : "")},
           {"user_tool_id":"00000000-0000-4000-8000-0000000000a2","tool_catalog_id":"00000000-0000-4000-8000-0000000000b2",
            "brand":"Fixture Tools","part_number":"FX-020","name":"Fixture pliers","name_basis":"receipt_line",
            "category":"Pliers","quantity":1,
            "pack_shot":{"image_url":"https://fixture.imgix.net/FX020.jpg","basis":"maker's catalog photo of the product, not a photo of this tool"},
            "list_price":null,"list_value":null,"match_basis":"same_brand_exact_part_number"
            \(paid ? #","paid":{"total":null,"receipts":0,"first_purchase":null,"last_purchase":null,"basis":"your receipts"}"# : "")},
           {"user_tool_id":"00000000-0000-4000-8000-0000000000a3","tool_catalog_id":"00000000-0000-4000-8000-0000000000b3",
            "brand":"Fixture Tools","part_number":"FX-300","name":"Fixture screwdriver","name_basis":"maker_page",
            "category":null,"quantity":null,"pack_shot":null,
            "list_price":{"amount":"35.50","currency":"USD","page_url":"http://shop.fixture.example/fx-300","captured_at":null},
            "list_value":null,"match_basis":"same_brand_exact_part_number"},
           {"tool_catalog_id":"00000000-0000-4000-8000-0000000000b4","name":"Row without its id"}],
         "totals":{"list_value":240.00,"list_value_currency":\(cur),"paid":\(paid ? "199.50" : "null")},
         "coverage":{"tool_records":6,"matched_to_catalog":4,"unmatched_records":2,"with_pack_shot":2,"with_list_price":2},
         "basis":{"list_value":"maker's list price at capture x quantity; not resale value and not what was paid",
                  "pack_shot":"maker's catalog photo of the product",
                  "unmatched":"tool records without a same-brand exact part-number catalog match are counted, never described"}}
        """
    }

    static let empty = """
    {"user_id":"\(userId)","as_of":"2026-10-19T21:00:00+00:00","viewer":{"owner":true},"items":[],
     "totals":{"list_value":null,"list_value_currency":null,"paid":null},
     "coverage":{"tool_records":3,"matched_to_catalog":0,"unmatched_records":3,"with_pack_shot":0,"with_list_price":0},
     "basis":{}}
    """
}
