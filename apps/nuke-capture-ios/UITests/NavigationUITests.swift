import XCTest

/// Technical UI fixtures only: every request stays on fixture.nuke.invalid.
final class NavigationUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    /// Scrolls the list until `element` is on screen; the garage cards are tall, so rows below them start off screen.
    private func reveal(_ element: XCUIElement, in app: XCUIApplication, swipes: Int = 8) -> Bool {
        for _ in 0..<swipes {
            if element.waitForExistence(timeout: 2) && element.isHittable { return true }
            app.swipeUp()
        }
        return element.exists && element.isHittable
    }

    private func openJourneyDay(_ mode: String, analysis: String = "") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "client", "-ignitionComplete", "YES"]
        app.launchEnvironment = ["NUKE_FIXTURE_SCENARIO": "navigation-garage", "NUKE_FIXTURE_DAY_MODE": mode, "NUKE_FIXTURE_ANALYSIS_MODE": analysis]
        app.launch()
        let garage = app.tabBars.buttons["Garage"].firstMatch
        XCTAssertTrue(garage.waitForExistence(timeout: 12)); garage.tap()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5)); search.tap(); search.typeText("1234567\n")
        let vehicle = app.staticTexts["1973 Fixture Coupe"].firstMatch
        XCTAssertTrue(vehicle.waitForExistence(timeout: 10)); vehicle.tap()
        let timeline = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Build timeline")).firstMatch
        for _ in 0..<12 {
            if timeline.exists && timeline.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(timeline.isHittable); timeline.tap()
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(secondsFromGMT: 0)
        let day = app.descendants(matching: .any).matching(identifier: "timeline.day.\(f.string(from: Date()))").firstMatch
        XCTAssertTrue(day.waitForExistence(timeout: 5)); day.tap()
        return app
    }

    func testAnalysisFailureRetriesOnExactPhotoAndReturnsToSameDay() {
        let app = openJourneyDay("analysis", analysis: "failure")
        let photo = app.buttons["day.photo.00000000-0000-4000-8000-00000000e001"]
        XCTAssertTrue(photo.waitForExistence(timeout: 10)); photo.tap()
        XCTAssertTrue(app.staticTexts["evidence.analysis.error"].waitForExistence(timeout: 10), app.debugDescription.replacingOccurrences(of: "\n", with: " | "))
        XCTAssertFalse(app.staticTexts["Analysis pending"].exists)
        XCTAssertFalse(app.staticTexts["evidence.analysis.empty"].exists)
        app.buttons["evidence.analysis.retry"].tap()
        XCTAssertTrue(app.staticTexts["Fixture analysis for exact photo"].waitForExistence(timeout: 10), app.debugDescription.replacingOccurrences(of: "\n", with: " | "))
        XCTAssertFalse(app.staticTexts["evidence.analysis.error"].exists)
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(photo.waitForExistence(timeout: 5))
        app.buttons["Done"].firstMatch.tap()
        let back = app.navigationBars.buttons["Garage"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 5)); back.tap()
        XCTAssertTrue((app.searchFields.firstMatch.value as? String)?.contains("1234567") == true)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testSuccessfulEmptyAnalysisDoesNotClaimPendingOrFailure() {
        let app = openJourneyDay("analysis", analysis: "empty")
        let photo = app.buttons["day.photo.00000000-0000-4000-8000-00000000e001"]
        XCTAssertTrue(photo.waitForExistence(timeout: 10)); photo.tap()
        XCTAssertTrue(app.staticTexts["evidence.analysis.empty"].waitForExistence(timeout: 10), app.debugDescription.replacingOccurrences(of: "\n", with: " | "))
        XCTAssertFalse(app.staticTexts["evidence.analysis.error"].exists)
        XCTAssertFalse(app.buttons["evidence.analysis.retry"].exists)
        XCTAssertFalse(app.staticTexts["Analysis pending"].exists)
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(photo.waitForExistence(timeout: 5))
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    private func checkAccountPhotos(_ status: String, label: String, explanation: String) {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "client", "-ignitionComplete", "YES"]
        app.launchEnvironment = ["NUKE_FIXTURE_SCENARIO": "navigation-garage", "NUKE_FIXTURE_PHOTOS_STATUS": status]
        app.launch()
        let profile = app.tabBars.buttons["Profile"].firstMatch
        XCTAssertTrue(profile.waitForExistence(timeout: 12)); profile.tap()
        let account = app.buttons["Account"].firstMatch
        XCTAssertTrue(account.waitForExistence(timeout: 5)); account.tap()
        let grant = app.staticTexts["account.photos.status"]
        for _ in 0..<8 {
            if grant.exists && grant.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(grant.exists, app.debugDescription.replacingOccurrences(of: "\n", with: " | "))
        XCTAssertEqual(grant.label, "Photos, \(label)")
        XCTAssertTrue(app.staticTexts["account.photos.explanation"].label.contains(explanation), app.debugDescription.replacingOccurrences(of: "\n", with: " | "))
        XCTAssertTrue(app.buttons["account.photos.settings"].exists)
        app.buttons["Done"].firstMatch.tap()
        XCTAssertEqual(app.tabBars.buttons["Library"].exists, status == "full")
        XCTAssertTrue(app.tabBars.buttons["Work"].exists)
        app.tabBars.buttons["Garage"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["1973 Fixture Coupe"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testAccountExplainsLimitedPhotosWithoutHidingGarage() {
        checkAccountPhotos("limited", label: "Limited access", explanation: "Library requires full Photos access")
    }

    func testAccountExplainsPhotosOffWithoutHidingGarage() {
        checkAccountPhotos("off", label: "Off", explanation: "Library is unavailable")
    }

    func testAccountShowsFullPhotosAccessAndLibrary() {
        checkAccountPhotos("full", label: "Full access", explanation: "Library is available")
    }

    func testDayPhotoFailureRetriesAndReturnsThroughSameDayToGarageSearch() {
        let app = openJourneyDay("failure")
        XCTAssertTrue(app.staticTexts["day.photos.error"].waitForExistence(timeout: 10),
                      "Expected a terminal photo-read error. Screen: \(app.debugDescription.replacingOccurrences(of: "\n", with: " | "))")
        XCTAssertFalse(app.staticTexts["day.photos.empty"].exists)
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "none carry a capture date")).firstMatch.exists)
        app.buttons["day.photos.retry"].tap()
        let photo = app.buttons["day.photo.00000000-0000-4000-8000-00000000e001"]
        XCTAssertTrue(photo.waitForExistence(timeout: 10)); photo.tap()
        let evidence = app.descendants(matching: .any).matching(identifier: "day.evidence.00000000-0000-4000-8000-00000000e001").firstMatch
        XCTAssertTrue(evidence.waitForExistence(timeout: 5))
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(photo.waitForExistence(timeout: 5), "evidence dismissal must return to its exact day")
        XCTAssertFalse(app.staticTexts["day.photos.error"].exists)
        app.buttons["Done"].firstMatch.tap()
        let back = app.navigationBars.buttons["Garage"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 5)); back.tap()
        XCTAssertTrue((app.searchFields.firstMatch.value as? String)?.contains("1234567") == true)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testSuccessfulEmptyDayDoesNotInventMissingCaptureDates() {
        let app = openJourneyDay("empty")
        XCTAssertTrue(app.staticTexts["day.photos.empty"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["day.photos.error"].exists)
        XCTAssertFalse(app.buttons["day.photos.retry"].exists)
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "none carry a capture date")).firstMatch.exists)
    }

    func testReturningFromEvidenceRechecksDayMembership() {
        let app = openJourneyDay("changed")
        let photo = app.buttons["day.photo.00000000-0000-4000-8000-00000000e001"]
        XCTAssertTrue(photo.waitForExistence(timeout: 10)); photo.tap()
        let evidence = app.descendants(matching: .any).matching(identifier: "day.evidence.00000000-0000-4000-8000-00000000e001").firstMatch
        XCTAssertTrue(evidence.waitForExistence(timeout: 5))
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["day.photos.empty"].waitForExistence(timeout: 10))
        XCTAssertFalse(photo.exists, "a source no longer returned for this day must not remain in its contact sheet")
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testEventOnlyDayDoesNotClaimWorkWasLogged() {
        let app = openJourneyDay("events")
        XCTAssertTrue(app.staticTexts["day.photos.empty"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["2 events recorded"].exists)
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "work logged")).firstMatch.exists)
    }

    func testSessionReviewInspectsSourceWithoutSelectingOrFiling() {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "client", "-ignitionComplete", "YES"]
        app.launchEnvironment["NUKE_FIXTURE_SCENARIO"] = "source-inspection"
        app.launch()
        let garage = app.tabBars.buttons["Garage"].firstMatch
        XCTAssertTrue(garage.waitForExistence(timeout: 12)); garage.tap()
        let organize = app.buttons["Organize photos"].firstMatch
        XCTAssertTrue(reveal(organize, in: app), "Organize photos sits below the garage cards"); organize.tap()
        let day = app.staticTexts["2026-10-31"].firstMatch
        XCTAssertTrue(day.waitForExistence(timeout: 10)); day.tap()
        let inspect = app.buttons["session.source.inspect.00000000-0000-4000-8000-00000000e001"]
        XCTAssertTrue(inspect.waitForExistence(timeout: 10)); inspect.tap()
        XCTAssertTrue(app.staticTexts["This reading remains unresolved."].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Retained interpretations · this read does not establish identity"].exists)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "session-source-inspection"; shot.lifetime = .keepAlways; add(shot)
        app.navigationBars.buttons["Which vehicle?"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["0 selected · 1 shown of 1 session photos"].waitForExistence(timeout: 5))
        let log = app.descendants(matching: .any)["fixture.writes"]
        XCTAssertTrue(log.waitForExistence(timeout: 5))
        XCTAssertEqual(log.label, "no writes", "Inspecting a source must not assert identity or file a photo")
    }

    func testSessionReviewKeepsConflictingLocalReadingsByteUnbound() {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "client", "-ignitionComplete", "YES"]
        app.launchEnvironment = ["NUKE_FIXTURE_SCENARIO": "source-inspection", "NUKE_FIXTURE_NATIVE_REVIEW": "conflict"]
        app.launch()
        let garage = app.tabBars.buttons["Garage"].firstMatch
        XCTAssertTrue(garage.waitForExistence(timeout: 12)); garage.tap()
        let organize = app.buttons["Organize photos"].firstMatch
        XCTAssertTrue(reveal(organize, in: app), "Organize photos sits below the garage cards"); organize.tap()
        let day = app.staticTexts["2026-10-31"].firstMatch
        XCTAssertTrue(day.waitForExistence(timeout: 10)); day.tap()
        let inspect = app.buttons["session.source.inspect.00000000-0000-4000-8000-00000000e001"]
        XCTAssertTrue(inspect.waitForExistence(timeout: 10)); inspect.tap()
        let local = app.staticTexts["Local native reading"]
        XCTAssertTrue(local.waitForExistence(timeout: 10))
        app.swipeUp()
        XCTAssertTrue(app.staticTexts["Multiple identifier-shaped readings remain; none is selected."].exists)
        XCTAssertTrue(app.staticTexts["2S87R3N100001"].exists)
        XCTAssertTrue(app.staticTexts["2S87R3N100009"].exists)
        XCTAssertTrue(app.staticTexts["Earlier native reading"].exists)
        XCTAssertTrue(app.staticTexts["Native reading pass"].exists)
        XCTAssertTrue(app.staticTexts["This reading matches the current Photos source. Uploaded byte identity is not bound because its source hash is unavailable."].exists)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "local-native-reading-conflict"; shot.lifetime = .keepAlways; add(shot)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testSessionReviewShowsReadyBoundCloseupAsTextOnly() {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "client", "-ignitionComplete", "YES"]
        app.launchEnvironment = ["NUKE_FIXTURE_SCENARIO": "source-inspection", "NUKE_FIXTURE_NATIVE_REVIEW": "nonvehicle"]
        app.launch()
        let garage = app.tabBars.buttons["Garage"].firstMatch
        XCTAssertTrue(garage.waitForExistence(timeout: 12)); garage.tap()
        let organize = app.buttons["Organize photos"].firstMatch
        XCTAssertTrue(reveal(organize, in: app), "Organize photos sits below the garage cards"); organize.tap()
        let day = app.staticTexts["2026-10-31"].firstMatch
        XCTAssertTrue(day.waitForExistence(timeout: 10)); day.tap()
        let inspect = app.buttons["session.source.inspect.00000000-0000-4000-8000-00000000e001"]
        XCTAssertTrue(inspect.waitForExistence(timeout: 10)); inspect.tap()
        let local = app.staticTexts["Local native reading"]
        XCTAssertTrue(local.waitForExistence(timeout: 10))
        app.swipeUp()
        XCTAssertTrue(app.staticTexts["Multiple identifier-shaped readings remain; none is selected."].exists)
        XCTAssertTrue(app.staticTexts["2S87R3N100001"].exists)
        XCTAssertTrue(app.staticTexts["2S87R3N100009"].exists)
        XCTAssertTrue(app.staticTexts["Earlier native reading"].exists)
        XCTAssertTrue(app.staticTexts["Native reading pass"].exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Classification unresolved · text only.")).firstMatch.exists)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "local-native-reading-closeup"; shot.lifetime = .keepAlways; add(shot)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testGarageTabFindsAZeroPhotoRecordAndOpensTheActualProfile() {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "client", "-ignitionComplete", "YES"]
        app.launchEnvironment["NUKE_FIXTURE_SCENARIO"] = "navigation-garage"
        app.launch()
        let garage = app.tabBars.buttons["Garage"].firstMatch
        XCTAssertTrue(garage.waitForExistence(timeout: 12), "finding your vehicles must not require hunting through Profile or granting full Photos access")
        garage.tap()
        let row = app.staticTexts["1973 Fixture Coupe"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "a created record must be findable without photos or an ownership claim")
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("1234567\n")
        XCTAssertTrue(row.waitForExistence(timeout: 5), "stored VIN suffix must find the existing record")
        row.tap()
        let profile = app.descendants(matching: .any).matching(identifier: "garage.vehicle.profile.00000000-0000-4000-8000-00000000c001").firstMatch
        XCTAssertTrue(profile.waitForExistence(timeout: 10), "the primary row must open the actual vehicle profile")
        XCTAssertTrue(app.staticTexts["1973 FIXTURE COUPE"].firstMatch.waitForExistence(timeout: 10), "the profile must load the vehicle identity, not only mount its destination")
        XCTAssertTrue(app.staticTexts["No photos available on this profile"].waitForExistence(timeout: 5), "a successful empty gallery must explain why uploaded photos may not appear here yet")
        XCTAssertFalse(app.staticTexts["Couldn't load photos"].exists, "an empty gallery is a successful read, not a load failure")
        XCTAssertFalse(app.buttons["Open the vehicle profile"].exists, "the Garage must not insert a jobs screen before the profile")
        let back = app.navigationBars.buttons["Garage"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 5))
        back.tap()
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertTrue((search.value as? String)?.contains("1234567") == true, "returning must retain the Garage search")
    }

    /// The garage cards (garage-cards fixture): newest activity first under year headings, the undated car last,
    /// the price only from the profile's masthead Claim, the log book read from the card's menu, and no writes.
    func testGarageCardsOrderByActivityAndOpenTheLogBook() {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "client", "-ignitionComplete", "YES"]
        app.launchEnvironment["NUKE_FIXTURE_SCENARIO"] = "garage-cards"
        app.launch()
        let garage = app.tabBars.buttons["Garage"].firstMatch
        XCTAssertTrue(garage.waitForExistence(timeout: 12)); garage.tap()
        let first = app.staticTexts["1973 Fixture Coupe Formula"].firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Last recorded sale, $41,500"].waitForExistence(timeout: 10), "the masthead's recorded sale is the card's price")
        for value in ["$99,999", "$45,000"] {
            XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", value)).firstMatch.exists,
                           "current_value never reaches a card")
        }
        // The first drag loads the reel (cover first, then the others once each); the pager counts them.
        let photo = app.descendants(matching: .any).matching(identifier: "garage.card.photo.00000000-0000-4000-8000-00000000c101").firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 5))
        photo.swipeLeft()
        if !app.staticTexts["2 / 3"].waitForExistence(timeout: 5) { photo.swipeLeft() }
        XCTAssertTrue(app.staticTexts["2 / 3"].waitForExistence(timeout: 5), "the reel pages through the car's photos")
        let top = XCTAttachment(screenshot: app.screenshot()); top.name = "garage-cards-top"; top.lifetime = .keepAlways; add(top)
        // The two recent cars are 2 and 40 days old (UTC), so early in a year they fall under two headings.
        let year: (Int) -> String = { daysAgo in
            var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(secondsFromGMT: 0)!
            return String(c.component(.year, from: Date().addingTimeInterval(-Double(daysAgo) * 86_400)))
        }
        let recent = year(2) == year(40) ? ["\(year(2)) · 2"] : ["\(year(2)) · 1", "\(year(40)) · 1"]
        let headings = recent + ["2024 · 1", "2023 · 1", "No dated activity · 1"]
        var seen: [String] = []
        for _ in 0..<14 {
            for h in headings where !seen.contains(h) && app.staticTexts[h].exists { seen.append(h) }
            if seen.count == headings.count { break }
            app.swipeUp()
        }
        XCTAssertEqual(seen, headings, "one list in date order, the undated car last")
        let bottom = XCTAttachment(screenshot: app.screenshot()); bottom.name = "garage-cards-bottom"; bottom.lifetime = .keepAlways; add(bottom)
        for _ in 0..<14 where !(first.exists && first.isHittable) { app.swipeDown() }
        first.press(forDuration: 1.2)
        let log = app.buttons["Log book"].firstMatch
        XCTAssertTrue(log.waitForExistence(timeout: 5)); log.tap()
        XCTAssertTrue(app.staticTexts["Fixture note: rear end rebuilt over the winter."].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["2026-11-18 · owner · recollection"].waitForExistence(timeout: 5))
        let sheet = XCTAttachment(screenshot: app.screenshot()); sheet.name = "garage-log-book"; sheet.lifetime = .keepAlways; add(sheet)
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(first.waitForExistence(timeout: 5)); first.tap()
        let profile = app.descendants(matching: .any).matching(identifier: "garage.vehicle.profile.00000000-0000-4000-8000-00000000c101").firstMatch
        XCTAssertTrue(profile.waitForExistence(timeout: 10), "a card opens the actual vehicle profile")
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes", "reading the garage and its log book writes nothing")
    }

    func testSellerSourceSheetShowsConfigurationLimits() {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "visitor"]
        app.launchEnvironment["NUKE_FIXTURE_SCENARIO"] = "navigation-garage"
        app.launchEnvironment["NUKE_DEBUG_VEHICLE_ID"] = "00000000-0000-4000-8000-00000000c001"
        app.launch()
        let engine = app.staticTexts["350 V8 Crate"].firstMatch
        XCTAssertTrue(engine.waitForExistence(timeout: 15))
        engine.tap()
        XCTAssertTrue(app.staticTexts["What this establishes"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Source, Dealer seller listing · dealer_microdata_v2"].exists)
        app.swipeUp()
        for (label, expected) in [("Claim basis", "Seller Claim"), ("Factory configuration", "Unknown"), ("Current configuration", "Unknown")] {
            let row = app.descendants(matching: .any).matching(identifier: "claim.qualification.\(label)").firstMatch
            XCTAssertTrue(row.exists)
            let accessibleText = row.label + " " + (row.value as? String ?? "")
            XCTAssertTrue(accessibleText.contains(expected), "\(label) must retain \(expected): \(accessibleText)")
        }
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testExploreShowsPeopleWithoutRequiringVehicleResults() {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "visitor"]
        app.launchEnvironment["NUKE_FIXTURE_SCENARIO"] = "navigation-actors"
        app.launchEnvironment["NUKE_DEBUG_SCREEN"] = "explore"
        app.launchEnvironment["NUKE_DEBUG_EXPLORE_QUERY"] = "fixture person"
        app.launch()
        let person = app.staticTexts["Fixture Person"].firstMatch
        XCTAssertTrue(person.waitForExistence(timeout: 12), "a people-only search was incorrectly hidden by the vehicle empty state")
        XCTAssertFalse(app.staticTexts["No matches"].exists)
        person.tap()
        let back = app.navigationBars.buttons["Explore"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 10), "a person must open within Explore's navigation stack")
        back.tap()
        XCTAssertTrue(person.waitForExistence(timeout: 5), "returning must preserve the search results")
    }

    /// The first-launch welcome (rooted directly; fixture launches skip it in the real root so
    /// every other test still opens on what it expects). Four pages, then the way in.
    func testWelcomeShowsFourPagesThenTheWayIn() {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "visitor"]
        app.launchEnvironment["NUKE_FIXTURE_SCENARIO"] = "navigation-garage"
        app.launchEnvironment["NUKE_DEBUG_SCREEN"] = "welcome"
        app.launch()
        XCTAssertTrue(app.staticTexts["Find work near you."].waitForExistence(timeout: 12))
        XCTAssertTrue(app.staticTexts["LinkedIn plus Uber for car guys."].exists)
        XCTAssertFalse(app.buttons["welcome.lookAround"].exists, "the way in comes on the last page")
        let next = app.buttons["welcome.next"]
        XCTAssertTrue(next.waitForExistence(timeout: 5))
        for (n, headline) in ["Show off your work.", "Hire a tech.", "See what cars really sell for."].enumerated() {
            // The dots say which page is showing; the headline must be on screen too.
            let dots = app.descendants(matching: .any)["Page \(n + 2) of 4"]
            let target = app.staticTexts[headline]
            next.tap()
            if !(dots.waitForExistence(timeout: 5) && target.waitForExistence(timeout: 5)) {
                // Next did not turn the page. Find out whether a second tap or a swipe does,
                // and put the accessibility tree on ONE line (CI only keeps "error:" lines).
                let tree = app.debugDescription.replacingOccurrences(of: "\n", with: " | ")
                next.tap()
                let retried = target.waitForExistence(timeout: 5)
                var swiped = false
                if !retried {
                    app.swipeLeft()
                    swiped = target.waitForExistence(timeout: 5)
                }
                XCTFail("Next did not advance to \(headline) (second tap \(retried ? "worked" : "failed"), swipe \(swiped ? "worked" : "not needed/failed")). TREE: \(String(tree.prefix(5000)))")
                return
            }
        }
        XCTAssertTrue(app.buttons["welcome.lookAround"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Get started"].exists, "one clear primary: Get started, via Sign in with Apple")
        XCTAssertTrue(app.buttons["Look around first"].exists)
        XCTAssertTrue(app.buttons["welcome.email"].exists)
        XCTAssertTrue(app.buttons["welcome.apple"].exists || app.buttons["Sign in with Apple"].exists)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "welcome-last-page"; shot.lifetime = .keepAlways; add(shot)
    }
}
