// ProfileFixtureSnapshotTests.swift — renders the profile's photo-record hero from fixture data for review.
//
// Opt-in, like JobFixtureSnapshotTests: runs only when NUKE_FIXTURE_SNAPSHOT_DIR is set (pass it to
// xcodebuild as TEST_RUNNER_NUKE_FIXTURE_SNAPSHOT_DIR=<dir>); CI skips it. The image carries a FIXTURE
// banner and is written outside the repo. Fixture: the owner's per-year photo counts on 2026-11-12,
// spread over each year's months so the chart shape is legible; the library count is the owner's.

import SwiftUI
import UIKit
import XCTest
@testable import NukeCapture

@MainActor
final class ProfileFixtureSnapshotTests: XCTestCase {
    private var outputDir: URL!

    override func setUp() async throws {
        guard let dir = ProcessInfo.processInfo.environment["NUKE_FIXTURE_SNAPSHOT_DIR"], !dir.isEmpty else {
            throw XCTSkip("Set NUKE_FIXTURE_SNAPSHOT_DIR to render fixture snapshots.")
        }
        outputDir = URL(fileURLWithPath: dir, isDirectory: true)
        try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
    }

    private static let perYear: [(Int, Int)] = [
        (2016, 20), (2017, 1672), (2018, 4119), (2019, 2610), (2020, 1464), (2021, 2260),
        (2022, 798), (2023, 1022), (2024, 3871), (2025, 4952), (2026, 6840),
    ]

    private static var fixtureDays: [DayRecord] {
        var out: [DayRecord] = []
        for (year, n) in perYear {
            let months = year == 2026 ? 11 : 12
            for m in 1...months {
                // Uneven months (a deterministic wave), never random, so the render is repeatable.
                let weight = 1 + (m * 7 + year) % 5
                out.append(DayRecord(day: String(format: "%04d-%02d-10", year, m), photos: max(1, n * weight / (months * 3))))
            }
        }
        return out
    }

    func testRenderPhotoRecordHero() throws {
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "UTC")!
        let history = PhotoHistory(days: Self.fixtureDays, now: Date(timeIntervalSince1970: 1_794_484_800), calendar: cal)
        let view = VStack(spacing: 0) {
            Text("FIXTURE · per-year counts from prod, months synthesized · not live data")
                .font(.caption.weight(.bold).monospaced()).foregroundStyle(.black)
                .frame(maxWidth: .infinity).padding(.vertical, 6).background(Color.yellow)
            ProfilePhotoRecordHero(history: history, settled: true, fallbackTotal: nil, libraryCount: 82_865,
                                   name: "Skylar Williams", handle: "skylar", recent: [])
                .padding(16)
            Spacer(minLength: 0)
        }
        .frame(width: 402, height: 420)
        .background(Color(.systemGroupedBackground))
        let renderer = ImageRenderer(content: view)
        renderer.scale = 3
        let image = try XCTUnwrap(renderer.uiImage)
        try XCTUnwrap(image.pngData()).write(to: outputDir.appendingPathComponent("fixture-profile-hero.png"))
    }
}
