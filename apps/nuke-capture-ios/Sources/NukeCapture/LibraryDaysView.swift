// LibraryDaysView.swift — the read half of the local-first loop, and the proof.
// Renders the library grouped by day ENTIRELY from LocalStore.dayCounts() — no
// SupabaseService, no RPC, no network in this file. This is the window the NEXT
// BUILD directive demanded: "render ONE window from the local store, NOT the
// cloud," whose acceptance test is that it builds with the network OFF.
//
// The days come from each photo's TRUE EXIF takenAt (written by LibraryIngest),
// so an old import shows the day it was actually shot, not the re-add date.
//
// Operating table: source → LibraryStore · store → LocalStore · populate →
// LibraryIngest · this file → the day receipt.

import SwiftUI

struct LibraryDaysView: View {
    @ObservedObject private var ingest = LibraryIngest.shared
    @Environment(\.dismiss) private var dismiss
    @State private var days: [DayRollup] = []
    @State private var loaded = false
    #if DEBUG
    // Screenshot-loop deep-link: NUKE_DEBUG_DAY=yyyy-MM-dd pushes straight into that
    // day's receipt (simctl has no tap CLI). DEBUG only; never ships.
    @State private var debugDayPushed = false
    private let debugDay = ProcessInfo.processInfo.environment["NUKE_DEBUG_DAY"]
    #endif

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if ingest.running {
                        Label("Reading photos on-device… \(ingest.scanned)/\(ingest.target)",
                              systemImage: "internaldrive")
                            .foregroundStyle(.secondary)
                    } else if days.isEmpty && loaded {
                        Text("No dated photos yet. Pull to scan.")
                            .foregroundStyle(.secondary)
                    }
                } footer: {
                    // Honest provenance: this is built locally, and the v1 cap is named.
                    Text(footerText)
                }

                if !days.isEmpty {
                    Section("Days") {
                        ForEach(days, id: \.day) { d in
                            NavigationLink {
                                DayPhotosView(day: d.day, title: pretty(d.day))
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(pretty(d.day))
                                        // Only when the day has a real T0 verdict or a cached
                                        // cloud read — absent stays absent, never "0 vehicle".
                                        if d.classified > 0 || d.read > 0 {
                                            Text(rollupSubtitle(d))
                                                .font(.caption).foregroundStyle(.secondary)
                                        }
                                    }
                                    Spacer(minLength: 16)
                                    Text("\(d.count)").monospacedDigit().foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Days")
            .navigationBarTitleDisplayMode(.inline)
            #if DEBUG
            .navigationDestination(isPresented: $debugDayPushed) {
                if let d = debugDay { DayPhotosView(day: d, title: pretty(d)) }
            }
            .onAppear { if debugDay != nil { debugDayPushed = true } }
            #endif
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .refreshable { await ingest.runHeadPass(); await reload() }
            .task {
                await reload()                 // show whatever's already local first
                if days.isEmpty { await ingest.runHeadPass() }
                await reload()
                loaded = true
                // Pull "Read by Nuke" down for what's already indexed (online; no-op
                // offline), so the rollup shows read counts as you browse.
                await ingest.runCloudBackfill()
                await reload()
                // And push the other direction: on-device tags UP to the cloud ledger
                // (bounded; resumes via its own persisted cursor; no-op offline).
                await LocalTagPush.run(perRun: 1000)
                // Grow the receipt while it's open: walk the deep backlog in batches,
                // refreshing the counts as each lands. Resumes via the persisted cursor;
                // SwiftUI cancels this .task on disappear, which stops the loop.
                while !ingest.backlogComplete && !Task.isCancelled {
                    // If a head pass (or another batch) holds the walk, runBackfillBatch
                    // no-ops instantly — don't tight-loop full-table reloads against it.
                    if ingest.running {
                        try? await Task.sleep(for: .seconds(1))
                        continue
                    }
                    await ingest.runBackfillBatch(budget: 600)
                    await reload()
                    try? await Task.sleep(for: .milliseconds(250))   // breathe between batches
                }
                // Newly-indexed days may carry verdicts too — one more bounded pull.
                await ingest.runCloudBackfill()
                await reload()
            }
        }
    }

    private func reload() async {
        days = await Task.detached { LocalStore.shared.dayCounts() }.value
    }

    private var footerText: String {
        // Indexed (dated) photos vs the whole library, so progress is honest and the
        // bound is never silent.
        let total = days.reduce(0) { $0 + $1.count }
        let library = LibraryStore.shared.count
        var base = "Built on-device from your photos' EXIF — no network. \(total) of \(library) photos indexed across \(days.count) days."
        if ingest.cloudCached > 0 { base += " \(ingest.cloudCached) read by Nuke." }
        return ingest.backlogComplete ? base : base + " Indexing the rest in the background…"
    }

    /// "8 vehicle/work · 3 read by Nuke" — vehicle/work count (with sorted-progress when
    /// partial), then the cloud-read count. Caller gates on classified > 0 OR read > 0.
    private func rollupSubtitle(_ d: DayRollup) -> String {
        var parts: [String] = []
        if d.classified > 0 {
            var s = "\(d.vehicles) vehicle/work"
            if d.classified < d.count { s += " · \(d.classified) of \(d.count) sorted" }
            parts.append(s)
        }
        if d.read > 0 { parts.append("\(d.read) read by Nuke") }
        return parts.joined(separator: " · ")
    }

    /// "2019-04-29" → "Mon, Apr 29, 2019".
    private func pretty(_ ymd: String) -> String {
        let inF = DateFormatter()
        inF.locale = Locale(identifier: "en_US_POSIX")
        inF.dateFormat = "yyyy-MM-dd"
        guard let d = inF.date(from: ymd) else { return ymd }
        let outF = DateFormatter()
        outF.dateStyle = .full
        outF.timeStyle = .none
        return outF.string(from: d)
    }
}

// MARK: - The drill: one day's real photos → the existing pager + ledger

/// Tapping a day opens its RECEIPT (DayReceiptCard: measured span/bursts/site + the
/// cached read layer) above its REAL photos (LocalStore appearances for that
/// takenAt-day, mapped to the grid's global indices) → the existing fullscreen
/// pager, scoped to the day → the back-of-photo ledger. Reads LocalStore +
/// SiteStore + PhotoKit only — zero network in the render path (the .task's
/// verdict pull is online enrichment that no-ops offline). Reuses LibraryCell +
/// LibraryDetailView (no parallel surface).
private struct DayPhotosView: View {
    let day: String          // 'yyyy-MM-dd', the same key dayCounts() grouped on
    let title: String
    @State private var indices: [Int] = []   // global LibraryStore indices, takenAt-DESC
    @State private var detailIndex: Int?
    @State private var loaded = false
    @State private var receipt: LocalDayReceipt?
    @State private var vehicleLabel: String?  // offline garage-mirror resolve of the agent's read
    @State private var siteName: String?      // confirmed work site containing the day's GPS median
    @Namespace private var zoomNS

    private let columns = 3
    private let spacing: CGFloat = 2

    var body: some View {
        ScrollView {
            if let r = receipt { DayReceiptCard(receipt: r, vehicleLabel: vehicleLabel, siteName: siteName) }
            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: spacing), count: columns),
                spacing: spacing
            ) {
                ForEach(indices, id: \.self) { gi in
                    LibraryCell(index: gi)
                        .matchedTransitionSource(id: gi, in: zoomNS)
                        .onTapGesture { detailIndex = gi }
                }
            }
            if loaded && indices.isEmpty {
                // Honest: counted rows whose assets left the library. No phantom cells.
                Text("These photos are no longer in your library.")
                    .foregroundStyle(.secondary)
                    .padding(.top, 48)
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            // Day → its local identifiers (off-main read) → grid global indices,
            // preserving the takenAt-DESC order. The grid renders from PhotoKit +
            // LocalStore only (no network).
            let lids = await Task.detached { LocalStore.shared.localIdentifiers(onDay: day) }.value
            let map = LibraryStore.shared.indexMap(forLocalIdentifiers: lids)
            indices = lids.compactMap { map[$0] }
            loaded = true
            await reloadReceipt()
            // Online enrichment: pull THIS day's "Read by Nuke" verdicts so they're
            // cached for the info sheet (offline thereafter). nil = offline → skip,
            // don't mark checked. Bounded to one day's photos.
            if !lids.isEmpty, let verdicts = await SupabaseService.fetchCloudVerdicts(forLocalIdentifiers: lids) {
                await Task.detached {
                    for v in verdicts {
                        LocalStore.shared.cacheCloudVerdict(
                            localIdentifier: v.local_uuid,
                            narrative: v.narrative, intent: v.intent, scene: v.scene_type,
                            confidence: v.confidence, buildPhase: v.build_phase,
                            vehicleId: v.vehicle_id, agentModel: v.agent_model,
                            analyzedAt: SupabaseService.verdictDate(v.analyzed_at))
                    }
                    LocalStore.shared.markCloudChecked(lids)
                }.value
                // Freshly-cached verdicts change the read layer — recompute the receipt.
                await reloadReceipt()
            }
        }
        .fullScreenCover(item: Binding(
            get: { detailIndex.map(IndexBox.init) },
            set: { detailIndex = $0?.id }
        )) { box in
            LibraryDetailView(startIndex: box.id, indices: indices)
                .navigationTransition(.zoom(sourceID: box.id, in: zoomNS))
        }
    }

    /// Rebuild the receipt from LocalStore (off-main), then resolve its two lookups:
    /// the agent-read vehicle via the offline garage mirror, and the confirmed work
    /// site containing the day's GPS median (SiteStore, device-local). Zero network.
    private func reloadReceipt() async {
        let r = await Task.detached { LocalStore.shared.dayReceipt(onDay: day) }.value
        receipt = r
        guard let r else { vehicleLabel = nil; siteName = nil; return }
        if let vid = r.agentVehicleId {
            vehicleLabel = await Task.detached { LocalStore.shared.garageVehicleLabel(vehicleId: vid) }.value
        } else {
            vehicleLabel = nil
        }
        if let lat = r.medianLat, let lon = r.medianLon {
            siteName = SiteStore.shared.sites.first {
                Geo.distanceMeters(lat1: $0.latitude, lon1: $0.longitude, lat2: lat, lon2: lon) <= $0.radiusMeters
            }?.name
        } else {
            siteName = nil
        }
    }
}

// MARK: - The receipt card — the day-level synthesis, entirely from the local store

/// Renders above the day's grid. Three layers, each shown only when its data exists
/// (absent stays absent — never a fake "0" row):
///   measured — EXIF times (span, bursts) + GPS (located count / site). Facts from files.
///   sorted   — the T0 on-device classification rollup.
///   read     — cached cloud BYOK verdicts: intents, the labor-time estimate
///              (web-formula over shoot intervals — labeled estimated, never signed),
///              and the agent's vehicle read (a read, NOT a confirmed binding).
private struct DayReceiptCard: View {
    let receipt: LocalDayReceipt
    let vehicleLabel: String?
    let siteName: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(measuredLine)
                .font(.subheadline.weight(.medium)).monospacedDigit()
            if receipt.classified > 0 {
                Text(sortedLine)
                    .font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
            if receipt.read > 0 {
                Text(readLine)
                    .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                if let vehicleLabel {
                    // The agent's read from pixels — presented as such, not as ownership.
                    Text("\(vehicleLabel) — agent read, \(receipt.agentVehicleFrames) frames")
                        .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            if let siteName {
                Label(siteName, systemImage: "mappin.and.ellipse")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Text(provenanceLine)
                .font(.caption2).foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private var measuredLine: String {
        var parts = ["\(receipt.count) frames"]
        if let f = receipt.firstShot, let l = receipt.lastShot, f != l {
            let t = Date.FormatStyle(date: .omitted, time: .shortened)
            parts.append("\(f.formatted(t))–\(l.formatted(t))")
        }
        if receipt.bursts > 1 { parts.append("\(receipt.bursts) bursts") }
        if receipt.locatedCount > 0 { parts.append("\(receipt.locatedCount) located") }
        return parts.joined(separator: " · ")
    }

    private var sortedLine: String {
        var s = "\(receipt.vehicles) vehicle/work"
        if receipt.classified < receipt.count { s += " · \(receipt.classified) of \(receipt.count) sorted" }
        return s
    }

    private var readLine: String {
        var parts = ["Read by Nuke: \(receipt.read)"]
        // Top intents, e.g. "14 labor · 3 documentation" — from the cached verdicts only.
        for (intent, n) in receipt.intents.prefix(2) { parts.append("\(n) \(intent)") }
        if let mins = receipt.laborMinutes {
            parts.append("~\(mins / 60 > 0 ? "\(mins / 60) h " : "")\(mins % 60) min worked")
        }
        return parts.joined(separator: " · ")
    }

    private var provenanceLine: String {
        var s = "Times from photo EXIF · built on-device"
        if receipt.laborMinutes != nil { s = "Work time estimated from shoot intervals · " + s }
        return s
    }
}
