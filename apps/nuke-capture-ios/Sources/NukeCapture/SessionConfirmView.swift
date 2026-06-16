// SessionConfirmView.swift — the owner-confirm sweep (the backlog surface).
//
// A session = one day at one GPS cell = one truck. The owner taps a session, picks
// the vehicle, and the WHOLE session routes home in one call (attribute_image_session
// → attribute_testimony, audited). This is the reliable path for sessions with no VIN
// in frame, and the place an "unknown vehicle" gets a record instead of a mis-file.
//
// CODEX: square thumbnails, mono digits, ALL-CAPS labels, facet doctrine (no row
// unless count > 0), no empty-state illustration — an honest one-line truth instead.

import SwiftUI

struct SessionConfirmView: View {
    @ObservedObject private var attribution = AttributionEngine.shared
    @State private var picking: AttributionEngine.OrphanSession?
    @State private var routedNote: String?

    var body: some View {
        List {
            if let note = routedNote {
                Section { Text(note).font(.caption).foregroundStyle(.secondary) }
            }
            if attribution.orphanSessions.isEmpty {
                Section {
                    Text(attribution.isLoadingConfirm ? "READING SESSIONS…" : "NOTHING TO CONFIRM")
                        .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                }
            } else {
                Section {
                    ForEach(attribution.orphanSessions) { s in
                        Button { picking = s } label: { sessionRow(s) }
                            .buttonStyle(.plain)
                    }
                } footer: {
                    Text("Each session is one day at one place — tap to send all its photos to a vehicle.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Confirm Sessions")
        .navigationBarTitleDisplayMode(.inline)
        .task { await attribution.loadConfirmData() }
        .refreshable { await attribution.loadConfirmData() }
        .sheet(item: $picking) { session in
            VehiclePickerSheet(session: session) { vehicle in
                Task {
                    let n = await attribution.confirm(session: session, vehicleId: vehicle.id)
                    routedNote = "\(n) photos → \(vehicle.label)"
                    picking = nil
                }
            }
        }
    }

    @ViewBuilder private func sessionRow(_ s: AttributionEngine.OrphanSession) -> some View {
        HStack(spacing: 12) {
            AsyncImage(url: Self.thumb(s.sample_url)) { img in
                img.resizable().scaledToFill()
            } placeholder: { Rectangle().fill(Color(.secondarySystemFill)) }
            .frame(width: 56, height: 56).clipped()
            VStack(alignment: .leading, spacing: 3) {
                Text(s.session_day).font(.subheadline.monospacedDigit().weight(.medium))
                Text("\(s.photo_count) PHOTOS").font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary).kerning(0.5)
                Text(s.gps_cell).font(.caption2.monospacedDigit()).foregroundStyle(.tertiary)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
    }

    /// object/public → render thumbnail (square, HEIC-safe, small).
    static func thumb(_ url: String?) -> URL? {
        guard let url else { return nil }
        let r = url.replacingOccurrences(of: "/storage/v1/object/public/",
                                         with: "/storage/v1/render/image/public/")
        let sep = r.contains("?") ? "&" : "?"
        return URL(string: "\(r)\(sep)width=160&height=160&resize=cover")
    }
}

/// Vehicle picker — the owner's vehicles, square thumbnails. Tap routes the session.
private struct VehiclePickerSheet: View {
    let session: AttributionEngine.OrphanSession
    let onPick: (AttributionEngine.OwnerVehicle) -> Void
    @ObservedObject private var attribution = AttributionEngine.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(attribution.ownerVehicles) { v in
                        Button { onPick(v) } label: {
                            HStack(spacing: 12) {
                                AsyncImage(url: SessionConfirmView.thumb(v.primary_image_url)) { img in
                                    img.resizable().scaledToFill()
                                } placeholder: { Rectangle().fill(Color(.secondarySystemFill)) }
                                .frame(width: 48, height: 48).clipped()
                                Text(v.label.isEmpty ? "VEHICLE" : v.label)
                                    .font(.subheadline.weight(.medium))
                                Spacer()
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text("\(session.photo_count) photos · \(session.session_day)")
                } footer: {
                    Text("Pick the vehicle these photos belong to. If it's not here, add it on nuke.ag first.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Which vehicle?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
