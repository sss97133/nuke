// PermissionPrimer.swift — the short "here is why" screen shown just before iOS asks for access.
//
// Nothing is asked up front. A feature that needs a permission checks `shouldExplain` at the moment
// the person taps it; only while the system has never asked does this screen come first, in one
// sentence, with a plain "Continue" (which then lets iOS show its own prompt) and "Not now".
// The sentences repeat the Info.plist purpose strings so the two never disagree.

import AVFoundation
import SwiftUI

enum PermissionKind: Equatable {
    case camera

    var icon: String {
        switch self {
        case .camera: return "doc.viewfinder"
        }
    }

    var title: String {
        switch self {
        case .camera: return "Scan your paperwork"
        }
    }

    var message: String {
        switch self {
        case .camera: return "Scan receipts, work orders and titles into your record. The camera only opens when you scan."
        }
    }
}

enum PermissionState: Equatable {
    case notDetermined, granted, denied
}

enum PermissionPrimer {
    /// Explain only while iOS has never asked. Once it has, the answer stands and a primer would only nag.
    static func shouldExplain(_ state: PermissionState) -> Bool { state == .notDetermined }

    static func state(for status: AVAuthorizationStatus) -> PermissionState {
        switch status {
        case .notDetermined: return .notDetermined
        case .authorized: return .granted
        case .denied, .restricted: return .denied
        @unknown default: return .denied
        }
    }

    static func currentState(_ kind: PermissionKind) -> PermissionState {
        switch kind {
        case .camera: return state(for: AVCaptureDevice.authorizationStatus(for: .video))
        }
    }

    static func needsExplanation(_ kind: PermissionKind) -> Bool {
        shouldExplain(currentState(kind))
    }
}

/// The explanation screen. `onContinue` is called after the sheet is dismissed by the caller.
struct PermissionPrimerView: View {
    let kind: PermissionKind
    let onContinue: () -> Void
    let onNotNow: () -> Void

    var body: some View {
        VStack(spacing: NukeSpace.xl) {
            Spacer(minLength: NukeSpace.xl)
            Image(systemName: kind.icon)
                .font(.system(size: 72, weight: .regular))
                .foregroundStyle(Color.accentColor)
                .accessibilityHidden(true)
            Text(kind.title)
                .font(.nukeHeadline)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            Text(kind.message)
                .font(.title3)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
            VStack(spacing: NukeSpace.sm) {
                Button(action: onContinue) {
                    Text("Continue").frame(maxWidth: .infinity)
                }
                .buttonStyle(NukePrimaryButtonStyle())
                .accessibilityIdentifier("permission.continue")
                Button(action: onNotNow) {
                    Text("Not now").frame(maxWidth: .infinity)
                }
                .buttonStyle(NukeSecondaryButtonStyle())
                .accessibilityIdentifier("permission.notNow")
            }
        }
        .padding(NukeSpace.xl)
        .presentationDetents([.medium])
    }
}
