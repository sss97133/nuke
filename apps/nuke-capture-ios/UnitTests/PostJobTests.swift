// PostJobTests.swift — posting a job for your own vehicle, and starting accepted work.
// No writer is called; bodies are built and checked locally.

import XCTest
import Supabase
@testable import NukeCapture

final class PostJobTests: XCTestCase {
    private let utc = TimeZone(identifier: "UTC")!

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JobReaders.decode(T.self, from: Data(json.utf8))
    }

    func testPostedJobReadsPlainly() throws {
        let p = try decode(PostedJob.self, PostJobFixtures.posted)
        XCTAssertEqual(p.workOrderId, PostJobFixtures.workOrderId)
        XCTAssertFalse(p.duplicate)
        XCTAssertEqual(p.operations.map(\.text).first, "Replace the front brake pads and rotors.")
        XCTAssertEqual(p.requirements.map(PostJobCopy.requirement), [
            "Skill: Brake service", "Shop space: A lift", "Skill: Look at the squeak from the rear.",
        ])
        XCTAssertEqual(p.photosAttached, 2)
        XCTAssertEqual(PostJobCopy.listing(p), "Listed: technicians can see it under Jobs looking for someone.")
        let c = try XCTUnwrap(p.cost)
        XCTAssertNil(c.currency)
        XCTAssertEqual(PostJobCopy.total(c), "$240.00–$480.00 for 1 of 3 items")
        XCTAssertEqual(c.lines.map { PostJobCopy.costLine($0, currency: c.currency) }, [
            "about 1.5–3 h · $240.00–$480.00", "Matched, but no reference hours yet", "Nothing to estimate from yet",
        ])
        XCTAssertEqual(PostJobCopy.rate(c), "$160.00 / hour, a placeholder rate shown as returned")
        XCTAssertEqual(PostJobCopy.costLabel, "Rough guide from reference hours × a placeholder rate — not a quote")
        let dup = try decode(PostedJob.self, PostJobFixtures.duplicate)
        XCTAssertTrue(dup.duplicate)
        XCTAssertNil(dup.cost)
    }

    func testOnlyAttachablePhotosAreOffered() throws {
        let photos = try decode([PostJobPhoto].self, PostJobFixtures.photos)
        XCTAssertEqual(photos.filter { $0.refusal == nil }.map(\.id), ["i1", "i2"])
        XCTAssertEqual(photos.compactMap(\.refusal), ["sensitive", "personal", "replaced by a newer copy"])
        XCTAssertEqual(photos[0].capturedAt, "2026-10-10T10:00:00Z")
        XCTAssertEqual(photos[1].capturedAt, "2026-10-09T11:00:00Z")
    }

    func testPostBodyAndLocalChecks() throws {
        let now = try XCTUnwrap(FacilityCopy.date("2026-10-19T12:00:00Z"))
        guard case .success(let p) = PostJobDrafting.params(vehicleId: "v", description: "  Replace the pads. Bleed the lines.  ",
                                                            imageIds: ["i1"], neededBy: now.addingTimeInterval(86_400), visibility: .invite_only,
                                                            now: now) else { return XCTFail("refused") }
        XCTAssertEqual(p.p_description, "Replace the pads. Bleed the lines.")
        XCTAssertEqual(p.p_visibility, "invite_only")
        XCTAssertEqual(p.p_image_ids, ["i1"])
        XCTAssertEqual(p.p_needed_by, "2026-10-20T12:00:00Z")
        guard case .success(let bare) = PostJobDrafting.params(vehicleId: "v", description: "Fix it.", imageIds: [], neededBy: nil,
                                                               visibility: .open, now: now) else { return XCTFail("refused") }
        let body = try XCTUnwrap(String(data: JSONEncoder().encode(bare), encoding: .utf8))
        XCTAssertFalse(body.contains("p_image_ids"))
        XCTAssertFalse(body.contains("p_needed_by"))
        XCTAssertFalse(body.contains("p_requested_operations"))                               // the server splits your words itself
        func refusal(_ d: String, _ needed: Date? = nil) -> String? {
            if case .failure(let f) = PostJobDrafting.params(vehicleId: "v", description: d, imageIds: [], neededBy: needed, visibility: .open, now: now) {
                return f.text
            }
            return nil
        }
        XCTAssertEqual(refusal("   "), "Describe the work first.")
        XCTAssertEqual(refusal("Call me at 702-555-0134 about the brakes"), "Take out phone numbers and emails — people reach you through Nuke.")
        XCTAssertEqual(refusal("Email me: a@b.co"), "Take out phone numbers and emails — people reach you through Nuke.")
        XCTAssertEqual(refusal("Brakes.", now.addingTimeInterval(-60)), "Pick a needed-by date in the future.")
        XCTAssertEqual(refusal(String(repeating: "a", count: 4001)), "Keep the description under 4,000 characters.")
        XCTAssertEqual(PostJobCopy.postingDoesNotSay.count, 3)
        XCTAssertEqual(PostJobCopy.warning, "Don't include phone numbers or emails — people reach you through Nuke.")
    }

    func testServerRefusalsReadPlainly() {
        func words(_ m: String) -> String { PostJobCopy.failure(PostgrestError(code: "23514", message: m)) }
        XCTAssertEqual(words("Vehicle unavailable: post a job for your own vehicle; for a vehicle you do not own, order an inspection (request_inspection)"),
                       PostJobCopy.vehicleRefusal)
        XCTAssertTrue(PostJobCopy.vehicleRefusal.contains("order an inspection instead"))
        XCTAssertEqual(words("Remove contact details from the description; contact goes through Nuke"),
                       "Take out phone numbers and emails — people reach you through Nuke.")
        XCTAssertEqual(words("Remove names and contact details from the description; contact goes through Nuke"),
                       "Take out names, including your own, and contact details — people reach you through Nuke.")
        XCTAssertEqual(words("needed_by must be in the future"), "Pick a needed-by date in the future.")
        XCTAssertEqual(words("The description must state 1 to 20 operations"), "Describe 1 to 20 things to do, a sentence each.")
        XCTAssertEqual(words("Personal, sensitive, misattributed or superseded images cannot be attached"),
                       "One of the photos can't go with the job: it's personal, sensitive, of another vehicle, or replaced.")
        XCTAssertEqual(words("Terms hash does not match the accepted terms (accepted_offer)"),
                       "The accepted terms changed since you opened this. Refresh and review them again.")
        XCTAssertEqual(words("The customer does not start the work; the accepted provider does"),
                       "The customer doesn't start the work; the accepted technician does.")
        XCTAssertEqual(words("Only a current accepted provider can start this work"), "Only the technician accepted on this job can start it.")
    }

    func testStartWorkIsPinnedToTheServersAction() throws {
        let path = try decode(JobPath.self, PostJobFixtures.beforeStart)
        let action = try XCTUnwrap(path.viewer?.actions.first { $0.kind == "start_work" })
        XCTAssertEqual(action.termsBasis, "accepted_offer")
        XCTAssertEqual(action.doesNotBind.map(PostJobCopy.startDoesNotBind), ["That the work is done", "A schedule or finish date", "Any payment"])
        XCTAssertEqual(PostJobDrafting.start(action, workOrderId: JobFixtures.workOrderId),
                       .init(p_work_order_id: JobFixtures.workOrderId, p_terms_hash: PostJobFixtures.termsHash))
        XCTAssertNil(PostJobDrafting.start(action, workOrderId: "another-job"))                    // never another job's terms
        XCTAssertNil(PostJobDrafting.start(JobAction(kind: "start_work", rpc: "start_work", args: ["p_work_order_id": .string(JobFixtures.workOrderId)]),
                                           workOrderId: JobFixtures.workOrderId))                  // no hash, no start
        XCTAssertEqual(PostJobCopy.startSays(action.termsBasis), "You're starting this work under your accepted offer.")
        XCTAssertEqual(path.stages[.execution]?.state, .absent)
        let customer = try decode(JobPath.self, JobFixtures.jobPathWithLabels)
        XCTAssertNil(customer.viewer?.actions.first { $0.kind == "start_work" })                    // the customer is never offered it
    }

    func testAfterStartTheWorkStageShowsTheStart() throws {
        let path = try decode(JobPath.self, PostJobFixtures.afterStart)
        let work = try XCTUnwrap(path.stages[.execution])
        XCTAssertEqual(work.state, .recorded)
        let fact = try XCTUnwrap(work.facts.first { $0.key == "start_sign" })
        XCTAssertEqual(JobCopy.fact(fact.key), "Work started")
        XCTAssertEqual(PostJobCopy.started(fact.value, timeZone: utc),
                       "Started Wed Oct 21, 4:00 PM by the accepted technician, under the accepted offer")
        XCTAssertEqual(PostJobCopy.started(.null), "Not started yet")
        XCTAssertTrue(path.viewer?.actions.isEmpty ?? true)
        XCTAssertEqual(JobPathContent.visibleFacts(work.facts).filter { JobCopy.fact($0.key) == "Work started" }.count, 1)
    }
}
