// GarageReaders.swift — the signed-in owner's garage, read the way the web reads it.
//
// The list is get_user_garage folded with the account's own statements
// (get_my_garage_owner_corrections), the fold the web's useVehiclesDashboard applies; ProfileView
// and GarageView share this one call. my_unorganized_photo_count is the web's inbox badge
// (MobileBottomNav): the account's uploads with no vehicle and not organized, counted to 1,000.
// vehicle_row_read is the web's whole-row read (purchase facts masked for non-insiders); the garage
// decodes only identity, visibility, removal and merge from it.
//
// my_vehicles is not read: as of 2026-10-19 no work_record observation carries an observer, so it
// is empty for every account, and its plan aggregates every vehicle's sale handle before joining,
// so it runs past the statement timeout. It returns here when the server repairs both.

import Foundation
import Supabase

/// The account's uploads still waiting for a vehicle, as my_unorganized_photo_count states them.
struct UnorganizedPhotos: Equatable {
    /// The reader stops counting here, so a count at the cap means "at least this many".
    static let cap = 1000

    let count: Int
    let readAt: Date

    var atCap: Bool { count >= Self.cap }
    var value: String { atCap ? "\(Self.cap.formatted())+" : count.formatted() }
    var coverage: String {
        "your uploads from any source, counted to \(Self.cap.formatted()) · as of \(readAt.formatted(date: .omitted, time: .shortened))"
    }
}

/// The columns of vehicle_row_read the garage shows. Every other column is ignored.
struct GarageVehicleRow: Decodable, Equatable {
    let id: String
    let year: Int?
    let make: String?
    let model: String?
    let normalized_model: String?
    let trim: String?
    let is_public: Bool?
    let deleted_at: String?
    let merged_into_vehicle_id: String?

    var title: String {
        let normalized = normalized_model?.trimmingCharacters(in: .whitespaces)
        return [year.map(String.init), make, normalized?.isEmpty == false ? normalized : model, trim]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// The server treats a missing flag as not public (coalesce(is_public, false)).
    var isPublic: Bool { is_public == true }
}

/// The owner's garage as the server states it, with the account statements already folded in.
struct OwnGarage {
    let vehicles: [GarageVehicle]
    let unresolved: [GarageUnresolvedSource]
}

enum GarageReaders {
    static let garageName = "get_user_garage"
    static let correctionsName = "get_my_garage_owner_corrections"
    static let unorganizedName = "my_unorganized_photo_count"
    static let vehicleRowName = "vehicle_row_read"

    static func unorganizedPhotos(now: Date = Date()) async -> JobLoad<UnorganizedPhotos> {
        do {
            let data = try await SupabaseService.client.rpc(unorganizedName).execute().data
            return unorganizedLoad(from: data, readAt: now)
        } catch {
            NSLog("NukeCapture %@ failed: %@", unorganizedName, String(describing: error))
            return .refused(JobReaders.refusal(unorganizedName, error))
        }
    }

    static func vehicleRow(vehicleId: String) async -> JobLoad<GarageVehicleRow> {
        do {
            let data = try await SupabaseService.client.rpc(vehicleRowName, params: ["p_vehicle_id": vehicleId]).execute().data
            return vehicleRowLoad(from: data)
        } catch {
            NSLog("NukeCapture %@ failed: %@", vehicleRowName, String(describing: error))
            return .refused(JobReaders.refusal(vehicleRowName, error))
        }
    }

    /// The owner's own reader. Only the signed-in account's statements are folded in.
    static func ownGarage(userId: String) async throws -> OwnGarage {
        async let legacyRows: [GarageVehicle] = SupabaseService.client
            .rpc(garageName, params: ["p_user_id": userId])
            .execute()
            .value
        async let correctionRows = ownCorrections(userId: userId)
        var rows = try await legacyRows
        let corrections = try await correctionRows
        let unresolved = GarageUnresolvedSource.from(corrections)
        let ids = Array(Set(rows.map(\.vehicle_id) + corrections.compactMap(\.vehicle_id)))
        if !ids.isEmpty {
            let metadata: [Metadata] = try await SupabaseService.client.from("vehicles")
                .select("id,year,make,model,normalized_model,trim,vin,primary_image_url,image_count")
                .in("id", values: ids).execute().value
            rows = merging(metadata, into: rows)
        }
        return OwnGarage(vehicles: GarageVehicle.applying(corrections, to: rows), unresolved: unresolved)
    }

    // MARK: Pure parts (unit-tested)

    struct Metadata: Decodable {
        let id: String
        let year: Int?
        let make: String?
        let model: String?
        let normalized_model: String?
        let trim: String?
        let vin: String?
        let primary_image_url: String?
        let image_count: Int?
    }

    /// A vehicle named only by an account statement joins as relationship_review; every row takes
    /// the record's VIN and normalized model.
    static func merging(_ metadata: [Metadata], into rows: [GarageVehicle]) -> [GarageVehicle] {
        var rows = rows
        let byID = Dictionary(metadata.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let present = Set(rows.map(\.vehicle_id))
        for m in metadata where !present.contains(m.id) {
            rows.append(GarageVehicle(vehicle_id: m.id, year: m.year, make: m.make,
                model: m.normalized_model ?? m.model, trim_name: m.trim, image_url: m.primary_image_url,
                current_value: nil, image_count: m.image_count ?? 0, relationship: "relationship_review", vin: m.vin))
        }
        for index in rows.indices {
            if let m = byID[rows[index].id] {
                rows[index].vin = m.vin
                let normalized = m.normalized_model?.trimmingCharacters(in: .whitespaces)
                rows[index].model = normalized?.isEmpty == false ? normalized : m.model
            }
        }
        return rows
    }

    static func unorganizedLoad(from data: Data, readAt: Date) -> JobLoad<UnorganizedPhotos> {
        do {
            return .loaded(UnorganizedPhotos(count: try JobReaders.decode(Int.self, from: data), readAt: readAt))
        } catch {
            return .refused(JobRefusal(reader: unorganizedName, kind: .failed, title: "Couldn't count your photos",
                                       detail: "The answer wasn't a number this version can read."))
        }
    }

    /// vehicle_row_read answers null for a vehicle that doesn't exist or isn't shared with the viewer.
    static func vehicleRowLoad(from data: Data) -> JobLoad<GarageVehicleRow> {
        let unavailable = JobRefusal(reader: vehicleRowName, kind: .unavailable, title: "Vehicle not available",
                                     detail: "It doesn't exist, or it isn't shared with you.")
        let body = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        if body.isEmpty || body == "null" { return .refused(unavailable) }
        do {
            return .loaded(try JobReaders.decode(GarageVehicleRow.self, from: data))
        } catch {
            return .refused(JobRefusal(reader: vehicleRowName, kind: .failed, title: "Couldn't read this vehicle",
                                       detail: "The answer was in a shape this version can't read."))
        }
    }

    private static func ownCorrections(userId: String) async throws -> [GarageOwnerCorrection] {
        guard SupabaseService.currentUserId == userId.lowercased() else { return [] }
        return try await SupabaseService.client.rpc(correctionsName, params: ["p_include_unresolved": true]).execute().value
    }
}
