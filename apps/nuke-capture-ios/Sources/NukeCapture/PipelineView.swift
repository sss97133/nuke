// PipelineView.swift — the live analysis pipeline, on device.
//
// What the owner asked to SEE: each photo's real journey as it happens — received →
// analyzing → the verdict landing with its schema (scene, build phase, components, OCR,
// narrative) — led by the vehicle it's identified with, newest first, refreshing live.
// Not a replay of finished rows: get_pipeline_events returns the actual stage events the
// drain emits as it works. Pure read — no model spend, no writes.

import SwiftUI

// One stage event from get_pipeline_events. Unknown detail keys are ignored by Decodable.
struct PipelineEvent: Decodable {
    let event_id: UUID
    let stage: String
    let created_at: String
    let image_id: UUID
    let vehicle_id: UUID?
    let vehicle: String?
    let thumbnail_url: String?
    let image_url: String?
    let received_at: String?
    let detail: Detail?

    struct Detail: Decodable {
        let scene_type: String?
        let build_phase: String?
        let narrative: String?
        let component_count: Int?
        let ocr_count: Int?
    }
}

// One image's journey, assembled from its events.
struct Journey: Identifiable {
    let image_id: UUID
    var vehicle_id: UUID?
    var vehicle: String?
    var thumbnail_url: String?
    var image_url: String?
    var stage: String
    var last_at: String
    var detail: PipelineEvent.Detail?
    var id: UUID { image_id }
}

// received ─ analyzing ─ landed
private let RAIL: [(key: String, label: String)] = [
    ("received", "received"), ("analyzing", "analyzing"), ("verdict_landed", "landed"),
]
private func rank(_ stage: String) -> Int { RAIL.firstIndex { $0.key == stage } ?? 0 }

@MainActor
final class PipelineStore: ObservableObject {
    @Published private(set) var cards: [Journey] = []
    @Published private(set) var error: String?
    @Published private(set) var loadedOnce = false

    private var byImage: [UUID: Journey] = [:]
    private var poller: Task<Void, Never>?
    private let pollInterval: UInt64 = 4_000_000_000 // 4s
    private let maxCards = 120

    func start() {
        guard poller == nil else { return }
        poller = Task { [weak self] in
            while !Task.isCancelled {
                await self?.fetch()
                try? await Task.sleep(nanoseconds: self?.pollInterval ?? 4_000_000_000)
            }
        }
    }

    func stop() { poller?.cancel(); poller = nil }
    func refresh() async { await fetch() }

    private func fetch() async {
        do {
            let events: [PipelineEvent] = try await SupabaseService.client
                .rpc("get_pipeline_events", params: ["p_limit": 120])
                .execute()
                .value
            error = nil
            loadedOnce = true
            for e in events { merge(e) }
            cards = byImage.values
                .sorted { $0.last_at > $1.last_at }
                .prefix(maxCards)
                .map { $0 }
        } catch {
            self.error = String(describing: error)
            loadedOnce = true
        }
    }

    private func merge(_ e: PipelineEvent) {
        var j = byImage[e.image_id] ?? Journey(
            image_id: e.image_id, vehicle_id: e.vehicle_id, vehicle: e.vehicle,
            thumbnail_url: e.thumbnail_url, image_url: e.image_url,
            stage: "received", last_at: e.created_at, detail: nil
        )
        j.vehicle = e.vehicle ?? j.vehicle
        j.vehicle_id = e.vehicle_id ?? j.vehicle_id
        j.thumbnail_url = e.thumbnail_url ?? j.thumbnail_url
        j.image_url = e.image_url ?? j.image_url
        if rank(e.stage) >= rank(j.stage) { j.stage = e.stage }
        if e.stage == "verdict_landed", let d = e.detail { j.detail = d }
        if e.created_at > j.last_at { j.last_at = e.created_at }
        byImage[e.image_id] = j
    }
}

struct PipelineView: View {
    @StateObject private var store = PipelineStore()

    var body: some View {
        NavigationStack {
            Group {
                if !store.loadedOnce {
                    ProgressView("Connecting to pipeline…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = store.error, store.cards.isEmpty {
                    ContentUnavailableView("Pipeline unavailable", systemImage: "exclamationmark.triangle", description: Text(error))
                } else if store.cards.isEmpty {
                    ContentUnavailableView(
                        "Nothing analyzed yet",
                        systemImage: "waveform.path.ecg",
                        description: Text("As the drain processes your photos, each one streams through here with its journey.")
                    )
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(store.cards) { card in
                                JourneyCard(j: card)
                                Divider()
                            }
                        }
                        .padding(.horizontal, 12)
                        .animation(.easeOut(duration: 0.25), value: store.cards.map(\.id))
                    }
                }
            }
            .navigationTitle("Pipeline")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 6) {
                        Circle().fill(.green).frame(width: 7, height: 7)
                        Text("LIVE").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                    }
                }
            }
            .refreshable { await store.refresh() }
        }
        .task { store.start() }
        .onDisappear { store.stop() }
    }
}

// One image: thumbnail + vehicle + the journey rail + the schema that landed.
private struct JourneyCard: View {
    let j: Journey

    private var landed: Bool { j.stage == "verdict_landed" }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            AsyncImage(url: URL(string: j.thumbnail_url ?? j.image_url ?? "")) { phase in
                if let img = phase.image { img.resizable().scaledToFill() }
                else { Rectangle().fill(Color(.secondarySystemFill)) }
            }
            .frame(width: 88, height: 88)
            .clipped()

            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(j.vehicle ?? "Unidentified vehicle").font(.headline)
                    Spacer()
                    Text(relativeAgo(j.last_at)).font(.caption2.monospaced()).foregroundStyle(.secondary)
                }

                StageRail(stage: j.stage)

                if !landed {
                    Text("reading the frame…").font(.footnote).foregroundStyle(.secondary)
                }

                if landed, let n = j.detail?.narrative, !n.isEmpty {
                    Text(n).font(.footnote).foregroundStyle(.primary).fixedSize(horizontal: false, vertical: true)
                }

                if landed {
                    ForEach(Array(fields.enumerated()), id: \.offset) { _, f in
                        HStack(alignment: .top, spacing: 8) {
                            Text(f.key.uppercased())
                                .font(.system(size: 8, weight: .bold)).tracking(0.5)
                                .foregroundStyle(.secondary)
                                .frame(width: 86, alignment: .trailing)
                            Text(f.value).font(.caption).foregroundStyle(.primary)
                        }
                    }
                }
            }
        }
        .padding(.vertical, 10)
    }

    private var fields: [(key: String, value: String)] {
        var out: [(String, String)] = []
        if let s = j.detail?.scene_type, s != "unknown" { out.append(("scene", pretty(s))) }
        if let b = j.detail?.build_phase, b != "unknown" { out.append(("build phase", pretty(b))) }
        if let c = j.detail?.component_count, c > 0 { out.append(("components", "\(c)")) }
        if let o = j.detail?.ocr_count, o > 0 { out.append(("text read", "\(o)")) }
        return out.map { (key: $0.0, value: $0.1) }
    }

    private func pretty(_ s: String) -> String { s.replacingOccurrences(of: "_", with: " ") }
}

// received ─ analyzing ─ landed; reached stages filled, in-flight stage pulses.
private struct StageRail: View {
    let stage: String
    @State private var pulse = false

    var body: some View {
        let at = rank(stage)
        HStack(spacing: 6) {
            ForEach(Array(RAIL.enumerated()), id: \.offset) { i, s in
                if i > 0 {
                    Rectangle()
                        .fill(i <= at ? Color.primary : Color.secondary.opacity(0.3))
                        .frame(width: 14, height: 2)
                }
                let done = i <= at
                let current = i == at && stage != "verdict_landed"
                Text(s.label.uppercased())
                    .font(.system(size: 8, weight: .bold)).tracking(0.5)
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .background(done ? Color.primary : Color.clear)
                    .foregroundStyle(done ? Color(.systemBackground) : .secondary)
                    .overlay(Rectangle().stroke(Color.secondary.opacity(done ? 0 : 0.4), lineWidth: 1))
                    .opacity(current && pulse ? 0.35 : 1)
            }
        }
        .onAppear { withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { pulse = true } }
    }
}

// "Xs / Xm / Xh / Xd ago" from a Postgres/ISO timestamp string.
private func relativeAgo(_ iso: String) -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    var date = f.date(from: iso)
    if date == nil {
        f.formatOptions = [.withInternetDateTime]
        date = f.date(from: iso)
    }
    guard let d = date else { return "" }
    let s = max(0, Int(Date().timeIntervalSince(d)))
    if s < 60 { return "\(s)s ago" }
    if s < 3600 { return "\(s / 60)m ago" }
    if s < 86400 { return "\(s / 3600)h ago" }
    return "\(s / 86400)d ago"
}
