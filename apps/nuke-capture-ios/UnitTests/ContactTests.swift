// ContactTests.swift — Contact via Nuke decoding, the request body, limits and plain words.
// No test calls request_contact or any other writer; bodies are built and checked locally.

import XCTest
import Supabase
@testable import NukeCapture

final class ContactTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JobReaders.decode(T.self, from: Data(json.utf8))
    }

    func testContactBlocksDecideTheButton() throws {
        let open = try decode(ContactBlock.self, ContactFixtures.availableBlock)
        XCTAssertTrue(open.canRequest)
        XCTAssertEqual(open.contextKind, "profile")
        XCTAssertEqual(open.recipientUserId, ContactFixtures.profileId)
        XCTAssertFalse(try decode(ContactBlock.self, ContactFixtures.unavailableBlock).canRequest)
        let placeholder = try decode(ContactBlock.self, ContactFixtures.requirementBlock)
        XCTAssertNil(placeholder.contextId)                       // a placeholder is never sent as an id
        XCTAssertFalse(placeholder.canRequest)
    }

    func testRequestBodyIsExactlyWhatTheServerNamed() throws {
        let block = try decode(ContactBlock.self, ContactFixtures.availableBlock)
        let params = try XCTUnwrap(ContactReaders.sendParams(block, message: "  Hello there  "))
        XCTAssertEqual(params, ContactReaders.SendParams(p_context_kind: "profile", p_context_id: ContactFixtures.profileId,
                                                         p_message: "Hello there", p_recipient_user_id: ContactFixtures.profileId,
                                                         p_recipient_actor_id: nil, p_recipient_organization_id: nil))
        XCTAssertNil(ContactReaders.sendParams(block, message: "   "))
        XCTAssertNil(ContactReaders.sendParams(block, message: String(repeating: "a", count: 501)))
        XCTAssertNil(ContactReaders.sendParams(try decode(ContactBlock.self, ContactFixtures.unavailableBlock), message: "Hi"))
    }

    func testInboxDecodesIncomingOutgoingAndLimits() throws {
        let box = try decode(ContactInbox.self, ContactFixtures.inbox)
        XCTAssertEqual(box.incoming.count, 2)                     // a broken item is skipped
        XCTAssertEqual(box.outgoing.count, 1)
        XCTAssertEqual(box.pendingIncoming, 1)
        XCTAssertEqual(box.requestsLeftToday, 7)
        XCTAssertEqual(ContactCopy.leftToday(box.requestsLeftToday), "You can send 7 more requests today.")
        XCTAssertEqual(ContactCopy.leftToday(0), "You've reached today's limit for new requests.")
        let first = box.incoming[0]
        XCTAssertTrue(first.canRespond)
        XCTAssertEqual(first.counterpart?.text, "@fixture_owner")
        XCTAssertEqual(ContactCopy.context(first.contextKind, first.contextLabel), "Exhaust fabrication")
        XCTAssertEqual(box.incoming[1].counterpart?.text, "Unnamed party")
        XCTAssertEqual(ContactCopy.context(box.incoming[1].contextKind, box.incoming[1].contextLabel, incoming: true), "Your profile")
        XCTAssertEqual(ContactCopy.context("profile", nil), "Their profile")
        XCTAssertTrue(box.incoming[1].canMessage)
        XCTAssertTrue(box.outgoing[0].canWithdraw)
        XCTAssertEqual(box.outgoing[0].counterpart?.text, "Fixture Garage")
        XCTAssertEqual(ContactCopy.status("pending"), "Waiting for a reply")
    }

    func testThreadDecodesAndNamesYou() throws {
        let t = try decode(ContactThread.self, ContactFixtures.thread)
        XCTAssertTrue(t.canPost)
        XCTAssertEqual(t.messages.count, 2)
        XCTAssertFalse(t.messages[0].fromYou)
        XCTAssertTrue(t.messages[1].fromYou)
        XCTAssertEqual(t.messages[1].author?.text, "You")
        XCTAssertEqual(ContactCopy.whoCanRead(t.request?.recipientKind), "Only the two of you can read this.")
        XCTAssertEqual(ContactCopy.whoCanRead("organization"), "Only you and the shop's team can read this.")
    }

    func testSendReceiptAndFailureWords() throws {
        let r = try decode(ContactSendReceipt.self, ContactFixtures.sendReceipt)
        XCTAssertEqual(r.status, "pending")
        XCTAssertEqual(r.recipient?.text, "@fixture_tech")
        XCTAssertEqual(ContactCopy.sent, "Sent in Nuke. They'll see it in their inbox. Your email and phone are never shared.")
        func text(_ code: String, _ m: String) -> String { ContactCopy.failure(PostgrestError(code: code, message: m)) }
        XCTAssertEqual(text("54000", "Contact request limit reached (10 per day)"),
                       "You've reached today's limit for new requests. Try again tomorrow.")
        XCTAssertEqual(text("P0001", "A pending request to this recipient about this already exists"),
                       "You already have a request waiting with them about this.")
        XCTAssertEqual(text("P0001", "No reachable recipient for this contact"), "This person can't be reached through Nuke right now.")
        XCTAssertEqual(text("P0001", "Messages open after the request is accepted"), "Messages open once they accept your request.")
        XCTAssertEqual(text("54000", "Thread message limit reached (200 per day)"),
                       "You've sent a lot in this conversation today. Try again tomorrow.")
    }

    func testReadersCarryTheContactBlock() throws {
        let p = try decode(ProviderProfile.self, ProviderFixtures.profile(context: "visitor"))
        XCTAssertFalse(p.contactAvailable)                        // the fixture's block says available:false
        XCTAssertEqual(p.contact?.action, "contact_via_nuke")
        let s = try decode(JobStatement.self, JobFixtures.statementVisitor)
        XCTAssertEqual(s.contact?.action, "contact_via_nuke")
        XCTAssertFalse(s.contact?.canRequest == true)
    }
}
