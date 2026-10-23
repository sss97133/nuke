import XCTest
@testable import NukeCapture

/// The vehicle profile's shared image cache: one fetch per key while in flight,
/// reuse within the TTL, refetch after it, failures not cached, invalidation by prefix.
@MainActor
final class VehicleImageLoaderTests: XCTestCase {
    final class Clock { var t = Date(timeIntervalSince1970: 1_000) }

    func testConcurrentRequestsCoalesce() async throws {
        let cache = CoalescingCache<Int>(ttl: 60)
        var calls = 0
        let fetch: () async throws -> Int = {
            calls += 1
            try await Task.sleep(nanoseconds: 50_000_000)
            return 7
        }
        async let a = cache.value("v|hero", fetch: fetch)
        async let b = cache.value("v|hero", fetch: fetch)
        let (x, y) = try await (a, b)
        XCTAssertEqual(x, 7); XCTAssertEqual(y, 7)
        XCTAssertEqual(calls, 1)
    }

    func testTTLReuseThenExpiry() async throws {
        let clock = Clock()
        let cache = CoalescingCache<Int>(ttl: 60, now: { clock.t })
        var calls = 0
        let fetch: () async throws -> Int = { calls += 1; return calls }
        let first = try await cache.value("k", fetch: fetch)
        clock.t += 30
        let reused = try await cache.value("k", fetch: fetch)
        clock.t += 31
        let refetched = try await cache.value("k", fetch: fetch)
        XCTAssertEqual([first, reused, refetched], [1, 1, 2])
        XCTAssertEqual(calls, 2)
    }

    func testFailureIsNotCached() async {
        let cache = CoalescingCache<Int>(ttl: 60)
        struct Boom: Error {}
        var fail = true
        do { _ = try await cache.value("k") { if fail { throw Boom() }; return 1 }; XCTFail("expected throw") } catch {}
        fail = false
        let v = try? await cache.value("k") { if fail { throw Boom() }; return 1 }
        XCTAssertEqual(v, 1)
    }

    func testInvalidateByPrefix() async throws {
        let cache = CoalescingCache<Int>(ttl: 60)
        _ = try await cache.value("a|hero") { 1 }
        _ = try await cache.value("b|hero") { 2 }
        cache.invalidate(prefix: "a|")
        XCTAssertEqual(cache.cachedKeys, ["b|hero"])
        cache.invalidate()
        XCTAssertTrue(cache.cachedKeys.isEmpty)
    }

    func testLimitBoundsMemory() async throws {
        let cache = CoalescingCache<Int>(ttl: 60, limit: 3)
        for i in 0..<10 { _ = try await cache.value("k\(i)") { i } }
        XCTAssertLessThanOrEqual(cache.cachedKeys.count, 3)
    }

    func testKeysAndColumns() {
        XCTAssertEqual(VehicleImageLoader.key("v1", "day", "2026-01-02"), "v1|day|2026-01-02")
        XCTAssertTrue(VehicleImageLoader.columns.hasPrefix("id,image_url,thumbnail_url"))
    }
}
