import SwiftUI
import Supabase

/// Read-only. Opening a profile never starts a model, files a photo or mints a vehicle.
enum ObservedCarReader {
    private struct Request: Encodable {
        let mode = "read_subjects"
        let user_id: String
        let cluster_id: String?
        let limit = 24
        let offset: Int
    }
    static func read(userId: String, clusterId: UUID? = nil, offset: Int = 0) async throws -> ObservedCarRead {
        guard let owner = ObservedCarRead.ownAccount(userId, activeUserId: SupabaseService.currentUserId) else {
            throw CocoaError(.userCancelled)
        }
        let result: ObservedCarRead = try await SupabaseService.client.functions.invoke("check-image-vehicle-match",
            options: FunctionInvokeOptions(body: Request(user_id: owner, cluster_id: clusterId?.uuidString.lowercased(), offset: offset)))
        guard ObservedCarRead.ownAccount(userId, activeUserId: SupabaseService.currentUserId) == owner,
              result.isQualified, result.next_offset.map({ $0 > offset }) ?? true,
              clusterId == nil || result.subjects.allSatisfy({ $0.id == clusterId }) else {
            throw CocoaError(.coderInvalidValue)
        }
        return result
    }
}

struct ObservedCarsSection: View {
    let userId: String
    @EnvironmentObject private var session: SessionStore
    @ObservedObject private var resolution = SubjectResolutionEngine.shared
    @State private var pages: [ObservedCarRead] = []
    @State private var savedAt: Date?
    @State private var failure: String?
    @State private var loading = false
    @State private var generation = UUID()
    private var allowed: Bool { session.isSignedIn && ObservedCarRead.ownAccount(userId, activeUserId: SupabaseService.currentUserId) != nil }

    var body: some View {
        Group {
            if allowed {
                Section("Observed cars") {
                    Text("Private photo profiles · visual interpretations · identity pending")
                        .font(.caption).foregroundStyle(.secondary)
                    if ObservedCarRead.ownAccount(userId, activeUserId: resolution.lastSummaryUserId) != nil,
                       let summary = resolution.lastSummary {
                        Text(summary).font(.caption).foregroundStyle(.secondary)
                        if resolution.providerNeedsReview {
                            NavigationLink("Review Connected accounts") { ConnectedAccountsView() }
                        }
                    }
                    if let savedAt { savedNotice(savedAt) }
                    ForEach(Array(pages.enumerated()), id: \.offset) { _, page in
                        ForEach(page.subjects) { subject in
                            NavigationLink {
                                SubjectProfileView(userId: userId, subjectId: subject.id)
                            } label: { subjectRow(subject) }
                        }
                        SubjectCoverageView(coverage: page.coverage)
                    }
                    if pages.first?.subjects.isEmpty == true {
                        Text("No supported photo profiles in this read.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if let failure {
                        Text(failure).font(.caption).foregroundStyle(.secondary)
                        Button("Retry") { Task { await load() } }
                    }
                    if loading { ProgressView() }
                    if let next = pages.last?.next_offset, !loading {
                        Button("More observed cars") { Task { await load(offset: next) } }
                    }
                }
            }
        }
        .task(id: userId) { await load() }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("visualSubjectResolutionDidChange"))) { _ in
            guard allowed else { return }
            Task { await load() }
        }
    }

    private func subjectRow(_ subject: ObservedCarProfile) -> some View {
        HStack(spacing: 12) {
            CachedAsyncImage(url: NukeImage.thumb(subject.cover_image_url, width: 180)) { image in
                image.resizable().scaledToFill()
            } placeholder: { Color(.secondarySystemFill).overlay { Image(systemName: "car.side") } }
                .frame(width: 76, height: 62).clipped().clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 4) {
                RootedValueView(label: "Visual interpretation", value: subject.label, status: .projected,
                    decay: subjectReadingClock(subject))
                Text("Identity pending").font(.caption).foregroundStyle(.secondary)
                SubjectCoverageView(coverage: subject.coverage)
            }
        }.padding(.vertical, 3)
    }

    @MainActor private func load(offset: Int = 0) async {
        guard allowed else { pages = []; savedAt = nil; return }
        let request = UUID(); generation = request
        if offset == 0 { pages = []; savedAt = nil }
        loading = true; failure = nil
        defer { if generation == request { loading = false } }
        do {
            let read = try await ObservedCarReader.read(userId: userId, offset: offset)
            guard generation == request else { return }
            guard allowed else { pages = []; return }
            if offset == 0 { pages = [read] } else { pages.append(read) }
            savedAt = nil
            do { try LocalStore.shared.cacheObservedCars(userId: userId, activeUserId: SupabaseService.currentUserId, offset: offset, read: read) }
            catch { failure = "Live read loaded; couldn't save it for offline use." }
        } catch {
            guard generation == request else { return }
            guard allowed else { pages = []; return }
            failure = ReadFailure.text(error)
            if offset == 0, let cached = try? LocalStore.shared.cachedObservedCars(userId: userId, activeUserId: SupabaseService.currentUserId) {
                pages = [cached.read]; savedAt = cached.cachedAt
            }
        }
    }
}

struct SubjectProfileView: View {
    let userId: String
    let subjectId: UUID
    @EnvironmentObject private var session: SessionStore
    @State private var read: ObservedCarRead?
    @State private var savedAt: Date?
    @State private var failure: String?
    @State private var selected: ObservedCarProfile.Photo?
    @State private var generation = UUID()
    private var allowed: Bool { session.isSignedIn && ObservedCarRead.ownAccount(userId, activeUserId: SupabaseService.currentUserId) != nil }

    var body: some View {
        Group {
            if !allowed {
                ContentUnavailableView("Sign in to your photo record", systemImage: "lock")
            } else if let subject = read?.subjects.first(where: { $0.id == subjectId }) {
                ScrollViewReader { gallery in
                  ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        RootedValueView(label: "Visual interpretation", value: subject.label, status: .projected,
                            decay: subjectReadingClock(subject), onDrill: subject.images.isEmpty ? nil : {
                                withAnimation { gallery.scrollTo("subject-source-gallery", anchor: .top) }
                            })
                        Text("Private · identity pending").font(.subheadline).foregroundStyle(.secondary)
                        Text("These photographs are interpreted as showing the same car. Physical identity is still unresolved.")
                            .font(.footnote).foregroundStyle(.secondary)
                        if !subject.asserted_identity.labels.isEmpty {
                            RootedValueView(label: "Visual labels", value: subject.asserted_identity.labels.joined(separator: " · "),
                                status: .projected, decay: subjectReadingClock(subject), onDrill: subject.images.isEmpty ? nil : {
                                    withAnimation { gallery.scrollTo("subject-source-gallery", anchor: .top) }
                                })
                        }
                        if let savedAt { savedNotice(savedAt) }
                        SubjectCoverageView(coverage: subject.coverage)
                        Text("\(subject.images.count) shown of \(subject.image_count) usable photos")
                            .font(.caption).foregroundStyle(.secondary)
                        if subject.coverage.truncated {
                            Text("This read is bounded; additional photos may remain unassessed.").font(.caption).foregroundStyle(.secondary)
                        }
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 4) {
                            ForEach(subject.images) { photo in
                                Button { selected = photo } label: {
                                    Color(.secondarySystemFill).aspectRatio(1, contentMode: .fit).overlay {
                                        CachedAsyncImage(url: NukeImage.thumb(photo.image_url, width: 480)) { image in
                                            image.resizable().scaledToFit()
                                        } placeholder: { ProgressView() }
                                    }.clipped()
                                }.buttonStyle(.plain).accessibilityLabel("Open source photo")
                            }
                        }.id("subject-source-gallery")
                        if let failure { Text(failure).font(.caption).foregroundStyle(.secondary) }
                    }.padding()
                  }
                }
            } else if let failure {
                ContentUnavailableView { Label("Couldn't read this photo profile", systemImage: "exclamationmark.triangle") }
                description: { Text(failure) }
                actions: { Button("Retry") { Task { await load() } } }
            } else if read != nil {
                ContentUnavailableView("Photo profile unavailable", systemImage: "photo")
            } else { ProgressView() }
        }
        .navigationTitle("Observed car").navigationBarTitleDisplayMode(.inline)
        .toolbar { if allowed { ToolbarItem(placement: .topBarTrailing) {
            Button("Refresh", systemImage: "arrow.clockwise") { Task { await load() } }
        } } }
        .task(id: subjectId) { await load() }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("visualSubjectResolutionDidChange"))) { _ in
            guard allowed else { return }
            Task { await load() }
        }
        .fullScreenCover(item: $selected) { photo in
            SubjectPhotoViewer(userId: userId, photo: photo)
        }
    }

    @MainActor private func load() async {
        guard allowed else { read = nil; selected = nil; return }
        let request = UUID(); generation = request
        failure = nil
        do {
            let result = try await ObservedCarReader.read(userId: userId, clusterId: subjectId)
            guard generation == request else { return }
            guard allowed else { read = nil; return }
            read = result; savedAt = nil
            do { try LocalStore.shared.cacheObservedCars(userId: userId, activeUserId: SupabaseService.currentUserId, clusterId: subjectId, read: result) }
            catch { failure = "Live read loaded; couldn't save it for offline use." }
        } catch {
            guard generation == request else { return }
            guard allowed else { read = nil; selected = nil; return }
            failure = ReadFailure.text(error)
            if let cached = try? LocalStore.shared.cachedObservedCars(userId: userId, activeUserId: SupabaseService.currentUserId, clusterId: subjectId) {
                read = cached.read; savedAt = cached.cachedAt
            }
        }
    }
}

private struct SubjectCoverageView: View {
    let coverage: ObservedCarCoverage
    var body: some View {
        Text("\(coverage.eligible) of \(coverage.assessed) source photos qualified · \(coverage.excluded) excluded · as of \(coverage.clock.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "unknown")" + (coverage.truncated ? " · bounded read" : ""))
            .font(.caption2).foregroundStyle(.secondary).monospacedDigit()
    }
}

private func savedNotice(_ date: Date) -> some View {
    Label("Saved \(date.formatted(date: .abbreviated, time: .shortened)) · may be out of date", systemImage: "wifi.slash")
        .font(.caption).foregroundStyle(.secondary)
}

private func subjectReadingClock(_ subject: ObservedCarProfile) -> String? {
    ProfileClock.date(subject.observed_at).map { "Read " + $0.formatted(date: .abbreviated, time: .shortened) }
}

private struct SubjectPhotoViewer: View {
    let userId: String
    let photo: ObservedCarProfile.Photo
    @EnvironmentObject private var session: SessionStore
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            if session.isSignedIn && ObservedCarRead.ownAccount(userId, activeUserId: SupabaseService.currentUserId) != nil {
                CachedAsyncImage(url: URL(string: photo.image_url)) { image in image.resizable().scaledToFit() }
                    placeholder: { ProgressView().tint(.white) }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .overlay(alignment: .bottom) {
                        Text(ProfileClock.date(photo.taken_at).map { "Captured " + $0.formatted(date: .abbreviated, time: .shortened) } ?? "Capture time unknown")
                            .font(.caption).foregroundStyle(.white).padding().background(.black.opacity(0.65))
                    }
            }
            Button("Close", systemImage: "xmark.circle.fill") { dismiss() }
                .labelStyle(.iconOnly).font(.title2).foregroundStyle(.white).padding()
        }
    }
}
