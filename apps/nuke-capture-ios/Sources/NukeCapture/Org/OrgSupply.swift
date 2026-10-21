// OrgSupply.swift — businesses as suppliers: work recorded on Nuke, claiming a business, and inviting one.
//
// Read with pg_get_functiondef on 2026-10-19:
// - organization_supply_read(p_organization_id): on_nuke (Claimed on Nuke / Not on Nuke yet, the claim methods and
//   website domain), work_recorded_on_nuke (supply kinds with times and first/last dates; amounts, payers and line
//   text are withheld).
// - requirement_plan_b_suppliers, carried as open_requirements_read rows' plan_b_suppliers: businesses this kind of
//   thing was paid for before on Nuke ("paid for this before on Nuke (n times)"), each with its on_nuke state.
// - claim_organization(p_organization_id, p_method domain_email | document, p_evidence): domain e-mail grants owner
//   at once; a document goes to a reviewer and grants nothing until then.
// - create_supplier_invite(p_organization_id, p_requirement_id): the job's customer gets a single-use link to share
//   with a business not on Nuke yet; Nuke sends nothing. share_path is /supplier-invite/<token>, which the web
//   redeems (SupplierInvitePage); the app opens that link as the same page in an in-app browser (AppLink).

import SwiftUI
import Supabase

struct OnNuke: Decodable, Equatable {
    let state: String
    let label: String?
    let methods: [String]
    let domain: String?

    var claimed: Bool { state == "claimed" }

    init(state: String, label: String? = nil, methods: [String] = [], domain: String? = nil) {
        self.state = state; self.label = label; self.methods = methods; self.domain = domain
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        struct Claim: Decodable { let methods: [String]?; let domain: String? }
        let claim = try? c.decode(Claim.self, forKey: JobCodingKey("claim"))
        self.init(state: (try? c.decode(String.self, forKey: JobCodingKey("state"))) ?? "not_on_nuke_yet",
                  label: try? c.decode(String.self, forKey: JobCodingKey("label")), methods: claim?.methods ?? [], domain: claim?.domain)
    }

    var words: String { label ?? (claimed ? "Claimed on Nuke" : "Not on Nuke yet") }
}

/// One business a requirement's kind of thing was paid for before on Nuke.
struct PlanBSupplier: Decodable, Equatable, Identifiable {
    let organizationId: String
    let name: String?
    let times: Int
    let lastOn: String?
    let onNuke: OnNuke?
    var id: String { organizationId }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        struct Org: Decodable { let organization_id: String; let name: String? }
        let org = try c.decode(Org.self, forKey: JobCodingKey("organization"))
        organizationId = org.organization_id
        name = org.name
        times = (try? c.decode(Int.self, forKey: JobCodingKey("times"))) ?? 0
        lastOn = try? c.decode(String.self, forKey: JobCodingKey("last_on"))
        onNuke = try? c.decode(OnNuke.self, forKey: JobCodingKey("on_nuke"))
    }

    /// "Fixture Garage · Paid for this before on Nuke (3 times) · Not on Nuke yet".
    var line: String {
        [name ?? "Unnamed business", "Paid for this before on Nuke (\(times) time\(times == 1 ? "" : "s"))", onNuke?.words].compactMap { $0 }.joined(separator: " · ")
    }
}

struct OrgSupply: Decodable, Equatable {
    struct Kind: Decodable, Equatable, Identifiable {
        let supply_kind: String
        let times: Int
        let first_on: String?
        let last_on: String?
        var id: String { supply_kind }
    }

    let name: String?
    let profilePublic: Bool
    let onNuke: OnNuke
    let kinds: [Kind]
    let records: Int

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        struct Org: Decodable { let name: String? }
        struct Work: Decodable { let kinds: [Lossy<Kind>]?; let records: Int? }
        name = (try? c.decode(Org.self, forKey: JobCodingKey("organization")))?.name
        profilePublic = (try? c.decode(Bool.self, forKey: JobCodingKey("profile_public"))) == true
        onNuke = (try? c.decode(OnNuke.self, forKey: JobCodingKey("on_nuke"))) ?? OnNuke(state: "not_on_nuke_yet")
        let w = try? c.decode(Work.self, forKey: JobCodingKey("work_recorded_on_nuke"))
        kinds = w?.kinds?.compactMap(\.value) ?? []
        records = w?.records ?? 0
    }
}

enum OrgSupplyCopy {
    /// "Brake parts · 3 times · Mar 1, 2026 – Oct 2, 2026".
    static func kind(_ k: OrgSupply.Kind) -> String {
        let span = [JobCopy.day(k.first_on), JobCopy.day(k.last_on)].compactMap { $0 }
        let when = span.count == 2 && span[0] != span[1] ? "\(span[0]) – \(span[1])" : span.first
        return [JobCopy.sentence(k.supply_kind), "\(k.times) time\(k.times == 1 ? "" : "s")", when].compactMap { $0 }.joined(separator: " · ")
    }

    static let documentTypes: [(key: String, title: String)] = [
        ("business_license", "Business license"), ("tax_id", "Tax ID letter"), ("articles_incorporation", "Articles of incorporation"),
        ("dba_certificate", "DBA certificate"), ("lease_agreement", "Lease for the premises"), ("utility_bill", "Utility bill for the premises"),
    ]

    static func failure(_ error: Error) -> String {
        let m = (error as? PostgrestError)?.message ?? ""
        let table: [(String, String)] = [
            ("Sign-in required", "Sign in first."),
            ("no website domain on Nuke", "This business has no website on Nuke, so claim it with a document."),
            ("free e-mail domain", "A free e-mail address can't prove a business; claim it with a document."),
            ("not at this organization's website domain", "Your confirmed sign-in e-mail isn't at this business's website domain; claim it with a document."),
            ("verification_type must be", "Choose the kind of document."),
            ("An https document_url is required", "Link the document with an https address."),
            ("Only the customer or vehicle owner", "Only the customer on this job can invite a supplier."),
            ("The job is closed", "This job is closed."),
            ("Invite limit reached", "You've sent 20 invites today; try again tomorrow."),
            ("Organization unavailable", "This business isn't available."),
            ("Requirement unavailable", "That need isn't on the job any more."),
        ]
        if let hit = table.first(where: { m.contains($0.0) }) { return hit.1 }
        return ReadFailure.text(error)
    }

    static let webBase = URL(string: "https://nuke.ag")!
}

enum OrgSupplyReaders {
    static func read(organizationId: String) async -> JobLoad<OrgSupply> {
        await JobReaders.call("organization_supply_read") {
            try await SupabaseService.client.rpc("organization_supply_read", params: ["p_organization_id": organizationId]).execute().data
        }
    }
}

// MARK: - Claim a business

struct ClaimParams: Encodable, Equatable, Sendable {
    let p_organization_id: String
    let p_method: String
    let p_evidence: [String: String]?
}

enum ClaimDrafting {
    static func params(orgId: String, method: String, documentType: String, documentURL: String) -> Result<ClaimParams, JobSignFailure> {
        switch method {
        case "domain_email": return .success(ClaimParams(p_organization_id: orgId, p_method: "domain_email", p_evidence: nil))
        case "document":
            guard OrgSupplyCopy.documentTypes.contains(where: { $0.key == documentType }) else { return .failure(JobSignFailure(text: "Choose the kind of document.")) }
            let url = documentURL.trimmingCharacters(in: .whitespacesAndNewlines)
            guard url.lowercased().hasPrefix("https://"), url.count <= 2000, URL(string: url) != nil else {
                return .failure(JobSignFailure(text: "Link the document with an https address."))
            }
            return .success(ClaimParams(p_organization_id: orgId, p_method: "document", p_evidence: ["verification_type": documentType, "document_url": url]))
        default: return .failure(JobSignFailure(text: "Choose how you'll show it's yours."))
        }
    }
}

struct ClaimBusinessSheet: View {
    let orgId: String
    let name: String
    let onNuke: OnNuke
    var onDone: () -> Void = {}

    @State private var method: String
    @State private var documentType = "business_license"
    @State private var documentURL = ""
    @State private var outcome: String?

    init(orgId: String, name: String, onNuke: OnNuke, onDone: @escaping () -> Void = {}) {
        self.orgId = orgId; self.name = name; self.onNuke = onNuke; self.onDone = onDone
        _method = State(initialValue: onNuke.methods.contains("domain_email") ? "domain_email" : "document")
    }

    var body: some View {
        SignStepSheet(title: "Claim this business",
                      says: method == "domain_email"
                          ? ["You're the owner of \(name), or run it.", "Your confirmed sign-in e-mail is at \(onNuke.domain ?? "its website's domain")."]
                          : ["You're the owner of \(name), or run it.", "A reviewer checks the document; nothing is granted until then."],
                      doesNotSay: ["That Nuke has verified the business beyond what's shown", "Your e-mail address — it isn't shown to anyone", "Any rating or job"],
                      confirmTitle: method == "domain_email" ? "Claim it" : "Send for review",
                      successTitle: outcome == "claimed" ? "You're its owner on Nuke" : "Sent for review",
                      successDetail: outcome == "claimed" ? "Customers now see \(name) as claimed on Nuke." : "A reviewer checks the document. You'll see the result here.",
                      details: {
                          Section {
                              RootedValueView(label: "Business", value: name, status: .attributed)
                              Picker("How you'll show it's yours", selection: $method) {
                                  if onNuke.methods.contains("domain_email") { Text("Work e-mail at \(onNuke.domain ?? "its domain")").tag("domain_email") }
                                  Text("A document").tag("document")
                              }
                              if method == "document" {
                                  Picker("Document", selection: $documentType) {
                                      ForEach(OrgSupplyCopy.documentTypes, id: \.key) { Text($0.title).tag($0.key) }
                                  }
                                  TextField("Link to the document (https://…)", text: $documentURL)
                                      .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                              }
                          }
                      },
                      confirm: {
                          switch ClaimDrafting.params(orgId: orgId, method: method, documentType: documentType, documentURL: documentURL) {
                          case .failure(let f): return f.text
                          case .success(let p):
                              do {
                                  let data = try await SupabaseService.client.rpc("claim_organization", params: p).execute().data
                                  struct R: Decodable { let state: String? }
                                  outcome = (try? JobReaders.decode(R.self, from: data))?.state
                                  return nil
                              } catch { return OrgSupplyCopy.failure(error) }
                          }
                      }, onDone: onDone)
    }
}

/// On the organization page: on Nuke or not, work recorded on Nuke, declared assets, and "Is this your business?".
struct OrgSupplySection: View {
    let orgId: String
    var nameHint: String? = nil

    @State private var read: JobLoad<OrgSupply> = .loading
    @State private var assets: Int?
    @State private var claiming = false

    var body: some View {
        Group {
            switch read {
            case .loading:
                Section { Text("Loading…").font(.footnote).foregroundStyle(.secondary) }
            case .refused(let r):
                Section { JobRefusalRow(refusal: r) }
            case .loaded(let s):
                Section {
                    RootedValueView(label: "On Nuke", value: s.onNuke.words, status: s.onNuke.claimed ? .attributed : .recorded)
                    if s.kinds.isEmpty {
                        Text("No purchases from this business are on record on Nuke yet.").font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(s.kinds) { k in Text(OrgSupplyCopy.kind(k)).font(.footnote) }
                    if let assets { RootedValueView(label: "Declared assets", value: "\(assets)", status: .attributed, decay: "listed by the business") }
                    if !s.onNuke.claimed, SupabaseService.currentUserId != nil {
                        Button { claiming = true } label: { Label("Is this your business? Claim it", systemImage: "checkmark.shield") }
                            .sheet(isPresented: $claiming) {
                                ClaimBusinessSheet(orgId: orgId, name: s.name ?? nameHint ?? "this business", onNuke: s.onNuke) { Task { await load() } }
                            }
                    }
                } header: {
                    Text("Work recorded on Nuke")
                } footer: {
                    Text("From purchase records kept on Nuke; times are records, not quantities. Amounts, who paid and receipts aren't shown.")
                }
            }
        }
        .task(id: orgId) { await load() }
    }

    private func load() async {
        read = await OrgSupplyReaders.read(organizationId: orgId)
        if case .loaded(let f) = await FacilityReaders.read(organizationId: orgId) { assets = f.assets.count }
    }
}

// MARK: - Invite a supplier (the job's customer)

struct InviteParams: Encodable, Equatable, Sendable { let p_organization_id: String; let p_requirement_id: String }

struct SupplierInvite: Decodable, Equatable {
    let available: Bool
    let reason: String?
    let sharePath: String?
    let expiresAt: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        available = (try? c.decode(Bool.self, forKey: JobCodingKey("available"))) == true
        reason = try? c.decode(String.self, forKey: JobCodingKey("reason"))
        sharePath = try? c.decode(String.self, forKey: JobCodingKey("share_path"))
        expiresAt = try? c.decode(String.self, forKey: JobCodingKey("expires_at"))
    }

    var url: URL? { sharePath.flatMap { URL(string: $0, relativeTo: OrgSupplyCopy.webBase)?.absoluteURL } }
}

struct SupplierInviteSheet: View {
    let supplier: PlanBSupplier
    let requirementId: String
    let need: String

    @State private var invite: SupplierInvite?

    var body: some View {
        SignStepSheet(title: "Invite them to Nuke",
                      says: ["You get a single-use link to send \(supplier.name ?? "this business") yourself, about: \(need).",
                             "If they join, they can offer on this need."],
                      doesNotSay: ["That Nuke contacts them — you send the link", "A booking, an order or a payment", "Your contact details"],
                      confirmTitle: "Make the link", successTitle: invite?.available == false ? "They're already on Nuke" : "Link ready",
                      successDetail: invite?.available == false ? "Reach them through Nuke instead." : "It works once and expires in 14 days. Nuke didn't send anything.",
                      details: {
                          Section {
                              RootedValueView(label: "Business", value: supplier.name ?? "Unnamed business", status: .attributed, decay: supplier.onNuke?.words)
                              RootedValueView(label: "For", value: need, status: .attributed)
                              if let url = invite?.url {
                                  ShareLink(item: url, subject: Text("Join Nuke"), message: Text("Here's a job need you've supplied before: \(need)")) {
                                      Label("Share the invite link", systemImage: "square.and.arrow.up")
                                  }
                                  .accessibilityIdentifier("invite.share")
                              }
                          }
                      },
                      confirm: {
                          do {
                              let data = try await SupabaseService.client.rpc("create_supplier_invite",
                                                                              params: InviteParams(p_organization_id: supplier.organizationId, p_requirement_id: requirementId)).execute().data
                              invite = try? JobReaders.decode(SupplierInvite.self, from: data)
                              return nil
                          } catch { return OrgSupplyCopy.failure(error) }
                      })
    }
}

/// The customer's job page: businesses the job's needs were paid for before on Nuke, and inviting those not on Nuke yet.
struct JobSuppliersSection: View {
    let rows: [OpenRequirement]

    @State private var inviting: Invite?

    struct Invite: Identifiable { let supplier: PlanBSupplier; let requirementId: String; let need: String; var id: String { supplier.id + requirementId } }

    var body: some View {
        let withSuppliers = rows.filter { !$0.planB.isEmpty }
        if !withSuppliers.isEmpty {
            Section {
                ForEach(withSuppliers) { r in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(r.description ?? OfferCopy.kind(r.kind)).font(.subheadline)
                        ForEach(r.planB) { s in
                            VStack(alignment: .leading, spacing: 2) {
                                NavigationLink { OrganizationView(orgId: s.organizationId, fallbackName: s.name) } label: { Text(s.line).font(.caption) }
                                if s.onNuke?.claimed == false {
                                    Button("Not on Nuke yet — invite them") {
                                        inviting = Invite(supplier: s, requirementId: r.requirementId, need: r.description ?? OfferCopy.kind(r.kind))
                                    }
                                    .font(.caption).buttonStyle(.borderless)
                                }
                            }
                        }
                    }
                }
            } header: {
                Text("Businesses that supplied this before")
            } footer: {
                Text("From purchases kept on Nuke; no amounts or buyers are shown. An invite is a link you send yourself.")
            }
            .jobSheet(item: $inviting) { i in SupplierInviteSheet(supplier: i.supplier, requirementId: i.requirementId, need: i.need) }
        }
    }
}
