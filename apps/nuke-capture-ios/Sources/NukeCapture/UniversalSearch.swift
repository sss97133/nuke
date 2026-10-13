// UniversalSearch.swift — the web's search door, called from the phone.
//
// nuke.ag's search box calls the `universal-search` edge function; that function owns the
// public-eligibility filter, the ranked full-text reader (search_vehicles_fts, repaired 2026-10-13),
// the ILIKE fallback for multi-token queries, VIN and URL detection and the cohort card. The phone
// used to run its own ILIKE over `vehicles` and so disagreed with the web about which records are
// public and in what order. Now both ask the same door; the shapes below are the door's own
// (supabase/functions/universal-search/index.ts: SearchRequest, SearchResult, SearchResponse).

import Foundation
import Supabase

struct UniversalSearchRequest: Encodable {
    let query: String
    let limit: Int
    let offset: Int
    /// The door returns organizations and people too; the Explore grid asks for vehicles only.
    let types: [String]
}

struct UniversalSearchHit: Decodable, Identifiable {
    struct Metadata: Decodable {
        let year: Int?
        let make: String?
        let model: String?
        let city: String?
        let state: String?
        let image_count: Int?
        let observation_count: Int?
    }
    let id: String
    let type: String
    let title: String?
    let subtitle: String?
    let image_url: String?
    let relevance_score: Double?
    let metadata: Metadata?

    /// The grid's row, from the door's vehicle hit. Trim is not in the hit; the detail page reads it.
    var headerRow: VehicleHeaderRow? {
        guard type == "vehicle", let uuid = UUID(uuidString: id) else { return nil }
        return VehicleHeaderRow(id: uuid, year: metadata?.year, make: metadata?.make, model: metadata?.model,
                                trim: nil, primary_image_url: image_url, city: metadata?.city, state: metadata?.state)
    }
}

struct UniversalSearchMeta: Decodable {
    let total_count: Int?
    let returned_count: Int?
    let next_offset: Int?
    let vehicle_source: String?
    let offset: Int?
    let limit: Int?
    let has_more: Bool?
    let pagination_limited: Bool?
}

struct UniversalSearchResponse: Decodable {
    let success: Bool
    let results: [UniversalSearchHit]
    let query_type: String?
    let total_count: Int?
    let search_time_ms: Int?
    let meta: UniversalSearchMeta?
}

enum UniversalSearch {
    /// One page of vehicle hits for a query, through the door the web uses.
    static func vehicles(query: String, limit: Int = 60, offset: Int = 0) async throws -> UniversalSearchResponse {
        try await SupabaseService.client.functions.invoke(
            "universal-search",
            options: FunctionInvokeOptions(body: UniversalSearchRequest(query: query, limit: limit, offset: offset, types: ["vehicle"]))
        )
    }
}
