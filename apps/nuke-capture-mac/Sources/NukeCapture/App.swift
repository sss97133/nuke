// App.swift — entry point.
//
// NukeCapture is a menu-bar-only app (LSUIElement in Info.plist; the
// .accessory activation policy below covers dev runs where the plist is
// embedded in the bare executable rather than a bundle).

import AppKit

@main
struct NukeCaptureApp {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        // No Dock icon, no app switcher — the status item is the whole UI.
        app.setActivationPolicy(.accessory)
        app.run()
    }
}
