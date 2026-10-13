// ProfileStripView.swift — the vehicle header's document, rendered through the app's one primitive.
//
// The web's ProfileHeader renders `vehicle_profile_read`'s ProfileDocument with the kit: the
// masthead's one headline price as a Claim, then the strip of recorded facts with its coverage.
// This is the same header on the phone. Every value goes through RootedValueView (the trust
// ladder every row in the app already speaks), every clock prints the way the kit prints it, and
// the strip ends with its denominator: how many of its facts are attributed, as of when. Nothing
// here reads a table; the document is the only input, so the phone cannot show a fact the
// database did not hand it for this viewer.

import SwiftUI

/// A tapped claim awaiting its source sheet.
struct ClaimDrill: Identifiable {
    let title: String
    let claim: Claim
    /// The existing field-provenance drill, when the claim's dimension is a record field.
    let spec: SpecDrill?
    var id: String { title + claim.value.text }
}

/// The header block: headline price (unless a live auction owns it) and the strip.
struct ProfileHeaderBlock: View {
    let vehicleId: String
    let read: ProfileRead
    /// True while a live auction banner shows the current bid: then the masthead price stays off,
    /// the same rule as the web's priceOwnedByLiveStack.
    let priceOwnedByLiveStack: Bool

    @State private var drill: ClaimDrill?

    /// The strip's dimensions map onto record fields the spec table also knows; the
    /// table drops those rows when the strip owns them (state each datum once).
    static func field(for dimension: String) -> String? {
        switch dimension {
        case "body_style": return "body_style"
        case "engine": return "engine_size"
        case "transmission": return "transmission"
        case "drivetrain": return "drivetrain"
        default: return nil
        }
    }

    private static func name(for dimension: String) -> String {
        switch dimension {
        case "body_style": return "Body"
        case "engine": return "Engine"
        case "transmission": return "Transmission"
        case "drivetrain": return "Drivetrain"
        case "location": return "Location"
        default: return dimension.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let m = read.masthead, let price = m.price, !priceOwnedByLiveStack {
                priceRow(price, label: m.priceLabel ?? "Recorded price")
            }
            if let strip = read.strip, !strip.facets.isEmpty || strip.odometer != nil {
                stripCard(strip)
            }
        }
        // The sheet rides this subview, not the page: the page already hosts provenance + comments.
        .sheet(item: $drill) { d in ClaimSourceSheet(vehicleId: vehicleId, drill: d) }
    }

    // The one headline result: what kind of price, from which platform, as of when.
    @ViewBuilder private func priceRow(_ price: Claim, label: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            RootedValueView(
                label: label,
                value: Self.money(price),
                status: price.rootStatus,
                decay: price.decayLine,
                onDrill: { drill = ClaimDrill(title: label, claim: price, spec: nil) }
            )
        }
        .nukeCard()
    }

    @ViewBuilder private func stripCard(_ strip: ProfileSection.Strip) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("RECORDED CONFIGURATION")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
                .padding(.bottom, 4)
            VStack(spacing: 0) {
                if let odo = strip.odometer {
                    claimRow(label: "Odometer", value: Self.odometer(odo), claim: odo,
                             spec: SpecDrill(label: "Odometer", value: Self.odometer(odo), field: "mileage"))
                    Divider()
                }
                ForEach(strip.facets, id: \.dimension) { f in
                    let name = Self.name(for: f.dimension)
                    claimRow(label: name, value: f.label, claim: f.member,
                             spec: Self.field(for: f.dimension).map { SpecDrill(label: name, value: f.label, field: $0) })
                    Divider()
                }
            }
            // The denominator, always last and always present: a strip without coverage does not exist.
            Text(strip.coverage.sentence)
                .font(.system(size: 9, design: .monospaced))
                .foregroundStyle(.tertiary)
                .padding(.top, 8)
        }
        .nukeCard()
    }

    @ViewBuilder private func claimRow(label: String, value: String, claim: Claim, spec: SpecDrill?) -> some View {
        RootedValueView(
            label: label,
            value: value,
            status: claim.rootStatus,
            decay: claim.decayLine,
            onDrill: { drill = ClaimDrill(title: label, claim: claim, spec: spec) }
        )
    }

    /// USD gets a dollar sign; a classified's unrecorded currency prints the bare number, as on the web.
    static func money(_ claim: Claim) -> String {
        guard let n = claim.value.number else { return claim.value.text }
        if claim.unit == "USD" {
            return n.formatted(.currency(code: "USD").precision(.fractionLength(0)))
        }
        return Int(n.rounded()).formatted()
    }

    static func odometer(_ claim: Claim) -> String {
        guard let n = claim.value.number else { return claim.value.text }
        return "\(Int(n.rounded()).formatted()) \(claim.unit ?? "mi")"
    }
}

/// The evidence behind a claim, as the web's SourceView states it: when it was observed, who said
/// it, how far it is trusted, where to read it. A record field also opens the existing full
/// provenance drill, so the kit's popover and the app's deep drill are one path, not two.
struct ClaimSourceSheet: View {
    let vehicleId: String
    let drill: ClaimDrill
    @Environment(\.dismiss) private var dismiss
    @State private var fullProvenance: SpecDrill?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Value") {
                        Text(drill.claim.value.text + (drill.claim.unit.map { $0 == "USD" || $0.isEmpty ? "" : " \($0)" } ?? ""))
                            .font(.system(.footnote, design: .monospaced))
                    }
                    LabeledContent("Observed") {
                        Text(ProfileClock.day(drill.claim.observed_at) ?? "unknown date")
                            .font(.system(.footnote, design: .monospaced))
                    }
                    LabeledContent("Source") {
                        Text(drill.claim.sourceLine)
                            .font(.system(.footnote, design: .monospaced))
                            .multilineTextAlignment(.trailing)
                    }
                    LabeledContent("Trust") {
                        Text("\(drill.claim.trustPercent)%")
                            .font(.system(.footnote, design: .monospaced))
                    }
                } footer: {
                    Text(drill.claim.source.kind == .legacy
                         ? "A legacy value comes from the vehicle record itself, with no observation beneath it."
                         : "Trust is the reader's calibration for this evidence class, or the row's own confidence when it carries one.")
                }
                if let url = drill.claim.source.openableURL {
                    Section {
                        Link(destination: url) {
                            Label("Open source", systemImage: "arrow.up.right")
                        }
                    }
                }
                if let spec = drill.spec, drill.claim.source.kind != .legacy {
                    Section {
                        Button {
                            fullProvenance = spec
                        } label: {
                            Label("Full provenance", systemImage: "doc.text.magnifyingglass")
                        }
                    }
                }
            }
            .navigationTitle(drill.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .sheet(item: $fullProvenance) { spec in FieldProvenanceSheet(vehicleId: vehicleId, drill: spec) }
    }
}
