// Priorities.swift — Work → "Priorities" (shop_priorities_read).
//
// The server ranks the vehicles worth looking at today from your own photos (the lot is found from
// your photo GPS), open work orders, requirements and balances. Each row shows its reasons in plain
// words. Money figures built from an assumed rate say so. If the reader isn't deployed the section
// says "Not available yet" instead of failing the screen.

import SwiftUI
import Supabase

struct PriorityRow: Decodable, Identifiable, Equatable {
    let vehicleId: String
    let year: Int?
    let make: String?
    let model: String?
    let score: Int
    let reasons: [String]
    let rank: Int

    var id: String { vehicleId }

    enum CodingKeys: String, CodingKey {
        case vehicleId = "vehicle_id", year, make, model, score, reasons, rank
    }

    init(vehicleId: String, year: Int? = nil, make: String? = nil, model: String? = nil, score: Int, reasons: [String], rank: Int) {
        self.vehicleId = vehicleId; self.year = year; self.make = make; self.model = model
        self.score = score; self.reasons = reasons; self.rank = rank
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(vehicleId: try c.decode(String.self, forKey: .vehicleId),
                  year: try? c.decode(Int.self, forKey: .year),
                  make: try? c.decode(String.self, forKey: .make),
                  model: try? c.decode(String.self, forKey: .model),
                  score: (try? c.decode(Int.self, forKey: .score)) ?? 0,
                  reasons: (try? c.decode([String].self, forKey: .reasons)) ?? [],
                  rank: (try? c.decode(Int.self, forKey: .rank)) ?? 0)
    }

    var title: String {
        let parts = [year.map(String.init), make, model].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? "Unnamed vehicle" : parts.joined(separator: " ")
    }
}

struct PriorityList: Decodable, Equatable {
    let rows: [PriorityRow]
    init(rows: [PriorityRow]) { self.rows = rows }
    init(from decoder: Decoder) throws {
        rows = try decoder.singleValueContainer().decode([PriorityRow].self).sorted { $0.rank < $1.rank }
    }
}

enum PriorityCopy {
    /// One reason code ("name:value") in plain words. Unknown codes are dropped, never shown raw.
    static func reason(_ code: String) -> String? {
        let parts = code.split(separator: ":", maxSplits: 1).map(String.init)
        let name = parts.first ?? ""
        let value = parts.count > 1 ? parts[1] : ""
        let n = Int(value)
        func plural(_ count: Int, _ one: String, _ many: String) -> String { "\(count) \(count == 1 ? one : many)" }
        switch name {
        case "photographed_recent":
            return "Photographed at the lot in the last 3 days" + (n.map { " (\(plural($0, "photo", "photos")))" } ?? "")
        case "photographed_this_fortnight":
            return "Photographed at the lot in the last 2 weeks" + (n.map { " (\(plural($0, "photo", "photos")))" } ?? "")
        case "in_progress_idle_days":
            return n.map { "In progress, no update for \(plural($0, "day", "days"))" }
        case "pending_or_quoted":
            return "Has a job waiting to start or a quote out"
        case "unfulfilled_requirements":
            return n.map { plural($0, "part or tool still needed", "parts or tools still needed") }
        case "open_balance":
            return Double(value).map { "Open balance of " + $0.formatted(.currency(code: "USD").precision(.fractionLength(0))) }
        case "unassigned_photos":
            return n.map { "\(plural($0, "photo", "photos")) from those days not yet matched to a vehicle" }
        case "held_days":
            return n.map { "Held \(plural($0, "day", "days"))" }
        case "on_record_days":
            return n.map { "On record \(plural($0, "day", "days")) (purchase date missing)" }
        case "carrying_cost_assumed_rate":
            return Double(value).map { "About " + $0.formatted(.currency(code: "USD").precision(.fractionLength(0))) + " carrying cost at an assumed rate" }
        case "not_listed_photos_ready":
            return n.map { "Not listed yet, \(plural($0, "photo", "photos")) ready" }
        case "needs_service_order":
            return "Needs a service order"
        default:
            return nil
        }
    }

    static func reasons(_ codes: [String]) -> String {
        codes.compactMap(reason).joined(separator: " · ")
    }
}

enum PriorityReaders {
    static let name = "shop_priorities_read"

    static func load() async -> JobLoad<PriorityList> {
        await JobReaders.call(name) { try await SupabaseService.client.rpc(name).execute().data }
    }
}

struct PrioritiesSection: View {
    @State private var load: JobLoad<PriorityList> = .loading
    var limit = 8

    var body: some View {
        Section {
            switch load {
            case .loading:
                HStack(spacing: 8) { ProgressView(); Text("Loading…").font(.footnote).foregroundStyle(.secondary) }
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let list):
                if list.rows.isEmpty {
                    Text("Nothing needs attention right now.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(list.rows.prefix(limit)) { row in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(row.title).font(.subheadline)
                        Text(PriorityCopy.reasons(row.reasons)).font(.footnote).foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        } header: {
            Text("Priorities")
        }
        .task { load = await PriorityReaders.load() }
    }
}
