// IssueQuoteSheet.swift — "Issue quote" / "Revise quote" over issue_work_order_quote.
//
// Lines start from the job's operations and needs (or the current quote's lines when revising), each
// with its pricing basis, price + currency and quantity; an optional deposit request, valid until,
// release conditions from the action's vocabulary, "Quoting says / It does not say", and an explicit
// confirm. Success shows the new version and its short hash.

import SwiftUI

struct IssueQuoteSheet: View {
    let action: JobAction
    let current: Quote?
    var onDone: () -> Void = {}

    @State private var lines: [IssueQuoteDrafting.LineDraft]
    @State private var loadedScope: Bool
    @State private var wantsDeposit = false
    @State private var depositAmount = ""
    @State private var depositCurrency = "USD"
    @State private var wantsValidUntil = false
    @State private var validUntil = Calendar.current.date(byAdding: .day, value: 30, to: Date()) ?? Date()
    @State private var conditions: Set<String> = []
    @State private var days = 7
    @State private var issued: IssuedQuote?

    /// `scope` set (fixtures, or a caller that already read it) skips the live scope read.
    init(action: JobAction, current: Quote?, scope: QuoteScope? = nil, conditions: Set<String> = [], onDone: @escaping () -> Void = {}) {
        self.action = action
        self.current = current
        self.onDone = onDone
        _lines = State(initialValue: scope.map { IssueQuoteDrafting.seed(scope: $0, current: current) } ?? [])
        _loadedScope = State(initialValue: scope != nil)
        _conditions = State(initialValue: conditions)
    }

    private var vocab: [IssueQuoteDrafting.Condition] { IssueQuoteDrafting.vocabulary(action) }

    var body: some View {
        SignStepSheet(title: IssueQuoteCopy.title(action), says: IssueQuoteCopy.says, doesNotSay: IssueQuoteCopy.doesNotSay,
                      saysTitle: "Quoting says",
                      confirmTitle: IssueQuoteDrafting.supersedes(action) == nil ? "Issue the quote" : "Issue the new version",
                      successTitle: issued?.duplicate == true ? "Already issued" : "Quote issued",
                      successDetail: (issued.map { $0.line + ". " } ?? "") + "The customer sees it on the job and can accept it.",
                      details: {
                          if IssueQuoteDrafting.supersedes(action) != nil, let current {
                              Section {
                                  RootedValueView(label: "Replaces", value: "Version \(current.version)", status: .attributed,
                                                  decay: "the customer can only accept the newest version")
                              }
                          }
                          linesSections
                          termsSection
                          releaseSection
                      },
                      confirm: issue, onDone: onDone)
            .task {
                if !loadedScope {
                    let scope = await IssueQuoteReaders.scope(workOrderId: action.args["p_work_order_id"]?.stringValue ?? "")
                    lines = IssueQuoteDrafting.seed(scope: scope, current: current)
                    loadedScope = true
                }
            }
    }

    @ViewBuilder private var linesSections: some View {
        if !loadedScope {
            Section { HStack(spacing: 8) { ProgressView(); Text("Reading the job's work…").font(.footnote).foregroundStyle(.secondary) } }
        }
        ForEach($lines) { $line in
            Section {
                Toggle(isOn: $line.included) {
                    TextField("What this line covers", text: $line.description)
                }
                if line.included {
                    Picker("Priced", selection: $line.basis) {
                        ForEach(IssueQuoteDrafting.Basis.allCases) { Text($0.title).tag($0) }
                    }
                    HStack {
                        TextField("Price", text: $line.amount).keyboardType(.decimalPad)
                        TextField("USD", text: $line.currency).textInputAutocapitalization(.characters).frame(width: 60)
                    }
                    if line.basis != .flat {
                        LabeledContent(line.basis.quantityLabel) {
                            TextField("Optional", text: $line.quantity).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                        }
                    }
                }
            } header: {
                Text(IssueQuoteCopy.refLabel(line.refKind))
            }
        }
        Section {
            Button { lines.append(.fee()) } label: { Label("Add a line", systemImage: "plus") }
        } footer: {
            Text("Lines come from the job's own work and needs; any other charge is a fee line. A line without a price shows as not priced.")
        }
    }

    @ViewBuilder private var termsSection: some View {
        Section {
            Toggle("Ask for a deposit", isOn: $wantsDeposit)
            if wantsDeposit {
                HStack {
                    TextField("Deposit", text: $depositAmount).keyboardType(.decimalPad)
                    TextField("USD", text: $depositCurrency).textInputAutocapitalization(.characters).frame(width: 60)
                }
            }
            Toggle("Valid until a date", isOn: $wantsValidUntil)
            if wantsValidUntil { DatePicker("Valid until", selection: $validUntil, in: Date()..., displayedComponents: .date) }
        } header: {
            Text("Terms")
        } footer: {
            Text("A deposit here is a request in the quote. Nuke records payments; it doesn't move money.")
        }
    }

    @ViewBuilder private var releaseSection: some View {
        if !vocab.isEmpty {
            Section {
                ForEach(vocab) { c in
                    Toggle(isOn: Binding(get: { conditions.contains(c.kind) },
                                         set: { if $0 { conditions.insert(c.kind) } else { conditions.remove(c.kind) } })) {
                        Text(c.takesDays ? "Days have passed since the work was signed off" : ReleaseCopy.condition(ReleaseCondition(kind: c.kind, days: nil)).capitalizedFirst)
                    }
                    if c.takesDays, conditions.contains(c.kind) {
                        Stepper("\(days) day\(days == 1 ? "" : "s") after sign-off", value: $days, in: 1...90)
                    }
                }
            } header: {
                Text("Payment is released when")
            } footer: {
                Text(conditions.isEmpty ? "None chosen: Nuke's standard conditions apply once the quote is accepted."
                     : "Part of the quote the customer accepts. Nuke records when they're met; it doesn't hold or move the money.")
            }
        }
    }

    private func issue() async -> String? {
        switch IssueQuoteDrafting.params(action: action, lines: lines, deposit: wantsDeposit ? (depositAmount, depositCurrency) : nil,
                                         validUntil: wantsValidUntil ? validUntil : nil, conditions: conditions, days: days) {
        case .failure(let f): return f.text
        case .success(let p):
            do {
                let data = try await SupabaseService.client.rpc(action.rpc ?? "issue_work_order_quote", params: p).execute().data
                issued = try? JobReaders.decode(IssuedQuote.self, from: data)
                return nil
            } catch {
                NSLog("NukeCapture issue_work_order_quote failed: %@", String(describing: error))
                return IssueQuoteCopy.failure(error)
            }
        }
    }
}

private extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
