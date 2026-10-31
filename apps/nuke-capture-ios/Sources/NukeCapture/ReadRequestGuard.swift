import Foundation

/// A response belongs to the request that started it, even if a query returns
/// to the same text or a refresh overlaps an earlier refresh.
struct ReadRequestGuard {
    private(set) var current: UUID?

    mutating func begin() -> UUID {
        let request = UUID()
        current = request
        return request
    }

    func isCurrent(_ request: UUID) -> Bool { current == request }
}
