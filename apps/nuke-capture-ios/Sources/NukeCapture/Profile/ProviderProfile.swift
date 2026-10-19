// ProviderProfile.swift — the provider face of a profile, as the open readers send it.
//
// provider_profile_read keeps what a person says about themself (claims: the account's own
// fields, or what their technician record states) apart from what the record shows
// (capabilities derived from evidence, tool sightings in their photos, tools they say they own,
// vouches by others, shops, signed work days and jobs). provider_job_record_read pages their
// jobs. Both are anon-readable; neither returns money or contact fields. Decoding is tolerant:
// a missing block reads as not reported, never as zero.

import Foundation
import Supabase

struct ProviderProfile: Decodable, Equatable {
    struct Subject: Decodable, Equatable {
        let kind: String?
        let profileId: String?
        let handle: String?
        let city: String?
        let state: String?
        let memberSince: String?
        let actorType: String?
        let display: JobPerson?

        enum CodingKeys: String, CodingKey {
            case kind, handle, city, state, display
            case profileId = "profile_id"
            case memberSince = "member_since"
            case actorType = "actor_type"
        }

        /// "@handle", the technician record's public label, or "Unnamed party".
        var name: String {
            if let handle, !handle.isEmpty { return "@" + handle }
            return display?.text ?? "Unnamed party"
        }

        var place: String? {
            let p = [city, state].compactMap { $0 }.filter { !$0.isEmpty }
            return p.isEmpty ? nil : p.joined(separator: ", ")
        }
    }

    struct Claims: Decodable, Equatable {
        struct Account: Decodable, Equatable {
            let role: String?
            let userType: String?
            let profession: String?
            let expertiseAreas: [String]

            enum CodingKeys: String, CodingKey {
                case role, profession
                case userType = "user_type"
                case expertiseAreas = "expertise_areas"
            }

            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                role = try? c.decode(String.self, forKey: .role)
                userType = try? c.decode(String.self, forKey: .userType)
                profession = try? c.decode(String.self, forKey: .profession)
                expertiseAreas = ProviderProfile.strings(c, .expertiseAreas)
            }
        }

        struct ActorRecord: Decodable, Equatable {
            let actorType: String?
            let specialties: [String]
            let certifications: [String]
            let licenses: [String]
            let training: [String]
            let specialtyMakes: [String]
            let specialtyEras: [String]
            let yearsExperience: Int?

            enum CodingKeys: String, CodingKey {
                case specialties, certifications, licenses, training
                case actorType = "actor_type"
                case specialtyMakes = "specialty_makes"
                case specialtyEras = "specialty_eras"
                case yearsExperience = "years_experience"
            }

            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                actorType = try? c.decode(String.self, forKey: .actorType)
                specialties = ProviderProfile.strings(c, .specialties)
                certifications = ProviderProfile.strings(c, .certifications)
                licenses = ProviderProfile.strings(c, .licenses)
                training = ProviderProfile.strings(c, .training)
                specialtyMakes = ProviderProfile.strings(c, .specialtyMakes)
                specialtyEras = ProviderProfile.strings(c, .specialtyEras)
                yearsExperience = try? c.decode(Int.self, forKey: .yearsExperience)
            }
        }

        let account: Account?
        let actorRecords: [ActorRecord]

        enum CodingKeys: String, CodingKey {
            case account
            case actorRecords = "actor_records"
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            account = try? c.decode(Account.self, forKey: .account)
            actorRecords = (try? c.decode([ActorRecord].self, forKey: .actorRecords)) ?? []
        }
    }

    struct Capability: Decodable, Equatable, Identifiable {
        let capabilityType: String
        let complexityTier: String?
        let evidenceCount: Int?
        let firstDemonstrated: String?
        let lastDemonstrated: String?
        var id: String { capabilityType + (complexityTier ?? "") }

        enum CodingKeys: String, CodingKey {
            case capabilityType = "capability_type"
            case complexityTier = "complexity_tier"
            case evidenceCount = "evidence_count"
            case firstDemonstrated = "first_demonstrated"
            case lastDemonstrated = "last_demonstrated"
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            capabilityType = try c.decode(String.self, forKey: .capabilityType)
            complexityTier = (try? c.decode(String.self, forKey: .complexityTier))
                ?? (try? c.decode(Int.self, forKey: .complexityTier)).map(String.init)
            evidenceCount = try? c.decode(Int.self, forKey: .evidenceCount)
            firstDemonstrated = try? c.decode(String.self, forKey: .firstDemonstrated)
            lastDemonstrated = try? c.decode(String.self, forKey: .lastDemonstrated)
        }
    }

    struct SeenInFrame: Decodable, Equatable {
        struct Label: Decodable, Equatable, Identifiable {
            let label: String
            let occurrences: Int
            var id: String { label }
        }
        let occurrences: Int?
        let framesAnalyzed: Int?
        let framesWithTools: Int?
        let topLabels: [Label]
        let imagesScanned: Int?
        let imagesEligible: Int?
        let scanCap: Int?
        let state: String?

        enum CodingKeys: String, CodingKey {
            case occurrences, state
            case framesAnalyzed = "frames_analyzed"
            case framesWithTools = "frames_with_tools"
            case topLabels = "top_labels"
            case imagesScanned = "images_scanned"
            case imagesEligible = "images_eligible"
            case scanCap = "scan_cap"
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            occurrences = try? c.decode(Int.self, forKey: .occurrences)
            framesAnalyzed = try? c.decode(Int.self, forKey: .framesAnalyzed)
            framesWithTools = try? c.decode(Int.self, forKey: .framesWithTools)
            topLabels = (try? c.decode([Label].self, forKey: .topLabels)) ?? []
            imagesScanned = try? c.decode(Int.self, forKey: .imagesScanned)
            imagesEligible = try? c.decode(Int.self, forKey: .imagesEligible)
            scanCap = try? c.decode(Int.self, forKey: .scanCap)
            state = try? c.decode(String.self, forKey: .state)
        }
    }

    struct ClaimedOwned: Decodable, Equatable {
        struct Category: Decodable, Equatable, Identifiable {
            let category: String
            let records: Int
            let units: Double?
            var id: String { category }
        }
        let userTools: [Category]
        let toolInventory: [Category]
        let state: String?

        enum CodingKeys: String, CodingKey {
            case state
            case userTools = "user_tools"
            case toolInventory = "tool_inventory"
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            userTools = (try? c.decode([Category].self, forKey: .userTools)) ?? []
            toolInventory = (try? c.decode([Category].self, forKey: .toolInventory)) ?? []
            state = try? c.decode(String.self, forKey: .state)
        }

        /// Categories across both record kinds, records summed, most first.
        var categories: [(category: String, records: Int)] {
            var sums: [String: Int] = [:]
            for c in userTools + toolInventory { sums[c.category, default: 0] += c.records }
            return sums.map { ($0.key, $0.value) }.sorted { $0.records == $1.records ? $0.category < $1.category : $0.records > $1.records }
        }
    }

    struct Tools: Decodable, Equatable {
        let seenInFrame: SeenInFrame?
        let claimedOwned: ClaimedOwned?
        let supportingAttestations: Int?

        enum CodingKeys: String, CodingKey {
            case seenInFrame = "seen_in_frame"
            case claimedOwned = "claimed_owned"
            case coSigned = "co_signed"
        }
        private struct CoSigned: Decodable { let supporting_attestations: Int? }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            seenInFrame = try? c.decode(SeenInFrame.self, forKey: .seenInFrame)
            claimedOwned = try? c.decode(ClaimedOwned.self, forKey: .claimedOwned)
            supportingAttestations = (try? c.decode(CoSigned.self, forKey: .coSigned))?.supporting_attestations
        }
    }

    struct Facility: Decodable, Equatable, Identifiable {
        let relationKind: String?
        let organizationId: String?
        let name: String?
        let role: String?
        let city: String?
        let state: String?
        let relationState: String?
        let lastContributionAt: String?
        var id: String { (organizationId ?? name ?? "") + (relationKind ?? "") + (role ?? "") }

        enum CodingKeys: String, CodingKey {
            case name, role, city, state, relation
            case relationKind = "relation_kind"
            case organizationId = "organization_id"
        }
        private struct Relation: Decodable { let state: String?; let last_contribution_at: String? }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            relationKind = try? c.decode(String.self, forKey: .relationKind)
            organizationId = try? c.decode(String.self, forKey: .organizationId)
            name = try? c.decode(String.self, forKey: .name)
            role = try? c.decode(String.self, forKey: .role)
            city = try? c.decode(String.self, forKey: .city)
            state = try? c.decode(String.self, forKey: .state)
            let relation = try? c.decode(Relation.self, forKey: .relation)
            relationState = relation?.state
            lastContributionAt = relation?.last_contribution_at
        }

        /// Ownership, and memberships that are live or stalling; a dormant relation is not shown.
        var isActive: Bool { relationKind == "ownership" || relationState == "live" || relationState == "stalling" }
    }

    struct WorkDays: Decodable, Equatable {
        let signedWorkDays: Int?
        let daysWithCapture: Int?
        let captureSpanHours: Double?
        let firstDay: String?
        let lastDay: String?
        let state: String?

        enum CodingKeys: String, CodingKey {
            case state
            case signedWorkDays = "signed_work_days"
            case daysWithCapture = "days_with_capture"
            case captureSpanHours = "capture_span_hours"
            case firstDay = "first_day"
            case lastDay = "last_day"
        }
        private struct Span: Decodable { let value: Double? }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            signedWorkDays = try? c.decode(Int.self, forKey: .signedWorkDays)
            daysWithCapture = try? c.decode(Int.self, forKey: .daysWithCapture)
            captureSpanHours = (try? c.decode(Span.self, forKey: .captureSpanHours))?.value
            firstDay = try? c.decode(String.self, forKey: .firstDay)
            lastDay = try? c.decode(String.self, forKey: .lastDay)
            state = try? c.decode(String.self, forKey: .state)
        }
    }

    struct Jobs: Decodable, Equatable {
        let jobs: Int?
        let byRole: [String: Int]
        let completionRecorded: Int?
        let completionStatusOnly: Int?
        let completionAbsent: Int?
        let inProgress: Int?
        let inconsistencies: Int?

        enum CodingKeys: String, CodingKey {
            case jobs, completion, inconsistencies
            case byRole = "by_role"
            case inProgress = "in_progress"
        }
        private struct Completion: Decodable { let recorded: Int?; let status_only: Int?; let absent: Int? }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            jobs = try? c.decode(Int.self, forKey: .jobs)
            byRole = (try? c.decode([String: Int].self, forKey: .byRole)) ?? [:]
            let completion = try? c.decode(Completion.self, forKey: .completion)
            completionRecorded = completion?.recorded
            completionStatusOnly = completion?.status_only
            completionAbsent = completion?.absent
            inProgress = try? c.decode(Int.self, forKey: .inProgress)
            inconsistencies = try? c.decode(Int.self, forKey: .inconsistencies)
        }
    }

    let viewer: JobViewer?
    let subject: Subject?
    let claims: Claims?
    let capabilities: [Capability]
    let tools: Tools?
    let facilities: [Facility]
    let identityBridgeState: String?
    let workDays: WorkDays?
    let jobs: Jobs?
    let contact: ContactBlock?
    let asOf: String?

    enum CodingKeys: String, CodingKey {
        case viewer, subject, claims, capabilities, tools, facilities, contact
        case identityBridge = "identity_bridge"
        case workRecord = "work_record"
        case asOf = "as_of"
    }
    private struct Items: Decodable { let items: [CapabilitySlot]? }
    private struct CapabilitySlot: Decodable {
        let capability: Capability?
        init(from decoder: Decoder) throws { capability = try? Capability(from: decoder) }
    }
    private struct FacilitySlot: Decodable {
        let facility: Facility?
        init(from decoder: Decoder) throws { facility = try? Facility(from: decoder) }
    }
    private struct Bridge: Decodable { let state: String? }
    private struct WorkRecord: Decodable {
        let days: WorkDays?
        let jobs: Jobs?
        enum CodingKeys: String, CodingKey { case days, jobs }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            days = try? c.decode(WorkDays.self, forKey: .days)
            jobs = try? c.decode(Jobs.self, forKey: .jobs)
        }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        viewer = try? c.decode(JobViewer.self, forKey: .viewer)
        subject = try? c.decode(Subject.self, forKey: .subject)
        claims = try? c.decode(Claims.self, forKey: .claims)
        capabilities = ((try? c.decode(Items.self, forKey: .capabilities))?.items ?? []).compactMap(\.capability)
        tools = try? c.decode(Tools.self, forKey: .tools)
        facilities = ((try? c.decode([FacilitySlot].self, forKey: .facilities)) ?? []).compactMap(\.facility)
        identityBridgeState = (try? c.decode(Bridge.self, forKey: .identityBridge))?.state
        let record = try? c.decode(WorkRecord.self, forKey: .workRecord)
        workDays = record?.days
        jobs = record?.jobs
        contact = try? c.decode(ContactBlock.self, forKey: .contact)
        asOf = try? c.decode(String.self, forKey: .asOf)
    }

    var isSelf: Bool { viewer?.context == .selfView }
    var contactAvailable: Bool { contact?.canRequest == true }

    /// A list of plain strings from a jsonb array, or nothing (a string or null reads as empty).
    fileprivate static func strings<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ k: K) -> [String] {
        guard case .array(let a)? = try? c.decode(JobJSON.self, forKey: k) else { return [] }
        return a.compactMap(\.stringValue).filter { !$0.isEmpty }
    }
}

// MARK: - provider_job_record_read

struct ProviderJobRow: Decodable, Equatable, Identifiable {
    struct Attestation: Decodable, Equatable {
        let kind: String?
        let verdict: String?
        let attestor: JobPerson?

        enum CodingKeys: String, CodingKey {
            case verdict, attestor
            case kind = "attestation_kind"
        }
    }

    let workOrderId: String
    let displayTitle: String?
    let vehicleLabel: JobVehicleLabel?
    let subjectRoles: [String]
    let stageStates: [JobStageKey: JobStageState]
    let operationKinds: [String: Int]
    let completionClock: String?
    let requestedAt: String?
    let customerAcceptance: String?
    let attestations: [Attestation]
    let inconsistencies: [String]

    var id: String { workOrderId }

    enum CodingKeys: String, CodingKey {
        case dates, inconsistencies
        case workOrderId = "work_order_id"
        case displayTitle = "display_title"
        case vehicleLabel = "vehicle_label"
        case subjectRoles = "subject_roles"
        case stageStates = "stage_states"
        case operationKinds = "operation_kinds"
        case customerAcceptance = "customer_acceptance"
        case attestations = "counterparty_attestations"
    }
    private struct Dates: Decodable { let completion_clock: String?; let requested_at: String? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        workOrderId = try c.decode(String.self, forKey: .workOrderId)
        displayTitle = (try? c.decode(String.self, forKey: .displayTitle)).flatMap { $0.isEmpty ? nil : $0 }
        vehicleLabel = try? c.decode(JobVehicleLabel.self, forKey: .vehicleLabel)
        subjectRoles = (try? c.decode([String].self, forKey: .subjectRoles)) ?? []
        operationKinds = (try? c.decode([String: Int].self, forKey: .operationKinds)) ?? [:]
        let dates = try? c.decode(Dates.self, forKey: .dates)
        completionClock = dates?.completion_clock
        requestedAt = dates?.requested_at
        customerAcceptance = try? c.decode(String.self, forKey: .customerAcceptance)
        attestations = (try? c.decode([Attestation].self, forKey: .attestations)) ?? []
        inconsistencies = (try? c.decode([String].self, forKey: .inconsistencies)) ?? []
        var states: [JobStageKey: JobStageState] = [:]
        if let s = try? c.nestedContainer(keyedBy: JobCodingKey.self, forKey: .stageStates) {
            for key in s.allKeys {
                guard let k = JobStageKey(rawValue: key.stringValue) else { continue }
                states[k] = (try? s.decode(JobStageState.self, forKey: key)) ?? .unknown("unstated")
            }
        }
        stageStates = states
    }

    var headline: String { displayTitle ?? vehicleLabel?.text ?? "Untitled job" }
}

struct ProviderJobRecord: Decodable, Equatable {
    var rows: [ProviderJobRow]
    let nextAfter: String?
    let returned: Int?
    let totalForSubject: Int?
    var unreadableRows: Int

    enum CodingKeys: String, CodingKey {
        case rows, coverage
        case nextAfter = "next_after"
    }
    private struct Coverage: Decodable { let returned: Int?; let total_for_subject: Int? }
    private struct RowSlot: Decodable {
        let row: ProviderJobRow?
        init(from decoder: Decoder) throws { row = try? ProviderJobRow(from: decoder) }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = (try? c.decode([RowSlot].self, forKey: .rows)) ?? []
        rows = raw.compactMap(\.row)
        unreadableRows = raw.count - rows.count
        nextAfter = try? c.decode(String.self, forKey: .nextAfter)
        let cov = try? c.decode(Coverage.self, forKey: .coverage)
        returned = cov?.returned
        totalForSubject = cov?.total_for_subject
    }

    func appending(_ next: ProviderJobRecord) -> ProviderJobRecord {
        var merged = next
        let seen = Set(rows.map(\.workOrderId))
        merged.rows = rows + next.rows.filter { !seen.contains($0.workOrderId) }
        merged.unreadableRows = unreadableRows + next.unreadableRows
        return merged
    }

    var sentence: String {
        guard let total = totalForSubject else { return "Total not available" }
        return "Showing \(rows.count) of \(total) jobs"
    }
}

// MARK: - Readers

enum ProviderReaders {
    static let profileName = "provider_profile_read"
    static let jobRecordName = "provider_job_record_read"

    static func profile(userId: String) async -> JobLoad<ProviderProfile> {
        await JobReaders.call(profileName) {
            try await SupabaseService.client.rpc(profileName, params: ["p_user_id": userId]).execute().data
        }
    }

    static func jobRecord(userId: String, after: String? = nil, limit: Int = 10) async -> JobLoad<ProviderJobRecord> {
        struct P: Encodable { let p_user_id: String; let p_after: String?; let p_limit: Int }
        return await JobReaders.call(jobRecordName) {
            try await SupabaseService.client.rpc(jobRecordName, params: P(p_user_id: userId, p_after: after, p_limit: limit))
                .execute().data
        }
    }
}
