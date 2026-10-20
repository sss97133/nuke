// JobLiveView.swift — the "live" version of a job, the way a delivery or ride app shows an order in motion.
//
// A map hero with the job's status, the step tracker, who is doing it, and an activity feed that updates
// while the screen is open: it polls work_order_activity_read at the interval the server suggests, asks only
// for what was recorded since the last clock, slides new events in and asks the parent to refresh the
// detail readers. Everything shown comes from the readers: the headline is the latest kind of event on
// record (not a stage verdict), tracker steps are the server's, and each feed row says how it is known
// (Signed, Recorded, Card processor, Message · not verified). Actions stay on the Details screen; the
// bottom bar names the next step the server offers and opens Details to take it.

import SwiftUI

struct JobLiveView: View {
    let workOrderId: String
    let path: JobLoad<JobPath>
    let place: JobLoad<JobProviderPlace>
    var titleHint: String? = nil
    var vehicleHint: String? = nil
    var onOpenDetails: () -> Void = {}
    var onChanged: () -> Void = {}

    @State private var feed: [JobActivity.Event] = []
    @State private var live: JobActivity.Live?
    @State private var refusal: JobRefusal?
    @State private var fresh: Set<String> = []
    @State private var lastChecked: Date?
    @State private var checking = false
    @State private var selectedStep: String?
    @State private var appeared = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                hero
                trackerCard
                providerCard
                activityCard
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .background(Color(.systemGroupedBackground))
        .safeAreaInset(edge: .bottom) { nextStepBar }
        .task(id: workOrderId) { await watch() }
        .refreshable { await poll(full: true) }
        .onAppear { withAnimation(.spring(response: 0.6, dampingFraction: 0.85)) { appeared = true } }
    }

    // MARK: Hero

    @ViewBuilder private var hero: some View {
        ZStack(alignment: .bottomLeading) {
            Group {
                if case .loaded(let p) = place {
                    JobPlaceMap(read: p)
                } else {
                    Rectangle().fill(Color(.secondarySystemBackground))
                        .overlay(Image(systemName: "map").font(.largeTitle).foregroundStyle(.tertiary))
                }
            }
            .frame(height: 230)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))

            statusCard
                .padding(12)
        }
        .overlay(alignment: .topLeading) { LiveBadge(active: isActive, checking: checking, lastChecked: lastChecked).padding(12) }
        .scaleEffect(appeared ? 1 : 0.97)
        .opacity(appeared ? 1 : 0)
    }

    private var phase: String { live?.phase ?? "requested" }
    private var isActive: Bool { refusal == nil && ActivityCopy.isActive(phase) }

    @ViewBuilder private var statusCard: some View {
        HStack(spacing: 12) {
            Image(systemName: ActivityCopy.phaseSymbol(phase))
                .font(.title2)
                .foregroundStyle(.tint)
                .symbolEffect(.pulse, options: .repeating, isActive: isActive)
                .contentTransition(.symbolEffect(.replace))
                .frame(width: 40, height: 40)
                .background(.thinMaterial, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(ActivityCopy.headline(phase))
                    .font(.title3.weight(.bold))
                    .contentTransition(.opacity)
                    .id(phase)
                    .transition(.push(from: .bottom))
                if let latest = feed.first {
                    TimelineView(.periodic(from: .now, by: 30)) { ctx in
                        Text("\(latest.title) · \(ActivityCopy.relative(latest.at, now: ctx.date))")
                            .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                } else {
                    Text(vehicleLine).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .animation(.spring(response: 0.45, dampingFraction: 0.8), value: phase)
        .accessibilityElement(children: .combine)
    }

    private var vehicleLine: String {
        if case .loaded(let p) = path, let v = p.vehicleLabel?.text { return v }
        return vehicleHint ?? titleHint ?? "Job"
    }

    // MARK: Tracker

    @ViewBuilder private var trackerCard: some View {
        if case .loaded(let p) = place, !p.steps.isEmpty {
            LiveCard {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("Progress").font(.subheadline.weight(.semibold))
                        Spacer()
                        Text(JobCopy.updated(p.asOf) ?? "").font(.caption2).foregroundStyle(.tertiary)
                    }
                    AnimatedProgressBar(fraction: appeared ? ActivityCopy.progress(p.steps) : 0)
                    JobProgressTracker(steps: p.steps, current: p.currentStep, selected: $selectedStep)
                        .animation(.spring(response: 0.5, dampingFraction: 0.8), value: p.steps)
                    if let step = p.steps.first(where: { $0.key == (selectedStep ?? p.currentStep) }) {
                        HStack(spacing: 6) {
                            Text(step.label).font(.caption.weight(.semibold))
                            Text(ProviderPlaceCopy.stepState(step)).font(.caption).foregroundStyle(.secondary)
                        }
                        .transition(.opacity)
                        .id(step.key)
                    }
                }
            }
            .animation(.easeInOut(duration: 0.2), value: selectedStep)
        }
    }

    // MARK: Who

    @ViewBuilder private var providerCard: some View {
        if case .loaded(let p) = place {
            LiveCard {
                VStack(alignment: .leading, spacing: 12) {
                    shopRow(p)
                    if let people = peopleLine(p) {
                        Label(people, systemImage: "person.2").font(.caption).foregroundStyle(.secondary)
                    }
                    actionButtons(p)
                }
            }
        }
    }

    @ViewBuilder private func shopRow(_ p: JobProviderPlace) -> some View {
        let row = HStack(spacing: 12) {
            LiveLogo(name: p.shop.name, url: p.shop.logoUrl)
            VStack(alignment: .leading, spacing: 2) {
                Text(p.shop.name ?? "No organization on this job").font(.headline).lineLimit(1)
                HStack(spacing: 4) {
                    Image(systemName: p.shop.rating?.state == "stored" ? "star.fill" : "star").font(.caption2)
                    Text(ProviderPlaceCopy.rating(p.shop.rating)).font(.caption)
                    let placeText = ProviderPlaceCopy.placeLine(p.shop.place)
                    if !placeText.isEmpty { Text("· \(placeText)").font(.caption).lineLimit(1) }
                }
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if p.shop.organizationId != nil { Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary) }
        }
        if let id = p.shop.organizationId {
            NavigationLink { OrganizationView(orgId: id, fallbackName: p.shop.name) } label: { row }.buttonStyle(.plain)
        } else {
            row
        }
    }

    private func peopleLine(_ p: JobProviderPlace) -> String? {
        let signed = p.acceptedProviders.filter(\.signed).count
        let all = p.acceptedProviders.count + p.recordedPeople.count
        guard all > 0 else { return nil }
        return signed > 0 ? "\(all) on this job · \(signed) accepted through Nuke" : "\(all) on this job · recorded, not signed"
    }

    @ViewBuilder private func actionButtons(_ p: JobProviderPlace) -> some View {
        let site = p.workSiteState == "facility_reserved" ? (p.workSitePlace ?? p.shop.place) : p.shop.place
        let directions = ProviderPlaceCopy.directionsURL(site, name: p.workSiteOrganization ?? p.shop.name)
        let phone = ProviderPlaceCopy.phoneURL(p.shop.place)
        if directions != nil || phone != nil {
            HStack(spacing: 10) {
                if let directions {
                    Link(destination: directions) {
                        Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond.fill").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                }
                if let phone {
                    Link(destination: phone) { Label("Call", systemImage: "phone.fill").frame(maxWidth: .infinity) }
                        .buttonStyle(.bordered)
                }
            }
            .controlSize(.large)
        }
    }

    // MARK: Activity

    @ViewBuilder private var activityCard: some View {
        LiveCard {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("Activity").font(.subheadline.weight(.semibold))
                    if isActive { PulsingDot().padding(.leading, 2) }
                    Spacer()
                    if let total = live?.eventsTotal, total > 0 {
                        Text("\(total) on record").font(.caption2).foregroundStyle(.tertiary)
                    }
                }
                .padding(.bottom, 10)
                if let refusal {
                    JobRefusalRow(refusal: refusal)
                } else if live == nil {
                    ForEach(0..<3, id: \.self) { _ in SkeletonRow() }
                } else if feed.isEmpty {
                    Text("Nothing recorded on this job yet.").font(.footnote).foregroundStyle(.secondary)
                } else {
                    ForEach(Array(feed.enumerated()), id: \.element.id) { i, e in
                        ActivityRow(event: e, isLast: i == feed.count - 1, isNew: fresh.contains(e.id))
                            .transition(.asymmetric(insertion: .move(edge: .top).combined(with: .opacity), removal: .opacity))
                    }
                }
                Text("Signed means a party signed it through Nuke. Messages are quoted from retained conversations and not verified.")
                    .font(.caption2).foregroundStyle(.tertiary).padding(.top, 8)
            }
        }
    }

    // MARK: Next step

    @ViewBuilder private var nextStepBar: some View {
        let next: JobAction? = { if case .loaded(let p) = path { return p.viewer?.actions.first } else { return nil } }()
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text(next == nil ? "Full details" : "Your next step").font(.caption).foregroundStyle(.secondary)
                Text(next?.title ?? "Quote, parts, invoices and every stage").font(.subheadline.weight(.semibold)).lineLimit(1)
            }
            Spacer(minLength: 0)
            Button {
                Haptics.tick()
                onOpenDetails()
            } label: {
                Text(next == nil ? "Details" : "Open").frame(minWidth: 72)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.bar)
    }

    // MARK: Polling

    private func watch() async {
        await poll(full: true)
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(ActivityCopy.pollInterval(live)))
            if Task.isCancelled { break }
            await poll(full: false)
        }
    }

    private func poll(full: Bool) async {
        checking = true
        defer { checking = false; lastChecked = Date() }
        let since = full ? nil : live?.latestRecordedAt
        switch await ActivityReaders.read(workOrderId: workOrderId, since: since) {
        case .loaded(let a):
            refusal = nil
            let changed = live != nil && a.live.version != live?.version
            let newIds = live == nil ? [] : ActivityCopy.fresh(feed, a.events)
            withAnimation(.spring(response: 0.5, dampingFraction: 0.82)) {
                feed = full ? ActivityCopy.merge([], a.events) : ActivityCopy.merge(feed, a.events)
                live = a.live
                fresh = newIds
            }
            if changed {
                Haptics.refreshSettled()
                onChanged()
            }
        case .refused(let r):
            if live == nil { refusal = r }
        case .loading:
            break
        }
    }
}

// MARK: - Pieces

private struct LiveCard<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        content
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

/// "LIVE" while the job can still change and the screen is watching; otherwise when it was last checked.
private struct LiveBadge: View {
    let active: Bool
    let checking: Bool
    let lastChecked: Date?

    var body: some View {
        HStack(spacing: 6) {
            if active { PulsingDot(color: .red) }
            TimelineView(.periodic(from: .now, by: 15)) { ctx in
                Text(active ? "LIVE" : (lastChecked.map { "Checked " + ActivityCopy.relative(ISO8601DateFormatter().string(from: $0), now: ctx.date) } ?? "Checking…"))
                    .font(.caption2.weight(.bold))
                    .monospaced()
            }
            if checking { ProgressView().controlSize(.mini) }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.ultraThinMaterial, in: Capsule())
        .accessibilityLabel(active ? "Live: this screen updates as the job changes" : "Not changing; last checked")
    }
}

private struct PulsingDot: View {
    var color: Color = .accentColor
    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .phaseAnimator([false, true]) { dot, on in
                dot.overlay(Circle().stroke(color.opacity(on ? 0 : 0.6), lineWidth: on ? 6 : 0).scaleEffect(on ? 2.2 : 1))
            } animation: { _ in .easeOut(duration: 1.2) }
    }
}

private struct AnimatedProgressBar: View {
    let fraction: Double
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color(.tertiarySystemFill))
                Capsule().fill(.tint)
                    .frame(width: max(6, geo.size.width * fraction))
                    .animation(.spring(response: 0.9, dampingFraction: 0.75), value: fraction)
            }
        }
        .frame(height: 6)
        .accessibilityValue("\(Int(fraction * 100)) percent of steps reached")
    }
}

private struct LiveLogo: View {
    let name: String?
    let url: String?
    var body: some View {
        let fallback = RoundedRectangle(cornerRadius: 12).fill(Color(.tertiarySystemFill))
            .overlay(Text(String((name ?? "?").prefix(1)).uppercased()).font(.headline).foregroundStyle(.secondary))
        Group {
            if let url {
                CachedAsyncImage(url: NukeImage.thumb(url, width: 120), maxPixel: 120) { img in img.resizable().scaledToFit() }
                    placeholder: { fallback }
            } else {
                fallback
            }
        }
        .frame(width: 52, height: 52)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private struct SkeletonRow: View {
    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(Color(.tertiarySystemFill)).frame(width: 32, height: 32)
            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: 4).fill(Color(.tertiarySystemFill)).frame(width: 180, height: 10)
                RoundedRectangle(cornerRadius: 4).fill(Color(.tertiarySystemFill)).frame(width: 110, height: 8)
            }
        }
        .padding(.vertical, 8)
        .phaseAnimator([0.45, 1.0]) { row, o in row.opacity(o) } animation: { _ in .easeInOut(duration: 0.9) }
    }
}

/// One feed event on the timeline: icon, title, who and when, how it is known, and photos where shown.
struct ActivityRow: View {
    let event: JobActivity.Event
    let isLast: Bool
    let isNew: Bool

    private var isTestimony: Bool { event.basis == "message_testimony" }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                Image(systemName: ActivityCopy.symbol(event.kind))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(isTestimony ? Color.secondary : (event.basis == "authenticated_sign" ? Color.green : Color.primary))
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(isNew ? Color.accentColor.opacity(0.18) : Color(.tertiarySystemFill)))
                    .overlay(Circle().strokeBorder(style: StrokeStyle(lineWidth: 1, dash: isTestimony ? [3, 3] : []))
                        .foregroundStyle(isTestimony ? Color.secondary : .clear))
                    .symbolEffect(.bounce, value: isNew)
                if !isLast {
                    Rectangle().fill(Color(.separator)).frame(width: 1.5).frame(maxHeight: .infinity)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(event.title)
                    .font(.subheadline.weight(isNew ? .bold : .semibold))
                    .italic(isTestimony)
                TimelineView(.periodic(from: .now, by: 30)) { ctx in
                    Text([ActivityCopy.roleLabel(event.role), ActivityCopy.relative(event.at, now: ctx.date), ActivityCopy.basisLabel(event.basis)]
                        .compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let media = event.media, !media.thumbnails.isEmpty || media.withheld > 0 {
                    HStack(spacing: 6) {
                        ForEach(media.thumbnails, id: \.self) { u in
                            CachedAsyncImage(url: NukeImage.thumb(u, width: 160), maxPixel: 160) { img in
                                img.resizable().scaledToFill()
                            } placeholder: { Color(.tertiarySystemFill) }
                                .frame(width: 56, height: 56)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        if media.withheld > 0 {
                            Text("+\(media.withheld) not shown").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.top, 2)
                }
            }
            .padding(.bottom, isLast ? 0 : 14)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}
