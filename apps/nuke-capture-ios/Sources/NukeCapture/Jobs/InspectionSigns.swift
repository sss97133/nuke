// InspectionSigns.swift — the two inspection Signs, from the job's inspection section.
//
// Record findings (record_inspection_findings) for the accepted inspector, and grant inspection
// access (grant_inspection_access) for the vehicle's verified owner. Each appears only when
// work_order_inspection_read offers it to this viewer for that inspection; the phone passes back
// the offered work order id and decides no eligibility. Drafting validates locally to the Sign's
// shape so the form can say what is missing; the server re-checks everything.

import SwiftUI

extension InspectionRead {
    func findingsAction(for inspectionId: String) -> JobAction? {
        viewer?.actions.first { $0.kind == "record_findings" && InspectionDrafting.offeredId($0) == inspectionId }
    }

    func grantAction(for inspectionId: String) -> JobAction? {
        viewer?.actions.first { $0.kind == "grant_inspection_access" && InspectionDrafting.offeredId($0) == inspectionId }
    }
}

enum InspectionDrafting {
    struct DraftProblem: Error, Equatable { let text: String }

    static let verdicts: [(code: String, title: String)] = [("supports", "Matches the listing"),
                                                            ("contradicts", "Doesn't match"), ("unknown", "Couldn't tell")]
    static let severities: [(code: String, title: String)] = [("info", "For information"), ("monitor", "Keep an eye on it"),
                                                              ("concern", "Concern"), ("critical", "Critical")]
    static let conditions: [(code: String, title: String)] = [("excellent", "Excellent"), ("good", "Good"), ("fair", "Fair"),
                                                              ("rough", "Rough"), ("project", "Project"), ("parts_only", "Parts only")]

    static func offeredId(_ action: JobAction) -> String? {
        action.args["p_inspection_work_order_id"]?.stringValue
    }

    /// One line as the server stores it: newlines become spaces, outer spaces trimmed.
    static func oneLine(_ s: String) -> String {
        s.components(separatedBy: .newlines).joined(separator: " ").trimmingCharacters(in: .whitespaces)
    }

    struct ItemDraft: Equatable {
        var verdict: String? = nil
        var finding: String = ""
        var severity: String = "info"
    }

    struct ExtraDraft: Equatable, Identifiable {
        let id = UUID()
        var finding: String = ""
        var severity: String = "info"
    }

    struct Finding: Encodable, Equatable, Sendable {
        let item_id: String?
        let finding: String
        let severity: String
        let verdict: String?
    }

    struct Findings: Encodable, Equatable, Sendable {
        let summary: String
        let findings: [Finding]
        let overall_condition: String?
    }

    struct FindingsParams: Encodable, Sendable {
        let p_inspection_work_order_id: String
        let p_findings: Findings
    }

    /// The findings report, or the reason it can't be signed yet.
    static func findings(summary: String, items: [(itemId: String, draft: ItemDraft)], extras: [ExtraDraft],
                         condition: String?) -> Result<Findings, DraftProblem> {
        let s = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return .failure(DraftProblem(text: "Write a one-line summary.")) }
        if s.count > 500 { return .failure(DraftProblem(text: "Keep the summary under 500 characters.")) }
        var out: [Finding] = []
        for (id, d) in items where d.verdict != nil {
            let text = oneLine(d.finding)
            if text.isEmpty { return .failure(DraftProblem(text: "Say what you found for each checklist item you answered.")) }
            if text.count > 2000 { return .failure(DraftProblem(text: "Keep each finding under 2,000 characters.")) }
            out.append(Finding(item_id: id, finding: text, severity: d.severity, verdict: d.verdict))
        }
        for e in extras {
            let text = oneLine(e.finding)
            if text.isEmpty { continue }
            if text.count > 2000 { return .failure(DraftProblem(text: "Keep each finding under 2,000 characters.")) }
            out.append(Finding(item_id: nil, finding: text, severity: e.severity, verdict: nil))
        }
        if out.isEmpty { return .failure(DraftProblem(text: "Record at least one finding.")) }
        if out.count > 100 { return .failure(DraftProblem(text: "At most 100 findings in one report.")) }
        return .success(Findings(summary: s, findings: out, overall_condition: condition))
    }

    struct Window: Encodable, Equatable, Sendable {
        let from: String
        let until: String
    }

    struct GrantParams: Encodable, Sendable {
        let p_inspection_work_order_id: String
        let p_scope: String
        let p_window: Window?
    }

    static func iso(_ d: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: d)
    }

    /// The permission, or the reason it can't be signed yet.
    static func grant(inspectionId: String, scope: String, window: (from: Date, until: Date)?, now: Date = Date()) -> Result<GrantParams, DraftProblem> {
        let s = scope.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return .failure(DraftProblem(text: "Say what the inspector may do (for example, where and whether a test drive is allowed).")) }
        if s.count > 2000 { return .failure(DraftProblem(text: "Keep the scope under 2,000 characters.")) }
        var w: Window? = nil
        if let window {
            if window.from >= window.until { return .failure(DraftProblem(text: "The window must end after it starts.")) }
            if window.until <= now { return .failure(DraftProblem(text: "The window must end in the future.")) }
            w = Window(from: iso(window.from), until: iso(window.until))
        }
        return .success(GrantParams(p_inspection_work_order_id: inspectionId, p_scope: s, p_window: w))
    }
}

struct RecordFindingsSheet: View {
    let action: JobAction
    let doc: InspectionDoc
    var onDone: () -> Void = {}

    @State private var summary = ""
    @State private var condition: String? = nil
    @State private var items: [String: InspectionDrafting.ItemDraft] = [:]
    @State private var extras: [InspectionDrafting.ExtraDraft] = []

    private var draft: Result<InspectionDrafting.Findings, InspectionDrafting.DraftProblem> {
        InspectionDrafting.findings(summary: summary,
                                    items: doc.checklist.map { ($0.item_id, items[$0.item_id] ?? .init()) },
                                    extras: extras, condition: condition)
    }

    var body: some View {
        SignStepSheet(title: "Record findings",
                      says: ["What you found on this vehicle, item by item, as the inspector on this job.",
                             "The time you sign."],
                      doesNotSay: ["A price or an approval of any work", "The seller's permission", "Payment"],
                      confirmTitle: "Sign findings", successTitle: "Findings recorded",
                      successDetail: "The job shows your report against its checklist.",
                      confirmEnabled: (try? draft.get()) != nil,
                      details: { form },
                      confirm: submit, onDone: onDone)
    }

    @ViewBuilder private var form: some View {
        Section {
            TextField("One-line summary", text: $summary, axis: .vertical)
            Picker("Overall condition", selection: $condition) {
                Text("Not stated").tag(String?.none)
                ForEach(InspectionDrafting.conditions, id: \.code) { Text($0.title).tag(String?.some($0.code)) }
            }
        } header: { Text("Report") }
        ForEach(doc.checklist) { item in
            Section {
                Picker("Result", selection: binding(item.item_id, \.verdict)) {
                    Text("Not checked").tag(String?.none)
                    ForEach(InspectionDrafting.verdicts, id: \.code) { Text($0.title).tag(String?.some($0.code)) }
                }
                if items[item.item_id]?.verdict != nil {
                    TextField("What you found", text: binding(item.item_id, \.finding))
                    Picker("Severity", selection: binding(item.item_id, \.severity)) {
                        ForEach(InspectionDrafting.severities, id: \.code) { Text($0.title).tag($0.code) }
                    }
                }
            } header: {
                Text(item.question ?? "Checklist item")
            }
        }
        Section {
            ForEach($extras) { $e in
                TextField("Finding", text: $e.finding)
                Picker("Severity", selection: $e.severity) {
                    ForEach(InspectionDrafting.severities, id: \.code) { Text($0.title).tag($0.code) }
                }
            }
            Button { extras.append(.init()) } label: { Label("Add a finding", systemImage: "plus") }
        } header: {
            Text("Other findings")
        } footer: {
            if case .failure(let why) = draft { Text(why.text) }
        }
    }

    private func binding<T>(_ id: String, _ key: WritableKeyPath<InspectionDrafting.ItemDraft, T>) -> Binding<T> {
        Binding(get: { (items[id] ?? .init())[keyPath: key] },
                set: { var d = items[id] ?? .init(); d[keyPath: key] = $0; items[id] = d })
    }

    private func submit() async -> String? {
        guard let id = InspectionDrafting.offeredId(action), id == doc.workOrderId else {
            return "This inspection changed. Refresh the job and try again."
        }
        switch draft {
        case .failure(let why): return why.text
        case .success(let f):
            let p = InspectionDrafting.FindingsParams(p_inspection_work_order_id: id, p_findings: f)
            if case .failure(let e) = await PostJobReaders.write(action.rpc ?? "record_inspection_findings", p) { return e.text }
            return nil
        }
    }
}

struct GrantInspectionAccessSheet: View {
    let action: JobAction
    let doc: InspectionDoc
    var onDone: () -> Void = {}

    @State private var scope = ""
    @State private var limited = false
    @State private var from = Date()
    @State private var until = Date().addingTimeInterval(14 * 24 * 3600)

    private var draft: Result<InspectionDrafting.GrantParams, InspectionDrafting.DraftProblem> {
        InspectionDrafting.grant(inspectionId: doc.workOrderId, scope: scope, window: limited ? (from, until) : nil)
    }

    var body: some View {
        SignStepSheet(title: "Grant inspection access",
                      says: action.binds.isEmpty
                          ? ["Your permission, as the verified owner, for the accepted inspector to inspect this vehicle within the scope you state."]
                          : action.binds.map(JobCopy.signBinds),
                      doesNotSay: action.doesNotBind.isEmpty
                          ? ["Access to your account or records", "Payment", "The sale of the vehicle"]
                          : action.doesNotBind.map(JobCopy.signDoesNotBind),
                      confirmTitle: "Grant access", successTitle: "Access granted",
                      successDetail: "The job shows that you agreed to the inspection.",
                      confirmEnabled: (try? draft.get()) != nil,
                      details: { form },
                      confirm: submit, onDone: onDone)
    }

    @ViewBuilder private var form: some View {
        Section {
            TextField("Where and how (for example: at my home, no test drive)", text: $scope, axis: .vertical)
            Toggle("Only during a time window", isOn: $limited)
            if limited {
                DatePicker("From", selection: $from)
                DatePicker("Until", selection: $until)
            }
        } header: {
            Text("What you're allowing")
        } footer: {
            if case .failure(let why) = draft { Text(why.text) }
        }
    }

    private func submit() async -> String? {
        guard InspectionDrafting.offeredId(action) == doc.workOrderId else {
            return "This inspection changed. Refresh the job and try again."
        }
        switch draft {
        case .failure(let why): return why.text
        case .success(let p):
            if case .failure(let e) = await PostJobReaders.write(action.rpc ?? "grant_inspection_access", p) { return e.text }
            return nil
        }
    }
}
