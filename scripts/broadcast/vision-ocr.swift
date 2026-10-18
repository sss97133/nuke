import Foundation
import Vision
import AppKit

// vision-ocr <image>...  prints one JSON line per image:
// {"file": path, "lines": [{"text": s, "conf": c, "box": [x, y, w, h]}]}  (box: 0..1, origin top-left)
for path in CommandLine.arguments.dropFirst() {
    guard let image = NSImage(contentsOfFile: path),
          let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        print("{\"file\":\"\(path)\",\"error\":\"unreadable\",\"lines\":[]}")
        continue
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
    var lines: [[String: Any]] = []
    for obs in request.results ?? [] {
        guard let top = obs.topCandidates(1).first else { continue }
        let b = obs.boundingBox
        lines.append(["text": top.string, "conf": top.confidence,
                      "box": [b.origin.x, 1 - b.origin.y - b.height, b.width, b.height]])
    }
    if let data = try? JSONSerialization.data(withJSONObject: ["file": path, "lines": lines]),
       let s = String(data: data, encoding: .utf8) { print(s) }
}
