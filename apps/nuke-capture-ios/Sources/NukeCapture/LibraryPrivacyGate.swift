// LibraryPrivacyGate.swift — whether the Library may paint a photo's pixels, decided in one place.
//
// The Library used to hide a photo only when the on-device pass had already called it "personal"
// (a prominent face and no vehicle). Everything else painted, which failed OPEN in four ways:
//   • a cell painted before its verdict arrived, and a photo that could not be read (iCloud-only,
//     a failed face detector) never got one, so it stayed visible for good;
//   • a document the device itself withholds from upload as sensitive (an ID, a title, a receipt)
//     was only softened as clutter, never blacked out;
//   • the server's own privacy verdicts (is_sensitive, rejected_personal, private document
//     categories) were never consulted, so a photo the server hides from everyone else still
//     showed in its owner's Library with no cover;
//   • the fullscreen pager ignored every verdict and painted the original.
//
// The rule now FAILS CLOSED: pixels paint only for a photo that is positively clear. Any block
// signal, or no verdict at all, keeps the pixels off the screen until the owner reveals that photo.
// The owner's explicit Approve (the Select tool) is the one thing that clears a blocked photo,
// because it is a deliberate statement about their own photo on their own phone.

import Foundation
import SwiftUI

/// What the Library may show for one photo.
enum LibraryPixelVerdict: Equatable {
    /// Positively read and nothing blocks it: paint the pixels.
    case clear
    /// At least one block signal is set: never paint the pixels unless the owner reveals them.
    case blocked(reason: String)
    /// No verdict yet (not read, unreadable, or a failed read): treated like blocked.
    case unchecked

    var paintsPixels: Bool { self == .clear }

    /// Short words for the cover and the accessibility label.
    var coverText: String {
        switch self {
        case .clear: return ""
        case .blocked(let reason): return reason
        case .unchecked: return "Not checked yet"
        }
    }
}

/// What the phone itself read from the photo.
struct LibraryDeviceRead: Equatable {
    var isPersonal: Bool          // the stored grid verdict: a prominent face, no work context
    var hasPerson: Bool
    var labels: [String]          // top on-device labels, confidence-descending
    var isScreenshot: Bool = false
}

enum LibraryPrivacyGate {
    /// One decision for every Library surface (grid, day drill, album drill, fullscreen pager).
    /// - ownerApproved: true = the owner approved this photo, false = the owner hid it, nil = no verdict.
    /// - serverBlockReason: the server's privacy verdict for this photo, nil when it has none.
    /// - device: the on-device read, nil when the photo has not been read (or could not be).
    static func verdict(ownerApproved: Bool?, serverBlockReason: String?, device: LibraryDeviceRead?) -> LibraryPixelVerdict {
        if ownerApproved == false { return .blocked(reason: "Hidden by you") }
        if ownerApproved == true { return .clear }
        if let serverBlockReason { return .blocked(reason: serverBlockReason) }
        guard let device else { return .unchecked }
        if device.isPersonal { return .blocked(reason: "Personal photo") }
        // The device's own sensitive-document rule (the same one that keeps these pixels from
        // uploading): an ID, a title, a receipt or any paper in the top labels.
        let scored = device.labels.map { ($0, Float(1)) }
        if let clutter = VisionDecision.clutter(labels: scored, isScreenshot: device.isScreenshot),
           clutter.category == .sensitive {
            return .blocked(reason: clutter.reason == "id_document" ? "ID document" : "Document")
        }
        return .clear
    }

    /// The server's privacy fields for one of the owner's photos, reduced to a cover reason.
    /// nil = the server does not block it. Wrong-vehicle and review states are filing questions,
    /// not privacy, so they do not block here.
    static func serverBlockReason(isSensitive: Bool?, sensitiveType: String?, visionGateStatus: String?,
                                  isDocument: Bool?, docFlag: Bool?, documentCategory: String?) -> String? {
        if isSensitive == true {
            switch sensitiveType?.lowercased() {
            case "child": return "Child in photo"
            case "id_document": return "ID document"
            case "title": return "Title document"
            case "document": return "Private document"
            default: return "Private photo"
            }
        }
        if visionGateStatus == "rejected_personal" { return "Personal photo" }
        if isDocument == true || docFlag == true {
            // Factory references read as vehicle evidence; every other paper (including an unnamed
            // one) stays covered until the owner says otherwise.
            let reference: Set<String> = ["manual", "window_sticker", "build_sheet", "service_parts_id"]
            if let c = documentCategory?.lowercased(), reference.contains(c) { return nil }
            switch documentCategory?.lowercased() {
            case "title": return "Title document"
            case "registration": return "Registration"
            case "insurance": return "Insurance document"
            case "receipt", "invoice": return "Receipt"
            default: return "Document"
            }
        }
        return nil
    }
}

/// One of the owner's photos the server flags, as read for the Library cover.
private struct LibraryServerPrivacyRow: Decodable {
    let local_id: String?
    let is_sensitive: Bool?
    let sensitive_type: String?
    let vision_gate_status: String?
    let is_document: Bool?
    let doc_flag: Bool?
    let document_category: String?
}

/// The server's privacy verdicts for the signed-in owner's own photos, keyed by the PHAsset
/// localIdentifier the app stamps into exif_data.uuid. Fetched in pages on Library open and kept
/// on disk per account, so a cold, offline launch still covers what the server already flagged.
@MainActor
final class LibraryServerPrivacy: ObservableObject {
    static let shared = LibraryServerPrivacy()

    @Published private(set) var reasons: [String: String] = [:]
    @Published private(set) var lastRefreshed: Date?
    private var loadedFor: String?
    private var refreshing = false

    func reason(for localIdentifier: String) -> String? { reasons[localIdentifier] }

    /// Load the cached set for this account, then refresh it from the server.
    func refresh() async {
        guard let uid = SupabaseService.currentUserId else {
            reasons = [:]; loadedFor = nil
            return
        }
        if loadedFor != uid {
            reasons = Self.loadCache(userId: uid)
            loadedFor = uid
        }
        guard !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        guard let fresh = await Self.fetch(userId: uid), SupabaseService.currentUserId == uid else { return }
        reasons = fresh
        lastRefreshed = Date()
        Self.saveCache(fresh, userId: uid)
    }

    /// nil = could not read (offline, signed out): keep the cached set rather than clearing it.
    nonisolated private static func fetch(userId: String) async -> [String: String]? {
        var out: [String: String] = [:]
        let page = 1000
        var from = 0
        do {
            while from < 20_000 {
                let rows: [LibraryServerPrivacyRow] = try await SupabaseService.client.from("vehicle_images")
                    .select("local_id:exif_data->>uuid,is_sensitive,sensitive_type,vision_gate_status,is_document,doc_flag,document_category")
                    .eq("user_id", value: userId)
                    .or("is_sensitive.is.true,vision_gate_status.eq.rejected_personal,is_document.is.true,doc_flag.is.true")
                    .order("id", ascending: true)
                    .range(from: from, to: from + page - 1)
                    .execute().value
                for r in rows {
                    guard let lid = r.local_id, !lid.isEmpty,
                          let reason = LibraryPrivacyGate.serverBlockReason(isSensitive: r.is_sensitive, sensitiveType: r.sensitive_type,
                              visionGateStatus: r.vision_gate_status, isDocument: r.is_document, docFlag: r.doc_flag,
                              documentCategory: r.document_category) else { continue }
                    // A photo uploaded twice keeps the first block reason it was given.
                    if out[lid] == nil { out[lid] = reason }
                }
                if rows.count < page { break }
                from += page
            }
        } catch {
            NSLog("LibraryServerPrivacy.fetch failed: %@", String(describing: error))
            return nil
        }
        return out
    }

    nonisolated private static func cacheURL(userId: String) -> URL? {
        let fm = FileManager.default
        guard let base = try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true) else { return nil }
        let safe = userId.lowercased().filter { $0.isLetter || $0.isNumber || $0 == "-" }
        return base.appendingPathComponent("library-server-privacy-\(safe).json")
    }

    nonisolated private static func loadCache(userId: String) -> [String: String] {
        guard let url = cacheURL(userId: userId), let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode([String: String].self, from: data) else { return [:] }
        return decoded
    }

    nonisolated private static func saveCache(_ reasons: [String: String], userId: String) {
        guard let url = cacheURL(userId: userId), let data = try? JSONEncoder().encode(reasons) else { return }
        try? data.write(to: url, options: [.atomic, .completeFileProtection])
    }
}

/// The cover drawn instead of a photo the gate keeps off the screen. No pixels of the photo.
struct LibraryPrivacyCover: View {
    let verdict: LibraryPixelVerdict
    var black: Bool
    var compact: Bool = true

    var body: some View {
        ZStack {
            if black { Color.black } else { Color(.systemGray5) }
            VStack(spacing: 4) {
                Image(systemName: verdict == .unchecked ? "hourglass" : "eye.slash")
                    .font(compact ? .caption : .title2)
                if !compact {
                    Text(verdict.coverText).font(.subheadline.weight(.semibold))
                }
            }
            .foregroundStyle(black ? Color.white.opacity(0.6) : Color.secondary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Photo covered: \(verdict.coverText)")
    }
}
