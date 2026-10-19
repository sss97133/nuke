// ProviderMatchesView.swift — "Choose who does it": providers matched to a job, as cards and on a map.
//
// Reachable from the job (ProviderMatchesEntry, until someone is accepted) and from Job posted. Cards follow the
// reader's order (rank by passed checks, ties shared). Each shows why they match per request, their service-area
// band and availability (self-claimed Signs), standing from provider_profile_read with its basis, and any offer
// they made with the server's Accept offer step. The map draws service areas as city-level circles and the job's
// city; the readers give no coordinates for people, so nobody is pinned. Nothing here contacts anyone.

import SwiftUI
import MapKit

/// The job screen's one entry: shown to the customer or shop owner while nobody is accepted.
struct ProviderMatchesEntry: View {
    let workOrderId: String
    let offers: JobLoad<WorkOrderOffers>
    var onChanged: (() -> Void)? = nil

    var body: some View {
        if case .loaded(let o) = offers, ProviderMatchesGate.shows(o) {
            Section {
                NavigationLink {
                    ProviderMatchesView(workOrderId: workOrderId, onChanged: onChanged)
                } label: {
                    Label("Choose who does it", systemImage: "person.2.wave.2").bold()
                }
            } footer: {
                Text("Providers on Nuke matched to this job's requests, with where they say they work. Nobody is booked until you accept an offer.")
            }
            .id("job-provider-matches")
        }
    }
}

struct ProviderMatchesView: View {
    let workOrderId: String
    var onChanged: (() -> Void)? = nil

    @State private var matches: JobLoad<ProviderMatches> = .loading
    @State private var offers: JobLoad<WorkOrderOffers> = .loading
    @State private var faces: [String: JobLoad<ProviderMatchFace>] = [:]

    var body: some View {
        ProviderMatchesContent(matches: matches, offers: offers, faces: faces,
                               loadFace: { id in await loadFace(id) },
                               onChanged: { Task { await load() }; onChanged?() })
            .task(id: workOrderId) { await load() }
            .refreshable { await load() }
    }

    private func load() async {
        async let m = ProviderMatchReaders.matches(workOrderId: workOrderId)
        async let o = OfferReaders.offers(workOrderId: workOrderId)
        let loaded = await (m, o)
        matches = loaded.0
        offers = loaded.1
    }

    private func loadFace(_ profileId: String) async {
        guard faces[profileId] == nil else { return }
        faces[profileId] = .loading
        faces[profileId] = await ProviderMatchReaders.face(userId: profileId)
    }
}

/// The render, separated from the reads so fixtures drive it directly.
struct ProviderMatchesContent: View {
    let matches: JobLoad<ProviderMatches>
    var offers: JobLoad<WorkOrderOffers> = .loading
    var faces: [String: JobLoad<ProviderMatchFace>] = [:]
    var loadFace: ((String) async -> Void)? = nil
    var onChanged: (() -> Void)? = nil

    @State private var filters: Set<ProviderMatchFilter> = []
    @State private var selected: String?
    @State private var accepting: AcceptBox?

    private struct AcceptBox: Identifiable { let action: JobAction; let offer: JobOffer; let title: String; var id: String { offer.offerId } }

    private var offersRead: WorkOrderOffers? { if case .loaded(let o) = offers { return o } else { return nil } }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                switch matches {
                case .loading:
                    Section {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("Finding providers…").font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                case .refused(let refusal):
                    Section { JobRefusalRow(refusal: refusal) }
                case .loaded(let read):
                    summary(read)
                    ProviderAreaMap(read: read, selected: $selected) { id in
                        withAnimation { proxy.scrollTo(id, anchor: .top) }
                    }
                    if !read.providers.isEmpty { filterSection(read) }
                    let shown = ProviderMatchFilter.apply(filters, to: read.providers)
                    ForEach(shown) { p in
                        ProviderMatchCard(match: p, face: p.profileId.flatMap { faces[$0] },
                                          offers: offersRead.map { ProviderMatchOffers.offers(for: p, in: $0) } ?? [],
                                          offersRead: offersRead, selected: selected == p.id,
                                          onAccept: { a, o, t in accepting = AcceptBox(action: a, offer: o, title: t) })
                            .id(p.id)
                            .task(id: p.profileId) { if let id = p.profileId { await loadFace?(id) } }
                    }
                    if shown.isEmpty, !filters.isEmpty {
                        Section {
                            Text("No provider returned passes \(filters.map(\.title).sorted().joined(separator: ", ")) on every request.")
                                .font(.footnote).foregroundStyle(.secondary)
                            Button("Clear filters") { filters = [] }
                        }
                    }
                    otherOffers(read)
                }
            }
        }
        .navigationTitle("Choose who does it")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $accepting) { box in
            AcceptOfferSheet(action: box.action, offer: box.offer, requirementTitle: box.title) { onChanged?() }
        }
    }

    // MARK: Summary and empty states

    @ViewBuilder private func summary(_ read: ProviderMatches) -> some View {
        Section {
            if let t = read.displayTitle ?? read.vehicleLabel?.text {
                RootedValueView(label: "Job", value: t, status: .attributed)
            }
            RootedValueView(label: "Job area", value: read.jobPlace ?? "Not public",
                            status: read.jobPlace == nil ? .recorded : .attributed,
                            decay: read.jobArea?.basis)
            RootedValueView(label: "Needed", value: OfferCopy.window(read.jobWindow?.from, read.jobWindow?.until) ?? "No date stated",
                            status: read.jobWindow?.basis == "not_stated" ? .recorded : .attributed,
                            decay: read.jobWindow?.basis.map(JobCopy.sentence))
            if let empty = ProviderMatchCopy.empty(read) {
                Label(empty, systemImage: "person.crop.circle.badge.questionmark").font(.footnote).foregroundStyle(.secondary)
            }
            if read.unreadableProviders > 0 {
                Text("\(read.unreadableProviders) provider row\(read.unreadableProviders == 1 ? "" : "s") need a newer version of the app.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if case .refused(let r) = offers {
                Text("Offers couldn't be read: \(r.text)").font(.caption).foregroundStyle(.secondary)
            }
        } header: {
            Text(ProviderMatchCopy.coverage(read))
        } footer: {
            Text(ProviderMatchCopy.screenNote)
        }
    }

    @ViewBuilder private func filterSection(_ read: ProviderMatches) -> some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(ProviderMatchFilter.available(read)) { f in
                        let on = filters.contains(f)
                        let n = read.providers.filter(f.admits).count
                        Button {
                            if on { filters.remove(f) } else { filters.insert(f) }
                        } label: {
                            Text("\(f.title) · \(n)")
                                .font(.caption.weight(on ? .semibold : .regular))
                                .padding(.horizontal, 10).padding(.vertical, 5)
                                .background(Capsule().fill(on ? Color.accentColor.opacity(0.2) : Color.secondary.opacity(0.12)))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        } header: {
            Text("Show only providers who pass")
        } footer: {
            Text("A check counts when it passes on every request. Showing \(ProviderMatchFilter.apply(filters, to: read.providers).count) of \(read.providers.count).")
        }
    }

    /// Offers no card accounts for (an unnamed party, a shop, a provider not returned): still acceptable here.
    @ViewBuilder private func otherOffers(_ read: ProviderMatches) -> some View {
        if let o = offersRead {
            let rest = ProviderMatchOffers.unmatched(read.providers, in: o)
            if !rest.isEmpty {
                Section("Other offers on this job") {
                    ForEach(rest) { pair in
                        ProviderOfferRow(request: pair.request, offer: pair.offer, offersRead: o, showWho: true, onAccept: { a, off, t in
                            accepting = AcceptBox(action: a, offer: off, title: t)
                        })
                    }
                }
            }
        }
    }
}

// MARK: - Card

struct ProviderMatchCard: View {
    let match: ProviderMatch
    let face: JobLoad<ProviderMatchFace>?
    let offers: [ProviderOfferPair]
    let offersRead: WorkOrderOffers?
    var selected = false
    var onAccept: (JobAction, JobOffer, String) -> Void = { _, _, _ in }

    private var loadedFace: ProviderMatchFace? { if case .loaded(let f)? = face { return f } else { return nil } }

    var body: some View {
        Section {
            header
            let link = ProviderMatchCopy.link(match.linkState)
            RootedValueView(label: "Technician link", value: link.text, status: link.status)
            area
            availability
            skills
            standing
            ForEach(match.requirements) { req in
                DisclosureGroup {
                    ForEach(req.inputs) { m in ProviderMatchInputRow(input: m) }
                } label: {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(req.title).font(.footnote).lineLimit(2)
                        Text("\(req.passed) of \(req.inputs.count) checks pass").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if offers.isEmpty {
                Text("No offer from them yet.").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(offers) { pair in
                if let o = offersRead {
                    ProviderOfferRow(request: pair.request, offer: pair.offer, offersRead: o, showWho: false, onAccept: onAccept)
                }
            }
        }
        .listRowBackground(selected ? Color.accentColor.opacity(0.08) : nil)
    }

    @ViewBuilder private var header: some View {
        let row = HStack(spacing: 10) {
            ProviderMonogram(name: match.provider?.handle, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(match.name).font(.headline)
                if let because = ProviderMatchCopy.listedBecause(match.listedBecause) {
                    Text(because).font(.caption).foregroundStyle(.secondary)
                }
                Text(ProviderMatchCopy.tally(match)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text("#\(match.rank)").font(.system(.footnote, design: .monospaced)).foregroundStyle(.secondary)
        }
        if let id = match.profileId {
            NavigationLink { ProfileView(userId: id, isOwn: false) } label: { row }
        } else {
            row
        }
    }

    @ViewBuilder private var area: some View {
        if let band = match.serviceArea ?? loadedFace?.serviceArea {
            RootedValueView(label: "Service area", value: ProviderMatchCopy.band(band), status: .attributed, decay: "self-claimed")
        } else if let place = loadedFace?.publicPlace {
            RootedValueView(label: "Service area", value: "Not stated", status: .recorded, decay: "public profile says \(place)")
        } else {
            RootedValueView(label: "Service area", value: "Not stated", status: .recorded)
        }
    }

    @ViewBuilder private var availability: some View {
        let first = JobCopy.day(match.firstAvailableDay).map { "free from \($0) · self-claimed" }
        if let f = loadedFace {
            RootedValueView(label: "Availability", value: ProviderMatchCopy.availability(f.availability),
                            status: f.availability?.declared == true ? .attributed : .recorded,
                            decay: first ?? (f.availability?.declared == true ? "self-claimed" : nil))
        } else if let first {
            RootedValueView(label: "Availability", value: "Stated", status: .attributed, decay: first)
        }
    }

    @ViewBuilder private var skills: some View {
        let shown = match.evidencedSkills.isEmpty ? (loadedFace?.evidencedSkills ?? []) : match.evidencedSkills
        if !shown.isEmpty {
            RootedValueView(label: match.evidencedSkills.isEmpty ? "Shown in their work" : "Their work shows, for this job",
                            value: shown.map(ProviderMatchCopy.skill).joined(separator: ", "), status: .attributed,
                            decay: match.skillCautions.isEmpty ? "evidence-derived" : "evidence-derived; some evidence against")
        }
        if !match.statedSkills.isEmpty {
            RootedValueView(label: "They say they do", value: match.statedSkills.map(ProviderMatchCopy.skill).joined(separator: ", "),
                            status: .pending, decay: "self-claim, not evidenced")
        }
    }

    @ViewBuilder private var standing: some View {
        switch face {
        case nil:
            if match.profileId == nil {
                Text("No public profile, so standing isn't shown.").font(.caption).foregroundStyle(.secondary)
            }
        case .loading?:
            Text("Loading standing…").font(.caption).foregroundStyle(.secondary)
        case .refused(let r)?:
            Text("Standing couldn't be read: \(r.text)").font(.caption).foregroundStyle(.secondary)
        case .loaded(let f)?:
            if let n = f.jobs {
                RootedValueView(label: "Jobs on Nuke", value: JobCopy.count(n), status: .attributed,
                                decay: "as shop owner or evidenced performer; not client acceptance")
            }
            if let n = f.signedWorkDays {
                RootedValueView(label: "Signed work days", value: JobCopy.count(n), status: .attributed,
                                decay: "self-confirmed from photos; not client acceptance")
            }
            if let n = f.vouches {
                RootedValueView(label: "Vouched for by", value: JobCopy.count(n), status: .attributed, decay: "standing vouches; not skill evidence")
            }
            if !f.shops.isEmpty {
                RootedValueView(label: "Shops", value: f.shops.prefix(3).map { [$0.name, $0.place].compactMap { $0 }.joined(separator: " · ") }
                                    .joined(separator: "; "),
                                status: .attributed, decay: f.shops.count > 3 ? "\(f.shops.count) active shops" : "active membership or ownership")
            }
        }
    }
}

struct ProviderMatchInputRow: View {
    let input: ProviderMatchInput

    var body: some View {
        let s = OfferCopy.symbol(input.result)
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: s.name).foregroundStyle(s.tint == "green" ? Color.green : Color.secondary).font(.caption)
            VStack(alignment: .leading, spacing: 1) {
                Text("\(OfferCopy.input(input.input)) — \(ProviderMatchCopy.reason(input))").font(.caption)
                if ProviderMatchCopy.isSelfClaim(input) {
                    Text("self-claimed").font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
                }
                if let next = OfferCopy.next(input.next), input.next == "plan_b_supplier_needed" {
                    Text(next).font(.caption2).foregroundStyle(.secondary)
                }
                if JobDebug.showCodes, let r = input.reason {
                    Text(r).font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
                }
            }
        }
    }
}

/// One offer as work_order_offers_read states it, with Accept offer only when the server's action names it.
struct ProviderOfferRow: View {
    let request: RequirementOffers
    let offer: JobOffer
    let offersRead: WorkOrderOffers
    var showWho = false
    var onAccept: (JobAction, JobOffer, String) -> Void

    var body: some View {
        let title = JobOffersSection.title(request)
        VStack(alignment: .leading, spacing: 4) {
            RootedValueView(label: showWho ? "Offer from \(offer.who)" : "Offered on", value: title,
                            status: offer.acceptanceState == "accepted" ? .proven : .attributed, decay: OfferCopy.rung(offer.offerRung))
            ForEach(offer.lines) { line in
                RootedValueView(label: JobCopy.lineLabel(line), value: JobCopy.linePrice(line), status: line.amount == nil ? .recorded : .attributed)
            }
            if let w = OfferCopy.window(offer.availableFrom, offer.availableUntil) {
                RootedValueView(label: "Available", value: w, status: .attributed)
            }
            RootedValueView(label: "Status", value: OfferCopy.acceptance(offer.acceptanceState),
                            status: offer.acceptanceState == "accepted" ? .proven : (offer.acceptanceState == "withheld" ? .conflicting : .pending))
            if let a = offersRead.acceptAction(for: offer) {
                Button("Accept offer") { onAccept(a, offer, title) }
                    .buttonStyle(.borderedProminent).controlSize(.small)
            }
        }
    }
}

/// A letter in a circle: the readers carry no profile photo for providers.
struct ProviderMonogram: View {
    let name: String?
    var size: CGFloat = 32

    var body: some View {
        ZStack {
            Circle().fill(Color.accentColor.opacity(0.15))
            if let c = name?.first {
                Text(String(c).uppercased()).font(.system(size: size * 0.45, weight: .semibold)).foregroundStyle(Color.accentColor)
            } else {
                Image(systemName: "person.fill.questionmark").font(.system(size: size * 0.4)).foregroundStyle(.secondary)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

// MARK: - Map (city-level only)

struct ProviderAreaMap: View {
    let read: ProviderMatches
    @Binding var selected: String?
    var onSelect: (String) -> Void = { _ in }

    @State private var centers: [String: CLLocationCoordinate2D] = [:]
    @State private var unplaced: Set<String> = []
    @State private var camera: MapCameraPosition = .automatic

    private struct Area: Identifiable { let id: String; let name: String; let band: ServiceAreaBand }

    private var bands: [Area] {
        read.providers.compactMap { p in p.serviceArea.map { Area(id: p.id, name: p.name, band: $0) } }
    }

    /// Distinct "City, ST" strings to place: every band, and the job's city when it is public.
    private var places: [String] {
        var out: [String] = []
        for b in bands where !out.contains(b.band.place) { out.append(b.band.place) }
        if let job = ProviderAreaMap.jobPlace(read), !out.contains(job) { out.append(job) }
        return out
    }

    static func jobPlace(_ read: ProviderMatches) -> String? {
        guard let city = read.jobArea?.city, !city.isEmpty, let state = read.jobArea?.state, !state.isEmpty else { return nil }
        return "\(city), \(state)"
    }

    var body: some View {
        Section {
            if places.isEmpty {
                Text("Nothing to put on the map: no provider shown states a service area, and the job's city isn't public.")
                    .font(.footnote).foregroundStyle(.secondary)
            } else {
                Map(position: $camera) {
                    if let job = ProviderAreaMap.jobPlace(read), let c = centers[job] {
                        Annotation("This job · \(job)", coordinate: c, anchor: .center) {
                            Image(systemName: "car.circle.fill").font(.title2).foregroundStyle(.white, Color.orange)
                        }
                    }
                    ForEach(bands) { item in
                        if let c = centers[item.band.place] {
                            let on = selected == item.id
                            MapCircle(center: c, radius: CLLocationDistance(item.band.radiusMiles) * 1609.344)
                                .foregroundStyle(Color.accentColor.opacity(on ? 0.25 : 0.1))
                                .stroke(Color.accentColor, style: StrokeStyle(lineWidth: on ? 2 : 1, dash: item.band.mobile ? [5, 3] : []))
                            Annotation("\(item.name)'s area", coordinate: c, anchor: .center) {
                                Button {
                                    selected = item.id
                                    onSelect(item.id)
                                } label: {
                                    ProviderMonogram(name: item.name.hasPrefix("@") ? String(item.name.dropFirst()) : nil, size: on ? 30 : 24)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .mapStyle(.standard(pointsOfInterest: .excludingAll))
                .frame(height: 260)
                .listRowInsets(EdgeInsets())
                if !unplaced.isEmpty {
                    Text("Apple Maps couldn't place \(unplaced.sorted().joined(separator: "; ")).").font(.caption).foregroundStyle(.secondary)
                }
            }
        } header: {
            Text(ProviderMatchCopy.mapCoverage(read))
        } footer: {
            Text(ProviderMatchCopy.mapNote)
        }
        .task(id: places) { await place() }
    }

    /// Geocodes each city once, one request at a time (at most 26: 25 providers and the job).
    private func place() async {
        for p in places where centers[p] == nil && !unplaced.contains(p) {
            let request = MKGeocodingRequest(addressString: "\(p), United States")
            if let items = try? await request?.mapItems, let c = items.first?.location.coordinate {
                centers[p] = c
            } else {
                unplaced.insert(p)
            }
        }
        camera = .automatic
    }
}
