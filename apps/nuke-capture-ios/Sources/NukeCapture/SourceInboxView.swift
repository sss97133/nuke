import SwiftUI
import Supabase

enum SourceInboxReader {
    private struct Scope: Encodable {
        let limit = 24
        let cursor: String?
        let image_id: String?
    }
    private struct Request: Encodable {
        let mode = "read_subjects"
        let user_id: String
        let source_inbox: Scope
    }
    static func read(userId: String, cursor: String? = nil, imageId: UUID? = nil) async throws -> SourceInboxRead {
        guard let owner = ObservedCarRead.ownAccount(userId, activeUserId: SupabaseService.currentUserId),
              cursor.map({ !$0.isEmpty && $0.count <= 512 }) ?? true else { throw CocoaError(.userCancelled) }
        let result: SourceInboxRead = try await SupabaseService.client.functions.invoke("check-image-vehicle-match",
            options: FunctionInvokeOptions(body: Request(user_id: owner,
                source_inbox: Scope(cursor: cursor, image_id: imageId?.uuidString.lowercased()))))
        guard ObservedCarRead.ownAccount(userId, activeUserId: SupabaseService.currentUserId) == owner,
              result.isQualified, result.next_cursor == nil || result.next_cursor != cursor,
              imageId == nil || result.photos.allSatisfy({ $0.id == imageId }) else { throw CocoaError(.coderInvalidValue) }
        return result
    }
}

struct SourceInboxSection: View {
    let userId: String
    @EnvironmentObject private var session: SessionStore
    var body: some View {
        if session.isSignedIn && ObservedCarRead.ownAccount(userId, activeUserId: SupabaseService.currentUserId) != nil {
            Section("Photo sources") {
                NavigationLink { SourceInboxView(userId: userId) } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Uploaded photos")
                            Text("Individual sources, including unknown subjects and earlier uploads")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    } icon: { Image(systemName: "photo.on.rectangle") }
                }
            }
        }
    }
}

struct SourceInboxView: View {
    let userId: String
    @EnvironmentObject private var session: SessionStore
    @State private var pages: [SourceInboxRead] = []
    @State private var savedAt: Date?
    @State private var failure: String?
    @State private var loading = false
    @State private var generation = UUID()
    private var allowed: Bool { session.isSignedIn && ObservedCarRead.ownAccount(userId, activeUserId: SupabaseService.currentUserId) != nil }

    var body: some View {
        List {
            if allowed {
                Section {
                    Text("Private source photos. A photograph can remain useful while its subject is unknown.")
                        .font(.footnote).foregroundStyle(.secondary)
                    if let savedAt {
                        Text("Saved \(savedAt.formatted(date: .abbreviated, time: .shortened)). Refresh to check current source visibility.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                ForEach(Array(pages.enumerated()), id: \.offset) { _, page in
                    Section {
                        ForEach(page.photos) { photo in
                            NavigationLink { SourcePhotoDetail(userId: userId, imageId: photo.id) } label: {
                                SourcePhotoRow(photo: photo, showPixels: savedAt == nil)
                            }
                        }
                    } footer: { SourceInboxCoverageView(coverage: page.coverage) }
                }
                if pages.first?.photos.isEmpty == true { Text("No uploaded source rows in this read.").foregroundStyle(.secondary) }
                if let failure { Text(failure).font(.caption).foregroundStyle(.secondary) }
                if loading { ProgressView() }
                else if let cursor = pages.last?.next_cursor {
                    Button("Earlier uploaded photos") { Task { await load(cursor: cursor) } }
                }
            } else { Text("Sign in to your own photo record.") }
        }
        .navigationTitle("Uploaded photos").navigationBarTitleDisplayMode(.inline)
        .toolbar { if allowed { ToolbarItem(placement: .topBarTrailing) {
            Button("Refresh", systemImage: "arrow.clockwise") { Task { await load() } }
        } } }
        .task(id: userId) { await load() }
        .onReceive(NotificationCenter.default.publisher(for: SubjectResolutionEngine.didChange)) { _ in
            guard allowed else { return }
            Task { await load() }
        }
    }

    @MainActor private func load(cursor: String? = nil) async {
        guard allowed else { pages = []; savedAt = nil; return }
        let request = UUID(); generation = request
        if cursor == nil { pages = []; savedAt = nil }
        loading = true; failure = nil
        defer { if generation == request { loading = false } }
        do {
            let read = try await SourceInboxReader.read(userId: userId, cursor: cursor)
            guard generation == request, allowed else { return }
            let existing = Set(pages.flatMap(\.photos).map(\.id))
            guard cursor == nil || read.photos.allSatisfy({ !existing.contains($0.id) }) else { throw CocoaError(.coderInvalidValue) }
            let page = cursor == nil ? 0 : pages.count
            if cursor == nil { pages = [read] } else { pages.append(read) }
            savedAt = nil
            do { try LocalStore.shared.cacheSourceInbox(userId: userId, activeUserId: SupabaseService.currentUserId, page: page, read: read) }
            catch { failure = "Live source read loaded; couldn't save it for offline use." }
        } catch {
            guard generation == request, allowed else { return }
            failure = ReadFailure.text(error)
            if cursor == nil, let cached = try? LocalStore.shared.cachedSourceInbox(userId: userId, activeUserId: SupabaseService.currentUserId) {
                pages = [cached.read]; savedAt = cached.cachedAt
            }
        }
    }
}

private struct SourcePhotoRow: View {
    let photo: SourceInboxRead.Photo
    let showPixels: Bool
    var body: some View {
        HStack(spacing: 12) {
            Color(.secondarySystemFill).frame(width: 76, height: 64).overlay {
                if showPixels, let url = photo.image_url {
                    CachedAsyncImage(url: NukeImage.thumb(url, width: 180)) { image in image.resizable().scaledToFit() }
                        placeholder: { ProgressView() }
                } else { Image(systemName: "photo").foregroundStyle(.secondary) }
            }.clipped().clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 4) {
                RootedValueView(label: "Source", value: sourceLabel(photo), status: .recorded,
                    decay: ProfileClock.date(photo.created_at).map { "Uploaded " + $0.formatted(date: .abbreviated, time: .shortened) })
                Text(subjectLabel(photo)).font(.caption).foregroundStyle(.secondary)
            }
        }.padding(.vertical, 3)
    }
}

private struct SourcePhotoDetail: View {
    let userId: String
    let imageId: UUID
    @EnvironmentObject private var session: SessionStore
    @State private var read: SourceInboxRead?
    @State private var savedAt: Date?
    @State private var failure: String?
    @State private var generation = UUID()
    private var allowed: Bool { session.isSignedIn && ObservedCarRead.ownAccount(userId, activeUserId: SupabaseService.currentUserId) != nil }
    var body: some View {
      ScrollViewReader { source in
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if allowed, let photo = read?.photos.first(where: { $0.id == imageId }) {
                    if savedAt == nil, let url = photo.image_url {
                        CachedAsyncImage(url: NukeImage.thumb(url, width: 1600)) { image in image.resizable().scaledToFit() }
                            placeholder: { ProgressView() }
                            .id("qualified-source-photo")
                    }
                    RootedValueView(label: "Source", value: sourceLabel(photo), status: .recorded)
                    RootedValueView(label: "Capture time", value: ProfileClock.date(photo.taken_at).map {
                        $0.formatted(date: .abbreviated, time: .shortened)
                    } ?? "Unknown", status: .recorded)
                    Text(subjectLabel(photo)).font(.footnote).foregroundStyle(.secondary)
                    if let savedAt { Text("Saved \(savedAt.formatted()). Current source visibility is unavailable.").font(.caption).foregroundStyle(.secondary) }
                    ForEach(photo.readings) { reading in
                        VStack(alignment: .leading, spacing: 5) {
                            RootedValueView(label: "Frame interpretation", value: frameLabel(reading.frame), status: .projected,
                                decay: ProfileClock.date(reading.read_at).map { "Read " + $0.formatted(date: .abbreviated, time: .shortened) },
                                onDrill: savedAt == nil && photo.image_url != nil ? {
                                    withAnimation { source.scrollTo("qualified-source-photo", anchor: .top) }
                                } : nil)
                            Text("\(reading.provider) · \(reading.model)").font(.caption).foregroundStyle(.secondary)
                            ForEach(reading.unresolved_reasons, id: \.self) { reason in
                                Text(SubjectResolutionCopy.reason(reason)).font(.caption).foregroundStyle(.secondary)
                            }
                            DisclosureGroup("Source evidence") {
                                Text("Observation \(reading.id.uuidString.lowercased())")
                                Text("Source SHA-256 \(reading.input.source_sha256)")
                                Text("Consumed SHA-256 \(reading.input.input_sha256)")
                            }.font(.caption2).textSelection(.enabled)
                        }
                    }
                    if photo.attached_vehicle_id_context != nil {
                        Text("An existing filing is recorded. This source read does not qualify that vehicle identity.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if let coverage = read?.coverage { SourceInboxCoverageView(coverage: coverage) }
                } else if read != nil { Text("Source unavailable in this read.").foregroundStyle(.secondary) }
                else if failure == nil { ProgressView() }
                if let failure { Text(failure).font(.caption).foregroundStyle(.secondary) }
            }.padding()
        }
        .navigationTitle("Source photo").navigationBarTitleDisplayMode(.inline)
        .toolbar { if allowed { ToolbarItem(placement: .topBarTrailing) {
            Button("Refresh", systemImage: "arrow.clockwise") { Task { await load() } }
        } } }
        .task(id: imageId) { await load() }
        .onReceive(NotificationCenter.default.publisher(for: SubjectResolutionEngine.didChange)) { _ in
            guard allowed else { return }
            Task { await load() }
        }
      }
    }

    @MainActor private func load() async {
        guard allowed else { read = nil; return }
        let request = UUID(); generation = request
        failure = nil; read = nil; savedAt = nil
        do {
            let result = try await SourceInboxReader.read(userId: userId, imageId: imageId)
            guard generation == request, allowed else { return }
            read = result
            do { try LocalStore.shared.cacheSourceInbox(userId: userId, activeUserId: SupabaseService.currentUserId, imageId: imageId, read: result) }
            catch { failure = "Live source read loaded; couldn't save it for offline use." }
        } catch {
            guard generation == request, allowed else { return }
            failure = ReadFailure.text(error)
            if let cached = try? LocalStore.shared.cachedSourceInbox(userId: userId, activeUserId: SupabaseService.currentUserId, imageId: imageId) {
                read = cached.read; savedAt = cached.cachedAt
            }
        }
    }
}

private struct SourceInboxCoverageView: View {
    let coverage: SourceInboxRead.Coverage
    var body: some View {
        RootedValueView(label: "Source records in this page", value: "\(coverage.returned) of \(coverage.assessed) retained; \(coverage.displayable) with displayable pixels",
            status: .recorded, decay: ProfileClock.date(coverage.as_of).map { "As of " + $0.formatted(date: .abbreviated, time: .shortened) })
        Text("Account and accessible device-library totals are unknown." + (coverage.truncated ? " This is a bounded read." : ""))
            .font(.caption2).foregroundStyle(.secondary)
    }
}

private func sourceLabel(_ photo: SourceInboxRead.Photo) -> String {
    switch photo.source_state {
    case "ready": return "Uploaded photo"
    case "metadata_only": return "Pixels not retained; reason unknown"
    case "held": return "Source held or awaiting its privacy gate"
    default: return "Source needs investigation"
    }
}
private func subjectLabel(_ photo: SourceInboxRead.Photo) -> String {
    switch photo.subject_analysis_state {
    case "current_readings": return "Retained interpretations · this read does not establish identity"
    case "not_read": return "No retained subject reading in this scope"
    case "reading_withdrawn": return "Earlier subject reading withdrawn"
    case "reading_no_longer_qualified": return "Earlier reading no longer qualifies"
    default: return "Subject reading scope not assessed"
    }
}
private func frameLabel(_ frame: SourceInboxRead.Photo.Reading.Frame?) -> String {
    guard let frame else { return "Unknown subject and view" }
    return "\(frame.primary_subject.replacingOccurrences(of: "_", with: " ")) · \(frame.view) view"
}
