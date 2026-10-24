// ScreenTourUITests.swift — a reviewer's tour of the app: launches over the in-process fixture backend
// (-NukeFixtureBackend 1; never production, no writes leave the process), walks every main tab and key
// screen, and keeps a named screenshot of each (XCTAttachment, lifetime .keepAlways). CI exports them as the
// `screen-tour` artifact. Navigation is best-effort: a screen that can't be reached is recorded as a
// "MISSING-…" text attachment instead of failing the build, so the tour always produces what it can.

import XCTest

final class ScreenTourUITests: XCTestCase {
    let vehicleId = "00000000-0000-4000-8000-0000000000a1"
    let jobId = "00000000-0000-4000-8000-000000000001"
    private var index = 0

    override func setUp() { continueAfterFailure = true }

    private func launch(_ persona: String, ignitionDone: Bool = true, exploreMode: Bool = false,
                        _ env: [String: String] = [:]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-NukeFixtureBackend", "1", "-NukeFixturePersona", persona,
                                "-ignitionComplete", ignitionDone ? "YES" : "NO",
                                "-exploreMode", exploreMode ? "YES" : "NO"]
        app.launchEnvironment = env.merging(["NUKE_FIXTURE_SCENARIO": "tour"]) { $1 }
        app.launch()
        return app
    }

    private func shot(_ name: String, _ app: XCUIApplication, settle: UInt32 = 3) {
        sleep(settle)
        index += 1
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = String(format: "%02d-%@", index, name)
        a.lifetime = .keepAlways
        add(a)
    }

    private func missing(_ name: String, _ why: String) {
        let a = XCTAttachment(string: why)
        a.name = "MISSING-\(name)"
        a.lifetime = .keepAlways
        add(a)
    }

    /// Taps the first element that exists among the candidates; false if none appeared.
    @discardableResult
    private func tap(_ app: XCUIApplication, _ candidates: [XCUIElement], timeout: TimeInterval = 8) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            for c in candidates where c.exists && c.isHittable { c.tap(); return true }
            usleep(300_000)
        } while Date() < deadline
        return false
    }

    private func scrollTo(_ el: XCUIElement, _ app: XCUIApplication, tries: Int = 10) -> Bool {
        var n = 0
        while !(el.exists && el.isHittable) && n < tries { app.swipeUp(); n += 1 }
        return el.exists && el.isHittable
    }

    private func tab(_ app: XCUIApplication, _ label: String) -> Bool {
        tap(app, [app.tabBars.buttons[label].firstMatch, app.buttons[label].firstMatch])
    }

    private func label(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", text)).firstMatch
    }

    // MARK: First launch / onboarding

    func test1_FirstLaunch() {
        let visitor = launch("visitor", exploreMode: false)
        shot("first-launch-sign-in", visitor)
        visitor.terminate()

        let ignition = launch("client", ignitionDone: false)
        shot("onboarding-ignition", ignition, settle: 4)
        ignition.terminate()

        let explore = launch("visitor", exploreMode: true)
        shot("explore-signed-out", explore)
    }

    // MARK: Signed-in tour

    func test2_SignedInTour() {
        let app = launch("client")
        shot("home-landing", app)

        if tab(app, "Library") { shot("library-tab", app) } else { missing("library-tab", "Library tab only shows with full photo access; not granted on this simulator.") }

        if tab(app, "Profile") {
            shot("profile-home", app, settle: 4)
            let photos = label(app, "Your photos")
            if scrollTo(photos, app) {
                photos.tap()
                shot("profile-photos-by-date", app, settle: 4)
                if tap(app, [app.buttons["By vehicle"].firstMatch]) { shot("profile-photos-by-vehicle", app) } else { missing("profile-photos-by-vehicle", "segment not found") }
                if tap(app, [label(app, "Needs sorting")]) { shot("profile-photos-needs-sorting", app) } else { missing("profile-photos-needs-sorting", "segment not found") }
                app.navigationBars.buttons.firstMatch.tap()
            } else { missing("profile-photos", "'Your photos' row not found on the fixture profile") }
            if tap(app, [app.buttons["Account"].firstMatch]) {
                shot("settings-account", app)
                app.swipeDown(velocity: .fast)
            } else { missing("settings-account", "Account button not found on Profile") }
        } else { missing("profile-home", "Profile tab not found") }

        if tab(app, "Explore") {
            shot("explore-tab", app, settle: 4)
        } else { missing("explore-tab", "Explore tab not found") }

        if tab(app, "Work") {
            shot("work-tab-priorities", app, settle: 4)
            if scrollTo(label(app, "Awaiting your signature"), app, tries: 4) { shot("work-signatures", app, settle: 1) }
            let jobsHeader = label(app, "Jobs")
            if scrollTo(jobsHeader, app, tries: 8) { shot("work-jobs", app, settle: 1) } else { shot("work-scrolled", app, settle: 1) }
            let capture = app.staticTexts["Capture"].firstMatch
            if scrollTo(capture, app, tries: 6) {
                capture.tap()
                shot("capture", app)
                app.navigationBars.buttons.firstMatch.tap()
            } else { missing("capture", "Work's Capture row shows only with a photo grant; none on this simulator.") }
            if tap(app, [app.buttons["Paperwork"].firstMatch]) {
                shot("paperwork-scan", app, settle: 4)
            } else { missing("paperwork-scan", "Paperwork button not found in Work toolbar") }
        } else { missing("work-tab", "Work tab not found") }
    }

    // MARK: Deep-linked screens

    func test3_VehicleProfile() {
        let app = launch("client", ["NUKE_DEBUG_VEHICLE_ID": vehicleId])
        shot("vehicle-profile", app, settle: 6)
        app.swipeUp()
        shot("vehicle-profile-scrolled", app, settle: 2)
    }

    func test4_Job() {
        let app = launch("client", ["NUKE_DEBUG_JOB_ID": jobId])
        shot("job-detail", app, settle: 6)
    }

    func test5_Map() {
        let app = launch("client", ["NUKE_DEBUG_EXPLORE_MODE": "map", "NUKE_DEBUG_SCREEN": "explore"])
        shot("map", app, settle: 6)
    }

    func test6_WorkConsole() {
        let app = launch("provider", ["NUKE_DEBUG_JOBS_LOOKING": "1"])
        shot("work-jobs-looking-for-someone", app, settle: 5)
    }
}
