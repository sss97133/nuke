// ToolActionShotsView.swift — "Seen at work": photos where the image analysis saw a tool type,
// one carousel per type (user_tool_action_shots_read). Loaded on its own beside the toolbox, so the
// pack-shot grid never waits for the photo scan. A label is a tool type seen in the frame; nothing
// here links a photo to a toolbox item or its pack shot.

import SwiftUI

struct ToolActionShotsSection: View {
    let userId: String
    let read: JobLoad<ToolActionShots>
    var onRetry: (() -> Void)? = nil

    @Namespace private var zoomNS
    @State private var appeared = false
    @State private var showMore = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(ActionShotsCopy.title).font(.headline)
            switch read {
            case .loading:
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Looking through work photos…").font(.footnote).foregroundStyle(.secondary)
                }
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
                if refusal.kind == .failed, let onRetry { Button("Try again", action: onRetry).font(.footnote) }
            case .loaded(let s):
                loaded(s)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onScrollVisibilityChange(threshold: 0.05) { visible in
            if visible { appeared = true }
        }
    }

    @ViewBuilder private func loaded(_ s: ToolActionShots) -> some View {
        let carousels = Array(s.groups.prefix(ActionShotsCopy.carouselLimit))
        let rest = Array(s.groups.dropFirst(ActionShotsCopy.carouselLimit))
        if s.groups.isEmpty {
            Text(s.isSelf ? "No tools seen in your scanned photos yet." : "No tools seen in their scanned photos yet.")
                .font(.footnote).foregroundStyle(.secondary)
        }
        ForEach(Array(carousels.enumerated()), id: \.element.id) { index, group in
            carousel(group, isSelf: s.isSelf)
                .opacity(appeared ? 1 : 0)
                .offset(y: appeared || reduceMotion ? 0 : 14)
                .animation(.easeOut(duration: 0.35).delay(reduceMotion ? 0 : Double(index) * 0.07), value: appeared)
        }
        if !rest.isEmpty {
            DisclosureGroup(isExpanded: $showMore) {
                ForEach(rest) { group in
                    NavigationLink { ToolActionShotsLabelView(userId: userId, label: group.label) } label: {
                        HStack {
                            Text(ActionShotsCopy.labelTitle(group.label)).font(.footnote)
                            Spacer()
                            Text(ActionShotsCopy.photos(group.photos)).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                }
            } label: {
                Text("\(JobCopy.count(rest.count)) more tool \(rest.count == 1 ? "type" : "types")").font(.footnote)
            }
        }
        ActionShotsFooter(read: s)
    }

    @ViewBuilder private func carousel(_ g: ToolActionShots.Group, isSelf: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(ActionShotsCopy.groupTitle(g)).font(.subheadline.weight(.medium))
                Spacer()
                if (g.photos ?? 0) > g.shots.count {
                    NavigationLink { ToolActionShotsLabelView(userId: userId, label: g.label) } label: {
                        Text("See all").font(.footnote)
                    }
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 8) {
                    ForEach(g.shots) { shot in
                        let tid = ActionShotsCopy.transitionID(label: g.label, shot: shot)
                        NavigationLink {
                            ToolActionShotPhotoView(shot: shot, label: g.label, isSelf: isSelf)
                                .navigationTransition(.zoom(sourceID: tid, in: zoomNS))
                        } label: {
                            ActionShotThumb(shot: shot, size: 120)
                                .matchedTransitionSource(id: tid, in: zoomNS)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .scrollClipDisabled()
        }
    }
}

struct ActionShotThumb: View {
    let shot: ToolActionShots.Shot
    let size: CGFloat

    var body: some View {
        CachedAsyncImage(url: ActionShotsCopy.thumbURL(shot), maxPixel: size * 3) { img in
            img.resizable().scaledToFill()
        } placeholder: {
            Rectangle().fill(Color(.tertiarySystemFill))
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityLabel(ActionShotsCopy.day(shot))
    }
}

struct ActionShotsFooter: View {
    let read: ToolActionShots

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(ActionShotsCopy.basis(isSelf: read.isSelf))
            if let line = ActionShotsCopy.coverage(read) { Text(line) }
            if let cap = ActionShotsCopy.capNote(read) { Text(cap) }
            Text(ActionShotsCopy.scope(isSelf: read.isSelf))
            if let asOf = JobCopy.day(read.asOf) { Text("As of \(asOf)") }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - See all

struct ToolActionShotsLabelView: View {
    let userId: String
    let label: String

    @State private var read: JobLoad<ToolActionShots> = .loading
    @Namespace private var zoomNS
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 3), count: 3)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                switch read {
                case .loading:
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Loading photos…").font(.footnote).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 40)
                case .refused(let refusal):
                    JobRefusalRow(refusal: refusal)
                    if refusal.kind == .failed { Button("Try again") { Task { await load() } }.font(.footnote) }
                case .loaded(let s):
                    if let g = s.groups.first {
                        Text(ActionShotsCopy.groupTitle(g)).font(.subheadline.weight(.medium))
                        LazyVGrid(columns: columns, spacing: 3) {
                            ForEach(g.shots) { shot in
                                NavigationLink {
                                    ToolActionShotPhotoView(shot: shot, label: g.label, isSelf: s.isSelf)
                                        .navigationTransition(.zoom(sourceID: shot.imageId, in: zoomNS))
                                } label: {
                                    CachedAsyncImage(url: ActionShotsCopy.thumbURL(shot), maxPixel: 360) { img in
                                        img.resizable().scaledToFill()
                                    } placeholder: {
                                        Rectangle().fill(Color(.tertiarySystemFill))
                                    }
                                    .frame(minWidth: 0, maxWidth: .infinity)
                                    .aspectRatio(1, contentMode: .fill)
                                    .clipped()
                                    .matchedTransitionSource(id: shot.imageId, in: zoomNS)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .transition(.opacity)
                        if let shown = ActionShotsCopy.shown(g) {
                            Text(shown + " (at most \(ToolActionShotsReaders.perLabelMax)).").font(.caption).foregroundStyle(.secondary)
                        }
                    } else {
                        Text("No photos with this tool type in the scanned photos.").font(.footnote).foregroundStyle(.secondary)
                    }
                    ActionShotsFooter(read: s)
                }
            }
            .padding()
            .animation(.easeOut(duration: 0.3), value: Self.isLoaded(read))
        }
        .navigationTitle(ActionShotsCopy.labelTitle(label))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: label) { await load() }
        .refreshable { await load() }
    }

    private static func isLoaded(_ r: JobLoad<ToolActionShots>) -> Bool {
        if case .loaded = r { return true }
        return false
    }

    private func load() async {
        let r = await ToolActionShotsReaders.shots(userId: userId, label: label, perLabel: ToolActionShotsReaders.perLabelMax)
        withAnimation(.easeOut(duration: 0.3)) { read = r }
    }
}

// MARK: - One photo

struct ToolActionShotPhotoView: View {
    let shot: ToolActionShots.Shot
    let label: String
    let isSelf: Bool

    var body: some View {
        List {
            Section {
                CachedAsyncImage(url: ActionShotsCopy.photoURL(shot)) { img in
                    img.resizable().scaledToFit()
                } placeholder: {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 260)
                }
                .frame(maxWidth: .infinity)
                .listRowInsets(EdgeInsets())
            } footer: {
                Text(ActionShotsCopy.photoCaption(label: label, isSelf: isSelf))
            }
            Section {
                RootedValueView(label: "Tool type seen", value: ActionShotsCopy.labelTitle(label), status: .projected,
                                decay: "image analysis of this photo")
                RootedValueView(label: "Taken", value: JobCopy.day(shot.takenAt) ?? "Not recorded", status: .recorded,
                                decay: "photo capture clock")
                if let id = shot.vehicle?.vehicleId {
                    NavigationLink { VehicleDetailView(vehicleId: id, embedInNavigationStack: false) } label: {
                        RootedValueView(label: "Vehicle", value: ActionShotsCopy.vehicle(shot), status: .attributed)
                    }
                } else {
                    RootedValueView(label: "Vehicle", value: ActionShotsCopy.vehicle(shot), status: .recorded)
                }
            }
        }
        .navigationTitle(ActionShotsCopy.labelTitle(label))
        .navigationBarTitleDisplayMode(.inline)
    }
}
