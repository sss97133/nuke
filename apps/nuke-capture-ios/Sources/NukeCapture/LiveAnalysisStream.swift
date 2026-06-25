// LiveAnalysisStream.swift — the ENGINE worklight: the image-analysis pipeline,
// watched live.
//
// This is the surface the owner (and the operator) "look at running": each frame's
// DEEP verdict landing in realtime, newest first — scene, build phase, the
// detective's one-line read, and the derived-stage flags (hashed / session-linked /
// matched) so you can SEE each frame move through the pipeline. Not a progress bar —
// the data itself, streaming. Flow visible == the pipeline is provably alive AND the
// record is growing, in one window.
//
// Fed by get_analysis_stream(p_since, p_limit) — owner-scoped via auth.uid() on the
// JWT (NOT a p_user_id arg; the live fn is auth-scoped), no model spend, an
// incremental cursor (p_since = newest landed_at seen). Shares the RPC
// contract with the web PipelineVisualizer (WEB_PARITY), and a tapped frame opens the
// SAME AnalyzedEvidenceView the ANALYZED grid drills to (one stream + one drill, never
// two pipelines). Develops Today in place; mints no parallel data layer.

import SwiftUI

// ─── One streamed frame (1:1 with a get_analysis_stream element) ──────────────

struct AnalysisStreamRow: Decodable, Identifiable {
    let image_id: UUID
    let vehicle_id: UUID?
    let vehicle: String?
    let thumbnail_url: String?
    let image_url: String?
    let landed_at: String           // timestamptz ISO — also the incremental cursor
    let scene_type: String?
    let build_phase: String?
    let narrative: String?
    let components: [Comp]?
    let hashed: Bool?
    let sessioned: Bool?
    let is_duplicate: Bool?
    let match_status: String?

    var id: UUID { image_id }

    struct Comp: Decodable {
        let label: String?
        let part_number_guess: String?
    }

    /// Build an AnalyzedPhoto so a tapped frame opens the SAME evidence rail the
    /// ANALYZED grid uses — that drill loads the full deep verdict by image_id.
    var asAnalyzedPhoto: AnalyzedPhoto {
        AnalyzedPhoto(
            id: image_id,
            url: image_url,
            thumb: thumbnail_url,
            vehicle_id: vehicle_id,
            taken_at: nil,                 // landed_at is analysis time, not capture time
            file_name: nil,
            scene: scene_type,
            phase: build_phase,
            intent: nil,
            components: (components ?? []).compactMap { $0.label }.filter { !$0.isEmpty },
            analyzed_at: landed_at,
            analyzed_by: nil
        )
    }
}

// ─── The live stream section (drops into Today's List, like GarageStrip) ──────

struct LiveAnalysisStream: View {
    let userId: String

    @State private var rows: [AnalysisStreamRow] = []
    @State private var newestSeen: String?            // cursor: max landed_at held
    @State private var loaded = false
    @State private var loadError = false
    @State private var freshIDs: Set<UUID> = []       // rows that just landed → brief beat
    @State private var selected: AnalyzedPhoto?

    private let maxRows = 50

    var body: some View {
        Group {
            Section {
                if !rows.isEmpty {
                    ForEach(rows) { row in
                        Button {
                            selected = row.asAnalyzedPhoto
                        } label: {
                            StreamRowView(row: row, isFresh: freshIDs.contains(row.image_id))
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(freshIDs.contains(row.image_id)
                                           ? Color.secondary.opacity(0.12) : Color.clear)
                    }
                } else if loadError {
                    HStack(spacing: 8) {
                        Label("Couldn't reach the pipeline", systemImage: "wifi.exclamationmark")
                            .font(.caption2).foregroundStyle(.secondary)
                        Spacer()
                        Button("Retry") { Task { await poll(reset: true) } }
                            .font(.caption2)
                    }
                } else if !loaded {
                    // Worklight: a labeled stage, never a bare spinner.
                    HStack(spacing: 8) {
                        ProgressView().scaleEffect(0.7)
                        Text("Reading the pipeline…")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                } else {
                    // Loaded, nothing landed yet: armed + honest (the liveness instrument).
                    Text("Pipeline armed — newest verdicts land here first.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            } header: {
                HStack(spacing: 6) {
                    Text("Live analysis")
                    Spacer()
                    if !rows.isEmpty {
                        Text("\(rows.count)")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            } footer: {
                Text("Each frame's deep read landing in realtime — tap one for its evidence.")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .task(id: userId) { await runLoop() }
        .fullScreenCover(item: $selected) { photo in
            AnalyzedEvidenceView(photo: photo)
        }
    }

    /// Initial backfill, then poll every 4s with the cursor — newer verdicts
    /// prepend in front of the owner (the pour is the show).
    private func runLoop() async {
        await poll(reset: true)
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(4))
            await poll(reset: false)
        }
    }

    private func poll(reset: Bool) async {
        struct P: Encodable {
            let p_since: String?     // nil → omitted → RPC default NULL (full backfill)
            let p_limit: Int
        }
        // The live fn is auth.uid()-scoped — the owner comes from the JWT, not an
        // arg. userId is only the signed-in guard (no session → no auth.uid() → empty).
        guard !userId.isEmpty else { loaded = true; return }
        do {
            let since = reset ? nil : newestSeen
            let fetched: [AnalysisStreamRow] = try await SupabaseService.client
                .rpc("get_analysis_stream",
                     params: P(p_since: since, p_limit: 40))
                .execute()
                .value
            loadError = false
            merge(fetched, reset: reset)
        } catch {
            if rows.isEmpty { loadError = true }   // a failed REFRESH never wipes rows on screen
            NSLog("NukeCapture analysis stream failed: %@", String(describing: error))
        }
        loaded = true
    }

    private func merge(_ fetched: [AnalysisStreamRow], reset: Bool) {
        if reset {
            withAnimation(.easeInOut(duration: 0.3)) { rows = Array(fetched.prefix(maxRows)) }
            freshIDs = []
        } else if !fetched.isEmpty {
            // Cursor returns only newer rows; prepend the ones we don't hold yet.
            let existing = Set(rows.map { $0.image_id })
            let incoming = fetched.filter { !existing.contains($0.image_id) }
            guard !incoming.isEmpty else { return }
            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                rows = Array((incoming + rows).prefix(maxRows))
            }
            let ids = Set(incoming.map { $0.image_id })
            freshIDs = ids
            // Fade the "just landed" beat after a moment — motion driven by the
            // landing, never decoration.
            Task {
                try? await Task.sleep(for: .seconds(2.5))
                await MainActor.run {
                    withAnimation(.easeOut(duration: 0.6)) { freshIDs.subtract(ids) }
                }
            }
        }
        // Advance the cursor to the newest landed_at we hold (ISO-UTC strings sort
        // chronologically), so the next poll asks only for what's newer.
        newestSeen = rows.map { $0.landed_at }.max()
    }
}

// ─── One streamed row — instrument grammar, monochrome, drillable ─────────────

private struct StreamRowView: View {
    let row: AnalysisStreamRow
    let isFresh: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            CachedAsyncImage(url: NukeImage.thumb(row.thumbnail_url ?? row.image_url, width: 160)) { img in
                img.resizable().scaledToFill()
            } placeholder: {
                Color(.secondarySystemFill)
            }
            .frame(width: 52, height: 52)
            .clipShape(RoundedRectangle(cornerRadius: 6))

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(vehicleName)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                        .foregroundStyle(.primary)
                    Spacer(minLength: 4)
                    Text(StreamRelTime.ago(row.landed_at))
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.secondary)
                }

                if !sceneLine.isEmpty {
                    Text(sceneLine)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                if let n = row.narrative, !n.isEmpty {
                    Text(n)
                        .font(.caption2)
                        .foregroundStyle(.primary.opacity(0.85))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                StageFlags(row: row)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    private var vehicleName: String {
        let v = (row.vehicle ?? "").trimmingCharacters(in: .whitespaces)
        return (v.isEmpty ? "VEHICLE" : v).uppercased()
    }

    private var sceneLine: String {
        [row.scene_type, row.build_phase]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
            .replacingOccurrences(of: "_", with: " ")
    }
}

/// The derived-stage flags — the frame's progress through the pipeline, shown as
/// the data itself (CLI register), not a progress bar. Renders only what's true.
private struct StageFlags: View {
    let row: AnalysisStreamRow

    private var flags: [String] {
        var out: [String] = []
        if row.hashed == true { out.append("hashed") }
        if row.sessioned == true { out.append("sessioned") }
        if let m = row.match_status, !m.isEmpty, m != "unmatched", m != "none" {
            out.append(m.replacingOccurrences(of: "_", with: " "))
        }
        if row.is_duplicate == true { out.append("dup") }
        return out
    }

    var body: some View {
        if !flags.isEmpty {
            HStack(spacing: 6) {
                ForEach(flags, id: \.self) { f in
                    Text(f)
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .overlay {
                            RoundedRectangle(cornerRadius: 3)
                                .stroke(Color.secondary.opacity(0.3), lineWidth: 0.5)
                        }
                }
            }
            .padding(.top, 1)
        }
    }
}

// ─── Relative time off a Postgres timestamptz ISO string ──────────────────────

private enum StreamRelTime {
    private static let fmt: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]   // second precision is plenty for "ago"
        return f
    }()

    static func ago(_ iso: String) -> String {
        // Postgres returns microseconds the formatter can't parse — strip the
        // fractional part, then read at second precision.
        let cleaned = iso.replacingOccurrences(
            of: #"\.\d+"#, with: "", options: .regularExpression)
        guard let d = fmt.date(from: cleaned) else {
            return String(iso.dropFirst(11).prefix(5))   // fall back to HH:mm
        }
        let s = max(0, Int(Date().timeIntervalSince(d)))
        if s < 60 { return "\(s)s" }
        if s < 3600 { return "\(s / 60)m" }
        if s < 86400 { return "\(s / 3600)h" }
        return "\(s / 86400)d"
    }
}
