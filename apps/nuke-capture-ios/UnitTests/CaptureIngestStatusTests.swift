// CaptureIngestStatusTests.swift — the live ingest bar: stage mapping, step labels, partial step_detail
// decoding, failure wording and the summary text. Pure model tests; no network.

import XCTest
@testable import NukeCapture

final class CaptureIngestStatusTests: XCTestCase {
    private func row(_ json: String) -> CaptureUploadRow {
        let object = try! JSONSerialization.jsonObject(with: Data(json.utf8)) as! [String: Any]
        return CaptureUploadRow(json: object)!
    }

    private func make(_ id: String, stage: String, attached: Bool? = nil, vehicle: String? = nil, extra: String = "") -> CaptureUploadRow {
        var parts = ["\"image_id\":\"\(id)\"", "\"stage\":\"\(stage)\""]
        if let attached { parts.append("\"attached\":\(attached)") }
        if let vehicle { parts.append("\"vehicle_id\":\"\(vehicle)\"") }
        if !extra.isEmpty { parts.append(extra) }
        return row("{" + parts.joined(separator: ",") + "}")
    }

    // MARK: Stage mapping

    func testStageWordsMapToStages() {
        XCTAssertEqual(CaptureStage(serverValue: "uploaded"), .uploaded)
        XCTAssertEqual(CaptureStage(serverValue: "classifying"), .classifying)
        XCTAssertEqual(CaptureStage(serverValue: "classified"), .classified)
        XCTAssertEqual(CaptureStage(serverValue: "attached"), .attached)
        XCTAssertEqual(CaptureStage(serverValue: "failed"), .failed)
        XCTAssertEqual(CaptureStage(serverValue: " Classifying "), .classifying)
    }

    func testUnknownOrMissingStage() {
        XCTAssertEqual(CaptureStage(serverValue: "teleporting"), .working)
        XCTAssertNil(CaptureStage(serverValue: nil))
        XCTAssertNil(CaptureStage(serverValue: "  "))
    }

    func testSettledStages() {
        XCTAssertTrue(CaptureStage.classified.isSettled)
        XCTAssertTrue(CaptureStage.failed.isSettled)
        XCTAssertFalse(CaptureStage.uploaded.isSettled)
        XCTAssertFalse(CaptureStage.classifying.isSettled)
    }

    // MARK: Step labels

    func testEveryKnownStepHasAFriendlyLabel() {
        let expected: [String: String] = [
            "queued": "waiting its turn", "downloading": "getting the photo…", "classifying": "looking it over…",
            "reading_text": "reading text…", "extracting_fields": "picking out the details…",
            "matching_vehicle": "finding the vehicle…", "done": "all done", "failed": "didn't work",
        ]
        for (word, label) in expected {
            XCTAssertEqual(CaptureStep(serverValue: word)?.label, label, word)
        }
    }

    func testUnknownStepIsGenericNeverRaw() {
        let step = CaptureStep(serverValue: "warming_up_flux_capacitor")
        XCTAssertEqual(step, .other)
        XCTAssertEqual(step?.label, "working on it…")
        XCTAssertFalse(step!.label.contains("_"))
        XCTAssertNil(CaptureStep(serverValue: nil))
    }

    func testStepWordsAreNormalised() {
        XCTAssertEqual(CaptureStep(serverValue: "Reading-Text"), .readingText)
        XCTAssertEqual(CaptureStep(serverValue: "matching vehicle"), .matchingVehicle)
    }

    // MARK: Decoding

    func testDecodesTheLiveExampleRecord() {
        let r = row("""
        {"image_id":"b79c1f2e-0000-4000-8000-000000000001","user_id":"0b9f1f2e-0000-4000-8000-000000000002",
         "vehicle_id":"20d21fb0-4651-4469-a0ba-e751309a1e54","attached":true,"filename":"IMG_5263.HEIC",
         "stage":"attached","stage_detail":{"image_type":"vehicle_exterior","confidence":0.95,"is_document":false},
         "image_type":"vehicle_exterior","confidence":0.95,"current_step":"done","step_detail":{},
         "step_updated_at":"2026-11-02T19:40:08Z"}
        """)
        XCTAssertEqual(r.id, "b79c1f2e-0000-4000-8000-000000000001")
        XCTAssertEqual(r.vehicleId, "20d21fb0-4651-4469-a0ba-e751309a1e54")
        XCTAssertEqual(r.stage, .attached)
        XCTAssertEqual(r.step, .done)
        XCTAssertTrue(r.isOnVehicle)
        XCTAssertEqual(r.shortName, "IMG_5263")
        XCTAssertNotNil(r.stepUpdatedAt)
        XCTAssertFalse(r.stepDetail.hasMatch)
        XCTAssertEqual(r.stageLabel(names: ["20d21fb0-4651-4469-a0ba-e751309a1e54": "1973 Firebird"]), "Added to 1973 Firebird")
        XCTAssertEqual(r.stageLabel(names: [:]), "Added to a vehicle")
        XCTAssertEqual(r.liveLine(names: [:]), "IMG_5263 · all done")
    }

    func testRowNeedsOnlyAnId() {
        let r = row("{\"image_id\":\"abc\"}")
        XCTAssertEqual(r.stage, .uploaded)
        XCTAssertNil(r.step)
        XCTAssertFalse(r.isOnVehicle)
        XCTAssertEqual(r.shortName, "Photo")
        XCTAssertEqual(r.liveLine(names: [:]), "Photo · waiting its turn")
        XCTAssertNil(CaptureUploadRow(json: ["stage": "uploaded"]))
    }

    func testWrongTypesNeverCrash() {
        let r = row("{\"image_id\":7,\"stage\":5,\"attached\":\"yes\",\"filename\":null,\"current_step\":{},\"step_detail\":\"not json\",\"http_status\":\"x\",\"updated_at\":12}")
        XCTAssertEqual(r.id, "7")
        XCTAssertFalse(r.stepDetail.hasFields)
        XCTAssertEqual(r.attachedFlag, true)
        XCTAssertNil(r.httpStatus)
        XCTAssertNil(r.updatedAt)
    }

    func testStageFallsBackToStepWhenMissing() {
        XCTAssertEqual(row("{\"image_id\":\"a\",\"current_step\":\"failed\"}").stage, .failed)
        XCTAssertEqual(row("{\"image_id\":\"a\",\"current_step\":\"reading_text\"}").stage, .classifying)
    }

    func testParseListAcceptsArraysAndWrappedRows() {
        XCTAssertEqual(CaptureUploadRow.parseList(Data("[{\"image_id\":\"a\"},{\"nope\":1},{\"image_id\":\"b\"}]".utf8)).map(\.id), ["a", "b"])
        XCTAssertEqual(CaptureUploadRow.parseList(Data("{\"rows\":[{\"image_id\":\"a\"}]}".utf8)).map(\.id), ["a"])
        XCTAssertTrue(CaptureUploadRow.parseList(Data("garbage".utf8)).isEmpty)
        XCTAssertTrue(CaptureUploadRow.parseList(Data("{\"message\":\"relation does not exist\"}".utf8)).isEmpty)
    }

    // MARK: Partial step_detail

    func testPartialStepDetailVendorOnly() {
        let r = row("{\"image_id\":\"a\",\"filename\":\"IMG_1.HEIC\",\"current_step\":\"extracting_fields\",\"step_detail\":{\"vendor\":\"O'Reilly\"}}")
        XCTAssertEqual(r.stepDetail.vendor, "O'Reilly")
        XCTAssertNil(r.stepDetail.amount)
        XCTAssertEqual(r.liveLine(names: [:]), "Found O'Reilly")
    }

    func testFullFieldsLine() {
        let r = row("{\"image_id\":\"a\",\"current_step\":\"extracting_fields\",\"step_detail\":{\"vendor\":\"O'Reilly\",\"date\":\"2026-10-28\",\"amount\":84.12}}")
        XCTAssertEqual(r.liveLine(names: [:]), "Found O'Reilly · 10/28 · $84.12")
    }

    func testAmountAndDateShapesAreTolerated() {
        XCTAssertEqual(CaptureParse.money("$1,084.5"), "$1084.50")
        XCTAssertEqual(CaptureParse.money("84.12"), "$84.12")
        XCTAssertNil(CaptureParse.money("free"))
        XCTAssertEqual(CaptureParse.shortDate("2026-10-28T09:30:00Z"), "10/28")
        XCTAssertEqual(CaptureParse.shortDate("10/28/2026"), "10/28")
        XCTAssertNil(CaptureParse.shortDate("the twenty-eighth of October"))
    }

    func testStepDetailAsJSONStringAndNested() {
        let asString = CaptureStepDetail(json: "{\"vendor\":\"NAPA\",\"amount\":\"12\"}")
        XCTAssertEqual(asString.vendor, "NAPA")
        XCTAssertEqual(asString.amount, "$12.00")
        let nested = CaptureStepDetail(json: ["fields": ["vendor": "Pep Boys"]])
        XCTAssertEqual(nested.vendor, "Pep Boys")
        XCTAssertFalse(CaptureStepDetail(json: nil).hasFields)
        XCTAssertFalse(CaptureStepDetail(json: 42).hasFields)
    }

    func testMatchLineUsesLookedUpNameAndConfidence() {
        let r = row("{\"image_id\":\"a\",\"current_step\":\"matching_vehicle\",\"step_detail\":{\"vendor\":\"X\",\"match_vehicle_id\":\"v1\",\"match_confidence\":0.92}}")
        XCTAssertEqual(r.stepDetail.matchConfidence, 92)
        XCTAssertEqual(r.liveLine(names: ["v1": "1973 Firebird"]), "Matched to 1973 Firebird (92%)")
        XCTAssertEqual(r.liveLine(names: [:]), "Matched to a vehicle (92%)")
    }

    func testConfidenceShapes() {
        XCTAssertEqual(CaptureParse.percent(0.92), 92)
        XCTAssertEqual(CaptureParse.percent(92), 92)
        XCTAssertEqual(CaptureParse.percent("92%"), 92)
        XCTAssertEqual(CaptureParse.percent(250), 100)
        XCTAssertNil(CaptureParse.percent("high"))
    }

    func testNestedMatchObjectIsTolerated() {
        let r = row("{\"image_id\":\"a\",\"step_detail\":{\"match\":{\"name\":\"1969 Camaro\",\"confidence\":87}}}")
        XCTAssertEqual(r.liveLine(names: [:]), "Matched to 1969 Camaro (87%)")
    }

    func testClassificationConfidenceIsNotAVehicleMatch() {
        let r = row("{\"image_id\":\"a\",\"step_detail\":{\"confidence\":0.95}}")
        XCTAssertFalse(r.stepDetail.hasMatch)
    }

    func testLiveLineFollowsTheStep() {
        func line(_ step: String) -> String { row("{\"image_id\":\"a\",\"filename\":\"IMG_5272.HEIC\",\"current_step\":\"\(step)\"}").liveLine(names: [:]) }
        XCTAssertEqual(line("reading_text"), "IMG_5272 · reading text…")
        XCTAssertEqual(line("queued"), "IMG_5272 · waiting its turn")
        XCTAssertEqual(line("something_new"), "IMG_5272 · working on it…")
    }

    // MARK: Failure wording

    func testFailureReasonsAreFriendly() {
        XCTAssertEqual(CaptureCopy.friendlyReason(errorClass: "timeout", httpStatus: nil), "it took too long")
        XCTAssertEqual(CaptureCopy.friendlyReason(errorClass: nil, httpStatus: 429), "we're busy right now")
        XCTAssertEqual(CaptureCopy.friendlyReason(errorClass: nil, httpStatus: 503), "our server had a hiccup")
        XCTAssertEqual(CaptureCopy.friendlyReason(errorClass: nil, httpStatus: 422), "the photo couldn't be read")
        XCTAssertEqual(CaptureCopy.friendlyReason(errorClass: "weird_new_class", httpStatus: nil), "something went wrong")
        XCTAssertNil(CaptureCopy.friendlyReason(errorClass: nil, httpStatus: nil))
    }

    func testFailedRowShowsReasonWithoutJargon() {
        let r = row("{\"image_id\":\"a\",\"filename\":\"IMG_9.HEIC\",\"stage\":\"failed\",\"error_class\":\"vision_http_error\",\"http_status\":504}")
        XCTAssertEqual(r.stageLabel(names: [:]), "Didn't work: it took too long")
        XCTAssertEqual(r.liveLine(names: [:]), "IMG_9 · didn't work, it took too long")
        XCTAssertFalse(r.stageLabel(names: [:]).contains("_"))
    }

    // MARK: Summary text

    func testSummaryTextMatchesTheSpecExample() {
        var rows: [CaptureUploadRow] = []
        for i in 0..<9 { rows.append(make("a\(i)", stage: "attached", attached: true, vehicle: "v1")) }
        rows.append(make("f", stage: "failed"))
        rows.append(make("u1", stage: "uploaded"))
        rows.append(make("u2", stage: "classifying"))
        let summary = CaptureIngestSummary(rows: rows, names: ["v1": "1973 Firebird"])
        XCTAssertEqual(summary.text, "12 uploaded · 9 classified · 9 on 1973 Firebird · 1 failed")
    }

    func testOnVehicleFollowsAttachedNotStage() {
        // Attached but not yet classified: stage still "uploaded", attached = true.
        let r = make("a", stage: "uploaded", attached: true, vehicle: "v1")
        let summary = CaptureIngestSummary(rows: [r], names: ["v1": "1973 Firebird"])
        XCTAssertEqual(summary.text, "1 uploaded · 1 on 1973 Firebird")
        // Stage says attached but the flag says no: not on a vehicle.
        let s2 = CaptureIngestSummary(rows: [make("b", stage: "attached", attached: false)])
        XCTAssertEqual(s2.text, "1 uploaded · 1 classified")
    }

    func testVehicleNameFallsBackToAVehicle() {
        let r = make("a", stage: "attached", attached: true, vehicle: "unknown-id")
        XCTAssertEqual(CaptureIngestSummary(rows: [r]).text, "1 uploaded · 1 classified · 1 on a vehicle")
    }

    func testZeroPartsAreLeftOutAndEmptyIsHidden() {
        XCTAssertEqual(CaptureIngestSummary(rows: [make("a", stage: "uploaded")]).text, "1 uploaded")
        let empty = CaptureIngestSummary(rows: [])
        XCTAssertTrue(empty.isEmpty)
        XCTAssertEqual(empty.text, "")
    }

    func testManyVehiclesFoldIntoOther() {
        var rows: [CaptureUploadRow] = []
        for (i, v) in ["v1", "v1", "v1", "v2", "v2", "v3", "v4"].enumerated() {
            rows.append(make("r\(i)", stage: "attached", attached: true, vehicle: v))
        }
        let names = ["v1": "1973 Firebird", "v2": "1969 Camaro", "v3": "1966 Mustang", "v4": "1957 Bel Air"]
        let text = CaptureIngestSummary(rows: rows, names: names).text
        XCTAssertEqual(text, "7 uploaded · 7 classified · 3 on 1973 Firebird · 2 on 1969 Camaro · 2 on other vehicles")
    }

    func testFailedPhotosAreNotCountedOnAVehicle() {
        let r = make("a", stage: "failed", attached: true, vehicle: "v1")
        XCTAssertEqual(CaptureIngestSummary(rows: [r], names: ["v1": "1973 Firebird"]).text, "1 uploaded · 1 failed")
    }

    func testBarTextHasNoSnakeCase() {
        let r = row("{\"image_id\":\"a\",\"stage\":\"mystery_stage\",\"current_step\":\"mystery_step\",\"error_class\":\"some_class\"}")
        XCTAssertFalse(r.stageLabel(names: [:]).contains("_"))
        XCTAssertFalse(CaptureIngestSummary(rows: [r]).text.contains("_"))
    }
}
