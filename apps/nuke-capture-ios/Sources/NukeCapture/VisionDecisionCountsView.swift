// VisionDecisionCountsView.swift: counts by filter reason from the on-device decision log.
// "Rejected as not work-related" and "Withheld as sensitive" are separate sections.

import SwiftUI

struct VisionDecisionCountsView: View {
    var log: VisionDecisionLog = .shared
    @State private var counts: [VisionDecisionCount] = []
    @State private var uploaded: Int?
    @AppStorage(VisionRejectUpload.enabledKey) private var uploadEnabled = false

    private static let sections: [(String, String)] = [
        ("work", "Kept as work"),
        ("work_with_people", "Work with people in frame (metadata only, pixels stay on phone)"),
        ("not_work", "Rejected as not work-related"),
        ("sensitive", "Withheld as sensitive (never uploaded)"),
        ("gate", "Upload gates (location, site, camera)"),
    ]

    var body: some View {
        List {
            ForEach(Self.sections, id: \.0) { key, title in
                let rows = counts.filter { $0.category == key }
                Section("\(title): \(rows.reduce(0) { $0 + $1.count })") {
                    if rows.isEmpty { Text("None logged").foregroundStyle(.secondary) }
                    ForEach(rows) { r in
                        HStack { Text(r.reason.replacingOccurrences(of: "_", with: " ")); Spacer()
                            Text("\(r.count)").monospacedDigit() }
                    }
                }
            }
            Section {
                Toggle("Share reject metadata (ids and labels, no photos, no sensitive rows)", isOn: $uploadEnabled)
                Button("Send reject metadata now") {
                    Task { uploaded = await VisionRejectUpload.uploadIfEnabled(log: log) }
                }.disabled(!uploadEnabled)
                if let uploaded { Text("Sent \(uploaded) rows.").font(.footnote).foregroundStyle(.secondary) }
            } footer: {
                Text("Off by default. Counts come from this phone's log only.")
            }
        }
        .navigationTitle("Photo filter")
        .onAppear { counts = log.counts() }
        .refreshable { counts = log.counts() }
    }
}
