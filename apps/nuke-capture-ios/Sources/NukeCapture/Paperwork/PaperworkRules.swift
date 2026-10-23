// PaperworkRules.swift — the pure rules behind Paperwork scan mode: label-card reading, batch
// application, the on-device document-date hint and the upload payload. No UIKit, no Vision, no
// network, so the unit tests exercise exactly what the phone ships.
//
// Two dates, never confused: `scanned_at` is when the phone captured the page (scan time only);
// `document_date_hint` is read from the page text. The hint is a hint: document-ocr-worker on the
// server stays authoritative for the document's date.
//
// A label card ("Box 3, R3500 receipts 2017") opens a batch that the following documents carry as
// SOFT, CITED evidence (the label page's id plus a confidence), never as a hard vehicle assignment.

import Foundation

// MARK: - Label card

struct LabelCard: Codable, Equatable {
    var box: String?
    var vehicleHint: String?
    var yearHint: Int?
    var confidence: Double
    /// The label's own text, kept so the evidence can quote what it cites.
    var text: String
    /// True when the owner flipped "This is a label card" (versus detection from the text).
    var explicit: Bool
}

enum LabelCardParser {
    /// A label is short: a handful of words on an index card, not a receipt.
    static let maxCharacters = 90
    static let maxLines = 5

    private static let boxPattern = try! NSRegularExpression(pattern: #"\b(?:box|bx)\s*(?:#|no\.?|number)?\s*([0-9]{1,4}[a-z]?)\b"#, options: [.caseInsensitive])
    private static let yearPattern = try! NSRegularExpression(pattern: #"(?<![0-9])(19[5-9][0-9]|20[0-3][0-9])(?![0-9])"#)
    /// Model codes such as R3500, K5, C10, 911, F250; a bare year never counts (it is filtered out).
    private static let modelCodePattern = try! NSRegularExpression(pattern: #"\b([A-Za-z]{1,3}-?[0-9]{1,4}[A-Za-z]?)\b"#)
    private static let makes: [String] = ["chevy", "chevrolet", "gmc", "ford", "dodge", "ram", "jeep", "toyota", "porsche",
        "blazer", "suburban", "bronco", "corvette", "camaro", "mustang", "jimmy", "silverado", "sierra", "squarebody",
        "cheyenne", "scottsdale", "datsun", "nissan", "land cruiser", "mercedes", "bmw", "volkswagen", "vw", "pickup", "truck"]

    /// Reads a page's OCR text. Returns nil when the page is not a label card.
    /// `explicit` (the toggle) always yields a card, whatever the text says.
    static func parse(_ rawText: String, explicit: Bool = false) -> LabelCard? {
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        let lines = text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let flat = lines.joined(separator: " ")
        let short = !flat.isEmpty && flat.count <= maxCharacters && lines.count <= maxLines

        let box = firstCapture(boxPattern, in: flat)
        let year = firstCapture(yearPattern, in: flat).flatMap(Int.init)
        let vehicle = vehicleHint(in: flat, box: box)

        if explicit {
            return LabelCard(box: box, vehicleHint: vehicle, yearHint: year, confidence: 0.95, text: flat, explicit: true)
        }
        guard short else { return nil }
        let cues = [box != nil, year != nil, vehicle != nil].filter { $0 }.count
        // A box cue alone reads as a label; a year or vehicle alone is too common on a short receipt stub.
        guard box != nil || cues >= 2 else { return nil }
        let confidence = min(0.9, 0.45 + 0.15 * Double(cues))
        return LabelCard(box: box, vehicleHint: vehicle, yearHint: year, confidence: confidence, text: flat, explicit: false)
    }

    static func vehicleHint(in text: String, box: String?) -> String? {
        let ns = text as NSString
        for m in modelCodePattern.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            let token = ns.substring(with: m.range(at: 1))
            let lower = token.lowercased()
            if yearPattern.firstMatch(in: token, range: NSRange(location: 0, length: (token as NSString).length)) != nil, Int(token) != nil { continue }
            if lower.hasPrefix("box") || lower.hasPrefix("bx") { continue }
            if let box, lower == box.lowercased() { continue }
            // Needs both a letter and a digit (R3500, K5), so plain words and numbers don't qualify.
            guard token.contains(where: \.isLetter), token.contains(where: \.isNumber) else { continue }
            return token.uppercased()
        }
        let lower = text.lowercased()
        for make in makes where lower.range(of: "\\b\(make)\\b", options: .regularExpression) != nil {
            return make
        }
        return nil
    }

    private static func firstCapture(_ re: NSRegularExpression, in text: String) -> String? {
        let ns = text as NSString
        guard let m = re.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)), m.numberOfRanges > 1 else { return nil }
        return ns.substring(with: m.range(at: 1))
    }
}

// MARK: - Batch

/// The batch a label card opens: soft evidence that cites the label page.
struct PaperworkBatch: Codable, Equatable {
    var labelPageId: String
    var labelDocumentId: String
    var box: String?
    var vehicleHint: String?
    var yearHint: Int?
    var confidence: Double
    var labelText: String
    var openedAt: Date
}

/// Applies batches in capture order: a label card opens one, every following document carries it
/// until the next card. State is Codable so the open batch survives an app restart.
struct BatchTracker: Codable, Equatable {
    private(set) var current: PaperworkBatch?
    private(set) var documentsInBatch = 0

    enum Outcome: Equatable {
        case openedBatch(PaperworkBatch)
        case document(PaperworkBatch?)
    }

    /// Feed each scanned document's first page (in order). Returns what that document is.
    mutating func observe(documentId: String, firstPageId: String, label: LabelCard?, at date: Date) -> Outcome {
        if let label {
            let batch = PaperworkBatch(labelPageId: firstPageId, labelDocumentId: documentId, box: label.box,
                                       vehicleHint: label.vehicleHint, yearHint: label.yearHint,
                                       confidence: label.confidence, labelText: label.text, openedAt: date)
            current = batch
            documentsInBatch = 0
            return .openedBatch(batch)
        }
        if current != nil { documentsInBatch += 1 }
        return .document(current)
    }

    mutating func close() { current = nil; documentsInBatch = 0 }
}

// MARK: - Document date hint

struct DocumentDateHint: Codable, Equatable {
    /// yyyy-MM-dd
    var date: String
    var matchedText: String
    var confidence: Double
}

enum DocumentDateExtractor {
    static let minYear = 1950
    static let maxYear = 2035
    private static let months: [String: Int] = ["jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7,
        "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12]
    private static let numeric = try! NSRegularExpression(pattern: #"(?<![0-9])([01]?[0-9])[/\-.]([0-3]?[0-9])[/\-.]([0-9]{4}|[0-9]{2})(?![0-9])"#)
    private static let iso = try! NSRegularExpression(pattern: #"(?<![0-9])((?:19|20)[0-9]{2})-([01][0-9])-([0-3][0-9])(?![0-9])"#)
    private static let written = try! NSRegularExpression(pattern: #"\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+([0-3]?[0-9])(?:st|nd|rd|th)?,?\s+((?:19|20)[0-9]{2})\b"#, options: [.caseInsensitive])
    private static let dateLabel = try! NSRegularExpression(pattern: #"\b(date|dated|invoice date|issued|issue date|date of sale|sold)\b"#, options: [.caseInsensitive])

    /// The most likely document date in the text, or nil. Dates next to a "Date" label win; otherwise the first one.
    static func extract(from text: String) -> DocumentDateHint? {
        let ns = text as NSString
        let full = NSRange(location: 0, length: ns.length)
        var found: [(range: NSRange, hint: DocumentDateHint)] = []

        for m in iso.matches(in: text, range: full) {
            if let h = make(y: int(ns, m, 1), mo: int(ns, m, 2), d: int(ns, m, 3), matched: ns.substring(with: m.range), base: 0.7) {
                found.append((m.range, h))
            }
        }
        for m in written.matches(in: text, range: full) {
            let mon = months[ns.substring(with: m.range(at: 1)).lowercased()]
            if let h = make(y: int(ns, m, 3), mo: mon, d: int(ns, m, 2), matched: ns.substring(with: m.range), base: 0.7) {
                found.append((m.range, h))
            }
        }
        for m in numeric.matches(in: text, range: full) where !found.contains(where: { NSIntersectionRange($0.range, m.range).length > 0 }) {
            guard var y = int(ns, m, 3) else { continue }
            let twoDigit = m.range(at: 3).length == 2
            if twoDigit { y += y <= 35 ? 2000 : 1900 }
            if let h = make(y: y, mo: int(ns, m, 1), d: int(ns, m, 2), matched: ns.substring(with: m.range), base: twoDigit ? 0.5 : 0.6) {
                found.append((m.range, h))
            }
        }
        guard !found.isEmpty else { return nil }
        found.sort { $0.range.location < $1.range.location }
        let labels = dateLabel.matches(in: text, range: full).map(\.range)
        if let labelled = found.first(where: { f in labels.contains { l in l.location <= f.range.location && f.range.location - (l.location + l.length) <= 24 } }) {
            var h = labelled.hint
            h.confidence = min(0.9, h.confidence + 0.2)
            return h
        }
        return found[0].hint
    }

    private static func int(_ ns: NSString, _ m: NSTextCheckingResult, _ i: Int) -> Int? {
        Int(ns.substring(with: m.range(at: i)))
    }

    private static func make(y: Int?, mo: Int?, d: Int?, matched: String, base: Double) -> DocumentDateHint? {
        guard let y, let mo, let d, (minYear...maxYear).contains(y), (1...12).contains(mo) else { return nil }
        var comps = DateComponents(); comps.year = y; comps.month = mo; comps.day = d
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "UTC")!
        guard let date = cal.date(from: comps), cal.component(.day, from: date) == d else { return nil }
        return DocumentDateHint(date: String(format: "%04d-%02d-%02d", y, mo, d), matchedText: matched, confidence: base)
    }
}

// MARK: - Upload payload (the paperwork-intake edge function's body)

struct PaperworkBatchEvidence: Codable, Equatable {
    var source = "label_card"
    var label_page_id: String
    var label_document_id: String
    var box: String?
    var vehicle_hint: String?
    var year_hint: Int?
    var confidence: Double
    var label_text: String
    /// Always "soft": the batch is cited evidence, never a hard assignment.
    var strength = "soft"
}

struct PaperworkPagePayload: Codable, Equatable {
    var client_page_id: String
    var document_id: String
    var page_index: Int
    var page_count: Int
    /// Capture time (scan time only), ISO-8601 UTC. Never the document's date.
    var scanned_at: String
    var is_document = true
    var is_label_card: Bool
    var ocr_text: String
    var ocr_engine = "apple_vision_accurate"
    var document_date_hint: String?
    var document_date_hint_text: String?
    var document_date_hint_confidence: Double?
    var batch: PaperworkBatchEvidence?
    var content_type = "image/jpeg"
    var image_base64: String

    static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()

    static func make(page: PaperworkPage, imageData: Data) -> PaperworkPagePayload {
        PaperworkPagePayload(
            client_page_id: page.id, document_id: page.documentId, page_index: page.pageIndex, page_count: page.pageCount,
            scanned_at: isoFormatter.string(from: page.scannedAt), is_label_card: page.isLabelCard,
            ocr_text: page.ocrText ?? "", document_date_hint: page.dateHint?.date,
            document_date_hint_text: page.dateHint?.matchedText, document_date_hint_confidence: page.dateHint?.confidence,
            batch: page.isLabelCard ? nil : page.batch.map {
                PaperworkBatchEvidence(label_page_id: $0.labelPageId, label_document_id: $0.labelDocumentId, box: $0.box,
                                       vehicle_hint: $0.vehicleHint, year_hint: $0.yearHint, confidence: $0.confidence,
                                       label_text: $0.labelText)
            },
            image_base64: imageData.base64EncodedString())
    }
}

/// One queued page, persisted as JSON beside its JPEG so the queue survives restarts.
struct PaperworkPage: Codable, Equatable, Identifiable {
    var id: String
    var documentId: String
    var pageIndex: Int
    var pageCount: Int
    var scannedAt: Date
    /// Capture order across sessions, so batches apply in the order paper went through the camera.
    var sequence: Int
    var explicitLabel: Bool
    var ocrDone = false
    var ocrText: String?
    var isLabelCard = false
    var dateHint: DocumentDateHint?
    var batch: PaperworkBatch?
    var attempts = 0
    var lastError: String?
}

enum PaperworkRules {
    /// Runs label detection, date extraction and batch application for one document's pages
    /// (all OCR'd, in page order). The first page decides whether the document is a label card.
    static func classify(document pages: [PaperworkPage], tracker: inout BatchTracker, now: Date = Date()) -> [PaperworkPage] {
        guard let first = pages.first else { return pages }
        let label = LabelCardParser.parse(first.ocrText ?? "", explicit: first.explicitLabel)
        // A label card is a single short page; a multi-page scan only counts when explicitly toggled.
        let isLabel = label != nil && (pages.count == 1 || first.explicitLabel)
        let outcome = tracker.observe(documentId: first.documentId, firstPageId: first.id, label: isLabel ? label : nil, at: now)
        let docDate = pages.lazy.compactMap { DocumentDateExtractor.extract(from: $0.ocrText ?? "") }.first
        return pages.map { p in
            var p = p
            switch outcome {
            case .openedBatch(let b): p.isLabelCard = true; p.batch = b; p.dateHint = nil
            case .document(let b): p.isLabelCard = false; p.batch = b; p.dateHint = DocumentDateExtractor.extract(from: p.ocrText ?? "") ?? docDate
            }
            return p
        }
    }
}
