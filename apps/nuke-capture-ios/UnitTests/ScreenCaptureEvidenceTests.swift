// ScreenCaptureEvidenceTests.swift — the screen-capture evidence rule (screen_text_v1), driven with simulated OCR text.
//
// The acceptance case is the '64 Corvette (vehicle 2e5ec4a1): a Facebook Marketplace screen recording of the
// purchase negotiation on 2023-09-16, the day before the Ann Rd photos (2023-09-17). The Corvette has no
// purchase_date and no VIN in the database, so its anchor is its first filed photo.

import XCTest
@testable import NukeCapture

final class ScreenCaptureEvidenceTests: XCTestCase {
    private func t(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }

    private let corvetteID = "2e5ec4a1-0000-4000-8000-000000000001"
    private let gtoID = "9c1d0000-0000-4000-8000-000000000002"
    private let accordID = "5a5a0000-0000-4000-8000-000000000003"
    private let vin = "1HGCM82633A004352"

    /// 2023-09-17T05:27:58Z: the first photo filed to the Corvette (ssd_blast), as read from the database.
    private var firstPhoto: Date { t("2023-09-17T05:27:58Z") }

    private var corvette: ScreenRosterVehicle {
        ScreenRosterVehicle(id: corvetteID, year: 1964, make: "Chevrolet", model: "Corvette", vin: nil,
                            purchaseDate: nil, firstFiledPhoto: firstPhoto)
    }
    private var gto: ScreenRosterVehicle {
        ScreenRosterVehicle(id: gtoID, year: 1967, make: "Pontiac", model: "GTO", vin: nil,
                            purchaseDate: t("2020-03-01T00:00:00Z"), firstFiledPhoto: nil)
    }
    private var accord: ScreenRosterVehicle {
        ScreenRosterVehicle(id: accordID, year: 2003, make: "Honda", model: "Accord", vin: vin,
                            purchaseDate: t("2023-09-10T00:00:00Z"), firstFiledPhoto: nil)
    }

    private let recordedAt = "2023-09-16T20:15:00Z"

    private func frame(_ i: Int, _ lines: [String], face: Bool = false) -> ScreenFrameText {
        ScreenFrameText(index: i, seconds: Double(i - 1) * 5 + 2.5, lines: lines, hasProminentFace: face)
    }

    /// 12 frames of the Marketplace negotiation. Frame 4 is the listing header (the asking price), frame 7 the seller
    /// card, frame 8 the buyer's offer, frame 9 the chat that carries the date and the agreed price.
    private func corvetteRecording() -> [ScreenFrameText] {
        (1...12).map { i in
            switch i {
            case 4: return frame(i, ["Marketplace", "$18,500", "1964 Chevrolet Corvette", "Listed 2 weeks ago in Las Vegas, NV",
                                     "Message", "Is this still available?"])
            case 7: return frame(i, ["Seller information", "Mike Dawson", "Joined Facebook in 2012", "View profile"])
            case 8: return frame(i, ["Mike Dawson", "Would you take $16,500 cash today?"])
            case 9: return frame(i, ["Mike Dawson", "Sep 16, 2023", "Ok deal, $17,000 cash today", "Ok, see you at 4"])
            default: return frame(i, ["Facebook", "Marketplace", "Search Marketplace"])
            }
        }
    }

    private func verdict(_ frames: [ScreenFrameText], at: String? = nil, roster: [ScreenRosterVehicle]? = nil,
                         requested: Int? = nil) -> ScreenVerdict {
        ScreenCaptureEvidence.evaluate(capturedAt: t(at ?? recordedAt), frames: frames,
                                       framesRequested: requested ?? frames.count, roster: roster ?? [corvette, gto])
    }

    private func attribution(_ v: ScreenVerdict, file: StaticString = #filePath, line: UInt = #line) -> ScreenAttribution? {
        guard case .attribute(let a) = v else { XCTFail("expected attribute, got \(v)", file: file, line: line); return nil }
        return a
    }

    // ─── THE acceptance case ──────────────────────────────────────────────────

    func testTheCorvetteMarketplaceRecordingIsAttributedWithPriceSellerAndDateCitedToFrames() throws {
        let a = try XCTUnwrap(attribution(verdict(corvetteRecording())))
        XCTAssertEqual(a.vehicleID, corvetteID)
        XCTAssertEqual(a.method, "screen_ymm")
        XCTAssertEqual(a.confidence, 0.92)
        XCTAssertGreaterThanOrEqual(a.confidence, ScreenCaptureEvidence.confidenceFloor)
        XCTAssertEqual(a.anchorSource, .firstFiledPhoto, "no purchase_date: the first filed photo is the anchor, not created_at")
        let byName = Dictionary(a.fields.map { ($0.name, $0) }, uniquingKeysWith: { x, _ in x })
        XCTAssertEqual(byName["vehicle"]?.value, "1964 Chevrolet Corvette")
        XCTAssertEqual(byName["vehicle"]?.frame, 4)
        XCTAssertEqual(byName["seller"]?.value, "Mike Dawson")
        XCTAssertEqual(byName["seller"]?.frame, 7)
        XCTAssertEqual(byName["date"]?.value, "2023-09-16")
        XCTAssertEqual(byName["date"]?.frame, 9)
        XCTAssertNil(byName["vin"], "the Corvette has no VIN in the database and none is invented")
        XCTAssertNil(byName["price"], "prices are typed observations, not cited fields")
    }

    func testTheCorvetteRecordingYieldsTheAskingOfferAndAgreedPriceObservationsEachCitedToItsFrame() throws {
        let a = try XCTUnwrap(attribution(verdict(corvetteRecording())))
        XCTAssertEqual(a.prices, [
            PriceObservation(amount: 18_500, kind: .asking, frame: 4, seconds: 17.5),
            PriceObservation(amount: 16_500, kind: .offer, frame: 8, seconds: 37.5),
            PriceObservation(amount: 17_000, kind: .agreed, frame: 9, seconds: 42.5),
        ])
        XCTAssertEqual(Set(a.prices.map(\.kind)), [.asking, .offer, .agreed])
        XCTAssertTrue(a.prices.allSatisfy { (1...12).contains($0.frame) && $0.seconds >= 0 && $0.seconds <= 60 })
    }

    func testThePriceObservationsEncodeAsTheServerExpectsThem() throws {
        let a = try XCTUnwrap(attribution(verdict(corvetteRecording())))
        let json = try XCTUnwrap(String(data: JSONEncoder().encode(a.prices.first), encoding: .utf8))
        XCTAssertTrue(json.contains(#""kind":"asking""#))
        XCTAssertTrue(json.contains(#""amount":18500"#))
        XCTAssertTrue(json.contains(#""frame":4"#))
        XCTAssertTrue(json.contains(#""seconds":17.5"#))
    }

    func testTheCitedFieldsNeverCarryTheOCRDump() throws {
        let a = try XCTUnwrap(attribution(verdict(corvetteRecording())))
        let allowed: Set<String> = ["vehicle", "vin", "seller", "seller_line", "date"]
        XCTAssertTrue(a.fields.allSatisfy { allowed.contains($0.name) })
        XCTAssertTrue(a.fields.allSatisfy { $0.value.count <= 40 })
        let blob = a.fields.map(\.value).joined(separator: "|")
        for dump in ["Is this still available", "Joined Facebook", "see you at 4", "Las Vegas", "Search Marketplace"] {
            XCTAssertFalse(blob.contains(dump), "\(dump) is OCR text and is never sent")
        }
        XCTAssertLessThanOrEqual(a.fields.count, ScreenCaptureEvidence.maxFields)
    }

    func testTheSameRecordingIsInsideTheWindowOfTheFirstFiledPhoto() {
        let anchor = AcquisitionAnchor.of(corvette)
        XCTAssertEqual(anchor?.source, .firstFiledPhoto)
        XCTAssertTrue(anchor?.contains(t(recordedAt)) == true, "Sep 16 is one day before the Sep 17 anchor")
    }

    // ─── Narrowing by acquisition context ─────────────────────────────────────

    func testPurchaseDateBeatsTheFirstPhotoAndCreatedAtIsNotAnOption() {
        let v = ScreenRosterVehicle(id: "V", year: 1964, make: "Chevrolet", model: "Corvette", vin: nil,
                                    purchaseDate: t("2023-09-16T00:00:00Z"), firstFiledPhoto: firstPhoto)
        XCTAssertEqual(AcquisitionAnchor.of(v)?.source, .purchaseDate)
        let none = ScreenRosterVehicle(id: "V", year: 1964, make: "Chevrolet", model: "Corvette", vin: nil,
                                       purchaseDate: nil, firstFiledPhoto: nil)
        XCTAssertNil(AcquisitionAnchor.of(none), "no purchase_date and no photo: not a candidate (created_at is never used)")
    }

    func testTheWindowIs21DaysBeforeAndTwoDaysAfterAPhoto() {
        let a = AcquisitionAnchor(date: firstPhoto, source: .firstFiledPhoto)
        XCTAssertTrue(a.contains(firstPhoto.addingTimeInterval(-21 * 86_400)))
        XCTAssertFalse(a.contains(firstPhoto.addingTimeInterval(-21 * 86_400 - 1)))
        XCTAssertTrue(a.contains(firstPhoto.addingTimeInterval(2 * 86_400 - 1)))
        XCTAssertFalse(a.contains(firstPhoto.addingTimeInterval(2 * 86_400)))
    }

    func testAPurchaseDateGetsThreeDaysAfter() {
        let a = AcquisitionAnchor(date: t("2023-09-16T00:00:00Z"), source: .purchaseDate)
        XCTAssertTrue(a.contains(t("2023-09-18T23:59:00Z")))
        XCTAssertFalse(a.contains(t("2023-09-19T00:00:00Z")))
    }

    func testACaptureOutsideEveryWindowIsNeverReadForThatVehicle() {
        XCTAssertEqual(verdict(corvetteRecording(), at: "2023-10-20T12:00:00Z"), .refused(.noCandidates))
        XCTAssertEqual(verdict(corvetteRecording(), at: "2023-08-20T12:00:00Z"), .refused(.noCandidates))
        XCTAssertTrue(ScreenCaptureEvidence.candidates(roster: [corvette, gto], capturedAt: t("2023-10-20T12:00:00Z")).isEmpty)
    }

    func testTextNamingAVehicleOutsideItsWindowIsRefusedNotMovedToAnother() {
        // The Pontiac's window closed in 2020; only the Corvette is a candidate, but the text names the Pontiac.
        let lines = [frame(1, ["$9,000", "1967 Pontiac GTO", "Seller: Pat Smith"])]
        XCTAssertEqual(verdict(lines), .refused(.outsideContext))
    }

    func testWindowsMergeAndCapAtTheLimit() {
        let w = VideoSyncEngine.windows(for: [corvette, accord], limit: 10)
        XCTAssertEqual(w.count, 1, "the Accord (Sep 10) and Corvette (Sep 17) windows overlap")
        XCTAssertEqual(w.first?.start, AcquisitionAnchor(date: t("2023-09-10T00:00:00Z"), source: .purchaseDate).start)
        XCTAssertEqual(w.first?.end, AcquisitionAnchor(date: firstPhoto, source: .firstFiledPhoto).end)
        XCTAssertEqual(VideoSyncEngine.windows(for: [corvette, gto], limit: 1).count, 1)
        XCTAssertTrue(VideoSyncEngine.windows(for: [], limit: 10).isEmpty)
    }

    func testPurchaseDateIsReadAsUTCMidnight() {
        XCTAssertEqual(VideoSyncEngine.parseDateOnly("2023-09-16"), t("2023-09-16T00:00:00Z"))
        XCTAssertEqual(VideoSyncEngine.parseDateOnly("2023-09-16T00:00:00+00:00"), t("2023-09-16T00:00:00Z"))
        XCTAssertNil(VideoSyncEngine.parseDateOnly(nil))
        XCTAssertNil(VideoSyncEngine.parseDateOnly("soon"))
    }

    // ─── What counts as evidence ──────────────────────────────────────────────

    func testYearMakeModelAloneWithNoPriceOrSellerIsNotEnough() {
        let frames = (1...12).map { frame($0, $0 == 4 ? ["1964 Chevrolet Corvette"] : ["Marketplace"]) }
        XCTAssertEqual(verdict(frames), .refused(.noPriceOrSellerLine))
    }

    func testAPriceAloneWithNoVehicleIsNotEnough() {
        let frames = (1...12).map { frame($0, $0 == 4 ? ["$18,500", "Message seller"] : ["Marketplace"]) }
        XCTAssertEqual(verdict(frames), .refused(.noVehicleEvidence))
    }

    func testYearAndModelMustShareALineAndTheMakeMustBeInTheFrame() {
        let split = [frame(1, ["1964", "Corvette", "Chevrolet", "$18,500"])]
        XCTAssertEqual(verdict(split), .refused(.noVehicleEvidence), "year and model on different lines is not a vehicle line")
        let noMake = [frame(1, ["1964 Corvette for sale", "$18,500"])]
        XCTAssertEqual(verdict(noMake), .refused(.noVehicleEvidence), "the make is required too")
    }

    func testTheMakeMayBeAShortFormAndTheYearMayBeTwoDigits() throws {
        let chevy = [frame(1, ["1964 Chevy Corvette", "$18,500"])]
        XCTAssertEqual(try XCTUnwrap(attribution(verdict(chevy))).vehicleID, corvetteID)
        let short = [frame(1, ["'64 Chevrolet Corvette Stingray", "$18,500"])]
        XCTAssertEqual(try XCTUnwrap(attribution(verdict(short))).vehicleID, corvetteID)
    }

    func testAWrongYearIsNotTheVehicle() {
        let frames = [frame(1, ["1965 Chevrolet Corvette", "$18,500"])]
        XCTAssertEqual(verdict(frames), .refused(.noVehicleEvidence))
    }

    func testAPriceOnItsOwnLineIsReadButSillyAmountsAreNot() {
        XCTAssertEqual(ScreenCaptureEvidence.prices(in: [frame(1, ["$50", "$12,000,000", "$499"])]).count, 0)
        XCTAssertEqual(ScreenCaptureEvidence.prices(in: [frame(1, ["Asking $18500 obo"])]).first?.amount, 18_500)
        XCTAssertEqual(ScreenCaptureEvidence.prices(in: [frame(1, ["$ 18,500.00"])]).first?.amount, 18_500)
        let frames = [frame(1, ["1964 Chevrolet Corvette", "$50", "$12,000,000"])]
        XCTAssertEqual(verdict(frames), .refused(.noPriceOrSellerLine))
    }

    func testASellerLineWithoutAPriceIsCommercialEvidence() throws {
        let frames = [frame(1, ["1964 Chevrolet Corvette", "Seller: Mike Dawson"])]
        let a = try XCTUnwrap(attribution(verdict(frames)))
        XCTAssertEqual(a.fields.first { $0.name == "seller" }?.value, "Mike Dawson")
        XCTAssertTrue(a.prices.isEmpty)
        let bare = [frame(1, ["1964 Chevrolet Corvette", "Message seller"])]
        XCTAssertEqual(try XCTUnwrap(attribution(verdict(bare))).fields.first { $0.name == "seller_line" }?.value, "seen")
    }

    func testSellerNamesMustLookLikeNames() {
        XCTAssertEqual(ScreenCaptureEvidence.personName("Mike Dawson"), "Mike Dawson")
        XCTAssertEqual(ScreenCaptureEvidence.personName("Mary-Ann O'Neil"), "Mary-Ann O'Neil")
        XCTAssertNil(ScreenCaptureEvidence.personName("Message"))
        XCTAssertNil(ScreenCaptureEvidence.personName("View profile"))
        XCTAssertNil(ScreenCaptureEvidence.personName("mike dawson"))
        XCTAssertNil(ScreenCaptureEvidence.personName("Joined Facebook"))
        XCTAssertNil(ScreenCaptureEvidence.personName("Mike 123"))
    }

    // ─── Typed price observations ─────────────────────────────────────────────

    private func kinds(_ lines: [String], listing: Bool = false) -> [PriceKind] {
        ScreenCaptureEvidence.prices(in: [frame(1, listing ? lines + ["Listed 2 weeks ago"] : lines)]).map(\.kind)
    }

    func testPriceKindsComeFromTheWordsAroundThePrice() {
        XCTAssertEqual(kinds(["Asking $18,500"]), [.asking])
        XCTAssertEqual(kinds(["$18,500 or best offer"]), [.asking], "or best offer qualifies an asking price")
        XCTAssertEqual(kinds(["Would you take $16,500?"]), [.offer])
        XCTAssertEqual(kinds(["I can do $17,000 cash"]), [.offer])
        XCTAssertEqual(kinds(["My offer is $16,000"]), [.offer])
        XCTAssertEqual(kinds(["Deal, $17,000"]), [.agreed])
        XCTAssertEqual(kinds(["$17,000 sold to you"]), [.agreed], "a cue may follow the price")
        XCTAssertEqual(kinds(["Ok we agreed on $17,000"]), [.agreed])
    }

    func testAPriceWithNoClearWordsIsUnknownNeverAGuess() {
        XCTAssertEqual(kinds(["$17,000"]), [.unknown])
        XCTAssertEqual(kinds(["Cash $17,000 today"]), [.unknown])
        XCTAssertEqual(kinds(["Asking and offer $17,000"]), [.unknown], "two kinds of cue on one price is unclear")
        XCTAssertEqual(kinds(["No deal, $17,000"]), [.unknown], "a negated cue is unclear")
        XCTAssertEqual(kinds(["The dealership wants $17,000"]), [.unknown], "dealership is not 'deal'")
    }

    func testTheListingHeaderIsAskingOnlyOnAListingPageNextToATitle() {
        let page = [frame(1, ["$18,500", "1964 Chevrolet Corvette", "Listed 2 weeks ago in Las Vegas, NV"])]
        XCTAssertEqual(ScreenCaptureEvidence.prices(in: page).map(\.kind), [.asking])
        let notAListing = [frame(1, ["$18,500", "1964 Chevrolet Corvette"])]
        XCTAssertEqual(ScreenCaptureEvidence.prices(in: notAListing).map(\.kind), [.unknown], "no listing-page cue: unclear")
        let noTitle = [frame(1, ["$18,500", "Message seller"])]
        XCTAssertEqual(ScreenCaptureEvidence.prices(in: noTitle).map(\.kind), [.unknown], "no title line below: unclear")
    }

    func testTwoPricesOnOneLineAreTypedSeparately() {
        let p = ScreenCaptureEvidence.prices(in: [frame(1, ["Asking $18,500, would you take $17,000?"])])
        XCTAssertEqual(p.map(\.amount), [18_500, 17_000])
        XCTAssertEqual(p.map(\.kind), [.asking, .offer])
    }

    func testTheLineAboveTypesAPriceThatHasNoCueOfItsOwn() {
        let p = ScreenCaptureEvidence.prices(in: [frame(1, ["Would you take", "$16,500"])])
        XCTAssertEqual(p.map(\.kind), [.offer])
        let priced = ScreenCaptureEvidence.prices(in: [frame(1, ["Asking $18,500", "$16,500"])])
        XCTAssertEqual(priced.map(\.kind), [.asking, .unknown], "a line above that holds a price does not type the next one")
    }

    func testEachPriceIsCitedToTheFirstFrameThatShowsIt() {
        let frames = [frame(1, ["Asking $18,500"]), frame(2, ["Asking $18,500"]), frame(3, ["Would you take $18,500"])]
        let p = ScreenCaptureEvidence.prices(in: frames)
        XCTAssertEqual(p, [PriceObservation(amount: 18_500, kind: .asking, frame: 1, seconds: 2.5),
                           PriceObservation(amount: 18_500, kind: .offer, frame: 3, seconds: 12.5)])
    }

    func testAnUnknownIsDroppedWhenTheSameAmountWasTypedElsewhere() {
        let frames = [frame(1, ["$17,000"]), frame(2, ["Deal, $17,000"])]
        XCTAssertEqual(ScreenCaptureEvidence.prices(in: frames).map(\.kind), [.agreed])
    }

    func testAtMostEightPricesAndTheTypedOnesKeepTheirPlace() {
        var lines = (1...9).map { "$\(1000 + $0)" }                 // nine unknown prices
        lines.append("Deal, $2,500")
        let p = ScreenCaptureEvidence.prices(in: [frame(1, lines)])
        XCTAssertEqual(p.count, ScreenCaptureEvidence.maxPrices)
        XCTAssertTrue(p.contains { $0.kind == .agreed && $0.amount == 2_500 })
    }

    func testAnUnknownPriceStillCountsAsCommercialEvidenceButIsStoredAsUnknown() throws {
        let frames = [frame(1, ["1964 Chevrolet Corvette", "$17,000"])]
        let a = try XCTUnwrap(attribution(verdict(frames)))
        XCTAssertEqual(a.prices.map(\.kind), [.unknown])
    }

    func testNoPriceObservationIsEverTheVehiclesPurchasePrice() throws {
        // The filing payload carries observations and cited fields only: there is no purchase_price anywhere in it.
        let a = try XCTUnwrap(attribution(verdict(corvetteRecording())))
        let payload = ScreenFilingPayload(kind: "screen_recording", method: a.method, confidence: a.confidence, fields: a.fields,
                                          prices: a.prices, previewExtension: "mp4", contentType: "video/mp4")
        let json = try XCTUnwrap(String(data: JSONEncoder().encode(payload), encoding: .utf8))
        XCTAssertFalse(json.contains("purchase"))
    }

    // ─── A VIN is stronger than a name ────────────────────────────────────────

    func testTheVehiclesOwnVINIsAttributedAtTheHigherConfidence() throws {
        let frames = [frame(1, ["Bill of Sale", "VIN \(vin)", "Price $6,200", "Seller: Ann Lee"])]
        let v = ScreenCaptureEvidence.evaluate(capturedAt: t("2023-09-11T15:00:00Z"), frames: frames, framesRequested: 1,
                                               roster: [corvette, accord])
        let a = try XCTUnwrap(attribution(v))
        XCTAssertEqual(a.vehicleID, accordID)
        XCTAssertEqual(a.method, "screen_vin")
        XCTAssertEqual(a.confidence, 0.97)
        XCTAssertEqual(a.anchorSource, .purchaseDate)
        XCTAssertEqual(a.fields.first { $0.name == "vin" }?.value, vin)
    }

    func testADifferentValidVINOnTheScreenRefusesTheCapture() {
        let other = "1GCEK14L9EJ147915"
        let frames = [frame(1, ["2003 Honda Accord", "VIN \(vin)", "Also VIN \(other)", "$6,200"])]
        let v = ScreenCaptureEvidence.evaluate(capturedAt: t("2023-09-11T15:00:00Z"), frames: frames, framesRequested: 1,
                                               roster: [accord])
        XCTAssertEqual(v, .refused(.conflictingVIN))
    }

    // ─── Ambiguity, privacy, unreadable ───────────────────────────────────────

    func testTwoVehiclesNamedInOneCaptureAreRefused() {
        let both = ScreenRosterVehicle(id: gtoID, year: 1967, make: "Pontiac", model: "GTO", vin: nil,
                                       purchaseDate: t("2023-09-12T00:00:00Z"), firstFiledPhoto: nil)
        let frames = [frame(1, ["1964 Chevrolet Corvette", "1967 Pontiac GTO", "$18,500"])]
        XCTAssertEqual(verdict(frames, roster: [corvette, both]), .refused(.conflictingVehicles))
    }

    func testAFaceHoldsTheWholeCapture() {
        var frames = corvetteRecording()
        frames[8] = frame(9, ["Mike Dawson", "Sep 16, 2023"], face: true)
        XCTAssertEqual(verdict(frames), .refused(.privacy))
    }

    func testCardNumbersPasswordsAndSSNsHoldTheCapture() {
        for line in ["Card 4111 1111 1111 1111", "Password: hunter2", "Verification code 482913", "SSN 123-45-6789", "CVV 123"] {
            var frames = corvetteRecording()
            frames[10] = frame(11, [line])
            XCTAssertEqual(verdict(frames), .refused(.personalText), line)
        }
        XCTAssertFalse(ScreenCaptureEvidence.containsPrivateText(["VIN \(vin)", "$18,500", "Call 702 555 0147"]))
        XCTAssertTrue(ScreenCaptureEvidence.luhn("4111111111111111"))
        XCTAssertFalse(ScreenCaptureEvidence.luhn("4111111111111112"))
    }

    func testAFrameCountThatIsNotWhatWasAskedForIsUnreadableNotRefused() {
        XCTAssertEqual(verdict(corvetteRecording(), requested: 13), .unreadable)
        XCTAssertEqual(verdict([], requested: 0), .unreadable)
    }

    func testAScreenshotIsOneFrameAndNeedsTheSameEvidence() throws {
        let shot = [ScreenFrameText(index: 1, seconds: 0, lines: ["Marketplace", "$18,500", "1964 Chevrolet Corvette", "Seller: Mike Dawson"],
                                    hasProminentFace: false)]
        let a = try XCTUnwrap(attribution(verdict(shot, at: "2023-09-16T21:00:00Z")))
        XCTAssertEqual(a.vehicleID, corvetteID)
        XCTAssertTrue(a.fields.allSatisfy { $0.frame == 1 && $0.seconds == 0 })
    }

    func testAVehicleThatDoesNotMatchTheTextIsNeverAttributed() {
        let frames = [frame(1, ["2019 Toyota Camry", "$18,500", "Seller: Mike Dawson"])]
        XCTAssertEqual(verdict(frames), .refused(.noVehicleEvidence))
    }

    func testOnScreenDatesNeedAYear() {
        XCTAssertEqual(ScreenCaptureEvidence.firstDate(in: "Sep 16, 2023"), "2023-09-16")
        XCTAssertEqual(ScreenCaptureEvidence.firstDate(in: "Posted September 3rd, 2023"), "2023-09-03")
        XCTAssertEqual(ScreenCaptureEvidence.firstDate(in: "9/16/2023 4:15 PM"), "2023-09-16")
        XCTAssertEqual(ScreenCaptureEvidence.firstDate(in: "2023-09-16"), "2023-09-16")
        XCTAssertNil(ScreenCaptureEvidence.firstDate(in: "Sep 16"), "no year, no date")
        XCTAssertNil(ScreenCaptureEvidence.firstDate(in: "Feb 31, 2023"))
        XCTAssertNil(ScreenCaptureEvidence.firstDate(in: "13/40/2023"))
    }

    func testTheThresholdsArePhotoGrade() {
        XCTAssertEqual(ScreenCaptureEvidence.rule, "screen_text_v1")
        XCTAssertGreaterThanOrEqual(ScreenCaptureEvidence.yearMakeModelConfidence, ScreenCaptureEvidence.confidenceFloor)
        XCTAssertGreaterThan(ScreenCaptureEvidence.vinConfidence, ScreenCaptureEvidence.yearMakeModelConfidence)
    }

    // ─── Ledger and row ───────────────────────────────────────────────────────

    private func screenFiling() -> VideoFiling {
        let payload = ScreenFilingPayload(kind: "screen_recording", method: "screen_ymm", confidence: 0.92,
                                          fields: [CitedField(name: "vehicle", value: "1964 Chevrolet Corvette", frame: 4, seconds: 17.5)],
                                          prices: [PriceObservation(amount: 18_500, kind: .asking, frame: 4, seconds: 17.5)],
                                          previewExtension: "mp4", contentType: "video/mp4")
        return VideoFiling(assetKey: "s", localID: "L", rowID: "row-s", vehicleID: corvetteID, method: "screen_ymm",
                           confidence: 0.92, rowJSON: Data("{}".utf8), fullDone: true, screen: payload)
    }

    func testAScreenCaptureIsDoneAfterItsPreviewBecauseTheOriginalNeverUploads() {
        var l = VideoLedger()
        l.recordCleared(screenFiling())
        l.setState("s", .rowInserted)
        l.setState("s", .filed)
        XCTAssertTrue(l.enqueue(VideoUploadRecord(assetKey: "s", rowID: "row-s", stage: .preview,
                                                  objectName: "users/u/previews/row-s.mp4", fileName: "s.mp4", contentType: "video/mp4")))
        l.completePreview(key: "s|preview")
        XCTAssertNil(l.filings["s"], "preview landed: nothing else is owed")
        XCTAssertEqual(l.checked["s"], "filed")
    }

    func testAnOlderLedgerWithoutScreenFieldsStillLoadsAndTheScreenPayloadRoundTrips() throws {
        let old = #"{"pending":[],"filings":{},"checked":{"a":"filed"}}"#
        let l = try JSONDecoder().decode(VideoLedger.self, from: Data(old.utf8))
        XCTAssertEqual(l.checked["a"], "filed")
        XCTAssertNil(l.anchorCache)
        var l2 = l
        l2.recordCleared(screenFiling())
        l2.setAnchor(corvetteID, firstPhoto: firstPhoto, now: t("2026-11-04T12:00:00Z"))
        let back = try JSONDecoder().decode(VideoLedger.self, from: JSONEncoder().encode(l2))
        XCTAssertEqual(back, l2)
        XCTAssertEqual(back.filings["s"]?.screen?.fields.first?.frame, 4)
    }

    func testTheAnchorCacheExpires() {
        var l = VideoLedger()
        let now = t("2026-11-04T12:00:00Z")
        l.setAnchor("V", firstPhoto: firstPhoto, now: now)
        XCTAssertNotNil(l.anchorEntry("V", now: now.addingTimeInterval(3600), maxAge: 7 * 86_400))
        XCTAssertNil(l.anchorEntry("V", now: now.addingTimeInterval(8 * 86_400), maxAge: 7 * 86_400))
        XCTAssertNil(l.anchorEntry("other", now: now, maxAge: 7 * 86_400))
    }

    func testTheScreenRowIsMetadataOnlyAndCarriesTheRuleAndAnchorSource() throws {
        let row = MediaImageRow(
            id: "r1", user_id: "u", image_url: "", file_name: "x-preview.mp4", mime_type: "video/mp4",
            is_video: true, duration_seconds: 42, video_codec: nil, video_resolution: nil,
            taken_at: "2023-09-16T20:15:00Z", latitude: nil, longitude: nil,
            source: VideoSyncConfig.rowSource, image_medium: "other", ai_processing_status: "skipped",
            is_sensitive: false, ingest_kind: "live", auto_suggested_vehicle_id: corvetteID,
            auto_suggestion_reasons: [ScreenCaptureEvidence.rule],
            exif_data: MediaExif(synced_by: "capture-relay-ios", asset_key: String(repeating: "b", count: 64), media: .init(
                kind: "screen_recording", bucket: "capture-media", preview_path: "users/u/previews/r1.mp4",
                full_state: "never_uploaded", device_model: "iPhone17,1", device_os: "26.0", width: 1170, height: 2532,
                match: .init(rule: "screen_text_v1", method: "screen_ymm", confidence: 0.92, frames_sampled: 12, frames_exact: 1,
                             candidates: 1, anchors: 0, window_seconds: 23 * 86_400, radius_m: 0, anchor_source: "first_filed_photo"))))
        let json = try XCTUnwrap(String(data: JSONEncoder().encode(row), encoding: .utf8))
        XCTAssertFalse(json.contains("\"vehicle_id\""), "the server sets vehicle_id after its own checks")
        XCTAssertFalse(json.contains("\"latitude\""), "no location is sent for a screen capture")
        XCTAssertFalse(json.contains("\"storage_path\""))
        XCTAssertTrue(json.contains("screen_text_v1"))
        XCTAssertTrue(json.contains("first_filed_photo"))
        XCTAssertTrue(json.contains("never_uploaded"))
        XCTAssertFalse(json.contains("Corvette"), "no text from the screen is stored in the row")
    }

    func testTheScreenPassNumbersAreBounded() {
        XCTAssertEqual(VideoSyncConfig.screenFramesPerRecording, 12)
        XCTAssertLessThanOrEqual(VideoSyncConfig.maxScreenReadsPerPass, 6)
        XCTAssertLessThanOrEqual(VideoSyncConfig.screenshotPreviewMaxBytes, 2 * 1024 * 1024)
        XCTAssertEqual(VideoSyncConfig.previewMaxSeconds, 60, "frames are read from the same 60 s the preview carries")
    }
}
