// JobStageRail.swift — seven stages on the one trust ladder.
//
// Stage state → RootStatus (R4 §2, THEORY §7):
//   recorded     → .attributed   the reader's state_basis is "not verified truth", never .proven
//   partial      → .pending
//   status_only  → .recorded     dim: a status with no clock or record beneath it
//   absent       → no rung       no value row; the stage's gaps are listed instead
//   any inconsistency → .conflicting, whatever the state
// .proven is reserved for authenticated signatures; no stage state reaches it.

import SwiftUI

enum JobRung {
    /// nil means "no value row": the stage is absent and only its gaps render.
    static func status(_ state: JobStageState, hasInconsistency: Bool) -> RootStatus? {
        if hasInconsistency { return .conflicting }
        switch state {
        case .recorded: return .attributed
        case .partial: return .pending
        case .statusOnly: return .recorded
        case .absent, .withheld: return nil
        case .unknown: return .recorded
        }
    }

    static func status(_ stage: JobStage) -> RootStatus? {
        status(stage.state, hasInconsistency: !stage.inconsistencies.isEmpty)
    }
}

/// One dot per stage, intake → accounting. A stage the reader did not send renders dotted.
struct JobStageRail: View {
    struct Dot: Identifiable, Equatable {
        let key: JobStageKey
        let state: JobStageState?
        let conflicting: Bool
        var id: String { key.rawValue }
    }

    let dots: [Dot]
    var compact = false

    init(path: JobPath, compact: Bool = false) {
        dots = JobStageKey.allCases.map { k in
            let s = path.stages[k]
            return Dot(key: k, state: s?.state, conflicting: !(s?.inconsistencies.isEmpty ?? true))
        }
        self.compact = compact
    }

    init(states: [JobStageKey: JobStageState], compact: Bool = true) {
        dots = JobStageKey.allCases.map { Dot(key: $0, state: states[$0], conflicting: false) }
        self.compact = compact
    }

    var body: some View {
        HStack(spacing: compact ? 6 : 2) {
            ForEach(dots) { dot in
                VStack(spacing: 3) {
                    Image(systemName: Self.symbol(dot))
                        .font(compact ? .caption2 : .footnote)
                        .foregroundStyle(Self.color(dot))
                    Text(compact ? dot.key.initial : dot.key.shortTitle)
                        .font(compact ? .system(size: 8, design: .monospaced) : .system(size: 9))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
                .frame(maxWidth: compact ? nil : .infinity)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(dot.key.title): \(Self.spoken(dot))")
            }
        }
    }

    static func symbol(_ dot: Dot) -> String {
        guard let state = dot.state else { return "circle.dotted" }
        if state == .withheld { return "lock.circle" }
        switch JobRung.status(state, hasInconsistency: dot.conflicting) {
        case .attributed?: return "circle.fill"
        case .pending?: return "circle.lefthalf.filled"
        case .recorded?: return "circle.fill"
        case .conflicting?: return "exclamationmark.circle.fill"
        default: return "circle"
        }
    }

    static func color(_ dot: Dot) -> Color {
        guard let state = dot.state else { return Color(.tertiaryLabel) }
        switch JobRung.status(state, hasInconsistency: dot.conflicting) {
        case .attributed?, .pending?: return .primary
        case .recorded?: return Color(.tertiaryLabel)
        case .conflicting?: return .orange
        default: return Color(.tertiaryLabel)
        }
    }

    static func spoken(_ dot: Dot) -> String {
        guard let state = dot.state else { return "not available" }
        let words = JobCopy.stateLine(state)
        return dot.conflicting ? "\(words), records disagree" : words
    }
}

/// The rail's legend, so a reader who learns one dot reads every dot.
struct JobStageRailLegend: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            row("circle.fill", .primary, "Recorded — not yet verified")
            row("circle.lefthalf.filled", .primary, "In progress")
            row("circle.fill", Color(.tertiaryLabel), "Marked, but no record behind it")
            row("circle", Color(.tertiaryLabel), "Not started")
            row("exclamationmark.circle.fill", .orange, "Records disagree")
            row("lock.circle", Color(.tertiaryLabel), "People on this job only")
            row("circle.dotted", Color(.tertiaryLabel), "Not available")
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
    }

    private func row(_ symbol: String, _ color: Color, _ text: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).foregroundStyle(color).frame(width: 14)
            Text(text)
        }
    }
}
