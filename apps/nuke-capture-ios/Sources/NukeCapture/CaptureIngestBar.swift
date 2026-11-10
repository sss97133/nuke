// CaptureIngestBar.swift — the slim live ingest status bar pinned to the top of the app.
//
// One line of plain words ("12 uploaded · 9 classified · 9 on 1973 Firebird · 1 failed"). Tap it and
// it opens a list: one entry per photo with where it is, plus a live line of what the app is doing
// with it right now. Hidden when there is nothing to show (and when the backend isn't there).
//
// While photo reading is moving or has stalled, the server's own headline leads the bar, and the
// bar shows for that alone. Opened, the reasons and the detail lines come first, before the photos.
// The words are the server's (PhotoReadingStatus.swift); nothing here rewrites them.

import SwiftUI

struct CaptureIngestBar: View {
    @ObservedObject var store: CaptureIngestStore
    @State private var expanded = false

    /// The reading takes the first line only while it is moving or has stalled.
    private var readingLeads: Bool { PhotoReadingWords.leads(store.reading) }
    /// The bar's warning look: a photo that failed, or photo reading that has stalled.
    private var warns: Bool { store.summary.failed > 0 || PhotoReadingWords.tone(store.reading) == .stalled }

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
                Image(systemName: headerSymbol)
                    .foregroundStyle(warns ? Color.orange : Color.accentColor)
                headerText
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
        .accessibilityLabel(headerLabel)
        .accessibilityHint(headerHint)
    }

    /// A warning is a different symbol as well as a different colour.
    private var headerSymbol: String {
        if warns { return "exclamationmark.circle.fill" }
        return store.rows.isEmpty ? "ellipsis.circle.fill" : "arrow.up.circle.fill"
    }

    @ViewBuilder private var headerText: some View {
        if readingLeads, let lead = PhotoReadingWords.headline(store.reading) {
            VStack(alignment: .leading, spacing: 2) {
                Text(lead)
                    .font(.headline)
                // The short line belongs to the closed bar; opened, the list below says it in full.
                if !expanded, let line = PhotoReadingWords.summary(store.reading) {
                    Text(line)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if !store.rows.isEmpty {
                    Text(store.summary.text)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                CaptureReadingCheckedLine(reading: store.reading)
            }
            .multilineTextAlignment(.leading)
            .lineLimit(3)
        } else {
            Text(store.summary.text)
                .font(.headline)
                .multilineTextAlignment(.leading)
                .lineLimit(3)
        }
    }

    private var headerLabel: String {
        guard readingLeads, let spoken = PhotoReadingWords.collapsed(store.reading) else { return store.summary.text }
        var parts = [spoken]
        if !store.rows.isEmpty { parts.append(store.summary.text) }
        if let checked = PhotoReadingWords.checkedAgo(store.reading) { parts.append(checked) }
        return parts.joined(separator: ". ")
    }

    private var headerHint: String {
        if store.rows.isEmpty { return expanded ? "Hides the details" : "Shows what photo reading is doing" }
        return expanded ? "Hides the photo list" : "Shows each photo and what is happening with it"
    }

    private var list: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                readingRows
                ForEach(store.rows) { row in
                    CaptureIngestRowView(row: row, names: store.vehicleNames)
                    Divider().padding(.leading, 16)
                }
                if !store.rows.isEmpty {
                    Button("Clear this list") {
                        expanded = false
                        store.clear()
                    }
                    .font(.body)
                    .padding(16)
                }
            }
        }
        .frame(maxHeight: 340)
    }

    /// Photo reading comes first: why it has stalled, then the detail lines. A reading that is only
    /// waiting or off never takes the header, so here it carries its own headline.
    @ViewBuilder private var readingRows: some View {
        let title = readingLeads ? nil : PhotoReadingWords.headline(store.reading)
        let reasons = PhotoReadingWords.reasons(store.reading)
        let lines = PhotoReadingWords.lines(store.reading)
        if title != nil || !reasons.isEmpty || !lines.isEmpty {
            CaptureReadingRowsView(title: title, reasons: reasons, lines: lines,
                                   stalled: PhotoReadingWords.tone(store.reading) == .stalled,
                                   checkedFrom: readingLeads ? nil : store.reading)
            Divider().padding(.leading, 16)
        }
    }
}

/// "Checked 14 min ago", shown once a reading is more than ten minutes old so a refresh that keeps
/// failing never looks live. Re-drawn once a minute; it reads nothing from the network.
struct CaptureReadingCheckedLine: View {
    let reading: PhotoReadingStatus?

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            if let checked = PhotoReadingWords.checkedAgo(reading, now: context.date) {
                Text(checked)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// The photo reading status inside the opened list, in the server's own sentences.
struct CaptureReadingRowsView: View {
    /// The headline, when the bar's header is not already showing it.
    let title: String?
    let reasons: [String]
    let lines: [String]
    let stalled: Bool
    /// The reading whose age to state here; nil when the header already states it.
    let checkedFrom: PhotoReadingStatus?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: stalled ? "exclamationmark.triangle.fill" : "ellipsis.circle")
                .font(.title3)
                .foregroundStyle(stalled ? Color.orange : Color.secondary)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
                if let title {
                    Text(title)
                        .font(.headline)
                }
                ForEach(Array(reasons.enumerated()), id: \.offset) { _, reason in
                    Text(reason)
                        .font(.subheadline)
                }
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    Text(line)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let checkedFrom {
                    CaptureReadingCheckedLine(reading: checkedFrom)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
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

/// The reading the bar shows, handed down so the profile's ingestion card states the same thing.
private struct PhotoReadingKey: EnvironmentKey {
    static let defaultValue: PhotoReadingStatus? = nil
}

extension EnvironmentValues {
    var photoReading: PhotoReadingStatus? {
        get { self[PhotoReadingKey.self] }
        set { self[PhotoReadingKey.self] = newValue }
    }
}
