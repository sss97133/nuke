// AppleSignIn.swift — the Sign in with Apple request/response steps shared by the welcome
// flow and SignInView, so both do the nonce dance and the one-time name capture the same way.
//
// Nonce: a fresh random value is SHA-256-hashed into the Apple request; Apple bakes the hash
// into the ID token, and Supabase receives the RAW nonce to verify it (replay protection).

import AuthenticationServices
import Foundation

enum AppleSignIn {
    /// Configure the button's request; returns the raw nonce to hand back to `complete`.
    static func prepare(_ request: ASAuthorizationAppleIDRequest) -> String {
        let nonce = AppleNonce.random()
        request.requestedScopes = [.fullName, .email]
        request.nonce = AppleNonce.sha256(nonce)
        return nonce
    }

    static let offlineFailure = "You seem to be offline. Check your connection and try again."
    static let genericFailure = "We couldn't sign you in just now. Please try again, or use email instead."

    /// What to tell the person when sign-in fails: plain words, never a raw error string.
    /// nil when they simply dismissed Apple's sheet (not a failure worth a message).
    static func friendlyMessage(for error: Error) -> String? {
        if let authError = error as? ASAuthorizationError, authError.code == .canceled { return nil }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost, .cannotConnectToHost, .dataNotAllowed:
                return offlineFailure
            default:
                break
            }
        }
        return genericFailure
    }

    /// Finish a sign-in. Returns the message to show, or nil on success or when the person
    /// simply dismissed Apple's sheet. SessionStore flips the root view on the auth change.
    @MainActor
    static func complete(_ result: Result<ASAuthorization, Error>, nonce: String?) async -> String? {
        switch result {
        case .failure(let error):
            return friendlyMessage(for: error)

        case .success(let authorization):
            guard
                let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                let tokenData = credential.identityToken,
                let idToken = String(data: tokenData, encoding: .utf8),
                let nonce
            else {
                return genericFailure
            }
            // Apple gives the name once. Hold it before the network call so a failed exchange
            // does not lose it.
            let names = ProfileDisplayName()
            let newName = ProfileDisplayName.fullName(from: credential.fullName)
            if let newName { names.stashPending(name: newName, appleUser: credential.user) }
            do {
                try await SupabaseService.signInWithApple(idToken: idToken, nonce: nonce)
                if let userId = SupabaseService.currentUserId {
                    names.commit(appleUser: credential.user, newName: newName, userId: userId)
                }
                return nil
            } catch {
                NSLog("NukeCapture: Apple sign-in exchange failed: %@", String(describing: error))
                return friendlyMessage(for: error)
            }
        }
    }
}
