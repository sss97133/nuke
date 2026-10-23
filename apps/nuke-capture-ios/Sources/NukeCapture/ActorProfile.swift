// ActorProfile.swift — an actor (an organization now, a person next) as a document of measures.
//
// The owner, 2026-10-14 (case ledger 13.11): an endpoint that shows a name and a list of cars means
// nothing; what has meaning is performance and relativity, the measure. `actor_profile_read(kind, id)`
// returns one kit document: the subject, then sections the kit already defines (`measures` with their
// stack, coverage and items; a `table`). Each measure carries its method, its population and, above
// the rank floor, its percentile among a stated peer cohort. The phone renders exactly that: a number
// never appears without the population it was counted on, and a rank never appears below the floor.
// Every row is a door: a role opens the vehicles behind it, a vehicle opens its record.

import SwiftUI
import Supabase

/// Who the document is about, as the read states it.
struct ActorSubject: Decodable, Hashable {
    let kind: String
    let id: String
    let name: String?
    let type: String?
    let place: String?
    let zip: String?
    /// An identity's handle on its platform (identity kind only).
    let handle: String?

    var typeLabel: String? {
        guard let type, !type.isEmpty else { return nil }
        if kind == "identity" {
            switch type {
            case "bat": return "Bring a Trailer member" + (handle.map { " @\($0)" } ?? "")
            case "cars_and_bids", "carsandbids": return "Cars & Bids member"
            case "pcarmarket": return "PCARMARKET member"
            default: return type.replacingOccurrences(of: "_", with: " ").capitalized + " member"
            }
        }
        switch type {
        case "dealer", "dealership": return "Dealer"
        case "auction_house": return "Auction house"
        case "collection": return "Collection"
        default: return type.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}

/// The read's document: the subject, the viewer, the clock, the sections (the kit's shapes).
struct ActorRead: Decodable {
    let subject: ActorSubject
    let viewer: ProfileViewer
    let read_at: String
    let sections: [ProfileSection]

    static func fetch(kind: String, id: String) async throws -> ActorRead? {
        struct P: Encodable { let p_kind: String; let p_id: String }
        let res = try await SupabaseService.client.rpc("actor_profile_read", params: P(p_kind: kind, p_id: id)).execute()
        // The read returns SQL null for a private or unknown actor, or a kind it does not read yet.
        if let text = String(data: res.data, encoding: .utf8), text.trimmingCharacters(in: .whitespacesAndNewlines) == "null" { return nil }
        return try JSONDecoder().decode(ActorRead.self, from: res.data)
    }
}

/// A route into an actor, for search rows and a vehicle's seller or owner link.
struct ActorRoute: Hashable {
    let kind: String
    let id: String
    let name: String?
}

extension Measure {
    /// The value as the measure's unit states it: 86.1%, 2.0× market, 72 listings, 1 vehicle.
    var valueText: String {
        let whole = value == value.rounded() && abs(value) < 1e15
        let num = whole ? value.formatted(.number.precision(.fractionLength(0))) : value.formatted(.number.precision(.fractionLength(1)))
        switch unit {
        case "%": return num + "%"
        case "× market": return num + "× market"
        case "vehicles": return num + (value == 1 ? " vehicle" : " vehicles")
        case "": return num
        default: return num + " " + unit
        }
    }
    /// "P59 of 211": only above the rank floor, as the kit allows.
    var rankText: String? {
        guard let label = rankLabel, let rank else { return nil }
        return "\(label) of \(rank.n.formatted())"
    }
}

/// One measures section: its title, its population line, each measure with its position among peers.
struct MeasuresCard: View {
    let section: ProfileSection.Measures

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(section.title.uppercased())
                .font(.caption2.monospaced()).foregroundStyle(.secondary)
            if section.items.isEmpty {
                Text("Nothing measured yet · \(section.coverage.sentence)")
                    .font(.footnote).foregroundStyle(.secondary)
            } else {
                ForEach(Array(section.items.enumerated()), id: \.offset) { _, m in
                    MeasureRow(measure: m)
                    if m.label != section.items.last?.label { Divider() }
                }
                Text(section.coverage.sentence)
                    .font(.system(size: 10, design: .monospaced)).foregroundStyle(.tertiary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color(.secondarySystemBackground)))
    }
}

/// A measure: the label, the value, the peer position as a bar and a rank, the method on demand.
struct MeasureRow: View {
    let measure: Measure
    @State private var showMethod = false

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline) {
                Text(measure.label).font(.subheadline)
                Spacer(minLength: 8)
                Text(measure.valueText)
                    .font(.system(.body, design: .monospaced).weight(.semibold)).monospacedDigit()
            }
            if let rank = measure.rank, let text = measure.rankText {
                // Where the actor sits among its peers: 0 at the left, the best of them at the right.
                HStack(spacing: 8) {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color(.tertiarySystemFill)).frame(height: 4)
                            Circle().fill(Color.accentColor)
                                .frame(width: 9, height: 9)
                                .offset(x: max(0, min(geo.size.width - 9, geo.size.width * rank.p / 100 - 4.5)))
                        }
                        .frame(maxHeight: .infinity)
                    }
                    .frame(height: 10)
                    Text(text).font(.caption2.monospaced()).foregroundStyle(.secondary).fixedSize()
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(measure.label): \(text) among peers")
            }
            Text("\(measure.coverage.n.formatted()) of \(measure.coverage.of.formatted()) \(measure.coverage.grain)")
                .font(.caption2).foregroundStyle(.secondary)
            if showMethod {
                Text(measure.method).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { withAnimation(.easeOut(duration: 0.15)) { showMethod.toggle() } }
    }
}

/// The actor's endpoint: who, then the measures, then the doors to its vehicles.
struct ActorProfileView: View {
    let route: ActorRoute
    @State private var read: ActorRead?
    @State private var loaded = false
    @State private var failed = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                if let read {
                    ForEach(Array(read.sections.enumerated()), id: \.offset) { _, section in
                        switch section {
                        case .measures(let m): MeasuresCard(section: m)
                        case .table(let t): RoleTableCard(table: t, orgId: route.id)
                        default: EmptyView()
                        }
                    }
                    Text("One public projection for every viewer · read \(ProfileClock.day(read.read_at) ?? "now") · counts and ranks only, never an amount")
                        .font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
                } else if failed {
                    ContentUnavailableView {
                        Label("Couldn't read this profile", systemImage: "wifi.exclamationmark")
                    } actions: {
                        Button("Retry") { Task { await load() } }
                    }
                } else if loaded {
                    ContentUnavailableView("Not a public profile",
                                           systemImage: "person.crop.circle.badge.questionmark",
                                           description: Text("This actor is private, or its kind is not measured yet."))
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
            .padding(16)
        }
        .navigationTitle(read?.subject.name ?? route.name ?? "Profile")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: route) { await load() }
    }

    @ViewBuilder private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(read?.subject.name ?? route.name ?? "…").font(.title2.weight(.bold))
            let line = [read?.subject.typeLabel, read?.subject.place].compactMap { $0 }.joined(separator: " · ")
            if !line.isEmpty { Text(line).font(.subheadline).foregroundStyle(.secondary) }
        }
    }

    private func load() async {
        failed = false
        do {
            read = try await ActorRead.fetch(kind: route.kind, id: route.id)
        } catch {
            NSLog("NukeCapture actor read failed: %@", String(describing: error))
            failed = read == nil
        }
        loaded = true
    }
}

/// The vehicles-by-role table: each role a door to the vehicles behind it.
struct RoleTableCard: View {
    let table: ProfileSection.Table
    let orgId: String

    private static func label(_ role: String) -> String {
        switch role {
        case "owner": return "Owned"
        case "sold_by": return "Sold by them"
        case "consigner": return "Consigned"
        case "work_location": return "Worked on there"
        case "service_provider": return "Serviced"
        default: return role.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    /// A count cell as the read prints it ("2,407"), as a number; anything else counts as zero.
    static func count(_ text: String) -> Int { Int(text.filter(\.isNumber)) ?? 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(table.title.uppercased()).font(.caption2.monospaced()).foregroundStyle(.secondary)
            ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
                if row.count >= 3 {
                    let role = row[0].value.text
                    let total = Self.count(row[1].value.text) + Self.count(row[2].value.text)
                    NavigationLink {
                        ActorVehiclesView(orgId: orgId, role: role, title: Self.label(role), total: total)
                    } label: {
                        HStack {
                            Text(Self.label(role)).font(.subheadline)
                            Spacer()
                            Text("\(row[1].value.text) active · \(row[2].value.text) past")
                                .font(.caption.monospaced()).foregroundStyle(.secondary)
                            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            Text(table.coverage.sentence).font(.system(size: 10, design: .monospaced)).foregroundStyle(.tertiary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color(.secondarySystemBackground)))
    }
}

/// The public, undeleted vehicles an organization holds in one role, each a door to its record.
struct ActorVehiclesView: View {
    let orgId: String
    let role: String
    let title: String
    /// Public vehicles in this role, as the actor read counted them; the denominator for what is shown.
    var total: Int? = nil
    @State private var rows: [VehicleHeaderRow] = []
    @State private var linked = 0
    @State private var loaded = false

    /// How many links one drill-down reads, and how many of their vehicles it shows.
    static let linkCap = 500
    static let shownCap = 300

    /// What is shown of how many: the read's count is the denominator; with no count and a capped read, say so.
    static func header(shown: Int, total: Int?, linked: Int) -> String {
        if let total, total > shown {
            return "\(shown.formatted()) shown of \(total.formatted()) public vehicles · the most recently linked first"
        }
        if shown == 0 { return "No public vehicles in this role" }
        if total != nil || linked < linkCap { return "All \(shown.formatted()) public vehicles · most recently linked first" }
        return "\(shown.formatted()) shown · the most recently linked first; this role has more links than one read takes"
    }

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 3)

    var body: some View {
        ScrollView {
            Text(loaded ? Self.header(shown: rows.count, total: total, linked: linked) : "Reading…")
                .font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.vertical, 6)
            LazyVGrid(columns: columns, spacing: 2) {
                ForEach(rows) { v in
                    NavigationLink {
                        VehicleDetailView(vehicleId: v.id.uuidString.lowercased(), embedInNavigationStack: false)
                    } label: {
                        Color(.secondarySystemFill)
                            .aspectRatio(1, contentMode: .fit)
                            .overlay {
                                CachedAsyncImage(url: NukeImage.thumb(v.primary_image_url, width: 300)) { i in
                                    i.resizable().scaledToFill()
                                } placeholder: { Image(systemName: "car.side").foregroundStyle(.secondary) }
                            }
                            .overlay(alignment: .bottomLeading) {
                                Text([v.year.map(String.init), v.make, v.model].compactMap { $0 }.joined(separator: " "))
                                    .font(.caption2.weight(.semibold)).foregroundStyle(.white).lineLimit(2)
                                    .padding(4).shadow(radius: 2)
                            }
                            .clipped()
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        struct Link: Decodable { let vehicle_id: String }
        do {
            let links: [Link] = try await SupabaseService.client.from("organization_vehicles")
                .select("vehicle_id").eq("organization_id", value: orgId).eq("relationship_type", value: role)
                // When the relationship began (start_date), not when the row was ingested; undated last.
                .order("start_date", ascending: false, nullsFirst: false)
                .order("created_at", ascending: false).limit(Self.linkCap).execute().value
            linked = links.count
            var seen = Set<String>()
            let ids = links.map { $0.vehicle_id.lowercased() }.filter { seen.insert($0).inserted }.prefix(Self.shownCap)
            if !ids.isEmpty {
                let found: [VehicleHeaderRow] = try await SupabaseService.client.from("vehicles")
                    .select("id,year,make,model,trim,primary_image_url,city,state")
                    .in("id", values: Array(ids)).eq("is_public", value: true).is("deleted_at", value: nil)
                    .execute().value
                let order = Dictionary(uniqueKeysWithValues: ids.enumerated().map { ($1, $0) })
                rows = found.sorted { (order[$0.id.uuidString.lowercased()] ?? .max) < (order[$1.id.uuidString.lowercased()] ?? .max) }
            }
        } catch {
            NSLog("NukeCapture actor vehicles read failed: %@", String(describing: error))
        }
        loaded = true
    }
}

/// A vehicle's public organizations (seller, owner, consigner, shop), one row each with its roles, each a
/// door to the actor. An auction house is where the vehicle sold, not who sold it: "Sold on".
struct VehicleActorLinks: View {
    let vehicleId: String
    struct Link: Hashable { let route: ActorRoute; let line: String; var venue: Bool = false }
    @State private var links: [Link] = []

    /// A platform is where a vehicle was listed, never its seller, consigner or shop, whatever role the record
    /// gives it: the record names Bring a Trailer consigner on 93,473 vehicles and Facebook Marketplace (typed
    /// "collection") consigner on 91,870 (review 2026-10-14). Types first; a short list of platform names covers
    /// rows typed wrong until the data lane corrects them.
    static let venueTypes: Set<String> = ["auction_house", "platform", "marketplace"]
    static let venueNames: Set<String> = ["bring a trailer", "facebook marketplace", "cars & bids", "carsandbids", "ebay motors",
                                          "ebay", "craigslist", "hemmings", "pcarmarket", "collecting cars", "hagerty marketplace",
                                          "classiccars.com", "autotrader", "mecum", "mecum auctions", "barrett-jackson",
                                          "rm sotheby's", "gooding & company", "bonhams"]
    static func isVenue(type: String?, name: String?) -> Bool {
        venueTypes.contains(type ?? "") || venueNames.contains((name ?? "").trimmingCharacters(in: .whitespaces).lowercased())
    }

    static func line(roles: [String], type: String?, name: String? = nil) -> String {
        if isVenue(type: type, name: name) { return roles.contains("sold_by") ? "Sold on" : "Listed on" }
        let order: [(String, String)] = [("sold_by", "sold"), ("consigner", "consigned"), ("owner", "owned"), ("service_provider", "serviced")]
        let words = order.filter { roles.contains($0.0) }.map(\.1)
        guard !words.isEmpty else { return "Linked to" }
        let joined = words.count == 1 ? words[0] : words.dropLast().joined(separator: ", ") + " and " + words.last!
        return joined.prefix(1).uppercased() + joined.dropFirst() + " by"
    }

    var body: some View {
        if !links.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(links, id: \.self) { link in
                    if link.venue {
                        // A venue is where it was listed: stated, not a door to a dealer's measures.
                        HStack(spacing: 6) {
                            Text(link.line).font(.caption).foregroundStyle(.secondary)
                            Text(link.route.name ?? "a platform").font(.subheadline).lineLimit(1)
                            Spacer()
                        }
                    } else {
                        NavigationLink {
                            ActorProfileView(route: link.route)
                        } label: {
                            HStack(spacing: 6) {
                                Text(link.line).font(.caption).foregroundStyle(.secondary)
                                Text(link.route.name ?? "an organization").font(.subheadline.weight(.semibold)).lineLimit(1)
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14).fill(Color(.secondarySystemBackground)))
            .padding(.horizontal, 16)
        }
        Color.clear.frame(height: 0).task(id: vehicleId) { await load() }
    }

    private func load() async {
        struct Row: Decodable { let organization_id: String; let relationship_type: String }
        struct Org: Decodable { let id: String; let business_name: String?; let business_type: String? }
        struct Seller: Decodable { let bat_seller: String? }
        struct Identity: Decodable { let id: String; let handle: String }
        // The Bring a Trailer seller handle, as an identity whose measures open from here.
        var sellerLink: Link?
        if let seller: [Seller] = try? await SupabaseService.client.from("vehicles").select("bat_seller").eq("id", value: vehicleId).limit(1).execute().value,
           let handle = seller.first?.bat_seller, !handle.isEmpty {
            // The identity read counts every case variant, so any one variant's row opens the same measures.
            let spellings = handle == handle.lowercased() ? [handle] : [handle, handle.lowercased()]
            if let ids: [Identity] = try? await SupabaseService.client.from("external_identities").select("id,handle")
                   .eq("platform", value: "bat").in("handle", values: spellings).limit(2).execute().value,
               let identity = ids.first(where: { $0.handle == handle }) ?? ids.first {
                sellerLink = Link(route: ActorRoute(kind: "identity", id: identity.id, name: "@" + handle), line: "Listed on Bring a Trailer by")
            }
        }
        defer { if let sellerLink, !links.contains(sellerLink) { links.insert(sellerLink, at: 0) } }
        do {
            let rows: [Row] = try await SupabaseService.client.from("organization_vehicles")
                .select("organization_id,relationship_type").eq("vehicle_id", value: vehicleId)
                .in("relationship_type", values: ["sold_by", "owner", "consigner", "service_provider"])
                .limit(12).execute().value
            let ids = Array(Set(rows.map(\.organization_id)))
            guard !ids.isEmpty else { return }
            let orgs: [Org] = try await SupabaseService.client.from("organizations")
                .select("id,business_name,business_type").in("id", values: ids).eq("is_public", value: true).execute().value
            let byId = Dictionary(uniqueKeysWithValues: orgs.map { ($0.id, $0) })
            var roles: [String: [String]] = [:]
            for r in rows where byId[r.organization_id] != nil { roles[r.organization_id, default: []].append(r.relationship_type) }
            // Sellers and consigners first, then owners, then shops; private organizations stay out.
            // Who sold or consigned it first, then owners, then the venue it sold on, then shops.
            let rank: (Link) -> Int = { l in
                l.venue ? 2 : l.line.hasPrefix("Sold") || l.line.hasPrefix("Consigned") ? 0 : l.line.hasPrefix("Owned") ? 1 : 3
            }
            links = roles.compactMap { id, rs in
                guard let org = byId[id] else { return nil }
                return Link(route: ActorRoute(kind: "organization", id: id, name: org.business_name),
                            line: Self.line(roles: rs, type: org.business_type, name: org.business_name),
                            venue: Self.isVenue(type: org.business_type, name: org.business_name))
            }
            .sorted { (rank($0), $0.route.name ?? "") < (rank($1), $1.route.name ?? "") }
        } catch {
            NSLog("NukeCapture vehicle actor links read failed: %@", String(describing: error))
        }
    }
}
