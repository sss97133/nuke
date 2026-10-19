// VehicleStatementView.swift — the vehicle's work statement from work_order_statement_read.
//
// Parts and labor (and their totals) are open data. Payments and balances appear only when the
// reader marks the viewer a party (money_visible); otherwise the row says who sees them.
// Contact between people goes through a Nuke contact request, which is not built yet, so the
// button is shown disabled. No contact fields, notes or vehicle identifiers are rendered.

import SwiftUI

struct VehicleStatementView: View {
    let vehicleId: String

    @State private var statement: JobLoad<JobStatement> = .loading

    var body: some View {
        VehicleStatementContent(statement: statement)
            .task(id: vehicleId) { statement = await JobReaders.statement(vehicleId: vehicleId) }
            .refreshable { statement = await JobReaders.statement(vehicleId: vehicleId) }
    }
}

struct VehicleStatementContent: View {
    let statement: JobLoad<JobStatement>

    var body: some View {
        List {
            switch statement {
            case .loading:
                Section {
                    HStack(spacing: 8) { ProgressView(); Text("Loading…").font(.footnote).foregroundStyle(.secondary) }
                }
            case .refused(let refusal):
                Section { JobRefusalRow(refusal: refusal) }
            case .loaded(let s) where s.error != nil || s.workOrders.isEmpty:
                Section {
                    Text("No statement for this vehicle yet.").font(.footnote).foregroundStyle(.secondary)
                }
            case .loaded(let s):
                header(s)
                totals(s)
                ForEach(s.workOrders) { wo in workOrder(wo) }
                contact(s)
            }
        }
        .navigationTitle("Statement")
        .navigationBarTitleDisplayMode(.inline)
    }

    private static func money(_ v: Double?) -> String {
        v.map { JobMoney.format($0, "USD") } ?? "Not recorded"
    }

    @ViewBuilder private func header(_ s: JobStatement) -> some View {
        Section {
            if let v = s.vehicleLabel?.text {
                RootedValueView(label: "Vehicle", value: v, status: .attributed)
            }
            if let shop = s.shop?.name {
                RootedValueView(label: "Shop", value: shop, status: .attributed, decay: s.shop?.place)
            }
        } footer: {
            Text([JobCopy.updated(s.asOf), "Parts and labor are open to everyone."].compactMap { $0 }.joined(separator: " · "))
        }
    }

    @ViewBuilder private func totals(_ s: JobStatement) -> some View {
        Section("Totals") {
            RootedValueView(label: "Parts", value: Self.money(s.totals?.parts), status: .attributed)
            RootedValueView(label: "Labor", value: Self.money(s.totals?.labor), status: .attributed)
            RootedValueView(label: "Subtotal", value: Self.money(s.totals?.subtotal), status: .attributed)
            if let goodwill = s.totals?.goodwill, goodwill > 0 {
                RootedValueView(label: "Goodwill (not charged)", value: Self.money(goodwill), status: .attributed)
            }
            paymentRow("Payments", s.totals?.payments)
            paymentRow("Balance", s.totals?.balance)
        }
    }

    @ViewBuilder private func paymentRow(_ label: String, _ value: Double?) -> some View {
        if let value {
            RootedValueView(label: label, value: Self.money(value), status: .attributed)
        } else {
            RootedValueView(label: label, value: JobCopy.withheldPayments, status: .recorded)
        }
    }

    @ViewBuilder private func workOrder(_ wo: StatementWorkOrder) -> some View {
        Section {
            RootedValueView(label: "Status", value: JobCopy.workStatus(wo.status), status: .recorded)
            RootedValueView(label: "Parts", value: Self.money(wo.partsTotal), status: .attributed)
            RootedValueView(label: "Labor", value: Self.money(wo.laborTotal), status: .attributed)
            if !wo.parts.isEmpty {
                DisclosureGroup("Parts (\(wo.parts.count))") {
                    ForEach(wo.parts) { p in
                        RootedValueView(label: p.name ?? "Part", value: Self.partLine(p), status: .attributed,
                                        decay: p.comped ? "goodwill, not charged" : nil)
                    }
                }
                .font(.footnote)
            }
            if !wo.labor.isEmpty {
                DisclosureGroup("Labor (\(wo.labor.count))") {
                    ForEach(wo.labor) { l in
                        RootedValueView(label: l.name ?? "Labor", value: Self.laborLine(l), status: .attributed,
                                        decay: l.comped ? "goodwill, not charged" : nil)
                    }
                }
                .font(.footnote)
            }
            if let payments = wo.payments {
                ForEach(payments) { pay in
                    RootedValueView(label: "Payment", value: Self.money(pay.amount), status: .attributed,
                                    decay: [JobCopy.day(pay.paymentDate), pay.status.map(JobCopy.sentence)].compactMap { $0 }.joined(separator: " · "))
                }
                if let balance = wo.balanceDue {
                    RootedValueView(label: "Balance", value: Self.money(balance), status: .attributed)
                }
            } else {
                RootedValueView(label: "Payments", value: JobCopy.withheldPayments, status: .recorded)
            }
        } header: {
            Text(wo.displayTitle ?? "Untitled job")
        }
    }

    static func partLine(_ p: StatementLine) -> String {
        let total = money(p.total)
        guard let q = p.quantity, q != 1, let u = p.unitPrice else { return total }
        let qty = q == q.rounded() ? String(Int(q)) : String(q)
        return "\(qty) × \(money(u)) = \(total)"
    }

    static func laborLine(_ l: StatementLine) -> String {
        let total = money(l.total)
        guard let h = l.hours, let r = l.rate else { return total }
        let hours = h == h.rounded() ? String(Int(h)) : String(format: "%.1f", h)
        return "\(hours) h × \(money(r)) = \(total)"
    }

    @ViewBuilder private func contact(_ s: JobStatement) -> some View {
        Section {
            ContactViaNukeRow(block: s.contact, recipientName: s.shop?.name ?? "The people on this job",
                              contextLabel: s.workOrders.first?.displayTitle)
        } footer: {
            Text(ContactViaNukeRow.footer(s.contact))
        }
    }
}
