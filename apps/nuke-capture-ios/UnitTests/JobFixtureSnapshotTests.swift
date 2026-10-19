// JobFixtureSnapshotTests.swift — renders the job screens from fixture JSON for owner review.
//
// Opt-in: runs only when NUKE_FIXTURE_SNAPSHOT_DIR is set (pass it to xcodebuild as
// TEST_RUNNER_NUKE_FIXTURE_SNAPSHOT_DIR=<dir>); CI skips it. Every image carries a FIXTURE
// banner, and the PNGs are written outside the repo, never into the app bundle (C0).

import SwiftUI
import UIKit
import XCTest
@testable import NukeCapture

@MainActor
final class JobFixtureSnapshotTests: XCTestCase {
    private var outputDir: URL!

    override func setUp() async throws {
        guard let dir = ProcessInfo.processInfo.environment["NUKE_FIXTURE_SNAPSHOT_DIR"], !dir.isEmpty else {
            throw XCTSkip("Set NUKE_FIXTURE_SNAPSHOT_DIR to render fixture snapshots.")
        }
        outputDir = URL(fileURLWithPath: dir, isDirectory: true)
        try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
    }

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JobReaders.decode(T.self, from: Data(json.utf8))
    }

    func testRenderJobView() throws {
        let path = try decode(JobPath.self, JobFixtures.jobPathWithLabels)
        let resources = try decode(JobResources.self, JobFixtures.resources)
        let view = NavigationStack {
            JobPathContent(workOrderId: JobFixtures.workOrderId, path: .loaded(path), resources: .loaded(resources))
        }
        try snapshot(view, name: "fixture-jobview", pages: 6)
    }

    func testRenderJobViewWithoutDisplayFields() throws {
        let path = try decode(JobPath.self, JobFixtures.jobPath)
        let view = NavigationStack {
            JobPathContent(workOrderId: JobFixtures.workOrderId, path: .loaded(path), resources: .loading,
                           titleHint: "Brake service", vehicleHint: nil)
        }
        try snapshot(view, name: "fixture-jobview-no-display-fields")
    }

    func testRenderJobViewUnavailable() throws {
        let gone = JobRefusal(reader: JobReaders.jobPathName, kind: .unavailable, title: "Job not available",
                              detail: "It doesn't exist, or it isn't shared with you.")
        let view = NavigationStack {
            JobPathContent(workOrderId: JobFixtures.workOrderId, path: .refused(gone), resources: .loading, titleHint: "Brake service")
        }
        try snapshot(view, name: "fixture-jobview-unavailable")
    }

    func testRenderProviderLink() throws {
        let me = try decode(MyIdentity.self, JobFixtures.identity)
        let hits = try JSONDecoder().decode([JobReaders.ActorHit].self, from: Data(JobFixtures.actorHits.utf8))
        let view = NavigationStack {
            ProviderLinkView(identity: .loaded(me), query: "Fixture Mechanic", hits: hits, loadOnAppear: false)
        }
        try snapshot(view, name: "fixture-provider-link")
    }

    func testRenderAcceptQuoteSheet() throws {
        let q = try decode(JobQuotes.self, JobFixtures.quotesForCustomer)
        let quote = try XCTUnwrap(q.currentQuote)
        let action = try XCTUnwrap(q.acceptAction)
        try snapshot(AcceptQuoteSheet(quote: quote, action: action), name: "fixture-accept-quote", pages: 2)
    }

    func testRenderJobViewWithQuote() throws {
        let path = try decode(JobPath.self, JobFixtures.anonJobPath)
        let quotes = try decode(JobQuotes.self, JobFixtures.quotesForCustomer)
        let view = NavigationStack {
            JobPathContent(workOrderId: JobFixtures.workOrderId, path: .loaded(path), resources: .loading, quotes: .loaded(quotes))
        }
        try snapshot(view, name: "fixture-jobview-quote", pages: 2)
    }

    func testRenderStatementForAParty() throws {
        let s = try decode(JobStatement.self, JobFixtures.statementParty)
        try snapshot(NavigationStack { VehicleStatementContent(statement: .loaded(s)) }, name: "fixture-statement-party")
    }

    func testRenderVehicleWorkCard() throws {
        let page = try decode(MyWorkOrders.self, JobFixtures.vehicleWorkOrders)
        let view = NavigationStack {
            ScrollView { VehicleWorkCard(vehicleId: JobFixtures.vehicleId, jobs: .loaded(page)).padding(.top, 12) }
                .background(Color(.systemGroupedBackground))
        }
        try snapshot(view, name: "fixture-vehicle-work-card")
    }

    func testRenderWorkSessionSignSheet() throws {
        let item = try decode(SignatureQueue.self, JobFixtures.signatureQueue).items[0]
        try snapshot(WorkSessionSignSheet(item: item), name: "fixture-sign-work-day")
    }

    func testRenderWorkConsole() throws {
        let queue = try decode(SignatureQueue.self, JobFixtures.signatureQueue)
        let jobs = try decode(MyWorkOrders.self, JobFixtures.myWorkOrders)
        let me = try decode(MyIdentity.self, JobFixtures.identity)
        let view = NavigationStack {
            WorkConsoleContent(signatures: .loaded(queue), jobs: .loaded(jobs), identity: .loaded(me), showCapture: false)
                .navigationTitle("Work")
                .navigationBarTitleDisplayMode(.inline)
        }
        try snapshot(view, name: "fixture-work-console")
    }

    func testRenderWorkConsoleRefusals() throws {
        let pending = JobReaders.pending
        let view = NavigationStack {
            WorkConsoleContent(signatures: .refused(pending(JobReaders.signatureQueueName)),
                               jobs: .refused(pending(JobReaders.workOrdersName)),
                               identity: .refused(pending(JobReaders.identityName)),
                               showCapture: false)
                .navigationTitle("Work")
                .navigationBarTitleDisplayMode(.inline)
        }
        try snapshot(view, name: "fixture-work-console-refusals")
    }

    func testRenderStageRailStates() throws {
        let full = try decode(JobPath.self, JobFixtures.jobPath)
        let future = try decode(JobPath.self, JobFixtures.futureJobPath)
        let rows = try decode(MyWorkOrders.self, JobFixtures.myWorkOrders).rows
        let view = List {
            Section("Full rail · job path fixture") {
                JobStageRail(path: full).padding(.vertical, 4)
            }
            Section("Full rail · unknown state, unread stages") {
                JobStageRail(path: future).padding(.vertical, 4)
            }
            Section("Mini rails · my_work_orders fixture rows") {
                ForEach(rows) { JobRowView(row: $0) }
            }
            Section("Legend") { JobStageRailLegend() }
        }
        try snapshot(view, name: "fixture-stage-rail")
    }

    // MARK: Rendering

    /// Renders `pages` screens of the view, scrolling its list between captures; stops at the end.
    private func snapshot<V: View>(_ view: V, name: String, pages: Int = 1) throws {
        let size = CGSize(width: 402, height: 874)
        let labelled = VStack(spacing: 0) {
            Text("FIXTURE · synthetic reader JSON · not live data")
                .font(.caption.weight(.bold).monospaced())
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity)
                .padding(.top, 54)
                .padding(.bottom, 6)
                .background(Color.yellow)
            view
        }
        .ignoresSafeArea(edges: .top)
        let host = UIHostingController(rootView: labelled)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: size)
        window.rootViewController = host
        window.isHidden = false
        defer { window.isHidden = true }
        RunLoop.main.run(until: Date().addingTimeInterval(1.5))
        let scroll = Self.firstScrollView(in: host.view)
        for page in 0..<pages {
            if page > 0 {
                guard let scroll else { break }
                let maxY = scroll.contentSize.height + scroll.adjustedContentInset.bottom - scroll.bounds.height
                let current = scroll.contentOffset.y
                guard current < maxY - 1 else { break }
                let next = min(current + scroll.bounds.height - 120, maxY)
                scroll.setContentOffset(CGPoint(x: 0, y: next), animated: false)
                RunLoop.main.run(until: Date().addingTimeInterval(0.8))
            }
            let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
                window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
            }
            let file = pages == 1 ? "\(name).png" : "\(name)-\(page + 1).png"
            try XCTUnwrap(image.pngData()).write(to: outputDir.appendingPathComponent(file))
        }
    }

    private static func firstScrollView(in view: UIView) -> UIScrollView? {
        if let s = view as? UIScrollView, s.isScrollEnabled, s.bounds.height > 200 { return s }
        for sub in view.subviews {
            if let s = firstScrollView(in: sub) { return s }
        }
        return nil
    }
}
