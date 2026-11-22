// NukeWorkActivity.swift — the Live Activity contract shared by the app and the widget extension.
//
// One activity: the photo work in motion (phone → server upload, then server analysis). The app
// starts, updates and ends it (WorkLiveActivityController); the extension only draws it
// (Widgets/NukeWorkLiveActivity.swift). Compiled into BOTH targets, so it carries no app types.
//
// Every number here is a count the app read from its own queue or from capture_upload_status rows.
// When the size of the job is unknown, `total` is nil and the views draw an indeterminate state;
// nothing is estimated to fill a gap.

import ActivityKit
import Foundation

struct NukeWorkAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        enum Phase: String, Codable, Hashable {
            /// Photos are leaving the phone.
            case uploading
            /// Uploaded photos are being read on the server.
            case analyzing
            /// Finished; shown briefly before the activity dismisses itself.
            case done
        }

        var phase: Phase
        /// Photos finished in this run (analysis: settled rows; upload: none counted, 0).
        var completed: Int
        /// The run's size when it is known; nil = indeterminate.
        var total: Int?
        /// Photos still to leave the phone (0 when none are owed).
        var toUpload: Int
        var failed: Int
        /// Minutes left, only from a measured upload rate. nil = no honest estimate.
        var etaMinutes: Int?
        /// Optional plain-words context ("on 1973 Firebird").
        var detail: String?

        var fraction: Double? {
            guard let total, total > 0 else { return nil }
            return min(1, max(0, Double(completed) / Double(total)))
        }

        /// "Analyzing 12 / 40 photos", "Uploading 37 photos", "Done · 40 photos read".
        var headline: String {
            switch phase {
            case .analyzing:
                if let total { return "Analyzing \(NukeWorkFormat.count(completed)) / \(NukeWorkFormat.count(total)) photos" }
                return "Analyzing photos"
            case .uploading:
                return toUpload > 0 ? "Uploading \(NukeWorkFormat.count(toUpload)) \(toUpload == 1 ? "photo" : "photos")" : "Uploading photos"
            case .done:
                let n = total ?? completed
                if n > 0 { return "Done · \(NukeWorkFormat.count(n)) \(n == 1 ? "photo" : "photos")" }
                return "Done"
            }
        }

        /// The secondary line under the headline: failures, owed uploads, ETA, context. nil when nothing to add.
        var subline: String? {
            var parts: [String] = []
            if phase == .analyzing, toUpload > 0 { parts.append("\(NukeWorkFormat.count(toUpload)) more to upload") }
            if let etaMinutes, phase == .uploading { parts.append(NukeWorkFormat.eta(etaMinutes)) }
            if failed > 0 { parts.append("\(NukeWorkFormat.count(failed)) failed") }
            if let detail, !detail.isEmpty { parts.append(detail) }
            return parts.isEmpty ? nil : parts.joined(separator: " · ")
        }

        /// The compact trailing text: percent when the size is known, else the owed count, else nothing.
        var compactValue: String? {
            if phase == .done { return nil }
            if let fraction { return "\(Int((fraction * 100).rounded(.down)))%" }
            if toUpload > 0 { return NukeWorkFormat.short(toUpload) }
            return nil
        }
    }

    /// Fixed for the activity's life: what kind of work it follows.
    var kind: String = "photos"
}

enum NukeWorkFormat {
    /// The tap target: opens the app on the per-photo list (MainTabView handles the host).
    static let deepLink = URL(string: "ag.nuke.capture://work-progress")!
    static let deepLinkHost = "work-progress"

    static func count(_ n: Int) -> String { n.formatted(.number.grouping(.automatic)) }

    /// Compact-width count: 1240 → "1.2k".
    static func short(_ n: Int) -> String {
        if n < 1000 { return "\(n)" }
        if n < 10_000 { return String(format: "%.1fk", Double(n) / 1000) }
        return "\(n / 1000)k"
    }

    static func eta(_ minutes: Int) -> String {
        if minutes < 1 { return "under a minute left" }
        if minutes < 60 { return "about \(minutes) min left" }
        let h = minutes / 60, m = minutes % 60
        return m == 0 ? "about \(h) h left" : "about \(h) h \(m) min left"
    }
}
