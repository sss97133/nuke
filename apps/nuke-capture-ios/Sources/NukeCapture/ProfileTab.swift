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

/// Day rows after grouping (one per calendar day, newest first).
struct DayRecord: Identifiable {
    let day: String
    var photos = 0
    var events = 0
    var work = 0
    var id: String { day }
}

/// get_user_day_receipt(p_user_id, p_date) → jsonb.
struct DayReceipt: Decodable {
    struct Photo: Decodable, Identifiable {
        let id: UUID
        let thumb: String?
        let url: String?
        let taken_at: String?
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
            days = byDay.values.sorted { $0.day > $1.day }   // newest first
            loadError = nil
        } catch {
            loadError = "Load failed"
            NSLog("NukeCapture profile load failed: %@", String(describing: error))
        }
    }
}

// ─── Day receipt: what the day actually was ──────────────────────────────────

struct DayReceiptView: View {
    let userId: String
    let date: String

    @State private var receipt: DayReceipt?
    @State private var loadError: String?

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
                                    if let minutes = ws.duration_minutes {
                                        Text("\(minutes) min").monospacedDigit()
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
            receipt = try await SupabaseService.client
                .rpc("get_user_day_receipt",
                     params: ["p_user_id": userId, "p_date": date])
                .execute()
                .value
        } catch {
            loadError = "Load failed"
            NSLog("NukeCapture day receipt failed: %@", String(describing: error))
        }
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

/// Full-bleed photo viewer — black background, tap or drag-down to dismiss.
/// Evidence rail at the bottom: monospaced taken_at + file_name + ANALYSIS PENDING.
private struct PhotoFullScreenView: View {
    let photo: DayReceipt.Photo
    @Environment(\.dismiss) private var dismiss

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

            // Evidence rail — fixed-height facts bar at the bottom.
            VStack(alignment: .leading, spacing: 2) {
                // Line 1: taken_at (verbatim) + optional file_name
                HStack(spacing: 8) {
                    if let takenAt = photo.taken_at {
                        Text(takenAt)
                            .font(.caption)
                            .monospacedDigit()
                            .foregroundStyle(.white)
                    }
                    // file_name is not on DayReceipt.Photo model (url/thumb only) —
                    // field absent; omit rather than fabricate.
                }
                // Line 2: honest placeholder until vision verdicts exist
                Text("ANALYSIS PENDING")
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.black)
        }
        .onTapGesture { dismiss() }
        .gesture(DragGesture(minimumDistance: 40)
            .onEnded { v in if v.translation.height > 0 { dismiss() } })
    }
}
