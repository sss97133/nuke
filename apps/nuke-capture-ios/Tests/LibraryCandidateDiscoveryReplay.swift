import Foundation

private func photo(_ id: String, _ at: String?, _ labels: [String] = [], _ lat: Double? = nil,
                   _ lon: Double? = nil, _ exact: [String] = [], _ filed: String? = nil,
                   _ personal: Bool = false) -> LibraryCandidateDiscovery.Asset {
    .init(id: id, sourceVersion: "v1", captureAt: at, latitude: lat, longitude: lon,
          labels: labels, exactVehicleIds: exact, filedVehicleId: filed, isPersonal: personal,
          reviewSourceVersion: "v1")
}

@main struct ReplayTests {
    static func main() {
        let day = "2025-05-13T"
        let assets = [
            photo("0695", day + "17:47:00Z", ["car", "hood"], 34.10, -118.10, ["firebird"]),
            photo("0705", day + "21:34:00Z", ["paint", "hood"], 34.10, -118.10),
            photo("0706", day + "21:40:00Z", ["paper", "decal"]),
            photo("0708", day + "23:01:00Z", ["decal", "hood"]),
            photo("other_car", day + "21:35:00Z", ["car"], 34.10, -118.10, ["mustang"], "mustang"),
            photo("selfie", day + "21:36:00Z", ["portrait"], 34.10, -118.10, [], nil, true),
            photo("part_crop", day + "21:41:00Z", ["metal", "part"]),
            photo("unread", day + "21:42:00Z"),
            photo("old_day_work", "2025-04-24T15:00:00Z", ["upholstery", "carpet"]),
            photo("unknown_clock", nil),
        ]
        let input = LibraryCandidateDiscovery.Input(assets: assets, targetVehicleId: "firebird", timeZoneIdentifier: "America/Los_Angeles")
        let result = LibraryCandidateDiscovery.discover(input)
        let ids = Set(result.candidates.map(\.id))
        precondition(["0695", "0705", "0706", "0708", "part_crop", "other_car", "selfie"].allSatisfy(ids.contains))
        precondition(!ids.contains("old_day_work") && !ids.contains("unknown_clock"))
        precondition(result.workPool.contains { $0.id == "old_day_work" })
        precondition(result.unplaced.contains { $0.id == "unread" })
        precondition(result.unplaced.contains { $0.id == "unknown_clock" })
        precondition(result.candidates.first { $0.id == "0706" }!.reasons.contains(.missingGPS))
        precondition(result.candidates.first { $0.id == "other_car" }!.conflictingVehicleIds == ["mustang"])
        precondition(result.candidates.first { $0.id == "selfie" }!.reasons.contains(.personal))
        precondition(result.candidates == LibraryCandidateDiscovery.discover(input).candidates)

        let noAnchor = LibraryCandidateDiscovery.discover(.init(assets: assets, targetVehicleId: "none", timeZoneIdentifier: "UTC"))
        precondition(noAnchor.candidates.isEmpty && noAnchor.workPool.contains { $0.id == "old_day_work" })
        let seeded = LibraryCandidateDiscovery.discover(.init(assets: assets, targetVehicleId: "none",
            timeZoneIdentifier: "America/Los_Angeles", seedAssetIds: ["0705"]))
        precondition(seeded.candidates.contains { $0.id == "0706" })
        let seedOnly = LibraryCandidateDiscovery.discover(.init(assets: assets,
            targetVehicleId: "firebird", timeZoneIdentifier: "America/Los_Angeles", seedAssetIds: ["old_day_work"]))
        precondition(seedOnly.candidates.contains { $0.id == "old_day_work" })
        precondition(!seedOnly.candidates.contains { $0.id == "0695" })
        let metadataOnly = assets.map { asset -> LibraryCandidateDiscovery.Asset in
            var copy = asset; copy.labels = []; copy.exactVehicleIds = []; copy.filedVehicleId = nil
            return copy
        }
        let noVision = LibraryCandidateDiscovery.discover(.init(assets: metadataOnly,
            targetVehicleId: "firebird", timeZoneIdentifier: "America/Los_Angeles", seedAssetIds: ["0705"]))
        precondition(noVision.workPool.isEmpty)
        precondition(noVision.candidates.contains { $0.id == "0706" && $0.reasons.contains(.missingGPS) })
        precondition(noVision.candidates.contains { $0.id == "0708" && $0.reasons.contains(.missingGPS) })
        let removed = LibraryCandidateDiscovery.discover(.init(assets: assets.filter { $0.id != "0706" },
            targetVehicleId: "firebird", timeZoneIdentifier: "America/Los_Angeles"))
        precondition(!removed.candidates.contains { $0.id == "0706" } && !removed.unplaced.contains { $0.id == "0706" })

        var stale = photo("stale", day + "21:43:00Z", ["decal"])
        stale.sourceVersion = "new_bytes"
        stale.reviewSourceVersion = "old_bytes"
        let staleResult = LibraryCandidateDiscovery.discover(.init(assets: assets + [stale],
            targetVehicleId: "firebird", timeZoneIdentifier: "America/Los_Angeles"))
        precondition(!staleResult.workPool.contains { $0.id == "stale" })
        precondition(staleResult.unplaced.first { $0.id == "stale" }!.reasons.contains(.noCurrentRead))
        // A recorded association to another vehicle remains a visible conflict control, even
        // when its status may be partial or disputed. It is never counted as Firebird filing.
        precondition(staleResult.candidates.first { $0.id == "other_car" }!.reasons.contains(.filedOther))
        let disputed = photo("disputed", day + "21:50:00Z", ["interior"], nil, nil, ["firebird"], "mustang")
        let disputeResult = LibraryCandidateDiscovery.discover(.init(assets: assets + [disputed],
            targetVehicleId: "firebird", timeZoneIdentifier: "America/Los_Angeles"))
        precondition(disputeResult.unplaced.contains { $0.id == "disputed" })
        let untargeted = LibraryCandidateDiscovery.discover(.init(assets: assets + [disputed],
            targetVehicleId: "", timeZoneIdentifier: "America/Los_Angeles", seedAssetIds: ["0705"]))
        precondition(untargeted.unplaced.first { $0.id == "0695" }!.reasons.contains(.exactSerial))
        precondition(!untargeted.unplaced.first { $0.id == "0695" }!.reasons.contains(.conflictingIdentity))
        precondition(untargeted.unplaced.first { $0.id == "disputed" }!.reasons.contains(.conflictingIdentity))
        var history = photo("history", day + "21:55:00Z")
        history.recordedVehicleIds = ["mustang", "firebird"]
        let historyResult = LibraryCandidateDiscovery.discover(.init(assets: assets + [history],
            targetVehicleId: "firebird", timeZoneIdentifier: "America/Los_Angeles"))
        let historicControl = historyResult.unplaced.first { $0.id == "history" }!
        precondition(historicControl.reasons.contains(.existingBinding))
        precondition(historicControl.reasons.contains(.conflictingIdentity))
        precondition(historicControl.conflictingVehicleIds == ["mustang"])
        let midnight = photo("midnight", "2025-05-14T00:20:00Z")
        let midnightResult = LibraryCandidateDiscovery.discover(.init(assets: assets + [midnight],
            targetVehicleId: "firebird", timeZoneIdentifier: "UTC", seedAssetIds: ["0708"]))
        precondition(midnightResult.candidates.contains { $0.id == "midnight" })
        let sameAt = "2025-05-13T21:40:00Z"
        let tied = LibraryCandidateDiscovery.discover(.init(assets: [
            photo("same-anchor", sameAt, [], nil, nil, ["firebird"]),
            photo("same-A", sameAt), photo("same-B", sameAt)],
            targetVehicleId: "firebird", timeZoneIdentifier: "UTC"))
        precondition(Set(tied.candidates.map(\.id)) == ["same-anchor", "same-A", "same-B"])
        print("Library candidate replay checks passed")
    }
}
