// NukeWidgetsBundle.swift — the widget extension's entry point. It holds one thing: the Live
// Activity for photo work (NukeWorkLiveActivity). No home-screen widgets.

import SwiftUI
import WidgetKit

@main
struct NukeWidgetsBundle: WidgetBundle {
    var body: some Widget {
        NukeWorkLiveActivity()
    }
}
