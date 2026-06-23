// PipelineView.swift — the live analysis pipeline, on device.
//
// What the owner asked to SEE in the app: each frame as its verdict lands, with the actual
// schema filling in — scene, build phase, components (+ part numbers), OCR read off the metal,
// state — newest first, refreshing live. Not a progress bar; the extracted intelligence itself.
//
// Source: the get_analysis_stream RPC (auth.uid()-scoped, no params but a page limit). We poll
// it on a short interval and merge by image_id, so new verdicts appear as the drain produces
// them. Pure read — no model spend, no writes.

import SwiftUI

// One frame's row from get_analysis_stream. jsonb columns decode into small structs; unknown
// keys are ignored by Decodable, so we only pull what we render.
struct AnalysisStreamRow: Decodable, Identifiable {
    let image_id: UUID
    let vehicle_id: UUID
    let vehicle: String?
    let thumbnail_url: String?
    let image_url: String?
    let landed_at: String
    let scene_type: String?
    let build_phase: String?
    let narrative: String?
    let components: [Component]?
    let text_regions: [TextRegion]?
    let state: StateObs?
    let hashed: Bool
    let sessioned: Bool
    let is_duplicate: Bool
    let match_status: String?

    var id: UUID { image_id }

    struct Component: Decodable { let label: String?; let part_number_guess: String? }
    struct TextRegion: Decodable { let text: String? }
    struct StateObs: Decodable { let paint_state: String?; let completeness: String?; let rust_severity: String? }
}

@MainActor
final class PipelineStore: ObservableObject {
    @Published private(set) var rows: [AnalysisStreamRow] = []
    @Published private(set) var error: String?
    @Published private(set) var loadedOnce = false

    private var poller: Task<Void, Never>?
    private let pollInterval: UInt64 = 4_000_000_000 // 4s
    private let maxRows = 200

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
            let incoming: [AnalysisStreamRow] = try await SupabaseService.client
                .rpc("get_analysis_stream", params: ["p_limit": 60])
                .execute()
                .value
            error = nil
            loadedOnce = true
            // Merge by image_id, newest landed_at first, cap the list.
            var byId: [UUID: AnalysisStreamRow] = [:]
            for r in incoming { byId[r.image_id] = r }
            for r in rows where byId[r.image_id] == nil { byId[r.image_id] = r }
            rows = byId.values
                .sorted { $0.landed_at > $1.landed_at }
                .prefix(maxRows)
                .map { $0 }
        } catch {
            self.error = String(describing: error)
            loadedOnce = true
        }
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
                } else if let error = store.error, store.rows.isEmpty {
                    ContentUnavailableView("Pipeline unavailable", systemImage: "exclamationmark.triangle", description: Text(error))
                } else if store.rows.isEmpty {
                    ContentUnavailableView(
                        "Nothing analyzed yet",
                        systemImage: "waveform.path.ecg",
                        description: Text("As the drain processes your photos, each frame streams in here with its extracted data.")
                    )
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(store.rows) { row in
                                FrameRow(row: row)
                                Divider()
                            }
                        }
                        .padding(.horizontal, 12)
                        .animation(.easeOut(duration: 0.25), value: store.rows.map(\.id))
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

// One frame: thumbnail + the schema that landed for it.
private struct FrameRow: View {
    let row: AnalysisStreamRow

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            AsyncImage(url: URL(string: row.thumbnail_url ?? row.image_url ?? "")) { phase in
                if let img = phase.image {
                    img.resizable().scaledToFill()
                } else {
                    Rectangle().fill(Color(.secondarySystemFill))
                }
            }
            .frame(width: 84, height: 84)
            .clipped()

            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(row.vehicle ?? "Unknown vehicle").font(.headline)
                    Spacer()
                    Text(relativeAgo(row.landed_at)).font(.caption2.monospaced()).foregroundStyle(.secondary)
                }

                if let n = row.narrative, !n.isEmpty {
                    Text(n).font(.footnote).foregroundStyle(.primary).fixedSize(horizontal: false, vertical: true)
                }

                ForEach(Array(fields.enumerated()), id: \.offset) { _, f in
                    HStack(alignment: .top, spacing: 8) {
                        Text(f.key.uppercased())
                            .font(.system(size: 8, weight: .bold)).tracking(0.5)
                            .foregroundStyle(.secondary)
                            .frame(width: 92, alignment: .trailing)
                        Text(f.value)
                            .font(f.mono ? .caption.monospaced() : .caption)
                            .foregroundStyle(f.accent ? Color.accentColor : .primary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .padding(.vertical, 10)
    }

    // The ordered schema fields that landed — the "fill".
    private var fields: [(key: String, value: String, mono: Bool, accent: Bool)] {
        var out: [(String, String, Bool, Bool)] = []
        if let s = row.scene_type, s != "unknown" { out.append(("scene_type", pretty(s), false, false)) }
        if let b = row.build_phase, b != "unknown" { out.append(("build_phase", pretty(b), false, false)) }
        if let st = row.state {
            if let p = st.paint_state { out.append(("paint_state", pretty(p), false, false)) }
            if let c = st.completeness { out.append(("completeness", pretty(c), false, false)) }
            if let r = st.rust_severity, r != "none" { out.append(("rust", pretty(r), false, false)) }
        }
        for c in (row.components ?? []).prefix(8) {
            guard let l = c.label, !l.isEmpty else { continue }
            let pn = c.part_number_guess.map { " #\($0)" } ?? ""
            out.append(("component", l + pn, false, !(c.part_number_guess ?? "").isEmpty))
        }
        for t in (row.text_regions ?? []).prefix(5) {
            if let txt = t.text, !txt.isEmpty { out.append(("ocr", txt, true, true)) }
        }
        return out.map { (key: $0.0, value: $0.1, mono: $0.2, accent: $0.3) }
    }


    private func pretty(_ s: String) -> String { s.replacingOccurrences(of: "_", with: " ") }
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
