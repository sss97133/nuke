// The iOS app's photo rule, run on a Mac: VisionEngine.swift (apps/nuke-capture-ios) is compiled unchanged beside
// this file by build.sh, so a frame that reached storage without passing through the phone is judged by the same
// predicates the phone uses. One JSON line per image path:
//   isVehicle       VisionEngine.classify: a core vehicle label over 0.10, or vehicle labels summing over 0.30
//   face            VisionEngine.hasProminentFace: a face covering at least 4.5% of the frame
//   clutter         VisionEngine.isUnnecessary: a top-three label is a document, receipt, web or product capture
//   pixelsEligible  VisionEngine.triage: isVehicle and no prominent face (the phone's upload test)
//   isPersonal      face and not isVehicle (the phone's auto-hide test)
import Foundation
import ImageIO
import CoreGraphics

func loadCG(_ path: String, maxPixel: Int = 512) -> CGImage? {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { return nil }
    let opts: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maxPixel,
    ]
    return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
}

struct Verdict: Codable {
    let file: String; let ok: Bool; let isVehicle: Bool; let face: Bool; let clutter: Bool
    let pixelsEligible: Bool; let isPersonal: Bool; let labels: [String]; let conf: [Float]
}

let encoder = JSONEncoder()
for path in CommandLine.arguments.dropFirst() {
    var v = Verdict(file: path, ok: false, isVehicle: false, face: false, clutter: false,
                    pixelsEligible: false, isPersonal: false, labels: [], conf: [])
    if let cg = loadCG(path), let cls = VisionEngine.classify(cg) {
        let top = Array(cls.labels.prefix(12))
        let face = VisionEngine.hasProminentFace(cg)
        v = Verdict(file: path, ok: true, isVehicle: cls.isVehicle, face: face,
                    clutter: VisionEngine.isUnnecessary(labels: top.map { $0.0 }, isScreenshot: false),
                    pixelsEligible: VisionEngine.triage(cg).pixelsEligible, isPersonal: face && !cls.isVehicle,
                    labels: top.map { $0.0 }, conf: top.map { ($0.1 * 1000).rounded() / 1000 })
    }
    print(String(data: try! encoder.encode(v), encoding: .utf8)!)
}
