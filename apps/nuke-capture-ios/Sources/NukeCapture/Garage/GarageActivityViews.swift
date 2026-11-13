// GarageActivityViews.swift — "Today in your garage": what happened to your vehicles, newest first.
//
// Drawn as List sections so it sits at the top of the Garage tab and of the Profile garage list.
// Each item is a big photo row that opens the vehicle. Only events with a real clock are shown
// (GarageActivity.swift); a missing photo is a calm plate, a missing value is hidden, and a
// source that could not be read is named under the feed instead of passing for a quiet day.

import SwiftUI

struct GarageActivitySections: View {
    @ObservedObject var store: GarageActivityStore
    /// Re-reads the sources (the screen supplies its vehicles).
    let retry: () -> Void
    let open: (String) -> Void

    var body: some View {
        switch store.state {
        case .idle:
            EmptyView()
        case .loading:
            Section {
                NukeHeroCardSkeleton()
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    .padding(.vertical, NukeSpace.sm)
            } header: { Text("Today in your garage") }
        case .failed:
            Section {
                NukeEmptyState(icon: "exclamationmark.triangle", title: "Couldn't load garage activity",
                               message: "Your vehicles are below. Check your connection and try again.",
                               actionTitle: "Retry", action: retry)
                    .frame(minHeight: 220)
                    .listRowBackground(Color.clear)
                    .accessibilityIdentifier("garage.activity.error")
            } header: { Text("Today in your garage") }
        case .loaded(let result):
            loaded(result)
        }
    }

    @ViewBuilder private func loaded(_ result: GarageActivityResult) -> some View {
        let groups = GarageActivityFeed.group(result.events, now: result.readAt)
        Section {
            if groups.isQuietToday {
                Text("Nothing new today")
                    .font(.nukeCardTitle)
                    .accessibilityIdentifier("garage.activity.quiet")
                if let latest = groups.latestWhenQuiet {
                    row(latest, now: result.readAt, tag: "Latest")
                } else if result.unavailable.isEmpty {
                    Text("Photos, work updates, comments and listing changes show up here as they happen.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            } else {
                ForEach(groups.today) { row($0, now: result.readAt) }
            }
        } header: {
            Text("Today in your garage")
        } footer: {
            if groups.yesterday.isEmpty && groups.thisWeek.isEmpty { footer(result) }
        }
        if !groups.yesterday.isEmpty {
            Section {
                ForEach(groups.yesterday) { row($0, now: result.readAt) }
            } header: { Text("Yesterday") } footer: {
                if groups.thisWeek.isEmpty { footer(result) }
            }
        }
        if !groups.thisWeek.isEmpty {
            Section {
                ForEach(groups.thisWeek) { row($0, now: result.readAt) }
            } header: { Text("This week") } footer: { footer(result) }
        }
    }

    @ViewBuilder private func footer(_ result: GarageActivityResult) -> some View {
        VStack(alignment: .leading, spacing: NukeSpace.xs) {
            Text("Updated \(result.readAt.formatted(date: .omitted, time: .shortened)). Photos are placed by when they were taken.")
            if !result.unavailable.isEmpty {
                HStack {
                    Text("Couldn't read \(GarageActivityFeed.listed(result.unavailable)) just now, so some activity may be missing.")
                    Button("Retry", action: retry).font(.footnote.weight(.semibold))
                }
            }
            if store.refreshFailed {
                Text("Couldn't refresh. Showing what loaded earlier.")
            }
        }
    }

    private func row(_ e: GarageActivityEvent, now: Date, tag: String? = nil) -> some View {
        Button { open(e.vehicleId) } label: { GarageActivityRow(event: e, tag: tag, now: now) }
            .buttonStyle(.plain)
            .listRowInsets(EdgeInsets(top: NukeSpace.sm, leading: NukeSpace.lg, bottom: NukeSpace.sm, trailing: NukeSpace.lg))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
            .accessibilityIdentifier("garage.activity.\(e.id)")
    }
}

/// One big photo row: the event's photo (else the vehicle's cover), what happened, and when.
struct GarageActivityRow: View {
    let event: GarageActivityEvent
    var tag: String? = nil
    let now: Date

    var body: some View {
        NukePhoto(url: NukeImage.thumb(event.imageURL, width: 900), maxPixel: 900, emptyIcon: event.kind.symbol)
            .aspectRatio(16.0 / 10.0, contentMode: .fit)
            .overlay(alignment: .bottom) {
                LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .center, endPoint: .bottom)
                    .allowsHitTesting(false)
            }
            .overlay(alignment: .topLeading) {
                NukePill(text: tag ?? event.kind.label, icon: event.kind.symbol, onPhoto: true).padding(NukeSpace.md)
            }
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(event.headline)
                        .font(.nukeHeadline).foregroundStyle(.white)
                        .lineLimit(2).multilineTextAlignment(.leading)
                    if let sub = subtitle {
                        Text(sub).font(.nukeDetail).foregroundStyle(.white.opacity(0.85)).lineLimit(1)
                    }
                    TimelineView(.periodic(from: .now, by: 60)) { context in
                        Text(GarageActivityFeed.relative(event.at, now: max(context.date, now)))
                            .font(.caption).foregroundStyle(.white.opacity(0.85))
                    }
                }
                .padding(NukeSpace.lg)
                .shadow(color: .black.opacity(0.35), radius: 2, y: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: NukeRadius.hero, style: .continuous))
            .contentShape(Rectangle())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityText)
            .accessibilityAddTraits(.isButton)
            .accessibilityHint("Opens the vehicle profile")
    }

    /// The vehicle's name, unless the headline already names it.
    private var subtitle: String? {
        NukeDisplay.joined([event.headlineNamesVehicle ? nil : event.vehicleTitle, event.detail])
    }

    private var accessibilityText: String {
        NukeDisplay.joined([event.headline, subtitle, GarageActivityFeed.relative(event.at, now: now)], separator: ", ") ?? event.headline
    }
}
