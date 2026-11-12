// GarageInvite.swift — the owner's side of the garage join link: "Invite a technician" mints a link with
// create_garage_join_link and hands it to the share sheet. Server contract: docs/garage-model/JOIN_LINK.md
// (DRAFT functions, not deployed). Without the functions the answer is "Garage invites aren't available yet".
// The raw token exists only in memory here, on the way to the share sheet: it is shown once and never saved.

import Foundation
import Supabase
import SwiftUI
import UIKit

/// One row of garage_my_garages() (core draft): a garage the signed-in user belongs to, with their rank.
struct MyGarage: Decodable, Identifiable, Equatable {
    let garageId: String
    let name: String
    let role: String
    let rank: Int
    let memberStatus: String

    var id: String { garageId }
    /// Only an active manager or above can mint (server: rank >= 80).
    var canInvite: Bool { memberStatus == "active" && rank >= 80 }

    enum CodingKeys: String, CodingKey { case garageId = "garage_id", name, role, rank, memberStatus = "member_status" }
}

struct MintedJoinLink: Equatable {
    let linkId: String
    let token: String
    var url: URL { JoinLink.url(forToken: token) }
}

enum GarageInviteDefaults {
    /// "Invite a technician": the technician role, a link good for ten people and seven days (the server default
    /// expiry), approval required. The owner approves each person; a link alone never admits anyone.
    static let role = "technician"
    static let maxUses = 10
}

protocol GarageInviteBackend {
    func myGarages() async throws -> [MyGarage]
    func mint(garageId: String, role: String, maxUses: Int) async throws -> MintedJoinLink
}

enum GarageInviteService: GarageInviteBackend {
    case live

    private struct MintParams: Encodable { let p_garage: String; let p_role: String; let p_max_uses: Int }
    private struct MintRow: Decodable {
        let linkId: String
        let token: String
        enum CodingKeys: String, CodingKey { case linkId = "link_id", token }
    }

    func myGarages() async throws -> [MyGarage] {
        do { return try await SupabaseService.client.rpc("garage_my_garages").execute().value }
        catch { throw JoinError.from(error) }
    }

    func mint(garageId: String, role: String, maxUses: Int) async throws -> MintedJoinLink {
        do {
            let rows: [MintRow] = try await SupabaseService.client
                .rpc("create_garage_join_link", params: MintParams(p_garage: garageId, p_role: role, p_max_uses: maxUses))
                .execute().value
            guard let row = rows.first, JoinLink.isToken(row.token) else { throw JoinError.failed("The server returned no link.") }
            return MintedJoinLink(linkId: row.linkId, token: row.token)
        } catch { throw JoinError.from(error) }
    }
}

enum GarageInvitePhase: Equatable {
    case idle
    case working
    case chooseGarage([MyGarage])
    case ready(garage: String, link: MintedJoinLink)   // hand `link.url` to the share sheet
    case notAvailable
    case noGarageToManage
    case failed(String)
}

@MainActor
final class GarageInviteModel: ObservableObject {
    @Published private(set) var phase: GarageInvitePhase = .idle
    private let backend: GarageInviteBackend

    init(backend: GarageInviteBackend = GarageInviteService.live) { self.backend = backend }

    /// The "Invite a technician" tap.
    func begin() async {
        phase = .working
        do {
            let garages = try await backend.myGarages().filter(\.canInvite)
            switch garages.count {
            case 0: phase = .noGarageToManage
            case 1: await mint(garages[0])
            default: phase = .chooseGarage(garages)
            }
        } catch {
            phase = Self.phase(for: JoinError.from(error))
        }
    }

    func mint(_ garage: MyGarage) async {
        phase = .working
        do {
            let link = try await backend.mint(garageId: garage.garageId, role: GarageInviteDefaults.role, maxUses: GarageInviteDefaults.maxUses)
            phase = .ready(garage: garage.name, link: link)
        } catch {
            phase = Self.phase(for: JoinError.from(error))
        }
    }

    /// The share sheet closed: the raw token leaves memory.
    func reset() { phase = .idle }

    static func phase(for error: JoinError) -> GarageInvitePhase {
        switch error {
        case .notAvailable: return .notAvailable
        case .notPermitted, .invalid: return .noGarageToManage
        case .signInRequired: return .failed("Sign in to invite people.")
        case .failed(let text): return .failed(text)
        }
    }

    /// The words that go with the link in a message.
    static func shareMessage(garage: String, url: URL) -> String {
        "Join \(garage) on Nuke: \(url.absoluteString)"
    }
}

/// UIActivityViewController for SwiftUI.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    var onDone: () -> Void = {}

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
        vc.completionWithItemsHandler = { _, _, _, _ in onDone() }
        return vc
    }

    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

/// A row for a garage's screen: "Invite a technician". Shows the not-available state in words; never fakes a link.
struct GarageInviteRow: View {
    @StateObject private var model = GarageInviteModel()
    @State private var sharing: (garage: String, url: URL)?

    var body: some View {
        Group {
            Button { Task { await model.begin() } } label: {
                HStack {
                    Label("Invite a technician", systemImage: "person.badge.plus")
                    Spacer()
                    if model.phase == .working { ProgressView() }
                }
            }
            .disabled(model.phase == .working)
            .accessibilityIdentifier("garage.invite.technician")

            switch model.phase {
            case .notAvailable:
                note(JoinError.notAvailableTitle, JoinError.notAvailableDetail)
            case .noGarageToManage:
                note("No garage to invite to", "Only a manager of a garage can send a join link.")
            case .failed(let text):
                note("Couldn't make the link", text)
            case .chooseGarage(let garages):
                ForEach(garages) { g in
                    Button(g.name) { Task { await model.mint(g) } }
                }
            case .idle, .working, .ready:
                EmptyView()
            }
        }
        .onChange(of: model.phase) { _, phase in
            if case .ready(let garage, let link) = phase { sharing = (garage, link.url) }
        }
        .sheet(isPresented: Binding(get: { sharing != nil }, set: { if !$0 { sharing = nil; model.reset() } })) {
            if let sharing {
                ShareSheet(items: [GarageInviteModel.shareMessage(garage: sharing.garage, url: sharing.url)]) {
                    self.sharing = nil
                    model.reset()
                }
                .presentationDetents([.medium, .large])
            }
        }
    }

    private func note(_ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.subheadline.weight(.semibold))
            Text(detail).font(.footnote).foregroundStyle(.secondary)
        }
    }
}
