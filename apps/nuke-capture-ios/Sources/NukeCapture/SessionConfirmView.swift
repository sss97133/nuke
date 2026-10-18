// SessionConfirmView.swift — the owner-confirm sweep (the backlog surface).
//
// A session = one day at one GPS cell = one truck. The owner taps a session, picks
// the vehicle, and the WHOLE session routes home in one call (attribute_image_session
// → attribute_testimony, audited). This is the reliable path for sessions with no VIN
// in frame, and the place an "unknown vehicle" gets a record instead of a mis-file.
// A session the server matched (get_orphan_sessions.suggested_vehicle_id: the phone's
// own suggestion for its photos, else the vehicle most worked on that day) confirms
// with one tap on its row, or all at once. Still a suggestion until the owner taps.
//
// CODEX: square thumbnails, mono digits, ALL-CAPS labels, facet doctrine (no row
// unless count > 0), no empty-state illustration — an honest one-line truth instead.

import SwiftUI

struct SessionConfirmView: View {
    @ObservedObject private var attribution = AttributionEngine.shared
    @State private var picking: AttributionEngine.OrphanSession?
    @State private var routedNote: String?
    @State private var isBatchConfirming = false
    @State private var quickConfirmingID: String?

    private var suggestedSessions: [AttributionEngine.OrphanSession] {
        attribution.orphanSessions.filter { $0.suggested_vehicle_id != nil }
    }

    var body: some View {
        List {
            if let note = routedNote {
                Section { Text(note).font(.caption).foregroundStyle(.secondary) }
            }
            // Tier 3 → 4: confirm the days the analysis derived (the value gate).
            Section {
                NavigationLink { WorkDaySignView() } label: {
                    Label("Confirm your days", systemImage: "checkmark.seal")
                }
            }
            if !suggestedSessions.isEmpty {
                Section {
                    Button {
                        guard !isBatchConfirming else { return }
                        isBatchConfirming = true
                        Task {
                            defer { isBatchConfirming = false }
                            do {
                                let res = try await attribution.confirmAllSuggested()
                                routedNote = "Confirmed \(res.sessions) sessions (\(res.photos) photos)"
                            } catch {
                                routedNote = "Batch confirm stopped: \(ReadFailure.text(error)). Filed sessions are gone from the list; the rest remain."
                            }
                        }
                    } label: {
                        HStack {
                            Label(
                                isBatchConfirming
                                    ? "Confirming suggested sessions…"
                                    : "Confirm All Suggested (\(suggestedSessions.count))",
                                systemImage: "checkmark.circle.fill"
                            )
                            .font(.subheadline.weight(.semibold))
                            Spacer()
                            if isBatchConfirming {
                                ProgressView()
                            } else {
                                let totalPhotos = suggestedSessions.reduce(0) { $0 + $1.photo_count }
                                Text("\(totalPhotos) PHOTOS")
                                    .font(.caption2.monospacedDigit().weight(.semibold))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .disabled(isBatchConfirming || attribution.isLoadingConfirm)
                } footer: {
                    Text("Files every session to its suggested vehicle: a VIN read on this phone, else the vehicle you worked on most that day.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
            if let error = attribution.confirmLoadError {
                Section {
                    Text(error).font(.footnote).foregroundStyle(.secondary)
                    Button("Retry") { Task { await attribution.loadConfirmData() } }
                        .disabled(attribution.isLoadingConfirm)
                }
            }
            if attribution.orphanSessions.isEmpty && attribution.confirmLoadError == nil {
                Section {
                    Text(attribution.isLoadingConfirm || !attribution.confirmLoaded
                         ? "READING SESSIONS…" : "NOTHING TO CONFIRM")
                        .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                }
            } else {
                Section {
                    ForEach(attribution.orphanSessions) { s in
                        sessionRow(s)
                            .disabled(attribution.isLoadingConfirm || attribution.confirmLoadError != nil || isBatchConfirming)
                    }
                } footer: {
                    Text("Each session is one day at one place — tap a session to pick a vehicle, or tap Confirm when a suggested vehicle matches.")
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
                let n = try await attribution.confirm(session: session, vehicleId: vehicle.id)
                routedNote = "\(n) photos → \(vehicle.label)"
                picking = nil
            }
        }
    }

    @ViewBuilder private func sessionRow(_ s: AttributionEngine.OrphanSession) -> some View {
        HStack(spacing: 12) {
            Button { picking = s } label: {
                HStack(spacing: 12) {
                    AsyncImage(url: Self.thumb(s.sample_url)) { img in
                        img.resizable().scaledToFill()
                    } placeholder: { Rectangle().fill(Color(.secondarySystemFill)) }
                    .frame(width: 56, height: 56).clipped()
                    VStack(alignment: .leading, spacing: 3) {
                        Text(s.session_day).font(.subheadline.monospacedDigit().weight(.medium))
                        Text("\(s.photo_count) PHOTOS").font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary).kerning(0.5)
                        if let label = s.suggested_vehicle_label, !label.isEmpty {
                            Text(label)
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.blue)
                                .lineLimit(1)
                        } else {
                            Text(s.gps_cell).font(.caption2.monospacedDigit()).foregroundStyle(.tertiary)
                        }
                    }
                    Spacer()
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if let vid = s.suggested_vehicle_id, let label = s.suggested_vehicle_label {
                Button {
                    guard quickConfirmingID == nil else { return }
                    quickConfirmingID = s.id
                    Task {
                        defer { quickConfirmingID = nil }
                        do {
                            let n = try await attribution.confirm(session: s, vehicleId: vid)
                            routedNote = "\(n) photos → \(label)"
                        } catch {
                            picking = s
                        }
                    }
                } label: {
                    if quickConfirmingID == s.id {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Confirm")
                            .font(.caption.weight(.semibold))
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(quickConfirmingID != nil)
            } else {
                Button { picking = s } label: {
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
            }
        }
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
    let onPick: (AttributionEngine.OwnerVehicle) async throws -> Void
    @ObservedObject private var attribution = AttributionEngine.shared
    @Environment(\.dismiss) private var dismiss
    @State private var isRouting = false
    @State private var routingError: String?
    @State private var query = ""
    /// The phone's own suggestion for this session (a VIN read, or a session the VIN anchored),
    /// read from the rows' auto_suggested_vehicle_id. Shown first; the owner still decides.
    @State private var suggestion: (vehicleId: String, reason: String)?

    private var shown: [AttributionEngine.OwnerVehicle] {
        let q = query.trimmingCharacters(in: .whitespaces).uppercased()
        let all = attribution.ownerVehicles
        return q.isEmpty ? all : all.filter { $0.label.contains(q) }
    }

    var body: some View {
        NavigationStack {
            List {
                if let error = routingError {
                    Section {
                        Text(error).font(.footnote).foregroundStyle(.red)
                    }
                }
                if let sug = suggestion, query.isEmpty,
                   let v = attribution.ownerVehicles.first(where: { $0.id == sug.vehicleId }) {
                    Section {
                        vehicleRow(v)
                    } header: {
                        Text("Suggested · \(sug.reason)")
                    }
                }
                Section {
                    ForEach(shown) { v in vehicleRow(v) }
                } header: {
                    Text("\(session.photo_count) photos · \(session.session_day)")
                } footer: {
                    Text(isRouting ? "Moving photos…"
                         : "Pick the vehicle these photos belong to. If it's not here, add it on nuke.ag first.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
            .searchable(text: $query, prompt: "Year, make or model")
            .task { await loadSuggestion() }
            .navigationTitle("Which vehicle?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .disabled(isRouting)
                }
            }
        }
        .interactiveDismissDisabled(isRouting)
    }

    private struct SuggestionRow: Decodable {
        let auto_suggested_vehicle_id: String?
        let auto_suggestion_reasons: [String]?
    }

    /// The most frequent phone suggestion among this session's photos; a VIN read outranks a
    /// session inheritance. The server's upload-clock guess (suggested_vehicle_id) is not read.
    private func loadSuggestion() async {
        if let vid = session.suggested_vehicle_id {
            suggestion = (vid, "most worked on that day")
        }
        if let vid = session.image_ids.lazy.compactMap({ attribution.suggestionByImage[$0] }).first {
            suggestion = (vid, "read on this phone")
            return
        }
        do {
            let rows: [SuggestionRow] = try await SupabaseService.client.from("vehicle_images")
                .select("auto_suggested_vehicle_id,auto_suggestion_reasons")
                .in("id", values: Array(session.image_ids.prefix(200)))
                .not("auto_suggested_vehicle_id", operator: .is, value: "null")
                .execute().value
            let vin = rows.filter { $0.auto_suggestion_reasons?.contains("vin_ocr_match") == true }
            let pool = vin.isEmpty ? rows : vin
            let counts = Dictionary(grouping: pool.compactMap(\.auto_suggested_vehicle_id), by: { $0 }).mapValues(\.count)
            if let top = counts.max(by: { $0.value < $1.value }) {
                suggestion = (top.key, vin.isEmpty ? "same day and place as a VIN read" : "VIN read in \(top.value) photo\(top.value == 1 ? "" : "s")")
            }
        } catch {
            NSLog("NukeCapture session suggestion read failed: %@", String(describing: error))
        }
    }

    @ViewBuilder private func vehicleRow(_ v: AttributionEngine.OwnerVehicle) -> some View {
        Button {
            guard !isRouting else { return }
            isRouting = true
            routingError = nil
            Task {
                defer { isRouting = false }
                do {
                    try await onPick(v)
                } catch {
                    routingError = error is AttributionEngine.SessionConfirmationError
                        ? error.localizedDescription
                        : "Couldn't move these photos. Your session is still waiting. Try again."
                    NSLog("NukeCapture session routing failed: %@", String(describing: error))
                }
            }
        } label: {
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
        .disabled(isRouting)
    }
}
