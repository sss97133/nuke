// CapturedListings.swift — the retained classified listings, read the way the web reads them.
//
// nuke.ag's Market tab "Captured listings" (nuke_frontend/src/pages/market/useCapturedListings.ts,
// #994) is a direct read of vehicle_events by source platform, newest retained first, with the
// public parent vehicle joined for identity and image. There is no RPC and no reader-level clock:
// each row carries its own capture clocks (created_at, the source's observed time when retained).
// This file is that read on the phone, with the same sources, the same page size and the same
// acceptance rule (a row needs a public parent, or an unresolved row needs a source URL that is a
// real listing path on the platform's own host). Nothing is counted that the web does not count.

import Foundation
import SwiftUI
import Supabase

struct CapturedListing: Decodable, Identifiable {
    let id: String
    let vehicle_id: String?
    let source_platform: String
    let source_listing_id: String?
    let source_url: String?
    let current_price: Double?
    let event_status: String?
    let created_at: String?
    let updated_at: String?
    let source_observed_at: String?
    var vehicle: Parent?

    struct Parent: Decodable {
        let id: String
        let year: Int?
        let make: String?
        let model: String?
        let primary_image_url: String?
    }

    /// The source's own clock when it was retained, else the capture clock.
    var clock: String? { source_observed_at ?? created_at }

    var headline: String {
        if let v = vehicle {
            let s = [v.year.map(String.init), v.make, v.model].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
            if !s.isEmpty { return s }
        }
        return "Unresolved \(CapturedListings.sourceName(source_platform)) listing"
    }

    /// The listing page on the platform's own host, or nil (web sourceLink rule).
    var sourceLink: URL? { CapturedListings.sourceLink(platform: source_platform, value: source_url) }
}

enum CapturedListings {
    static let classifiedSources = ["craigslist", "facebook_marketplace", "ksl"]
    static let pageSize = 50

    private static let names: [String: String] = [
        "craigslist": "Craigslist", "facebook_marketplace": "Facebook Marketplace", "ksl": "KSL",
        "bat": "Bring a Trailer", "bring_a_trailer": "Bring a Trailer", "cars_and_bids": "Cars & Bids",
        "mecum": "Mecum", "barrett_jackson": "Barrett-Jackson", "barrettjackson": "Barrett-Jackson",
    ]
    static func sourceName(_ platform: String) -> String { names[platform] ?? platform }

    private static let hosts: [String: String] = [
        "craigslist": "craigslist.org", "facebook_marketplace": "facebook.com", "ksl": "ksl.com",
        "bat": "bringatrailer.com", "bring_a_trailer": "bringatrailer.com", "cars_and_bids": "carsandbids.com",
        "mecum": "mecum.com", "barrettjackson": "barrett-jackson.com", "barrett_jackson": "barrett-jackson.com",
    ]
    private static let paths: [String: String] = [
        "craigslist": #"^(?:/view/d/[\w-]+/[a-zA-Z0-9]+|/\w+/d/[\w-]+/\d+\.html)/?$"#,
        "facebook_marketplace": #"^/marketplace/item/\d+/?$"#,
        "ksl": #"^/listing/\d+/?$"#,
        "bat": #"^/listing/[\w-]+/?$"#, "bring_a_trailer": #"^/listing/[\w-]+/?$"#,
        "cars_and_bids": #"^/auctions/[\w-]+(?:/[\w-]+)?/?$"#,
        "mecum": #"^/lots/\d+/[\w-]+/?$"#,
        "barrettjackson": #"^/[\w-]+/docket/vehicle/[\w-]+/?$"#, "barrett_jackson": #"^/[\w-]+/docket/vehicle/[\w-]+/?$"#,
    ]

    /// A host alone cannot qualify an unresolved row; the path must be a listing path too.
    static func sourceLink(platform: String, value: String?) -> URL? {
        guard let value, let url = URL(string: value), let host = hosts[platform], let pattern = paths[platform],
              let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              url.user == nil, url.password == nil, url.port == nil, url.query == nil, url.fragment == nil,
              let hostname = url.host?.lowercased(), hostname == host || hostname.hasSuffix("." + host),
              url.path.range(of: pattern, options: .regularExpression) != nil else { return nil }
        return url
    }

    /// One page, newest retained first: the events, then their public parents.
    static func read() async throws -> [CapturedListing] {
        var rows: [CapturedListing] = try await SupabaseService.client
            .from("vehicle_events")
            .select("id,vehicle_id,source_platform,source_listing_id,source_url,current_price,event_status,created_at,updated_at,source_observed_at:metadata->>source_observed_at")
            .in("source_platform", values: classifiedSources)
            .order("created_at", ascending: false, nullsFirst: false)
            .order("id", ascending: false)
            .limit(pageSize)
            .execute().value
        let ids = Array(Set(rows.compactMap(\.vehicle_id)))
        var parents: [String: CapturedListing.Parent] = [:]
        if !ids.isEmpty {
            let vehicles: [CapturedListing.Parent] = try await SupabaseService.client
                .from("vehicles")
                .select("id,year,make,model,primary_image_url")
                .in("id", values: ids)
                .eq("is_public", value: true)
                .is("deleted_at", value: nil)
                .or("listing_kind.is.null,listing_kind.neq.non_vehicle_item")
                .limit(pageSize)
                .execute().value
            for v in vehicles { parents[v.id] = v }
        }
        rows = rows.filter { row in
            if let vid = row.vehicle_id { return parents[vid] != nil }
            return row.sourceLink != nil
        }
        for i in rows.indices { if let vid = rows[i].vehicle_id { rows[i].vehicle = parents[vid] } }
        return rows
    }
}

/// The captured classified listings as a list, newest retained first, with the population line
/// first: how many rows this page holds, which sources, and that the rows carry their own clocks.
struct CapturedListingsView: View {
    @State private var rows: [CapturedListing]?
    @State private var loadError = false

    private var coverageSentence: String {
        let n = rows?.count ?? 0
        let names = CapturedListings.classifiedSources.map(CapturedListings.sourceName).joined(separator: ", ")
        return "\(n.formatted()) retained listings on this page · newest first · \(names) · no reader clock, each row carries its own"
    }

    var body: some View {
        Group {
            if let rows {
                List {
                    Section {
                        ForEach(rows) { row in
                            if let v = row.vehicle, let uuid = UUID(uuidString: v.id) {
                                NavigationLink(value: VehicleHeaderRow(id: uuid, year: v.year, make: v.make, model: v.model, trim: nil,
                                                                       primary_image_url: v.primary_image_url, city: nil, state: nil)) {
                                    line(row)
                                }
                            } else if let link = row.sourceLink {
                                Link(destination: link) { line(row) }.buttonStyle(.plain)
                            } else {
                                line(row)
                            }
                        }
                    } header: {
                        Text(coverageSentence).font(.system(size: 9, design: .monospaced)).textCase(nil)
                    } footer: {
                        Text("A recorded amount is the seller's assertion as retained, in a currency the reader does not record; a listing's presence is one sighting, not a sale or a current availability.")
                    }
                }
                .listStyle(.plain)
                .refreshable { await load() }
            } else if loadError {
                ContentUnavailableView {
                    Label("Couldn't read the listings", systemImage: "wifi.exclamationmark")
                } description: {
                    Text("Check your connection.")
                } actions: {
                    Button("Retry") { Task { await load() } }.buttonStyle(.borderedProminent)
                }
            } else {
                VStack(spacing: 10) {
                    ProgressView()
                    Text("Reading retained listings…")
                        .font(.system(.footnote, design: .monospaced)).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            rows = try await CapturedListings.read()
            loadError = false
        } catch {
            if rows == nil { loadError = true }
            NSLog("NukeCapture captured listings read failed: %@", String(describing: error))
        }
    }

    @ViewBuilder private func line(_ row: CapturedListing) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Color(.secondarySystemFill)
                .frame(width: 64, height: 48)
                .overlay {
                    CachedAsyncImage(url: NukeImage.thumb(row.vehicle?.primary_image_url, width: 200)) { i in
                        i.resizable().scaledToFill()
                    } placeholder: { Image(systemName: "car.side").foregroundStyle(.secondary) }
                }
                .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 3) {
                Text(row.headline).font(.subheadline.weight(.semibold)).lineLimit(2)
                HStack(spacing: 8) {
                    // The web's "Recorded amount" column: a bare number and "currency unrecorded";
                    // the reader retains no currency, so the phone asserts none (CapturedListings.tsx).
                    if let p = row.current_price, p.isFinite {
                        Text(Int(p.rounded()).formatted())
                            .font(.system(.footnote, design: .monospaced).weight(.semibold)).monospacedDigit()
                        Text("recorded amount · currency unrecorded").font(.caption2).foregroundStyle(.secondary)
                    } else {
                        Text("amount unrecorded").font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    Text(CapturedListings.sourceName(row.source_platform).uppercased())
                        .font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
                }
                Text(ProfileClock.day(row.clock).map { (row.source_observed_at != nil ? "seen " : "captured ") + $0 } ?? "clock missing")
                    .font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
    }
}
