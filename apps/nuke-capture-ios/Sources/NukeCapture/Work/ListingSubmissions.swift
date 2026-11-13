import Foundation
import SwiftUI
import Supabase

/// Own-account listing records, separate from auction outcomes and seller approval.
struct ListingSubmission: Decodable, Identifiable {
    struct Metadata: Decodable {
        let stage: String?
        let stage_since: String?
    }
    let id: UUID
    let user_id: UUID
    let vehicle_id: UUID
    let platform: String
    let title: String?
    let status: String
    let metadata: Metadata?
    let external_listing_url: String?
    let updated_at: String?
    let created_at: String?

    var stageLabel: String {
        if status == "prepared" { return "Prepared · not submitted" }
        guard status == "submitted" else { return "Listing state unavailable" }
        switch metadata?.stage {
        case "draft_pending_approval": return "Draft awaiting seller approval"
        case "accepted": return "Accepted · listing in preparation"
        default: return "Submitted · next step unknown"
        }
    }
    var sourceLabel: String {
        switch platform {
        case "bat": return "Bring a Trailer"
        case "carsandbids": return "Cars & Bids"
        case "ebay": return "eBay"
        default: return platform
        }
    }
    var recordedClock: String { updated_at ?? created_at ?? "" }
    var url: URL? {
        guard let raw = external_listing_url, let u = URL(string: raw),
              u.scheme?.lowercased() == "https", u.host != nil,
              u.user == nil, u.password == nil else { return nil }
        return u
    }
}

struct ListingSubmissionPage {
    let rows: [ListingSubmission]
    let total: Int?
    let readAt = Date()

    static func decode(_ data: Data, account: String, total: Int?) throws -> Self {
        let rows = try JSONDecoder().decode([ListingSubmission].self, from: data)
        guard let owner = UUID(uuidString: account), rows.allSatisfy({
            $0.user_id == owner && ["prepared", "submitted"].contains($0.status)
        }), total.map({ $0 >= rows.count }) ?? true else { throw CocoaError(.coderInvalidValue) }
        return Self(rows: rows, total: total)
    }
    var coverage: String {
        let clock = readAt.formatted(date: .abbreviated, time: .shortened)
        if let total { return "Showing \(min(5, rows.count)) of \(total) prepared or submitted listing records · read \(clock)." }
        return "Showing \(min(5, rows.count)) listing records · total unknown · read \(clock)."
    }
}

enum ListingSubmissionReaders {
    static let table = "listing_exports"
    static func load() async -> JobLoad<ListingSubmissionPage> {
        guard let account = SupabaseService.currentUserId else {
            return .refused(JobRefusal(reader: table, kind: .signInNeeded,
                title: "Sign in to see this", detail: "Listing submissions belong to the signed-in account."))
        }
        do {
            let response = try await SupabaseService.client.from(table)
                .select("id,user_id,vehicle_id,platform,title,status,metadata,external_listing_url,updated_at,created_at", count: .exact)
                .eq("user_id", value: account)
                .in("status", values: ["prepared", "submitted"])
                .order("updated_at", ascending: false)
                .order("id", ascending: true)
                .limit(50).execute()
            guard SupabaseService.currentUserId == account else { throw CancellationError() }
            return .loaded(try ListingSubmissionPage.decode(response.data, account: account, total: response.count))
        } catch {
            return .refused(JobReaders.refusal(table, error))
        }
    }
}

struct ListingSubmissionsSection: View {
    let page: JobLoad<ListingSubmissionPage>
    var body: some View {
        Section("Listing submissions") {
            switch page {
            case .loading:
                ProgressView("Reading submissions…")
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let p):
                if p.rows.isEmpty {
                    Text("No prepared or submitted listings recorded for this account.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(p.rows.prefix(5)) { row in
                    VStack(alignment: .leading, spacing: 5) {
                        NavigationLink {
                            VehicleDetailView(vehicleId: row.vehicle_id.uuidString)
                        } label: {
                            Text(row.title.flatMap { $0.isEmpty ? nil : "“\($0)”" } ?? "Vehicle listing")
                        }
                        Text("\(row.sourceLabel) · \(row.stageLabel)")
                            .font(.subheadline)
                        Text(EventTime.label(ProfileClock.date(row.recordedClock), verb: "Recorded"))
                            .font(.caption).foregroundStyle(.secondary)
                        if let since = ProfileClock.date(row.metadata?.stage_since) {
                            Text(EventTime.label(since, verb: "State since")).font(.caption).foregroundStyle(.secondary)
                        }
                        if let url = row.url {
                            Link("Open recorded listing", destination: url).font(.subheadline)
                        }
                    }
                    .padding(.vertical, 4)
                }
                Text(p.coverage).font(.caption).foregroundStyle(.secondary)
                Link("All submissions on nuke.ag", destination: URL(string: "https://nuke.ag/sell")!)
            }
        }
    }
}
