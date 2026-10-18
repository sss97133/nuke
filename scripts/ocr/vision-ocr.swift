// On-device text recognition (Apple Vision, no network, no API cost) for operator pilots.
// Usage: swift scripts/ocr/vision-ocr.swift <image> [<image> ...]
// Prints one JSON object per image: {"path": ..., "lines": [{"text": ..., "confidence": ...}], "error": ...}
import Foundation
import Vision
import ImageIO

func recognize(_ path: String) -> [String: Any] {
  let url = URL(fileURLWithPath: path)
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    return ["path": path, "lines": [], "error": "unreadable image"]
  }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = false
  do {
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
  } catch {
    return ["path": path, "lines": [], "error": String(describing: error)]
  }
  let lines: [[String: Any]] = (request.results ?? []).compactMap { observation in
    guard let best = observation.topCandidates(1).first else { return nil }
    return ["text": best.string, "confidence": Double(best.confidence)]
  }
  return ["path": path, "lines": lines]
}

for path in CommandLine.arguments.dropFirst() {
  let result = recognize(path)
  if let data = try? JSONSerialization.data(withJSONObject: result), let line = String(data: data, encoding: .utf8) {
    print(line)
  }
}
