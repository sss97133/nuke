// JobProviderPlaceCard.swift — the top of a job: who is doing it, where, and how far along it is.
//
// Renders work_order_provider_place_read (JobProviderPlace.swift) the way a delivery app's order screen
// reads: the shop card, a map, Directions and Call, the people on the job and a step tracker. Every element
// is gated by what the server sent:
//   - The map drops a pin only on a storefront's recorded location. A city (a shop typed as a collection or
//     a person, or a provider's self-stated band) is a translucent circle around the city, labelled
//     approximate; the city name is placed by Apple's search, never a stored coordinate for a person.
//   - Directions and Call appear only when the server marked a storefront address and public phone.
//   - Tracker steps take their glyph from the trust ladder: a Sign is proven, a record attributed, a bare
//     status dim; messages that say a step happened are counted under it and never fill it.

@preconcurrency import MapKit
import SwiftUI

struct JobProviderPlaceSection: View {
    let read: JobLoad<JobProviderPlace>

    var body: some View {
        switch read {
        case .loading:
            Section {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Loading who and where…").font(.footnote).foregroundStyle(.secondary)
                }
            }
        case .refused(let refusal):
            Section { JobRefusalRow(refusal: refusal) } header: { Text("Who and where") }
        case .loaded(let r):
            JobProviderPlaceCard(read: r)
        }
    }
}

struct JobProviderPlaceCard: View {
    let read: JobProviderPlace
    @State private var selectedStep: String?
    @Environment(\.openURL) private var openURL

    var body: some View {
        Section {
            shopHeader
            JobPlaceMap(read: read)
                .frame(height: 170)
                .listRowInsets(EdgeInsets())
            actionButtons
            JobProgressTracker(steps: read.steps, current: read.currentStep, selected: $selectedStep)
                .padding(.vertical, 6)
            if let step = read.steps.first(where: { $0.key == (selectedStep ?? read.currentStep) }) {
                stepDetail(step)
            }
        } header: {
            Text("Who and where")
        } footer: {
            Text([JobCopy.updated(read.asOf), "Places and hours as written on the business record; service areas are self-stated."]
                .compactMap { $0 }.joined(separator: " · "))
        }
        if !read.acceptedProviders.isEmpty || !read.recordedPeople.isEmpty {
            Section {
                ForEach(read.acceptedProviders + read.recordedPeople) { personRow($0) }
            } header: {
                Text("People on this job")
            } footer: {
                Text("Accepted through Nuke means the customer signed for them. A recorded assignment is a row on the work order, not a Sign.")
            }
        }
        Section {
            RootedValueView(label: "Where the work happens", value: ProviderPlaceCopy.workSite(read),
                            status: read.workSiteState == "facility_reserved" ? .proven : .recorded,
                            decay: read.workSiteState == "facility_reserved" ? "confirmed booking" : nil)
            if let v = read.vehiclePlace?.cityLine {
                RootedValueView(label: "Vehicle is in", value: v, status: .attributed, decay: "city on the vehicle record")
            }
            if read.shop.hoursRecorded {
                DisclosureGroup("Hours as recorded") {
                    ForEach(read.shop.hours, id: \.key) { h in
                        RootedValueView(label: JobWords.humanize(h.key).capitalized, value: h.value, status: .attributed)
                    }
                    Text("As written on the business record; not a live open or closed status.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                .font(.subheadline)
            }
        }
    }

    // MARK: Shop

    @ViewBuilder private var shopHeader: some View {
        let row = HStack(spacing: 12) {
            logo
            VStack(alignment: .leading, spacing: 2) {
                Text(read.shop.name ?? shopFallback).font(.headline).lineLimit(2)
                Text([ProviderPlaceCopy.kind(read.shop.entityType), ProviderPlaceCopy.placeLine(read.shop.place)]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                HStack(spacing: 4) {
                    Image(systemName: read.shop.rating?.state == "stored" ? "star.fill" : "star")
                        .font(.caption2).foregroundStyle(.secondary)
                    Text(ProviderPlaceCopy.rating(read.shop.rating)).font(.caption).foregroundStyle(.secondary)
                    Text("· Work order organization").font(.caption).foregroundStyle(.tertiary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        if let id = read.shop.organizationId {
            NavigationLink { OrganizationView(orgId: id, fallbackName: read.shop.name) } label: { row }
        } else {
            row
        }
    }

    private var shopFallback: String {
        switch read.shop.state {
        case "not_public": return "Organization not public"
        case "none": return "No organization on this job"
        default: return "Organization"
        }
    }

    @ViewBuilder private var logo: some View {
        let initial = String((read.shop.name ?? "?").prefix(1)).uppercased()
        let fallback = Circle().fill(Color(.secondarySystemFill))
            .overlay(Text(initial).font(.headline).foregroundStyle(.secondary))
        Group {
            if let url = read.shop.logoUrl {
                CachedAsyncImage(url: NukeImage.thumb(url, width: 120), maxPixel: 120) { img in
                    img.resizable().scaledToFit()
                } placeholder: { fallback }
            } else {
                fallback
            }
        }
        .frame(width: 48, height: 48)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder private var actionButtons: some View {
        let place = read.workSiteState == "facility_reserved" ? (read.workSitePlace ?? read.shop.place) : read.shop.place
        let directions = ProviderPlaceCopy.directionsURL(place, name: read.workSiteOrganization ?? read.shop.name)
        let phone = ProviderPlaceCopy.phoneURL(read.shop.place)
        if directions != nil || phone != nil {
            HStack(spacing: 12) {
                if let directions {
                    Button { openURL(directions) } label: {
                        Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                }
                if let phone {
                    Button { openURL(phone) } label: {
                        Label("Call the shop", systemImage: "phone").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding(.vertical, 2)
        }
    }

    // MARK: Tracker detail

    @ViewBuilder private func stepDetail(_ step: JobProviderPlace.Step) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            RootedValueView(label: step.label, value: ProviderPlaceCopy.stepState(step),
                            status: ProviderPlaceCopy.rung(step) ?? .recorded,
                            decay: JobClock.text(step.clock).map { clock in [step.clockBasis, clock].compactMap { $0 }.joined(separator: " · ") })
            if let basis = step.basis {
                Text(basis.prefix(1).uppercased() + basis.dropFirst()).font(.caption).foregroundStyle(.secondary)
            }
            if step.customerAccepted {
                Label("The customer accepted the finished work", systemImage: "checkmark.seal.fill")
                    .font(.caption).foregroundStyle(.green)
            }
            if let reports = ProviderPlaceCopy.reports(step.reports) {
                Label(reports, systemImage: "text.bubble").font(.caption).foregroundStyle(.secondary)
            }
            if step.conflicting {
                Label("Records disagree at this step", systemImage: "exclamationmark.2").font(.caption).foregroundStyle(.orange)
            }
        }
    }

    // MARK: People

    @ViewBuilder private func personRow(_ p: JobProviderPlace.Person) -> some View {
        let row = HStack(alignment: .top, spacing: 10) {
            Circle().fill(Color(.secondarySystemFill)).frame(width: 34, height: 34)
                .overlay(Image(systemName: p.signed ? "person.crop.circle.badge.checkmark" : "person.crop.circle")
                    .foregroundStyle(p.signed ? .green : .secondary))
            VStack(alignment: .leading, spacing: 2) {
                Text(p.person.text).font(.subheadline.weight(.semibold))
                Text(ProviderPlaceCopy.role(p)).font(.caption).foregroundStyle(.secondary)
                if let status = ProviderPlaceCopy.statuses(p.statuses) {
                    Text("Marked: \(status)").font(.caption2).foregroundStyle(.tertiary)
                }
                if let band = ProviderPlaceCopy.band(p.serviceArea) {
                    Label(band, systemImage: "mappin.circle").font(.caption).foregroundStyle(.secondary)
                }
                if !p.availabilityDays.isEmpty {
                    Text("Usually available: " + p.availabilityDays.joined(separator: ", ")).font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
        if let id = p.person.profileId {
            NavigationLink { ProfileView(userId: id, isOwn: false) } label: { row }
        } else {
            row
        }
    }
}

/// One step per stage of the job path the server mapped, left to right; tap a step for its detail.
struct JobProgressTracker: View {
    let steps: [JobProviderPlace.Step]
    let current: String?
    @Binding var selected: String?

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(steps.enumerated()), id: \.element.id) { i, step in
                Button { selected = step.key } label: {
                    VStack(spacing: 4) {
                        HStack(spacing: 0) {
                            connector(visible: i > 0, filled: Self.filled(step))
                            Image(systemName: Self.symbol(step))
                                .font(.body)
                                .foregroundStyle(Self.color(step))
                                .frame(width: 22, height: 22)
                            connector(visible: i < steps.count - 1, filled: i + 1 < steps.count && Self.filled(steps[i + 1]))
                        }
                        Text(step.label)
                            .font(.system(size: 10, weight: step.key == current ? .bold : .regular))
                            .foregroundStyle(step.key == (selected ?? current) ? .primary : .secondary)
                            .lineLimit(1).minimumScaleFactor(0.7)
                        if step.reports > 0 {
                            Label("\(step.reports)", systemImage: "text.bubble")
                                .font(.system(size: 9)).foregroundStyle(.secondary).labelStyle(.titleAndIcon)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(step.label): \(ProviderPlaceCopy.stepState(step))"
                    + (step.reports > 0 ? ", \(step.reports) messages say so, not signed" : ""))
            }
        }
    }

    private func connector(visible: Bool, filled: Bool) -> some View {
        Rectangle()
            .fill(visible ? (filled ? Color.primary.opacity(0.6) : Color(.tertiaryLabel).opacity(0.5)) : .clear)
            .frame(height: 2)
            .frame(maxWidth: .infinity)
    }

    static func filled(_ s: JobProviderPlace.Step) -> Bool {
        if case .reached = s.state { return true }
        return false
    }

    static func symbol(_ s: JobProviderPlace.Step) -> String {
        if s.conflicting { return "exclamationmark.circle.fill" }
        switch s.state {
        case .reached: return s.evidence == "sign" ? "checkmark.seal.fill" : "checkmark.circle.fill"
        case .partial: return "circle.lefthalf.filled"
        case .statusOnly: return "circle.fill"
        case .withheld: return "lock.circle"
        case .notYet: return "circle"
        case .unknown: return "circle.dotted"
        }
    }

    static func color(_ s: JobProviderPlace.Step) -> Color {
        if s.conflicting { return .orange }
        switch s.state {
        case .reached: return s.evidence == "sign" ? .green : .primary
        case .partial: return .primary
        default: return Color(.tertiaryLabel)
        }
    }
}

/// A pin only on a storefront's recorded location; otherwise approximate circles around named cities.
struct JobPlaceMap: View {
    let read: JobProviderPlace

    struct Area: Equatable { let city: String; let radiusMeters: Double; let label: String }
    @State private var cityCenters: [String: CLLocationCoordinate2D] = [:]
    @State private var position: MapCameraPosition = .automatic

    var body: some View {
        let place = mapPlace
        ZStack(alignment: .bottomLeading) {
            Map(position: $position, interactionModes: [.pan, .zoom]) {
                if let pin = place?.pin {
                    Marker(read.workSiteOrganization ?? read.shop.name ?? "Business", systemImage: "wrench.and.screwdriver",
                           coordinate: CLLocationCoordinate2D(latitude: pin.latitude, longitude: pin.longitude))
                }
                ForEach(areas, id: \.city) { c in
                    if let center = cityCenters[c.city] {
                        MapCircle(center: center, radius: c.radiusMeters)
                            .stroke(Color.accentColor.opacity(0.5), lineWidth: 1)
                            .foregroundStyle(Color.accentColor.opacity(0.15))
                    }
                }
            }
            .mapStyle(.standard(pointsOfInterest: .excludingAll))
            Text(caption)
                .font(.caption2)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(.thinMaterial, in: Capsule())
                .padding(8)
        }
        .task(id: areas.map(\.city).joined(separator: "|")) { await locateCities() }
    }

    private var mapPlace: JobProviderPlace.Place? {
        read.workSiteState == "facility_reserved" ? (read.workSitePlace ?? read.shop.place) : read.shop.place
    }

    var areas: [Area] { Self.areas(for: read) }

    /// The shop's city when it has no pin, then each declared provider band.
    static func areas(for r: JobProviderPlace) -> [Area] {
        var out: [Area] = []
        let place = r.workSiteState == "facility_reserved" ? (r.workSitePlace ?? r.shop.place) : r.shop.place
        if place?.pin == nil, let city = place?.cityLine, place?.city != nil {
            out.append(Area(city: city, radiusMeters: 8_000, label: "shop city"))
        }
        for p in r.acceptedProviders + r.recordedPeople {
            guard let b = p.serviceArea, b.state == "declared", let c = b.city, let s = b.stateCode, let miles = b.radiusMiles else { continue }
            let key = "\(c), \(s)"
            if !out.contains(where: { $0.city == key }) {
                out.append(Area(city: key, radiusMeters: Double(miles) * 1_609.34, label: "service area"))
            }
        }
        return out
    }

    private var caption: String {
        if mapPlace?.pin != nil { return ProviderPlaceCopy.precision(mapPlace) }
        if areas.isEmpty { return "No place on the record" }
        return "City-level · approximate"
    }

    private func locateCities() async {
        for c in areas where cityCenters[c.city] == nil {
            let request = MKLocalSearch.Request()
            request.naturalLanguageQuery = c.city
            request.resultTypes = .address
            guard let response = try? await MKLocalSearch(request: request).start() else { continue }
            cityCenters[c.city] = response.boundingRegion.center
        }
    }
}

extension ProviderPlaceCopy {
    /// The tracker step on the trust ladder: a Sign proven, a record attributed, partial pending, a bare status
    /// recorded (dim); nothing for a step not reached or withheld.
    static func rung(_ s: JobProviderPlace.Step) -> RootStatus? {
        if s.conflicting { return .conflicting }
        switch s.state {
        case .reached: return s.evidence == "sign" ? .proven : .attributed
        case .partial: return .pending
        case .statusOnly: return .recorded
        case .notYet, .withheld, .unknown: return nil
        }
    }
}
