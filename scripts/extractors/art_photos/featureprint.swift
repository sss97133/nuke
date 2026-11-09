// Apple Vision image feature prints for a list of image paths: one JSON line per image {path, dim, v:[...]}.
// Same-object matching across angles and lighting, on device, no pixels leave the machine.
import Foundation
import Vision
import ImageIO

let args = CommandLine.arguments.dropFirst()
guard let listPath = args.first else { FileHandle.standardError.write("usage: featureprint <file-with-paths>\n".data(using: .utf8)!); exit(2) }
let paths = (try? String(contentsOfFile: listPath, encoding: .utf8))?.split(separator: "\n").map(String.init).filter { !$0.isEmpty } ?? []
let out = FileHandle.standardOutput
for p in paths {
  let url = URL(fileURLWithPath: p)
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
        let img = CGImageSourceCreateImageAtIndex(src, 0, [kCGImageSourceShouldCache: false] as CFDictionary) else { continue }
  let req = VNGenerateImageFeaturePrintRequest()
  let handler = VNImageRequestHandler(cgImage: img, options: [:])
  do { try handler.perform([req]) } catch { continue }
  guard let obs = req.results?.first as? VNFeaturePrintObservation else { continue }
  let count = obs.elementCount
  var floats = [Float](repeating: 0, count: count)
  _ = floats.withUnsafeMutableBytes { raw in obs.data.copyBytes(to: raw) }
  let vec = floats.map { String(format: "%.5f", $0) }.joined(separator: ",")
  out.write("{\"path\":\"\(p)\",\"dim\":\(count),\"v\":[\(vec)]}\n".data(using: .utf8)!)
}
