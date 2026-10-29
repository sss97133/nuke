// CaptureContext.swift — the year/make/model namespace for a classic serial, read from the
// capture session itself instead of from an album name (albums are test labels, owner 10-20).
//
// A pre-1981 serial (8–16 characters) is not unique across makes, so the server's
// `device_create_vehicle_profile(basis = 'capture_session')` needs a make beside it. The phone
// already OCRs every frame on-device (`VisionEngine.recognizeText`); this file turns those lines
// into context reads, in order of strength:
//   1. a title / registration document in the same run (YEAR, MAKE, and its VIN when printed);
//   2. a Fisher cowl/trim tag (`ST73 2FS87` → 1973, division 2 = Pontiac, FS = Firebird);
//   3. a make badge / wordmark on a vehicle-classified frame (`PONTIAC` on the nose).
// A document or tag cannot file a photo by itself; it only names the namespace for a plate read.
// No cloud reads. Every read keeps its image id, method and confidence for the writer's evidence.

import Foundation

enum CaptureContextMethod: String, Codable, Sendable, Comparable {
    case document = "title_document_ocr"
    case cowlTag = "cowl_tag_ocr"
    case badge = "make_badge_ocr"
    case album = "album_label"

    /// Lower is stronger.
    var rank: Int {
        switch self { case .document: 0; case .cowlTag: 1; case .badge: 2; case .album: 3 }
    }
    var confidence: Double {
        switch self { case .document: 0.95; case .cowlTag: 0.9; case .badge: 0.75; case .album: 0.6 }
    }
    static func < (a: Self, b: Self) -> Bool { a.rank < b.rank }
}

/// One frame's context read.
struct CaptureContextRead: Equatable, Sendable {
    let imageID: String
    let method: CaptureContextMethod
    let year: Int?
    let make: String
    let model: String?
    /// Raw decoded code (e.g. the Fisher body code `2FS87`), kept for evidence.
    var code: String? = nil
    /// The VIN/serial a document printed, when it printed one; a document naming a different
    /// serial than the plate is not context for that plate.
    var documentSerial: String? = nil
    let takenAt: String?
    let latitude: Double?
    let longitude: Double?
    var confidence: Double { method.confidence }
}

/// The resolved namespace for one identifier anchor.
struct CaptureContext: Equatable, Sendable {
    let year: Int?
    let make: String
    let model: String?
    let method: CaptureContextMethod
    let confidence: Double
    let imageIDs: [String]
    let code: String?

    /// Flat evidence keys for the writer's `evidence` jsonb (string values, as the request carries).
    var evidence: [String: String] {
        var e: [String: String] = [
            "identity_context_method": method.rawValue,
            "identity_context_confidence": String(format: "%.2f", confidence),
            "identity_context_image_ids": imageIDs.joined(separator: ","),
            "identity_context_make": make,
        ]
        if let year { e["identity_context_year"] = String(year) }
        if let model { e["identity_context_model"] = model }
        if let code { e["identity_context_code"] = code }
        return e
    }
}

enum CaptureContextReader {
    // ─── Fisher cowl / trim tag ────────────────────────────────────────────────
    struct CowlTag: Equatable, Sendable {
        let modelYear: Int
        let division: Int
        let make: String
        let bodyLetter: Character
        let seriesCode: String   // e.g. "FS"
        let bodyStyle: String    // e.g. "87"
        let model: String?       // decoded series when the table knows it
        var code: String { "\(division)\(seriesCode)\(bodyStyle)" }
    }

    /// GM division digit on the Fisher tag (1971-on alphanumeric style code).
    /// GMC trucks do not carry this ST-code format; they are left undecoded rather than guessed.
    static let gmDivisions: [Int: String] = [1: "Chevrolet", 2: "Pontiac", 3: "Oldsmobile", 4: "Buick", 6: "Cadillac"]

    /// Series codes the table is sure of (division + two letters). Others decode make and year only.
    static let gmSeries: [String: String] = [
        // Pontiac F-body, 1970-81
        "2FS": "Firebird", "2FT": "Firebird Esprit", "2FU": "Firebird Formula", "2FV": "Firebird Trans Am",
        // Chevrolet F-body
        "1FQ": "Camaro", "1FS": "Camaro LT",
    ]

    static let bodyNames: [Character: String] = ["A": "A-body", "F": "F-body", "X": "X-body"]

    /// Reads `ST73 2FS87` (spacing/dash tolerant) on a frame that also carries a Fisher tag marker:
    /// `BODY BY FISHER`, or the tag's own `BDY` plus `TR`/`PNT` fields.
    static func decodeCowlTag(_ lines: [String]) -> CowlTag? {
        let text = lines.joined(separator: " ").uppercased()
        let isTag = text.contains("FISHER") ||
            (text.range(of: #"\bBDY\b"#, options: .regularExpression) != nil &&
             text.range(of: #"\b(TR|PNT)\b"#, options: .regularExpression) != nil)
        guard isTag else { return nil }
        let pattern = #"\bST\s*[-.]?\s*(\d{2})\s*[-.]?\s*([1-6])\s*([A-Z])([A-Z])\s*(\d{2})\b"#
        guard let re = try? NSRegularExpression(pattern: pattern),
              let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        func g(_ i: Int) -> String { Range(m.range(at: i), in: text).map { String(text[$0]) } ?? "" }
        guard let yy = Int(g(1)), (70...89).contains(yy), let div = Int(g(2)), let make = gmDivisions[div],
              let body = g(3).first else { return nil }
        let series = g(3) + g(4)
        return CowlTag(modelYear: 1900 + yy, division: div, make: make, bodyLetter: body,
                       seriesCode: series, bodyStyle: g(5), model: gmSeries["\(div)\(series)"])
    }

    // ─── Make wordmarks ────────────────────────────────────────────────────────
    /// Brand names from the bundled `make-wordmarks.json` (the same registry the badges render from).
    static let bundledMakes: [String] = {
        struct Entry: Decodable { let brand: String }
        struct Catalogue: Decodable { let makes: [Entry] }
        guard let url = Bundle.main.url(forResource: "make-wordmarks", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let c = try? JSONDecoder().decode(Catalogue.self, from: data) else { return [] }
        return c.makes.map(\.brand)
    }()

    private static func norm(_ s: String) -> String {
        s.uppercased().filter { $0.isLetter || $0.isNumber }
    }

    /// A badge read is a whole OCR line that is exactly one make's wordmark (`PONTIAC`), so a
    /// make inside a sentence, a parts box or a sticker does not count.
    static func badgeMake(_ lines: [String], makes: [String]) -> String? {
        let byKey = Dictionary(makes.map { (norm($0), $0) }, uniquingKeysWith: { a, _ in a })
        let hits = Set(lines.compactMap { line -> String? in
            let k = norm(line)
            return k.count >= 3 ? byKey[k] : nil
        })
        return hits.count == 1 ? hits.first : nil
    }

    // ─── Title / registration document ─────────────────────────────────────────
    /// DMV make abbreviations seen on titles, beside full names from the wordmark registry.
    static let titleMakeAbbreviations: [String: String] = [
        "PONT": "Pontiac", "CHEV": "Chevrolet", "CHEVY": "Chevrolet", "OLDS": "Oldsmobile", "BUIC": "Buick",
        "CADI": "Cadillac", "FORD": "Ford", "DODG": "Dodge", "PLYM": "Plymouth", "MERC": "Mercury",
    ]

    struct DocumentRead: Equatable, Sendable { let year: Int?; let make: String; let serial: String? }

    /// A title/registration carries YEAR and MAKE fields; the read needs a make and either a year
    /// or a serial, so a random document mentioning a brand is not a namespace.
    static func decodeDocument(_ lines: [String], makes: [String]) -> DocumentRead? {
        let text = lines.joined(separator: "\n").uppercased()
        guard text.range(of: #"\b(TITLE|REGISTRATION|CERTIFICATE)\b"#, options: .regularExpression) != nil else { return nil }
        var byKey = Dictionary(makes.map { (norm($0), $0) }, uniquingKeysWith: { a, _ in a })
        for (k, v) in titleMakeAbbreviations { byKey[k] = byKey[k] ?? v }
        let tokens = text.split(whereSeparator: { !($0.isLetter || $0.isNumber) }).map(String.init)
        let found = Set(tokens.compactMap { byKey[$0] })
        guard found.count == 1, let make = found.first else { return nil }
        var year: Int?
        if let re = try? NSRegularExpression(pattern: #"\b(?:YEAR|YR|MODEL YEAR)\b\D{0,12}((?:19|20)\d{2})\b"#),
           let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
           let r = Range(m.range(at: 1), in: text) { year = Int(text[r]) }
        let serial = VisionEngine.vinCandidates(in: lines).first(where: VisionEngine.isValidVIN)
            ?? VisionEngine.labelledClassicSerialCandidates(in: lines).first
        guard year != nil || serial != nil else { return nil }
        return DocumentRead(year: year, make: make, serial: serial)
    }

    /// Every context read one frame supplies (at most one per method).
    static func reads(imageID: String, lines: [String], isVehicle: Bool, isDocument: Bool,
                      takenAt: String?, latitude: Double?, longitude: Double?,
                      makes: [String] = bundledMakes) -> [CaptureContextRead] {
        var out: [CaptureContextRead] = []
        if isDocument, let d = decodeDocument(lines, makes: makes) {
            out.append(.init(imageID: imageID, method: .document, year: d.year, make: d.make, model: nil,
                             documentSerial: d.serial, takenAt: takenAt, latitude: latitude, longitude: longitude))
        }
        if !isDocument, let t = decodeCowlTag(lines) {
            out.append(.init(imageID: imageID, method: .cowlTag, year: t.modelYear, make: t.make, model: t.model,
                             code: t.code, takenAt: takenAt, latitude: latitude, longitude: longitude))
        }
        if isVehicle, !isDocument, let make = badgeMake(lines, makes: makes) {
            out.append(.init(imageID: imageID, method: .badge, year: nil, make: make, model: nil,
                             takenAt: takenAt, latitude: latitude, longitude: longitude))
        }
        return out
    }

    // ─── Ranking ───────────────────────────────────────────────────────────────
    /// The same run as the anchor: within the VIN set window and ~100 m (the session cell).
    static func sameRun(_ read: CaptureContextRead, anchorTakenAt: String?, anchorLat: Double?, anchorLon: Double?,
                        window: TimeInterval = AttributionEngine.setWindowSeconds) -> Bool {
        guard let ta = EventTime.clock(takenAt: read.takenAt), let tb = EventTime.clock(takenAt: anchorTakenAt),
              abs(ta.timeIntervalSince(tb)) <= window,
              let lat1 = read.latitude, let lon1 = read.longitude, let lat2 = anchorLat, let lon2 = anchorLon
        else { return false }
        let rad = Double.pi / 180
        let dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1 * rad) * cos(lat2 * rad) * sin(dLon / 2) * sin(dLon / 2)
        return 6_371_000 * 2 * asin(sqrt(min(1, h))) <= 100
    }

    /// The strongest method present wins. Reads at that strength must agree on make (and year when
    /// both carry one), or the namespace is ambiguous and nil is returned — a weaker method never
    /// breaks a tie the stronger one could not. A document naming a different serial is skipped.
    /// Year and model fill from agreeing weaker reads of the same make.
    static func resolve(_ reads: [CaptureContextRead], serial: String?) -> CaptureContext? {
        let usable = reads.filter { r in
            guard let s = r.documentSerial, let serial else { return true }
            return s.uppercased() == serial.uppercased()
        }
        guard let top = usable.map(\.method).min() else { return nil }
        let best = usable.filter { $0.method == top }
        let makes = Set(best.map { $0.make.lowercased() })
        let years = Set(best.compactMap(\.year))
        guard makes.count == 1, years.count <= 1, let lead = best.first else { return nil }
        let sameMake = usable.filter { $0.make.lowercased() == lead.make.lowercased() }
        let year = years.first ?? {
            let ys = Set(sameMake.compactMap(\.year)); return ys.count == 1 ? ys.first : nil
        }()
        let models = Set(best.compactMap(\.model))
        let model = models.count == 1 ? models.first : {
            let ms = Set(sameMake.compactMap(\.model)); return ms.count == 1 ? ms.first : nil
        }()
        return CaptureContext(year: year, make: lead.make, model: model, method: top, confidence: top.confidence,
                              imageIDs: best.map(\.imageID).sorted(), code: best.compactMap(\.code).first)
    }

    // ─── Needs-the-VIN-plate state ────────────────────────────────────────────
    /// A session that read a cowl tag but no identifier: no profile; the Today screen asks for the plate.
    struct PendingIdentifier: Equatable, Sendable {
        let context: CaptureContext
        /// Vehicle frames of the session waiting for the identifier.
        let imageIDs: [String]
        var framesWaiting: Int { imageIDs.count }
        var line: String {
            let name = [context.year.map(String.init), context.make, context.model].compactMap { $0 }.joined(separator: " ")
            return "\(name): needs the VIN plate · \(framesWaiting) photo\(framesWaiting == 1 ? "" : "s") waiting"
        }
    }

    /// Tag reads whose run has no identifier anchor become pending sessions.
    /// `sessionFrames` maps a session key to its vehicle frame ids; `anchored` holds the session keys
    /// that produced an identifier group (or carry any exact identifier read).
    static func pendingIdentifiers(tagReadsBySession: [String: [CaptureContextRead]],
                                   sessionFrames: [String: Set<String>],
                                   anchored: Set<String>) -> [PendingIdentifier] {
        tagReadsBySession.keys.sorted().compactMap { key in
            guard !anchored.contains(key), let reads = tagReadsBySession[key],
                  let ctx = resolve(reads.filter { $0.method == .cowlTag }, serial: nil) else { return nil }
            return PendingIdentifier(context: ctx, imageIDs: (sessionFrames[key] ?? []).sorted())
        }
    }
}

/// The seam for the server candidate-profile path (another lane: a private profile with
/// status `needs_identifier`). Until that lane lands, the phone only shows the pending line.
protocol CandidateProfileRequesting: Sendable {
    func requestCandidateProfile(_ pending: CaptureContextReader.PendingIdentifier) async
}
