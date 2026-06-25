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
    /// localIdentifiers the on-device pass classified PERSONAL (face + non-vehicle → blur/hide).
    @Published private(set) var personal: Set<String> = []
    /// Vehicle/work photos that ALSO contain a person — shown (work), but flagged
    /// borderline so the Select tool can let the owner approve/reject them.
    @Published private(set) var withPerson: Set<String> = []
    /// Owner's explicit verdicts (the Select tool) — these OVERRIDE the auto verdict.
    @Published private(set) var approved: Set<String> = []
    @Published private(set) var rejected: Set<String> = []

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

    /// Whether a cell should be hidden/blurred — the owner verdict WINS, else the auto verdict.
    func shouldHide(_ lid: String) -> Bool {
        if rejected.contains(lid) { return true }
        if approved.contains(lid) { return false }
        return personal.contains(lid)
    }

    /// Owner approves (work) or rejects (hide) a batch — overrides the auto verdict, persisted.
    func setVerdict(_ lids: [String], approved isApproved: Bool) {
        for lid in lids {
            if isApproved { approved.insert(lid); rejected.remove(lid) }
            else { rejected.insert(lid); approved.remove(lid) }
        }
        let verdict = isApproved ? "approved" : "rejected"
        Task.detached { LocalStore.shared.setOwnerVerdict(lids, verdict: verdict) }
    }

    /// Drain the classify queue across a few CONCURRENT lanes — serial was too slow,
    /// so blur/hide lagged behind the scroll. Each lane pulls an id on the main actor,
    /// classifies OFF the main actor, applies back on main.
    private func run() async {
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<4 {
                group.addTask { [weak self] in
                    while let lid = await self?.nextLID() {
                        let info = await Self.resolve(lid)
                        await self?.apply(lid, info)
                    }
                }
            }
        }
        running = false
        if !queue.isEmpty { running = true; Task { await run() } }   // ids that arrived mid-drain
    }

    private func nextLID() -> String? { queue.isEmpty ? nil : queue.removeFirst() }

    private func apply(_ lid: String, _ info: (isPersonal: Bool, hasPerson: Bool, ownerApproved: Bool?, glyph: String?)?) {
        guard let info else { return }
        if info.isPersonal { personal.insert(lid) }
        if info.hasPerson { withPerson.insert(lid) }
        if let o = info.ownerApproved { if o { approved.insert(lid) } else { rejected.insert(lid) } }
        if let g = info.glyph { decorations[lid] = LibraryDecoration(known: true, glyph: g) }
    }

    /// Heavy work, OFF the main actor: read the owner verdict + cached classification,
    /// else classify the photo on-device (Apple tags) and write it to the local store.
    nonisolated private static func resolve(_ lid: String) async -> (isPersonal: Bool, hasPerson: Bool, ownerApproved: Bool?, glyph: String?)? {
        let owner = LocalStore.shared.ownerVerdicts(for: [lid])[lid]
        if let c = LocalStore.shared.classification(for: [lid])[lid] {
            return (c.isPersonal, c.hasPerson, owner, c.isVehicle ? "car.fill" : nil)
        }
        guard let v = await VisionEngine.classifyAsset(localIdentifier: lid) else {
            // iCloud-only / unclassifiable, but it may still carry an owner verdict.
            return owner == nil ? nil : (false, false, owner, nil)
        }
        LocalStore.shared.classify(localIdentifier: lid, isVehicle: v.isVehicle, isPersonal: v.isPersonal,
                                   hasPerson: v.hasPerson, labels: v.labels)
        return (v.isPersonal, v.hasPerson, owner, v.isVehicle ? "car.fill" : nil)
    }
}
