// ExploreTuning.swift — what the person asked Browse to show, and the sheet that sets it.
//
// These are explicit filters, kept on the phone (UserDefaults). They narrow the two reads and nothing else
// changes them: the signal log and the more / less choices only order cards, never move a filter.
//   • place: a typed city or ZIP, found with CLGeocoder, plus a radius. It goes to classified_ask_board
//     (p_lat / p_lng / p_radius_mi, rounded to 0.01°). An auction lot has no location on record, so place
//     does not narrow lots, and the sheet says so.
//   • era, make or model words, and a price band are applied here to the rows already read, for both kinds.
//     A row missing the field being filtered cannot be confirmed and is left out.
// Body style is not offered: neither read carries it.

import SwiftUI
import CoreLocation

struct ExploreTuning: Codable, Equatable {
    var homeLabel: String? = nil
    var homeLat: Double? = nil
    var homeLng: Double? = nil
    var radiusMiles: Int = 100
    var eraFrom: Int? = nil
    var eraTo: Int? = nil
    /// Words that must all appear in the card's make, model or title.
    var make: String? = nil
    var priceMin: Double? = nil
    var priceMax: Double? = nil

    static let defaultsKey = "explore.tuning.v1"
    static let radiusRange = 25...500

    var hasHome: Bool {
        guard let lat = homeLat, let lng = homeLng, lat.isFinite, lng.isFinite else { return false }
        return (-90.0...90.0).contains(lat) && (-180.0...180.0).contains(lng)
    }

    private var makeWords: [String] {
        (make ?? "").lowercased().split(whereSeparator: { $0 == " " || $0 == "," }).map(String.init)
    }

    var hasEra: Bool { eraFrom != nil || eraTo != nil }
    var hasPrice: Bool { priceMin != nil || priceMax != nil }
    /// Filters applied here, to rows already read.
    var hasLocalFilters: Bool { hasEra || hasPrice || !makeWords.isEmpty }
    var isActive: Bool { hasHome || hasLocalFilters }

    /// What the classified read gets: nil, nil, nil without a place.
    var place: (lat: Double, lng: Double, radius: Int)? {
        guard hasHome, let lat = homeLat, let lng = homeLng else { return nil }
        func r(_ v: Double) -> Double { (v * 100).rounded() / 100 }
        return (r(lat), r(lng), min(max(radiusMiles, Self.radiusRange.lowerBound), Self.radiusRange.upperBound))
    }

    func matches(_ item: ExploreFeedItem) -> Bool {
        if hasEra {
            guard let y = item.year else { return false }
            if let f = eraFrom, y < f { return false }
            if let t = eraTo, y > t { return false }
        }
        if hasPrice {
            guard let a = item.amount, a > 0 else { return false }
            if let lo = priceMin, a < lo { return false }
            if let hi = priceMax, a > hi { return false }
        }
        let words = makeWords
        if !words.isEmpty {
            let hay = [item.make, item.model, item.title].compactMap { $0 }.joined(separator: " ").lowercased()
            if !words.allSatisfy({ hay.contains($0) }) { return false }
        }
        return true
    }

    func apply(_ items: [ExploreFeedItem]) -> [ExploreFeedItem] {
        hasLocalFilters ? items.filter(matches) : items
    }

    /// Names of the filters that differ, for the signal log ("place", "radius", "era", "make", "price"). Values
    /// are never logged.
    func changedFields(from old: ExploreTuning) -> [String] {
        var out: [String] = []
        if homeLat != old.homeLat || homeLng != old.homeLng { out.append("place") }
        if radiusMiles != old.radiusMiles { out.append("radius") }
        if eraFrom != old.eraFrom || eraTo != old.eraTo { out.append("era") }
        if (make ?? "") != (old.make ?? "") { out.append("make") }
        if priceMin != old.priceMin || priceMax != old.priceMax { out.append("price") }
        return out
    }

    static func load(defaults: UserDefaults = .standard) -> ExploreTuning {
        guard let data = defaults.data(forKey: defaultsKey),
              let t = try? JSONDecoder().decode(ExploreTuning.self, from: data) else { return ExploreTuning() }
        return t
    }

    func save(defaults: UserDefaults = .standard) {
        if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.defaultsKey) }
    }
}

struct ExploreTuningSheet: View {
    @State private var draft: ExploreTuning
    let onApply: (ExploreTuning) -> Void
    @State private var placeText = ""
    @State private var finding = false
    @State private var placeError: String?
    @Environment(\.dismiss) private var dismiss

    init(current: ExploreTuning, onApply: @escaping (ExploreTuning) -> Void) {
        _draft = State(initialValue: current)
        self.onApply = onApply
    }

    private var eraOn: Binding<Bool> {
        Binding(get: { draft.hasEra },
                set: { on in
                    if on { draft.eraFrom = draft.eraFrom ?? 1960; draft.eraTo = draft.eraTo ?? 1979 }
                    else { draft.eraFrom = nil; draft.eraTo = nil }
                })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if draft.hasHome, let label = draft.homeLabel {
                        HStack {
                            Label(label, systemImage: "mappin.and.ellipse")
                            Spacer()
                            Button("Clear") { draft.homeLabel = nil; draft.homeLat = nil; draft.homeLng = nil }
                                .buttonStyle(.borderless)
                        }
                    }
                    HStack {
                        TextField("City or ZIP", text: $placeText)
                            .textInputAutocapitalization(.words)
                            .submitLabel(.search)
                            .onSubmit { Task { await findPlace() } }
                        if finding { ProgressView() } else {
                            Button("Find") { Task { await findPlace() } }
                                .buttonStyle(.borderless)
                                .disabled(placeText.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                    if let placeError { Text(placeError).font(.footnote).foregroundStyle(.secondary) }
                    if draft.hasHome {
                        VStack(alignment: .leading) {
                            Text("Within \(draft.radiusMiles) miles").font(.subheadline)
                            Slider(value: Binding(get: { Double(draft.radiusMiles) },
                                                  set: { draft.radiusMiles = Int($0) }),
                                   in: Double(ExploreTuning.radiusRange.lowerBound)...Double(ExploreTuning.radiusRange.upperBound),
                                   step: 25)
                        }
                    }
                } header: {
                    Text("Home")
                } footer: {
                    Text("Narrows classified listings. Auction lots have no location on record, so they are not narrowed by place.")
                }

                Section("Era") {
                    Toggle("Limit model years", isOn: eraOn)
                    if draft.hasEra {
                        Stepper("From \(String(draft.eraFrom ?? 1960))",
                                value: Binding(get: { draft.eraFrom ?? 1960 }, set: { draft.eraFrom = $0 }), in: 1900...2026)
                        Stepper("To \(String(draft.eraTo ?? 1979))",
                                value: Binding(get: { draft.eraTo ?? 1979 }, set: { draft.eraTo = $0 }), in: 1900...2026)
                    }
                }

                Section("Make or model") {
                    TextField("e.g. Chevrolet Corvette",
                              text: Binding(get: { draft.make ?? "" },
                                            set: { draft.make = $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }))
                        .textInputAutocapitalization(.words)
                }

                Section("Price") {
                    TextField("Lowest", value: $draft.priceMin, format: .number).keyboardType(.numberPad)
                    TextField("Highest", value: $draft.priceMax, format: .number).keyboardType(.numberPad)
                }

                if draft.isActive {
                    Section {
                        Button("Reset everything", role: .destructive) { draft = ExploreTuning() }
                    }
                }
            }
            .navigationTitle("Tune Browse")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") { onApply(draft); dismiss() }
                }
            }
        }
        .presentationDetents([.large])
    }

    /// A typed name to a point, here on the phone; the label is the city and state the geocoder returns.
    private func findPlace() async {
        let query = placeText.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty, !finding else { return }
        finding = true
        defer { finding = false }
        do {
            let marks = try await CLGeocoder().geocodeAddressString(query)
            if let m = marks.first, let loc = m.location {
                draft.homeLat = loc.coordinate.latitude
                draft.homeLng = loc.coordinate.longitude
                let label = [m.locality, m.administrativeArea].compactMap { $0 }.joined(separator: ", ")
                draft.homeLabel = label.isEmpty ? (m.name ?? query) : label
                placeText = ""
                placeError = nil
            } else {
                placeError = "No place found for that."
            }
        } catch {
            placeError = "Couldn't look that up. Check your connection and try again."
        }
    }
}
