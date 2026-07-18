// Haptics — the app's whole tactile vocabulary in one place.
//
// One instrument, one grammar. Every haptic encodes exactly ONE of three physical
// metaphors, and nothing else:
//   TICK    (lateral)  — you moved a control sideways: same data, new view (lens/pivot/scrub)
//   DROP    (descend)  — you committed INTO the hierarchy (drill); depth = weight, monotonic
//   LANDING (terminal) — you arrived somewhere real (the cars, a watched item latching, a wall)
// Rising energy = engage (watch ON), falling = release (watch OFF). If a buzz can't be named
// as one of these, it doesn't ship — that's the line between "an instrument" and "a phone
// that vibrates." Generators are pre-warmed and re-prepared after each fire (cold generators
// have ~50-150ms wake latency and feel dead). One shared CHHapticEngine for custom patterns.

import UIKit
import CoreHaptics

enum Haptics {
    // Pre-warmed, reused UIKit generators (cheap; keep warm).
    private static let sel = UISelectionFeedbackGenerator()
    private static let soft = UIImpactFeedbackGenerator(style: .soft)
    private static let medium = UIImpactFeedbackGenerator(style: .medium)
    private static let rigid = UIImpactFeedbackGenerator(style: .rigid)
    private static let notify = UINotificationFeedbackGenerator()

    // One long-lived Core Haptics engine (gate on hardware; no-op on unsupported devices).
    private static let supportsHaptics = CHHapticEngine.capabilitiesForHardware().supportsHaptics
    private static var engine: CHHapticEngine? = {
        guard supportsHaptics else { return nil }
        let e = try? CHHapticEngine()
        e?.isAutoShutdownEnabled = true
        e?.resetHandler = { try? engine?.start() }
        try? e?.start()
        return e
    }()

    /// Call from the Pulse screen's onAppear to warm the generators.
    static func warm() {
        sel.prepare(); soft.prepare(); medium.prepare(); rigid.prepare(); notify.prepare()
    }

    // ── Lateral: TICK ──────────────────────────────────────────────
    static func tick() { sel.selectionChanged(); sel.prepare() }

    // ── Descend: DROP (depth = weight) ─────────────────────────────
    /// depth 0 = make→model, 1+ = model→year and deeper.
    static func drill(depth: Int) {
        if depth <= 0 { soft.impactOccurred(intensity: 0.55); soft.prepare() }
        else { medium.impactOccurred(intensity: 0.8); medium.prepare() }
    }
    static func popBack() { soft.impactOccurred(intensity: 0.4); soft.prepare() }
    static func openDossier() { rigid.impactOccurred(); rigid.prepare() }

    // ── Verbs: CATCH / release — distinguishable by TEXTURE, not just weight ─
    static func watchOn()  { play(latch) }                                   // rising latch + tail
    static func watchOff() { soft.impactOccurred(intensity: 0.45); soft.prepare() }  // falling release
    static func saveOn()   { rigid.impactOccurred(intensity: 0.7); rigid.prepare() } // dry, no tail
    static func saveOff()  { tick() }

    // ── Terminal / status ──────────────────────────────────────────
    static func landing() { play(landingPattern) }   // drill-to-cars: the only two-beat DROP
    static func drawer()  { play(drawerPattern) }     // the "＋N makes" fold: a lesser compartment
    static func wall()    { play(wallPattern) }       // dead end: a tail-less thud
    static func error()   { notify.notificationOccurred(.error); notify.prepare() }
    static func empty()   { notify.notificationOccurred(.warning); notify.prepare() }
    static func refreshSettled() { soft.impactOccurred(intensity: 0.5); soft.prepare() }

    // ── Custom-pattern plumbing ────────────────────────────────────
    private static func play(_ pattern: CHHapticPattern?) {
        guard let engine, let pattern else { return }
        do { try engine.start(); try engine.makePlayer(with: pattern).start(atTime: 0) } catch { }
    }
    private static func ev(_ type: CHHapticEvent.EventType, _ t: TimeInterval,
                           i: Float, s: Float, dur: TimeInterval = 0) -> CHHapticEvent {
        CHHapticEvent(eventType: type, parameters: [
            .init(parameterID: .hapticIntensity, value: i),
            .init(parameterID: .hapticSharpness, value: s)
        ], relativeTime: t, duration: dur)
    }
    // drill-to-cars "tk-DUM": a light sharp arrival click, then a heavy soft settle.
    private static let landingPattern = try? CHHapticPattern(events: [
        ev(.hapticTransient, 0.000, i: 0.55, s: 0.90),
        ev(.hapticTransient, 0.055, i: 1.00, s: 0.35)
    ], parameters: [])
    // watch-ON: rising click-clack + a short resonant tail (mechanical "it's holding").
    private static let latch = try? CHHapticPattern(events: [
        ev(.hapticTransient, 0.000, i: 0.50, s: 0.70),
        ev(.hapticTransient, 0.030, i: 0.90, s: 1.00),
        ev(.hapticContinuous, 0.050, i: 0.35, s: 0.25, dur: 0.06)
    ], parameters: [])
    // the fold cell: a muted, characterless double-soft — a lesser drawer, never a real level.
    private static let drawerPattern = try? CHHapticPattern(events: [
        ev(.hapticTransient, 0.000, i: 0.40, s: 0.30),
        ev(.hapticTransient, 0.045, i: 0.40, s: 0.30)
    ], parameters: [])
    // boundary: single damped thud, NO tail — the missing resonance is the message.
    private static let wallPattern = try? CHHapticPattern(events: [
        ev(.hapticTransient, 0.0, i: 0.85, s: 0.20)
    ], parameters: [])
}
