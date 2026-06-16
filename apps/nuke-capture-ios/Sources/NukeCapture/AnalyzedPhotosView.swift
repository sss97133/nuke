// AnalyzedPhotosView.swift — the evidence behind the ANALYZED counter.
//
// The Today tab shows a big number: how many of the owner's photos vision has
// analyzed. That number was a dead end — no way to SEE the images or the atoms
// the engine extracted from them. This screen is the drill: count → grid of
// analyzed thumbnails → full-screen evidence rail per photo (scene / phase /
// intent chips, the component list, a provenance line).
//
// Design: traditional instrument grammar. A square thumbnail grid (the contact
// sheet), and a black evidence sheet that reads like a work-order back side —
// no gradients, no glow, monospaced where it's a record. Render only atoms
// that ACTUALLY exist on the row; a photo with no vision atoms says "Analysis
// pending" rather than printing empty rows.
//
// Server truth: rpc get_user_analyzed_photos(p_user_id) → SETOF, owner-gated.
// Thumbnails go through the render endpoint; the full-res original appears only
// in the full-screen viewer (IMAGE RULE).

import SwiftUI

// ─── The analyzed-photo row (1:1 with the RPC element shape) ──────────────────

/// One analyzed photo as returned by get_user_analyzed_photos. Every field but
/// id/url is optional — the RPC emits whatever atoms exist, skips the rest.
struct AnalyzedPhoto: Decodable, Identifiable {
    let id: UUID
    let url: String?
    let thumb: String?
    let vehicle_id: UUID?
    let taken_at: String?
    let file_name: String?
    let scene: String?
    let phase: String?
    let intent: String?
    let components: [String]?
    let analyzed_at: String?
    let analyzed_by: String?
}

// ─── The grid (contact sheet) ────────────────────────────────────────────────

/// Loads the owner's analyzed photos and lays them out as a square 3-up contact
/// sheet. Same init shape ProfileTab calls: AnalyzedPhotosView(userId:).
struct AnalyzedPhotosView: View {
    let userId: String

    @State private var photos: [AnalyzedPhoto] = []
    @State private var loaded = false
    @State private var loadError: String?
    @State private var selected: AnalyzedPhoto?

    // 3 columns, hairline gutter — reads as a film contact sheet, not cards.
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 3)

    var body: some View {
        ScrollView {
            // Subheader: the count this screen is the evidence for.
            if loaded && !photos.isEmpty {
                HStack {
                    Text("\(photos.count) analyzed")
                        .font(.caption.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .kerning(0.5)
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 4)
            }

            if !loaded {
                // Worklight: a labeled stage, never a bare spinner.
                VStack(spacing: 8) {
                    ProgressView()
                    Text("Loading analyzed photos…")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 48)
            } else if let loadError {
                // Failed ≠ empty — say it, with a way back.
                ContentUnavailableView {
                    Label(loadError, systemImage: "wifi.exclamationmark")
                } description: {
                    Text("Check your connection.")
                } actions: {
                    Button("Retry") { Task { await load() } }
                        .buttonStyle(.borderedProminent)
                }
                .padding(.top, 32)
            } else if photos.isEmpty {
                ContentUnavailableView(
                    "No analyzed photos yet",
                    systemImage: "sparkles",
                    description: Text("Photos become analyzed as the pipeline reads them.")
                )
                .padding(.top, 32)
            } else {
                LazyVGrid(columns: columns, spacing: 2) {
                    ForEach(photos) { photo in
                        AnalyzedGridCell(url: NukeImage.thumb(photo.thumb ?? photo.url, width: 200))
                            .onTapGesture { selected = photo }
                    }
                }
                .padding(.horizontal, 2)
            }
        }
        .navigationTitle("Analyzed")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .fullScreenCover(item: $selected) { photo in
            AnalyzedEvidenceView(photo: photo)
        }
    }

    private func load() async {
        guard !userId.isEmpty else {
            loadError = "Not signed in"
            loaded = true
            return
        }
        loadError = nil   // clear so a successful retry leaves the error branch
        do {
            // SETOF rows → decode the array directly (NOT array-of-array).
            let rows: [AnalyzedPhoto] = try await SupabaseService.client
                .rpc("get_user_analyzed_photos", params: ["p_user_id": userId])
                .execute()
                .value
            photos = rows
        } catch {
            loadError = "Load failed"
            NSLog("NukeCapture analyzed photos failed: %@", String(describing: error))
        }
        loaded = true   // flip regardless — stops the infinite spinner
    }

}

/// One square cell in the contact sheet. Remote thumb only — full-res lives in
/// the evidence viewer.
private struct AnalyzedGridCell: View {
    let url: URL?

    var body: some View {
        Color(.secondarySystemFill)
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                CachedAsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    ProgressView().scaleEffect(0.7)
                }
            }
            .clipped()
            .contentShape(Rectangle())
    }
}

// ─── The evidence viewer (full-res + atom rail) ──────────────────────────────

/// Full-screen black evidence sheet: the original image up top, the extracted
/// atoms below as a work-order back side. Render only what exists.
/// Internal (not private) so the vehicle sheet's photo→analysis drill presents
/// the SAME evidence surface — one analysis view, never a parallel one.
struct AnalyzedEvidenceView: View {
    let photo: AnalyzedPhoto
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                VStack(spacing: 0) {
                    // Full-resolution original (IMAGE RULE: only here, not in grid).
                    AsyncImage(url: URL(string: photo.url ?? "")) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().scaledToFit()
                        case .empty:
                            ProgressView().tint(.white)
                        case .failure:
                            Image(systemName: "photo")
                                .font(.largeTitle)
                                .foregroundStyle(.white.opacity(0.4))
                        @unknown default:
                            Color.clear
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                    EvidenceRail(photo: photo)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(.white)
                }
            }
            .toolbarBackground(.black, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .navigationBarTitleDisplayMode(.inline)
        }
        .preferredColorScheme(.dark)
    }
}

/// The atom rail — the back side of the work order. Skips every field that's
/// null/empty (PROVENANCE LAW), and if no vision atoms exist at all, prints a
/// single honest "Analysis pending" line instead of a wall of blanks.
private struct EvidenceRail: View {
    let photo: AnalyzedPhoto

    // The three scene atoms that render as capsule chips, in reading order.
    private var chips: [(String, String)] {
        var out: [(String, String)] = []
        if let s = photo.scene, !s.isEmpty  { out.append(("SCENE", s)) }
        if let p = photo.phase, !p.isEmpty  { out.append(("PHASE", p)) }
        if let i = photo.intent, !i.isEmpty { out.append(("INTENT", i)) }
        return out
    }

    private var componentList: [String] {
        (photo.components ?? []).filter { !$0.isEmpty }
    }

    private var hasAnyAtoms: Bool {
        !chips.isEmpty || !componentList.isEmpty
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                // Capture time — the record's primary timestamp.
                if let taken = photo.taken_at, !taken.isEmpty {
                    Text(taken.prefix(10))
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.6))
                }

                if hasAnyAtoms {
                    // scene · phase · intent as small capsule chips.
                    if !chips.isEmpty {
                        HStack(spacing: 6) {
                            ForEach(chips, id: \.1) { _, value in
                                ChipLabel(text: value)
                            }
                            Spacer(minLength: 0)
                        }
                    }

                    // Components — the extracted what's-in-frame, as record rows.
                    if !componentList.isEmpty {
                        VStack(alignment: .leading, spacing: 0) {
                            Text("COMPONENTS")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.white.opacity(0.5))
                                .kerning(0.5)
                                .padding(.bottom, 4)
                            ForEach(Array(componentList.enumerated()), id: \.offset) { _, comp in
                                HStack(alignment: .top, spacing: 8) {
                                    Text("·")
                                        .foregroundStyle(.white.opacity(0.4))
                                    Text(comp)
                                        .font(.footnote)
                                        .foregroundStyle(.white.opacity(0.85))
                                        .fixedSize(horizontal: false, vertical: true)
                                    Spacer(minLength: 0)
                                }
                                .padding(.vertical, 3)
                            }
                        }
                    }
                } else {
                    Text("Analysis pending")
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.5))
                }

                // Provenance line — when this was analyzed and by whom.
                if let analyzedAt = photo.analyzed_at, !analyzedAt.isEmpty {
                    let by = photo.analyzed_by.map { " · " + $0 } ?? ""
                    Text("analyzed " + analyzedAt.prefix(10) + by)
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.45))
                        .padding(.top, 2)
                }

                // View vehicle — only when this photo is attributed to one.
                if let vid = photo.vehicle_id {
                    NavigationLink {
                        VehicleDetailView(vehicleId: vid.uuidString.lowercased())
                    } label: {
                        HStack {
                            Text("View vehicle")
                            Spacer()
                            Image(systemName: "chevron.right")
                        }
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(.white)
                        .padding(.vertical, 10)
                        .padding(.horizontal, 12)
                        .background {
                            RoundedRectangle(cornerRadius: 8)
                                .fill(Color.white.opacity(0.12))
                        }
                    }
                    .padding(.top, 4)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: 280)
        .background(Color.black)
    }
}

/// A small capsule chip in the rail (scene/phase/intent value).
private struct ChipLabel: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption2.weight(.medium))
            .foregroundStyle(.white.opacity(0.9))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background {
                Capsule().fill(Color.white.opacity(0.12))
            }
            .overlay {
                Capsule().stroke(Color.white.opacity(0.25), lineWidth: 1)
            }
    }
}
