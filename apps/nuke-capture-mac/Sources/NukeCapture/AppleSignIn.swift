// AppleSignIn.swift — Sign in with Apple for the menu-bar relay (AppKit).
//
// Same exchange as the iOS app: ASAuthorizationAppleIDCredential →
// identityToken → SupabaseService.signInWithApple (signInWithIdToken).
// The flow is wrapped in an async method via CheckedContinuation so the
// AppDelegate can `try await appleSignIn.signIn()` like any other call.
//
// Nonce: a fresh random nonce is SHA-256-hashed into the request; Apple
// signs that hash into the ID token's `nonce` claim; Supabase receives the
// RAW nonce and re-hashes to compare — replay protection.
//
// ⚠ ENTITLEMENT REALITY (macOS): this API only authorizes from a BUNDLED,
// SIGNED app carrying the com.apple.developer.applesignin entitlement and a
// provisioning profile from a team where the App ID has the capability
// enabled. From a bare `swift run` dev binary, performRequests() fails
// immediately with ASAuthorizationError 1000 ("Unknown") — that is expected,
// not a bug. Email/password remains the dev-loop sign-in; Sign in with Apple
// lights up in the Xcode-bundled build. See README → Sign in with Apple,
// and apps/SIGN_IN_WITH_APPLE_SETUP.md for the portal/Supabase config.

import AppKit
import AuthenticationServices
import CryptoKit

/// One-shot-per-call coordinator. Owned by AppDelegate (the delegate +
/// presentation-context callbacks need a live object for the duration of
/// the authorization sheet).
final class AppleSignInCoordinator: NSObject {

    private var continuation: CheckedContinuation<(idToken: String, nonce: String), Error>?
    private var currentNonce: String?

    /// Runs the Apple authorization UI and returns the (identity token, raw
    /// nonce) pair ready for SupabaseService.signInWithApple.
    func signIn() async throws -> (idToken: String, nonce: String) {
        try await withCheckedThrowingContinuation { cont in
            continuation = cont

            let nonce = Self.randomNonce()
            currentNonce = nonce

            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = Self.sha256(nonce)

            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    // ─── Nonce helpers (Apple's documented SIWA pattern) ─────────────────────

    /// Cryptographically secure random nonce (SecRandomCopyBytes), with
    /// rejection sampling (charset 65 < 256) to avoid modulo bias.
    static func randomNonce(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        var remaining = length
        while remaining > 0 {
            var randoms = [UInt8](repeating: 0, count: 16)
            let status = SecRandomCopyBytes(kSecRandomDefault, randoms.count, &randoms)
            precondition(status == errSecSuccess, "SecRandomCopyBytes failed: \(status)")
            for random in randoms where remaining > 0 {
                if random < charset.count {
                    result.append(charset[Int(random)])
                    remaining -= 1
                }
            }
        }
        return result
    }

    /// Hex-encoded SHA-256 — the form Apple expects in `request.nonce`.
    static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }
}

// ─── ASAuthorizationController callbacks ─────────────────────────────────────

extension AppleSignInCoordinator: ASAuthorizationControllerDelegate {

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        guard
            let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
            let tokenData = credential.identityToken,
            let idToken = String(data: tokenData, encoding: .utf8),
            let nonce = currentNonce
        else {
            continuation?.resume(throwing: ASAuthorizationError(.invalidResponse))
            continuation = nil
            return
        }
        currentNonce = nil
        continuation?.resume(returning: (idToken, nonce))
        continuation = nil
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        continuation?.resume(throwing: error)
        continuation = nil
    }
}

extension AppleSignInCoordinator: ASAuthorizationControllerPresentationContextProviding {

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        // Menu-bar app: no window of our own. Anchor to whatever is frontmost
        // (the sign-in alert's window when triggered from there), falling
        // back to a throwaway window — AuthenticationServices presents its
        // own sheet/panel either way.
        NSApp.keyWindow ?? NSApp.windows.first ?? NSWindow()
    }
}
