// CaptureIngestStatus.swift — the live ingest status bar's model: stages, steps, summary text.
//
// THE ONE FILE that knows the backend's column and value names for public.capture_upload_status
// (primary key image_id = vehicle_images.id). Every name lives in `CaptureColumns` and the
// `init(serverValue:)` mappers below; if the schema moves, adjust those and nothing else.
//
// Decoding is tolerant by construction: rows are read key by key out of loose JSON, every field is
// optional, unknown stages and steps become generic friendly words, and a missing key can never
// throw or crash. Raw server words (snake_case, error strings) are never shown to the user.

import Foundation

// MARK: - Column names (the schema assumptions, in one place)

enum CaptureColumns {
    static let table = "capture_upload_status"
    static let userId = "user_id"
    static let createdAt = "created_at"
    static let updatedAt = "updated_at"
    /// Primary key = vehicle_images.id. Later names are fallbacks only.
    static let rowId = ["image_id", "vehicle_image_id", "id"]
    static let vehicleId = ["vehicle_id"]
    /// True once the photo is on a vehicle's record. The "on vehicle" count follows this, NOT stage:
    /// a photo can be attached while its stage still reads "uploaded".
    static let attached = ["attached"]
    /// Optional ready-made vehicle name, if the backend ever ships one.
    static let vehicleName = ["vehicle_name", "vehicle_title"]
    static let filename = ["filename"]
    static let stage = ["stage"]
    static let errorClass = ["error_class"]
    static let httpStatus = ["http_status"]
    static let step = ["current_step"]
    static let stepDetail = ["step_detail"]
    static let stepUpdatedAt = ["step_updated_at"]
    // Keys inside step_detail (free-form jsonb, partial results, all optional).
    static let vendor = ["vendor", "merchant", "store", "vendor_name"]
    static let date = ["date", "purchase_date", "receipt_date"]
    static let amount = ["amount", "total", "total_amount"]
    static let matchVehicleId = ["match_vehicle_id"]
    static let matchConfidence = ["match_confidence"]
    /// Tolerated if a nested object ever appears: step_detail.match = {name|vehicle_name, confidence}.
    static let match = ["match", "vehicle_match"]
    static let matchName = ["vehicle_name", "name", "label", "title"]
    static let nestedMatchConfidence = ["confidence", "score", "match_confidence"]
    /// step_detail may nest the extracted fields one level down under one of these.
    static let fieldsContainers = ["fields", "extracted", "result"]
}

// MARK: - Stage

/// Where a photo is on its way from the phone to a vehicle's record.
enum CaptureStage: Equatable {
    case uploaded, classifying, classified, attached, failed
    /// A stage word we don't know yet. Shown generically, never as the raw word.
    case working

    /// nil when the server sent no stage at all.
    init?(serverValue: String?) {
        guard let raw = CaptureParse.normalizedKey(serverValue) else { return nil }
        switch raw {
        case "uploaded", "uploading", "queued", "pending", "received": self = .uploaded
        case "classifying", "analyzing", "processing", "in_progress": self = .classifying
        case "classified", "analyzed", "done", "complete", "completed": self = .classified
        case "attached", "matched", "linked", "filed": self = .attached
        case "failed", "error", "errored": self = .failed
        default: self = .working
        }
    }

    /// The photo is finished one way or the other (nothing more will happen on its own).
    var isSettled: Bool { self == .classified || self == .attached || self == .failed }
}

// MARK: - Step (the live analysis line)

enum CaptureStep: Equatable {
    case queued, downloading, classifying, readingText, extractingFields, matchingVehicle, done, failed
    case other

    init?(serverValue: String?) {
        guard let raw = CaptureParse.normalizedKey(serverValue) else { return nil }
        switch raw {
        case "queued", "pending": self = .queued
        case "downloading", "fetching": self = .downloading
        case "classifying": self = .classifying
        case "reading_text", "ocr": self = .readingText
        case "extracting_fields", "extracting": self = .extractingFields
        case "matching_vehicle", "matching": self = .matchingVehicle
        case "done", "complete", "completed": self = .done
        case "failed", "error", "errored": self = .failed
        default: self = .other
        }
    }

    /// A friendly phrase for what the engine is doing right now.
    var label: String {
        switch self {
        case .queued: return "waiting its turn"
        case .downloading: return "getting the photo…"
        case .classifying: return "looking it over…"
        case .readingText: return "reading text…"
        case .extractingFields: return "picking out the details…"
        case .matchingVehicle: return "finding the vehicle…"
        case .done: return "all done"
        case .failed: return "didn't work"
        case .other: return "working on it…"
        }
    }
}

// MARK: - Partial results (step_detail)

/// What the engine has found so far. Every part is optional; a half-filled value is normal.
struct CaptureStepDetail: Equatable {
    var vendor: String?
    var date: String?
    var amount: String?
    var matchName: String?
    var matchVehicleId: String?
    var matchConfidence: Int?
    var hasMatch = false

    var hasFields: Bool { vendor != nil || date != nil || amount != nil }

    /// "Found O'Reilly · 10/28 · $84.12" (only the parts we have); nil when nothing is found yet.
    var foundText: String? {
        let parts = [vendor, date, amount].compactMap { $0 }
        return parts.isEmpty ? nil : "Found " + parts.joined(separator: " · ")
    }

    init() {}

    /// Accepts the jsonb as an object, or as a JSON string holding an object. Anything else → empty.
    init(json: Any?) {
        var object = json as? [String: Any]
        if object == nil, let text = json as? String, let data = text.data(using: .utf8) {
            object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        }
        guard let root = object else { return }
        var fields = root
        for key in CaptureColumns.fieldsContainers {
            if let nested = root[key] as? [String: Any] { fields = nested; break }
        }
        vendor = CaptureParse.string(CaptureParse.first(CaptureColumns.vendor, in: fields)) ?? CaptureParse.string(CaptureParse.first(CaptureColumns.vendor, in: root))
        date = CaptureParse.shortDate(CaptureParse.first(CaptureColumns.date, in: fields) ?? CaptureParse.first(CaptureColumns.date, in: root))
        amount = CaptureParse.money(CaptureParse.first(CaptureColumns.amount, in: fields) ?? CaptureParse.first(CaptureColumns.amount, in: root))
        // Flat form (the live schema): match_vehicle_id and/or match_confidence beside the other keys.
        matchVehicleId = CaptureParse.string(CaptureParse.first(CaptureColumns.matchVehicleId, in: root))
        matchConfidence = CaptureParse.percent(CaptureParse.first(CaptureColumns.matchConfidence, in: root))
        hasMatch = matchVehicleId != nil || matchConfidence != nil
        if let m = CaptureParse.first(CaptureColumns.match, in: root) {
            if let obj = m as? [String: Any] {
                hasMatch = true
                matchName = CaptureParse.string(CaptureParse.first(CaptureColumns.matchName, in: obj))
                matchConfidence = CaptureParse.percent(CaptureParse.first(CaptureColumns.nestedMatchConfidence, in: obj)) ?? matchConfidence
            } else if let name = CaptureParse.string(m) {
                hasMatch = true
                matchName = name
            }
        }
    }
}

// MARK: - Row

struct CaptureUploadRow: Identifiable, Equatable {
    let id: String
    var vehicleId: String?
    /// A ready-made name from the backend, if it sent one.
    var vehicleName: String?
    var filename: String?
    var stage: CaptureStage
    var step: CaptureStep?
    var stepDetail: CaptureStepDetail
    /// True once the photo is on a vehicle's record (the `attached` column; nil if not sent).
    var attachedFlag: Bool?
    var errorClass: String?
    var httpStatus: Int?
    var createdAt: Date?
    var updatedAt: Date?
    var stepUpdatedAt: Date?

    /// nil when the object has no usable id (such a row can't be tracked, so it is skipped).
    init?(json: [String: Any]) {
        guard let id = CaptureParse.string(CaptureParse.first(CaptureColumns.rowId, in: json)) else { return nil }
        self.id = id
        vehicleId = CaptureParse.string(CaptureParse.first(CaptureColumns.vehicleId, in: json))
        vehicleName = CaptureParse.string(CaptureParse.first(CaptureColumns.vehicleName, in: json))
        filename = CaptureParse.string(CaptureParse.first(CaptureColumns.filename, in: json))
        attachedFlag = CaptureParse.bool(CaptureParse.first(CaptureColumns.attached, in: json))
        errorClass = CaptureParse.string(CaptureParse.first(CaptureColumns.errorClass, in: json))
        httpStatus = CaptureParse.int(CaptureParse.first(CaptureColumns.httpStatus, in: json))
        createdAt = CaptureParse.date(json[CaptureColumns.createdAt])
        updatedAt = CaptureParse.date(json[CaptureColumns.updatedAt])
        stepUpdatedAt = CaptureParse.date(CaptureParse.first(CaptureColumns.stepUpdatedAt, in: json))
        step = CaptureStep(serverValue: CaptureParse.string(CaptureParse.first(CaptureColumns.step, in: json)))
        stepDetail = CaptureStepDetail(json: CaptureParse.first(CaptureColumns.stepDetail, in: json))
        let stageWord = CaptureParse.string(CaptureParse.first(CaptureColumns.stage, in: json))
        stage = CaptureStage(serverValue: stageWord) ?? Self.stageFromStep(step, vehicleId: vehicleId)
    }

    /// On a vehicle's record. Follows the `attached` flag; only when the server sent none does the stage word decide.
    var isOnVehicle: Bool { attachedFlag ?? (stage == .attached) }

    /// Used only when the server sent no stage word but did send a step.
    private static func stageFromStep(_ step: CaptureStep?, vehicleId: String?) -> CaptureStage {
        switch step {
        case .failed?: return .failed
        case .done?: return vehicleId == nil ? .classified : .attached
        case .readingText?, .extractingFields?, .matchingVehicle?: return .classifying
        default: return .uploaded
        }
    }

    // MARK: Parsing entry points

    /// Rows from a response body: a JSON array of objects, or an object wrapping one under rows/photos.
    static func parseList(_ data: Data) -> [CaptureUploadRow] {
        guard let any = try? JSONSerialization.jsonObject(with: data) else { return [] }
        return rows(fromJSON: any)
    }

    static func rows(fromJSON any: Any) -> [CaptureUploadRow] {
        if let list = any as? [[String: Any]] { return list.compactMap { CaptureUploadRow(json: $0) } }
        if let object = any as? [String: Any] {
            for key in ["rows", "photos", "items"] {
                if let list = object[key] as? [[String: Any]] { return list.compactMap { CaptureUploadRow(json: $0) } }
            }
            if let one = CaptureUploadRow(json: object) { return [one] }
        }
        return []
    }

    // MARK: Words

    /// "IMG_5272" — the filename without its extension, or "Photo".
    var shortName: String {
        guard let name = filename else { return "Photo" }
        let base = (name as NSString).deletingPathExtension
        return base.isEmpty ? name : base
    }

    /// The reason a photo failed, in plain words; nil when there is none to give.
    var failureReason: String? { CaptureCopy.friendlyReason(errorClass: errorClass, httpStatus: httpStatus) }

    /// The vehicle this photo is on, in words: its own name, else the looked-up one, else "a vehicle".
    func vehicleLabel(names: [String: String]) -> String {
        CaptureIngestSummary.vehicleName(for: self, names: names)
    }

    /// The big per-photo stage label for the expanded list. `names` maps vehicle_id → "1973 Firebird".
    func stageLabel(names: [String: String]) -> String {
        if stage == .failed {
            if let reason = failureReason { return "Didn't work: \(reason)" }
            return "Didn't work"
        }
        if isOnVehicle { return "Added to \(vehicleLabel(names: names))" }
        switch stage {
        case .uploaded: return "Uploaded"
        case .classifying: return "Looking it over"
        case .classified, .attached: return "Sorted"
        case .working: return "Working on it"
        case .failed: return "Didn't work"
        }
    }

    /// The live analysis line, e.g. "IMG_5272 · reading text…", "Found O'Reilly · 10/28 · $84.12",
    /// "Matched to 1973 Firebird (92%)". Newest knowledge wins: failure, then match, then fields, then the step.
    func liveLine(names: [String: String]) -> String {
        if stage == .failed || step == .failed {
            if let reason = failureReason { return "\(shortName) · didn't work, \(reason)" }
            return "\(shortName) · didn't work"
        }
        if stepDetail.hasMatch {
            let who = stepDetail.matchName
                ?? stepDetail.matchVehicleId.flatMap { names[$0] }
                ?? (isOnVehicle ? vehicleLabel(names: names) : CaptureIngestSummary.fallbackVehicleName)
            if let pct = stepDetail.matchConfidence { return "Matched to \(who) (\(pct)%)" }
            return "Matched to \(who)"
        }
        if let found = stepDetail.foundText { return found }
        if let step = step { return "\(shortName) · \(step.label)" }
        switch stage {
        case .uploaded: return "\(shortName) · waiting its turn"
        case .classifying: return "\(shortName) · looking it over…"
        case .classified, .attached: return "\(shortName) · sorted"
        case .working: return "\(shortName) · working on it…"
        case .failed: return "\(shortName) · didn't work"
        }
    }
}

// MARK: - Summary (the bar's text)

struct CaptureIngestSummary: Equatable {
    var uploaded = 0
    var classified = 0
    var attached = 0
    var failed = 0
    /// Attached photos grouped by vehicle name, biggest group first.
    var onVehicle: [(name: String, count: Int)] = []

    static let fallbackVehicleName = "a vehicle"

    var isEmpty: Bool { uploaded == 0 }

    /// `names` maps vehicle_id → "1973 Firebird" for rows that carry no name of their own.
    init(rows: [CaptureUploadRow], names: [String: String] = [:]) {
        uploaded = rows.count
        var groups: [String: Int] = [:]
        for row in rows {
            if row.stage == .classified || row.stage == .attached { classified += 1 }
            if row.stage == .failed { failed += 1 }
            // "On a vehicle" follows the attached flag, not the stage (a photo can be attached while still "uploaded").
            if row.isOnVehicle && row.stage != .failed {
                attached += 1
                groups[CaptureIngestSummary.vehicleName(for: row, names: names), default: 0] += 1
            }
        }
        onVehicle = groups.map { (name: $0.key, count: $0.value) }
            .sorted { $0.count != $1.count ? $0.count > $1.count : $0.name < $1.name }
    }

    static func == (a: CaptureIngestSummary, b: CaptureIngestSummary) -> Bool {
        a.uploaded == b.uploaded && a.classified == b.classified && a.attached == b.attached
            && a.failed == b.failed && a.onVehicle.map { "\($0.name)|\($0.count)" } == b.onVehicle.map { "\($0.name)|\($0.count)" }
    }

    /// A row's vehicle name: its own, else the looked-up one, else "a vehicle".
    static func vehicleName(for row: CaptureUploadRow, names: [String: String]) -> String {
        if let n = row.vehicleName { return n }
        if let id = row.vehicleId, let n = names[id] { return n }
        return fallbackVehicleName
    }

    /// "12 uploaded · 9 classified · 9 on 1973 Firebird · 1 failed" — zero parts are left out,
    /// except uploaded. A third vehicle onward folds into "N on other vehicles".
    var text: String {
        guard !isEmpty else { return "" }
        var parts = ["\(uploaded) uploaded"]
        if classified > 0 { parts.append("\(classified) classified") }
        for group in onVehicle.prefix(2) { parts.append("\(group.count) on \(group.name)") }
        let rest = onVehicle.dropFirst(2).reduce(0) { $0 + $1.count }
        if rest > 0 { parts.append("\(rest) on other vehicles") }
        if failed > 0 { parts.append("\(failed) failed") }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Plain-words helpers

enum CaptureCopy {
    /// A plain-words reason from error_class / http_status, or nil when the server gave neither.
    /// Unknown codes become a generic line; raw codes and snake_case are never shown.
    static func friendlyReason(errorClass: String?, httpStatus: Int?) -> String? {
        if let word = CaptureParse.string(errorClass)?.lowercased() {
            let table: [(keys: [String], reason: String)] = [
                (["timeout", "timed_out", "timed out", "deadline"], "it took too long"),
                (["network", "offline", "connection", "dns"], "the connection dropped"),
                (["rate_limit", "rate limit", "throttl", "quota", "busy"], "we're busy right now"),
                (["too_large", "too large", "size", "payload"], "the photo is too large"),
                (["blurry", "unreadable", "no_text", "no text", "unsupported", "corrupt", "decode", "invalid_image"], "the photo was hard to read"),
                (["not_a_receipt", "not a receipt"], "it didn't look like a receipt"),
                (["not_found", "missing", "404"], "the photo couldn't be found"),
                (["auth", "unauthorized", "forbidden", "permission", "token"], "we couldn't sign in to check it"),
                (["server", "internal", "upstream", "unavailable"], "our server had a hiccup"),
            ]
            for entry in table where entry.keys.contains(where: { word.contains($0) }) { return entry.reason }
        }
        if let code = httpStatus {
            switch code {
            case 408, 504: return "it took too long"
            case 429: return "we're busy right now"
            case 413: return "the photo is too large"
            case 404: return "the photo couldn't be found"
            case 401, 403: return "we couldn't sign in to check it"
            case 500...599: return "our server had a hiccup"
            case 400...499: return "the photo couldn't be read"
            default: break
            }
        }
        return CaptureParse.string(errorClass) != nil ? "something went wrong" : nil
    }
}

// MARK: - Loose JSON readers

enum CaptureParse {
    /// The first present, non-null value among `keys`.
    static func first(_ keys: [String], in object: [String: Any]) -> Any? {
        for key in keys {
            if let value = object[key], !(value is NSNull) { return value }
        }
        return nil
    }

    static func string(_ any: Any?) -> String? {
        let raw: String?
        switch any {
        case let s as String: raw = s
        case let n as NSNumber: raw = n.stringValue
        default: raw = nil
        }
        guard let t = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
        return t
    }

    static func bool(_ any: Any?) -> Bool? {
        switch any {
        case let b as Bool: return b
        case let n as NSNumber: return n.intValue != 0
        case let s as String:
            switch s.lowercased() {
            case "true", "t", "1", "yes": return true
            case "false", "f", "0", "no": return false
            default: return nil
            }
        default: return nil
        }
    }

    static func int(_ any: Any?) -> Int? {
        if let n = any as? NSNumber { return n.intValue }
        if let s = string(any) { return Int(s) }
        return nil
    }

    /// "Reading_Text" / "reading-text" / "reading text" → "reading_text".
    static func normalizedKey(_ any: String?) -> String? {
        guard let t = string(any) else { return nil }
        return t.lowercased().replacingOccurrences(of: "-", with: "_").replacingOccurrences(of: " ", with: "_")
    }

    private static let isoFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let isoPlain = ISO8601DateFormatter()

    static func date(_ any: Any?) -> Date? {
        guard let s = string(any) else { return nil }
        return isoFraction.date(from: s) ?? isoPlain.date(from: s)
    }

    static func isoString(_ date: Date) -> String { isoFraction.string(from: date) }

    /// "2026-10-28" / "2026-10-28T…" / "10/28/2026" → "10/28". Already-short text passes through; long text is dropped.
    static func shortDate(_ any: Any?) -> String? {
        guard let s = string(any) else { return nil }
        let head = String(s.prefix(10))
        let ymd = head.split(separator: "-")
        if ymd.count == 3, ymd[0].count == 4, let m = Int(ymd[1]), let d = Int(ymd[2]) { return "\(m)/\(d)" }
        let mdy = s.split(separator: "/")
        if mdy.count >= 2, let m = Int(mdy[0]), let d = Int(mdy[1]) { return "\(m)/\(d)" }
        return s.count <= 12 ? s : nil
    }

    /// 84.12 / "84.12" / "$84.12" → "$84.12". Not a number → nil.
    static func money(_ any: Any?) -> String? {
        var value: Double?
        if let n = any as? NSNumber { value = n.doubleValue }
        else if let s = string(any) {
            value = Double(s.replacingOccurrences(of: "$", with: "").replacingOccurrences(of: ",", with: ""))
        }
        guard let v = value, v.isFinite else { return nil }
        return String(format: "$%.2f", v)
    }

    /// 0.92 → 92, 92 → 92, "92%" → 92; clamped to 0…100.
    static func percent(_ any: Any?) -> Int? {
        var value: Double?
        if let n = any as? NSNumber { value = n.doubleValue }
        else if let s = string(any) { value = Double(s.replacingOccurrences(of: "%", with: "")) }
        guard var v = value, v.isFinite else { return nil }
        if v >= 0, v <= 1 { v *= 100 }
        return Int(min(100, max(0, v)).rounded())
    }

    /// "1973 Firebird" from a vehicles row; nil when it has neither year nor model/make.
    static func vehicleTitle(_ object: [String: Any]) -> String? {
        let year = string(object["year"])
        let model = string(object["model"]) ?? string(object["make"])
        let parts = [year, model].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }
}
