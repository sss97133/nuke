// OnDeviceAnalysis.swift — what the phone read, recorded as observations with their source.
//
// Every on-device result (Vision OCR text, VIN / serial / plate reads, classification labels and
// the scene/zone guess derived from them) becomes an `OnDeviceObservation` carrying the framework,
// request and revision that produced it plus a confidence in [0, 1]. They ride the existing
// protected reading lane (check-image-vehicle-match `record_device_reading`, which retains the
// reading in image_observations); no new table.
//
// OCR accuracy for identifiers:
//   • `.accurate` recognition, language correction OFF (a dictionary "fixes" VINs into words),
//     top-3 candidates per text box so a lower-ranked candidate with a valid check digit can win.
//   • VINs never contain I, O or Q (ISO 3779 / 49 CFR 565): O,Q → 0 and I → 1 before checking.
//   • 17-character VINs must pass the position-9 check digit. A run that fails gets ONE ambiguous
//     glyph swap (S/5, B/8, Z/2, G/6, D/0, …) and is kept only if exactly one swap validates,
//     at lower confidence. Pre-1981 labelled serials (8–16 chars, no check digit) stay allowed at
//     lower confidence.
//   • Reads under `minimumIdentifierConfidence` are dropped, never recorded.
//
// Thermal: one OCR pass and one classify pass per image (the same work the album review already
// did — this file replaces the bare-string OCR call). Callers stay behind SyncEngine's thermal /
// Low Power gate; `analyzeBatch` additionally re-checks it per image, runs on a background serial
// queue, and drains each image's Vision buffers in an autoreleasepool.

import Foundation
import Vision
import CoreGraphics

/// One thing the phone read, with where it came from and how sure it was.
struct OnDeviceObservation: Codable, Equatable, Hashable, Sendable {
    enum Kind: String, Codable, Sendable, CaseIterable {
        case ocrText = "ocr_text"
        case vin
        case classicSerial = "classic_serial"
        case plate
        case classificationLabel = "classification_label"
        case sceneZone = "scene_zone"
    }
    struct Source: Codable, Equatable, Hashable, Sendable {
        /// "Apple Vision"
        let framework: String
        /// The Vision request class, e.g. "VNRecognizeTextRequest".
        let model: String
        /// The request revision actually used.
        let revision: Int
        /// The OS that shipped the model, e.g. "iOS 26.0.1".
        let os_version: String
        /// Nuke's post-processing version (normalization / scoring rules).
        let method: String
    }
    let kind: Kind
    let value: String
    /// 0...1, rounded to 3 decimals so payloads are stable.
    let confidence: Double
    let source: Source
    /// Whether the identifier needed a confusion repair (O→0, single ambiguous swap). Nil for non-identifiers.
    var repaired: Bool? = nil

    init(kind: Kind, value: String, confidence: Double, source: Source, repaired: Bool? = nil) {
        self.kind = kind
        self.value = String(value.prefix(OnDeviceAnalysis.maxValueLength))
        self.confidence = (min(1, max(0, confidence)) * 1000).rounded() / 1000
        self.source = source
        self.repaired = repaired
    }
}

enum OnDeviceAnalysis {
    static let methodVersion = "nuke-ondevice-v1"
    static let maxValueLength = 120
    /// The server accepts at most this many per image (subjectService.ts mirrors it).
    static let maxObservations = 40
    /// OCR lines below this are noise and are not kept at all.
    static let minimumTextConfidence: Float = 0.3
    /// Identifier reads below this are rejected.
    static let minimumIdentifierConfidence: Double = 0.5
    static let minimumLabelConfidence: Float = 0.1

    static var osVersion: String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return "iOS \(v.majorVersion).\(v.minorVersion).\(v.patchVersion)"
    }
    static func textSource(revision: Int = VNRecognizeTextRequest.defaultRevision) -> OnDeviceObservation.Source {
        .init(framework: "Apple Vision", model: "VNRecognizeTextRequest", revision: revision, os_version: osVersion, method: methodVersion)
    }
    static func classifySource(revision: Int = VNClassifyImageRequestRevision2) -> OnDeviceObservation.Source {
        .init(framework: "Apple Vision", model: "VNClassifyImageRequest", revision: revision, os_version: osVersion, method: methodVersion)
    }

    static func isIdentityTextSource(_ source: OnDeviceObservation.Source) -> Bool {
        source.framework == "Apple Vision" && source.model == "VNRecognizeTextRequest" && source.revision > 0 &&
            [methodVersion, NativeIdentityOCR.methodVersion].contains(source.method)
    }

    static func identityObservations(_ reading: NativeIdentityOCR.Result, labels: [(String, Float)]) -> [OnDeviceObservation] {
        let source = OnDeviceObservation.Source(framework: "Apple Vision", model: "VNRecognizeTextRequest",
            revision: reading.revision, os_version: osVersion, method: NativeIdentityOCR.methodVersion)
        let selected = observations(textBoxes: reading.readings.map { TextBox(candidates: $0.candidates) },
            labels: labels, textSource: source)
        let seedSource = OnDeviceObservation.Source(framework: source.framework, model: source.model,
            revision: source.revision, os_version: source.os_version, method: NativeIdentityOCR.seedMethodVersion)
        let seeds = reading.seeds.compactMap { $0.candidates.first }.map {
            OnDeviceObservation(kind: .ocrText, value: $0.0, confidence: Double($0.1), source: seedSource)
        }
        return Array(selected.prefix(maxObservations - seeds.count)) + seeds
    }

    static func analyzeIdentity(_ cg: CGImage, classification: VisionEngine.Classification) -> (observations: [OnDeviceObservation], textLines: [String])? {
        guard let reading = NativeIdentityOCR.read(cg, shouldHold: { processHold }) else { return nil }
        return (identityObservations(reading, labels: classification.labels),
            reading.readings.compactMap { $0.candidates.first?.0 })
    }

    // MARK: - VIN check digit (ISO 3779 position 9, North American rule)

    private static let transliteration: [Character: Int] = [
        "A":1,"B":2,"C":3,"D":4,"E":5,"F":6,"G":7,"H":8,"J":1,"K":2,"L":3,"M":4,"N":5,
        "P":7,"R":9,"S":2,"T":3,"U":4,"V":5,"W":6,"X":7,"Y":8,"Z":9]
    private static let weights = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2]

    /// The expected check character for a 17-character VIN, or nil if it has an illegal character.
    static func checkDigit(_ vin: String) -> Character? {
        let v = Array(vin.uppercased())
        guard v.count == 17 else { return nil }
        var sum = 0
        for (i, c) in v.enumerated() {
            guard c.isASCII, let n = c.wholeNumberValue ?? transliteration[c] else { return nil }
            sum += n * weights[i]
        }
        let r = sum % 11
        return r == 10 ? "X" : Character(String(r))
    }

    static func isValidVIN(_ vin: String) -> Bool {
        let v = vin.uppercased()
        guard v.count == 17, !v.contains(where: { "IOQ".contains($0) }), let check = checkDigit(v) else { return false }
        return Array(v)[8] == check
    }

    // MARK: - Confusion fixes

    /// VINs never use I, O or Q, so those glyphs are always the digit OCR confused them with.
    /// Strips spaces, dashes and other separators.
    static func normalizeVINConfusions(_ raw: String) -> String {
        String(raw.uppercased().compactMap { c -> Character? in
            guard c.isASCII, c.isLetter || c.isNumber else { return nil }
            switch c { case "O", "Q": return "0"; case "I": return "1"; default: return c }
        })
    }

    /// Glyph pairs OCR swaps on stamped plates and SPID labels (after the I/O/Q fix).
    static let ambiguousGlyphs: [Character: [Character]] = [
        "S": ["5"], "5": ["S"], "B": ["8"], "8": ["B"], "Z": ["2"], "2": ["Z"],
        "G": ["6"], "6": ["G"], "D": ["0"], "0": ["D"], "1": ["L", "T"], "L": ["1"], "T": ["1"],
        "U": ["V"], "V": ["U"], "A": ["4"], "4": ["A"],
    ]

    enum VINVerdict: Equatable {
        /// Valid exactly as read.
        case valid(String)
        /// Valid after only the I/O/Q fix (deterministic: VINs cannot contain those).
        case validAfterIOQ(String)
        /// Valid after exactly one ambiguous-glyph swap, and no other single swap validates.
        case validAfterRepair(String)
        case invalid
    }

    static func checkVIN(_ raw: String) -> VINVerdict {
        let upper = String(raw.uppercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) })
        guard upper.count == 17 else { return .invalid }
        if isValidVIN(upper) { return .valid(upper) }
        let fixed = normalizeVINConfusions(upper)
        if fixed != upper, isValidVIN(fixed) { return .validAfterIOQ(fixed) }
        var chars = Array(fixed), hits = Set<String>()
        for i in chars.indices where i != 8 {   // never "repair" the check digit itself into agreement
            let original = chars[i]
            for alt in ambiguousGlyphs[original] ?? [] {
                chars[i] = alt
                let s = String(chars)
                if isValidVIN(s) { hits.insert(s) }
            }
            chars[i] = original
        }
        return hits.count == 1 ? .validAfterRepair(hits.first!) : .invalid
    }

    /// 17-character VIN reads in one OCR string. A label glued onto the number ("VIN1HGC…",
    /// "VIN:1HGC…") is stripped first. An exact 17-run gets the full check (incl. one glyph repair);
    /// an 18–20 run (an unlabelled glued prefix) is slid across, but a window counts only if it
    /// validates as read or after the I/O/Q fix — repairing windows would manufacture VINs.
    static func vinReads(in text: String) -> [VINVerdict] {
        let label = try? NSRegularExpression(pattern: #"\b(?:V\.?I\.?N\.?|VIN\s*(?:NO\.?|NUMBER|#)?)\s*[:#.-]?\s*"#, options: [.caseInsensitive])
        var u = text.uppercased()
        u = label?.stringByReplacingMatches(in: u, range: NSRange(u.startIndex..., in: u), withTemplate: " ") ?? u
        u = u.replacingOccurrences(of: "-", with: "")
        var out: [VINVerdict] = []
        for chunk in u.components(separatedBy: CharacterSet.alphanumerics.union(.whitespaces).inverted) {
            // "1HGCM 82633 A004352": spaces inside one VIN are an OCR artifact — but only when the
            // whole chunk collapses to exactly 17. Words of a sentence are never merged.
            let joined = chunk.filter { !$0.isWhitespace }
            if joined.count == 17, joined.count != chunk.trimmingCharacters(in: .whitespaces).count {
                out.append(strict(checkVIN(joined))); continue   // spaced: no glyph repair
            }
            for run in chunk.split(whereSeparator: \.isWhitespace).map(String.init) where run.count >= 17 {
                if run.count == 17 { out.append(checkVIN(run)); continue }
                guard run.count <= 20 else { continue }   // a glued 1–3 char prefix/suffix, nothing longer
                let a = Array(run)
                for start in 0...(a.count - 17) {
                    out.append(strict(checkVIN(String(a[start..<start + 17]))))
                }
            }
        }
        return out.filter { $0 != .invalid }
    }

    /// Drop a glyph-repaired verdict where the run itself is uncertain (spaced or windowed).
    private static func strict(_ v: VINVerdict) -> VINVerdict {
        if case .validAfterRepair = v { return .invalid }
        return v
    }

    // MARK: - Identifier scoring

    /// Score one 17-character run read at `ocrConfidence`. Nil = rejected (bad check digit,
    /// ambiguous repair, or too low after the penalty).
    static func scoreVIN(_ raw: String, ocrConfidence: Float, source: OnDeviceObservation.Source? = nil) -> OnDeviceObservation? {
        score(checkVIN(raw), ocrConfidence: ocrConfidence, source: source)
    }

    static func score(_ verdict: VINVerdict, ocrConfidence: Float, source: OnDeviceObservation.Source? = nil) -> OnDeviceObservation? {
        let base = Double(ocrConfidence)
        let (value, conf, repaired): (String, Double, Bool)
        switch verdict {
        case .valid(let v): (value, conf, repaired) = (v, base, false)
        case .validAfterIOQ(let v): (value, conf, repaired) = (v, base * 0.95, true)
        case .validAfterRepair(let v): (value, conf, repaired) = (v, base * 0.75, true)
        case .invalid: return nil
        }
        // Same shape rule as the server's isDeviceVehicleIdentifier: a run of one glyph class
        // ("11111111111111111") is not a VIN even when its arithmetic happens to check.
        guard value.contains(where: \.isLetter), value.contains(where: \.isNumber),
              conf >= minimumIdentifierConfidence else { return nil }
        return OnDeviceObservation(kind: .vin, value: value, confidence: conf, source: source ?? textSource(), repaired: repaired)
    }

    /// A labelled pre-1981 serial (no check digit): allowed, but at lower confidence.
    static func scoreClassicSerial(_ raw: String, ocrConfidence: Float, source: OnDeviceObservation.Source? = nil) -> OnDeviceObservation? {
        let v = raw.uppercased()
        guard (8...16).contains(v.count), v.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) }),
              v.contains(where: \.isLetter), v.contains(where: \.isNumber) else { return nil }
        let conf = Double(ocrConfidence) * 0.6
        guard conf >= minimumIdentifierConfidence else { return nil }
        return OnDeviceObservation(kind: .classicSerial, value: v, confidence: conf, source: source ?? textSource(), repaired: false)
    }

    /// A license plate is only guessed from a short, isolated, high-confidence text box that mixes
    /// letters and digits. Plates may legitimately contain O and I, so no glyph is rewritten; a read
    /// containing an O/0 or I/1 pair is marked ambiguous via a lower confidence instead.
    static func scorePlate(_ raw: String, ocrConfidence: Float, source: OnDeviceObservation.Source? = nil) -> OnDeviceObservation? {
        let compact = String(raw.uppercased().filter { $0 != " " && $0 != "-" && $0 != "·" })
        guard (4...8).contains(compact.count), raw.count <= 10,
              compact.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) }),
              compact.contains(where: \.isLetter), compact.contains(where: \.isNumber) else { return nil }
        let ambiguous = compact.contains(where: { "OI0Q1".contains($0) })
        let conf = Double(ocrConfidence) * (ambiguous ? 0.55 : 0.7)
        guard conf >= minimumIdentifierConfidence else { return nil }
        return OnDeviceObservation(kind: .plate, value: compact, confidence: conf, source: source ?? textSource(), repaired: false)
    }

    // MARK: - Scene / zone guesses (from classification labels)

    static let zoneByLabel: [String: String] = [
        "engine": "engine_bay", "engine_vehicle": "engine_bay",
        "dashboard": "interior", "car_seat": "interior", "steering_wheel": "interior",
        "tire": "wheel", "wheel": "wheel", "rim": "wheel",
        "garage": "shop", "workshop": "shop", "parking_lot": "outdoor_lot", "driveway": "outdoor_lot",
        "road": "road",
        "automobile": "exterior", "car": "exterior", "pickup_truck": "exterior", "suv": "exterior",
        "truck": "exterior", "van": "exterior", "sportscar": "exterior", "convertible": "exterior", "jeep": "exterior",
        "document": "paperwork", "receipt": "paperwork", "paper": "paperwork",
    ]

    /// Best-scoring zone per name, confidence = summed label confidence capped at 1.
    static func zoneGuesses(labels: [(String, Float)]) -> [(String, Double)] {
        var score: [String: Double] = [:]
        for (label, c) in labels { if let z = zoneByLabel[label.lowercased()] { score[z, default: 0] += Double(c) } }
        return score.filter { $0.value >= Double(minimumLabelConfidence) }
            .map { ($0.key, min(1, $0.value)) }
            .sorted { $0.1 != $1.1 ? $0.1 > $1.1 : $0.0 < $1.0 }
    }

    // MARK: - Assembling observations

    /// One OCR text box: its candidates (best first) with confidences.
    struct TextBox: Equatable, Sendable {
        let candidates: [(String, Float)]
        static func == (a: TextBox, b: TextBox) -> Bool {
            a.candidates.map(\.0) == b.candidates.map(\.0) && a.candidates.map(\.1) == b.candidates.map(\.1)
        }
        var top: (String, Float)? { candidates.first }
    }

    /// Pure: turn OCR boxes + classification labels into bounded, de-duplicated observations.
    /// Identifier reads come first so the cap never drops a VIN in favor of a stray word.
    static func observations(textBoxes: [TextBox], labels: [(String, Float)],
                             textSource: OnDeviceObservation.Source = textSource(),
                             classifySource: OnDeviceObservation.Source = classifySource()) -> [OnDeviceObservation] {
        var identifiers: [String: OnDeviceObservation] = [:]
        func keep(_ o: OnDeviceObservation?) {
            guard let o else { return }
            let key = o.kind.rawValue + "|" + o.value
            if (identifiers[key]?.confidence ?? -1) < o.confidence { identifiers[key] = o }
        }
        for box in textBoxes {
            for (text, conf) in box.candidates.prefix(3) where conf >= minimumTextConfidence {
                for verdict in vinReads(in: text) { keep(score(verdict, ocrConfidence: conf, source: textSource)) }
                for serial in VisionEngine.labelledClassicSerialCandidates(in: [text]) {
                    keep(scoreClassicSerial(serial, ocrConfidence: conf, source: textSource))
                }
            }
            if let top = box.top { keep(scorePlate(top.0, ocrConfidence: top.1, source: textSource)) }
        }
        // A plate-shaped string that is part of a VIN/serial is not a plate.
        let idValues = identifiers.values.filter { $0.kind != .plate }.map(\.value)
        let ids = identifiers.values.filter { o in o.kind != .plate || !idValues.contains(where: { $0.contains(o.value) }) }
            .sorted { $0.confidence != $1.confidence ? $0.confidence > $1.confidence : $0.value < $1.value }

        let zones = zoneGuesses(labels: labels).prefix(3).map {
            OnDeviceObservation(kind: .sceneZone, value: $0.0, confidence: $0.1, source: classifySource)
        }
        let labelObs = labels.filter { $0.1 >= minimumLabelConfidence }.prefix(8).map {
            OnDeviceObservation(kind: .classificationLabel, value: $0.0, confidence: Double($0.1), source: classifySource)
        }
        var seenText = Set<String>()
        let text = textBoxes.compactMap { $0.top }.filter { $0.1 >= minimumTextConfidence && seenText.insert($0.0).inserted }
            .map { OnDeviceObservation(kind: .ocrText, value: $0.0, confidence: Double($0.1), source: textSource) }
        return Array((ids + zones + labelObs + text).prefix(maxObservations))
    }

    static func encode(_ observations: [OnDeviceObservation]) -> String? {
        let e = JSONEncoder(); e.outputFormatting = [.sortedKeys]
        return (try? e.encode(observations)).map { String(decoding: $0, as: UTF8.self) }
    }
    static func decode(_ json: String?) -> [OnDeviceObservation] {
        guard let json else { return [] }
        return (try? JSONDecoder().decode([OnDeviceObservation].self, from: Data(json.utf8))) ?? []
    }

    // MARK: - Vision

    /// Accurate OCR with language correction off; up to three candidates per box.
    static func recognizeTextBoxes(_ cg: CGImage) -> (boxes: [TextBox], revision: Int) {
        autoreleasepool { () -> (boxes: [TextBox], revision: Int) in
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = false
            let handler = VNImageRequestHandler(cgImage: cg, options: [:])
            do { try handler.perform([request]) } catch { return ([], request.revision) }
            let boxes = (request.results ?? []).map { obs in
                TextBox(candidates: obs.topCandidates(3).map { ($0.string, $0.confidence) })
            }.filter { ($0.top?.1 ?? 0) >= minimumTextConfidence }
            return (boxes, request.revision)
        }
    }

    /// Full on-device read of one image. Synchronous, CPU/ANE-bound: call off the main actor.
    static func analyze(_ cg: CGImage, classification: VisionEngine.Classification?, readText: Bool = true) -> (observations: [OnDeviceObservation], textLines: [String]) {
        autoreleasepool { () -> (observations: [OnDeviceObservation], textLines: [String]) in
            let ocr: (boxes: [TextBox], revision: Int) = readText ? recognizeTextBoxes(cg) : (boxes: [], revision: VNRecognizeTextRequest.defaultRevision)
            let obs = observations(textBoxes: ocr.boxes, labels: classification?.labels ?? [],
                                   textSource: textSource(revision: ocr.revision))
            return (obs, ocr.boxes.compactMap { $0.top?.0 })
        }
    }

    /// The thermal / Low Power hold readable off the main actor (SyncEngine.deviceTooHotOrLow
    /// needs UIDevice for the charger exemption, so it is main-actor only). Stricter by design:
    /// Low Power Mode holds even on a charger here. Callers on the main actor gate on
    /// SyncEngine.deviceTooHotOrLow first, exactly as before.
    static var processHold: Bool {
        let p = ProcessInfo.processInfo
        return p.thermalState == .serious || p.thermalState == .critical || p.isLowPowerModeEnabled
    }

    private static let queue = DispatchQueue(label: "ag.nuke.capture.ondevice-analysis", qos: .utility)

    /// Batch entry point: one background serial queue, one autoreleasepool per image, and it stops
    /// (returning what it has) the moment the device is too hot or in Low Power Mode on battery.
    static func analyzeBatch(_ images: [CGImage], shouldHold: @escaping @Sendable () -> Bool = { processHold })
        async -> [[OnDeviceObservation]] {
        await withCheckedContinuation { cont in
            queue.async {
                var out: [[OnDeviceObservation]] = []
                for cg in images {
                    if shouldHold() { break }
                    out.append(autoreleasepool { analyze(cg, classification: VisionEngine.classify(cg)).observations })
                }
                cont.resume(returning: out)
            }
        }
    }
}

extension OnDeviceAnalysis {
    /// What may leave the phone. A document frame (invoice, title, receipt) keeps only its
    /// classification labels and zone guess — its text and any serial on it stay local, the same
    /// rule that empties `vin_candidates` for documents.
    static func uploadable(_ observations: [OnDeviceObservation], isDocument: Bool) -> [OnDeviceObservation] {
        let kept = isDocument ? observations.filter { $0.kind == .classificationLabel || $0.kind == .sceneZone } : observations
        return Array(kept.prefix(maxObservations))
    }
}
