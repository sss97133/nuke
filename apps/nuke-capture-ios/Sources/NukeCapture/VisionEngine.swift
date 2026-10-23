// VisionEngine.swift — on-device image analysis via Apple's Vision framework.
//
// The phone is the always-on vision operator: the photos are already local
// (PhotoKit), and Apple's Vision framework runs free on the Neural Engine.
// This file is the primitive layer — three on-device analyses, no network,
// no API key, no GPU bill (proven at ~50ms/img in
// scripts/apple-vision-classifier.swift):
//
//   1. classify()     — VNClassifyImageRequest → scene/object labels + is-vehicle gate
//   2. featurePrint()  — VNGenerateImageFeaturePrint → on-device embedding for similarity
//   3. recognizeVIN()  — VNRecognizeText → OCR, pull a 17-char VIN out of a plate/SPID
//
// AttributionEngine composes these into the critical-mass router.

import Foundation
import Vision
import Photos
import UIKit

enum VisionEngine {

    // MARK: - Vehicle label sets (ported from scripts/apple-vision-classifier.swift)

    static let coreVehicleLabels: Set<String> = [
        "automobile", "car", "convertible", "engine_vehicle", "jeep",
        "motorhome", "pickup_truck", "sportscar", "suv", "truck", "van",
        "vehicle", "semi_truck", "atv",
    ]
    static let supportingVehicleLabels: Set<String> = [
        "garage", "parking_lot", "road", "driveway", "tire", "wheel",
        "dashboard", "car_seat", "engine",
    ]
    static var allVehicleLabels: Set<String> { coreVehicleLabels.union(supportingVehicleLabels) }

    // MARK: - "Unnecessary" (clutter) detection — POSITIVE junk signals only
    //
    // The essential gate: use Vision to keep the clutter (screenshots, shopping
    // captures, memes, documents) out of the way, so the real photos read clean.
    // CRITICAL: key on AFFIRMATIVE junk (a screenshot, or a top label that IS a
    // document/web/product capture) — NEVER on "absence of vehicle". A no-face
    // engine/part/interior close-up is a NECESSARY work photo Apple simply doesn't
    // tag "vehicle" (that was the arbitrary over-blur we already fixed in
    // classifyAsset). A document here is BOTH clutter AND the sensitive-doc case
    // (a title/registration) — gating it declutters and protects in one move.

    static let junkLabels: Set<String> = [
        "document", "text", "menu", "receipt", "paper", "printout",
        "poster", "advertisement", "packaging", "envelope", "label",
        "book_jacket", "business_card", "website", "web_site", "screenshot",
        "spreadsheet", "invoice", "id_card", "form", "newspaper", "magazine",
    ]

    /// PHAsset-level screenshot flag — FREE (a PhotoKit fact, no Vision, no decode).
    static func isScreenshot(localIdentifier: String) -> Bool {
        let f = PHAsset.fetchAssets(withLocalIdentifiers: [localIdentifier], options: nil)
        return f.firstObject?.mediaSubtypes.contains(.photoScreenshot) ?? false
    }

    /// "Unnecessary"/clutter verdict from POSITIVE signals: a screenshot, or a top
    /// on-device label that is a document/web/product capture. Conservative by design
    /// — only the strongest few labels vote, so a faint "text" tag on a real photo (a
    /// plate, a garage sign) does NOT gate it, and "not a vehicle" NEVER gates.
    static func isUnnecessary(labels: [String], isScreenshot: Bool) -> Bool {
        if isScreenshot { return true }
        for l in labels.prefix(3) where junkLabels.contains(l.lowercased()) { return true }
        return false
    }

    /// Identity-path document guard: OCR text can identify a photographed invoice
    /// even when the scene classifier misses the paper/document label. This is a
    /// local, free check; OCR text itself is never uploaded as an identity claim.
    static func isIdentityDocument(labels: [String], isScreenshot: Bool, ocrLines: [String]) -> Bool {
        if isUnnecessary(labels: labels, isScreenshot: isScreenshot) { return true }
        let text = ocrLines.joined(separator: " ").lowercased()
        let directMarkers = ["invoice", "receipt", "estimate", "work order", "repair order",
                             "bill to", "amount due", "project description"]
        if directMarkers.contains(where: text.contains) { return true }
        let lineItemMarkers = ["quantity", "unit price", "subtotal", "tax", "description", "cost"]
        return lineItemMarkers.filter(text.contains).count >= 3
    }

    // MARK: - Asset → CGImage (local, no network by default)

    /// Load a PHAsset (by localIdentifier) as a CGImage sized for Vision.
    /// Local-only by default — attribution should not spend cellular pulling
    /// iCloud originals; the originals are on the device that shot them.
    ///
    /// `timeoutSeconds` only applies when `allowNetwork` is true (the local path
    /// never hangs — PhotoKit answers a local-availability check fast — so the
    /// extra race machinery would be pure overhead there). When set, a slow/stalled
    /// iCloud fetch is cancelled and this returns nil instead of hanging the caller.
    static func loadCGImage(assetID: String, maxPixel: CGFloat = 512,
                            allowNetwork: Bool = false, timeoutSeconds: Double? = nil) async -> CGImage? {
        let fetch = PHAsset.fetchAssets(withLocalIdentifiers: [assetID], options: nil)
        guard let asset = fetch.firstObject else { return nil }

        let opts = PHImageRequestOptions()
        opts.deliveryMode = .highQualityFormat
        opts.resizeMode = .fast
        opts.isNetworkAccessAllowed = allowNetwork
        opts.isSynchronous = false
        let target = CGSize(width: maxPixel, height: maxPixel)

        guard allowNetwork, let timeoutSeconds else {
            return await withCheckedContinuation { cont in
                PHImageManager.default().requestImage(
                    for: asset, targetSize: target, contentMode: .aspectFit, options: opts
                ) { image, info in
                    if let cg = image?.cgImage { cont.resume(returning: cg) }
                    else { cont.resume(returning: nil) }
                }
            }
        }

        // Network path with a hard timeout: race the PhotoKit callback against a
        // sleep and cancel the in-flight request if the sleep wins, so one stalled
        // iCloud download (throttled connection, huge backlog) can never block the
        // classify queue indefinitely.
        let box = PHRequestIDBox()
        return await withTaskGroup(of: CGImage??.self) { group in
            group.addTask {
                let cg: CGImage? = await withCheckedContinuation { cont in
                    let rid = PHImageManager.default().requestImage(
                        for: asset, targetSize: target, contentMode: .aspectFit, options: opts
                    ) { image, info in
                        if let cg = image?.cgImage { cont.resume(returning: cg) }
                        else { cont.resume(returning: nil) }
                    }
                    Task { await box.set(rid) }
                }
                return .some(cg)
            }
            group.addTask {
                try? await Task.sleep(for: .seconds(timeoutSeconds))
                if let rid = await box.get() { PHImageManager.default().cancelImageRequest(rid) }
                return .some(nil)
            }
            let first = await group.next() ?? .some(nil)
            group.cancelAll()
            return first ?? nil
        }
    }

    /// Tiny actor box so the timeout task can cancel the in-flight PHImageRequestID
    /// the request task hands back — PHImageRequestID needs to cross this boundary.
    private actor PHRequestIDBox {
        private var id: PHImageRequestID?
        func set(_ v: PHImageRequestID) { id = v }
        func get() -> PHImageRequestID? { id }
    }

    // MARK: - Network-classification throttle
    //
    // `classifyAsset` falls back to a network (iCloud) fetch when a photo isn't
    // decodable locally (Optimize Storage). That's a DIFFERENT contention source
    // than local decode: it competes with LibraryIngest's own original-bytes
    // network pulls (LibraryIngest.swift — `lanes = 2`, kept low on purpose because
    // heavy PHImageManager network requests starved the live classifier once
    // already — see c51cdd2ed) through the same underlying iCloud-download queue,
    // and NukeCaptureApp's foreground head pass (deferred 3s, capped at 300) is
    // ANOTHER consumer of that same lane. So the network-classify path gets its own
    // ceiling, deliberately AT/BELOW LibraryIngest's lanes — never the 4-wide
    // fan-out LibraryGlasses uses for cheap local decode.
    private actor NetworkClassifyGate {
        static let shared = NetworkClassifyGate()
        private var active = 0
        private let limit = 2   // matches LibraryIngest.lanes — the two network
                                 // consumers of PHImageManager stay within the same
                                 // budget instead of compounding.
        private var waiters: [CheckedContinuation<Void, Never>] = []

        func acquire() async {
            if active < limit { active += 1; return }
            await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
                waiters.append(cont)
            }
            // Resumed ⇒ a slot was transferred directly to us; `active` unchanged.
        }
        func release() {
            if !waiters.isEmpty { waiters.removeFirst().resume() }
            else { active -= 1 }
        }
    }

    /// Gated + time-boxed network fetch for classification. Only reached when the
    /// local-only probe (see `classifyAsset`) came back empty, so the common
    /// already-on-device case never touches this gate at all.
    private static func networkFallbackImage(_ assetID: String) async -> CGImage? {
        await NetworkClassifyGate.shared.acquire()
        let cg = await loadCGImage(assetID: assetID, maxPixel: 256, allowNetwork: true, timeoutSeconds: 8)
        await NetworkClassifyGate.shared.release()
        return cg
    }

    // MARK: - 1. Classification

    struct Classification {
        let labels: [(String, Float)]      // sorted, confidence-descending
        let isVehicle: Bool
        let maxCoreConfidence: Float
    }

    static func classify(_ cg: CGImage) -> Classification? {
        let request = VNClassifyImageRequest()
        request.revision = VNClassifyImageRequestRevision2
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        do { try handler.perform([request]) } catch { return nil }
        guard let observations = request.results else { return nil }
        let results = observations
            .filter { $0.confidence > 0.02 }
            .sorted { $0.confidence > $1.confidence }
            .map { ($0.identifier, $0.confidence) }
        let coreMax = results.filter { coreVehicleLabels.contains($0.0) }.map { $0.1 }.max() ?? 0
        let totalVehicle = results.filter { allVehicleLabels.contains($0.0) }.reduce(Float(0)) { $0 + $1.1 }
        return Classification(
            labels: results,
            isVehicle: coreMax > 0.10 || totalVehicle > 0.30,
            maxCoreConfidence: coreMax
        )
    }

    // MARK: - 1b. Face presence (the private-photo firewall)
    //
    // The geo-gate keeps OFF-site photos out; it does NOTHING for a private
    // photo shot AT the shop (a selfie, a paycheck on the bench, a coworker's
    // kid). For the CONTRIBUTOR (multi-user) path such a photo must never
    // auto-upload into the shared org record. The firewall and owner triage
    // use a prominent face without a vehicle as the personal-photo signal.
    // A failed detector is not evidence of an absent face.

    enum TriageFailure: String, Error, LocalizedError {
        case imageUndecodable, classifierUnavailable, faceDetectorUnavailable

        var errorDescription: String? {
            switch self {
            case .imageUndecodable: return "The original photo couldn't be decoded for its privacy check."
            case .classifierUnavailable: return "Apple Vision couldn't classify the photo for its privacy check."
            case .faceDetectorUnavailable: return "Apple Vision couldn't finish the photo's face privacy check."
            }
        }
    }

    /// True when a human face occupies a meaningful share of the frame — a
    /// person-centric photo, not a worker incidentally in a wide garage shot.
    /// `minAreaFraction` is the bbox area fraction: a distant bystander stays
    /// under it, a selfie/portrait trips it. A failed detector is unknown.
    static func detectProminentFace(_ cg: CGImage, minAreaFraction: CGFloat = 0.045) throws -> Bool {
        let request = VNDetectFaceRectanglesRequest()
        request.revision = VNDetectFaceRectanglesRequestRevision3
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        try handler.perform([request])
        guard let faces = request.results else { throw TriageFailure.faceDetectorUnavailable }
        // VNFaceObservation.boundingBox is normalized [0,1] in image space;
        // width*height is the fraction of the frame the face covers.
        return faces.contains {
            CGFloat($0.boundingBox.width * $0.boundingBox.height) >= minAreaFraction
        }
    }

    /// Existing local-review callers still use a Boolean face result. Upload
    /// triage uses detectProminentFace directly so a failed read remains pending.
    static func hasProminentFace(_ cg: CGImage, minAreaFraction: CGFloat = 0.045) -> Bool {
        (try? detectProminentFace(cg, minAreaFraction: minAreaFraction)) ?? false
    }

    // MARK: - 1c. Contributor upload verdict (default-exclude firewall)

    /// Whether a CONTRIBUTOR's at-site photo may cross into the shared org
    /// record. The device rule of record, the same as `triage`: hold clutter (a
    /// document, receipt, web or product label in the top three) and personal (a
    /// prominent face and no vehicle); a part close-up or a measurement shot that
    /// Apple does not label "vehicle" is work and passes. An unclassifiable frame
    /// holds. A held frame stays for the contributor's OWN review, never
    /// auto-uploaded. Multi-user path ONLY; the owner's own-device flow stays
    /// deliberately ungated.
    enum ContributorVerdict: Equatable {
        case allow
        case hold(reason: String)
        case unavailable(reason: String)
    }

    static func contributorVerdict(_ cg: CGImage,
                                   classifyImage: (CGImage) -> Classification? = { classify($0) },
                                   detectFace: (CGImage) throws -> Bool = { try detectProminentFace($0) }) -> ContributorVerdict {
        guard let cls = classifyImage(cg) else { return .unavailable(reason: TriageFailure.classifierUnavailable.localizedDescription) }
        if VisionDecision.clutter(labels: cls.labels, isScreenshot: false) != nil {
            return .hold(reason: "clutter")
        }
        let face: Bool
        do { face = try detectFace(cg) }
        catch { return .unavailable(reason: TriageFailure.faceDetectorUnavailable.localizedDescription) }
        let decision = VisionDecision.decide(labels: cls.labels, isVehicle: cls.isVehicle, face: face)
        switch decision.category {
        case .work: return .allow
        case .workWithPeople: return .hold(reason: "people_in_frame")   // no pre-upload redaction exists
        case .sensitive, .notWork: return .hold(reason: "prominent_face")
        }
    }

    // MARK: - 1d. Owner triage (pixels vs metadata-only, pre-upload)
    //
    // The OWNER path uploads its own at-site photos, but raw PIXELS of personal
    // frames (the owner's kids, a paycheck, a portrait shot in the home shop)
    // must NOT land in the public bucket. So before upload we run the SAME
    // classify+face logic as the contributor firewall and let the caller split:
    //   • pixels-eligible  → upload the image + metadata (the build record)
    //   • not eligible     → upload METADATA ONLY (EXIF time/GPS = alibi signal);
    //                         the pixels stay on the phone.
    // One classify() pass yields BOTH the decision AND the label list, so we
    // also stop discarding the Apple ML labels the server L2 gate is starved for.
    // The `isSensitivePhoto` factor is a PHAsset property (not a pixel signal),
    // so the caller AND-folds it into the final decision.

    struct TriageResult {
        /// Not clutter and not personal (the device rule of record, see triage).
        let pixelsEligible: Bool
        /// Top labels (confidence-desc), for the `apple_ml_labels` column.
        let labels: [String]
        let isVehicle: Bool
        /// false ⇒ classify() returned nil (unclassifiable); upload preparation retries.
        let classified: Bool
        /// Operational failure, never a personal/clutter verdict or upload permission.
        let failure: TriageFailure?
        var privacyEvidence: DevicePrivacyReceipt.Evidence? = nil
        /// The categorised rule outcome (work / not_work / sensitive / work_with_people) for the local log.
        var decision: VisionDecision? = nil
        var scoredLabels: [(String, Float)] = []
        var hasFace = false
    }

    static func triage(_ cg: CGImage, labelCap: Int = 12,
                       classifyImage: (CGImage) -> Classification? = { classify($0) },
                       detectFace: (CGImage) throws -> Bool = { try detectProminentFace($0) }) -> TriageResult {
        guard let cls = classifyImage(cg) else {
            return TriageResult(pixelsEligible: false, labels: [], isVehicle: false, classified: false,
                                failure: .classifierUnavailable)
        }
        let labels = Array(cls.labels.prefix(labelCap).map { $0.0 })
        // The device rule of record (owner, 2026-10-15: "images have their own rules via ios";
        // scripts/ios-vision-triage applies it to stored frames): hold clutter (a document,
        // receipt, web or product label in the top three) and personal (a prominent face and no
        // vehicle); everything else is work evidence, including a part close-up or a tape measure
        // on a fuse-box opening that Apple does not label "vehicle". The previous rule required an
        // affirmative vehicle label, so measurement shots went up as metadata only.
        if let clutter = VisionDecision.clutter(labels: cls.labels, isScreenshot: false) {
            return TriageResult(pixelsEligible: false, labels: labels, isVehicle: cls.isVehicle, classified: true, failure: nil,
                                decision: clutter, scoredLabels: cls.labels)
        }
        let face: Bool
        do { face = try detectFace(cg) }
        catch {
            return TriageResult(pixelsEligible: false, labels: labels, isVehicle: cls.isVehicle, classified: true,
                                failure: .faceDetectorUnavailable)
        }
        // People in a work frame are a soft signal (the photo counts as work) but the pixels stay
        // on the phone: no on-device pre-upload redaction exists (see VisionDecision.swift).
        let decision = VisionDecision.decide(labels: cls.labels, isVehicle: cls.isVehicle, face: face)
        return TriageResult(pixelsEligible: decision.pixelsEligible, labels: labels,
                            isVehicle: cls.isVehicle, classified: true, failure: nil,
                            privacyEvidence: .init(labels: cls.labels, prominentFace: face, isVehicle: cls.isVehicle,
                                maxCoreConfidence: cls.maxCoreConfidence,
                                totalVehicleConfidence: cls.labels.filter { allVehicleLabels.contains($0.0) }.reduce(0) { $0 + $1.1 }),
                            decision: decision, scoredLabels: cls.labels, hasFace: face)
    }

    /// Classify one library photo by its PHAsset id — the cheap, on-device
    /// organization verdict. Tries a LOCAL decode first (free, uncapped — matches
    /// LibraryGlasses' 4-lane fan-out); only when that comes back empty (an
    /// iCloud-optimized original not cached on-device) does it fall back to a
    /// NETWORK fetch, gated + time-boxed (see `networkFallbackImage`) so iCloud
    /// coverage no longer means every scroll-triggered classify can freely hammer
    /// PhotoKit's network queue. Runs triage off the main actor. `isPersonal` = not
    /// a clean vehicle/work photo (not a vehicle OR a prominent face).
    static func classifyAsset(localIdentifier: String) async -> (isVehicle: Bool, isPersonal: Bool, hasPerson: Bool, labels: [String])? {
        // Local-only probe first — matches Blur's tagger for the common case (most
        // library photos ARE on-device) without touching the network gate at all.
        // With allowNetwork OFF here, an iCloud-only original returns nil FAST (a
        // local-availability check, no download attempted) — that's what made the
        // original bug ("iCloud-only photos never classify") cheap to detect and
        // cheap to fall back from.
        var cg = await loadCGImage(assetID: localIdentifier, maxPixel: 256, allowNetwork: false)
        if cg == nil {
            // Not cached locally (Optimize Storage). Pulling the user's OWN iCloud
            // original DOWN to their device for on-device Vision is not "pixels
            // leaving to us" — it never touches our cloud, so the local-first/privacy
            // doctrine holds. But it IS a real network fetch, so it goes through the
            // dedicated gate + timeout, never straight through PHImageManager.
            cg = await networkFallbackImage(localIdentifier)
        }
        guard let cg else { return nil }
        return await Task.detached(priority: .utility) {
            guard let cls = classify(cg) else { return nil }
            let face = hasProminentFace(cg)
            let labels = Array(cls.labels.prefix(12).map { $0.0 })
            // Auto-hide ONLY a person-centric, NON-vehicle photo (kids/family/selfies).
            // A work photo is NEVER auto-hidden — not a car-with-a-person (it's a vehicle),
            // and not a no-face part/engine/interior/document close-up that Apple simply
            // doesn't tag "vehicle". (Was `!isVehicle || face`, which blurred every untagged
            // work photo — the arbitrary over-blur.) hasPerson is carried so the Select tool
            // can let the owner resolve the genuinely borderline (person + vehicle) cases.
            // People with vehicle/part/tool/shop context are a soft signal, not personal.
            let isPersonal = VisionDecision.decide(labels: cls.labels, isVehicle: cls.isVehicle, face: face).isPersonal
                && face   // documents keep their own (non-face) handling; personal stays face-driven here
            return (cls.isVehicle, isPersonal, face, labels)
        }.value
    }

    // MARK: - 2. Feature print (on-device embedding for similarity)

    static func featurePrint(_ cg: CGImage) -> VNFeaturePrintObservation? {
        let request = VNGenerateImageFeaturePrintRequest()
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        do { try handler.perform([request]) } catch { return nil }
        return request.results?.first
    }

    /// Cosine-ish similarity in [0,1] from Vision's L2 feature distance
    /// (smaller distance = more similar). 1.0 = identical, 0 = far apart.
    static func similarity(_ a: VNFeaturePrintObservation, _ b: VNFeaturePrintObservation) -> Float {
        var distance: Float = 0
        do { try a.computeDistance(&distance, to: b) } catch { return 0 }
        // Vision feature-print distances are typically ~0 (same) to ~2 (unrelated).
        // Map to a bounded score; tune the divisor as real distributions land.
        return max(0, 1 - distance / 2.0)
    }

    // MARK: - 3. Text / VIN OCR

    /// OCR the image and recover a VIN by FUZZY-matching every 17-char run
    /// against the owner's known VINs. Live test (worn 1984 SPID plate) proved
    /// raw OCR nails 16/17 chars but confuses one (G→6), so strict equality
    /// fails — edit-distance ≤ 2 against the known set recovers it. Returns the
    /// matched KNOWN vin (canonical), not the raw OCR string.
    static func matchVIN(_ cg: CGImage, knownVINs: [String]) -> (vin: String, editDistance: Int)? {
        guard !knownVINs.isEmpty else { return nil }
        return matchSerial(in: recognizeText(cg), known: knownVINs)
    }

    /// Known serials of every era: 17-character VINs (1981 on) and the shorter chassis numbers
    /// before them (13 characters on a 1977 K5, 11 on a 1971 Bronco). Matching only 17-character
    /// runs left 206 of the owner's 211 vehicles unmatchable (2026-10-15). Each known serial is slid
    /// across each OCR line at its own length: two misreads allowed at 17 characters, one from 11,
    /// none below; it must mix letters and digits, so a phone number or a price cannot match it.
    /// 17-character runs also keep the edit-distance-2 recovery for a dropped or doubled character.
    static func matchSerial(in lines: [String], known: [String]) -> (vin: String, editDistance: Int)? {
        var best: (String, Int)? = nil
        func consider(_ k: String, _ d: Int) { if best == nil || d < best!.1 { best = (k, d) } }
        let vins = known.filter { $0.count == 17 }
        if !vins.isEmpty {
            for cand in vinCandidates(in: lines) {
                for k in vins {
                    let d = levenshtein(cand, k.uppercased())
                    if d <= 2 { consider(k, d) }
                }
            }
        }
        let texts = lines.map { Array($0.uppercased().filter { $0.isLetter || $0.isNumber }) }
        // Every serial, 17-character VINs included, is also slid across each line: a plate read as
        // "VIN 1GT…" joins the label onto the number, and a 17-character run then never lines up.
        for k in known where k.count >= 8 {
            let key = Array(k.uppercased())
            guard key.contains(where: \.isLetter), key.contains(where: \.isNumber) else { continue }
            let allowed = key.count >= 17 ? 2 : (key.count >= 11 ? 1 : 0)
            for a in texts where a.count >= key.count {
                for start in 0...(a.count - key.count) {
                    var d = 0
                    for i in 0..<key.count where a[start + i] != key[i] {
                        d += 1
                        if d > allowed { break }
                    }
                    if d <= allowed { consider(k, d) }
                }
            }
        }
        return best.map { (vin: $0.0, editDistance: $0.1) }
    }

    /// A 17-character VIN whose check digit (position 9) is right, by the North American rule:
    /// transliterate, weight, sum mod 11, 10 = "X". I, O and Q never appear. An OCR run that passes
    /// this is a VIN, not a part number that happens to be 17 characters long.
    static func isValidVIN(_ raw: String) -> Bool { OnDeviceAnalysis.isValidVIN(raw) }

    /// Checksum-validated VINs in the OCR text after the I/O/Q fix and at most one unambiguous
    /// glyph repair (OnDeviceAnalysis.checkVIN). Unlike `vinCandidates`, every value returned passes
    /// the ISO 3779 check digit; a run that only a guess could validate is not returned.
    static func checkedVINs(in lines: [String]) -> [String] {
        Array(Set(lines.flatMap(OnDeviceAnalysis.vinReads(in:)).compactMap {
            OnDeviceAnalysis.score($0, ocrConfidence: 1)?.value
        })).sorted()
    }

    /// Every 17-char alphanumeric run in the OCR text (VIN-shaped, no spaces).
    static func vinCandidates(in lines: [String]) -> [String] {
        let re = try? NSRegularExpression(pattern: "[A-Z0-9]{17}")
        var out: [String] = []
        for line in lines {
            let u = line.uppercased().replacingOccurrences(of: " ", with: "")
            let r = NSRange(u.startIndex..., in: u)
            re?.enumerateMatches(in: u, range: r) { m, _, _ in
                if let m, let rr = Range(m.range, in: u) { out.append(String(u[rr])) }
            }
        }
        return out
    }

    /// Pre-1981 chassis serials have no check digit. Accept them only when OCR sees
    /// an explicit VIN/serial/chassis label on the same line; album context later
    /// supplies make/model and the capture fold supplies the photographed vehicle.
    /// This keeps arbitrary part numbers and invoice line items from becoming IDs.
    static func labelledClassicSerialCandidates(in lines: [String]) -> [String] {
        let label = try? NSRegularExpression(pattern: #"\b(?:VIN|SERIAL(?:\s+NO\.?|\s+NUMBER)?|CHASSIS(?:\s+(?:NO\.?|NUMBER))?|VEHICLE\s+IDENTIFICATION)\b"#, options: [.caseInsensitive])
        var result = Set<String>()
        for line in lines {
            let ns = line as NSString
            guard let match = label?.firstMatch(in: line, range: NSRange(location: 0, length: ns.length)) else { continue }
            let tail = ns.substring(from: NSMaxRange(match.range))
            let tokens = tail.uppercased().components(separatedBy: CharacterSet.alphanumerics.inverted)
            let candidates = tokens.filter { token in
                (8...16).contains(token.count) && token.contains(where: \.isLetter) &&
                    token.contains(where: \.isNumber) && token.utf8.allSatisfy({ $0 < 128 })
            }
            // More than one serial-shaped value on a labelled line is ambiguous.
            if candidates.count == 1, let candidate = candidates.first { result.insert(candidate) }
        }
        return result.sorted()
    }

    private static func levenshtein(_ a: String, _ b: String) -> Int {
        let s = Array(a), t = Array(b)
        if s.isEmpty { return t.count }; if t.isEmpty { return s.count }
        var prev = Array(0...t.count)
        var cur = [Int](repeating: 0, count: t.count + 1)
        for i in 1...s.count {
            cur[0] = i
            for j in 1...t.count {
                cur[j] = min(prev[j] + 1, cur[j-1] + 1, prev[j-1] + (s[i-1] == t[j-1] ? 0 : 1))
            }
            swap(&prev, &cur)
        }
        return prev[t.count]
    }

    /// All recognized text lines (for SPID/data-plate reads beyond the VIN): accurate recognition,
    /// language correction off (it "corrects" serials into words), low-confidence boxes dropped.
    static func recognizeText(_ cg: CGImage) -> [String] {
        OnDeviceAnalysis.recognizeTextBoxes(cg).boxes.compactMap { $0.top?.0 }
    }
}
