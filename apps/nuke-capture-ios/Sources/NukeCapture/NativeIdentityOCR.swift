import Foundation
import Vision
import CoreImage

/// Bounded native reading of small, skewed identifier regions. No known VINs,
/// dictionaries or glyph substitutions influence this producer. Keep changed
/// seed reads as separate observations rather than silently rewriting them.
enum NativeIdentityOCR {
    static let methodVersion = "nuke-identity-perspective-v1"
    static let seedMethodVersion = "nuke-identity-perspective-seed-v1"
    static let maxPixel = 4096
    static let maxRegions = 2
    struct Reading {
        let candidates: [(String, Float)]
    }
    struct Result {
        let readings: [Reading]
        let seeds: [Reading]
        let revision: Int
    }

    static func identifierLike(_ text: String) -> Bool {
        let token = text.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return (8...17).contains(token.count) && token.contains(where: \.isLetter) && token.contains(where: \.isNumber)
            && token.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0) }
    }

    static func read(_ cg: CGImage, shouldHold: () -> Bool) -> Result? {
        guard !shouldHold(), cg.width > 0, cg.height > 0, max(cg.width, cg.height) <= maxPixel else { return nil }
        func recognize(_ input: CGImage) -> (lines: [VNRecognizedTextObservation], revision: Int)? {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = false
            do { try VNImageRequestHandler(cgImage: input, options: [:]).perform([request]) }
            catch { return nil }
            return (request.results ?? [], request.revision)
        }
        guard let initial = recognize(cg), !shouldHold() else { return nil }
        let image = CIImage(cgImage: cg)
        let context = CIContext(options: [.cacheIntermediates: false])
        var readings: [Reading] = [], seeds: [Reading] = [], attempted = 0
        for line in initial.lines.prefix(40) {
            guard !shouldHold() else { return nil }
            let seed = Reading(candidates: line.topCandidates(3).map { ($0.string, $0.confidence) })
            var selected = seed
            if attempted < maxRegions, let top = seed.candidates.first, top.1 >= 0.3, identifierLike(top.0),
               line.boundingBox.width * line.boundingBox.height <= 0.25,
               line.boundingBox.width * CGFloat(cg.width) >= 64, line.boundingBox.height * CGFloat(cg.height) >= 8 {
                attempted += 1
                func point(_ p: CGPoint) -> CIVector {
                    CIVector(x: p.x * image.extent.width, y: p.y * image.extent.height)
                }
                let fixed = image.applyingFilter("CIPerspectiveCorrection", parameters: [
                    "inputTopLeft": point(line.topLeft), "inputTopRight": point(line.topRight),
                    "inputBottomLeft": point(line.bottomLeft), "inputBottomRight": point(line.bottomRight)])
                let extent = fixed.extent
                if !extent.isInfinite, !extent.isEmpty, extent.width.isFinite, extent.height.isFinite,
                   extent.width <= 4096, extent.height <= 512,
                   let region = context.createCGImage(fixed, from: extent), let rectified = recognize(region),
                   rectified.revision == initial.revision, rectified.lines.count == 1,
                   let best = rectified.lines[0].topCandidates(1).first, best.confidence >= top.1,
                   identifierLike(best.string) {
                    selected = Reading(candidates: rectified.lines[0].topCandidates(3).map { ($0.string, $0.confidence) })
                    if best.string != top.0 { seeds.append(seed) }
                }
            }
            readings.append(selected)
        }
        guard !shouldHold() else { return nil }
        return Result(readings: readings, seeds: seeds, revision: initial.revision)
    }
}
