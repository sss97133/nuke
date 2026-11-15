import Foundation

// Replay the exact Foundation-only on-device candidate selector against a private JSON export.
// swiftc Sources/NukeCapture/LibraryCandidateDiscovery.swift scripts/discover-library-candidates/main.swift -o /tmp/library-candidates
// /tmp/library-candidates < input.json > candidates.json
do {
    let input = try JSONDecoder().decode(LibraryCandidateDiscovery.Input.self, from: FileHandle.standardInput.readDataToEndOfFile())
    let result = LibraryCandidateDiscovery.discover(input)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    FileHandle.standardOutput.write(try encoder.encode(result))
} catch {
    FileHandle.standardError.write(Data("Candidate replay failed: \(error)\n".utf8))
    exit(1)
}
