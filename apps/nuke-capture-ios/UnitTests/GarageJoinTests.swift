// GarageJoinTests.swift — the garage join link on the phone: URL parsing and routing, the pending-token store,
// the error classifier, and both state machines, including the "Garage invites aren't available yet" state when
// the server functions are not deployed. No network: the models run against fake backends.

import XCTest
@testable import NukeCapture

final class GarageJoinTests: XCTestCase {
    private let token = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO-_"   // 43 base64url characters (fixture, not a real link)

    // MARK: URL parsing

    func testFixtureTokenIsTheRightShape() {
        XCTAssertEqual(token.count, 43)
        XCTAssertTrue(JoinLink.isToken(token))
    }

    func testUniversalLinkCarriesTheToken() {
        XCTAssertEqual(JoinLink.token(from: URL(string: "https://nuke.ag/join/\(token)")!), token)
        XCTAssertEqual(JoinLink.token(from: URL(string: "https://www.nuke.ag/join/\(token)/")!), token)
        XCTAssertEqual(JoinLink.token(from: URL(string: "https://NUKE.AG/join/\(token)?utm=x")!), token)
    }

    func testCustomSchemeFallbackCarriesTheToken() {
        XCTAssertEqual(JoinLink.token(from: URL(string: "ag.nuke.capture://join/\(token)")!), token)
    }

    func testOtherURLsAreNotJoinLinks() {
        XCTAssertNil(JoinLink.token(from: URL(string: "http://nuke.ag/join/\(token)")!), "plain http is not a universal link")
        XCTAssertNil(JoinLink.token(from: URL(string: "https://evil.example/join/\(token)")!))
        XCTAssertNil(JoinLink.token(from: URL(string: "https://nuke.ag/invite/\(token)")!), "the supplier invite route is not ours")
        XCTAssertNil(JoinLink.token(from: URL(string: "https://nuke.ag/join/\(token)/extra")!))
        XCTAssertNil(JoinLink.token(from: URL(string: "https://nuke.ag/join/short")!))
        XCTAssertNil(JoinLink.token(from: URL(string: "https://nuke.ag/join/\(token)x")!), "44 characters")
        XCTAssertNil(JoinLink.token(from: URL(string: "https://nuke.ag/join/")!))
        XCTAssertNil(JoinLink.token(from: URL(string: "ag.nuke.capture://sync")!), "the Shortcuts door is untouched")
        XCTAssertNil(JoinLink.token(from: URL(string: "ag.nuke.capture://login-callback")!))
        XCTAssertNil(JoinLink.token(from: URL(string: "ag.nuke.capture://join/short")!))
        XCTAssertNil(JoinLink.token(from: URL(string: "ag.nuke.capture://other/\(token)")!))
    }

    func testShareURLRoundTrips() {
        XCTAssertEqual(JoinLink.token(from: JoinLink.url(forToken: token)), token)
        XCTAssertEqual(JoinLink.url(forToken: token).absoluteString, "https://nuke.ag/join/\(token)")
    }

    // MARK: pending token store

    private func store(_ clock: @escaping () -> Date) -> JoinTokenStore {
        let defaults = UserDefaults(suiteName: "GarageJoinTests.\(UUID().uuidString)")!
        return JoinTokenStore(defaults: defaults, now: clock)
    }

    func testPendingTokenSurvivesUntilCleared() {
        let s = store { Date(timeIntervalSince1970: 1_000) }
        XCTAssertNil(s.load())
        s.save(token)
        XCTAssertEqual(s.load(), token)
        s.clear()
        XCTAssertNil(s.load())
    }

    func testPendingTokenExpiresAfterSevenDays() {
        var now = Date(timeIntervalSince1970: 1_000)
        let defaults = UserDefaults(suiteName: "GarageJoinTests.\(UUID().uuidString)")!
        let s = JoinTokenStore(defaults: defaults, now: { now })
        s.save(token)
        now = now.addingTimeInterval(6 * 24 * 3600)
        XCTAssertEqual(s.load(), token)
        now = now.addingTimeInterval(2 * 24 * 3600)
        XCTAssertNil(s.load())
        XCTAssertNil(defaults.object(forKey: JoinTokenStore.key), "an expired token is removed, not kept")
    }

    @MainActor func testCoordinatorKeepsATokenTappedWhileSignedOutAndResumesIt() {
        let defaults = UserDefaults(suiteName: "GarageJoinTests.\(UUID().uuidString)")!
        let s = JoinTokenStore(defaults: defaults)
        let c = JoinLinkCoordinator(store: s)
        XCTAssertFalse(c.handle(url: URL(string: "https://nuke.ag/market")!))
        XCTAssertNil(c.route)
        XCTAssertTrue(c.handle(url: JoinLink.url(forToken: token)))
        XCTAssertEqual(c.route, JoinRoute(token: token))
        c.closed()                                        // the sheet was dismissed before the link answered
        XCTAssertNil(c.route)
        XCTAssertEqual(s.load(), token, "still saved: sign-in resumes it")
        c.resumePending()
        XCTAssertEqual(c.route, JoinRoute(token: token))
        c.finish()
        c.closed()
        c.resumePending()
        XCTAssertNil(c.route, "an answered link does not come back")
    }

    // MARK: error classification

    func testMissingFunctionIsNotAvailable() {
        XCTAssertEqual(JoinError.classify(code: "PGRST202", message: "Could not find the function", httpStatus: nil), .notAvailable)
        XCTAssertEqual(JoinError.classify(code: "42883", message: "function does not exist", httpStatus: nil), .notAvailable)
        XCTAssertEqual(JoinError.classify(code: nil, message: "HTTP 404", httpStatus: 404), .notAvailable)
    }

    func testLinkRefusalsMapToReasons() {
        XCTAssertEqual(JoinError.classify(code: "P0001", message: "join_link_expired", httpStatus: nil), .invalid(.expired))
        XCTAssertEqual(JoinError.classify(code: "P0001", message: "join_link_exhausted", httpStatus: nil), .invalid(.exhausted))
        XCTAssertEqual(JoinError.classify(code: "P0001", message: "join_link_revoked", httpStatus: nil), .invalid(.revoked))
        XCTAssertEqual(JoinError.classify(code: "P0001", message: "join_link_not_found", httpStatus: nil), .invalid(.notFound))
        XCTAssertEqual(JoinError.classify(code: "P0001", message: "join_link_membership_revoked", httpStatus: nil), .invalid(.membershipRevoked))
        XCTAssertEqual(JoinError.classify(code: "28000", message: "redeem_garage_join_link requires a signed-in account", httpStatus: nil), .signInRequired)
        XCTAssertEqual(JoinError.classify(code: "42501", message: "join_link_rank_required: manager or above", httpStatus: nil), .notPermitted)
        XCTAssertEqual(JoinError.classify(code: "XX000", message: "boom", httpStatus: nil), .failed("boom"))
        XCTAssertEqual(JoinError.reason(inMessage: "join_link_rank_required: manager or above"), "rank_required")
        XCTAssertNil(JoinError.reason(inMessage: "something else"))
    }

    // MARK: join screen state machine

    private struct FakeJoin: GarageJoinBackend {
        var previewResult: Result<JoinPreview, JoinError>
        var redeemResult: Result<JoinMembership, JoinError> = .failure(.failed("not called"))
        func preview(token: String) async throws -> JoinPreview { try previewResult.get() }
        func redeem(token: String) async throws -> JoinMembership { try redeemResult.get() }
    }

    private let offer = JoinPreview(garageName: "Fixture shop", role: "technician", valid: true, reason: "ok")

    @MainActor private func model(_ backend: FakeJoin, signedIn: Bool, terminal: @escaping () -> Void = {}) -> JoinLinkModel {
        JoinLinkModel(token: token, backend: backend, isSignedIn: { signedIn }, onTerminal: terminal)
    }

    @MainActor func testMissingBackendShowsNotAvailableAndForgetsTheToken() async {
        var forgot = 0
        let m = model(FakeJoin(previewResult: .failure(.notAvailable)), signedIn: true) { forgot += 1 }
        await m.load()
        XCTAssertEqual(m.phase, .notAvailable)
        XCTAssertEqual(forgot, 1)
        XCTAssertEqual(JoinError.notAvailableTitle, "Garage invites aren't available yet")
    }

    @MainActor func testMissingRedeemAfterPreviewIsNotAvailableNeverSuccess() async {
        let m = model(FakeJoin(previewResult: .success(offer), redeemResult: .failure(.notAvailable)), signedIn: true)
        await m.load()
        XCTAssertEqual(m.phase, .offer(offer))
        await m.accept()
        XCTAssertEqual(m.phase, .notAvailable)
    }

    @MainActor func testSignedOutSeesThePreviewThenSignInNeededAndKeepsTheToken() async {
        var forgot = 0
        let m = model(FakeJoin(previewResult: .success(offer)), signedIn: false) { forgot += 1 }
        await m.load()
        XCTAssertEqual(m.phase, .signInNeeded(offer))
        await m.accept()                                   // cannot redeem without a session
        XCTAssertEqual(m.phase, .signInNeeded(offer))
        XCTAssertEqual(forgot, 0, "not terminal: the token stays for after sign-in")
    }

    @MainActor func testRedeemPendingThenActive() async {
        var forgot = 0
        let pending = FakeJoin(previewResult: .success(offer), redeemResult: .success(JoinMembership(memberId: "m1", status: "pending")))
        let m = model(pending, signedIn: true) { forgot += 1 }
        await m.load()
        await m.accept()
        XCTAssertEqual(m.phase, .pending(garage: "Fixture shop", role: "technician"))
        XCTAssertEqual(forgot, 1)

        let active = model(FakeJoin(previewResult: .success(offer), redeemResult: .success(JoinMembership(memberId: "m1", status: "active"))), signedIn: true)
        await active.load()
        await active.accept()
        XCTAssertEqual(active.phase, .active(garage: "Fixture shop", role: "technician"))
    }

    @MainActor func testUnknownMembershipStatusIsNotSuccess() async {
        let m = model(FakeJoin(previewResult: .success(offer), redeemResult: .success(JoinMembership(memberId: "m1", status: "mystery"))), signedIn: true)
        await m.load()
        await m.accept()
        guard case .blocked = m.phase else { return XCTFail("an unknown state must not read as joined") }
    }

    @MainActor func testInvalidPreviewShowsTheReason() async {
        let expired = JoinPreview(garageName: "Fixture shop", role: "technician", valid: false, reason: "expired")
        let m = model(FakeJoin(previewResult: .success(expired)), signedIn: true)
        await m.load()
        XCTAssertEqual(m.phase, .invalid(.expired, garage: "Fixture shop"))
        let unknown = JoinPreview(garageName: nil, role: nil, valid: false, reason: "not_found")
        let n = model(FakeJoin(previewResult: .success(unknown)), signedIn: true)
        await n.load()
        XCTAssertEqual(n.phase, .invalid(.notFound, garage: nil))
    }

    @MainActor func testNetworkFailureIsRetryableAndKeepsTheToken() async {
        var forgot = 0
        let m = model(FakeJoin(previewResult: .failure(.failed("No network connection."))), signedIn: true) { forgot += 1 }
        await m.load()
        XCTAssertEqual(m.phase, .failed("No network connection."))
        XCTAssertEqual(forgot, 0)
    }

    func testPreviewAndMembershipDecodeTheServerShapes() throws {
        let p = try JSONDecoder().decode([JoinPreview].self, from: Data(#"[{"garage_name":"Fixture shop","role":"technician","valid":true,"reason":"ok"}]"#.utf8))
        XCTAssertEqual(p, [JoinPreview(garageName: "Fixture shop", role: "technician", valid: true, reason: "ok")])
        let n = try JSONDecoder().decode([JoinPreview].self, from: Data(#"[{"garage_name":null,"role":null,"valid":false,"reason":"not_found"}]"#.utf8))
        XCTAssertNil(n[0].garageName)
        let m = try JSONDecoder().decode([JoinMembership].self, from: Data(#"[{"member_id":"5f8b0000-0000-0000-0000-000000000001","status":"pending"}]"#.utf8))
        XCTAssertEqual(m[0].status, "pending")
    }

    // MARK: owner side

    private struct FakeInvite: GarageInviteBackend {
        var garages: Result<[MyGarage], JoinError>
        var minted: Result<MintedJoinLink, JoinError> = .failure(.failed("not called"))
        func myGarages() async throws -> [MyGarage] { try garages.get() }
        func mint(garageId: String, role: String, maxUses: Int) async throws -> MintedJoinLink { try minted.get() }
    }

    private func garage(_ name: String, rank: Int, status: String = "active") -> MyGarage {
        MyGarage(garageId: "g-\(name)", name: name, role: rank >= 80 ? "manager" : "technician", rank: rank, memberStatus: status)
    }

    @MainActor func testInviteWithoutServerFunctionsIsNotAvailable() async {
        let m = GarageInviteModel(backend: FakeInvite(garages: .failure(.notAvailable)))
        await m.begin()
        XCTAssertEqual(m.phase, .notAvailable)
        let n = GarageInviteModel(backend: FakeInvite(garages: .success([garage("Fixture shop", rank: 100)]), minted: .failure(.notAvailable)))
        await n.begin()
        XCTAssertEqual(n.phase, .notAvailable, "mint missing: no link, no fake success")
    }

    @MainActor func testInviteNeedsAnActiveManagerGarage() async {
        let m = GarageInviteModel(backend: FakeInvite(garages: .success([garage("A", rank: 50), garage("B", rank: 100, status: "pending")])))
        await m.begin()
        XCTAssertEqual(m.phase, .noGarageToManage)
    }

    @MainActor func testInviteMintsForTheOnlyManagedGarageAndBuildsTheLink() async {
        let link = MintedJoinLink(linkId: "l1", token: token)
        let m = GarageInviteModel(backend: FakeInvite(garages: .success([garage("Fixture shop", rank: 100), garage("Elsewhere", rank: 50)]), minted: .success(link)))
        await m.begin()
        XCTAssertEqual(m.phase, .ready(garage: "Fixture shop", link: link))
        XCTAssertEqual(link.url.absoluteString, "https://nuke.ag/join/\(token)")
        XCTAssertEqual(GarageInviteModel.shareMessage(garage: "Fixture shop", url: link.url), "Join Fixture shop on Nuke: https://nuke.ag/join/\(token)")
        m.reset()
        XCTAssertEqual(m.phase, .idle)
    }

    @MainActor func testInviteAsksWhichGarageWhenThereAreSeveral() async {
        let both = [garage("A", rank: 100), garage("B", rank: 80)]
        let m = GarageInviteModel(backend: FakeInvite(garages: .success(both)))
        await m.begin()
        XCTAssertEqual(m.phase, .chooseGarage(both))
    }

    func testMyGarageDecodesAndGatesOnRankAndStatus() throws {
        let rows = try JSONDecoder().decode([MyGarage].self, from: Data(#"[{"garage_id":"g1","name":"Fixture shop","garage_status":"active","member_id":"m1","role":"owner","rank":100,"member_status":"active","started_at":null}]"#.utf8))
        XCTAssertTrue(rows[0].canInvite)
        XCTAssertFalse(garage("A", rank: 50).canInvite)
        XCTAssertFalse(garage("A", rank: 100, status: "pending").canInvite)
    }
}
