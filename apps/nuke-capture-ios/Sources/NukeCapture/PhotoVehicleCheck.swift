// PhotoVehicleCheck.swift — does what the vision read saw in a day's photos agree with the vehicle
// the day is filed to? The read (photo-pipeline-orchestrator, ai_scan_metadata.classification.
// vehicle_hints) names a make and model when it can; a day filed by date and place alone used to be
// confirmed with no such comparison (2026-10-19: Mustang photos proposed for a '79 truck).
// Only a make is compared as a conflict; a read with no make says nothing.

import Foundation

enum PhotoVehicleCheck {
    struct Hint: Decodable, Equatable {
        let make: String?
        let model: String?
    }

    enum Verdict: Equatable {
        case noReads                                              // no photo has a make read
        case agrees(Int)                                          // n photos read as this make
        case conflicts(readAs: String, count: Int, of: Int)       // most-read other make, its count, reads with a make
    }

    nonisolated static func verdict(hints: [Hint], make: String?, model: String?) -> Verdict {
        let norm: (String?) -> String = {
            ($0 ?? "").lowercased().filter { $0.isLetter || $0.isNumber }
        }
        let vehicleMake = norm(make)
        let reads = hints.compactMap { h -> (make: String, label: String)? in
            let m = norm(h.make)
            guard !m.isEmpty else { return nil }
            let label = [h.make, h.model].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
            return (m, label)
        }
        guard !reads.isEmpty, !vehicleMake.isEmpty else { return .noReads }
        let same = reads.filter { $0.make == vehicleMake || $0.make.contains(vehicleMake) || vehicleMake.contains($0.make) }
        let other = reads.filter { r in !same.contains { $0.make == r.make } }
        if other.count > same.count {
            let top = Dictionary(grouping: other, by: \.label).max { $0.value.count < $1.value.count }
            return .conflicts(readAs: top?.key ?? other[0].label, count: other.count, of: reads.count)
        }
        return .agrees(same.count)
    }
}
