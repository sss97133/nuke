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
    let avatar_url: String?
    let bio: String?
    let location: String?
    let city: String?
    let role: String?
}

/// get_user_producer_signals → the profile's live + lifetime PROOF-OF-WORK read.
/// A signal is a function over the user's atomic data (a live feed), not a vanity
/// count. We never surface confirmed-$ (all sessions unconfirmed → would lie).
struct ProducerSignals: Decodable {
    let last_worked: String?
    let worked_today: Bool?
    let work_days_total: Int?
    let work_days_year: Int?
    let hours_total: Int?
    let hours_year: Int?
    let current_streak: Int?
    let longest_streak: Int?
    let images_total: Int?
    let images_analyzed: Int?
    let images_today: Int?
    let active_today: Bool?
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
    let work: Int            // confirmed work SESSIONS that day
    let work_minutes: Int    // confirmed labor minutes — the real value signal
    let work_cost: Int       // job dollars on confirmed work
}

/// Day rows after grouping (one per calendar day, newest first). Carries the
/// day-VALUE signals (labor minutes + job cost) so the timeline heats by real
/// work, not photo count — a selfie day and a welding day must not read alike.
struct DayRecord: Identifiable {
    let day: String
    var photos = 0
    var events = 0
    var work = 0
    var workMinutes = 0
    var workCost = 0
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
        let intent: String?             // labor | inspection | parts_sourcing | … (agent's read)
        let intent_confidence: Double?
        let intent_confirmed: Bool?     // owner-confirmed? (the $410 guard)
        let owner_note: String?         // owner's OWN words about this frame (primary testimony)
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
    @State private var searchError = false   // a failed handle search ≠ "no such user"
    @State private var showAccount = false

    private var rootUserId: String {
        ownUserId ?? Config.sampleProfileUserId
    }

    var body: some View {
        NavigationStack {
            Group {
                if query.trimmingCharacters(in: .whitespaces).isEmpty {
                    ProfileView(userId: rootUserId, isOwn: ownUserId != nil)
                } else if searchError && results.isEmpty {
                    // The search request failed — never read as "no such handle".
                    ContentUnavailableView {
                        Label("Couldn't search", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text("Check your connection.")
                    } actions: {
                        Button("Retry") {
                            Task { await search(query.trimmingCharacters(in: .whitespaces)) }
                        }
                        .buttonStyle(.borderedProminent)
                    }
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
        searchError = false
        do {
            results = try await SupabaseService.client
                .from("profiles")
                .select("id,username,full_name")
                .ilike("username", pattern: "%\(term)%")
                .limit(25)
                .execute()
                .value
        } catch {
            searchError = true
            NSLog("NukeCapture profile search failed: %@", String(describing: error))
        }
    }
}

// ─── The profile: name/handle · connections (own) · the day record ──────────

/// One row from get_user_garage — the user's vehicle, enough to render a card
/// and open VehicleDetailView.
struct GarageVehicle: Decodable, Identifiable, Hashable {
    let vehicle_id: String
    let year: Int?
    let make: String?
    let model: String?
    let trim_name: String?
    let image_url: String?
    let current_value: Double?
    let image_count: Int
    let relationship: String

    var id: String { vehicle_id }
    var title: String {
        [year.map(String.init), make, model].compactMap { $0 }.joined(separator: " ")
    }
}

struct ProfileView: View {
    let userId: String
    var isOwn: Bool = false

    @State private var profile: ProfileRow?
    @State private var profileSettled = false     // true once load() has succeeded OR failed
    @State private var days: [DayRecord] = []
    @State private var receiptDay: DayRecord?
    @State private var loadError: String?
    // The garage — the user's real vehicles (get_user_garage). The app had no
    // way in to a vehicle before this; each card opens VehicleDetailView.
    @State private var garage: [GarageVehicle] = []
    @State private var garageLoaded = false      // gate the empty state so it never flashes
    @State private var garageError = false        // a FAILED load must never read as "no vehicles"
    @State private var openVehicle: GarageVehicle?

    // Owner-only: the phone↔record link, made visible. `sync` is the record's
    // server-side truth (the RPC); `engine` is this device's local truth.
    // Showing both side by side kills the "is it even linked?" doubt — they
    // reconcile in plain sight.
    @State private var sync: SyncStatus?
    @State private var syncError = false          // failed link-ledger load ≠ a fresh account
    @ObservedObject private var engine = SyncEngine.shared

    // Recent meaningful work — the few latest UNDERSTOOD days, each a STORY (not a
    // bare photo count). Replaces the old exhaustive 1,740-row day ledger: the
    // barcode above is already the full-history navigator; this surfaces real work.
    // Source: get_user_understanding.latest (same read as Today's "Latest understood").
    @State private var latest: [UserUnderstanding.Day] = []
    @State private var latestError = false
    // Producer signals — the proof-of-work read that replaces vanity counts.
    @State private var producer: ProducerSignals?

    var body: some View {
        List {
            // IDENTITY — a builder's profile, not a settings form. Face, name,
            // handle, where they are, and their numbers. This is the showcase head.
            Section { identityHeader }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))

            // BARCODE — the proof-of-work graph, directly under the identity (the
            // labor story IS the headline; it belongs with the producer signals,
            // not buried below sync).
            if !days.isEmpty {
                Section {
                    BarcodeTimeline(days: days) { day in receiptDay = day }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
            }

            // GARAGE — the user's vehicles, the way into the whole drill chain.
            // Empty + own profile → a LIVING state that says what's coming, not a
            // hidden section that reads as a dead profile (the cold-start gravestone).
            if !garage.isEmpty {
                garageSection
            } else if garageError {
                // A failed load is NOT an empty garage — say so, with a way back.
                // (This is the 29.5s-timeout incident: the owner's full garage
                // had read as "No vehicles yet".)
                garageErrorSection
            } else if isOwn && garageLoaded {
                emptyGarageSection
            }

            // SYNC — owner-only ledger that proves the phone↔record link.
            if isOwn { syncSection }

            if let loadError {
                Section {
                    HStack {
                        Text(loadError)
                            .font(.footnote)
                            .foregroundStyle(.red)
                        Spacer()
                        Button("Retry") { Task { await load() } }
                            .font(.footnote)
                    }
                }
            }

            // LATEST WORK — the most recent UNDERSTOOD days as STORIES, capped.
            // NOT the old 1,740-row photo-count ledger (a count is not the work;
            // the barcode is the full navigator). Each row → its day receipt.
            if !latest.isEmpty {
                Section("Latest work") {
                    ForEach(latest.prefix(6)) { day in
                        Button { receiptDay = DayRecord(day: day.date) } label: {
                            latestRow(day)
                        }
                    }
                }
            } else if latestError {
                Section("Latest work") {
                    HStack {
                        Label("Couldn't load", systemImage: "wifi.exclamationmark")
                            .font(.footnote).foregroundStyle(.secondary)
                        Spacer()
                        Button("Retry") { Task { await loadLatest() } }
                            .font(.footnote)
                    }
                }
            }
        }
        .sheet(item: $receiptDay) { day in
            DayReceiptView(userId: userId, date: day.day)
                .presentationDetents([.medium, .large])
        }
        // (openVehicle sheet moved onto garageSection — avoids two .sheet on one view)
        .task(id: userId) { await load() }
        .task(id: userId) { await loadSync() }   // owner-only inside loadSync
        .task(id: userId) { await loadGarage() }
        .task(id: userId) { await loadLatest() }
        .task(id: userId) { await loadProducer() }
    }

    // ─── Latest work — recent understood days as stories (get_user_understanding) ─
    /// One story row: the detective's read of the day leads; a day not yet narrated
    /// falls back to its vehicle + classification. Footer = vehicle · frames · date.
    /// Mirrors Today's "Latest understood" row (develop from what exists).
    @ViewBuilder private func latestRow(_ d: UserUnderstanding.Day) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let story = d.story, !story.isEmpty {
                Text(story)
                    .font(.footnote)
                    .foregroundStyle(Color.primary)
                    .lineLimit(3)
            } else {
                Text(d.vehicleTitle)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color.primary)
                    .lineLimit(1)
                if let title = d.title, !title.isEmpty {
                    Text(title)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            HStack(spacing: 6) {
                Text(d.vehicleTitle).lineLimit(1)
                Text("·")
                Text("\(d.frames ?? 0) frames")
                Text("·")
                Text(d.date)
                Spacer(minLength: 0)
            }
            .font(.caption2).monospacedDigit()
            .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 3)
    }

    /// get_user_understanding RETURNS a bare jsonb OBJECT (not array-wrapped) —
    /// decode it directly (same as Today's fetch). `.latest` is already a curated
    /// recent set; we cap at 6 in the view.
    private func loadLatest() async {
        latestError = false
        do {
            let u: UserUnderstanding = try await SupabaseService.client
                .rpc("get_user_understanding", params: ["p_user_id": userId])
                .execute()
                .value
            latest = u.latest
        } catch {
            latestError = true
            NSLog("NukeCapture profile latest work failed: %@", String(describing: error))
        }
    }

    /// The proof-of-work signals for the header (get_user_producer_signals, one call).
    private func loadProducer() async {
        do {
            producer = try await SupabaseService.client
                .rpc("get_user_producer_signals", params: ["p_user_id": userId])
                .execute()
                .value
        } catch {
            NSLog("NukeCapture producer signals failed: %@", String(describing: error))
        }
    }

    // ─── Identity header — the builder, front and center ─────────────────────
    @ViewBuilder private var identityHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                // Face. avatar_url when present; a clean monogram-less placeholder
                // otherwise — never a broken image.
                CachedAsyncImage(url: NukeImage.thumb(profile?.avatar_url, width: 200)) { img in
                    img.resizable().scaledToFill()
                } placeholder: {
                    Image(systemName: "person.crop.circle.fill")
                        .resizable().scaledToFit()
                        .foregroundStyle(.tertiary)
                }
                .frame(width: 68, height: 68)
                .clipShape(Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text(profile?.full_name ?? (profileSettled ? "Unnamed builder" : "…"))
                        .font(.title2.weight(.bold))
                        .foregroundStyle(Color.primary)
                        .lineLimit(1)
                    if let h = profile?.username, !h.isEmpty {
                        Text("@\(h)").font(.subheadline).foregroundStyle(.secondary)
                    }
                    if let place = [profile?.city, profile?.location].compactMap({ $0 })
                        .first(where: { !$0.isEmpty }) {
                        Label(place, systemImage: "mappin.and.ellipse")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }

            if let bio = profile?.bio, !bio.isEmpty {
                Text(bio).font(.callout).foregroundStyle(Color.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // LIVE STATE — is this node producing NOW? The first "worth-connecting-to"
            // read. Capture-or-work based (uploading today counts), honest when idle.
            if let p = producer {
                HStack(spacing: 6) {
                    Circle()
                        .fill(p.active_today == true ? Color.green : Color.secondary)
                        .frame(width: 7, height: 7)
                    Text(activityLine(p))
                        .font(.caption).foregroundStyle(.secondary)
                }
            }

            // PRODUCER SIGNALS — functions over the work record, not vanity counts.
            // ("8 vehicles" was a dead count; this is "did they do the work".)
            if let p = producer {
                HStack(spacing: 22) {
                    if let hy = p.hours_year, hy > 0 { stat("\(hy)h", "this year") }
                    if let wy = p.work_days_year, wy > 0 { stat("\(wy)", "work-days") }
                    if let ls = p.longest_streak, ls > 0 { stat("\(ls)", "best streak") }
                    if let an = p.images_analyzed, an > 0 { stat(an.formatted(), "analyzed") }
                }
            }
        }
    }

    /// "Active today · 220 photos" when producing now; "Last worked 24 days ago"
    /// when idle — honest either way, never a fake streak.
    private func activityLine(_ p: ProducerSignals) -> String {
        if p.worked_today == true { return "Worked today" }
        if p.active_today == true {
            let n = p.images_today ?? 0
            return n > 0 ? "Active today · \(n) photos" : "Active today"
        }
        if let last = p.last_worked {
            return "Last worked \(last)"
        }
        return "No work logged yet"
    }

    @ViewBuilder private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value).font(.headline).monospacedDigit().foregroundStyle(Color.primary)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }

    // ─── Garage ──────────────────────────────────────────────────────────────
    private var garageSection: some View {
        Section {
            ForEach(garage) { v in
                Button { openVehicle = v } label: {
                    HStack(spacing: 12) {
                        CachedAsyncImage(url: NukeImage.thumb(v.image_url, width: 170)) { img in
                            img.resizable().scaledToFill()
                        } placeholder: {
                            Image(systemName: "car.side").foregroundStyle(.secondary)
                        }
                        .frame(width: 56, height: 42)
                        .clipped()
                        VStack(alignment: .leading, spacing: 2) {
                            Text(v.title).foregroundStyle(Color.primary)
                            HStack(spacing: 8) {
                                Text("\(v.image_count) photos")
                                    .font(.caption2).monospacedDigit()
                                    .foregroundStyle(.secondary)
                                if v.relationship != "owner" {
                                    Text(v.relationship.replacingOccurrences(of: "_", with: " "))
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                            }
                        }
                        Spacer()
                        if let val = v.current_value, val > 0 {
                            // It's a modeled comp-estimate (rooted in nuke_estimates),
                            // not a fact — label it so it never reads as a firm price.
                            Text("est \(val.formatted(.currency(code: "USD").precision(.fractionLength(0))))")
                                .font(.caption).monospacedDigit().foregroundStyle(.secondary)
                        }
                        Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                    }
                }
            }
        } header: {
            Text("Garage · \(garage.count)")
        }
        // Vehicle sheet lives HERE (on the garage section), NOT stacked as a second
        // .sheet on the same List as the day-receipt sheet — two .sheet(item:) on one
        // view is the SwiftUI pitfall where the second silently fails to present.
        .sheet(item: $openVehicle) { v in
            VehicleDetailView(vehicleId: v.vehicle_id, embedInNavigationStack: true)
        }
    }

    private func loadGarage() async {
        garageError = false
        do {
            let rows: [GarageVehicle] = try await SupabaseService.client
                .rpc("get_user_garage", params: ["p_user_id": userId])
                .execute()
                .value
            garage = rows
        } catch {
            // Don't swallow: a failed load must surface as "couldn't load", never
            // fall through to the empty state.
            garageError = true
            NSLog("NukeCapture garage load failed: %@", String(describing: error))
        }
        garageLoaded = true
    }

    // ─── Garage failed to load — distinct from "no vehicles yet". ─────────────
    private var garageErrorSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Label("Couldn't load the garage", systemImage: "wifi.exclamationmark")
                    .font(.subheadline)
                    .foregroundStyle(Color.primary)
                Text("Your vehicles are on the record — the connection dropped.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Retry") { Task { await loadGarage() } }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
            .padding(.vertical, 2)
        } header: {
            Text("Garage")
        }
    }

    // ─── Empty garage — the living "what's coming" state (cold-start) ─────────
    // A new user has no vehicles yet. Don't hide the section (dead profile) — say
    // plainly how cars arrive: photos at a confirmed site develop into them.
    private var emptyGarageSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 4) {
                Text("No vehicles yet")
                    .foregroundStyle(Color.primary)
                Text("Photos you take at a confirmed site develop into your vehicles — they'll appear here as they're recognized.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 2)
        } header: {
            Text("Garage")
        }
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
            } else if syncError {
                // The ledger load failed — never let that read as a zeroed,
                // never-synced account. Say it plainly, offer a way back.
                LabeledContent("Status") {
                    Button("Retry") { Task { await loadSync() } }
                }
                Text("Couldn't load the sync ledger — check your connection.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
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
        syncError = false
        do {
            let rows: [SyncStatus] = try await SupabaseService.client
                .rpc("get_user_sync_status", params: ["p_user_id": userId])
                .execute()
                .value
            sync = rows.first
        } catch {
            syncError = true
            NSLog("NukeCapture sync status failed: %@", String(describing: error))
        }
    }

    private func load() async {
        do {
            let rows: [ProfileRow] = try await SupabaseService.client
                .from("profiles")
                .select("id,username,full_name,avatar_url,bio,location,city,role")
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
        profileSettled = true
    }

    /// Full-history calendar: one jsonb array, uncapped. Throws if the RPC is
    /// missing (404) so the caller can fall back to the capped SETOF.
    private func loadCalendar() async throws -> [DayRecord] {
        // get_user_contribution_calendar → jsonb scalar; PostgREST array-wraps
        // it, so decode [[CalendarDay]] and take .first (same shape pattern as
        // get_user_day_receipt). An empty profile returns [] → no throw.
        // RETURNS jsonb array → PostgREST sends it BARE (verified against prod:
        // top-level list of day objects, NOT array-wrapped). Decode [CalendarDay]
        // directly — the old [[CalendarDay]].first assumption threw and silently
        // pinned every heavy user to the 1000-row-capped fallback.
        let cal: [CalendarDay] = try await SupabaseService.client
            .rpc("get_user_contribution_calendar", params: ["p_user_id": userId])
            .execute()
            .value
        return cal
            .map { DayRecord(day: $0.day, photos: $0.photos, events: $0.events,
                             work: $0.work, workMinutes: $0.work_minutes, workCost: $0.work_cost) }
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
                } else if loadError != nil {
                    // Failed ≠ empty — offer a way back, never a dead red string.
                    ContentUnavailableView {
                        Label("Couldn't load the day", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text("Check your connection.")
                    } actions: {
                        Button("Retry") { Task { loaded = false; loadError = nil; await load() } }
                            .buttonStyle(.borderedProminent)
                    }
                } else if loaded {
                    // Empty RPC result — loaded but no receipt rows
                    Text("No work logged this day.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    // Worklight: a labeled stage, never a bare spinner.
                    VStack(spacing: 8) {
                        ProgressView()
                        Text("Loading \(date)…")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle(date)
            .navigationBarTitleDisplayMode(.inline)
        }
        .task { await load() }
    }

    private func load() async {
        do {
            // get_user_day_receipt RETURNS jsonb (scalar). PostgREST returns it as a
            // BARE OBJECT ({...}), not array-wrapped (proven over the wire for the
            // sibling get_user_understanding) — the old [DayReceipt].first decode
            // silently failed. Decode the raw bytes tolerantly: object first, then
            // array-wrapped, so neither shape can ever silently break the receipt.
            let raw = try await SupabaseService.client
                .rpc("get_user_day_receipt",
                     params: ["p_user_id": userId, "p_date": date])
                .execute()
                .data
            let dec = JSONDecoder()
            if let one = try? dec.decode(DayReceipt.self, from: raw) {
                receipt = one
            } else {
                receipt = try dec.decode([DayReceipt].self, from: raw).first
            }
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
                Color(.secondarySystemFill)
                    .aspectRatio(1, contentMode: .fit)
                    .overlay {
                        // Never a raw full-res original into a small grid cell —
                        // route the thumb (or the url fallback) through the render
                        // endpoint at a cell-sized width.
                        CachedAsyncImage(url: NukeImage.thumb(photo.thumb ?? photo.url, width: 200)) { image in
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
    @FocusState private var composerFocused: Bool
    @State private var confirmedIntent: String?     // legacy: photos confirmed via the old menu
    // Owner free-text context composer — replaces the fixed-taxonomy intent menu.
    // The owner writes in their own words; the in-house agent distills the category.
    @State private var composing = false
    @State private var draft = ""
    @State private var submitting = false
    @State private var localNote: String?           // optimistic note until the day reloads
    @State private var noteError = false
    @State private var showVehicle = false          // drill to the vehicle detail
    // Pinch-zoom + pan on the image. Tap-to-dismiss is gone (it fought
    // interaction); a close button + drag-down (when not zoomed) dismiss.
    @State private var zoom: CGFloat = 1
    @State private var lastZoom: CGFloat = 1
    @State private var pan: CGSize = .zero
    @State private var lastPan: CGSize = .zero

    private var hasAtoms: Bool {
        photo.narrative != nil
            || !(photo.components ?? []).isEmpty
            || !(photo.part_numbers ?? []).isEmpty
            || photo.intent != nil
    }

    private var confirmedValue: String? {
        confirmedIntent ?? (photo.intent_confirmed == true ? photo.intent : nil)
    }

    /// The owner's own words about this frame — optimistic local note first, else
    /// whatever the day-receipt already carries. This is primary testimony.
    private var ownerNote: String? {
        if let n = localNote { return n }
        let server = photo.owner_note?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (server?.isEmpty == false) ? server : nil
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.ignoresSafeArea()
            AsyncImage(url: (photo.url ?? photo.thumb).flatMap(URL.init)) { image in
                image
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .scaleEffect(zoom)
                    .offset(pan)
                    .gesture(
                        MagnificationGesture()
                            .onChanged { zoom = max(1, lastZoom * $0) }
                            .onEnded { _ in
                                lastZoom = zoom
                                if zoom < 1.05 {
                                    withAnimation { zoom = 1; pan = .zero }
                                    lastZoom = 1; lastPan = .zero
                                }
                            }
                    )
                    .simultaneousGesture(
                        DragGesture()
                            .onChanged { v in
                                if zoom > 1 {
                                    pan = CGSize(width: lastPan.width + v.translation.width,
                                                 height: lastPan.height + v.translation.height)
                                }
                            }
                            .onEnded { v in
                                if zoom > 1 { lastPan = pan }
                                else if v.translation.height > 60 { dismiss() }
                            }
                    )
                    .onTapGesture(count: 2) {
                        withAnimation {
                            if zoom > 1 { zoom = 1; pan = .zero; lastPan = .zero; lastZoom = 1 }
                            else { zoom = 2.5; lastZoom = 2.5 }
                        }
                    }
            } placeholder: {
                ProgressView().tint(.white)
            }

            rail
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.black.opacity(0.82))
        }
        .overlay(alignment: .topTrailing) {
            Button { dismiss() } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.white.opacity(0.7), .black.opacity(0.4))
                    .padding(12)
            }
        }
    }

    @ViewBuilder private var rail: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let takenAt = photo.taken_at {
                Text(takenAt)
                    .font(.caption2).monospacedDigit()
                    .foregroundStyle(.white.opacity(0.55))
            }

            // Owner's voice — primary testimony, shown first and brightest. This is
            // the source of truth; everything below is the agent's read of it.
            if let note = ownerNote {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "quote.opening")
                        .font(.caption2).foregroundStyle(.white.opacity(0.35))
                    Text(note).font(.callout).foregroundStyle(.white)
                }
            }

            if hasAtoms {
                if let narrative = photo.narrative {
                    Text(narrative)
                        .font(ownerNote == nil ? .callout : .caption)
                        .foregroundStyle(ownerNote == nil ? .white : .white.opacity(0.6))
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
                intentHint
                if let by = photo.analyzed_by {
                    Label("\(by)\(photo.analyzed_at.map { " · \($0.prefix(10))" } ?? "")",
                          systemImage: "checkmark.seal")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.4))
                }
            } else if ownerNote == nil {
                Text("Analysis pending")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.4))
            }

            // The owner can always add context — even on an unanalyzed frame.
            contextRow

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

    /// The agent's read — a soft hypothesis the owner's words refine, NOT a verdict
    /// and NOT a menu. The owner authors testimony (contextRow); the in-house agent
    /// distills the category from it out-of-band. A previously menu-confirmed photo
    /// still shows its confirmed value.
    @ViewBuilder private var intentHint: some View {
        if let confirmed = confirmedValue {
            Label("\(confirmed.capitalized) · confirmed", systemImage: "checkmark.circle.fill")
                .font(.caption).foregroundStyle(.green)
        } else if let intent = photo.intent {
            HStack(spacing: 6) {
                Text("reads as \(intent.replacingOccurrences(of: "_", with: " "))")
                    .font(.caption).foregroundStyle(.white.opacity(0.55))
                if let conf = photo.intent_confidence {
                    Text(String(format: "%.0f%%", conf * 100))
                        .font(.caption2).monospacedDigit()
                        .foregroundStyle(.white.opacity(0.4))
                }
            }
        }
    }

    /// The composer — the owner adds context in their own words. Replaces the fixed
    /// six-item "Why was this taken?" menu. Available on every frame, analyzed or not.
    @ViewBuilder private var contextRow: some View {
        if composing {
            VStack(alignment: .leading, spacing: 6) {
                TextField("What was happening here?", text: $draft, axis: .vertical)
                    .lineLimit(1...4)
                    .focused($composerFocused)
                    .font(.callout)
                    .foregroundStyle(.white)
                    .tint(.white)
                    .padding(8)
                    .background(.white.opacity(0.10), in: RoundedRectangle(cornerRadius: 8))
                HStack(spacing: 14) {
                    if noteError {
                        Text("Didn't save — try again")
                            .font(.caption2).foregroundStyle(.orange)
                    }
                    Spacer(minLength: 0)
                    Button("Cancel") { cancelCompose() }
                        .font(.caption).foregroundStyle(.white.opacity(0.6))
                    Button(submitting ? "Saving…" : "Save") { submit() }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(draftIsEmpty ? .white.opacity(0.3) : .white)
                        .disabled(submitting || draftIsEmpty)
                }
            }
            .buttonStyle(.plain)
        } else {
            Button {
                composing = true
                composerFocused = true
            } label: {
                Label(ownerNote == nil ? "Add context" : "Add to context",
                      systemImage: "text.bubble")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.85))
            }
            .buttonStyle(.plain)
        }
    }

    private var draftIsEmpty: Bool {
        draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func cancelCompose() {
        composing = false
        draft = ""
        noteError = false
        composerFocused = false
    }

    /// Land the owner's words as testimony (owner-gated add_photo_comment → a
    /// vehicle_observations comment row). Optimistic: the note shows immediately;
    /// on failure we keep the composer open with the text intact (no silent loss).
    private func submit() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        submitting = true
        noteError = false
        Task {
            do {
                _ = try await SupabaseService.client
                    .rpc("add_photo_comment",
                         params: ["p_image_id": photo.id.uuidString, "p_comment": text])
                    .execute()
                localNote = text
                draft = ""
                composing = false
                composerFocused = false
                submitting = false
            } catch {
                noteError = true
                submitting = false
                NSLog("NukeCapture add_photo_comment failed: %@", String(describing: error))
            }
        }
    }
}
