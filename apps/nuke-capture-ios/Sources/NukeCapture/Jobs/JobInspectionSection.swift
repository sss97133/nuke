// JobInspectionSection.swift — inspections on a job, from work_order_inspection_read.
//
// Each inspection: its checklist, the findings recorded against each item (matches the listing /
// doesn't / couldn't tell, severity, photo references), who recorded them (handle or "Unnamed
// party") and whether the seller has agreed to the inspection. Recording findings is the
// inspector's Sign; it is mentioned only when the server offers it to this viewer.

import SwiftUI

struct JobInspectionSection: View {
    let read: JobLoad<InspectionRead>

    var body: some View {
        if case .loaded(let r) = read, !r.inspections.isEmpty {
            ForEach(r.inspections) { doc in
                Section {
                    content(doc)
                    if r.canRecordFindings {
                        Text("You're the inspector. Recording findings from the app is coming soon.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("\(PlanCopy.inspectionTitle(doc.inspectionType)) · \(doc.state == "findings_recorded" ? "Findings recorded" : "Requested")")
                } footer: {
                    Text("Findings are what the inspector recorded, signed through Nuke. No payment is authorized here.")
                }
            }
        }
    }

    @ViewBuilder private func content(_ doc: InspectionDoc) -> some View {
        let permission = PlanCopy.permission(doc.sellerPermission)
        RootedValueView(label: "Seller", value: permission.text, status: permission.status)
        if let by = doc.requestedBy {
            RootedValueView(label: "Ordered by", value: by.text, status: .attributed,
                            decay: JobCopy.day(doc.requestedAt).map { "on \($0)" })
        }
        if let report = doc.currentReport {
            RootedValueView(label: "Inspector", value: report.recordedBy?.text ?? "Unnamed party", status: .proven,
                            decay: JobCopy.day(report.recordedAt).map { "recorded \($0)" })
            if let s = report.summary { Text(s).font(.footnote) }
            if let items = report.items, let covered = report.covered {
                Text("\(covered) of \(items) checklist items have findings").font(.caption).foregroundStyle(.secondary)
            }
        } else {
            RootedValueView(label: "Inspector", value: "No findings yet", status: .pending)
        }
        ForEach(doc.checklist) { item in
            VStack(alignment: .leading, spacing: 3) {
                Text(item.question ?? "Checklist item (wording hidden to protect a name)").font(.footnote)
                let fs = doc.findings(for: item.item_id)
                if fs.isEmpty {
                    Text("Not checked yet").font(.caption2).foregroundStyle(.tertiary)
                }
                ForEach(Array(fs.enumerated()), id: \.offset) { _, f in findingRow(f) }
            }
            .padding(.vertical, 2)
        }
        ForEach(Array(doc.looseFindings.enumerated()), id: \.offset) { _, f in findingRow(f) }
    }

    private func findingRow(_ f: InspectionFinding) -> some View {
        let v = PlanCopy.verdict(f.verdict)
        return RootedValueView(label: f.finding ?? "Finding (wording hidden to protect a name)", value: v.text, status: v.status,
                               decay: [PlanCopy.severity(f.severity), f.evidence_photo_ref == nil ? nil : "1 photo"]
                                   .compactMap { $0 }.joined(separator: " · "))
    }
}
