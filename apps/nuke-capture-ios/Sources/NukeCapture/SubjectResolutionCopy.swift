import Foundation

enum SubjectResolutionCopy {
    static func reason(_ code: String) -> String {
        switch code {
        case "needs_corresponding_view", "source_needs_corresponding_view": return "Another distinct view is needed to compare this subject."
        case "needs_identifying_view": return "An identifying view is still missing."
        case "primary_subject_unqualified": return "This frame does not establish one clear vehicle subject."
        case "contradictory_subject_component": return "The visible evidence conflicts."
        case "competing_existing_subjects", "current_membership_conflict": return "The reading conflicts with existing photo profiles."
        case "needs_existing_subject_anchor", "existing_subject_support_unavailable": return "A current reference photo is needed before this can join a profile."
        case "source_unqualified", "source_changed", "source_unavailable": return "The retained source no longer qualifies for this reading."
        case "source_not_ready": return "The photo is waiting for its source and privacy checks."
        case "required_input_unavailable": return "A required photo could not be read."
        case "provider_unavailable", "provider_call_failed": return "The image service did not return a usable reading."
        case "retained_reading_unavailable": return "The earlier reading is unavailable; automatic rereading is held."
        case "subject_admission_unavailable", "subject_storage_failed", "subject_reading_storage_failed": return "The photo reading is waiting to be saved or checked."
        case "current_membership_unassessed": return "Current profile support could not be checked."
        default: return "This reading remains unresolved."
        }
    }
    static func summary(_ value: String) -> String {
        if value.hasPrefix("Visual reading retained as unresolved") {
            return "Photographs retained. More evidence is needed to support a subject profile."
        }
        for prefix in ["Visual analysis refused: ", "Visual analysis waiting: "] {
            if let range = value.range(of: prefix) {
                let message = reason(String(value[range.upperBound...]).trimmingCharacters(in: CharacterSet(charactersIn: ". ")))
                return value.hasPrefix("Visual analysis stopped after three attempts") ? "Automatic retries paused. " + message : message
            }
        }
        return value
    }
}
