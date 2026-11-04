// ScreenCaptureEvidence.swift — the evidence rule for screen recordings and screenshots. Pure: no Vision, no network.
//
// Screen captures are DOCUMENTS, not photos. The photo gate (VisionDecision) holds a document's pixels and refuses to
// read an identifier off one, so screen captures get their own rule (screen_text_v1), still decided on the phone:
//
//   NARROW   Acquisition context only. A vehicle is a candidate when the capture was made inside its acquisition
//            window: 21 days before to 2 days after (3 for a date-only purchase_date) its acquisition anchor.
//              anchor = purchase_date, else the vehicle's first filed photo (taken_at). created_at is NEVER used:
//              for imported or merged profiles it is the import date, years after the purchase. No anchor = not a
//              candidate (the capture is not read for it).
//   READ     Vision OCR on the phone, 12 frames of a recording's first 60 s (the preview window) or the one screenshot.
//   ATTRIBUTE only when the text gives strong evidence of exactly ONE of the owner's vehicles AND a price or seller line:
//              vehicle evidence = a checksum-valid VIN equal to the vehicle's VIN, or year + make + model
//                                 (year and model on one line, the make anywhere in that frame);
//              commercial evidence = a price line ($500 to $5,000,000) or a seller line.
//            Two vehicles evidenced, a conflicting VIN, a face, or private text (card, SSN, password…) = refused.
//   SEND     Only cited fields (name, value, frame index, timestamp), never the OCR text. A private preview goes up
//            after the server attaches it; the full file never does.
//
// Time and context narrow; only the capture's own text can attribute.

import Foundation

enum ScreenCaptureKind: String, Codable, Sendable {
    case screenRecording = "screen_recording"
    case screenshot = "screenshot"
}

/// One frame's recognised text. It lives in memory for the length of one evaluation.
struct ScreenFrameText: Equatable, Sendable {
    let index: Int              // 1-based within the item (a screenshot is frame 1)
    let seconds: Double         // 0 for a screenshot
    let lines: [String]
    let hasProminentFace: Bool
}

struct ScreenRosterVehicle: Equatable, Sendable {
    let id: String
    let year: Int?
    let make: String?
    let model: String?
    let vin: String?
    let purchaseDate: Date?
    var firstFiledPhoto: Date?
}

enum AcquisitionAnchorSource: String, Codable, Sendable {
    case purchaseDate = "purchase_date"
    case firstFiledPhoto = "first_filed_photo"
}

struct AcquisitionAnchor: Equatable, Sendable {
    let date: Date
    let source: AcquisitionAnchorSource

    static let daysBefore: Double = 21
    static let daysAfterInstant: Double = 2        // anchor is an instant (first filed photo)
    static let daysAfterDate: Double = 3           // anchor is a date (purchase_date): its whole day plus 2

    var start: Date { date.addingTimeInterval(-Self.daysBefore * 86_400) }
    var end: Date { date.addingTimeInterval((source == .purchaseDate ? Self.daysAfterDate : Self.daysAfterInstant) * 86_400) }
    func contains(_ t: Date) -> Bool { t >= start && t < end }

    /// purchase_date first, then the first filed photo. created_at is deliberately not an option.
    static func of(_ v: ScreenRosterVehicle) -> AcquisitionAnchor? {
        if let d = v.purchaseDate { return AcquisitionAnchor(date: d, source: .purchaseDate) }
        if let p = v.firstFiledPhoto { return AcquisitionAnchor(date: p, source: .firstFiledPhoto) }
        return nil
    }
}

enum ScreenRefusal: String, Codable, Sendable {
    case noCandidates, privacy, personalText, noVehicleEvidence, outsideContext
    case conflictingVehicles, conflictingVIN, noPriceOrSellerLine
}

struct CitedField: Codable, Equatable, Sendable {
    let name: String            // vehicle | vin | price | price_seen | seller | date
    let value: String
    let frame: Int
    let seconds: Double
}

struct ScreenAttribution: Equatable, Sendable {
    let vehicleID: String
    let method: String          // screen_vin | screen_ymm
    let confidence: Double
    let fields: [CitedField]
    let anchorSource: AcquisitionAnchorSource
    let framesWithVehicleEvidence: Int
}

enum ScreenVerdict: Equatable, Sendable {
    case attribute(ScreenAttribution)
    case refused(ScreenRefusal)
    case unreadable
}

enum ScreenCaptureEvidence {
    static let rule = "screen_text_v1"
    static let confidenceFloor = 0.9             // the photo filing floor (device_file_images)
    static let vinConfidence = 0.97
    static let yearMakeModelConfidence = 0.92
    static let minPrice = 500
    static let maxPrice = 5_000_000
    static let maxFields = 12

    // ─── Narrow ───────────────────────────────────────────────────────────────

    static func candidates(roster: [ScreenRosterVehicle], capturedAt: Date) -> [ScreenRosterVehicle] {
        roster.filter { AcquisitionAnchor.of($0)?.contains(capturedAt) == true }
    }

    // ─── Decide ───────────────────────────────────────────────────────────────

    static func evaluate(capturedAt: Date, frames: [ScreenFrameText], framesRequested: Int,
                         roster: [ScreenRosterVehicle]) -> ScreenVerdict {
        guard framesRequested > 0, frames.count == framesRequested else { return .unreadable }
        let candidates = Self.candidates(roster: roster, capturedAt: capturedAt)
        guard !candidates.isEmpty else { return .refused(.noCandidates) }

        if frames.contains(where: { $0.hasProminentFace }) { return .refused(.privacy) }
        if frames.contains(where: { containsPrivateText($0.lines) }) { return .refused(.personalText) }

        // Evidence is looked for against the WHOLE roster, so a capture that names a vehicle outside the context
        // window is refused rather than quietly attributed to a different one.
        var evidence: [String: VehicleEvidence] = [:]
        for v in roster {
            let e = evidenceFor(v, in: frames)
            if e.isStrong { evidence[v.id] = e }
        }
        guard !evidence.isEmpty else { return .refused(.noVehicleEvidence) }
        guard evidence.count == 1, let (vehicleID, found) = evidence.first else { return .refused(.conflictingVehicles) }
        guard let vehicle = roster.first(where: { $0.id == vehicleID }),
              let anchor = AcquisitionAnchor.of(vehicle), anchor.contains(capturedAt) else { return .refused(.outsideContext) }
        let seenVINs = allCheckedVINs(in: frames)
        if let vin = normalizedVIN(vehicle.vin), seenVINs.contains(where: { $0 != vin }) {
            return .refused(.conflictingVIN)       // the text shows a different VIN than this vehicle's
        }

        let price = prices(in: frames, preferringFrame: found.firstFrame)
        let seller = sellerLine(in: frames)
        guard !price.isEmpty || seller != nil else { return .refused(.noPriceOrSellerLine) }

        let method = found.vinFrame != nil ? "screen_vin" : "screen_ymm"
        let confidence = found.vinFrame != nil ? vinConfidence : yearMakeModelConfidence
        guard confidence >= confidenceFloor else { return .unreadable }

        var fields: [CitedField] = []
        if let f = found.ymmFrame, let y = vehicle.year, let mk = vehicle.make, let md = vehicle.model {
            fields.append(CitedField(name: "vehicle", value: "\(y) \(mk) \(md)", frame: f.index, seconds: f.seconds))
        }
        if let f = found.vinFrame, let vin = normalizedVIN(vehicle.vin) {
            fields.append(CitedField(name: "vin", value: vin, frame: f.index, seconds: f.seconds))
        }
        for (i, p) in price.prefix(3).enumerated() {
            fields.append(CitedField(name: i == 0 ? "price" : "price_seen", value: p.value, frame: p.frame.index, seconds: p.frame.seconds))
        }
        if let s = seller {
            // A named seller is cited by name; a bare seller line ("Message seller") is cited as present, no name.
            fields.append(CitedField(name: s.name.isEmpty ? "seller_line" : "seller", value: s.name.isEmpty ? "seen" : s.name,
                                     frame: s.frame.index, seconds: s.frame.seconds))
        }
        if let d = onScreenDate(in: frames) { fields.append(CitedField(name: "date", value: d.value, frame: d.frame.index, seconds: d.frame.seconds)) }
        return .attribute(ScreenAttribution(vehicleID: vehicleID, method: method, confidence: confidence,
                                            fields: Array(fields.prefix(maxFields)), anchorSource: anchor.source,
                                            framesWithVehicleEvidence: found.frameCount))
    }

    // ─── Vehicle evidence ─────────────────────────────────────────────────────

    struct VehicleEvidence {
        var vinFrame: ScreenFrameText?
        var ymmFrame: ScreenFrameText?
        var frameCount = 0
        var isStrong: Bool { vinFrame != nil || ymmFrame != nil }
        var firstFrame: Int? { [vinFrame?.index, ymmFrame?.index].compactMap { $0 }.min() }
    }

    static func evidenceFor(_ v: ScreenRosterVehicle, in frames: [ScreenFrameText]) -> VehicleEvidence {
        var e = VehicleEvidence()
        let vin = normalizedVIN(v.vin)
        for f in frames {
            var hit = false
            if let vin, checkedVINs(in: f.lines).contains(vin) {
                if e.vinFrame == nil { e.vinFrame = f }
                hit = true
            }
            if yearMakeModelHit(v, in: f) {
                if e.ymmFrame == nil { e.ymmFrame = f }
                hit = true
            }
            if hit { e.frameCount += 1 }
        }
        return e
    }

    /// year + model on one line, the make anywhere in the same frame.
    static func yearMakeModelHit(_ v: ScreenRosterVehicle, in frame: ScreenFrameText) -> Bool {
        guard let year = v.year, let make = v.make, let model = v.model else { return false }
        let modelPhrase = normalize(model).trimmingCharacters(in: .whitespaces)
        let makes = makeForms(make)
        guard !modelPhrase.isEmpty, !makes.isEmpty else { return false }
        let yy = String(format: "%02d", year % 100)
        let lines = frame.lines.map(normalize)
        let yearModel = lines.contains { l in
            (l.contains(" \(year) ") || l.contains(" '\(yy) ")) && l.contains(" \(modelPhrase) ")
        }
        guard yearModel else { return false }
        return lines.contains { l in makes.contains { l.contains(" \($0) ") } }
    }

    /// The make as printed plus the few short forms people write.
    static func makeForms(_ make: String) -> [String] {
        let base = normalize(make).trimmingCharacters(in: .whitespaces)
        guard !base.isEmpty else { return [] }
        let aliases: [String: [String]] = [
            "chevrolet": ["chevy"], "volkswagen": ["vw"], "mercedes benz": ["mercedes", "benz"],
            "mercedes": ["benz"], "pontiac": [], "oldsmobile": ["olds"], "plymouth": [],
        ]
        return [base] + (aliases[base] ?? [])
    }

    /// Lowercased, punctuation to spaces (the apostrophe of '64 kept), padded so " word " tests whole words.
    static func normalize(_ s: String) -> String {
        var out = " "
        var lastSpace = true
        for ch in s.lowercased().unicodeScalars {
            let isWord = (ch.value >= 97 && ch.value <= 122) || (ch.value >= 48 && ch.value <= 57)
            if isWord { out.unicodeScalars.append(ch); lastSpace = false }
            else if ch == "'" || ch == "\u{2019}" { if lastSpace { out.append("'"); lastSpace = false } }
            else if !lastSpace { out.append(" "); lastSpace = true }
        }
        if !lastSpace { out.append(" ") }
        return out
    }

    static func normalizedVIN(_ vin: String?) -> String? {
        let v = (vin ?? "").uppercased().filter { $0.isLetter || $0.isNumber }
        return v.count == 17 ? v : nil
    }

    static func checkedVINs(in lines: [String]) -> [String] { VisionEngine.checkedVINs(in: lines) }

    private static func allCheckedVINs(in frames: [ScreenFrameText]) -> [String] {
        Array(Set(frames.flatMap { checkedVINs(in: $0.lines) }))
    }

    // ─── Commercial evidence ──────────────────────────────────────────────────

    struct FoundValue { let value: String; let frame: ScreenFrameText }

    private static let priceRegex = try? NSRegularExpression(pattern: #"\$\s?(\d{1,3}(?:,\d{3})+|\d{3,7})(?:\.\d{2})?"#)

    /// Price lines in frame order; the one on the vehicle's own frame (the listing header) first.
    static func prices(in frames: [ScreenFrameText], preferringFrame: Int?) -> [FoundValue] {
        var out: [FoundValue] = []
        for f in frames {
            for line in f.lines {
                let ns = line as NSString
                priceRegex?.enumerateMatches(in: line, range: NSRange(location: 0, length: ns.length)) { m, _, _ in
                    guard let m, m.numberOfRanges > 1 else { return }
                    let digits = ns.substring(with: m.range(at: 1)).replacingOccurrences(of: ",", with: "")
                    guard let n = Int(digits), n >= minPrice, n <= maxPrice else { return }
                    let shown = "$" + formatted(n)
                    if !out.contains(where: { $0.value == shown }) { out.append(FoundValue(value: shown, frame: f)) }
                }
            }
        }
        if let pf = preferringFrame, let i = out.firstIndex(where: { $0.frame.index == pf }), i > 0 {
            let first = out.remove(at: i)
            out.insert(first, at: 0)
        }
        return out
    }

    private static func formatted(_ n: Int) -> String {
        var s = String(n), out = ""
        while s.count > 3 { out = "," + String(s.suffix(3)) + out; s = String(s.dropLast(3)) }
        return s + out
    }

    struct SellerHit { let name: String; let frame: ScreenFrameText }

    private static let uiWords: Set<String> = [
        "message", "messenger", "joined", "facebook", "marketplace", "send", "listed", "see", "details", "seller",
        "rating", "ratings", "information", "info", "view", "profile", "shop", "save", "share", "report", "buy",
        "available", "sold", "pending", "offer", "price", "location", "miles", "driven", "more", "about", "reviews",
    ]

    /// A seller line: "Seller: Name", "Listed by Name", "Sold by Name", or a "Seller information" / "Seller details"
    /// heading (the name is the next line when it reads like a name), or a "Message seller" control.
    static func sellerLine(in frames: [ScreenFrameText]) -> SellerHit? {
        var bare: SellerHit?
        for f in frames {
            for (i, raw) in f.lines.enumerated() {
                let line = raw.trimmingCharacters(in: .whitespaces)
                let lower = line.lowercased()
                for prefix in ["seller:", "seller -", "sold by:", "sold by ", "listed by:", "listed by "] where lower.hasPrefix(prefix) {
                    let rest = String(line.dropFirst(prefix.count)).trimmingCharacters(in: CharacterSet(charactersIn: " :-"))
                    if let name = personName(rest) { return SellerHit(name: name, frame: f) }
                    if bare == nil { bare = SellerHit(name: "", frame: f) }
                }
                if lower == "seller information" || lower == "seller details" || lower == "meet the seller" || lower == "seller" {
                    let next = i + 1 < f.lines.count ? f.lines[i + 1] : ""
                    if let name = personName(next) { return SellerHit(name: name, frame: f) }
                    if bare == nil { bare = SellerHit(name: "", frame: f) }
                }
                if lower.contains("message seller") || lower.contains("message the seller") || lower.contains("send seller a message") {
                    if bare == nil { bare = SellerHit(name: "", frame: f) }
                }
            }
        }
        return bare
    }

    /// 2 to 4 capitalised words, letters and . ' - only, no UI vocabulary, at most 40 characters.
    static func personName(_ raw: String) -> String? {
        let s = raw.trimmingCharacters(in: .whitespaces)
        guard s.count >= 3, s.count <= 40 else { return nil }
        let words = s.split(separator: " ").map(String.init)
        guard (2...4).contains(words.count) else { return nil }
        for w in words {
            guard let f = w.unicodeScalars.first, CharacterSet.uppercaseLetters.contains(f) else { return nil }
            guard w.unicodeScalars.allSatisfy({ CharacterSet.letters.contains($0) || ".'-\u{2019}".unicodeScalars.contains($0) }) else { return nil }
            if uiWords.contains(w.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ".'-"))) { return nil }
        }
        return s
    }

    // ─── Dates read off the screen ────────────────────────────────────────────

    private static let months = ["jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8,
                                 "sep": 9, "oct": 10, "nov": 11, "dec": 12]
    private static let nameDate = try? NSRegularExpression(pattern: #"(?i)\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b"#)
    private static let slashDate = try? NSRegularExpression(pattern: #"\b(\d{1,2})/(\d{1,2})/(20\d{2})\b"#)
    private static let isoDate = try? NSRegularExpression(pattern: #"\b(20\d{2})-(\d{2})-(\d{2})\b"#)

    /// The first full calendar date (with a year) printed in the capture. A date without a year is not read.
    static func onScreenDate(in frames: [ScreenFrameText]) -> FoundValue? {
        for f in frames {
            for line in f.lines {
                if let d = firstDate(in: line) { return FoundValue(value: d, frame: f) }
            }
        }
        return nil
    }

    static func firstDate(in line: String) -> String? {
        let ns = line as NSString
        let full = NSRange(location: 0, length: ns.length)
        func make(_ y: Int, _ m: Int, _ d: Int) -> String? {
            var c = DateComponents(); c.year = y; c.month = m; c.day = d
            var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "UTC")!
            guard y >= 2000, y <= 2100, let date = cal.date(from: c) else { return nil }
            let back = cal.dateComponents([.year, .month, .day], from: date)
            guard back.year == y, back.month == m, back.day == d else { return nil }
            return String(format: "%04d-%02d-%02d", y, m, d)
        }
        if let m = nameDate?.firstMatch(in: line, range: full), m.numberOfRanges == 4,
           let mo = months[ns.substring(with: m.range(at: 1)).lowercased()],
           let d = Int(ns.substring(with: m.range(at: 2))), let y = Int(ns.substring(with: m.range(at: 3))) {
            if let s = make(y, mo, d) { return s }
        }
        if let m = isoDate?.firstMatch(in: line, range: full), m.numberOfRanges == 4,
           let y = Int(ns.substring(with: m.range(at: 1))), let mo = Int(ns.substring(with: m.range(at: 2))),
           let d = Int(ns.substring(with: m.range(at: 3))), let s = make(y, mo, d) { return s }
        if let m = slashDate?.firstMatch(in: line, range: full), m.numberOfRanges == 4,
           let mo = Int(ns.substring(with: m.range(at: 1))), let d = Int(ns.substring(with: m.range(at: 2))),
           let y = Int(ns.substring(with: m.range(at: 3))), let s = make(y, mo, d) { return s }       // US order
        return nil
    }

    // ─── Private text: any of it holds the whole capture on the phone ─────────

    private static let privateWords = [
        "password", "passcode", "verification code", "security code", "one-time", "one time code", "cvv", "cvc",
        "routing number", "account number", "social security", "ssn",
    ]
    private static let cardRun = try? NSRegularExpression(pattern: #"(?<!\d)(?:\d[ -]?){13,19}(?!\d)"#)
    private static let ssn = try? NSRegularExpression(pattern: #"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)"#)

    static func containsPrivateText(_ lines: [String]) -> Bool {
        for line in lines {
            let lower = line.lowercased()
            if privateWords.contains(where: { lower.contains($0) }) { return true }
            let ns = line as NSString
            let full = NSRange(location: 0, length: ns.length)
            if ssn?.firstMatch(in: line, range: full) != nil { return true }
            var card = false
            cardRun?.enumerateMatches(in: line, range: full) { m, _, stop in
                guard let m else { return }
                let digits = ns.substring(with: m.range).filter { $0.isNumber }
                if (13...19).contains(digits.count), luhn(digits) { card = true; stop.pointee = true }
            }
            if card { return true }
        }
        return false
    }

    static func luhn(_ digits: String) -> Bool {
        var sum = 0
        for (i, ch) in digits.reversed().enumerated() {
            guard var d = ch.wholeNumberValue else { return false }
            if i % 2 == 1 { d *= 2; if d > 9 { d -= 9 } }
            sum += d
        }
        return sum % 10 == 0
    }
}
