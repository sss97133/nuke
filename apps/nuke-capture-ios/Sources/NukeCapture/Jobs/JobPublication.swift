// JobPublication.swift — who can see a job, and the customer's publish / unpublish Signs.
//
// work_order_publication_read (pg_get_functiondef 2026-10-19): visibility open | invite_only | not_published,
// whether the needs are listed, and — for the customer or a person with access to the vehicle, on an open,
// non-inspection job — the actions: publish_work_order (open, or invite only), unpublish_work_order (back to
// invite only). An open publish carries the server's refused_reason when the title or description names a person
// or holds contact details; the button is then shown disabled with that reason.

import SwiftUI
import Supabase

struct WorkOrderPublication: Decodable, Equatable {
    let visibility: String
    let listed: Bool
    let requirements: Int
    let lastSignAt: String?
    let party: Bool
    let actions: [JobAction]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: JobCodingKey.self)
        struct Last: Decodable { let signed_at: String? }
        struct Viewer: Decodable { let party: Bool?; let actions: [Lossy<JobAction>]? }
        visibility = (try? c.decode(String.self, forKey: JobCodingKey("visibility"))) ?? "not_published"
        listed = (try? c.decode(Bool.self, forKey: JobCodingKey("listed_in_open_requirements"))) == true
        requirements = (try? c.decode(Int.self, forKey: JobCodingKey("requirements"))) ?? 0
        lastSignAt = (try? c.decode(Last.self, forKey: JobCodingKey("last_sign")))?.signed_at
        let v = try? c.decode(Viewer.self, forKey: JobCodingKey("viewer"))
        party = v?.party == true
        actions = v?.actions?.compactMap(\.value) ?? []
    }
}

enum PublicationCopy {
    static func visibility(_ v: String) -> String {
        switch v {
        case "open": return "Open: technicians near you can see its needs and offer"
        case "invite_only": return "Invite only: its needs are recorded but not listed"
        default: return "Not published yet"
        }
    }

    static func button(_ a: JobAction) -> String {
        if a.kind == "unpublish_work_order" { return "Stop listing it" }
        return a.raw["visibility"]?.stringValue == "invite_only" ? "Publish invite only" : "Open it to technicians"
    }

    static func refusal(_ a: JobAction) -> String? { a.raw["refused_reason"]?.stringValue }

    private static let binds: [String: String] = [
        "your statement that this job is open: technicians near you can see its needs and offer": "This job is open: technicians near you can see its needs and offer.",
        "operations quoting your own description when the job has none, and requirements from the reviewed template":
            "If the job has no work listed yet, it's split from your own description, with needs from Nuke's reviewed list.",
        "your statement that this job is published invite only: its needs are recorded but not listed": "This job is published invite only: its needs are recorded but not listed.",
        "your statement that this job is no longer listed; it becomes invite only": "This job is no longer listed; it becomes invite only.",
    ]
    private static let doesNotBind: [String: String] = [
        "a price": "A price", "a provider": "That anyone is hired", "a schedule": "A schedule", "payment": "Any payment",
        "your contact details (contact goes through Nuke)": "Your contact details — people reach you through Nuke",
        "withdrawing offers already made": "Withdrawing offers already made", "deleting its needs (they stay on record)": "Deleting its needs — they stay on record",
    ]
    static func says(_ a: JobAction) -> [String] { a.binds.map { binds[$0] ?? JobCopy.sentence($0) } }
    static func doesNotSay(_ a: JobAction) -> [String] { a.doesNotBind.map { doesNotBind[$0] ?? JobCopy.sentence($0) } }

    static func failure(_ error: Error) -> String {
        let m = (error as? PostgrestError)?.message ?? ""
        if m.contains("Remove names and contact details") { return "Take names and contact details out of the job's title and description first — people reach you through Nuke." }
        if m.contains("Work order unavailable") { return "Only the customer, or someone with access to the vehicle, can publish this job." }
        if m.contains("Only an open job") { return "This job is closed, so it can't be published." }
        if m.contains("Inspection jobs") { return "Inspections are ordered from the vehicle's plan, not published here." }
        return ReadFailure.text(error)
    }

    struct Params: Encodable, Equatable, Sendable { let p_work_order_id: String; let p_visibility: String? }

    /// Only from the server's action for this job.
    static func params(_ a: JobAction, workOrderId: String) -> Params? {
        guard a.args["p_work_order_id"]?.stringValue == workOrderId,
              ["publish_work_order", "unpublish_work_order"].contains(a.rpc ?? a.kind), refusal(a) == nil else { return nil }
        return Params(p_work_order_id: workOrderId, p_visibility: a.args["p_visibility"]?.stringValue)
    }
}

enum PublicationReaders {
    static func read(workOrderId: String) async -> JobLoad<WorkOrderPublication> {
        await JobReaders.call("work_order_publication_read") {
            try await SupabaseService.client.rpc("work_order_publication_read", params: ["p_work_order_id": workOrderId]).execute().data
        }
    }

    static func write(_ a: JobAction, _ p: PublicationCopy.Params) async -> String? {
        do {
            if a.kind == "unpublish_work_order" {
                try await SupabaseService.client.rpc("unpublish_work_order", params: ["p_work_order_id": p.p_work_order_id]).execute()
            } else {
                try await SupabaseService.client.rpc("publish_work_order", params: p).execute()
            }
            return nil
        } catch {
            NSLog("NukeCapture publication write failed: %@", String(describing: error))
            return PublicationCopy.failure(error)
        }
    }
}

/// The job page's "Who can see this job" for parties; visitors see the state only when the reader states it.
struct JobPublicationSection: View {
    let workOrderId: String
    let read: JobLoad<WorkOrderPublication>
    var onChanged: (() -> Void)? = nil

    @State private var signing: JobAction?

    var body: some View {
        if case .loaded(let p) = read, p.party {
            Section {
                RootedValueView(label: "Who can see it", value: PublicationCopy.visibility(p.visibility), status: .attributed,
                                decay: p.lastSignAt.flatMap { JobCopy.day($0).map { "set \($0)" } })
                if p.visibility == "open" {
                    Text(p.listed ? "Listed under Jobs looking for someone." : "Not listed yet: it needs at least one need and a public vehicle.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                ForEach(p.actions) { a in
                    VStack(alignment: .leading, spacing: 2) {
                        Button(PublicationCopy.button(a)) { signing = a }
                            .disabled(PublicationCopy.refusal(a) != nil)
                        if let r = PublicationCopy.refusal(a) {
                            Text("Can't open it yet: \(PublicationCopy.failure(PostgrestError(code: nil, message: r)))").font(.caption).foregroundStyle(.orange)
                        }
                    }
                }
            } header: {
                Text("Who can see this job")
            } footer: {
                Text("Publishing books no one and moves no money. Technicians offer; you decide.")
            }
            .jobSheet(item: $signing) { a in
                SignStepSheet(title: PublicationCopy.button(a), says: PublicationCopy.says(a), doesNotSay: PublicationCopy.doesNotSay(a),
                              confirmTitle: PublicationCopy.button(a), successTitle: "Done",
                              successDetail: a.kind == "unpublish_work_order" ? "The job is invite only now." : "Saved.",
                              details: { EmptyView() },
                              confirm: {
                                  guard let p = PublicationCopy.params(a, workOrderId: workOrderId) else { return "This can't be changed from here. Refresh and try again." }
                                  return await PublicationReaders.write(a, p)
                              }, onDone: { onChanged?() })
            }
        }
    }
}
