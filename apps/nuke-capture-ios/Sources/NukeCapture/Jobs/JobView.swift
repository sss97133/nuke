// JobView.swift — one job, from request and quote through payment: header, stage rail, stage detail.
//
// The shared destination pushed from Work (and later Profile, VehicleDetail and Explore). It
// reads work_order_job_path_read and work_order_resources_read and renders what they return:
// each stage on the trust ladder (JobStageRail), its gaps as "What's missing", its
// inconsistencies as disagreeing records, and what the record does not decide (booking,
// permission, payment) as the reader states it. Actions come only from viewer.actions[].
// Nothing here checks sign-in: job data is open by default and the reader decides who reads it.
// Personal contact fields are never rendered; payment and balance amounts need money_visible.

import SwiftUI

struct JobView: View {
    let workOrderId: String
    /// What the pushing row already showed, used until the reader sends its own display fields.
    var titleHint: String? = nil
    var vehicleHint: String? = nil

    @State private var path: JobLoad<JobPath> = .loading
    @State private var resources: JobLoad<JobResources> = .loading
    @State private var quotes: JobLoad<JobQuotes> = .loading
    @State private var offers: JobLoad<WorkOrderOffers> = .loading
    @State private var inspections: JobLoad<InspectionRead> = .loading
    @State private var invoices: JobLoad<WorkOrderInvoices> = .loading
    @State private var evidence: JobLoad<EvidenceCandidates> = .loading
    @State private var facility: JobLoad<JobFacility> = .loading
    @State private var operations: JobLoad<WorkOrderOperations> = .loading
    @State private var attachments: JobLoad<WorkOrderEvidence> = .loading

    var body: some View {
        JobPathContent(workOrderId: workOrderId, path: path, resources: resources, quotes: quotes, offers: offers,
                       inspections: inspections, invoices: invoices, evidence: evidence,
                       facility: facility, operations: operations, attachments: attachments,
                       titleHint: titleHint, vehicleHint: vehicleHint,
                       onChanged: { Task { await load() } })
            .task(id: workOrderId) { await load() }
            .refreshable { await load() }
    }

    private func load() async {
        async let p = JobReaders.jobPath(workOrderId: workOrderId)
        async let r = JobReaders.resources(workOrderId: workOrderId)
        async let q = JobReaders.quotes(workOrderId: workOrderId)
        async let o = OfferReaders.offers(workOrderId: workOrderId)
        async let i = PlanReaders.inspections(workOrderId: workOrderId)
        async let v = CloseoutReaders.invoices(workOrderId: workOrderId)
        async let a = JobEvidenceReaders.evidence(workOrderId: workOrderId)
        async let e = SupabaseService.currentUserId == nil ? JobLoad<EvidenceCandidates>.loading
            : await CloseoutReaders.evidenceCandidates(workOrderId: workOrderId)
        let loaded = await (p, r, q, o, i)
        invoices = await v
        evidence = await e
        attachments = await a
        path = loaded.0
        resources = loaded.1
        quotes = loaded.2
        offers = loaded.3
        inspections = loaded.4
        operations = await IssueQuoteReaders.operations(workOrderId: workOrderId)
        let requirements: [RequirementOffers] = { if case .loaded(let o) = loaded.3 { return o.requirements } else { return [] } }()
        facility = await FacilityReaders.job(workOrderId: workOrderId, requirements: requirements)
    }
}

/// Raw reader codes under the plain words, for development only (DEBUG + NUKE_DEBUG_CODES=1).
enum JobDebug {
    static var showCodes: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.environment["NUKE_DEBUG_CODES"] == "1"
        #else
        return false
        #endif
    }
}

/// The render, separated from the reads so previews and fixture snapshots drive it directly.
struct JobPathContent: View {
    let workOrderId: String
    let path: JobLoad<JobPath>
    let resources: JobLoad<JobResources>
    var quotes: JobLoad<JobQuotes> = .loading
    var offers: JobLoad<WorkOrderOffers>? = nil
    var inspections: JobLoad<InspectionRead>? = nil
    var invoices: JobLoad<WorkOrderInvoices>? = nil
    var evidence: JobLoad<EvidenceCandidates>? = nil
    var facility: JobLoad<JobFacility>? = nil
    var operations: JobLoad<WorkOrderOperations>? = nil
    var attachments: JobLoad<WorkOrderEvidence>? = nil
    var titleHint: String? = nil
    var vehicleHint: String? = nil
    var onChanged: (() -> Void)? = nil

    @State private var accepting: QuoteBox?
    @State private var changing: ChangeBox?
    @State private var issuing: IssueBox?
    @State private var starting: JobAction?
    @State private var paying = false
    @State private var payFailure: String?
    @Environment(\.openURL) private var openURL

    var body: some View {
        List {
            switch path {
            case .loading:
                Section {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Loading job…").font(.footnote).foregroundStyle(.secondary)
                    }
                }
            case .refused(let refusal):
                Section {
                    JobRefusalRow(refusal: refusal)
                    debugId
                }
            case .loaded(let p):
                header(p)
                railSection(p)
                if let start = p.viewer?.actions.first(where: { $0.kind == "start_work" }) {
                    Section {
                        Button { starting = start } label: { Label("Start work", systemImage: "play.circle") }
                    } header: {
                        Text("Your next step")
                            .sheet(item: $starting) { a in
                                StartWorkSheet(action: a, workOrderId: workOrderId, jobTitle: navigationTitle) { onChanged?() }
                            }
                    } footer: {
                        Text("You were accepted for this job. Starting records the time, under exactly what was accepted.")
                    }
                }
                if let operations { JobOperationsSection(read: operations, plan: p.stages[.plan]).id("job-operations") }
                quoteSection.id("job-quote")
                if let offers { JobOffersSection(offers: offers, onChanged: onChanged).id("job-offers") }
                if let facility {
                    JobFacilitySection(workOrderId: workOrderId, facility: facility, onChanged: onChanged)
                        .id("job-facility")
                }
                if let inspections { JobInspectionSection(read: inspections, onSigned: { onChanged?() }) }
                if let completion = CompletionState(path: p) {
                    JobCompletionSection(workOrderId: workOrderId, state: completion, viewerSlots: p.viewer?.slots ?? [],
                                         canMarkDone: { if case .loaded(let r)? = invoices { return r.issueAction != nil } else { return false } }(),
                                         onChanged: onChanged)
                        .id("job-completion")
                }
                if let invoices {
                    JobInvoiceSection(read: invoices, acceptedQuote: acceptedQuote, workOrderId: workOrderId, onChanged: onChanged)
                        .id("job-invoice")
                }
                if let evidence {
                    JobEvidencePrompt(workOrderId: workOrderId, jobTitle: navigationTitle, read: evidence, onChanged: onChanged)
                }
                if let attachments {
                    JobEvidenceSection(read: attachments, operations: { if case .loaded(let o)? = operations { return o } else { return nil } }())
                        .id("job-evidence")
                }
                ForEach(JobStageKey.allCases) { key in
                    stageSection(key, p.stages[key], p)
                }
                if !p.unknownStages.isEmpty {
                    Section {
                        Text(JobCopy.newerVersion(p.unknownStages.count)).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                resourcesSection
                undecidedSection(p)
                actionsSection(p.viewer)
            }
        }
        .navigationTitle(navigationTitle)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $accepting) { box in
            AcceptQuoteSheet(quote: box.quote, action: box.action) { onChanged?() }
        }
        .sheet(item: $changing) { box in
            IssueChangeOrderSheet(action: box.action, quote: box.quote) { onChanged?() }
        }
    }

    /// The current quote when the customer has accepted it (invoices start from its lines).
    private var acceptedQuote: Quote? {
        guard case .loaded(let q) = quotes, q.acceptance?.state == "accepted" else { return nil }
        return q.currentQuote
    }

    /// The job's own title when anyone has it; never an id.
    private var navigationTitle: String {
        if case .loaded(let p) = path, let title = p.displayTitle { return title }
        return titleHint ?? "Job"
    }

    // MARK: Header

    @ViewBuilder private func header(_ p: JobPath) -> some View {
        Section {
            if let v = p.vehicleId, !v.isEmpty {
                NavigationLink {
                    VehicleDetailView(vehicleId: v, embedInNavigationStack: false)
                } label: {
                    RootedValueView(label: "Vehicle", value: p.vehicleLabel?.text ?? vehicleHint ?? "View vehicle",
                                    status: .attributed)
                }
            } else {
                RootedValueView(label: "Vehicle", value: "No vehicle attached", status: .facade)
            }
            if let viewer = p.viewer {
                RootedValueView(label: "You're viewing as", value: JobCopy.viewingAs(viewer), status: .attributed)
            }
            debugId
        } footer: {
            Text([JobCopy.updated(p.asOf), JobCopy.notVerifiedNote].compactMap { $0 }.joined(separator: " · "))
        }
    }

    @ViewBuilder private func railSection(_ p: JobPath) -> some View {
        Section {
            JobStageRail(path: p)
                .padding(.vertical, 4)
        } header: {
            Text("Stages")
        } footer: {
            JobStageRailLegend().padding(.top, 4)
        }
    }

    // MARK: Stage detail

    @ViewBuilder private func stageSection(_ key: JobStageKey, _ stage: JobStage?, _ p: JobPath) -> some View {
        Section {
            if let stage {
                if stage.state == .withheld {
                    Label(JobCopy.withheldPayments, systemImage: "lock")
                        .font(.footnote).foregroundStyle(.secondary)
                } else if let rung = JobRung.status(stage) {
                    RootedValueView(label: "Status", value: JobCopy.stateLine(stage.state), status: rung)
                    ForEach(Self.visibleFacts(stage.facts)) { fact in
                        RootedValueView(label: JobCopy.fact(fact.key),
                                        value: fact.key == "request_source"
                                            ? (p.requestSourceLabel ?? fact.value.stringValue.map(JobCopy.requestSource) ?? JobCopy.value(fact.value))
                                            : JobCopy.factValue(fact.key, fact.value)
                                                ?? Self.factText(fact, moneyVisible: p.viewer?.moneyVisible == true),
                                        status: Self.factStatus(fact, stageRung: JobRung.status(stage.state, hasInconsistency: false) ?? .recorded))
                    }
                }
                JobTestimonyRows(stage: stage)
                ForEach(stage.inconsistencies, id: \.self) { code in
                    RootedValueView(label: "Records disagree", value: JobCopy.conflict(code), status: .conflicting)
                }
                if !stage.gaps.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("What's missing").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        ForEach(stage.gaps, id: \.self) { gap in
                            Label(JobCopy.gap(gap), systemImage: "circle.dashed")
                                .font(.footnote)
                                .foregroundStyle(.primary)
                        }
                    }
                    .padding(.vertical, 4)
                }
                if stage.state == .absent, stage.gaps.isEmpty, stage.inconsistencies.isEmpty {
                    Text("Not started.").font(.footnote).foregroundStyle(.secondary)
                }
                if JobDebug.showCodes {
                    Text(([stage.state.raw] + stage.gaps + stage.inconsistencies).joined(separator: " · "))
                        .font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
                }
            } else {
                RootedValueView(label: "Status", value: "Not available", status: .facade)
            }
        } header: {
            Text("\(key.title) · \(stage.map { JobCopy.state($0.state) } ?? "Not available")")
        }
    }

    // MARK: Resources

    @ViewBuilder private var resourcesSection: some View {
        Section {
            switch resources {
            case .loading:
                Text("Loading…").font(.footnote).foregroundStyle(.secondary)
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let r):
                RootedValueView(label: "Requirements", value: "\(r.requirements)", status: .attributed)
                RootedValueView(label: "Candidates found", value: "\(r.fulfillments)", status: .attributed)
                RootedValueView(label: "Sign-offs", value: "\(r.attestations)", status: .attributed,
                                decay: "as reported by the source")
                RootedValueView(label: "Specifications", value: "\(r.specifications)", status: .attributed)
                ForEach(Self.visibleFacts(r.coverage)) { fact in
                    RootedValueView(label: JobCopy.fact(fact.key), value: JobCopy.value(fact.value), status: .recorded)
                }
            }
        } header: {
            Text("Parts, tools & specs")
        } footer: {
            if case .loaded(let r) = resources, let updated = JobCopy.updated(r.asOf) {
                Text(updated)
            }
        }
    }

    // MARK: What the record does not decide

    @ViewBuilder private func undecidedSection(_ p: JobPath) -> some View {
        Section {
            RootedValueView(label: "Ready to book", value: p.bookingReadiness.map(JobCopy.value) ?? "Not stated", status: .recorded)
            RootedValueView(label: "Permission to work on the vehicle", value: p.permissionAuthority.map(JobCopy.value) ?? "Not stated", status: .recorded)
            RootedValueView(label: "Payment authorized", value: p.paymentAuthorized.map(JobCopy.value) ?? "Not stated", status: .recorded)
        } header: {
            Text("Not decided yet")
        } footer: {
            Text("Nothing on this screen books or approves. Paying an invoice happens only on Stripe's checkout page.")
        }
    }

    // MARK: Actions (server-offered only)

    @ViewBuilder private func actionsSection(_ viewer: JobViewer?) -> some View {
        let allActions = viewer?.actions ?? []
        let payActions = allActions.filter { JobReaders.payArguments($0) != nil }
        let pathActions = allActions.filter { JobReaders.payArguments($0) == nil }
        let accept: (JobAction, Quote)? = {
            if case .loaded(let q) = quotes, let a = q.acceptAction, let cur = q.currentQuote { return (a, cur) }
            return nil
        }()
        Section {
            if let pair = accept {
                Button {
                    accepting = QuoteBox(quote: pair.1, action: pair.0)
                } label: {
                    Label("Accept quote", systemImage: "signature")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            ForEach(payActions) { a in
                Button {
                    Task { await pay(a) }
                } label: {
                    HStack {
                        Label(JobReaders.payAmountText(a).map { "Pay invoice · \($0)" } ?? "Pay invoice", systemImage: "creditcard")
                        Spacer()
                        if paying { ProgressView() }
                    }
                }
                .disabled(paying)
            }
            if let payFailure {
                Text(payFailure).font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(pathActions) { a in
                RootedValueView(label: a.stage.map { JobStageKey(rawValue: $0)?.title ?? JobCopy.sentence($0) } ?? "Next step",
                                value: a.title, status: .pending)
            }
            if accept == nil && pathActions.isEmpty && payActions.isEmpty {
                Text("Nothing for you to do on this job right now.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        } header: {
            Text("Your next steps")
        } footer: {
            if !payActions.isEmpty {
                Text("Pay invoice opens Stripe's secure checkout. Nothing is charged until you finish there.")
            } else if !pathActions.isEmpty {
                Text("Signing these from the app is coming soon.")
            }
        }
    }

    private func pay(_ action: JobAction) async {
        paying = true
        payFailure = nil
        switch await JobReaders.invoiceCheckout(action) {
        case .success(let url): openURL(url)
        case .failure(let f): payFailure = f.text
        }
        paying = false
    }

    // MARK: Quote (work_order_quotes_read; prices are open)

    @ViewBuilder private var quoteSection: some View {
        Section {
            switch quotes {
            case .loading:
                Text("Loading…").font(.footnote).foregroundStyle(.secondary)
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let q):
                if let quote = q.currentQuote {
                    if let party = quote.quotingParty {
                        let row = RootedValueView(label: "Quoted by", value: party.text,
                                                  status: party.signedThroughNuke ? .proven : .attributed,
                                                  decay: party.signedThroughNuke ? "signed through Nuke" : "as recorded")
                        if let profileId = party.profileId {
                            NavigationLink { ProfileView(userId: profileId, isOwn: false) } label: { row }
                        } else {
                            row
                        }
                    }
                    RootedValueView(label: "Version", value: quote.versionLine + (quote.isChangeOrder ? " · Change order" : ""),
                                    status: .attributed)
                    if let co = quote.changeOrder {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Change order").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            if let r = co.reason { Text("Why: \(r)").font(.footnote) }
                            ForEach(co.changes) { c in Text(ChangeOrderCopy.line(c, currency: nil)).font(.footnote) }
                        }
                        .padding(.vertical, 2)
                    }
                    ForEach(quote.lines) { line in
                        RootedValueView(label: JobCopy.lineLabel(line), value: JobCopy.linePrice(line),
                                        status: line.amount == nil ? .recorded : .attributed)
                    }
                    ForEach(Array(quote.totals.enumerated()), id: \.offset) { _, t in
                        let total = JobCopy.total(t)
                        RootedValueView(label: "Total", value: total.value, status: .attributed, decay: total.note)
                    }
                    if quote.unpricedLines > 0 {
                        Text("\(quote.unpricedLines) line\(quote.unpricedLines == 1 ? "" : "s") not priced")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if let deposit = quote.depositRequested {
                        RootedValueView(label: "Deposit requested", value: JobMoney.format(deposit.amount, deposit.currency),
                                        status: .attributed, decay: "a term of the quote, not a payment")
                    }
                    if let until = JobCopy.day(quote.validUntil) {
                        RootedValueView(label: quote.expired ? "Expired" : "Valid until", value: until,
                                        status: quote.expired ? .refuted : .attributed)
                    }
                    if quote.scopeStatus == "changed_since_quote" {
                        RootedValueView(label: "Records disagree", value: "The work changed since this quote", status: .conflicting)
                    }
                    RootedValueView(label: "Acceptance", value: JobCopy.acceptance(q.acceptance),
                                    status: q.acceptance?.state == "accepted" ? .proven
                                        : (q.acceptance?.state == "withheld" ? .conflicting : .pending))
                    ReleaseConditionsRow(conditions: quote.releaseConditions, release: q.release,
                                         accepted: q.acceptance?.state == "accepted")
                    if let a = q.changeOrderAction {
                        Button {
                            changing = ChangeBox(action: a, quote: quote)
                        } label: {
                            Label("Issue change order", systemImage: "arrow.triangle.branch")
                        }
                    }
                    issueButton(q)
                } else {
                    Text(q.history.isEmpty ? "No quote yet." : "No current quote. Earlier versions were withdrawn.")
                        .font(.footnote).foregroundStyle(.secondary)
                    issueButton(q)
                }
            }
        } header: {
            Text("Quote")
                .sheet(item: $issuing) { box in
                    IssueQuoteSheet(action: box.action, current: box.quote) { onChanged?() }
                }
        } footer: {
            Text("Prices are open to everyone. \(JobCopy.withheldPayments).")
        }
    }

    @ViewBuilder private func issueButton(_ q: JobQuotes) -> some View {
        if let a = q.issueQuoteAction {
            Button {
                issuing = IssueBox(action: a, quote: q.currentQuote)
            } label: {
                Label(IssueQuoteCopy.title(a, current: q.currentQuote), systemImage: "doc.badge.plus")
            }
        }
    }

    // MARK: Helpers

    @ViewBuilder private var debugId: some View {
        if JobDebug.showCodes {
            Text(workOrderId).font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
        }
    }

    /// Facts a person may see: never personal contact fields, never reader bookkeeping. Testimony and
    /// filed evidence have their own rows (JobTestimonyRows, JobEvidenceSection).
    static func visibleFacts(_ facts: [JobStage.Fact]) -> [JobStage.Fact] {
        let signedStart = facts.contains { if $0.key == "start_sign", case .object = $0.value { return true } else { return false } }
        return facts.filter {
            !JobWords.isContactKey($0.key) && !JobCopy.hiddenFacts.contains($0.key)
                && $0.key != JobTestimony.factKey && $0.key != WorkOrderEvidence.stageFactKey
                && !(signedStart && $0.key == "start_clock" && $0.value == .null)
        }
    }

    /// Prices, rates and costs are open; a payment or balance amount needs the server's money_visible.
    static func factText(_ fact: JobStage.Fact, moneyVisible: Bool) -> String {
        if case .number = fact.value, JobWords.isPaymentKey(fact.key), !moneyVisible {
            return "Shown to the people on this job"
        }
        return JobCopy.value(fact.value)
    }

    /// A fact the reader states as not established / not assessed is the record of a refusal: dim.
    static func factStatus(_ fact: JobStage.Fact, stageRung: RootStatus) -> RootStatus {
        switch fact.value {
        case .null: return .recorded
        case .string(let s) where s.hasPrefix("not_"): return .recorded
        default: return stageRung
        }
    }
}

private struct IssueBox: Identifiable {
    let action: JobAction
    let quote: Quote?
    var id: String { action.id }
}

private struct ChangeBox: Identifiable {
    let action: JobAction
    let quote: Quote
    var id: String { quote.quoteId }
}

private struct QuoteBox: Identifiable {
    let quote: Quote
    let action: JobAction
    var id: String { quote.quoteId }
}

/// A refusal in plain words: what is unavailable and, in one line, why.
struct JobRefusalRow: View {
    let refusal: JobRefusal

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Label(refusal.title, systemImage: icon)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Text(refusal.detail)
                .font(.footnote)
                .foregroundStyle(.secondary)
            if JobDebug.showCodes {
                Text(refusal.reader)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
    }

    private var icon: String {
        switch refusal.kind {
        case .readerPending: return "clock"
        case .signInNeeded: return "person.crop.circle"
        case .unavailable: return "eye.slash"
        case .notPermitted: return "lock"
        case .signInRefused: return "person.crop.circle.badge.exclamationmark"
        case .failed: return "exclamationmark.triangle"
        }
    }
}
