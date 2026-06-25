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

    // MARK: - Asset → CGImage (local, no network by default)

    /// Load a PHAsset (by localIdentifier) as a CGImage sized for Vision.
    /// Local-only by default — attribution should not spend cellular pulling
    /// iCloud originals; the originals are on the device that shot them.
    static func loadCGImage(assetID: String, maxPixel: CGFloat = 512,
                            allowNetwork: Bool = false) async -> CGImage? {
        let fetch = PHAsset.fetchAssets(withLocalIdentifiers: [assetID], options: nil)
        guard let asset = fetch.firstObject else { return nil }

        let opts = PHImageRequestOptions()
        opts.deliveryMode = .highQualityFormat
        opts.resizeMode = .fast
        opts.isNetworkAccessAllowed = allowNetwork
        opts.isSynchronous = false
        let target = CGSize(width: maxPixel, height: maxPixel)

        return await withCheckedContinuation { cont in
            PHImageManager.default().requestImage(
                for: asset, targetSize: target, contentMode: .aspectFit, options: opts
            ) { image, info in
                if let cg = image?.cgImage { cont.resume(returning: cg) }
                else { cont.resume(returning: nil) }
            }
        }
    }

    // MARK: - 1. Classification

    struct Classification {
        let labels: [(String, Float)]      // sorted, confidence-descending
        let isVehicle: Bool
        let maxCoreConfidence: Float
    }

    static func classify(_ cg: CGImage) -> Classification? {
        let request = VNClassifyImageRequest()
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        do { try handler.perform([request]) } catch { return nil }
        let results = (request.results ?? [])
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
    // auto-upload into the shared org record, so the firewall holds anything
    // with a prominent human face — default-EXCLUDE, faces lose ties. The
    // OWNER path does not use this (founder ruling: an owner's own at-site
    // photos upload ungated); this is the contributor gate only.

    /// True when a human face occupies a meaningful share of the frame — a
    /// person-centric photo, not a worker incidentally in a wide garage shot.
    /// `minAreaFraction` is the bbox area fraction: a distant bystander stays
    /// under it, a selfie/portrait trips it. Returns false on detector failure
    /// — safe because `contributorVerdict` ALSO requires an affirmative vehicle
    /// label, so a failed face pass alone can never let a private photo through.
    static func hasProminentFace(_ cg: CGImage, minAreaFraction: CGFloat = 0.045) -> Bool {
        let request = VNDetectFaceRectanglesRequest()
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        do { try handler.perform([request]) } catch { return false }
        guard let faces = request.results else { return false }
        // VNFaceObservation.boundingBox is normalized [0,1] in image space;
        // width*height is the fraction of the frame the face covers.
        return faces.contains {
            CGFloat($0.boundingBox.width * $0.boundingBox.height) >= minAreaFraction
        }
    }

    // MARK: - 1c. Contributor upload verdict (default-exclude firewall)

    /// Whether a CONTRIBUTOR's at-site photo may cross into the shared org
    /// record. Two affirmative conditions, BOTH required (swiss-cheese):
    ///   • the frame classifies as vehicle/work (`isVehicle`) — an affirmative
    ///     positive, not merely "absence of something bad"
    ///   • no prominent human face
    /// Anything else → `.hold` (quarantined for the contributor's OWN review,
    /// never auto-uploaded). Ambiguity loses. Multi-user path ONLY; the owner's
    /// own-device flow stays deliberately ungated.
    enum ContributorVerdict: Equatable {
        case allow
        case hold(reason: String)
    }

    static func contributorVerdict(_ cg: CGImage) -> ContributorVerdict {
        guard let cls = classify(cg) else { return .hold(reason: "unclassifiable") }
        if hasProminentFace(cg) { return .hold(reason: "prominent_face") }
        guard cls.isVehicle else { return .hold(reason: "not_vehicle_work") }
        return .allow
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
        /// isVehicle AND no prominent face. Caller ANDs in `!asset.isSensitivePhoto`.
        let pixelsEligible: Bool
        /// Top labels (confidence-desc), for the `apple_ml_labels` column.
        let labels: [String]
        let isVehicle: Bool
        /// false ⇒ classify() returned nil (unclassifiable). Caller fails safe to metadata-only.
        let classified: Bool
    }

    static func triage(_ cg: CGImage, labelCap: Int = 12) -> TriageResult {
        guard let cls = classify(cg) else {
            return TriageResult(pixelsEligible: false, labels: [], isVehicle: false, classified: false)
        }
        let labels = Array(cls.labels.prefix(labelCap).map { $0.0 })
        let pixelsEligible = cls.isVehicle && !hasProminentFace(cg)
        return TriageResult(pixelsEligible: pixelsEligible, labels: labels,
                            isVehicle: cls.isVehicle, classified: true)
    }

    /// Classify one library photo by its PHAsset id — the cheap, on-device
    /// organization verdict. Loads a small LOCAL frame (no network), runs triage
    /// off the main actor. `isPersonal` = not a clean vehicle/work photo (not a
    /// vehicle OR a prominent face). Returns nil for iCloud-only originals not on
    /// device — those classify later, when available.
    static func classifyAsset(localIdentifier: String) async -> (isVehicle: Bool, isPersonal: Bool, hasPerson: Bool, labels: [String])? {
        guard let cg = await loadCGImage(assetID: localIdentifier, maxPixel: 256, allowNetwork: false) else { return nil }
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
            let isPersonal = face && !cls.isVehicle
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
        let candidates = vinCandidates(in: recognizeText(cg))
        var best: (String, Int)? = nil
        for cand in candidates {
            for known in knownVINs {
                let d = levenshtein(cand, known.uppercased())
                if d <= 2 && (best == nil || d < best!.1) { best = (known, d) }
            }
        }
        return best.map { (vin: $0.0, editDistance: $0.1) }
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

    /// All recognized text lines (for SPID/data-plate reads beyond the VIN).
    static func recognizeText(_ cg: CGImage) -> [String] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        do { try handler.perform([request]) } catch { return [] }
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    }
}
