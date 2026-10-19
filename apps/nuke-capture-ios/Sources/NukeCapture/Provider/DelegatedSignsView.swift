// DelegatedSignsView.swift — the public register of Signs an agent executed on the platform
// owner's behalf, over owner_delegated_signs_read.
//
// Counts by kind of Sign, sign clocks and the authorization clock; arguments, references, agent
// sessions and the authorization wording are withheld by the reader. It shows on the profile of
// the owner the register names, and nowhere else.

import SwiftUI

struct DelegatedSignsView: View {
    @State private var read: JobLoad<DelegatedSigns> = .loading

    var body: some View {
        List { DelegatedSignsContent(read: read, showRecent: true) }
            .navigationTitle("Signed on the owner's behalf")
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
            .refreshable { await load() }
    }

    private func load() async {
        read = await ProviderStandingReaders.delegatedSigns()
    }
}

struct DelegatedSignsContent: View {
    let read: JobLoad<DelegatedSigns>
    var showRecent = false

    var body: some View {
        switch read {
        case .loading:
            Section { ProgressView() } header: { Text("Signed by an agent") }
        case .refused(let refusal):
            Section { JobRefusalRow(refusal: refusal) } header: { Text("Signed by an agent") }
        case .loaded(let r):
            summary(r)
            if showRecent {
                kinds(r)
                recent(r)
            }
        }
    }

    @ViewBuilder private func summary(_ r: DelegatedSigns) -> some View {
        Section {
            RootedValueView(label: "Signs registered", value: ProviderStandingCopy.signs(r.signs), status: .attributed,
                            decay: JobClock.text(r.asOf).map { "as of \($0)" })
            if let n = r.rolledBack {
                RootedValueView(label: "Rolled back", value: ProviderStandingCopy.signs(n), status: n > 0 ? .refuted : .attributed)
            }
            ForEach(r.authorizations, id: \.self) { a in
                RootedValueView(label: "Authorized", value: JobClock.text(a) ?? a, status: .recorded, decay: "owner's recorded authorization")
            }
        } header: {
            Text("Signed by an agent")
        } footer: {
            Text([r.meaning.map(ProviderStandingCopy.sentence), ProviderStandingCopy.withheld(r.withheld)]
                .compactMap { $0 }.joined(separator: " "))
        }
    }

    @ViewBuilder private func kinds(_ r: DelegatedSigns) -> some View {
        if !r.byRpc.isEmpty {
            Section {
                ForEach(r.byRpc) { k in
                    RootedValueView(label: ProviderStandingCopy.rpc(k.rpc), value: ProviderStandingCopy.signs(k.signs), status: .attributed,
                                    decay: ProviderStandingCopy.rpcLine(k))
                }
            } header: {
                Text("By kind")
            }
        }
    }

    @ViewBuilder private func recent(_ r: DelegatedSigns) -> some View {
        if !r.recent.isEmpty {
            Section {
                ForEach(r.recent) { s in
                    RootedValueView(label: ProviderStandingCopy.rpc(s.rpc), value: JobClock.text(s.signedAt) ?? s.signedAt,
                                    status: s.rolledBack ? .refuted : .attributed,
                                    decay: s.rolledBack ? "rolled back" : nil)
                }
            } header: {
                Text("Most recent")
            } footer: {
                if let line = ProviderStandingCopy.shown(r.recent.count, of: r.signs) { Text(line) }
            }
        }
    }
}
