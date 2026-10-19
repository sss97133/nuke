// JobsLookingSection.swift — Work → "Jobs looking for someone" (open_requirements_read).
//
// Each open request: what is needed, the job, the vehicle, the area, any window and the quote
// state; for a signed-in viewer, how their record lines up input by input (no score; a missing
// tool or shop means a backup supplier is needed, not a rejection). Rows open JobView, where
// offers are made. Contact via Nuke appears when the reader allows it.

import SwiftUI

struct JobsLookingSection: View {
    let open: JobLoad<OpenRequirements>
    var bridge: String? = nil

    var body: some View {
        Section {
            switch open {
            case .loading:
                HStack(spacing: 8) { ProgressView(); Text("Loading…").font(.footnote).foregroundStyle(.secondary) }
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let page):
                if page.rows.isEmpty {
                    Text("No open requests right now.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(page.rows) { row in
                    NavigationLink {
                        JobView(workOrderId: row.workOrderId, titleHint: row.displayTitle, vehicleHint: row.vehicleLabel?.text)
                    } label: {
                        OpenRequirementRow(row: row)
                    }
                    if let match = row.match, !match.isEmpty {
                        MatchTable(inputs: match)
                    }
                    if let block = page.contact(for: row), block.canRequest {
                        ContactViaNukeRow(block: block, recipientName: "The people on this job",
                                          contextLabel: "\(OfferCopy.kind(row.kind)) on \(row.displayTitle ?? "this job")")
                    }
                }
                if page.unreadableRows > 0 {
                    Text(JobCopy.newerVersion(page.unreadableRows)).font(.footnote).foregroundStyle(.secondary)
                }
            }
            if case .loaded(let page) = open, page.signedIn {
                NavigationLink {
                    ProviderLinkView()
                } label: {
                    RootedValueView(label: "Technician profile", value: JobCopy.technicianLink(bridge) ?? "Not available",
                                    status: bridge == "evidenced" ? .attributed : .recorded)
                }
            }
        } header: {
            Text("Jobs looking for someone")
        } footer: {
            if case .loaded(let page) = open {
                Text("\(page.sentence). " + (page.signedIn
                    ? "How your record lines up, item by item. There's no score, and nothing rules you out."
                    : "Sign in to see how your record lines up."))
            }
        }
    }
}

struct OpenRequirementRow: View {
    let row: OpenRequirement

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(OfferCopy.kind(row.kind)).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text(row.description ?? "No description").font(.subheadline).lineLimit(3)
            Text(row.displayTitle ?? "Untitled job").font(.caption).foregroundStyle(.primary).lineLimit(1)
            Text(Self.detail(row)).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
        }
        .padding(.vertical, 3)
    }

    /// "1983 GMC K2500 · Boulder City, NV · No quote yet · 0 offers listed".
    static func detail(_ row: OpenRequirement) -> String {
        var parts: [String] = []
        if let v = row.vehicleLabel?.text { parts.append(v) }
        if let p = row.place { parts.append(p) }
        if let w = OfferCopy.window(row.window?.available_from, row.window?.available_until) { parts.append(w) }
        parts.append(row.hasCurrentQuote ? (row.quoteAcceptance == "accepted" ? "Quote accepted" : "Quoted") : "No quote yet")
        parts.append(row.candidatesListed == 1 ? "1 candidate listed" : "\(row.candidatesListed) candidates listed")
        return parts.joined(separator: " · ")
    }
}

/// How a viewer's record lines up with one request, input by input.
struct MatchTable: View {
    let inputs: [MatchInput]

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("How you match").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            ForEach(inputs) { m in
                let sym = OfferCopy.symbol(m.result)
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: sym.name)
                        .foregroundStyle(sym.tint == "green" ? Color.green : Color.secondary)
                        .font(.caption)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("\(OfferCopy.input(m.input)) — \(OfferCopy.reason(m))").font(.footnote)
                        if let next = OfferCopy.next(m.next) {
                            Text(next).font(.caption2).foregroundStyle(.orange)
                        }
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(.vertical, 4)
    }
}
