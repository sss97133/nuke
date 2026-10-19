// WorkPlanEstimateView.swift — "Plan the work" for a listed vehicle (listing_work_plan_read).
//
// What checking this car would cover, not a restoration price: identity checks first, the
// listing's claims as quoted testimony with their source and clocks, likely work with rough
// uncalibrated hours, the labor rate exactly as returned (a placeholder), only text-matched parts
// (unverified fit), and the pre-purchase checklist an inspection would answer. Ordering the
// inspection is a signed-in Sign step (OrderInspectionSheet).

import SwiftUI

struct WorkPlanEstimateView: View {
    let vehicleId: String

    @State private var plan: JobLoad<WorkPlan>
    @State private var ordering = false
    @State private var orderedJobId: String?
    private let loadOnAppear: Bool

    init(vehicleId: String, plan: JobLoad<WorkPlan> = .loading, loadOnAppear: Bool = true) {
        self.vehicleId = vehicleId
        _plan = State(initialValue: plan)
        self.loadOnAppear = loadOnAppear
    }

    var body: some View {
        List {
            switch plan {
            case .loading:
                Section { HStack(spacing: 8) { ProgressView(); Text("Reading the listing…").font(.footnote).foregroundStyle(.secondary) } }
            case .refused(let refusal):
                Section { JobRefusalRow(refusal: refusal) }
            case .loaded(let p):
                headerSection(p)
                identitySection(p)
                claimsSection(p)
                workSection(p).id("plan-work")
                partsSection(p)
                checklistSection(p).id("plan-checklist")
                orderSection(p)
            }
        }
        .navigationTitle("Plan the work")
        .navigationBarTitleDisplayMode(.inline)
        .task { if loadOnAppear { plan = await PlanReaders.plan(vehicleId: vehicleId) } }
        .refreshable { plan = await PlanReaders.plan(vehicleId: vehicleId) }
        .navigationDestination(item: $orderedJobId) { id in
            JobView(workOrderId: id, titleHint: "Pre-purchase inspection")
        }
    }

    // MARK: Sections

    @ViewBuilder private func headerSection(_ p: WorkPlan) -> some View {
        Section {
            RootedValueView(label: "Vehicle", value: p.vehicleLabel?.text ?? p.recordLabel ?? "Vehicle not named", status: .attributed)
            if let url = p.listingURL, let link = URL(string: url) {
                Link(destination: link) {
                    LabeledContent("Listing") {
                        Text(link.host?.replacingOccurrences(of: "www.", with: "") ?? "Open").font(.footnote)
                    }
                }
            }
        } footer: {
            Text(PlanCopy.headline)
        }
    }

    @ViewBuilder private func identitySection(_ p: WorkPlan) -> some View {
        Section {
            let checks = p.identityChecks
            if checks.isEmpty {
                Text("The details agree across sources (\(p.agreeingFields) checked).").font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(checks, id: \.field) { c in
                RootedValueView(label: PlanCopy.field(c.field), value: c.line,
                                status: c.status == "conflict" ? .conflicting : .pending,
                                decay: PlanCopy.identityStatus(c.status))
            }
            if p.vinDecodeState != nil && p.vinDecodeState != "usable" {
                Text("The VIN couldn't be decoded.").font(.footnote).foregroundStyle(.secondary)
            }
        } header: {
            Text("Check the identity first")
        } footer: {
            Text("A difference doesn't say which source is right. The inspection does.")
        }
    }

    @ViewBuilder private func claimsSection(_ p: WorkPlan) -> some View {
        Section {
            if p.claims.isEmpty {
                Text("No claims read from the listing.").font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(p.claims.prefix(6)) { c in claimRow(c) }
            if p.claims.count > 6 {
                DisclosureGroup("\(p.claims.count - 6) more claims") {
                    ForEach(p.claims.dropFirst(6)) { c in claimRow(c) }
                }
                .font(.footnote)
            }
        } header: {
            Text("What the listing claims")
        } footer: {
            Text(Self.claimsFooter(p))
        }
    }

    static func claimsFooter(_ p: WorkPlan) -> String {
        var parts = ["\(p.claims.count) claim\(p.claims.count == 1 ? "" : "s") read"]
        if p.paraphrasedCount > 0 { parts.append("\(p.paraphrasedCount) paraphrased (no exact quote)") }
        if p.excludedCount > 0 { parts.append("\(p.excludedCount) left out or couldn't be read") }
        return parts.joined(separator: " · ") + ". What the seller says, not checked."
    }

    private func claimRow(_ c: WorkPlan.Claim) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(PlanCopy.claimKind(c.kind)).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text(c.isExactQuote ? "“\(c.quote!)”" : c.text).font(.footnote)
            Text(PlanCopy.claimSource(c)).font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder private func workSection(_ p: WorkPlan) -> some View {
        Section {
            if p.operations.isEmpty {
                Text("No known operations matched the listing's claims.").font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(p.operations) { op in
                VStack(alignment: .leading, spacing: 2) {
                    Text(PlanCopy.system(op.system)).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Text(JobCopy.sentence(op.keywordEntryId ?? op.operationId.replacingOccurrences(of: "op:", with: ""))).font(.footnote)
                }
                ForEach(op.targets) { t in
                    RootedValueView(label: t.name ?? "Operation", value: PlanCopy.hours(t), status: .projected, decay: PlanCopy.roughGuide)
                }
            }
            if let rate = p.rateValue {
                RootedValueView(label: "Labor rate", value: "\(JobMoney.format(rate, "USD")) / hour", status: .projected,
                                decay: "placeholder rate, shown exactly as returned")
            }
        } header: {
            Text("Likely work")
        } footer: {
            if let m = p.matchedClaims, let e = p.eligibleClaims {
                Text("\(m) of \(e) claims matched a known operation. Hours aren't multiplied into a price.")
            }
        }
    }

    @ViewBuilder private func partsSection(_ p: WorkPlan) -> some View {
        Section {
            let rows = p.pricedParts
            if rows.isEmpty {
                Text("No priced parts matched.").font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                RootedValueView(label: r.name ?? "Part", value: r.price_current.map { JobMoney.format($0, r.currency ?? "USD") } ?? "Not priced",
                                status: .projected, decay: "unverified fit")
            }
        } header: {
            Text("Parts")
        } footer: {
            Text("Matched by name only. Fit isn't checked.")
        }
    }

    @ViewBuilder private func checklistSection(_ p: WorkPlan) -> some View {
        Section {
            ForEach(Array(p.checklist.enumerated()), id: \.element.id) { i, item in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(i + 1).").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.question ?? "Checklist item").font(.footnote)
                        if let s = item.system { Text(PlanCopy.system(s)).font(.caption2).foregroundStyle(.tertiary) }
                    }
                }
            }
        } header: {
            Text("Inspection checklist · \(p.checklist.count)")
        } footer: {
            Text("An inspection answers each item with what it found.")
        }
    }

    @ViewBuilder private func orderSection(_ p: WorkPlan) -> some View {
        Section {
            if SupabaseService.currentUserId == nil {
                Label("Sign in to order an inspection", systemImage: "person.crop.circle")
                    .foregroundStyle(.secondary)
            } else if let params = PlanReaders.orderParams(vehicleId: vehicleId, plan: p) {
                Button {
                    ordering = true
                } label: {
                    Label("Order inspection", systemImage: "checklist")
                }
                .sheet(isPresented: $ordering) {
                    OrderInspectionSheet(params: params, plan: p) { id in
                        ordering = false
                        orderedJobId = id
                    }
                }
            } else {
                Text("No checklist to send.").font(.footnote).foregroundStyle(.secondary)
            }
        } footer: {
            Text("Read from the listing and Nuke's records. Nothing was saved and no AI was used to make this page.")
        }
    }
}
