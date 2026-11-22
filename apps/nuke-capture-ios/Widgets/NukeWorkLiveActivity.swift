// NukeWorkLiveActivity.swift — how the photo-work Live Activity looks on the Lock Screen and in the
// Dynamic Island (compact, minimal, expanded). Pure drawing: the app decides every value
// (NukeWorkAttributes.ContentState). A tap anywhere opens the app on the per-photo list.

import ActivityKit
import SwiftUI
import WidgetKit

struct NukeWorkLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: NukeWorkAttributes.self) { context in
            NukeWorkLockScreenView(state: context.state, isStale: context.isStale)
                .activityBackgroundTint(Color.black.opacity(0.85))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(NukeWorkFormat.deepLink)
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    NukeMark(size: 28)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let value = state.compactValue {
                        Text(value)
                            .font(.title3.weight(.semibold).monospacedDigit())
                            .foregroundStyle(.white)
                            .padding(.trailing, 4)
                    } else if state.phase == .done {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.title3)
                            .foregroundStyle(.green)
                            .padding(.trailing, 4)
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(state.headline)
                        .font(.headline)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        NukeWorkProgressBar(state: state)
                        if let line = Self.subline(state, isStale: context.isStale) {
                            Text(line)
                                .font(.caption)
                                .foregroundStyle(.white.opacity(0.7))
                                .lineLimit(1)
                        }
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                NukeMark(size: 20)
            } compactTrailing: {
                NukeWorkCompactTrailing(state: state)
            } minimal: {
                NukeWorkMinimal(state: state)
            }
            .widgetURL(NukeWorkFormat.deepLink)
            .keylineTint(Color.accentColor)
        }
    }

    static func subline(_ state: NukeWorkAttributes.ContentState, isStale: Bool) -> String? {
        if isStale && state.phase != .done { return "Paused · open Nuke to continue" }
        return state.subline
    }
}

/// The Nuke mark at Dynamic Island size: a bold N on the accent tile.
struct NukeMark: View {
    var size: CGFloat

    var body: some View {
        Text("N")
            .font(.system(size: size * 0.62, weight: .black, design: .rounded))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Color.accentColor, in: RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
            .accessibilityLabel("Nuke")
    }
}

/// Determinate bar when the run's size is known; otherwise a quiet "working" line, never a fake fill.
struct NukeWorkProgressBar: View {
    let state: NukeWorkAttributes.ContentState

    var body: some View {
        if let fraction = state.fraction {
            ProgressView(value: fraction)
                .tint(state.failed > 0 ? .orange : .accentColor)
        } else if state.phase == .done {
            ProgressView(value: 1)
                .tint(.green)
        } else {
            HStack(spacing: 6) {
                Image(systemName: state.phase == .uploading ? "arrow.up.circle" : "sparkle.magnifyingglass")
                Text(state.phase == .uploading ? "Sending from this phone" : "Reading on the server")
            }
            .font(.caption)
            .foregroundStyle(.white.opacity(0.7))
        }
    }
}

struct NukeWorkCompactTrailing: View {
    let state: NukeWorkAttributes.ContentState

    var body: some View {
        if state.phase == .done {
            Image(systemName: "checkmark")
                .foregroundStyle(.green)
        } else if let fraction = state.fraction {
            Text("\(Int((fraction * 100).rounded(.down)))%")
                .font(.caption.weight(.semibold).monospacedDigit())
                .foregroundStyle(Color.accentColor)
        } else if let value = state.compactValue {
            Text(value)
                .font(.caption.weight(.semibold).monospacedDigit())
                .foregroundStyle(Color.accentColor)
        } else {
            Image(systemName: state.phase == .uploading ? "arrow.up" : "ellipsis")
                .foregroundStyle(Color.accentColor)
        }
    }
}

/// Minimal (another app's activity shares the island): a ring when the size is known, else the mark.
struct NukeWorkMinimal: View {
    let state: NukeWorkAttributes.ContentState

    var body: some View {
        if state.phase == .done {
            Image(systemName: "checkmark")
                .foregroundStyle(.green)
        } else if let fraction = state.fraction {
            ProgressView(value: fraction) { NukeMark(size: 14) }
                .progressViewStyle(.circular)
                .tint(Color.accentColor)
        } else {
            NukeMark(size: 18)
        }
    }
}

struct NukeWorkLockScreenView: View {
    let state: NukeWorkAttributes.ContentState
    let isStale: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            NukeMark(size: 36)
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(state.headline)
                        .font(.headline)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Spacer(minLength: 4)
                    if let value = state.compactValue {
                        Text(value)
                            .font(.subheadline.weight(.semibold).monospacedDigit())
                            .foregroundStyle(.white.opacity(0.85))
                    }
                }
                NukeWorkProgressBar(state: state)
                if let line = NukeWorkLiveActivity.subline(state, isStale: isStale) {
                    Text(line)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(1)
                }
            }
        }
        .padding(16)
        .accessibilityElement(children: .combine)
    }
}
