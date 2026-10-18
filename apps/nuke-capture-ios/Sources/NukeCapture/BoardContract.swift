// BoardContract.swift — the open board's row slots, by name.
//
// market_pulse_live sends each lot as a positional array of 17 values, and LiveAuction reads them by
// position. From v2 (#1092) the payload also names the slots (`v`, `columns`), pinned server-side by
// supabase/sql/test_market_pulse_live_columns.sql. The phone checks that header once per read: a payload
// without one (v1) is read as before; a header must name the 17 slots the decoder reads, in this order.
// Slots appended after them are ignored, so a later version that only adds columns keeps working. A
// header that moves or renames a slot stops the read with its own message, because a shifted row would
// put a bid where an end time belongs: the board shows nothing rather than wrong numbers.

import Foundation

enum BoardContract {
    static let columns = ["id", "year", "make", "model", "current_bid", "ends_at", "updated_at", "listed_at",
                          "image_url", "no_reserve", "listing_url", "title", "band_p10", "band_p50", "band_p90",
                          "band_tier", "band_comps"]

    private struct Header: Decodable { let v: Int?; let columns: [String]? }

    struct Mismatch: LocalizedError, Equatable {
        let got: [String]
        var errorDescription: String? {
            "The board's columns changed and this version of the app reads them by position, so it shows nothing rather than misread bids. Update the app."
        }
    }

    /// Throws `Mismatch` when the payload names its slots and the first 17 are not the ones the decoder reads.
    static func check(_ data: Data) throws {
        guard let header = try? JSONDecoder().decode(Header.self, from: data), let got = header.columns else { return }
        guard got.count >= columns.count, Array(got.prefix(columns.count)) == columns else { throw Mismatch(got: got) }
    }
}
