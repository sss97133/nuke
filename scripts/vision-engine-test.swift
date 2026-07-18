#!/usr/bin/env swift
// vision-engine-test.swift — play-by-play of the on-device Neural Engine passes.
// Runs the SAME three Vision passes VisionEngine.swift uses, on real images,
// timing each step. This is the "what happens in these milliseconds" demo.
//
//   swift scripts/vision-engine-test.swift <image> [<image> ...]
//
// Pass 1: VNClassifyImageRequest        (scene/object labels, is-vehicle gate)
// Pass 2: VNGenerateImageFeaturePrint    (on-device embedding for matching)
// Pass 3: VNRecognizeText                (OCR → pull a 17-char VIN)
// Then: feature-print similarity matrix across all images (the attribution match).

import Vision
import AppKit
import Foundation

let coreVehicle: Set<String> = ["automobile","car","convertible","jeep","pickup_truck",
    "sportscar","suv","truck","van","vehicle","semi_truck","atv"]
let allVehicle = coreVehicle.union(["garage","parking_lot","road","driveway","tire","wheel","dashboard","engine"])

func ms(_ s: CFAbsoluteTime) -> String { String(format: "%6.1fms", (CFAbsoluteTimeGetCurrent() - s) * 1000) }
func load(_ p: String) -> CGImage? {
    NSImage(contentsOfFile: p)?.cgImage(forProposedRect: nil, context: nil, hints: nil)
}

func vinRegex(_ s: String) -> String? {
    let u = s.uppercased().replacingOccurrences(of: " ", with: "")
    guard let re = try? NSRegularExpression(pattern: "\\b[A-HJ-NPR-Z0-9]{17}\\b") else { return nil }
    let r = NSRange(u.startIndex..., in: u)
    if let m = re.firstMatch(in: u, range: r), let rr = Range(m.range, in: u) { return String(u[rr]) }
    return nil
}

struct Analyzed { let name: String; let print: VNFeaturePrintObservation?; let total: Double }

func run(_ path: String) -> Analyzed {
    let name = (path as NSString).lastPathComponent
    print("\n━━ \(name) ━━")
    let t0 = CFAbsoluteTimeGetCurrent()
    guard let cg = load(path) else { print("  ✗ could not load"); return Analyzed(name: name, print: nil, total: 0) }
    print("[\(ms(t0))] image loaded  \(cg.width)×\(cg.height)")

    // PASS 1 — classify
    var s = CFAbsoluteTimeGetCurrent()
    let cReq = VNClassifyImageRequest()
    try? VNImageRequestHandler(cgImage: cg).perform([cReq])
    let labels = (cReq.results ?? []).filter { $0.confidence > 0.02 }.sorted { $0.confidence > $1.confidence }
    let coreMax = labels.filter { coreVehicle.contains($0.identifier) }.map { $0.confidence }.max() ?? 0
    let totVeh = labels.filter { allVehicle.contains($0.identifier) }.reduce(Float(0)) { $0 + $1.confidence }
    let isVeh = coreMax > 0.10 || totVeh > 0.30
    let top = labels.prefix(4).map { "\($0.identifier) \(Int($0.confidence*100))%" }.joined(separator: ", ")
    print("[\(ms(s))] PASS 1 classify   → \(top)  | vehicle? \(isVeh ? "YES" : "no")")

    // PASS 2 — feature print
    s = CFAbsoluteTimeGetCurrent()
    let fReq = VNGenerateImageFeaturePrintRequest()
    try? VNImageRequestHandler(cgImage: cg).perform([fReq])
    let fp = fReq.results?.first
    print("[\(ms(s))] PASS 2 print      → \(fp?.elementCount ?? 0)-dim on-device embedding")

    // PASS 3 — OCR / VIN
    s = CFAbsoluteTimeGetCurrent()
    let tReq = VNRecognizeTextRequest(); tReq.recognitionLevel = .accurate; tReq.usesLanguageCorrection = false
    try? VNImageRequestHandler(cgImage: cg).perform([tReq])
    let lines = (tReq.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    let vin = lines.compactMap { vinRegex($0) }.first
    print("[\(ms(s))] PASS 3 OCR        → \(lines.count) text lines\(vin != nil ? "  | VIN ✓ \(vin!)" : "")")

    let total = (CFAbsoluteTimeGetCurrent() - t0) * 1000
    print(String(format: "  ⟶ total %.1fms on the Neural Engine · $0", total))
    return Analyzed(name: name, print: fp, total: total)
}

func similarity(_ a: VNFeaturePrintObservation, _ b: VNFeaturePrintObservation) -> Float {
    var d: Float = 0; try? a.computeDistance(&d, to: b); return max(0, 1 - d / 2.0)
}

let paths = Array(CommandLine.arguments.dropFirst())
guard !paths.isEmpty else { print("usage: vision-engine-test.swift <image> ..."); exit(1) }
print("═══ ON-DEVICE NEURAL ENGINE — PLAY BY PLAY ═══")
let results = paths.map { run($0) }

let withPrints = results.filter { $0.print != nil }
if withPrints.count > 1 {
    print("\n═══ PASS 4 — feature-print similarity matrix (the attribution match) ═══")
    let hdr = withPrints.map { String($0.name.prefix(10)).padding(toLength: 10, withPad: " ", startingAt: 0) }.joined(separator: " ")
    print("            \(hdr)")
    for a in withPrints {
        let row = withPrints.map { b -> String in
            let s = similarity(a.print!, b.print!)
            return String(format: "%9.2f ", s)
        }.joined()
        print("\(String(a.name.prefix(10)).padding(toLength: 10, withPad: " ", startingAt: 0))  \(row)")
    }
    print("\n(1.00 = same image · high = same truck/angle · low = different vehicle)")
}
let avg = results.map { $0.total }.reduce(0,+) / Double(max(1, results.count))
print(String(format: "\n%d images · avg %.0fms each · all on-device, zero API cost", results.count, avg))
