//  OrganizationView.swift
//  An organization inside the app: what it is, how warm the viewer's relation to it is, and the
//  vehicles it touched most recently. One read, `get_org_page`, run as the viewer, so the photo
//  and vehicle gates decide what comes back. Tapping an organization used to open nuke.ag.
//
//  A relation is a weight, not a status (owner, 2026-10-15): it is maintained only by
//  contribution and decays with a half-life of hours. One contribution reads 0.5 after one
//  half-life and is dormant a day later. The server computes the weight at `as_of`; this view
//  renders it and never re-derives it.

import SwiftUI
import Supabase

struct OrgPage: Decodable {
    struct Org: Decodable {
        let id: String
        let name: String?
        let type: String?
        let city: String?
        let state: String?
    }
    /// One relation's weight at `as_of`, from its contribution log (`relation_weight`, `relation_state`).
    struct Relation: Decodable {
        let weight: Double
        /// live, stalling or dormant, cut from the weight by the server.
        let state: String
        /// Nil when nothing landed in the server's 48 h window.
        let last_contribution_at: String?
        /// Distinct hours with a contribution in the last 24 h.
        let contributions_24h: Int
        /// Photos at a location shared with other organizations whose vehicle is linked to none of them.
        var unresolved_shared_site_photos_24h: Int? = nil
    }
    struct You: Decodable {
        let role: String?
        let relation: Relation
    }
    struct Vehicle: Decodable, Identifiable {
        let vehicle_id: String
        let year: Int?
        let make: String?
        let model: String?
        let image_url: String?
        let relationship_type: String?
        let relation: Relation
        var id: String { vehicle_id }
        var title: String {
            [year.map(String.init), make, model].compactMap { $0 }.joined(separator: " ")
        }
    }
    let org: Org
    let as_of: String
    let half_life_hours: Double
    let dormant_below: Double
    let basis: [String]
    let you: You?
    let vehicles: [Vehicle]
    let vehicles_considered: Int
    let vehicles_total: Int
}

enum RelationWeight {
    /// The server's state in plain words. Live inside one half-life, stalling until a day has passed, dormant after.
    static func word(_ r: OrgPage.Relation) -> String {
        switch r.state {
        case "live": return "Live"
        case "stalling": return "Stalling"
        default: return "Dormant"
        }
    }
    static func color(_ r: OrgPage.Relation) -> Color {
        switch r.state {
        case "live": return .green
        case "stalling": return .orange
        default: return .secondary
        }
    }
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    static func date(_ s: String?) -> Date? {
        guard let s else { return nil }
        // Postgres sends microseconds and sometimes a space for the T; read at second precision.
        let cleaned = s.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: " ", with: "T")
        return iso.date(from: cleaned) ?? iso.date(from: cleaned + "Z")
    }
    static func ago(_ s: String?) -> String? {
        guard let d = date(s) else { return nil }
        return RelativeDateTimeFormatter().localizedString(for: d, relativeTo: Date())
    }
}

/// A weight as a bar and a line: "Stalling · last contribution 9 hours ago".
struct RelationWeightLine: View {
    let relation: OrgPage.Relation

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Circle().fill(RelationWeight.color(relation)).frame(width: 8, height: 8)
                Text(RelationWeight.word(relation)).font(.subheadline.weight(.semibold))
                Text(String(format: "%.2f", relation.weight)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                Spacer()
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.secondary.opacity(0.15))
                    Capsule().fill(RelationWeight.color(relation))
                        .frame(width: geo.size.width * min(1, max(0, relation.weight)))
                }
            }
            .frame(height: 4)
            Text(detail).font(.caption).foregroundStyle(.secondary)
        }
    }

    private var detail: String {
        var parts: [String] = []
        if let ago = RelationWeight.ago(relation.last_contribution_at) {
            parts.append("Last contribution \(ago)")
            if relation.contributions_24h > 0 {
                parts.append("in \(relation.contributions_24h) of the last 24 hours")
            }
        } else {
            parts.append("Nothing in the last 2 days")
        }
        if let n = relation.unresolved_shared_site_photos_24h, n > 0 {
            parts.append("\(n) photo\(n == 1 ? "" : "s") at a shared lot whose vehicle isn't linked here")
        }
        return parts.joined(separator: " · ")
    }
}

struct OrganizationView: View {
    let orgId: String
    var fallbackName: String? = nil

    @State private var page: OrgPage?
    @State private var failure: String?

    var body: some View {
        List {
            if let page {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(page.org.name ?? fallbackName ?? "Organization").font(.title3.weight(.semibold))
                        let line = [page.org.type?.replacingOccurrences(of: "_", with: " "),
                                    [page.org.city, page.org.state].compactMap { $0 }.joined(separator: ", ")]
                            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
                        if !line.isEmpty { Text(line).font(.caption).foregroundStyle(.secondary) }
                    }
                }
                if let you = page.you {
                    Section {
                        RelationWeightLine(relation: you.relation)
                    } header: {
                        Text("You here" + (you.role.map { " · \(words($0))" } ?? ""))
                    } footer: {
                        Text(footer(page)).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                Section {
                    if page.vehicles.isEmpty {
                        Text("No vehicles readable here.").font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(page.vehicles) { v in
                        NavigationLink {
                            VehicleDetailView(vehicleId: v.vehicle_id, embedInNavigationStack: false)
                        } label: { vehicleRow(v) }
                    }
                } header: {
                    Text(page.vehicles_total > page.vehicles.count
                         ? "Vehicles · \(page.vehicles.count) of \(page.vehicles_total.formatted()), most recent contact first"
                         : "Vehicles · \(page.vehicles.count), most recent contact first")
                } footer: {
                    if page.vehicles_considered < page.vehicles_total {
                        Text("Contact is read for the \(page.vehicles_considered.formatted()) most recently linked.")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
            } else if let failure {
                Section {
                    Text("Couldn't load. \(failure)").font(.footnote).foregroundStyle(.secondary)
                    Button("Retry") { Task { await load() } }
                }
            } else {
                Section { ProgressView() }
            }
        }
        .navigationTitle(page?.org.name ?? fallbackName ?? "Organization")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
    }

    @ViewBuilder private func vehicleRow(_ v: OrgPage.Vehicle) -> some View {
        HStack(spacing: 12) {
            CachedAsyncImage(url: NukeImage.thumb(v.image_url, width: 170), maxPixel: 170) { img in
                img.resizable().scaledToFill()
            } placeholder: {
                Color.secondary.opacity(0.12)
            }
            .frame(width: 56, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 2) {
                Text(v.title.isEmpty ? "Vehicle" : v.title).font(.subheadline.weight(.medium)).lineLimit(1)
                HStack(spacing: 4) {
                    Circle().fill(RelationWeight.color(v.relation)).frame(width: 6, height: 6)
                    Text([RelationWeight.word(v.relation),
                          RelationWeight.ago(v.relation.last_contribution_at)].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let r = v.relationship_type, !r.isEmpty {
                    Text(words(r)).font(.caption2).foregroundStyle(.tertiary)
                }
            }
        }
    }

    private func footer(_ page: OrgPage) -> String {
        let basis = page.basis.isEmpty ? "contributions" : page.basis.joined(separator: ", ")
        return "Kept warm only by contributions: \(basis). The weight halves every \(Int(page.half_life_hours)) h and goes dormant a day after the last one."
    }

    private func words(_ s: String) -> String {
        s.split(separator: "_").map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
    }

    private func load() async {
        do {
            page = try await SupabaseService.client
                .rpc("get_org_page", params: ["p_org_id": orgId])
                .execute().value
            failure = nil
        } catch {
            failure = ReadFailure.text(error)
        }
    }
}
