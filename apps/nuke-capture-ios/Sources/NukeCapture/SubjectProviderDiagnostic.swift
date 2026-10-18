import Foundation

/// Optional, allowlisted provider failure metadata from the existing resolver.
/// It contains no credential value, model output or provider response prose.
struct SubjectProviderDiagnostic: Decodable, Equatable {
    struct AttemptCoverage: Decodable, Equatable {
        let method: String
        let expected_providers: Int
        let assessed_providers: Int
        let outcomes_observed: Int
        let complete: Bool
        let no_reading_started: Bool
    }
    let code: String
    let provider: String?
    let http_status: Int?
    let credential_kind: String?

    private var providerName: String {
        switch provider {
        case "anthropic": return "Claude"
        case "openai": return "OpenAI"
        case "google": return "Gemini"
        default: return "AI provider"
        }
    }

    var message: String? {
        switch code {
        case "no_connected_key":
            return "Photo analysis needs a connected API key. Review Connected accounts."
        case "credential_lookup_failed":
            return "Photo analysis couldn't read your connected provider. Review Connected accounts if this persists."
        case "credential_not_accepted" where http_status == 401:
            if credential_kind == "oauth" {
                return "Your connected \(providerName) sign-in credential wasn't accepted by the API-key route. Review Connected accounts; this photo-analysis route uses API keys."
            }
            return "Your connected \(providerName) credential wasn't accepted by the API-key route. Review Connected accounts."
        case "permission_denied" where http_status == 403:
            return "Your connected \(providerName) denied access for this analysis request. Review its access settings."
        case "billing_or_usage_limit":
            return "Your connected \(providerName) reported a billing or usage limit. Review credits and limits with that provider."
        case "rate_or_quota_limit" where http_status == 429:
            return "Your connected \(providerName) reported a rate or quota limit. This visual comparison didn't finish."
        case "provider_transient" where http_status == 408 || (http_status ?? 0) >= 500:
            return "Your connected \(providerName) was temporarily unavailable. This visual comparison didn't finish."
        case "service_guard_held":
            return "Photo analysis is held by the service's existing request guard."
        case "response_unreadable":
            return "Your connected \(providerName) responded, but its visual result couldn't be read. This comparison didn't finish."
        case "request_refused", "request_failed":
            return "Photo analysis couldn't complete the request to your connected \(providerName)."
        default: return nil
        }
    }

    var needsConnectionReview: Bool {
        message != nil && ["no_connected_key", "credential_lookup_failed", "credential_not_accepted", "permission_denied"].contains(code)
    }

    static func primary(_ diagnostics: [Self]?) -> Self? {
        guard let diagnostics, diagnostics.count <= 3 else { return nil }
        let known = diagnostics.filter { $0.message != nil }
        return known.first(where: { !["no_connected_key", "credential_lookup_failed"].contains($0.code) })
            ?? known.first(where: { $0.code == "credential_lookup_failed" }) ?? known.first
    }

    /// Verify the complete provider boundary, not merely the displayed first diagnostic.
    /// An absent, truncated, mixed or legacy receipt cannot authorize a fresh model retry.
    static func provesNoReading(_ diagnostics: [Self]?, coverage: AttemptCoverage?) -> Bool {
        guard let diagnostics, let coverage, coverage.method == "byok_vision_attempts_v1",
              coverage.complete, coverage.no_reading_started, coverage.expected_providers == 3,
              coverage.assessed_providers == 3, coverage.outcomes_observed == 3, diagnostics.count == 3,
              Set(diagnostics.compactMap(\.provider)) == Set(["google", "anthropic", "openai"]) else { return false }
        return diagnostics.allSatisfy {
            (["no_connected_key", "credential_lookup_failed"].contains($0.code) && $0.http_status == nil)
                || ($0.code == "credential_not_accepted" && $0.http_status == 401)
        }
    }

    /// Republishing an unchanged not-due outcome keeps its ephemeral action for that
    /// account. A new outcome/account clears it unless the new receipt explicitly sets it.
    static func reviewFlag(previousUser: String?, user: String, previousSummary: String?, summary: String,
                           previousValue: Bool, explicitValue: Bool?) -> Bool {
        explicitValue ?? (previousUser == user && previousSummary == summary && previousValue)
    }
}
