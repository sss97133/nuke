// JobOperationsSection.swift — the job's operations as a checklist: what was asked for, what is marked done.
//
// Reads work_order_operations_read (anon + authenticated; migration 20261020013500). Each operation
// carries its line status and where its words come from: requested_by_basis authenticated_sign (a
// party signed it through Nuke), source_without_sign (quoted from the work order's own text, or a
// shop record) or not_established (a row with no source). That basis is the row's trust rung. A
// line status of "complete" is the record's mark, not a completion Sign; the completion stage says
// whether anyone signed. The plan stage's inconsistencies say when an operation's source was
// withdrawn or its quoted words left the job text; the reader does not say which operation, so the
// section states that once. Descriptions that name a person arrive withheld for non-parties.

import SwiftUI

enum OperationsChecklist {
    static func rung(_ o: WorkOrderOperations.Operation) -> RootStatus {
        switch o.requestedByBasis {
        case "authenticated_sign"?: return .proven
        case "source_without_sign"?: return .attributed
        default: return .recorded
        }
    }

    static func status(_ s: String?) -> String {
        switch s {
        case "complete"?, "completed"?: return "Marked done"
        case "pending"?: return "Not marked done"
        case "in_progress"?: return "In progress"
        case "cancelled"?: return "Cancelled"
        case let other?: return JobCopy.sentence(other)
        case nil: return "No status"
        }
    }

    static func isDone(_ s: String?) -> Bool { s == "complete" || s == "completed" }

    /// Where the words come from, in plain words.
    static func provenance(_ o: WorkOrderOperations.Operation) -> String {
        switch o.requestedByBasis {
        case "authenticated_sign"?:
            return (OperationsCopy.requestedBy(o.requestedByRole) ?? "asked for") + ", signed through Nuke"
        case "source_without_sign"?:
            if o.requestedByRole == "scope_text_interpretation" {
                return o.descriptionBasis == "scope_description" ? "quoted from the work order's scope"
                    : "quoted from the work order's text"
            }
            return "from the shop's records, unsigned"
        default:
            return "on the record, source not established"
        }
    }

    /// "quoted from the work order's text · needs: skill · 2 specifications".
    static func detail(_ o: WorkOrderOperations.Operation) -> String {
        let needs = Array(Set(o.requirements.compactMap(\.requirement_kind))).sorted().map(OfferCopy.kind).map { $0.lowercased() }
        return [provenance(o),
                needs.isEmpty ? nil : "needs: " + needs.joined(separator: ", "),
                o.specifications == 0 ? nil : "\(o.specifications) specification\(o.specifications == 1 ? "" : "s")"]
            .compactMap { $0 }.joined(separator: " · ")
    }

    /// "15 of 15", over the operations the reader returned.
    static func doneLine(_ ops: [WorkOrderOperations.Operation]) -> String {
        "\(ops.filter { isDone($0.status) }.count) of \(ops.count)"
    }

    static let sourceChangedCodes: Set<String> = ["operation_source_withdrawn", "operation_excerpt_missing_from_scope"]

    /// The plan stage's statement that a source behind the list changed; nil when it states none.
    static func sourceChanged(_ plan: JobStage?) -> String? {
        guard let plan, plan.inconsistencies.contains(where: { sourceChangedCodes.contains($0) }) else { return nil }
        return "A source behind this list was withdrawn or changed. Which operation isn't stated yet."
    }

    /// "32 operations · 32 quoted from the work order's text · 0 marked done · as of Oct 19, 2026 19:02 UTC".
    static func coverage(_ o: WorkOrderOperations) -> String {
        let ops = o.operations
        let quoted = ops.filter { $0.requestedByRole == "scope_text_interpretation" }.count
        let signed = ops.filter { $0.requestedByBasis == "authenticated_sign" }.count
        let unsourced = ops.filter { $0.requestedByBasis != "authenticated_sign" && $0.requestedByBasis != "source_without_sign" }.count
        return ["\(ops.count) operation\(ops.count == 1 ? "" : "s") on record",
                signed == 0 ? nil : "\(signed) signed through Nuke",
                quoted == 0 ? nil : "\(quoted) quoted from the work order's text",
                unsourced == 0 ? nil : "\(unsourced) without a stated source",
                JobClock.text(o.asOf).map { "as of \($0)" }]
            .compactMap { $0 }.joined(separator: " · ")
    }

    static func laborTitle(_ l: WorkOrderOperations.Labor) -> String {
        l.task_name ?? "Labor line (details hidden to protect a name)"
    }
}

struct JobOperationsSection: View {
    let read: JobLoad<WorkOrderOperations>
    let plan: JobStage?

    var body: some View {
        Section {
            switch read {
            case .loading:
                Text("Loading…").font(.footnote).foregroundStyle(.secondary)
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
            case .loaded(let o):
                content(o)
            }
        } header: {
            Text("The work")
        } footer: {
            if case .loaded(let o) = read {
                Text("\(OperationsChecklist.coverage(o)). Marked done is the record's status, not a sign-off.")
            }
        }
    }

    @ViewBuilder private func content(_ o: WorkOrderOperations) -> some View {
        if o.operations.isEmpty {
            if o.labor.isEmpty {
                Text("No operations on record.").font(.footnote).foregroundStyle(.secondary)
            } else {
                Text("No operations on record; the work is listed only as labor lines.").font(.footnote).foregroundStyle(.secondary)
                ForEach(o.labor) { l in
                    RootedValueView(label: OperationsChecklist.laborTitle(l), value: OperationsChecklist.status(l.status),
                                    status: .recorded, decay: "labor line, source not stated")
                }
            }
        } else {
            RootedValueView(label: "Marked done", value: OperationsChecklist.doneLine(o.operations), status: .recorded,
                            decay: "line statuses, not completion Signs")
            if let changed = OperationsChecklist.sourceChanged(plan) {
                RootedValueView(label: "Records disagree", value: changed, status: .conflicting)
            }
            ForEach(o.operations) { op in
                RootedValueView(label: OperationsCopy.title(op), value: OperationsChecklist.status(op.status),
                                status: OperationsChecklist.rung(op), decay: OperationsChecklist.detail(op))
            }
            if !o.parts.isEmpty || !o.labor.isEmpty {
                Text([o.parts.isEmpty ? nil : "\(o.parts.count) part\(o.parts.count == 1 ? "" : "s") on record",
                      o.labor.isEmpty ? nil : "\(o.labor.count) labor line\(o.labor.count == 1 ? "" : "s") on record"]
                        .compactMap { $0 }.joined(separator: " · "))
                    .font(.caption2).foregroundStyle(.tertiary)
            }
        }
    }
}
