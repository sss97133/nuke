// ProviderFaceSection.swift — "is this tech any good": the provider face of a profile.
//
// Sections for a List (ProfileView embeds them; a visitor and the person themself see the same
// record). What they say (self-claims, dim, "self-described") stays apart from what the record
// shows (evidence-derived capabilities, tool sightings, vouches, shops, work days, jobs). No
// money, no contact fields, no photos: contact goes through a Nuke request (not built yet).
// The first read of a large record can take several seconds, so loading is calm and retryable.

import SwiftUI

struct ProviderFaceSection: View {
    let userId: String
    var isOwn = false
    /// A standalone page shows who this is; inside ProfileView the identity header already does.
    var showSubject = false

    @State private var profile: JobLoad<ProviderProfile> = .loading
    @State private var jobs: JobLoad<ProviderJobRecord> = .loading
    @State private var slow = false
    @State private var loadingMore = false
    @State private var started = false

    var body: some View {
        ProviderFaceContent(profile: profile, jobs: jobs, isOwn: isOwn, showSubject: showSubject,
                            slow: slow, loadingMore: loadingMore,
                            onRetry: { Task { await load(force: true) } },
                            onLoadMore: { Task { await loadMore() } })
            // Inside a List this fans out to every section the content renders, so the load is idempotent.
            .task(id: userId) { await load(force: false) }
    }

    private func load(force: Bool) async {
        guard force || !started else { return }
        started = true
        profile = .loading
        jobs = .loading
        slow = false
        let watch = Task { @MainActor in
            try? await Task.sleep(for: .seconds(5))
            if case .loading = profile { slow = true }
        }
        async let p = ProviderReaders.profile(userId: userId)
        async let j = ProviderReaders.jobRecord(userId: userId)
        let (loadedProfile, loadedJobs) = await (p, j)
        profile = loadedProfile
        jobs = loadedJobs
        watch.cancel()
    }

    private func loadMore() async {
        guard case .loaded(let page) = jobs, let after = page.nextAfter, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        if case .loaded(let next) = await ProviderReaders.jobRecord(userId: userId, after: after) {
            jobs = .loaded(page.appending(next))
        }
    }
}

/// The render, separated from the reads so fixture snapshots drive it directly.
struct ProviderFaceContent: View {
    let profile: JobLoad<ProviderProfile>
    let jobs: JobLoad<ProviderJobRecord>
    var isOwn = false
    var showSubject = false
    var slow = false
    var loadingMore = false
    var onRetry: (() -> Void)? = nil
    var onLoadMore: (() -> Void)? = nil

    @State private var showAccount = false
    @State private var vouching = false

    var body: some View {
        Group {
            switch profile {
            case .loading:
                Section {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text(slow ? "Still loading — a long record can take a little while the first time." : "Loading their work record…")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Work record")
                }
            case .refused(let refusal):
                Section {
                    JobRefusalRow(refusal: refusal)
                    if refusal.kind == .failed, let onRetry {
                        Button("Try again", action: onRetry)
                    }
                } header: {
                    Text("Work record")
                }
            case .loaded(let p):
                if showSubject, let s = p.subject { subjectSection(s, mine: p.isSelf || isOwn) }
                saysSection(p)
                recordSection(p)
                toolsSections(p)
                shopsSection(p)
                workRecordSection(p).id("provider-work")
                ConcludedJobsSection(jobs: jobs, loadingMore: loadingMore, onLoadMore: onLoadMore).id("provider-jobs")
                linkSection(p)
                contactSection(p)
            }
        }
    }

    private func they(_ p: ProviderProfile, _ selfWords: String, _ otherWords: String) -> String {
        (p.isSelf || isOwn) ? selfWords : otherWords
    }

    // MARK: Who

    @ViewBuilder private func subjectSection(_ s: ProviderProfile.Subject, mine: Bool) -> some View {
        Section {
            RootedValueView(label: "Profile", value: s.name, status: .attributed)
            if let place = s.place {
                RootedValueView(label: "Area", value: place, status: .recorded,
                                decay: mine ? "as published on your profile" : "as published on their profile")
            }
            if let since = JobCopy.day(s.memberSince) {
                RootedValueView(label: "On Nuke since", value: since, status: .attributed)
            }
        }
    }

    // MARK: What they say

    @ViewBuilder private func saysSection(_ p: ProviderProfile) -> some View {
        let rows = Self.claimRows(p.claims, isSelf: p.isSelf || isOwn)
        Section {
            if rows.isEmpty {
                Text(they(p, "You haven't described your work yet.", "Nothing stated."))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(rows, id: \.label) { row in
                RootedValueView(label: row.label, value: row.value, status: .recorded, decay: row.basis)
            }
            if p.isSelf || isOwn {
                Button("Edit what you say") { showAccount = true }
                    .sheet(isPresented: $showAccount) { AccountView() }
            }
        } header: {
            Text(they(p, "What you say", "What they say"))
        } footer: {
            Text("Self-described. Nuke hasn't checked it.")
        }
    }

    /// role and user_type are platform account settings (e.g. "admin", "user"), not trades: a visitor
    /// never sees them as self-description; the person sees them labelled as account settings.
    static func claimRows(_ claims: ProviderProfile.Claims?, isSelf: Bool = false) -> [(label: String, value: String, basis: String)] {
        var rows: [(String, String, String)] = []
        if let a = claims?.account {
            if let v = a.profession, !v.isEmpty { rows.append(("Trade", JobCopy.sentence(v), "self-described")) }
            if !a.expertiseAreas.isEmpty {
                rows.append(("Expertise", a.expertiseAreas.map(JobCopy.sentence).joined(separator: ", "), "self-described"))
            }
            if isSelf {
                if let v = a.role, !v.isEmpty { rows.append(("Account role", JobCopy.sentence(v), "account setting, not shown to visitors")) }
                if let v = a.userType, !v.isEmpty { rows.append(("Account type", JobCopy.sentence(v), "account setting, not shown to visitors")) }
            }
        }
        for r in claims?.actorRecords ?? [] {
            let basis = isSelf ? "stated on your technician profile" : "stated on their technician profile"
            if !r.specialties.isEmpty { rows.append(("Specialties", r.specialties.joined(separator: ", "), basis)) }
            if !r.specialtyMakes.isEmpty { rows.append(("Makes", r.specialtyMakes.joined(separator: ", "), basis)) }
            if !r.specialtyEras.isEmpty { rows.append(("Eras", r.specialtyEras.joined(separator: ", "), basis)) }
            if !r.certifications.isEmpty { rows.append(("Certifications", r.certifications.joined(separator: ", "), basis)) }
            if !r.licenses.isEmpty { rows.append(("Licenses", r.licenses.joined(separator: ", "), basis)) }
            if !r.training.isEmpty { rows.append(("Training", r.training.joined(separator: ", "), basis)) }
            if let y = r.yearsExperience { rows.append(("Experience", "\(y) years", basis)) }
        }
        var seen = Set<String>()
        return rows.filter { seen.insert($0.0).inserted }
    }

    // MARK: What the record shows

    @ViewBuilder private func recordSection(_ p: ProviderProfile) -> some View {
        Section {
            if p.capabilities.isEmpty {
                Text("No skills worked out from evidence yet.").font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(p.capabilities) { c in
                RootedValueView(label: Self.capabilityLabel(c), value: Self.evidenceText(c.evidenceCount), status: .attributed,
                                decay: JobCopy.day(c.lastDemonstrated).map { "last shown \($0)" })
            }
        } header: {
            Text("What the record shows")
        } footer: {
            Text("Worked out from evidence of work. What someone says about themself is never counted here.")
        }
    }

    static func capabilityLabel(_ c: ProviderProfile.Capability) -> String {
        let base = JobCopy.sentence(c.capabilityType)
        guard let tier = c.complexityTier, !tier.isEmpty else { return base }
        return "\(base) · \(JobCopy.sentence(tier).lowercased())"
    }

    static func evidenceText(_ n: Int?) -> String {
        guard let n else { return "Evidence not counted" }
        return n == 1 ? "1 piece of evidence" : "\(JobCopy.count(n)) pieces of evidence"
    }

    // MARK: Tools

    @ViewBuilder private func toolsSections(_ p: ProviderProfile) -> some View {
        if let seen = p.tools?.seenInFrame, seen.state != "not_assessed" {
            Section {
                RootedValueView(label: "Tool sightings", value: JobCopy.count(seen.occurrences ?? 0), status: .attributed,
                                decay: Self.seenCoverage(seen))
                ForEach(seen.topLabels) { l in
                    RootedValueView(label: JobCopy.sentence(l.label), value: "seen \(JobCopy.count(l.occurrences))×", status: .attributed)
                }
            } header: {
                Text(they(p, "Tools seen in your photos", "Tools seen in their photos")).id("provider-tools")
            } footer: {
                Text("Sightings in analysed photos, not a count of distinct tools.")
            }
        }
        if let owned = p.tools?.claimedOwned, owned.state != "not_assessed" {
            Section {
                if owned.categories.isEmpty {
                    Text("No tool records.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(owned.categories, id: \.category) { c in
                    RootedValueView(label: JobCopy.sentence(c.category), value: c.records == 1 ? "1 record" : "\(JobCopy.count(c.records)) records",
                                    status: .recorded, decay: they(p, "from your own records", "from their own records"))
                }
            } header: {
                Text(they(p, "Tools you say you own", "Tools they say they own"))
            } footer: {
                Text(they(p, "From receipts and inventory you keep. Not checked in person.",
                          "From receipts and inventory they keep. Not checked in person."))
            }
        }
        vouchSection(p)
        Section {
            let n = p.tools?.supportingAttestations ?? 0
            if n == 0 {
                Text("No co-signs on jobs yet.").font(.footnote).foregroundStyle(.secondary)
            } else {
                RootedValueView(label: "Co-signs on jobs", value: JobCopy.count(n), status: .attributed,
                                decay: p.tools?.authenticatedAttestations.map { "\($0) signed through Nuke" } ?? "as stated by the co-signers")
            }
        } header: {
            Text("Co-signed on jobs")
        }
    }

    /// Standing vouches, kept apart from skills; others may add theirs (the server decides who can).
    @ViewBuilder private func vouchSection(_ p: ProviderProfile) -> some View {
        Section {
            if p.vouches.isEmpty {
                Text("No one has vouched yet.").font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(p.vouches) { v in
                VStack(alignment: .leading, spacing: 2) {
                    Text(Self.vouchLine(v)).font(.footnote)
                    if let s = v.scope { Text(s).font(.caption).foregroundStyle(.secondary) }
                    Text([JobCopy.day(v.vouched_at).map { "vouched \($0)" }, JobCopy.day(v.expires_at).map { "until \($0)" }]
                        .compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
                }
            }
            if !(p.isSelf || isOwn), SupabaseService.currentUserId != nil, let id = p.subject?.profileId {
                Button { vouching = true } label: { Label("Vouch for this person", systemImage: "hand.thumbsup") }
                    .sheet(isPresented: $vouching) { VouchSheet(subjectUserId: id, subjectName: p.subject?.name ?? "this person") }
            }
        } header: {
            Text("Vouched for by")
        } footer: {
            Text("A vouch is someone's signed word about this person. It isn't counted as skill.")
        }
    }

    static func vouchLine(_ v: ProviderProfile.Vouch) -> String {
        let kinds = (v.kinds ?? []).map(CosignCopy.kind).joined(separator: ", ")
        return (v.voucher?.text ?? "Unnamed party") + (kinds.isEmpty ? "" : ": \(kinds)")
    }

    /// "from 80 of 412 analysed photos · latest 1,000 of 3,200".
    static func seenCoverage(_ s: ProviderProfile.SeenInFrame) -> String? {
        var parts: [String] = []
        if let with = s.framesWithTools, let analysed = s.framesAnalyzed {
            parts.append("from \(JobCopy.count(with)) of \(JobCopy.count(analysed)) analysed photos")
        }
        if let scanned = s.imagesScanned, let eligible = s.imagesEligible, eligible > scanned {
            parts.append("latest \(JobCopy.count(scanned)) of \(JobCopy.count(eligible)) photos")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    // MARK: Shops

    @ViewBuilder private func shopsSection(_ p: ProviderProfile) -> some View {
        let active = p.facilities.filter(\.isActive)
        if !active.isEmpty {
            Section {
                ForEach(active) { f in
                    RootedValueView(label: f.name ?? "Unnamed shop", value: Self.facilityValue(f), status: .attributed,
                                    decay: [JobCopy.relationState(f.relationState), f.city].compactMap { $0 }.joined(separator: " · "))
                }
            } header: {
                Text("Shops")
            } footer: {
                Text(they(p, "Shops with recent activity, and businesses you own.", "Shops with recent activity, and businesses they own."))
            }
        }
    }

    static func facilityValue(_ f: ProviderProfile.Facility) -> String {
        if f.relationKind == "ownership" { return "Owner" }
        return f.role.map(JobCopy.sentence) ?? "Member"
    }

    // MARK: Work record

    @ViewBuilder private func workRecordSection(_ p: ProviderProfile) -> some View {
        Section {
            if let d = p.workDays, d.state != "not_assessed" {
                RootedValueView(label: "Signed work days", value: JobCopy.count(d.signedWorkDays ?? 0), status: .attributed,
                                decay: they(p, "confirmed by you from your photos", "confirmed by them from their photos"))
                RootedValueView(label: "Days with work photos", value: JobCopy.count(d.daysWithCapture ?? 0), status: .attributed)
                if let h = d.captureSpanHours {
                    RootedValueView(label: "Photo time", value: JobCopy.hours(h), status: .pending, decay: "photo time, not hours worked")
                }
            }
            if let j = p.jobs {
                RootedValueView(label: "Jobs", value: JobCopy.count(j.jobs ?? 0), status: .attributed)
                ForEach(j.byRole.keys.sorted(), id: \.self) { role in
                    RootedValueView(label: "As \(JobCopy.role(role))", value: JobCopy.count(j.byRole[role] ?? 0), status: .attributed)
                }
                RootedValueView(label: "Completed, with a date", value: JobCopy.count(j.completionRecorded ?? 0), status: .attributed)
                RootedValueView(label: "Marked done, no date", value: JobCopy.count(j.completionStatusOnly ?? 0), status: .recorded)
                if let n = j.inProgress, n > 0 {
                    RootedValueView(label: "In progress", value: JobCopy.count(n), status: .pending)
                }
                if let n = j.inconsistencies, n > 0 {
                    RootedValueView(label: "Records disagree", value: JobCopy.count(n), status: .conflicting)
                }
            }
        } header: {
            Text("Work record")
        } footer: {
            Text("Completed means a completion date is on record, not that the customer approved the work.")
        }
    }

    // MARK: Link and contact

    @ViewBuilder private func linkSection(_ p: ProviderProfile) -> some View {
        Section {
            if p.isSelf || isOwn {
                NavigationLink {
                    ProviderLinkView()
                } label: {
                    RootedValueView(label: "Technician profile", value: JobCopy.technicianLink(p.identityBridgeState) ?? "Not available",
                                    status: p.identityBridgeState == "evidenced" ? .attributed : .recorded)
                }
            } else {
                RootedValueView(label: "Technician profile", value: JobCopy.technicianLinkOf(p.identityBridgeState),
                                status: p.identityBridgeState == "evidenced" ? .attributed : .recorded)
            }
        }
    }

    @ViewBuilder private func contactSection(_ p: ProviderProfile) -> some View {
        if !(p.isSelf || isOwn) {
            Section {
                ContactViaNukeRow(block: p.contact, recipientName: p.subject?.name ?? "them",
                                  contextLabel: p.subject.map { "Their profile (\($0.name))" })
            } footer: {
                Text(ContactViaNukeRow.footer(p.contact))
            }
        }
    }
}
