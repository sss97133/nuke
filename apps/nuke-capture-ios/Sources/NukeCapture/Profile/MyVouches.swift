// MyVouches.swift — Account → "Vouches you've given" over my_vouches_read (authenticated only):
// vouches you signed and vouches of shops you own or belong to, each with its status and, while
// active, Withdraw (withdraw_vouch) from the item's own actions.

import SwiftUI

struct MyVouches: Decodable, Equatable {
    struct Item: Decodable, Equatable, Identifiable {
        let vouchId: String
        let subject: JobPerson?
        let voucher: JobPerson?
        let signedByMe: Bool
        let kinds: [String]
        let scope: String?
        let signedAt: String?
        let expiresAt: String?
        let status: String
        let withdrawnAt: String?
        let actions: [JobAction]
        var id: String { vouchId }

        var withdrawAction: JobAction? { actions.first { $0.kind == "withdraw_vouch" && $0.args["p_id"]?.stringValue == vouchId } }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: JobCodingKey.self)
            vouchId = try c.decode(String.self, forKey: JobCodingKey("vouch_id"))
            subject = try? c.decode(JobPerson.self, forKey: JobCodingKey("subject"))
            voucher = try? c.decode(JobPerson.self, forKey: JobCodingKey("voucher"))
            signedByMe = (try? c.decode(Bool.self, forKey: JobCodingKey("signed_by_me"))) ?? false
            kinds = (try? c.decode([String].self, forKey: JobCodingKey("kinds"))) ?? []
            scope = try? c.decode(String.self, forKey: JobCodingKey("scope"))
            signedAt = try? c.decode(String.self, forKey: JobCodingKey("signed_at"))
            expiresAt = try? c.decode(String.self, forKey: JobCodingKey("expires_at"))
            status = (try? c.decode(String.self, forKey: JobCodingKey("status"))) ?? "active"
            withdrawnAt = try? c.decode(String.self, forKey: JobCodingKey("withdrawn_at"))
            actions = (try? c.decode([Lossy<JobAction>].self, forKey: JobCodingKey("actions")))?.compactMap(\.value) ?? []
        }
    }

    let items: [Item]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        items = (try? c.decode([Lossy<Item>].self, forKey: JobCodingKey("items")))?.compactMap(\.value) ?? []
    }
}

enum VouchCopy {
    static func status(_ s: String) -> String {
        switch s {
        case "active": return "Standing"
        case "expired": return "Expired"
        case "withdrawn": return "Withdrawn"
        case "superseded": return "Replaced by a newer vouch"
        default: return JobCopy.sentence(s)
        }
    }

    /// "For @fixture_tech: supervision, suitability".
    static func line(_ i: MyVouches.Item) -> String {
        let kinds = i.kinds.map(CosignCopy.kind).joined(separator: ", ")
        return "For \(i.subject?.text ?? "Unnamed party")" + (kinds.isEmpty ? "" : ": \(kinds)")
    }

    /// "Signed by you" or "Fixture Garage's vouch".
    static func signer(_ i: MyVouches.Item) -> String {
        if i.voucher?.kind == "organization", let n = i.voucher?.name { return i.signedByMe ? "\(n)'s vouch, signed by you" : "\(n)'s vouch" }
        return "Signed by you"
    }

    static func dates(_ i: MyVouches.Item) -> String {
        [JobCopy.day(i.signedAt).map { "signed \($0)" }, JobCopy.day(i.expiresAt).map { "until \($0)" },
         JobCopy.day(i.withdrawnAt).map { "withdrawn \($0)" }].compactMap { $0 }.joined(separator: " · ")
    }

    struct WithdrawParams: Encodable, Equatable, Sendable { let p_id: String }

    /// Only from the item's own withdraw action.
    static func withdraw(_ action: JobAction?, vouchId: String) -> WithdrawParams? {
        guard let action, action.kind == "withdraw_vouch", (action.rpc ?? "withdraw_vouch") == "withdraw_vouch",
              let id = action.args["p_id"]?.stringValue, id == vouchId else { return nil }
        return WithdrawParams(p_id: id)
    }
}

struct MyVouchesView: View {
    @State private var read: JobLoad<MyVouches> = .loading

    var body: some View {
        MyVouchesContent(read: read) { Task { await load() } }
            .task { await load() }
            .refreshable { await load() }
    }

    private func load() async {
        read = await JobReaders.call("my_vouches_read") { try await SupabaseService.client.rpc("my_vouches_read").execute().data }
    }
}

struct MyVouchesContent: View {
    let read: JobLoad<MyVouches>
    var onChanged: (() -> Void)? = nil

    @State private var confirming: MyVouches.Item?
    @State private var failure: String?
    @State private var withdrawn: Set<String> = []

    var body: some View {
        List {
            switch read {
            case .loading:
                Section { ProgressView() }
            case .refused(let r):
                Section { JobRefusalRow(refusal: r) }
            case .loaded(let v):
                Section {
                    if v.items.isEmpty {
                        Text("You haven't vouched for anyone yet.").font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(v.items) { i in row(i) }
                } footer: {
                    Text("A vouch is your signed word about someone, within the scope you wrote. It isn't counted as their skill.")
                }
                if let failure { Section { Text(failure).font(.footnote).foregroundStyle(.red) } }
            }
        }
        .navigationTitle("Vouches you've given")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Withdraw this vouch?", isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
                            titleVisibility: .visible, presenting: confirming) { i in
            Button("Withdraw", role: .destructive) { Task { await withdraw(i) } }
        } message: { _ in
            Text("It stops showing on their profile. The record that you vouched stays.")
        }
    }

    @ViewBuilder private func row(_ i: MyVouches.Item) -> some View {
        let gone = withdrawn.contains(i.vouchId)
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(VouchCopy.line(i)).font(.subheadline)
                Spacer()
                Text(gone ? "Withdrawn" : VouchCopy.status(i.status)).font(.caption)
                    .foregroundStyle(i.status == "active" && !gone ? .green : .secondary)
            }
            if let s = i.scope { Text(s).font(.footnote).foregroundStyle(.secondary) }
            Text([VouchCopy.signer(i), VouchCopy.dates(i)].filter { !$0.isEmpty }.joined(separator: " · "))
                .font(.caption2).foregroundStyle(.tertiary)
            if !gone, i.withdrawAction != nil {
                Button("Withdraw", role: .destructive) { confirming = i }.font(.footnote).buttonStyle(.borderless)
            }
        }
        .padding(.vertical, 2)
    }

    private func withdraw(_ i: MyVouches.Item) async {
        guard let p = VouchCopy.withdraw(i.withdrawAction, vouchId: i.vouchId) else { return }
        switch await CosignWriters.write("withdraw_vouch", p) {
        case .failure(let f): failure = f.text
        case .success: failure = nil; withdrawn.insert(i.vouchId); onChanged?()
        }
    }
}
