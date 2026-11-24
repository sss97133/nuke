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
    /// localIdentifiers the on-device pass classified UNNECESSARY (screenshots, docs,
    /// shopping/web captures) — clutter gated out of the way by default. Owner-approve
    /// (Select tool) overrides. Derived from POSITIVE junk signals, never "not a vehicle".
    @Published private(set) var junk: Set<String> = []
    /// Per-photo TOP on-device vision label (humanized) — makes tag propagation VISIBLE:
    /// a chip appears on each cell the instant the live classifier reads it. This is the
    /// proof surface (Blur has it; Nuke didn't) — you watch the tags land, or see nothing.
    @Published private(set) var topLabel: [String: String] = [:]
    /// Owner's explicit verdicts (the Select tool) — these OVERRIDE the auto verdict.
    @Published private(set) var approved: Set<String> = []
    @Published private(set) var rejected: Set<String> = []
    /// The on-device read for each photo the pass has resolved: the privacy gate's device input.
    /// A photo absent here has no verdict yet, so the gate keeps it covered.
    @Published private(set) var deviceRead: [String: LibraryDeviceRead] = [:]

    private var seen = Set<String>()        // resolved or in flight (dedup)
    private var queue: [String] = []
    private var running = false

    // Coalesced publish: classifications land fast during scroll, and mutating the
    // @Published sets per-photo fired objectWillChange per-photo — re-rendering EVERY
    // visible cell each time (the scroll-path jank). Stage results here and flush to the
    // @Published sets in bounded bursts (~6x/sec) so the grid updates calmly.
    private var pendingPersonal = Set<String>()
    private var pendingJunk = Set<String>()
    private var pendingTopLabel: [String: String] = [:]
    private var pendingWithPerson = Set<String>()
    private var pendingApproved = Set<String>()
    private var pendingRejected = Set<String>()
    private var pendingDecorations: [String: LibraryDecoration] = [:]
    private var pendingDeviceRead: [String: LibraryDeviceRead] = [:]
    /// Ids queued from a local-only surface (the album drill): read on the device, never iCloud.
    private var localOnlyIDs = Set<String>()
    private var flushScheduled = false

    /// A cell appeared — classify it cheap, on-device, cached, OFF the scroll path.
    func note(_ localIdentifier: String, allowNetwork: Bool = true) {
        guard !seen.contains(localIdentifier) else { return }
        if allowNetwork { localOnlyIDs.remove(localIdentifier) } else { localOnlyIDs.insert(localIdentifier) }
        // Bound the dedup set: a long scroll through a large library would otherwise grow it
        // forever. Clearing only re-allows a (cached, cheap) classify of an id seen again.
        if seen.count >= Self.seenCap { seen = Set(queue) }
        seen.insert(localIdentifier)
        queue.append(localIdentifier)
        if !running { running = true; Task { await run() } }
    }

    /// Read one photo again even if this session already tried it (a failed or iCloud-only read
    /// leaves it covered; opening it fullscreen asks once more).
    func recheck(_ localIdentifier: String, allowNetwork: Bool = true) {
        guard deviceRead[localIdentifier] == nil, !queue.contains(localIdentifier) else { return }
        seen.remove(localIdentifier)
        note(localIdentifier, allowNetwork: allowNetwork)
    }

    /// A cell scrolled away before its turn: drop it from the queue so a fast flick does not leave
    /// hundreds of classifications (and iCloud fetches) running after the scroll stops. It is
    /// queued again if it comes back on screen.
    func forget(_ localIdentifier: String) {
        guard let i = queue.firstIndex(of: localIdentifier) else { return }
        queue.remove(at: i)
        seen.remove(localIdentifier)
    }

    func decoration(for localIdentifier: String) -> LibraryDecoration? { decorations[localIdentifier] }
    func isPersonal(_ localIdentifier: String) -> Bool { personal.contains(localIdentifier) }

    /// Whether a cell should be hidden/blurred — the owner verdict WINS, else the auto verdict.
    func shouldHide(_ lid: String) -> Bool {
        if rejected.contains(lid) { return true }
        if approved.contains(lid) { return false }
        return personal.contains(lid)
    }

    /// Whether the Library may paint this photo's pixels (LibraryPrivacyGate): fails closed, so a
    /// photo with no verdict yet, a failed read, or any block signal (owner, server, device) stays covered.
    func pixelVerdict(_ lid: String, server: String?) -> LibraryPixelVerdict {
        let owner: Bool? = rejected.contains(lid) ? false : (approved.contains(lid) ? true : nil)
        return LibraryPrivacyGate.verdict(ownerApproved: owner, serverBlockReason: server, device: deviceRead[lid])
    }

    /// Whether a cell is UNNECESSARY clutter (screenshot/doc/shopping) gated out by
    /// default — the essential Vision gate. Owner-approve (Select) un-gates it.
    func isGatedJunk(_ lid: String) -> Bool {
        if approved.contains(lid) { return false }
        return junk.contains(lid)
    }

    /// The top on-device vision label for a cell (humanized), once classified — the
    /// visible proof that local vision ran on THIS photo. nil = not yet read.
    func label(for lid: String) -> String? { topLabel[lid] }

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
            // Warm phone or Low Power Mode: one lane instead of four, so the grid's classifier
            // does not keep the Neural Engine saturated while the owner holds the device.
            for _ in 0..<Self.laneCount() {
                group.addTask { [weak self] in
                    while let next = await self?.nextLID() {
                        let info = await Self.resolve(next.lid, allowNetwork: next.allowNetwork)
                        await self?.apply(next.lid, info)
                    }
                }
            }
        }
        running = false
        if !queue.isEmpty { running = true; Task { await run() } }   // ids that arrived mid-drain
    }

    static let seenCap = 4000
    nonisolated static func laneCount(thermal: ProcessInfo.ThermalState = ProcessInfo.processInfo.thermalState,
                                      lowPower: Bool = ProcessInfo.processInfo.isLowPowerModeEnabled) -> Int {
        (thermal.rawValue >= ProcessInfo.ThermalState.fair.rawValue || lowPower) ? 1 : 4
    }

    /// Newest first: the cells on screen now, ahead of ones already scrolled past.
    private func nextLID() -> (lid: String, allowNetwork: Bool)? {
        guard let lid = queue.popLast() else { return nil }
        return (lid, !localOnlyIDs.contains(lid))
    }

    private func apply(_ lid: String, _ info: ResolvedRead?) {
        guard let info else { return }
        if let read = info.device { pendingDeviceRead[lid] = read }
        if info.isPersonal { pendingPersonal.insert(lid) }
        if info.isJunk { pendingJunk.insert(lid) }
        if let l = info.label { pendingTopLabel[lid] = l }
        if info.hasPerson { pendingWithPerson.insert(lid) }
        if let o = info.ownerApproved { if o { pendingApproved.insert(lid) } else { pendingRejected.insert(lid) } }
        if let g = info.glyph { pendingDecorations[lid] = LibraryDecoration(known: true, glyph: g) }
        scheduleFlush()
    }

    /// Push the staged results into the @Published sets at most ~6x/sec. SwiftUI
    /// coalesces the several property mutations in one flush into a single grid update,
    /// so a burst of classifications costs one re-render, not one per photo.
    private func scheduleFlush() {
        guard !flushScheduled else { return }
        flushScheduled = true
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(160))
            self?.flush()
        }
    }

    private func flush() {
        flushScheduled = false
        if !pendingPersonal.isEmpty { personal.formUnion(pendingPersonal); pendingPersonal.removeAll() }
        if !pendingJunk.isEmpty { junk.formUnion(pendingJunk); pendingJunk.removeAll() }
        if !pendingTopLabel.isEmpty { topLabel.merge(pendingTopLabel) { _, new in new }; pendingTopLabel.removeAll() }
        if !pendingWithPerson.isEmpty { withPerson.formUnion(pendingWithPerson); pendingWithPerson.removeAll() }
        if !pendingApproved.isEmpty { approved.formUnion(pendingApproved); pendingApproved.removeAll() }
        if !pendingRejected.isEmpty { rejected.formUnion(pendingRejected); pendingRejected.removeAll() }
        if !pendingDecorations.isEmpty {
            decorations.merge(pendingDecorations) { _, new in new }
            pendingDecorations.removeAll()
        }
        if !pendingDeviceRead.isEmpty {
            deviceRead.merge(pendingDeviceRead) { _, new in new }
            pendingDeviceRead.removeAll()
        }
    }

    /// One resolved photo. `device` is nil when the photo could not be read: the gate keeps it covered.
    struct ResolvedRead {
        var isPersonal: Bool
        var isJunk: Bool
        var hasPerson: Bool
        var label: String?
        var ownerApproved: Bool?
        var glyph: String?
        var device: LibraryDeviceRead?
    }

    /// Heavy work, OFF the main actor: read the owner verdict + cached classification,
    /// else classify the photo on-device (Apple tags) and write it to the local store.
    nonisolated private static func resolve(_ lid: String, allowNetwork: Bool = true) async -> ResolvedRead? {
        let owner = LocalStore.shared.ownerVerdicts(for: [lid])[lid]
        let screenshot = VisionEngine.isScreenshot(localIdentifier: lid)
        if let c = LocalStore.shared.classification(for: [lid])[lid] {
            // Junk is DERIVED (not a stored column) from the cached T0 labels + the free
            // screenshot flag — so it needs no migration and re-tunes as the label set evolves.
            let junk = VisionEngine.isUnnecessary(labels: c.labels, isScreenshot: screenshot)
            return ResolvedRead(isPersonal: c.isPersonal, isJunk: junk, hasPerson: c.hasPerson, label: humanize(c.labels.first),
                                ownerApproved: owner, glyph: c.isVehicle ? "car.fill" : nil,
                                device: LibraryDeviceRead(isPersonal: c.isPersonal, hasPerson: c.hasPerson, labels: c.labels, isScreenshot: screenshot))
        }
        guard let v = await VisionEngine.classifyAsset(localIdentifier: lid, allowNetwork: allowNetwork) else {
            // iCloud-only / unclassifiable / a failed face read: no device verdict, so it stays
            // covered, but it may still carry an owner verdict.
            return owner == nil ? nil : ResolvedRead(isPersonal: false, isJunk: false, hasPerson: false, label: nil,
                                                     ownerApproved: owner, glyph: nil, device: nil)
        }
        LocalStore.shared.classify(localIdentifier: lid, isVehicle: v.isVehicle, isPersonal: v.isPersonal,
                                   hasPerson: v.hasPerson, labels: v.labels)
        let junk = VisionEngine.isUnnecessary(labels: v.labels, isScreenshot: screenshot)
        return ResolvedRead(isPersonal: v.isPersonal, isJunk: junk, hasPerson: v.hasPerson, label: humanize(v.labels.first),
                            ownerApproved: owner, glyph: v.isVehicle ? "car.fill" : nil,
                            device: LibraryDeviceRead(isPersonal: v.isPersonal, hasPerson: v.hasPerson, labels: v.labels, isScreenshot: screenshot))
    }

    /// "sports_car" → "Sports Car" — the on-device label, made human for the chip.
    nonisolated private static func humanize(_ raw: String?) -> String? {
        raw.map { $0.replacingOccurrences(of: "_", with: " ").capitalized }
    }
}
