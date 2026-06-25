// LibraryGlasses.swift — DB/analysis intelligence laid over the raw library as
// async, non-blocking decoration. Keyed by PHAsset.localIdentifier (the same id the
// app stamps into exif_data.uuid on upload). A cell is always there at full speed
// whether or not the glasses have anything to say about it yet — NEVER blocks a cell.
//
// The cheap on-device classifier (Apple tags via VisionEngine) runs OFF the scroll
// path, caches verdicts in LocalStore (the ledger), marks personal photos (for
// blur/hide), and badges vehicle photos. (LocalStore/VisionEngine are same-module.)
//
// Operating table: source → LibraryStore.swift · grid → LibraryView.swift ·
// fullscreen → LibraryDetail.swift.

import Photos
import SwiftUI

struct LibraryDecoration {
    let known: Bool          // the DB has an observation/upload for this content
    let glyph: String        // SF Symbol, e.g. "car.fill" (attributed) / "sparkles" (analyzed)
}

/// How personal photos are presented in the grid — toggled from the count control.
enum PersonalMode: Int { case show = 0, blur = 1, black = 2 }

@MainActor
final class LibraryOverlayStore: ObservableObject {
    static let shared = LibraryOverlayStore()
    /// Per-cell badges (vehicle/analyzed). Filled off the scroll path.
    @Published private(set) var decorations: [String: LibraryDecoration] = [:]
    /// localIdentifiers the on-device pass classified PERSONAL (for blur/hide).
    @Published private(set) var personal: Set<String> = []

    private var seen = Set<String>()        // resolved or in flight (dedup)
    private var queue: [String] = []
    private var running = false

    /// A cell appeared — classify it cheap, on-device, cached, OFF the scroll path.
    func note(_ localIdentifier: String) {
        guard !seen.contains(localIdentifier) else { return }
        seen.insert(localIdentifier)
        queue.append(localIdentifier)
        if !running { running = true; Task { await run() } }
    }

    func decoration(for localIdentifier: String) -> LibraryDecoration? { decorations[localIdentifier] }
    func isPersonal(_ localIdentifier: String) -> Bool { personal.contains(localIdentifier) }

    private func run() async {
        while !queue.isEmpty {
            let lid = queue.removeFirst()
            if let info = await Self.resolve(lid) {
                if info.isPersonal { personal.insert(lid) }
                if let g = info.glyph { decorations[lid] = LibraryDecoration(known: true, glyph: g) }
            }
        }
        running = false
    }

    /// Heavy work, OFF the main actor: read the cached verdict, else classify the
    /// photo on-device (Apple tags) and write it to the local store (the ledger).
    nonisolated private static func resolve(_ lid: String) async -> (isPersonal: Bool, glyph: String?)? {
        if let c = LocalStore.shared.classification(for: [lid])[lid] {
            return (c.isPersonal, c.isVehicle ? "car.fill" : nil)
        }
        guard let v = await VisionEngine.classifyAsset(localIdentifier: lid) else { return nil }
        LocalStore.shared.classify(localIdentifier: lid, isVehicle: v.isVehicle, isPersonal: v.isPersonal, labels: v.labels)
        return (v.isPersonal, v.isVehicle ? "car.fill" : nil)
    }
}
