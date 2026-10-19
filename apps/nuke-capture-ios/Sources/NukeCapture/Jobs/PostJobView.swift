// PostJobView.swift — "Post a job" for your own vehicle (post_work_request).
//
// The description in your own words, optional own photos of this vehicle (personal, sensitive,
// misattributed or replaced ones are shown as not attachable, with the reason), an optional
// needed-by date and Open / Invite only. "Posting says / It does not say", then an explicit confirm.
// After posting: what Nuke recorded, the rough hours guide (never a quote) and the new job.

import SwiftUI

struct PostJobView: View {
    let vehicleId: String
    var vehicleTitle: String? = nil
    var photos: [PostJobPhoto]? = nil
    var posted: PostedJob? = nil

    @State private var description = ""
    @State private var chosen: Set<String> = []
    @State private var loadedPhotos: [PostJobPhoto] = []
    @State private var wantsDate = false
    @State private var neededBy = Calendar.current.date(byAdding: .day, value: 14, to: Date()) ?? Date()
    @State private var visibility: PostJobDrafting.Visibility = .open
    @State private var confirming = false
    @State private var busy = false
    @State private var failure: String?
    @State private var notYours = false
    @State private var result: PostedJob?

    init(vehicleId: String, vehicleTitle: String? = nil, photos: [PostJobPhoto]? = nil, posted: PostedJob? = nil,
         description: String = "", chosen: Set<String> = []) {
        self.vehicleId = vehicleId
        self.vehicleTitle = vehicleTitle
        self.photos = photos
        self.posted = posted
        _description = State(initialValue: description)
        _chosen = State(initialValue: chosen)
        _result = State(initialValue: posted)
    }

    private var allPhotos: [PostJobPhoto] { photos ?? loadedPhotos }
    private var eligible: [PostJobPhoto] { allPhotos.filter { $0.refusal == nil } }
    private var refused: [PostJobPhoto] { allPhotos.filter { $0.refusal != nil } }

    var body: some View {
        Form {
            if let result {
                PostedJobSections(posted: result, vehicleTitle: vehicleTitle)
            } else {
                form
            }
        }
        .navigationTitle(result == nil ? "Post a job" : "Job posted")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: vehicleId) {
            if photos == nil, posted == nil { loadedPhotos = await PostJobReaders.photos(vehicleId: vehicleId) }
        }
    }

    @ViewBuilder private var form: some View {
        if let vehicleTitle {
            Section { RootedValueView(label: "Vehicle", value: vehicleTitle, status: .attributed) }
        }
        Section {
            TextField("Describe the work in your own words", text: $description, axis: .vertical)
                .lineLimit(5...12)
            if PostJobDrafting.hasContactDetails(description) {
                Label("This looks like a phone number or email. Take it out.", systemImage: "exclamationmark.triangle")
                    .font(.footnote).foregroundStyle(.orange)
            }
        } header: {
            Text("The work")
        } footer: {
            Text(PostJobCopy.warning + " One sentence per thing to do helps technicians see each part.")
        }
        photosSection
        Section {
            Toggle("Needed by a date", isOn: $wantsDate)
            if wantsDate { DatePicker("Needed by", selection: $neededBy, in: Date()..., displayedComponents: .date) }
            Picker("Who can see it", selection: $visibility) {
                ForEach(PostJobDrafting.Visibility.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
        } header: {
            Text("When and who")
        } footer: {
            Text(visibility.explainer)
        }
        Section("Posting says") {
            ForEach(PostJobCopy.postingSays, id: \.self) { Label($0, systemImage: "checkmark.seal") }
        }
        .font(.footnote)
        Section("It does not say") {
            ForEach(PostJobCopy.postingDoesNotSay, id: \.self) { Label($0, systemImage: "minus.circle").foregroundStyle(.secondary) }
        }
        .font(.footnote)
        Section {
            Button {
                confirming = true
            } label: {
                HStack { Spacer(); if busy { ProgressView() } else { Text("Post the job").bold() }; Spacer() }
            }
            .disabled(busy || description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .confirmationDialog("Post this job?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Post the job") { Task { await post() } }
            } message: {
                Text(visibility == .open ? "Technicians near you will be able to see it." : "It won't be listed.")
            }
            if let failure { Text(failure).font(.footnote).foregroundStyle(.red) }
            if notYours {
                NavigationLink { WorkPlanEstimateView(vehicleId: vehicleId) } label: {
                    Label("Order an inspection instead", systemImage: "magnifyingglass")
                }
            }
        }
    }

    @ViewBuilder private var photosSection: some View {
        Section {
            if allPhotos.isEmpty {
                Text("No photos of yours for this vehicle.").font(.footnote).foregroundStyle(.secondary)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 64), spacing: 6)], spacing: 6) {
                    ForEach(eligible) { p in
                        Button { toggle(p.id) } label: { thumb(p) }.buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 4)
                if !refused.isEmpty {
                    Text(refusedLine).font(.caption).foregroundStyle(.secondary)
                }
            }
        } header: {
            Text("Photos (optional)\(chosen.isEmpty ? "" : " · \(chosen.count) chosen")")
        } footer: {
            Text("Only your own photos of this vehicle. They're attached to the job for the people on it.")
        }
    }

    private var refusedLine: String {
        let reasons = Array(Set(refused.compactMap(\.refusal))).sorted().joined(separator: ", ")
        return "\(refused.count) of your photos can't go with a job: \(reasons)."
    }

    private func thumb(_ p: PostJobPhoto) -> some View {
        ZStack(alignment: .topTrailing) {
            CachedAsyncImage(url: NukeImage.thumb(p.imageURL, width: 160), maxPixel: 160) { img in
                img.resizable().scaledToFill()
            } placeholder: {
                Color.secondary.opacity(0.15)
            }
            .frame(width: 64, height: 64)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            Image(systemName: chosen.contains(p.id) ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(chosen.contains(p.id) ? Color.accentColor : .white)
                .shadow(radius: 1)
                .padding(3)
        }
    }

    private func toggle(_ id: String) {
        if chosen.contains(id) { chosen.remove(id) } else { chosen.insert(id) }
    }

    private func post() async {
        failure = nil
        notYours = false
        switch PostJobDrafting.params(vehicleId: vehicleId, description: description, imageIds: eligible.map(\.id).filter(chosen.contains),
                                      neededBy: wantsDate ? neededBy : nil, visibility: visibility) {
        case .failure(let f):
            failure = f.text
        case .success(let p):
            busy = true
            defer { busy = false }
            switch await PostJobReaders.write("post_work_request", p) {
            case .failure(let f):
                failure = f.text
                notYours = f.text == PostJobCopy.vehicleRefusal
            case .success(let data):
                do { result = try JobReaders.decode(PostedJob.self, from: data) }
                catch { failure = "Posted, but the answer couldn't be read. Find it under Work → Jobs in motion." }
            }
        }
    }
}

/// What post_work_request recorded, the rough hours guide and the way into the new job.
struct PostedJobSections: View {
    let posted: PostedJob
    var vehicleTitle: String? = nil

    var body: some View {
        Section {
            Label(posted.duplicate ? "You already posted this exact job." : "Your job is posted.", systemImage: "checkmark.seal.fill")
                .foregroundStyle(.green)
            Text(PostJobCopy.listing(posted)).font(.footnote)
            if let d = JobCopy.day(posted.neededBy) { RootedValueView(label: "Needed by", value: d, status: .attributed) }
            if posted.photosAttached > 0 {
                RootedValueView(label: "Photos attached", value: JobCopy.count(posted.photosAttached), status: .attributed)
            }
            NavigationLink {
                JobView(workOrderId: posted.workOrderId, titleHint: posted.operations.first?.text, vehicleHint: vehicleTitle)
            } label: {
                Label("Open the job", systemImage: "wrench.and.screwdriver").bold()
            }
            NavigationLink {
                ProviderMatchesView(workOrderId: posted.workOrderId)
            } label: {
                Label("Choose who does it", systemImage: "person.2.wave.2")
            }
        } footer: {
            Text("No one is booked and no one has been notified. Technicians offer; you decide.")
        }
        if !posted.operations.isEmpty {
            Section("What you asked for") {
                ForEach(posted.operations) { op in Text(op.text).font(.footnote) }
            }
        }
        if !posted.requirements.isEmpty {
            Section("Who or what it needs") {
                ForEach(posted.requirements) { r in Text(PostJobCopy.requirement(r)).font(.footnote) }
            }
        }
        if let c = posted.cost {
            Section {
                if let t = PostJobCopy.total(c) {
                    RootedValueView(label: "Rough guide", value: t, status: .pending, decay: "not a quote")
                }
                ForEach(c.lines) { l in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(l.text ?? "Item \(l.line_number)").font(.footnote)
                        Text(PostJobCopy.costLine(l, c)).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Text(PostJobCopy.rate(c)).font(.caption2).foregroundStyle(.secondary)
            } header: {
                Text(PostJobCopy.showsMoney(c) ? "Rough cost" : "Rough hours")
            } footer: {
                Text(PostJobCopy.costLabel + ". Hours are uncalibrated reference figures.")
            }
        }
    }
}
