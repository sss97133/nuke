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

    func testRenderProviderFaceSelf() throws {
        let p = try decode(ProviderProfile.self, ProviderFixtures.profile(context: "self"))
        let jobs = try decode(ProviderJobRecord.self, ProviderFixtures.jobRecord)
        let view = NavigationStack {
            List { ProviderFaceContent(profile: .loaded(p), jobs: .loaded(jobs), isOwn: true, showSubject: true) }
                .navigationTitle("Profile").navigationBarTitleDisplayMode(.inline)
        }
        try snapshot(view, name: "fixture-provider-self", pages: 5)
    }

    func testRenderProviderFaceVisitor() throws {
        let p = try decode(ProviderProfile.self, ProviderFixtures.profile(context: "visitor"))
        let jobs = try decode(ProviderJobRecord.self, ProviderFixtures.jobRecord)
        let view = NavigationStack {
            List { ProviderFaceContent(profile: .loaded(p), jobs: .loaded(jobs), showSubject: true) }
                .navigationTitle("Provider").navigationBarTitleDisplayMode(.inline)
        }
        try snapshot(view, name: "fixture-provider-visitor", pages: 2)
    }

    func testRenderContactRequestSheet() throws {
        let block = try decode(ContactBlock.self, ContactFixtures.availableBlock)
        let sheet = ContactRequestSheet(block: block, recipientName: "@fixture_tech", contextLabel: "Their profile (@fixture_tech)",
                                        loadLimits: false, draft: "Hi, do you take square-body brake jobs? I'm nearby.", leftToday: 7)
        try snapshot(sheet, name: "fixture-contact-sheet")
    }

    func testRenderContactInbox() throws {
        let box = try decode(ContactInbox.self, ContactFixtures.inbox)
        let view = NavigationStack {
            List { ContactInboxSection(inbox: .loaded(box)) }
                .navigationTitle("Work").navigationBarTitleDisplayMode(.inline)
        }
        try snapshot(view, name: "fixture-contact-inbox")
    }

    func testRenderContactThread() throws {
        let t = try decode(ContactThread.self, ContactFixtures.thread)
        let view = NavigationStack {
            ContactThreadView(requestId: "00000000-0000-4000-8000-00000000c002", thread: .loaded(t), loadOnAppear: false)
        }
        try snapshot(view, name: "fixture-contact-thread")
    }

    func testRenderJobsLookingWithMatch() throws {
        let page = try decode(OpenRequirements.self, OfferFixtures.open(signedIn: true))
        let view = NavigationStack {
            List { JobsLookingSection(open: .loaded(page), bridge: "claimed") }
                .navigationTitle("Work").navigationBarTitleDisplayMode(.inline)
        }
        try snapshot(view, name: "fixture-jobs-looking-match", pages: 2)
    }

    func testRenderOfferSheet() throws {
        let o = try decode(WorkOrderOffers.self, OfferFixtures.offers)
        let action = try XCTUnwrap(o.offerAction(for: OfferFixtures.reqTool))
        let lines = [OfferLineDraft(description: "Weld exhaust hangers", pricingBasis: "hourly", amount: "120", currency: "USD", quantity: "3")]
        try snapshot(OfferSheet(action: action, requirementTitle: "Tool: MIG welder for exhaust hangers", lines: lines),
                     name: "fixture-offer-sheet", pages: 2)
    }

    func testRenderAcceptOfferSheet() throws {
        let o = try decode(WorkOrderOffers.self, OfferFixtures.offers)
        let offer = o.requirements[0].offers[0]
        let action = try XCTUnwrap(o.acceptAction(for: offer))
        try snapshot(AcceptOfferSheet(action: action, offer: offer, requirementTitle: "Skill: Paint touch-up on the driver door"),
                     name: "fixture-accept-offer", pages: 2)
    }

    func testRenderJobOffersSection() throws {
        let o = try decode(WorkOrderOffers.self, OfferFixtures.offers)
        let view = NavigationStack {
            List { JobOffersSection(offers: .loaded(o)) }.navigationTitle("Job").navigationBarTitleDisplayMode(.inline)
        }
        try snapshot(view, name: "fixture-job-offers")
    }

    func testRenderOrderInspectionSheet() throws {
        let plan = try decode(WorkPlan.self, PlanFixtures.plan)
        let params = try XCTUnwrap(PlanReaders.orderParams(vehicleId: PlanFixtures.vehicleId, plan: plan))
        try snapshot(OrderInspectionSheet(params: params, plan: plan), name: "fixture-order-inspection", pages: 2)
    }

    func testRenderInspectionFindings() throws {
        let read = try decode(InspectionRead.self, PlanFixtures.inspection)
        let view = NavigationStack {
            List { JobInspectionSection(read: .loaded(read)) }.navigationTitle("Pre-purchase inspection").navigationBarTitleDisplayMode(.inline)
        }
        try snapshot(view, name: "fixture-inspection-findings", pages: 2)
    }

    func testRenderWorkPlanFixture() throws {
        let plan = try decode(WorkPlan.self, PlanFixtures.plan)
        let view = NavigationStack { WorkPlanEstimateView(vehicleId: PlanFixtures.vehicleId, plan: .loaded(plan), loadOnAppear: false) }
        try snapshot(view, name: "fixture-work-plan", pages: 3)
    }

    func testRenderCloseoutSheets() throws {
        let waiting = try XCTUnwrap(CompletionState(path: decode(JobPath.self, CloseoutFixtures.jobPath(attested: true, accepted: false, customer: true))))
        try snapshot(MarkDoneSheet(workOrderId: CloseoutFixtures.workOrderId, state: waiting), name: "fixture-mark-done")
        try snapshot(ConfirmDoneSheet(workOrderId: CloseoutFixtures.workOrderId, state: waiting), name: "fixture-confirm-done")
        let quote = try decode(JobQuotes.self, JobFixtures.quotesForCustomer).currentQuote
        try snapshot(IssueInvoiceSheet(workOrderId: CloseoutFixtures.workOrderId, acceptedQuote: quote), name: "fixture-issue-invoice", pages: 2)
        let r = try decode(WorkOrderInvoices.self, CloseoutFixtures.invoices(party: true))
        try snapshot(RecordPaymentSheet(action: try XCTUnwrap(r.paymentAction), invoice: try XCTUnwrap(r.current)), name: "fixture-record-payment")
        let c = try decode(EvidenceCandidates.self, CloseoutFixtures.evidence)
        try snapshot(AttachEvidenceSheet(workOrderId: CloseoutFixtures.workOrderId, jobTitle: "Brake service", imageIds: ["img-1", "img-2"],
                                         candidates: c, skipped: 1), name: "fixture-attach-evidence")
        try snapshot(JobAttachChooser(localIdentifiers: ["lid-a", "lid-b", "lid-c"], preloaded: (c, ["lid-a": "img-1", "lid-b": "img-2"])),
                     name: "fixture-attach-chooser")
    }

    func testRenderCloseoutSections() throws {
        let path = try decode(JobPath.self, CloseoutFixtures.jobPath(attested: true, accepted: false, customer: true))
        let state = try XCTUnwrap(CompletionState(path: path))
        let r = try decode(WorkOrderInvoices.self, CloseoutFixtures.invoices(party: true))
        let c = try decode(EvidenceCandidates.self, CloseoutFixtures.evidence)
        let view = NavigationStack {
            List {
                JobCompletionSection(workOrderId: CloseoutFixtures.workOrderId, state: state, viewerSlots: ["customer"], canMarkDone: false)
                JobInvoiceSection(read: .loaded(r), workOrderId: CloseoutFixtures.workOrderId)
                JobEvidencePrompt(workOrderId: CloseoutFixtures.workOrderId, jobTitle: "Brake service", read: .loaded(c))
            }
            .navigationTitle("Brake service").navigationBarTitleDisplayMode(.inline)
        }
        try snapshot(view, name: "fixture-closeout-sections", pages: 3)
        let visitor = try decode(WorkOrderInvoices.self, CloseoutFixtures.invoices(party: false))
        try snapshot(NavigationStack { List { JobInvoiceSection(read: .loaded(visitor), workOrderId: CloseoutFixtures.workOrderId) } },
                     name: "fixture-invoice-visitor")
    }

    func testRenderSignatureQueueKinds() throws {
        let q = try decode(SignatureQueue.self, CloseoutFixtures.queue)
        let view = NavigationStack {
            WorkConsoleContent(signatures: .loaded(q), jobs: .loading, identity: .loading, showCapture: false)
                .navigationTitle("Work").navigationBarTitleDisplayMode(.inline)
        }
        try snapshot(view, name: "fixture-signature-kinds")
        try snapshot(SignatureItemSheet(item: q.items[0]), name: "fixture-signature-item")
    }

    func testRenderCosignAndChangeOrderSheets() throws {
        let customer = try decode(WorkOrderOffers.self, CosignFixtures.offers(customer: true))
        let offer = try XCTUnwrap(customer.requirements.first?.offers.first)
        try snapshot(AcceptOfferSheet(action: try XCTUnwrap(customer.acceptAction(for: offer)), offer: offer,
                                      requirementTitle: "Skill: Paint touch-up on the driver door"), name: "fixture-accept-offer-cosigned", pages: 2)
        let provider = try decode(WorkOrderOffers.self, CosignFixtures.offers(customer: false))
        try snapshot(CosignSheet(action: try XCTUnwrap(provider.cosignAction(for: offer)), technician: "@fixture_painter",
                                 requestTitle: "Skill: Paint touch-up on the driver door"), name: "fixture-cosign-sheet", pages: 2)
        try snapshot(NavigationStack { List { JobOffersSection(offers: .loaded(provider)) } }, name: "fixture-offers-cosigned")
        try snapshot(VouchSheet(subjectUserId: "p1", subjectName: "@fixture_tech"), name: "fixture-vouch-sheet")
        let issuer = try decode(JobQuotes.self, CosignFixtures.acceptedForIssuer)
        try snapshot(IssueChangeOrderSheet(action: try XCTUnwrap(issuer.changeOrderAction), quote: try XCTUnwrap(issuer.currentQuote),
                                           prefill: { lines in var l = lines; l[1].state = .modify; l[1].quantity = "4"; l[2].state = .remove; return l }),
                     name: "fixture-issue-change-order", pages: 2)
        let co = try decode(JobQuotes.self, CosignFixtures.changeOrderQuotes)
        try snapshot(AcceptQuoteSheet(quote: try XCTUnwrap(co.currentQuote), action: try XCTUnwrap(co.acceptAction)),
                     name: "fixture-accept-change-order", pages: 2)
        let path = try decode(JobPath.self, JobFixtures.jobPathWithLabels)
        try snapshot(NavigationStack { JobPathContent(workOrderId: JobFixtures.workOrderId, path: .loaded(path), resources: .loading, quotes: .loaded(co)) },
                     name: "fixture-quote-change-order")
        let p = try decode(ProviderProfile.self, CosignFixtures.vouches)
        try snapshot(NavigationStack { List { ProviderFaceContent(profile: .loaded(p), jobs: .loading, showSubject: true) } },
                     name: "fixture-vouched-for-by", pages: 2)
    }

    func testRenderFacilityScreensAndSheets() throws {
        let now = FacilityCopy.date("2026-10-19T12:00:00Z") ?? Date()
        let party = try decode(FacilityRead.self, FacilityFixtures.read(party: true))
        let visitor = try decode(FacilityRead.self, FacilityFixtures.read(party: false))
        try snapshot(NavigationStack { FacilityContent(read: .loaded(visitor), now: now) }, name: "fixture-facility-visitor", pages: 2)
        try snapshot(NavigationStack { FacilityContent(read: .loaded(party), bookingFor: FacilityFixtures.workOrderId, now: now) },
                     name: "fixture-facility-party", pages: 2)
        let start = FacilityCopy.date("2026-10-21T16:00:00Z")
        try snapshot(BookFacilitySheet(workOrderId: FacilityFixtures.workOrderId, choices: FacilityChoice.from(party), start: start),
                     name: "fixture-book-bay", pages: 2)
        try snapshot(DeclareAssetSheet(action: try XCTUnwrap(party.declareAction), shopName: "Fixture Garage", kind: "lift", label: "Lift C", capacity: 1),
                     name: "fixture-declare-asset", pages: 2)
        let item = try XCTUnwrap(decode(SignatureQueue.self, FacilityFixtures.queue).items.first)
        try snapshot(ConfirmBookingSheet(item: item), name: "fixture-confirm-booking", pages: 2)
        let matches = try decode(FacilityMatches.self, FacilityFixtures.open).byRequirement
        let req = JobFacility.Requirement(requirementId: "rf1", description: "A lift for two days to drop the transmission", match: matches["rf1"])
        let booked = JobFacility(requirements: [req], bookings: JobFacility.bookings(for: FacilityFixtures.workOrderId, in: [party]))
        let waiting = JobFacility(requirements: [req], bookings: [])
        let reserved = try decode(FacilityReservation.self, FacilityFixtures.reserved)
        try snapshot(NavigationStack { List {
            JobFacilitySection(workOrderId: FacilityFixtures.workOrderId, facility: .loaded(booked), viewerIsParty: true, requested: .constant(nil))
            JobFacilitySection(workOrderId: FacilityFixtures.workOrderId, facility: .loaded(waiting), viewerIsParty: true, requested: .constant(reserved))
        } }, name: "fixture-job-facility")
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
