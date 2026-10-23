// VisionDecision.swift: the on-device photo filter as one pure, testable rule.
//
// Three outcomes are counted apart, because they mean different things:
//   • work            : a work photo. Pixels may upload.
//   • notWork         : rejected as not work-related (a screenshot, a web/ad/print capture).
//   • sensitive       : withheld as sensitive (an ID/document/receipt, or a person-centric
//                       photo with no vehicle or shop context). Never leaves the phone, not
//                       even as reject metadata.
//   • workWithPeople  : a work photo (vehicle, part, tool or shop label present) that also has
//                       a prominent face. People are a SOFT signal here: the photo counts as
//                       work and its metadata row uploads, but the PIXELS stay on the phone.
//                       The only blur/hide code in the app (LibraryGlasses/LibraryView,
//                       PersonalMode) is a SwiftUI display overlay; it never alters the bytes
//                       SyncEngine uploads, so it cannot guarantee a face is redacted before
//                       upload. Until an on-device pixel redaction exists, these stay held.

import Foundation

struct VisionDecision: Equatable, Codable, Sendable {
    enum Category: String, Codable, CaseIterable, Sendable {
        case work, notWork = "not_work", sensitive, workWithPeople = "work_with_people"
    }
    let category: Category
    let reason: String

    /// Pixels may leave the phone only for a plain work photo.
    var pixelsEligible: Bool { category == .work }
    /// The library grid's "personal" verdict (blur/hide on screen): sensitive only.
    var isPersonal: Bool { category == .sensitive }

    // Labels that mark a capture as sensitive (identity or money documents).
    static let sensitiveDocumentLabels: Set<String> = [
        "document", "text", "receipt", "paper", "printout", "envelope", "business_card",
        "spreadsheet", "invoice", "id_card", "form",
    ]
    // Labels that mark a capture as not work-related but not sensitive.
    static let notWorkLabels: Set<String> = VisionEngine.junkLabels.subtracting(sensitiveDocumentLabels)

    /// Vehicle, part, tool or shop context. Vision identifiers outside the ported vehicle
    /// set are best-effort names from the VNClassifyImageRequest taxonomy.
    static let workContextLabels: Set<String> = VisionEngine.allVehicleLabels.union([
        "machine", "machinery", "tool", "hand_tool", "power_tool", "wrench", "screwdriver",
        "drill", "hammer", "pliers", "workshop", "workbench", "motor", "engine_vehicle",
        "motorcycle", "trailer", "bumper", "headlight", "license_plate", "steering_wheel",
    ])
    /// A work label must reach this confidence to count as context for a person-in-frame photo.
    static let workContextThreshold: Float = 0.15

    static func hasWorkContext(labels: [(String, Float)], isVehicle: Bool) -> Bool {
        isVehicle || labels.contains { workContextLabels.contains($0.0.lowercased()) && $0.1 >= workContextThreshold }
    }

    /// Document/clutter part of the rule; needs no face read. nil = not clutter.
    static func clutter(labels: [(String, Float)], isScreenshot: Bool) -> VisionDecision? {
        if isScreenshot { return .init(category: .notWork, reason: "screenshot") }
        let top3 = labels.prefix(3).map { $0.0.lowercased() }
        if let l = top3.first(where: sensitiveDocumentLabels.contains) {
            return .init(category: .sensitive, reason: l == "id_card" ? "id_document" : "document")
        }
        if let l = top3.first(where: notWorkLabels.contains) { return .init(category: .notWork, reason: "capture_\(l)") }
        return nil
    }

    static func decide(labels: [(String, Float)], isVehicle: Bool, face: Bool, isScreenshot: Bool = false) -> VisionDecision {
        if let c = clutter(labels: labels, isScreenshot: isScreenshot) { return c }
        guard face else { return .init(category: .work, reason: isVehicle ? "vehicle" : "no_junk_signal") }
        return hasWorkContext(labels: labels, isVehicle: isVehicle)
            ? .init(category: .workWithPeople, reason: "people_no_redaction")
            : .init(category: .sensitive, reason: "personal_face")
    }
}
