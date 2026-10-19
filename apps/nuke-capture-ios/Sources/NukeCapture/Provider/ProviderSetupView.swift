// ProviderSetupView.swift — "Set up your technician page" (Account and Work): five optional steps and a checklist.
//
// Records that may be yours (claim a technician record, confirm work recorded under your account, ask to join a
// shop near your photos), your trade (self-described), where and when you work, your tools (seen in your photos
// vs. what you say you own, with the reviewed tool keys each claim meets), and what a visitor sees. Every write
// is a Sign step with "Signing says / It does not say" and an explicit confirm.

import SwiftUI

struct ProviderSetupView: View {
    @State private var suggestions: JobLoad<ProviderSuggestions> = .loading
    @State private var profile: JobLoad<ProviderSetupProfile> = .loading
    @State private var own: OwnProviderRow?
    @State private var keys: [ToolKey] = []
    @State private var pending: PendingSign? { didSet { if pending != nil { note = nil } } }
    @State private var note: String?

    @State private var profession = "mechanic"
    @State private var expertise = ""
    @State private var city = ""
    @State private var stateCode = ""
    @State private var radius = "25"
    @State private var mobile = false
    @State private var timezone = TimeZone.current.identifier
    @State private var days = (0..<7).map { ProviderSetupDrafting.DayDraft(on: (1...5).contains($0), start: "08:00", end: "17:00") }
    @State private var toolName = ""
    @State private var toolCategory = ""
    @State private var seeded = false

    struct PendingSign: Identifiable {
        let id = UUID()
        let title: String
        let says: [String]
        let doesNotSay: [String]
        let confirmTitle: String
        let doneText: String
        let run: () async -> String?
    }

    private var userId: String? { SupabaseService.currentUserId }

    var body: some View {
        List {
            if userId == nil {
                Section { Text("Sign in to set up your technician page.").font(.footnote).foregroundStyle(.secondary) }
            } else {
                checklistSection
                if let note { Section { Label(note, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.orange) } }
                recordsSections
                tradeSection
                whereWhenSections
                toolsSections
                previewSection
            }
        }
        .navigationTitle("Your technician page")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $pending) { p in
            SignStepSheet(title: p.title, says: p.says, doesNotSay: p.doesNotSay, confirmTitle: p.confirmTitle, successTitle: "Done",
                          successDetail: p.doneText, details: { EmptyView() }, confirm: p.run, onDone: { Task { await load() } })
        }
    }

    private func load() async {
        guard let uid = userId else { return }
        async let s = ProviderSetupReaders.suggestions()
        async let p = ProviderSetupReaders.profile(userId: uid)
        async let o = ProviderSetupReaders.own(userId: uid)
        async let k = ProviderSetupReaders.toolKeys()
        (suggestions, profile, own, keys) = await (s, p, o, k)
        if !seeded {
            seeded = true
            if let o = own {
                if let pr = o.profession, ProviderSetupDrafting.professions.contains(where: { $0.key == pr }) { profession = pr }
                expertise = (o.expertise_areas ?? []).joined(separator: ", ")
            }
            if case .loaded(let pr) = profile {
                city = pr.city ?? ""; stateCode = pr.state ?? ""; radius = pr.radius.map(String.init) ?? "25"; mobile = pr.mobile
                if let tz = pr.timezone { timezone = tz }
                if pr.availabilityDeclared {
                    days = (0..<7).map { i in
                        pr.weekly.first { $0.dow == i }.map { .init(on: true, start: $0.start, end: $0.end) } ?? .init(on: false, start: "08:00", end: "17:00")
                    }
                }
            }
        }
    }

    private var loadedProfile: ProviderSetupProfile? { if case .loaded(let p) = profile { return p } else { return nil } }

    // MARK: Checklist

    @ViewBuilder private var checklistSection: some View {
        Section {
            ForEach(ProviderSetupDrafting.checklist(loadedProfile, own: own)) { item in
                Label {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.label).font(.subheadline)
                        Text(item.words).font(.caption).foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: item.state == .done ? "checkmark.circle.fill" : item.state == .partial ? "circle.lefthalf.filled"
                          : item.state == .optional ? "circle.dashed" : "circle")
                        .foregroundStyle(item.state == .done ? .green : .secondary)
                }
            }
        } header: {
            Text("Your page")
        } footer: {
            Text("Keep logging what you do with photos, and Nuke sends you jobs that fit. Each step is optional; skip any and come back.")
        }
    }

    // MARK: Step 1 — records that may be yours

    @ViewBuilder private var recordsSections: some View {
        switch suggestions {
        case .loading:
            Section { Text("Looking for records that name your work…").font(.footnote).foregroundStyle(.secondary) }
        case .refused(let r):
            Section { JobRefusalRow(refusal: r) }
        case .loaded(let s):
            Section("Technician records your work points to") {
                if s.actors.isEmpty {
                    Text("No technician records point to your work yet. As you log work with photos, records can link to you.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(s.actors) { a in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack { Text(a.name).font(.subheadline); Spacer(); Text(a.direct ? "Direct evidence" : "Corroborating only").font(.caption).foregroundStyle(.secondary) }
                        Text(a.evidence).font(.caption).foregroundStyle(.secondary)
                        if let c = a.claim { Text(c).font(.caption2).foregroundStyle(.secondary) }
                        if a.linkedElsewhere {
                            Text("Already linked to another account. Claim it only if it is really you; a reviewer will compare.").font(.caption2).foregroundStyle(.orange)
                        }
                        if let row = a.claimRow {
                            Button("Claim this record") {
                                pending = PendingSign(title: "Claim this technician record",
                                                      says: ["This technician record is you.", "Nuke reviews the evidence above; a person other than you decides."],
                                                      doesNotSay: ["That Nuke has confirmed it", "Any skill, rating or job", "Anyone's contact details"],
                                                      confirmTitle: "Claim it", doneText: "Claim filed. It stays self-claimed until your work backs it up.",
                                                      run: { await ProviderSetupWriters.insert("account_link_claims", row) })
                            }.font(.footnote).buttonStyle(.borderless)
                        }
                    }
                }
            }
            if !s.records.isEmpty {
                Section("Work recorded under your account") {
                    ForEach(s.records) { r in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(r.title).font(.subheadline)
                            if !r.detail.isEmpty { Text(r.detail).font(.caption).foregroundStyle(.secondary) }
                            Text(ProviderSuggestions.confirmation(r.confirmation)).font(.caption2).foregroundStyle(.secondary)
                            if r.confirmation != "confirmed" {
                                Button("Confirm this record") {
                                    pending = PendingSign(title: "Confirm this record", says: ["This record of your work is accurate as shown."],
                                                          doesNotSay: ["Skill evidence — skills come only from attributed work and accepted completions", "Any rate or payment"],
                                                          confirmTitle: "Confirm", doneText: "Confirmed, as your own statement.",
                                                          run: { await ProviderSetupWriters.rpc("confirm_provider_record", ProviderSetupDrafting.confirm(r)) })
                                }.font(.footnote).buttonStyle(.borderless)
                            }
                        }
                    }
                }
            }
            Section("Shops near your photos") {
                if s.shops.isEmpty {
                    Text("No public shops found near your recent geotagged photos.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(s.shops) { o in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(o.name).font(.subheadline)
                        Text(o.evidence).font(.caption).foregroundStyle(.secondary)
                        if let row = o.joinRow {
                            Button("Ask to join") {
                                pending = PendingSign(title: "Ask to join this shop",
                                                      says: ["You ask to join \(o.name) as a contributor.", "The shop's owner or an admin decides."],
                                                      doesNotSay: ["That you are a member until they accept", "Access to the shop's vehicles or records"],
                                                      confirmTitle: "Send request", doneText: "Request sent. It is pending until the shop decides.",
                                                      run: { await ProviderSetupWriters.insert("organization_contributors", row) })
                            }.font(.footnote).buttonStyle(.borderless)
                        }
                    }
                }
            }
        }
    }

    // MARK: Step 2 — trade

    @ViewBuilder private var tradeSection: some View {
        Section {
            Picker("What best describes you", selection: $profession) {
                ForEach(ProviderSetupDrafting.professions, id: \.key) { Text($0.title).tag($0.key) }
            }
            TextField("Expertise, separated by commas", text: $expertise, axis: .vertical).lineLimit(1...3)
            Button("Save your trade") {
                switch ProviderSetupDrafting.trade(profession: profession, expertise: expertise) {
                case .failure(let f): note = f.text
                case .success(let row):
                    guard let uid = userId else { return }
                    pending = PendingSign(title: "Save your trade", says: ["Your trade and expertise appear on your provider page, labelled self-described."],
                                          doesNotSay: ["That Nuke checked it", "Skill evidence — the record shows skills only from work it can see"],
                                          confirmTitle: "Save", doneText: "Saved as self-described.",
                                          run: { await ProviderSetupWriters.saveTrade(userId: uid, row) })
                }
            }
        } header: {
            Text("Your trade")
        } footer: {
            Text("What you say you do. Clients see it marked self-described, apart from what your work record shows.")
        }
    }

    // MARK: Step 3 — where and when

    @ViewBuilder private var whereWhenSections: some View {
        Section {
            if let w = loadedProfile?.areaWords { Text("Now: \(w).").font(.footnote) }
            TextField("City", text: $city)
            TextField("State (two letters)", text: $stateCode).textInputAutocapitalization(.characters)
            LabeledContent("Radius, miles") { TextField("25", text: $radius).keyboardType(.numberPad).multilineTextAlignment(.trailing) }
            Toggle("I travel to the vehicle (mobile)", isOn: $mobile)
            Button("Set service area") {
                switch ProviderSetupDrafting.area(city: city, state: stateCode, radius: radius, mobile: mobile) {
                case .failure(let f): note = f.text
                case .success(let a):
                    pending = PendingSign(title: "Set your service area",
                                          says: ["You work around \(a.p_city), \(a.p_state) within \(a.p_radius_miles) miles\(a.p_mobile ? ", and travel to the vehicle" : "")."],
                                          doesNotSay: ["Your street address or coordinates", "A promise to take any job"],
                                          confirmTitle: "Set service area", doneText: "Service area set. It replaces any earlier one.",
                                          run: { await ProviderSetupWriters.rpc("set_provider_service_area", a) })
                }
            }
        } header: {
            Text("Where you work")
        } footer: {
            Text("A city and a radius only; never a street address.")
        }
        Section {
            if let w = loadedProfile?.weeklyWords { Text("Now: \(w).").font(.footnote) }
            TextField("Timezone", text: $timezone).textInputAutocapitalization(.never).autocorrectionDisabled()
            ForEach(0..<7, id: \.self) { i in
                HStack {
                    Toggle(ProviderSetupProfile.days[i], isOn: $days[i].on).fixedSize()
                    if days[i].on {
                        Spacer()
                        TextField("08:00", text: $days[i].start).frame(width: 56).multilineTextAlignment(.trailing)
                        Text("–")
                        TextField("17:00", text: $days[i].end).frame(width: 56)
                    }
                }
            }
            Button("Set availability") {
                switch ProviderSetupDrafting.availability(timezone: timezone, days: days, keep: loadedProfile?.exceptions ?? []) {
                case .failure(let f): note = f.text
                case .success(let a):
                    pending = PendingSign(title: "Set your availability", says: ["These are the hours you're usually available, in \(timezone)."],
                                          doesNotSay: ["A booking or a promise for any date", "Changes to date exceptions you already set"],
                                          confirmTitle: "Set availability", doneText: "Availability set. It replaces any earlier hours.",
                                          run: { await ProviderSetupWriters.availability(a) })
                }
            }
        } header: {
            Text("When you're usually available")
        }
    }

    // MARK: Step 4 — tools

    @ViewBuilder private var toolsSections: some View {
        Section {
            if let p = loadedProfile, !p.toolsSeen.isEmpty {
                ForEach(p.toolsSeen, id: \.label) { t in RootedValueView(label: t.label, value: "seen \(t.count)×", status: .attributed) }
            } else {
                Text("No tools seen in your analysed photos yet. Photos of your work in progress let Nuke see them.").font(.footnote).foregroundStyle(.secondary)
            }
        } header: {
            Text("Seen in your photos")
        } footer: {
            if let p = loadedProfile { Text("\(p.framesWithTools) of \(p.framesAnalyzed) analysed photos show tools.") }
        }
        Section {
            if let p = loadedProfile, !p.toolsClaimed.isEmpty {
                ForEach(p.toolsClaimed, id: \.category) { c in RootedValueView(label: c.category, value: "\(c.records)", status: .recorded, decay: "self-described") }
            } else {
                Text("None yet.").font(.footnote).foregroundStyle(.secondary)
            }
            TextField("A tool you own, e.g. MIG welder", text: $toolName)
            TextField("Category (optional)", text: $toolCategory)
            if !toolName.trimmingCharacters(in: .whitespaces).isEmpty {
                let k = ProviderSetupDrafting.keys(keys, description: toolName, category: toolCategory)
                Text(k.isEmpty ? "Not in the reviewed tool list yet; it is kept as you wrote it."
                     : "Meets: " + k.map(ProviderSetupDrafting.keyWords).joined(separator: ", "))
                    .font(.caption).foregroundStyle(.secondary)
            }
            Button("Add a tool you own") {
                guard let uid = userId else { return }
                switch ProviderSetupDrafting.tool(userId: uid, description: toolName, category: toolCategory) {
                case .failure(let f): note = f.text
                case .success(let row):
                    pending = PendingSign(title: "Add a tool you own",
                                          says: ["You own: \(row.description)\(row.category.map { " (\($0))" } ?? "").", "It shows on your page as a tool you say you own."],
                                          doesNotSay: ["That anyone checked it in person", "Its value or condition"],
                                          confirmTitle: "Add tool", doneText: "Added as a tool you say you own.",
                                          run: { await ProviderSetupWriters.addTool(row) })
                }
            }
        } header: {
            Text("Tools you say you own")
        } footer: {
            Text("A tool you say you own is your word. A shop or tool owner you have worked with can vouch for you, or co-sign an offer you make on a job.")
        }
    }

    // MARK: Step 5 — preview

    @ViewBuilder private var previewSection: some View {
        Section {
            RootedValueView(label: "Trade", value: ProviderSetupDrafting.professions.first { $0.key == (own?.profession ?? "") }?.title ?? "Not stated",
                            status: .recorded, decay: "self-described")
            if let e = own?.expertise_areas, !e.isEmpty { RootedValueView(label: "Expertise", value: e.joined(separator: ", "), status: .recorded, decay: "self-described") }
            RootedValueView(label: "Works around", value: loadedProfile?.areaWords ?? "Not stated", status: .recorded)
            RootedValueView(label: "Usually available", value: loadedProfile?.weeklyWords ?? "Not stated", status: .recorded)
            RootedValueView(label: "Tools they say they own", value: "\(loadedProfile?.toolRecords ?? 0)", status: .recorded)
            if let uid = userId {
                NavigationLink { List { ProviderFaceSection(userId: uid, showSubject: true) }.navigationTitle("Your page") } label: {
                    Label("Open your page as clients see it", systemImage: "eye")
                }
            }
        } header: {
            Text("What a visitor sees")
        } footer: {
            Text("Self-described rows are labelled as such; skills come only from work Nuke can see. Your contact details are never shown.")
        }
    }

}
