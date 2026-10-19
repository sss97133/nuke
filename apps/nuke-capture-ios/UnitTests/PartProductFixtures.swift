// PartProductFixtures.swift — reader JSON for a job part's product page. Test-only; never in the app bundle.
// `partInstalledVisitor` is trimmed from a live anon response captured in a rolled-back probe of
// work_order_part_read (migration 20261020084500) on 2026-10-19 21:39 UTC, and the shock's product card in
// `operationsWithParts` from the same part; ids replaced by fixture ids. Production held no job part with a
// retailer offer, or a catalog match other than its own product link, that day, so `partCatalogMatchedParty`
// follows the reader's definition with synthetic values.

@testable import NukeCapture

extension JobFixtures {
    static let partId = "00000000-0000-4000-8000-0000000000b7"
    static let partId2 = "00000000-0000-4000-8000-0000000000b8"
    static let partId3 = "00000000-0000-4000-8000-0000000000b9"

    /// An installed part on a public vehicle's job, as a signed-out visitor reads it.
    static let partInstalledVisitor = """
    {"part_id":"\(partId)","work_order_id":"\(workOrderId)","as_of":"2026-10-19T21:02:12.695358+00:00","work_order_status":"in_progress",
     "vehicle_label":{"make":"GMC","text":"1983 GMC K2500 Sierra Classic","trim":"Sierra Classic","year":1983,"model":"K2500"},
     "display_title":"Pre-Delivery Work Order","display_title_basis":"title","request_source_label":"Requested on the web",
     "part":{"id":"\(partId)","brand":"Bilstein","category":null,"quantity":2,"part_name":"Bilstein 5100 Front Shock Absorber","part_number":"BSN-24-187077"},
     "line":{"status":"installed","updated_at":"2026-04-04T22:36:36.519+00:00","recorded_at":"2026-02-27T17:52:15.328858+00:00","ai_extracted":false,
             "status_basis":"the status recorded on the part line (quoted, installed, not_used, cancelled); a line status is not a completion Sign","user_verified":false},
     "price":{"basis":"recorded line prices, not payments; part lines record no currency","currency":null,"is_comped":false,"unit_price":105.99,"total_price":229.73},
     "supplier":{"basis":"the supplier and link recorded on the part line; a link opens the seller's page, Nuke places no order","label":null,
                 "buy_url":"https://www.summitracing.com/parts/bsn-24-187077","buy_url_host":"summitracing.com","label_visibility":"parties_only"},
     "image":{"url":null,"basis":null},
     "operation":{"labor":[{"id":"00000000-0000-4000-8000-0000000000e1","hours":0.0,"status":"complete",
                            "task_name":"Install Bilstein 5100 shocks — all 4 corners + replace passenger window motor","task_category":"mechanical"}],
                  "line_item":null,"job_op_code":"SUSP-SHCK-001","labor_basis":"labor lines on this work order recording the same job_op_code",
                  "line_item_basis":"not_linkable: operation rows (work_order_line_items) carry no job_op_code or part key"},
     "product_link":{"source":"summitracing.com","page_url":"https://www.summitracing.com/parts/bsn-24-187077",
                     "image_url":"https://static.summitracing.com/global/images/prod/xlarge/bsn-24-187077_xl.jpg","page_host":"summitracing.com",
                     "captured_at":"2026-10-19T20:59:46.454+00:00","image_basis":"seller's product photo of the matched product; not a photo of the installed part",
                     "match_basis":"job_buy_url_page","manufacturer":"Bilstein","product_name":"Bilstein B8 5100 Series Shocks","part_number_as_printed":"BSN-24-187077"},
     "product_link_basis":"the current product link of this part (work_order_part_products): the seller page that evidenced the product; it describes the product, not the installed item",
     "catalog":{"basis":"a catalog listing for the same part number, as the catalog states it at its clock; not a fact about the installed item",
                "match":{"name":"Bilstein B8 5100 Series Shocks","clock":"2026-10-19T20:59:46.454+00:00",
                         "source":{"name":"summitracing.com product pages","base_url":"https://summitracing.com","provider":"summitracing.com"},
                         "category":null,"currency":"USD","in_stock":true,"year_end":null,"condition":null,"year_start":null,"clock_basis":"catalog row updated_at",
                         "description":null,"fits_models":null,"part_number":"BSN-24-187077","subcategory":null,"manufacturer":"Bilstein",
                         "supplier_url":"https://www.summitracing.com/parts/bsn-24-187077","price_current":null,
                         "catalog_part_id":"00000000-0000-4000-8000-0000000000f2",
                         "product_image_url":"https://static.summitracing.com/global/images/prod/xlarge/bsn-24-187077_xl.jpg","installation_difficulty":null},
                "state":"matched","match_basis":"exact_part_number_and_brand","same_as_product_link":true,
                "catalog_rows_brand_disagrees":0,"catalog_rows_same_part_number":1},
     "offers":[],
     "offers_basis":"retailer offers recorded against this part line, each at its own clock; not current prices, not purchases",
     "evidence":{"basis":"evidence is filed to an operation; a part line has no key to an operation, so no photo is attributed to this part",
                 "state":"not_linkable","images":[],"job_reader":"work_order_evidence_read","images_withheld":0,"job_attachments":0},
     "coverage":{"offers":0,"prices":"open; recorded line prices, not payments","catalog":"matched","product_link":true,"buy_link":true,"evidence":"not_linkable",
                 "part_image":false,"operation_row":"not_linkable","operation_link":"labor_by_job_op_code","customer_contact":"never_returned","offers_with_link":0},
     "viewer":{"party":false,"slots":[],"actions":[],"context":"visitor","decided_from":"auth.uid()","money_visible":false,"contact_visible":false,
               "identity_bridge":"none","quote_issuer_role":null},
     "people_basis":"no people are returned; supplier labels and offer notes go to parties only","payment_authorized":false}
    """

    /// A quoted part with a catalog listing and two recorded offers, as the customer reads it.
    static let partCatalogMatchedParty = """
    {"part_id":"\(partId2)","work_order_id":"\(workOrderId)","as_of":"2026-10-19T21:05:00+00:00","work_order_status":"quoted",
     "vehicle_label":{"make":"Fixture","text":"1970 Fixture Coupe","year":1970,"model":"Coupe"},
     "part":{"id":"\(partId2)","brand":"Holley","category":"fuel","quantity":1,"part_name":"Carburetor gasket","part_number":"108-2"},
     "line":{"status":"quoted","recorded_at":"2026-02-04T00:00:00+00:00","ai_extracted":true,"user_verified":false,"notes":"Fixture note"},
     "price":{"currency":null,"is_comped":false,"unit_price":4.5,"total_price":null},
     "supplier":{"label":"Fixture Supply","label_visibility":"shown","buy_url":null,"buy_url_host":null},
     "image":{"url":null,"basis":null},
     "operation":{"labor":[],"line_item":null,"job_op_code":null},
     "product_link":null,"product_link_basis":"no_current_link",
     "catalog":{"state":"matched","match_basis":"exact_part_number_and_brand","catalog_rows_same_part_number":1,"catalog_rows_brand_disagrees":0,
                "same_as_product_link":false,
                "match":{"catalog_part_id":"00000000-0000-4000-8000-0000000000f1","part_number":"108-2","name":"Carburetor base gasket",
                         "description":"Fixture description.","manufacturer":"Holley","price_current":5.25,"currency":"USD","in_stock":true,
                         "fits_models":["Fixture Coupe"],"year_start":1967,"year_end":1972,"installation_difficulty":"easy",
                         "product_image_url":"https://img.example.invalid/108-2.jpg","supplier_url":null,
                         "source":{"name":"Fixture Catalog","provider":"fixture","base_url":"https://catalog.example.invalid"},
                         "clock":"2026-05-01T00:00:00+00:00","clock_basis":"catalog row updated_at"}},
     "offers":[{"id":"00000000-0000-4000-8000-0000000000a7","retailer":"rockauto","brand":"Holley","part_number":"108-2","condition":"new","price":3.99,
                "in_stock":true,"url":"https://www.rockauto.example.invalid/108-2","url_host":"rockauto.example.invalid","is_selected":true,
                "recorded_at":"2026-02-04T00:00:00+00:00","store_location":null,"notes":"Fixture offer note"},
               {"id":"00000000-0000-4000-8000-0000000000a8","retailer":"autozone","brand":"Holley","part_number":"108-2","condition":"reman","price":6,
                "in_stock":false,"url":null,"url_host":null,"is_selected":false,"recorded_at":"2026-02-04T00:00:00+00:00",
                "store_location":"Fixture store","notes":null}],
     "evidence":{"state":"not_linkable","images":[],"images_withheld":0,"job_attachments":2},
     "viewer":{"party":true,"slots":["customer"],"actions":[],"context":"client"},
     "payment_authorized":false}
    """

    /// work_order_operations_read parts with their product cards (20261020074500); a visitor's view (one name withheld).
    static let operationsWithParts = """
    {"work_order_id":"\(workOrderId)","as_of":"2026-10-19T21:02:12+00:00","operations":[],"labor":[],
     "parts":[
      {"id":"\(partId3)","part_name":"Clip","part_number":null,"brand":null,"category":null,"quantity":10,"unit_price":0.5,"total_price":null,
       "status":"quoted","job_op_code":null,"is_comped":false,"quote_ref":{"ref_kind":"part","ref_id":"\(partId3)"},
       "product":null},
      {"id":"\(partId)","part_name":"Bilstein 5100 Front Shock Absorber","part_number":"BSN-24-187077","brand":"Bilstein","category":null,"quantity":2,
       "unit_price":105.99,"total_price":229.73,"status":"installed","job_op_code":"SUSP-SHCK-001","is_comped":false,
       "quote_ref":{"ref_kind":"part","ref_id":"\(partId)"},
       "product":{"image_url":"https://static.summitracing.com/global/images/prod/xlarge/bsn-24-187077_xl.jpg","product_name":"Bilstein B8 5100 Series Shocks",
                  "manufacturer":"Bilstein","part_number_as_printed":"BSN-24-187077","source":"summitracing.com",
                  "page_url":"https://www.summitracing.com/parts/bsn-24-187077","match_basis":"job_buy_url_page","captured_at":"2026-10-19T20:59:46.454+00:00",
                  "image_basis":"seller's product photo of the matched product; not a photo of the installed part"}},
      {"id":"\(partId2)","part_name":null,"part_name_visibility":"withheld_personal_info","part_number":"108-2","brand":"Holley","quantity":1,
       "unit_price":4.5,"total_price":4.5,"status":"not_used","is_comped":true,"quote_ref":{"ref_kind":"part","ref_id":"\(partId2)"},
       "product":{"image_url":"https://img.example.invalid/108-2.jpg","product_name":"Carburetor base gasket","manufacturer":"Holley",
                  "source":"shop.example.invalid","match_basis":"brand_and_part_number_on_page"}}],
     "viewer":{"party":false,"context":"visitor","slots":[],"actions":[]}}
    """
}
