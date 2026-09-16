// RootedValue.swift — the single nerve ending of the whole system.
//
// One primitive renders EVERY value in the app: a spec, a dollar in the ledger,
// a market estimate, a photo's detected intent, a day on the timeline. It shows
// the value, a trust glyph placing it on ONE universal ladder, and (when the atom
// carries a date) a freshness/decay line. A value with a real root beneath it
// drills to that root; a value without one renders honestly dim and REFUSES the
// tap — an empty/false drill is worse than honesty. The component renders only
// what it is given; it cannot invent an atom.
//
// This is the root-system contract made visual. Adopt it everywhere a value lives
// so a user who learns to read one row can read every row.

import SwiftUI
import UIKit

/// The trust ladder — one status vocabulary for every value, on every surface.
enum RootStatus {
    case proven        // owner-confirmed / receipted — the firmest rung
    case attributed    // sourced to a real observation/artifact, not yet owner-confirmed
    case projected     // modeled / estimated (comp value, unconfirmed labor)
    case pending       // a root may exist but isn't surfaced yet — drill says "tracing…"
    case conflicting   // observations disagree
    case refuted       // owner flagged wrong (superseded, never deleted)
    case facade        // NO root beneath it — renders dim, never drills

    /// The status glyph. nil → the row falls back to the plain drill chevron
    /// (pending) or to nothing (facade).
    var glyph: String? {
        switch self {
        case .proven:      return "checkmark.seal.fill"
        case .attributed:  return "checkmark.seal"
        case .projected:   return "hourglass"
        case .pending:     return nil
        case .conflicting: return "exclamationmark.2"
        case .refuted:     return "xmark"
        case .facade:      return nil
        }
    }

    var glyphColor: Color {
        switch self {
        case .proven:      return .green
        case .conflicting: return .orange
        case .refuted:     return .red
        default:           return .secondary
        }
    }

    /// The value's ink. Only a facade or a refuted claim is demoted off primary.
    var valueColor: Color {
        switch self {
        case .facade, .refuted: return .secondary
        default:                return .primary
        }
    }

    var strikethrough: Bool { self == .refuted }

    /// A facade has no root — it must NOT offer a drill that bottoms out in nothing.
    var isDrillable: Bool { self != .facade }

    /// The honest sub-label under a value when it isn't itself a dated fact.
    var subscriptLabel: String? { self == .facade ? "unverified" : nil }
}

/// The single rooted-atom row. secondary label · monospaced value · trust glyph ·
/// optional decay subscript · drill (or honest no-drill). Matches the spec-table
/// grammar exactly so adopting it anywhere is visually seamless.
struct RootedValueView: View {
    let label: String
    let value: String
    var status: RootStatus = .pending
    /// A freshness line shown under the value (a date, or "aged · <date>"). NEVER
    /// fabricated — pass it only when the atom genuinely carries an observed date.
    var decay: String? = nil
    var onDrill: (() -> Void)? = nil

    private var drillable: Bool { status.isDrillable && onDrill != nil }

    var body: some View {
        Group {
            if drillable {
                Button { onDrill?() } label: { row }.buttonStyle(.plain)
            } else {
                row
            }
        }
        .contextMenu {
            if !value.isEmpty {
                Button { UIPasteboard.general.string = value } label: {
                    Label("Copy \(label)", systemImage: "doc.on.doc")
                }
            }
        }
    }

    private var row: some View {
        LabeledContent {
            HStack(spacing: 6) {
                VStack(alignment: .trailing, spacing: 1) {
                    Text(value)
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(status.valueColor)
                        .strikethrough(status.strikethrough)
                        .multilineTextAlignment(.trailing)
                    if let sub = decay ?? status.subscriptLabel {
                        Text(sub)
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                }
                // The status glyph IS the affordance. A drillable row with no glyph
                // (pending) falls back to the plain chevron; a facade shows nothing.
                if let g = status.glyph {
                    Image(systemName: g).font(.caption2).foregroundStyle(status.glyphColor)
                } else if drillable {
                    Image(systemName: "chevron.right.circle").font(.caption2).foregroundStyle(.blue)
                }
            }
        } label: {
            Text(label).font(.footnote).foregroundStyle(.secondary)
        }
        .padding(.vertical, 5)
        .contentShape(Rectangle())
    }
}
