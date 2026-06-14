// ProfileTab.swift — profiles: yours, and everyone else's in the same view.
//
// ProfileView is parameterized by user id so the owner's profile and any
// other profile render identically (the phonebook effect — the world is
// already populated). Data, all live prod via the anon/JWT client:
//
//   profiles                          → display name / handle
//   get_user_contribution_days(uuid)  → the work-day record (one row per
//                                       day·kind; grouped here into day rows)
//   get_user_day_receipt(uuid, date)  → tap a day, get the receipt
//   v_user_connections                → own profile only (auth-scoped view):
//                                       the user's grants as kind+count rows
//
// v1 entry to other profiles = search by handle (.searchable over
// profiles.username).

import SwiftUI

// ─── Row models (exact column shapes, verified against prod) ─────────────────

struct ProfileRow: Decodable, Identifiable {
    let id: UUID
    let username: String?
    let full_name: String?
}

/// One get_user_contribution_days row: (day, kind, n).
struct ContributionRow: Decodable {
    let day: String          // "yyyy-MM-dd"
    let kind: String         // photo | event | work
    let n: Int
}

/// One get_user_contribution_calendar element — already pivoted per day. The
/// calendar RPC returns a single jsonb array (one object per day), which is
/// NOT subject to PostgREST's db-max-rows 1000-row cap that truncates the
/// (day,kind) SETOF for heavy users. This is the full-history path.
struct CalendarDay: Decodable {
    let day: String          // "yyyy-MM-dd"
    let photos: Int
    let events: Int
    let work: Int
}

/// Day rows after grouping (one per calendar day, newest first).
struct DayRecord: Identifiable {
    let day: String
    var photos = 0
    var events = 0
    var work = 0
    var id: String { day }
}

/// get_user_sync_status(p_user_id) → jsonb scalar (PostgREST array-wraps it,
/// so we decode [SyncStatus] and take .first — same pattern as DayReceipt).
/// Owner-only: proves this phone's link to the record. Every field optional
/// where the contract is nullable; counts default to 0 so a partial row still
/// renders. PROVENANCE: these are server-side totals (the record's truth),
/// reconciled against SyncEngine's device-side totals in the SYNC section.
struct SyncStatus: Decodable {
    let is_owner_view: Bool?
    let synced_total: Int
    let analyzed_total: Int
    let pending_total: Int
    let filed_total: Int
    let all_sources_total: Int
    let last_synced_at: String?
    let last_taken_at: String?
}

/// get_user_day_receipt(p_user_id, p_date) → jsonb.
struct DayReceipt: Decodable {
    struct Photo: Decodable, Identifiable {
        let id: UUID
        let thumb: String?
        let url: String?
        let taken_at: String?
        // Analysis atoms — all optional. Present once the image is *understood*
        // (byok/T0 vision verdict in vehicle_observations); absent until then.
        // The evidence rail renders only what exists — never an empty shell.
        let vehicle_id: UUID?
        let file_name: String?
        let narrative: String?          // one line: what the frame shows
        let components: [String]?       // detected parts (labels)
        let part_numbers: [String]?     // verbatim text / part numbers read
        let intent: String?             // labor | inspection | parts_sourcing | …
        let intent_confidence: Double?
        let intent_confirmed: Bool?     // owner-confirmed? (the $410 guard)
        let analyzed_by: String?        // provenance: model/tier
        let analyzed_at: String?
    }
    struct WorkSession: Decodable, Identifiable {
        let id: UUID
        let title: String?
        let duration_minutes: Int?
        let total_job_cost: Double?
    }
    struct Receipt: Decodable, Identifiable {
        let id: UUID
        let vendor: String?
        let total: Double?
    }
    let date: String
    let photos: [Photo]
    let work_sessions: [WorkSession]
    let receipts: [Receipt]
}

// ─── Tab root: own profile (or the sample) + handle search ──────────────────

struct ProfileTab: View {
    /// Signed-in user id, or nil (explore mode → the sample profile).
    let ownUserId: String?
    /// Explore mode: the door back to sign-in (toolbar). nil when signed in.
    var onSignIn: (() -> Void)? = nil
    @State private var query = ""
    @State private var results: [ProfileRow] = []
    @State private var showAccount = false

    private var rootUserId: String {
        ownUserId ?? Config.sampleProfileUserId
    }

    var body: some View {
        NavigationStack {
            Group {
                if query.trimmingCharacters(in: .whitespaces).isEmpty {
                    ProfileView(userId: rootUserId, isOwn: ownUserId != nil)
                } else {
                    List(results) { row in
                        NavigationLink {
                            ProfileView(userId: row.id.uuidString.lowercased(), isOwn: false)
                        } label: {
                            VStack(alignment: .leading) {
                                Text(row.username ?? row.id.uuidString.prefix(8).lowercased())
                                if let name = row.full_name {
                                    Text(name)
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let onSignIn {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Sign In", action: onSignIn)
                    }
                } else if ownUserId != nil {
                    // Own profile → the account sheet (sign out, deletion,
                    // site naming, photo grant state).
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            showAccount = true
                        } label: {
                            Image(systemName: "person.circle")
                        }
                        .accessibilityLabel("Account")
                    }
                }
            }
            .sheet(isPresented: $showAccount) {
                AccountView()
            }
            .searchable(text: $query, prompt: "Handle")
            .task(id: query) {
                let term = query.trimmingCharacters(in: .whitespaces)
                guard !term.isEmpty else { results = []; return }
                try? await Task.sleep(nanoseconds: 300_000_000)   // debounce
                guard !Task.isCancelled else { return }
                await search(term)
            }
        }
    }

    private func search(_ term: String) async {
        do {
            results = try await SupabaseService.client
                .from("profiles")
                .select("id,username,full_name")
                .ilike("username", pattern: "%\(term)%")
                .limit(25)
                .execute()
                .value
        } catch {
            NSLog("NukeCapture profile search failed: %@", String(describing: error))
        }
    }
}

// ─── The profile: name/handle · connections (own) · the day record ──────────

struct ProfileView: View {
    let userId: String
    var isOwn: Bool = false

    @State private var profile: ProfileRow?
    @State private var days: [DayRecord] = []
    @State private var receiptDay: DayRecord?
    @State private var loadError: String?

    // Owner-only: the phone↔record link, made visible. `sync` is the record's
    // server-side truth (the RPC); `engine` is this device's local truth.
    // Showing both side by side kills the "is it even linked?" doubt — they
    // reconcile in plain sight.
    @State private var sync: SyncStatus?
    @ObservedObject private var engine = SyncEngine.shared

    var body: some View {
        List {
            Section {
                LabeledContent("Name") {
                    Text(profile?.full_name ?? "—")
                }
                LabeledContent("Handle") {
                    Text(profile?.username ?? "—")
                }
            }

            // SYNC — owner-only ledger that proves the phone↔record link.
            if isOwn { syncSection }

            if let loadError {
                Section {
                    Text(loadError)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }

            // Barcode timeline — full-span contribution instrument.
            if !days.isEmpty {
                Section {
                    BarcodeTimeline(days: days) { day in
                        receiptDay = day
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }
            }

            if !days.isEmpty {
                Section {
                    ForEach(days) { day in
                        Button {
                            receiptDay = day
                        } label: {
                            HStack {
                                // Color.primary (concrete), not .primary —
                                // inside a Button label the hierarchical
                                // .primary resolves to the tint color.
                                Text(day.day)
                                    .monospacedDigit()
                                    .foregroundStyle(Color.primary)
                                Spacer()
                                if day.photos > 0 {
                                    Text("\(day.photos) photos")
                                        .monospacedDigit()
                                        .foregroundStyle(Color.secondary)
                                }
                                if day.work > 0 {
                                    Text("\(day.work) work")
                                        .monospacedDigit()
                                        .foregroundStyle(Color.secondary)
                                }
                            }
                        }
                    }
                } header: {
                    Text("\(days.count) days")
                }
            }
        }
        .sheet(item: $receiptDay) { day in
            DayReceiptView(userId: userId, date: day.day)
                .presentationDetents([.medium, .large])
        }
        .task(id: userId) { await load() }
        .task(id: userId) { await loadSync() }   // owner-only inside loadSync
    }

    // ─── SYNC section: the link, in a traditional ledger ─────────────────────
    // Header line names the linked account; rows are the record's totals
    // (monospaced, source-labeled). The analyzed row drills into the actual
    // understood frames. A final "this device" line folds in SyncEngine's
    // local counts so phone and record reconcile on screen. Zeros are skipped
    // (PROVENANCE: never a lone "—" row for absent data).
    @ViewBuilder private var syncSection: some View {
        Section {
            // Identity confirmation — this handle IS the linked account.
            if let who = profile?.username ?? profile?.full_name {
                LabeledContent("Linked account") {
                    Text(who).foregroundStyle(.secondary)
                }
            }

            if let sync {
                LabeledContent("Synced") {
                    Text("\(sync.synced_total)").monospacedDigit()
                }

                // ANALYZED → drill into the understood photos (only when any).
                if sync.analyzed_total > 0 {
                    NavigationLink {
                        AnalyzedPhotosView(userId: userId)
                    } label: {
                        LabeledContent("Analyzed") {
                            Text("\(sync.analyzed_total)").monospacedDigit()
                        }
                    }
                } else {
                    LabeledContent("Analyzed") {
                        Text("\(sync.analyzed_total)").monospacedDigit()
                    }
                }

                if sync.pending_total > 0 {
                    LabeledContent("Pending") {
                        Text("\(sync.pending_total)")
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                }
                if sync.filed_total > 0 {
                    LabeledContent("Filed") {
                        Text("\(sync.filed_total)").monospacedDigit()
                    }
                }
                if let last = sync.last_synced_at {
                    LabeledContent("Last sync") {
                        Text(relativeOrPrefix(last))
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                }
            }

            // This device's own truth — reconciles the phone against the
            // record. Honest present values only (skip when nothing to show).
            if SupabaseService.currentUserId != nil,
               let line = deviceLine {
                LabeledContent("This device") {
                    Text(line)
                        .font(.footnote)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            }
        } header: {
            Text("Sync")
        }
    }

    /// "N uploaded · M queued" from SyncEngine — drops either half when zero,
    /// returns nil when both are zero (nothing honest to show).
    private var deviceLine: String? {
        var parts: [String] = []
        if engine.totalSynced > 0 { parts.append("\(engine.totalSynced) uploaded") }
        if engine.backfillRemaining > 0 { parts.append("\(engine.backfillRemaining) queued") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// Parse the ISO last-sync stamp to a relative string; fall back to the
    /// raw prefix(16) ("2026-06-14T03:12") if it doesn't parse.
    private func relativeOrPrefix(_ raw: String) -> String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = iso.date(from: raw)
            ?? { let p = ISO8601DateFormatter(); return p.date(from: raw) }()
        if let date {
            return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
        }
        return String(raw.prefix(16))
    }

    /// Owner-only: load the server-side sync ledger. get_user_sync_status
    /// returns a JSONB scalar — PostgREST array-wraps it, so decode
    /// [SyncStatus] and take .first (same pattern as get_user_day_receipt).
    private func loadSync() async {
        guard isOwn else { return }
        do {
            let rows: [SyncStatus] = try await SupabaseService.client
                .rpc("get_user_sync_status", params: ["p_user_id": userId])
                .execute()
                .value
            sync = rows.first
        } catch {
            NSLog("NukeCapture sync status failed: %@", String(describing: error))
        }
    }

    private func load() async {
        do {
            let rows: [ProfileRow] = try await SupabaseService.client
                .from("profiles")
                .select("id,username,full_name")
                .eq("id", value: userId)
                .limit(1)
                .execute()
                .value
            profile = rows.first

            // Full-history path FIRST: get_user_contribution_calendar returns a
            // single jsonb array (one row per day), bypassing the db-max-rows
            // 1000-row cap that truncated the (day,kind) SETOF — for Skylar that
            // cap dropped ~980 real work-days and started the barcode at an
            // arbitrary 2024 wall. Decode the scalar via [[CalendarDay]].first
            // (PostgREST array-wraps a scalar function result). If the RPC isn't
            // deployed yet (404), fall back to the capped (day,kind) RPC so the
            // timeline still renders a working organ (C4) — it auto-upgrades to
            // full history once the migration lands.
            if let calendar = try? await loadCalendar(), !calendar.isEmpty {
                days = calendar
            } else {
                days = try await loadContributionDays()
            }
            loadError = nil
        } catch {
            loadError = "Load failed"
            NSLog("NukeCapture profile load failed: %@", String(describing: error))
        }
    }

    /// Full-history calendar: one jsonb array, uncapped. Throws if the RPC is
    /// missing (404) so the caller can fall back to the capped SETOF.
    private func loadCalendar() async throws -> [DayRecord] {
        // get_user_contribution_calendar → jsonb scalar; PostgREST array-wraps
        // it, so decode [[CalendarDay]] and take .first (same shape pattern as
        // get_user_day_receipt). An empty profile returns [] → no throw.
        let wrapped: [[CalendarDay]] = try await SupabaseService.client
            .rpc("get_user_contribution_calendar", params: ["p_user_id": userId])
            .execute()
            .value
        let cal = wrapped.first ?? []
        return cal
            .map { DayRecord(day: $0.day, photos: $0.photos, events: $0.events, work: $0.work) }
            .sorted { $0.day > $1.day }   // newest first (matches the day list)
    }

    /// Fallback: the capped (day,kind,n) SETOF. Truncated to 1000 rows for heavy
    /// users — kept only so the timeline is a working organ before the calendar
    /// RPC is deployed.
    private func loadContributionDays() async throws -> [DayRecord] {
        let contributions: [ContributionRow] = try await SupabaseService.client
            .rpc("get_user_contribution_days", params: ["p_user_id": userId])
            .execute()
            .value
        var byDay: [String: DayRecord] = [:]
        for row in contributions {
            var rec = byDay[row.day] ?? DayRecord(day: row.day)
            switch row.kind {
            case "photo": rec.photos += row.n
            case "work":  rec.work += row.n
            default:      rec.events += row.n
            }
            byDay[row.day] = rec
        }
        return byDay.values.sorted { $0.day > $1.day }
    }
}

// ─── Day receipt: what the day actually was ──────────────────────────────────

struct DayReceiptView: View {
    let userId: String
    let date: String

    @State private var receipt: DayReceipt?
    @State private var loadError: String?
    @State private var loaded = false       // prevents infinite ProgressView on empty result

    var body: some View {
        NavigationStack {
            List {
                if let receipt {
                    if !receipt.photos.isEmpty {
                        Section("\(receipt.photos.count) photos") {
                            RemoteThumbGrid(photos: receipt.photos)
                                .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                        }
                    }
                    if !receipt.work_sessions.isEmpty {
                        Section("Work") {
                            ForEach(receipt.work_sessions) { ws in
                                LabeledContent(ws.title ?? "work session") {
                                    HStack(spacing: 8) {
                                        if let minutes = ws.duration_minutes {
                                            Text(formatMinutes(minutes)).monospacedDigit()
                                        }
                                        if let cost = ws.total_job_cost, cost > 0 {
                                            Text(cost, format: .currency(code: "USD"))
                                                .monospacedDigit()
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if !receipt.receipts.isEmpty {
                        Section("Receipts") {
                            ForEach(receipt.receipts) { r in
                                LabeledContent(r.vendor ?? "—") {
                                    if let total = r.total {
                                        Text(total, format: .currency(code: "USD"))
                                            .monospacedDigit()
                                    }
                                }
                            }
                        }
                    }
                } else if let loadError {
                    Text(loadError)
                        .font(.footnote)
                        .foregroundStyle(.red)
                } else if loaded {
                    // Empty RPC result — loaded but no receipt rows
                    Text("No work logged this day.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle(date)
            .navigationBarTitleDisplayMode(.inline)
        }
        .task { await load() }
    }

    private func load() async {
        do {
            // get_user_day_receipt returns JSONB (scalar). PostgREST wraps scalar
            // function results in an array — decode [DayReceipt] and take .first.
            let rows: [DayReceipt] = try await SupabaseService.client
                .rpc("get_user_day_receipt",
                     params: ["p_user_id": userId, "p_date": date])
                .execute()
                .value
            receipt = rows.first
        } catch {
            loadError = "Load failed"
            NSLog("NukeCapture day receipt failed: %@", String(describing: error))
        }
        loaded = true    // flip regardless of result — stops the infinite spinner
    }
}

/// Square remote-thumbnail grid (AsyncImage). Tap any cell to open a
/// full-screen viewer with a caption bar showing taken_at.
private struct RemoteThumbGrid: View {
    let photos: [DayReceipt.Photo]
    var columns: Int = 4

    @State private var selected: DayReceipt.Photo?

    var body: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: columns),
            spacing: 2
        ) {
            ForEach(photos.prefix(20)) { photo in
                let url = photo.thumb ?? photo.url
                Color(.secondarySystemFill)
                    .aspectRatio(1, contentMode: .fit)
                    .overlay {
                        AsyncImage(url: url.flatMap(URL.init)) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            Color(.secondarySystemFill)
                        }
                    }
                    .clipped()
                    .onTapGesture { selected = photo }
            }
        }
        .fullScreenCover(item: $selected) { photo in
            PhotoFullScreenView(photo: photo)
        }
    }
}

/// "2H 30M" / "45M" — matches the web day-receipt's formatMinutes.
private func formatMinutes(_ m: Int) -> String {
    let h = m / 60, mm = m % 60
    if h > 0 && mm > 0 { return "\(h)H \(mm)M" }
    if h > 0 { return "\(h)H" }
    return "\(mm)M"
}

/// Full-bleed photo viewer — black background, tap or drag-down to dismiss.
/// Evidence rail surfaces the saved analysis atoms (narrative · components ·
/// part numbers · provenance) and the intent-confirm loop (the $410 guard).
/// Renders only the atoms that exist; "Analysis pending" only when none do.
private struct PhotoFullScreenView: View {
    let photo: DayReceipt.Photo
    @Environment(\.dismiss) private var dismiss
    @State private var confirmedIntent: String?     // optimistic local confirm
    @State private var showConfirm = false
    @State private var showVehicle = false          // drill to the vehicle detail

    private static let intents = ["labor", "inspection", "parts_sourcing",
                                  "communication", "acquisition", "documentation"]

    private var hasAtoms: Bool {
        photo.narrative != nil
            || !(photo.components ?? []).isEmpty
            || !(photo.part_numbers ?? []).isEmpty
            || photo.intent != nil
    }

    private var confirmedValue: String? {
        confirmedIntent ?? (photo.intent_confirmed == true ? photo.intent : nil)
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.ignoresSafeArea()
            AsyncImage(url: (photo.url ?? photo.thumb).flatMap(URL.init)) { image in
                image
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } placeholder: {
                ProgressView().tint(.white)
            }

            rail
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.black.opacity(0.82))
        }
        .onTapGesture { dismiss() }
        .gesture(DragGesture(minimumDistance: 40)
            .onEnded { v in if v.translation.height > 0 { dismiss() } })
    }

    @ViewBuilder private var rail: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let takenAt = photo.taken_at {
                Text(takenAt)
                    .font(.caption2).monospacedDigit()
                    .foregroundStyle(.white.opacity(0.55))
            }

            if hasAtoms {
                if let narrative = photo.narrative {
                    Text(narrative)
                        .font(.callout)
                        .foregroundStyle(.white)
                }
                if let comps = photo.components, !comps.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(comps, id: \.self) { c in
                                Text(c)
                                    .font(.caption2)
                                    .padding(.horizontal, 8).padding(.vertical, 3)
                                    .overlay(Capsule().stroke(.white.opacity(0.3)))
                                    .foregroundStyle(.white.opacity(0.85))
                            }
                        }
                    }
                }
                if let parts = photo.part_numbers {
                    ForEach(parts, id: \.self) { p in
                        Label(p, systemImage: "tag")
                            .font(.caption).monospacedDigit()
                            .foregroundStyle(.white.opacity(0.85))
                    }
                }
                intentRow
                if let by = photo.analyzed_by {
                    Label("\(by)\(photo.analyzed_at.map { " · \($0.prefix(10))" } ?? "")",
                          systemImage: "checkmark.seal")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.4))
                }
            } else {
                Text("Analysis pending")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.4))
            }

            // Drill to the vehicle — only when this frame is filed to one.
            vehicleRow
        }
        .sheet(isPresented: $showVehicle) {
            if let vid = photo.vehicle_id {
                VehicleDetailView(vehicleId: vid.uuidString.lowercased())
            }
        }
    }

    @ViewBuilder private var vehicleRow: some View {
        if let vid = photo.vehicle_id {
            Button {
                showVehicle = true
            } label: {
                Label("View vehicle", systemImage: "car.side")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.85))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("view-vehicle-\(vid.uuidString.lowercased())")
        }
    }

    @ViewBuilder private var intentRow: some View {
        if let confirmed = confirmedValue {
            Label("\(confirmed.capitalized) · confirmed", systemImage: "checkmark.circle.fill")
                .font(.caption).foregroundStyle(.green)
        } else if let intent = photo.intent {
            // The model guessed; only the owner confirms value (the $410 guard).
            HStack(spacing: 8) {
                Text("\(intent.capitalized)?")
                    .font(.caption).foregroundStyle(.yellow)
                if let conf = photo.intent_confidence {
                    Text(String(format: "%.2f", conf))
                        .font(.caption2).monospacedDigit()
                        .foregroundStyle(.yellow.opacity(0.7))
                }
                Spacer(minLength: 0)
                Button("Why was this taken?") { showConfirm = true }
                    .font(.caption).buttonStyle(.bordered).tint(.yellow)
            }
            .confirmationDialog("Why was this taken?",
                                isPresented: $showConfirm, titleVisibility: .visible) {
                ForEach(Self.intents, id: \.self) { opt in
                    Button(opt.replacingOccurrences(of: "_", with: " ").capitalized) {
                        confirm(opt)
                    }
                }
            }
        }
    }

    private func confirm(_ intent: String) {
        confirmedIntent = intent       // optimistic — rail flips to confirmed
        Task {
            do {
                _ = try await SupabaseService.client
                    .rpc("confirm_photo_intent",
                         params: ["p_image_id": photo.id.uuidString, "p_intent": intent])
                    .execute()
            } catch {
                NSLog("NukeCapture confirm intent failed: %@", String(describing: error))
            }
        }
    }
}
