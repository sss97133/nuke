// WorkDaySignView.swift — confirm your build, one day at a time.
//
// NOT a timesheet. The day is the unit: you SEE the day's photos (your truck
// that afternoon), the derived labor as a plain line, and confirm the whole day
// with one tap — or skip it. You swipe through days like flipping a build
// journal; the photos are the proof, and confirming rides along.
//
// Confirming a day sets work_sessions.owner_confirmed_at (Tier 4 / the $410
// value gate) via confirm_work_session. The derived day is a CLAIM you confirm,
// never an assignment (the 707-Yucca lesson). Value is real only after you sign.

import SwiftUI

@MainActor
final class WorkDaySignEngine: ObservableObject {
    static let shared = WorkDaySignEngine()
    private init() {}

    struct WorkDay: Identifiable, Sendable, Equatable {
        let id: String                 // work_sessions.id
        let vehicleId: String?
        let sessionDate: String        // yyyy-MM-dd
        let durationMinutes: Int
        let vehicleLabel: String
        static func == (a: WorkDay, b: WorkDay) -> Bool { a.id == b.id }
    }

    @Published private(set) var days: [WorkDay] = []
    @Published private(set) var loaded = false
    @Published private(set) var signedCount = 0
    @Published var note: String?

    // ─── DB shapes ───────────────────────────────────────────────────────────
    private struct VehicleRow: Decodable {
        let id: String; let year: Int?; let make: String?; let model: String?
        var label: String {
            let s = [year.map(String.init), make, model].compactMap { $0 }
                .filter { !$0.isEmpty }.joined(separator: " ").uppercased()
            return s.isEmpty ? "UNKNOWN VEHICLE" : s
        }
    }
    private struct SessionRow: Decodable {
        let id: String; let vehicle_id: String?; let session_date: String; let duration_minutes: Int?
    }
    private struct ImageRow: Decodable { let image_url: String? }
    private struct SignParams: Encodable { let p_session_id: String; let p_confirm: Bool }

    /// Owner's unconfirmed work-days, newest first. Owner-scoped by construction.
    func load() async {
        guard let userId = SupabaseService.currentUserId else { loaded = true; return }
        let vehicles: [VehicleRow] = (try? await SupabaseService.client.from("vehicles")
            .select("id, year, make, model")
            .eq("user_id", value: userId)
            .execute().value) ?? []
        guard !vehicles.isEmpty else { days = []; loaded = true; return }
        let byId = Dictionary(uniqueKeysWithValues: vehicles.map { ($0.id, $0) })

        let rows: [SessionRow] = (try? await SupabaseService.client.from("work_sessions")
            .select("id, vehicle_id, session_date, duration_minutes")
            .in("vehicle_id", values: vehicles.map(\.id))
            .is("owner_confirmed_at", value: nil)
            .gt("duration_minutes", value: 0)
            .order("session_date", ascending: false)
            .limit(80)
            .execute().value) ?? []

        days = rows.map { r in
            WorkDay(id: r.id, vehicleId: r.vehicle_id, sessionDate: r.session_date,
                    durationMinutes: r.duration_minutes ?? 0,
                    vehicleLabel: r.vehicle_id.flatMap { byId[$0]?.label } ?? "UNKNOWN VEHICLE")
        }
        loaded = true
    }

    /// The day's actual photos — the proof you confirm on (that vehicle, that day).
    func photos(for day: WorkDay) async -> [String] {
        guard let vid = day.vehicleId else { return [] }
        let rows: [ImageRow] = (try? await SupabaseService.client.from("vehicle_images")
            .select("image_url")
            .eq("vehicle_id", value: vid)
            .gte("taken_at", value: "\(day.sessionDate)T00:00:00")
            .lte("taken_at", value: "\(day.sessionDate)T23:59:59.999")
            .eq("is_external", value: false)
            .order("taken_at", ascending: true)
            .limit(12)
            .execute().value) ?? []
        return rows.compactMap { $0.image_url }.filter { !$0.isEmpty }
    }

    /// Confirm one day → owner-confirmed labor (Tier 4). Drops it from the deck.
    @discardableResult
    func sign(_ day: WorkDay) async -> Bool {
        do {
            try await SupabaseService.client
                .rpc("confirm_work_session", params: SignParams(p_session_id: day.id, p_confirm: true))
                .execute()
            days.removeAll { $0.id == day.id }
            signedCount += 1
            return true
        } catch {
            note = "Couldn't confirm: \(error.localizedDescription)"
            return false
        }
    }

    /// Defer a day — sends it to the back of the deck, unsigned.
    func skip(_ day: WorkDay) {
        guard let i = days.firstIndex(of: day) else { return }
        days.append(days.remove(at: i))
    }

    static func minutesLabel(_ m: Int) -> String {
        m >= 60 ? "\(m / 60)h \(m % 60)m" : "\(m) min"
    }
    /// "2021-05-20" → "MAY 20 2021"
    static func prettyDate(_ ymd: String) -> String {
        let p = ymd.split(separator: "-")
        guard p.count == 3, let mo = Int(p[1]), let dy = Int(p[2]) else { return ymd }
        let names = ["", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
        let mn = (1...12).contains(mo) ? names[mo] : String(p[1]).uppercased()
        return "\(mn) \(dy) \(p[0])"
    }
}

struct WorkDaySignView: View {
    @ObservedObject private var engine = WorkDaySignEngine.shared

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if !engine.loaded {
                ProgressView().tint(.white)
            } else if engine.days.isEmpty {
                doneState
            } else {
                TabView {
                    ForEach(engine.days) { day in
                        DayCard(day: day)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .ignoresSafeArea(edges: .bottom)
            }

            // Transient error banner — a failed confirm must not be silent.
            if let note = engine.note {
                VStack {
                    Text(note)
                        .font(.caption.weight(.medium)).foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(.red.opacity(0.85), in: Capsule())
                        .padding(.top, 8)
                    Spacer()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
                .task {
                    try? await Task.sleep(nanoseconds: 3_500_000_000)
                    engine.note = nil
                }
            }
        }
        .animation(.easeInOut, value: engine.note)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    Text("YOUR DAYS").font(.caption.weight(.bold)).kerning(1).foregroundStyle(.white)
                    if engine.loaded {
                        Text(engine.signedCount > 0
                             ? "\(engine.signedCount) signed · \(engine.days.count) left"
                             : "\(engine.days.count) to confirm")
                            .font(.caption2.monospacedDigit()).foregroundStyle(.white.opacity(0.6))
                    }
                }
            }
        }
        .toolbarBackground(.black, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .preferredColorScheme(.dark)
        .task { if !engine.loaded { await engine.load() } }
    }

    private var doneState: some View {
        VStack(spacing: 10) {
            Image(systemName: "checkmark.seal.fill").font(.largeTitle).foregroundStyle(.green)
            Text(engine.signedCount > 0 ? "ALL CAUGHT UP" : "NOTHING TO CONFIRM")
                .font(.headline).foregroundStyle(.white)
            if engine.signedCount > 0 {
                Text("\(engine.signedCount) days signed — real labor, on the record.")
                    .font(.caption).foregroundStyle(.white.opacity(0.6))
            }
        }
    }
}

/// One day as a full-bleed card: the day's photos, the derived labor, one tap.
/// Explicit GeometryReader widths so nothing can render wider than the screen.
private struct DayCard: View {
    let day: WorkDaySignEngine.WorkDay
    @ObservedObject private var engine = WorkDaySignEngine.shared
    @State private var photos: [String] = []
    @State private var loaded = false
    @State private var busy = false

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottom) {
                Color.black

                // HERO — the day's first frame, clamped to the screen rect.
                if let hero = photos.first {
                    CachedAsyncImage(url: NukeImage.thumb(hero, width: 1000)) { img in
                        img.resizable().scaledToFill()
                    } placeholder: {
                        Color(.secondarySystemFill).overlay { ProgressView() }
                    }
                    .frame(width: geo.size.width, height: geo.size.height)
                    .clipped()
                } else if loaded {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 44)).foregroundStyle(.white.opacity(0.25))
                } else {
                    ProgressView().tint(.white)
                }

                // Bottom scrim — full width, behind the inset content.
                LinearGradient(colors: [.clear, .black.opacity(0.55), .black.opacity(0.96)],
                               startPoint: .top, endPoint: .bottom)
                    .frame(width: geo.size.width, height: 340)

                // STORY + ACTIONS — explicitly width-constrained.
                VStack(alignment: .leading, spacing: 12) {
                    if photos.count > 1 {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 4) {
                                ForEach(Array(photos.dropFirst().prefix(10)), id: \.self) { u in
                                    CachedAsyncImage(url: NukeImage.thumb(u, width: 120)) { i in
                                        i.resizable().scaledToFill()
                                    } placeholder: { Color.white.opacity(0.1) }
                                    .frame(width: 54, height: 54).clipped()
                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                                }
                            }
                        }
                    }

                    Text(day.vehicleLabel).font(.title2.weight(.bold))
                        .foregroundStyle(.white).lineLimit(1)

                    HStack(spacing: 10) {
                        Text(WorkDaySignEngine.prettyDate(day.sessionDate))
                            .font(.system(.subheadline, design: .monospaced)).foregroundStyle(.white.opacity(0.85))
                        Text(WorkDaySignEngine.minutesLabel(day.durationMinutes))
                            .font(.system(.subheadline, design: .monospaced).weight(.semibold)).foregroundStyle(.white)
                        if !photos.isEmpty {
                            Text("· \(photos.count) photo\(photos.count == 1 ? "" : "s")")
                                .font(.caption).foregroundStyle(.white.opacity(0.6))
                        }
                    }

                    HStack(spacing: 12) {
                        Button {
                            busy = true
                            Task { await engine.sign(day); busy = false }
                        } label: {
                            Text(busy ? "…" : "CONFIRM THIS DAY")
                                .frame(maxWidth: .infinity).fontWeight(.bold).kerning(0.5)
                        }
                        .buttonStyle(.borderedProminent).controlSize(.large).disabled(busy)

                        Button { engine.skip(day) } label: {
                            Text("SKIP").fontWeight(.semibold)
                        }
                        .buttonStyle(.bordered).controlSize(.large).tint(.white)
                    }

                    Text("Looks like this truck? Confirm if the photos match — value becomes real only when you sign. If it's the wrong vehicle, tap Skip.")
                        .font(.caption2).foregroundStyle(.white.opacity(0.55))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(width: geo.size.width - 40, alignment: .leading)
                .padding(.bottom, 28)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
        }
        .ignoresSafeArea()
        .task {
            photos = await engine.photos(for: day)
            loaded = true
        }
    }
}
