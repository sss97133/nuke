#!/usr/bin/env swift
//
// apple-vision-classifier.swift
// Pre-filter for automotive images using Apple Vision framework.
// Runs entirely on-device via Apple Neural Engine — free, fast (~50ms/image), no API keys.
//
// Usage:
//   swift apple-vision-classifier.swift --scan <photos_db_path> [--limit N] [--threshold 0.1]
//   swift apple-vision-classifier.swift --classify <file_list_path> [--threshold 0.1]
//   swift apple-vision-classifier.swift --file <single_image_path>
//   swift apple-vision-classifier.swift --benchmark <photos_db_path> [--limit 100]
//

import Vision
import AppKit
import Foundation
import SQLite3

// MARK: - Automotive Label Sets

/// Core vehicle labels — strong signal for "this is an automotive image"
let coreVehicleLabels: Set<String> = [
    "automobile", "car", "convertible", "engine_vehicle", "formula_one_car",
    "jeep", "motorcycle", "motorhome", "motorsport", "nascar",
    "sportscar", "suv", "truck", "van", "vehicle",
    "bus", "firetruck", "police_car", "semi_truck", "streetcar", "atv"
]

/// Supporting vehicle labels — context signals (road, parking, garage, parts)
let supportingVehicleLabels: Set<String> = [
    "garage", "parking_lot", "road", "driveway", "dirt_road",
    "road_other", "road_safety_equipment", "tire", "wheel",
    "car_seat", "dashboard"
]

/// All vehicle-related labels combined
let allVehicleLabels = coreVehicleLabels.union(supportingVehicleLabels)

// MARK: - Classification Result

struct ClassificationResult {
    let path: String
    let uuid: String
    let isVehicle: Bool
    let maxCoreConfidence: Float
    let totalVehicleConfidence: Float
    let topLabels: [(String, Float)]
    let vehicleLabels: [(String, Float)]
    let classifyTimeMs: Double
}

// MARK: - Classifier

func classifyImage(at path: String) -> [(String, Float)]? {
    guard let image = NSImage(contentsOfFile: path),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        return nil
    }

    let request = VNClassifyImageRequest()
    let handler = VNImageRequestHandler(cgImage: cgImage)

    do {
        try handler.perform([request])
        let results = request.results ?? []
        return results
            .filter { $0.confidence > 0.005 }
            .sorted { $0.confidence > $1.confidence }
            .map { ($0.identifier, $0.confidence) }
    } catch {
        return nil
    }
}

func isVehicleImage(results: [(String, Float)], threshold: Float) -> (Bool, Float, Float) {
    let vehicleResults = results.filter { allVehicleLabels.contains($0.0) }
    let coreResults = results.filter { coreVehicleLabels.contains($0.0) }
    let maxCoreConf = coreResults.map { $0.1 }.max() ?? 0
    let totalVehicleConf = vehicleResults.reduce(Float(0)) { $0 + $1.1 }

    let isVehicle = maxCoreConf > threshold || totalVehicleConf > (threshold * 3)
    return (isVehicle, maxCoreConf, totalVehicleConf)
}

// MARK: - Database Scanner

func scanPhotosDB(dbPath: String, limit: Int, threshold: Float, benchmarkOnly: Bool) {
    let photosBase = NSString(string: "~/Pictures/Photos Library.photoslibrary/originals").expandingTildeInPath

    // Open Photos.sqlite and find locally available photos
    guard let db = openSQLite(dbPath) else {
        print("ERROR: Cannot open database at \(dbPath)")
        return
    }
    defer { sqlite3_close(db) }

    let query = """
        SELECT ZUUID, ZDIRECTORY || '/' || ZFILENAME as path
        FROM ZASSET
        WHERE ZTRASHEDSTATE = 0
        AND ZKIND = 0
        ORDER BY ZDATECREATED DESC
        LIMIT \(limit * 5)
    """

    var candidates: [(String, String)] = []
    var stmt: OpaquePointer?
    if sqlite3_prepare_v2(db, query, -1, &stmt, nil) == SQLITE_OK {
        while sqlite3_step(stmt) == SQLITE_ROW {
            let uuid = String(cString: sqlite3_column_text(stmt, 0))
            let relPath = String(cString: sqlite3_column_text(stmt, 1))
            let fullPath = photosBase + "/" + relPath
            if FileManager.default.fileExists(atPath: fullPath) {
                candidates.append((uuid, fullPath))
            }
            if candidates.count >= limit { break }
        }
    }
    sqlite3_finalize(stmt)

    print("Found \(candidates.count) locally available photos (of \(limit * 5) checked)")
    print("Threshold: \(threshold)")
    print("")

    var vehicleCount = 0
    var otherCount = 0
    var skipCount = 0
    var totalMs: Double = 0
    var vehicleResults: [ClassificationResult] = []

    for (uuid, path) in candidates {
        let start = CFAbsoluteTimeGetCurrent()
        guard let results = classifyImage(at: path) else {
            skipCount += 1
            continue
        }
        let elapsed = (CFAbsoluteTimeGetCurrent() - start) * 1000

        let (isVehicle, maxCore, totalVehicle) = isVehicleImage(results: results, threshold: threshold)
        totalMs += elapsed

        let result = ClassificationResult(
            path: path,
            uuid: uuid,
            isVehicle: isVehicle,
            maxCoreConfidence: maxCore,
            totalVehicleConfidence: totalVehicle,
            topLabels: Array(results.prefix(5)),
            vehicleLabels: results.filter { allVehicleLabels.contains($0.0) },
            classifyTimeMs: elapsed
        )

        if isVehicle {
            vehicleCount += 1
            vehicleResults.append(result)
        } else {
            otherCount += 1
        }

        if !benchmarkOnly {
            let label = isVehicle ? "🚗" : "  "
            let filename = (path as NSString).lastPathComponent
            let top3 = results.prefix(3).map { "\($0.0):\(String(format: "%.0f%%", $0.1 * 100))" }.joined(separator: ", ")
            print("\(label) \(String(format: "%5.0fms", elapsed)) | \(filename) | \(top3)")
        }
    }

    let total = vehicleCount + otherCount
    let avgMs = total > 0 ? totalMs / Double(total) : 0

    print("")
    print("═══════════════════════════════════════")
    print("Results:")
    print("  Total classified: \(total)")
    print("  Vehicles: \(vehicleCount) (\(String(format: "%.1f%%", Float(vehicleCount) / Float(max(total, 1)) * 100)))")
    print("  Other: \(otherCount)")
    print("  Skipped: \(skipCount)")
    print("  Avg classify time: \(String(format: "%.1f", avgMs))ms")
    print("  Total time: \(String(format: "%.1f", totalMs / 1000))s")
    print("  Throughput: \(String(format: "%.0f", Double(total) / (totalMs / 1000))) images/sec")
    print("")

    if !vehicleResults.isEmpty {
        print("Vehicle photos found:")
        for r in vehicleResults {
            let filename = (r.path as NSString).lastPathComponent
            let autoLabels = r.vehicleLabels.prefix(5).map { "\($0.0):\(String(format: "%.0f%%", $0.1 * 100))" }.joined(separator: ", ")
            print("  \(filename)")
            print("    Labels: \(autoLabels)")
        }
    }

    // Output JSON for integration
    print("")
    print("--- JSON OUTPUT ---")
    let jsonResults = vehicleResults.map { r -> [String: Any] in
        return [
            "uuid": r.uuid,
            "path": r.path,
            "max_core_confidence": r.maxCoreConfidence,
            "total_vehicle_confidence": r.totalVehicleConfidence,
            "vehicle_labels": Dictionary(uniqueKeysWithValues: r.vehicleLabels),
            "classify_time_ms": r.classifyTimeMs
        ]
    }
    if let jsonData = try? JSONSerialization.data(withJSONObject: jsonResults, options: .prettyPrinted),
       let jsonStr = String(data: jsonData, encoding: .utf8) {
        print(jsonStr)
    }
}

func classifyFileList(listPath: String, threshold: Float) {
    guard let content = try? String(contentsOfFile: listPath, encoding: .utf8) else {
        print("ERROR: Cannot read file list at \(listPath)")
        return
    }

    let paths = content.components(separatedBy: "\n").filter { !$0.isEmpty }
    print("Classifying \(paths.count) images with threshold \(threshold)")
    print("")

    var vehicleCount = 0
    var otherCount = 0
    var totalMs: Double = 0

    for path in paths {
        let start = CFAbsoluteTimeGetCurrent()
        guard let results = classifyImage(at: path) else {
            print("SKIP \(path)")
            continue
        }
        let elapsed = (CFAbsoluteTimeGetCurrent() - start) * 1000
        totalMs += elapsed

        let (isVehicle, maxCore, totalVehicle) = isVehicleImage(results: results, threshold: threshold)

        let label = isVehicle ? "🚗 VEHICLE" : "   other "
        if isVehicle { vehicleCount += 1 } else { otherCount += 1 }

        let filename = (path as NSString).lastPathComponent
        let top5 = results.prefix(5).map { "\($0.0):\(String(format: "%.1f%%", $0.1 * 100))" }.joined(separator: " | ")
        let vehicleStr = results.filter { allVehicleLabels.contains($0.0) }.map { "\($0.0):\(String(format: "%.1f%%", $0.1 * 100))" }.joined(separator: ", ")

        print("\(label) | \(String(format: "%.0fms", elapsed)) | \(filename)")
        print("  Top5: \(top5)")
        if !vehicleStr.isEmpty {
            print("  Auto: \(vehicleStr)")
        }
        print("")
    }

    let total = vehicleCount + otherCount
    print("---")
    print("Results: \(vehicleCount) vehicles, \(otherCount) other, \(total) total")
    print("Vehicle rate: \(String(format: "%.1f%%", Float(vehicleCount) / Float(max(total, 1)) * 100))")
    print("Avg time: \(String(format: "%.1f", totalMs / Double(max(total, 1))))ms/image")
}

func classifyFileListJSON(listPath: String, threshold: Float) {
    guard let content = try? String(contentsOfFile: listPath, encoding: .utf8) else {
        print("{\"error\": \"Cannot read file list\"}")
        return
    }

    let paths = content.components(separatedBy: "\n").filter { !$0.isEmpty }

    for path in paths {
        let start = CFAbsoluteTimeGetCurrent()
        guard let results = classifyImage(at: path) else {
            let filename = (path as NSString).lastPathComponent
            print("{\"file\":\"\(filename)\",\"skip\":true}")
            continue
        }
        let elapsed = (CFAbsoluteTimeGetCurrent() - start) * 1000

        let (isVehicle, maxCore, totalVehicle) = isVehicleImage(results: results, threshold: threshold)

        let filename = (path as NSString).lastPathComponent
        let vehicleLabels = results.filter { allVehicleLabels.contains($0.0) }
        let top3 = results.prefix(3)

        // Build JSON manually to avoid Foundation serialization overhead
        var labelsJson = "{"
        labelsJson += vehicleLabels.map { "\"\($0.0)\":\(String(format: "%.4f", $0.1))" }.joined(separator: ",")
        labelsJson += "}"

        var top3Json = "{"
        top3Json += top3.map { "\"\($0.0)\":\(String(format: "%.4f", $0.1))" }.joined(separator: ",")
        top3Json += "}"

        print("{\"file\":\"\(filename)\",\"vehicle\":\(isVehicle),\"max_core\":\(String(format: "%.4f", maxCore)),\"total_vehicle\":\(String(format: "%.4f", totalVehicle)),\"ms\":\(String(format: "%.0f", elapsed)),\"auto_labels\":\(labelsJson),\"top3\":\(top3Json)}")
    }
}

func classifySingleFile(path: String, threshold: Float) {
    guard let results = classifyImage(at: path) else {
        print("ERROR: Cannot read image at \(path)")
        return
    }

    let (isVehicle, maxCore, totalVehicle) = isVehicleImage(results: results, threshold: threshold)

    print(isVehicle ? "🚗 VEHICLE DETECTED" : "Not a vehicle image")
    print("")
    print("All labels (confidence > 0.5%):")
    for (label, conf) in results {
        let marker = allVehicleLabels.contains(label) ? " ← AUTO" : ""
        print("  \(String(format: "%6.1f%%", conf * 100))  \(label)\(marker)")
    }
    print("")
    print("Max core vehicle confidence: \(String(format: "%.1f%%", maxCore * 100))")
    print("Total vehicle confidence: \(String(format: "%.1f%%", totalVehicle * 100))")
}

// MARK: - SQLite Helpers

typealias SQLiteDB = OpaquePointer

func openSQLite(_ path: String) -> SQLiteDB? {
    var db: OpaquePointer?
    let expandedPath = NSString(string: path).expandingTildeInPath
    if sqlite3_open_v2(expandedPath, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK {
        return db
    }
    return nil
}

// MARK: - Main

let args = CommandLine.arguments
var mode = ""
var targetPath = ""
var limit = 100
var threshold: Float = 0.1
var jsonOutput = false

var i = 1
while i < args.count {
    switch args[i] {
    case "--scan":
        mode = "scan"
        if i + 1 < args.count { targetPath = args[i + 1]; i += 1 }
    case "--classify":
        mode = "classify"
        if i + 1 < args.count { targetPath = args[i + 1]; i += 1 }
    case "--file":
        mode = "file"
        if i + 1 < args.count { targetPath = args[i + 1]; i += 1 }
    case "--benchmark":
        mode = "benchmark"
        if i + 1 < args.count { targetPath = args[i + 1]; i += 1 }
    case "--limit":
        if i + 1 < args.count { limit = Int(args[i + 1]) ?? 100; i += 1 }
    case "--threshold":
        if i + 1 < args.count { threshold = Float(args[i + 1]) ?? 0.1; i += 1 }
    case "--json":
        jsonOutput = true
    default:
        break
    }
    i += 1
}

switch mode {
case "scan":
    scanPhotosDB(dbPath: targetPath, limit: limit, threshold: threshold, benchmarkOnly: false)
case "benchmark":
    scanPhotosDB(dbPath: targetPath, limit: limit, threshold: threshold, benchmarkOnly: true)
case "classify":
    if jsonOutput {
        classifyFileListJSON(listPath: targetPath, threshold: threshold)
    } else {
        classifyFileList(listPath: targetPath, threshold: threshold)
    }
case "file":
    classifySingleFile(path: targetPath, threshold: threshold)
default:
    print("""
    Apple Vision Vehicle Classifier
    ================================
    Pre-filter for automotive images using Apple Vision framework.
    Runs entirely on-device via Apple Neural Engine.

    Usage:
      swift \(args[0]) --scan <photos_db_path> [--limit N] [--threshold 0.1]
        Scan Photos library for vehicle images (needs Photos.sqlite path)

      swift \(args[0]) --classify <file_list_path> [--threshold 0.1]
        Classify images listed in a text file (one path per line)

      swift \(args[0]) --file <image_path> [--threshold 0.1]
        Classify a single image file

      swift \(args[0]) --benchmark <photos_db_path> [--limit 100]
        Benchmark classification speed on Photos library

    Options:
      --limit N         Max images to process (default: 100)
      --threshold F     Min confidence for vehicle detection (default: 0.1)
    """)
}
