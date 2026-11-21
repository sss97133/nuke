import Foundation
import CryptoKit

// Replay the exact Foundation-only on-device candidate selector against a private JSON export.
// swiftc Sources/NukeCapture/LibraryCandidateDiscovery.swift scripts/discover-library-candidates/main.swift -o /tmp/library-candidates
// /tmp/library-candidates < input.json > candidates.json
do {
    let inputBytes = FileHandle.standardInput.readDataToEndOfFile()
    let input = try JSONDecoder().decode(LibraryCandidateDiscovery.Input.self, from: inputBytes)
    let result = LibraryCandidateDiscovery.discover(input)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    var output = try JSONSerialization.jsonObject(with: encoder.encode(result)) as! [String: Any]
    output["inputSha256"] = SHA256.hash(data: inputBytes).map { String(format: "%02x", $0) }.joined()
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys]))
} catch {
    FileHandle.standardError.write(Data("Candidate replay failed: \(error)\n".utf8))
    exit(1)
}
