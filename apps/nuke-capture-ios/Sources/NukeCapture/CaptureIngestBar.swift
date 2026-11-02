// CaptureIngestBar.swift — the slim live ingest status bar pinned to the top of the app.
//
// One line of plain words ("12 uploaded · 9 classified · 9 on 1973 Firebird · 1 failed"). Tap it and
// it opens a list: one entry per photo with where it is, plus a live line of what the app is doing
// with it right now. Hidden when there is nothing to show (and when the backend isn't there).

import SwiftUI

struct CaptureIngestBar: View {
    @ObservedObject var store: CaptureIngestStore
    @State private var expanded = false

    var body: some View {
        if !store.isHidden {
            VStack(spacing: 0) {
                header
                if expanded { list }
            }
            .background(.regularMaterial)
            .overlay(alignment: .bottom) { Divider() }
            .accessibilityIdentifier("captureIngestBar")
            .animation(.easeInOut(duration: 0.2), value: expanded)
        }
    }

    private var header: some View {
        Button { expanded.toggle() } label: {
            HStack(spacing: 10) {
                Image(systemName: store.summary.failed > 0 ? "exclamationmark.circle.fill" : "arrow.up.circle.fill")
                    .foregroundStyle(store.summary.failed > 0 ? Color.orange : Color.accentColor)
                Text(store.summary.text)
                    .font(.headline)
                    .multilineTextAlignment(.leading)
                    .lineLimit(3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: expanded ? "chevron.up" : "chevron.down")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(store.summary.text)
        .accessibilityHint(expanded ? "Hides the photo list" : "Shows each photo and what is happening with it")
    }

    private var list: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(store.rows) { row in
                    CaptureIngestRowView(row: row, names: store.vehicleNames)
                    Divider().padding(.leading, 16)
                }
                Button("Clear this list") {
                    expanded = false
                    store.clear()
                }
                .font(.body)
                .padding(16)
            }
        }
        .frame(maxHeight: 340)
    }
}

struct CaptureIngestRowView: View {
    let row: CaptureUploadRow
    let names: [String: String]

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(tint)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.stageLabel(names: names))
                    .font(.headline)
                Text(row.liveLine(names: names))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }

    private var symbol: String {
        if row.stage == .failed { return "exclamationmark.triangle.fill" }
        if row.isOnVehicle { return "checkmark.circle.fill" }
        switch row.stage {
        case .uploaded: return "arrow.up.circle"
        case .classifying, .working: return "ellipsis.circle"
        case .classified, .attached: return "checkmark.circle"
        case .failed: return "exclamationmark.triangle.fill"
        }
    }

    private var tint: Color {
        if row.stage == .failed { return .orange }
        return row.isOnVehicle ? .green : .secondary
    }
}
