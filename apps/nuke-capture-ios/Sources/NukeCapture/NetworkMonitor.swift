// NetworkMonitor.swift — the un-metered-link sensor for background drains.
//
// BUG #1 (background sync) needs a Wi-Fi gate: a BGProcessingTaskRequest can
// require power and network, but it has NO "Wi-Fi-only" flag — its network
// requirement is satisfied by cellular too. A 32 K-photo drain on a metered
// connection is a data-bill incident, so the gate lives HERE, in software,
// and SyncEngine.drainUntilEmpty(requireWiFi:) consults it before draining.
//
// Tiny on purpose: one NWPathMonitor, one @Published Bool. The monitor's
// pathUpdateHandler runs off the main actor (NWPathMonitor delivers on its
// own queue) — we hop to @MainActor to mutate the @Published state so SwiftUI
// and the engine read a consistent, main-isolated value.

import Foundation
import Network

@MainActor
final class NetworkMonitor: ObservableObject {

    /// One shared sensor — the BG task path and any view read the same value.
    static let shared = NetworkMonitor()

    /// True only on an un-metered, un-constrained Wi-Fi / wired link.
    /// "Un-metered" = satisfied AND not expensive (cellular / personal hotspot)
    /// AND not constrained (Low Data Mode) AND the interface is wifi/ethernet.
    /// This is the gate the background drain trusts before moving bytes.
    @Published private(set) var isUnmetered: Bool = false

    private let monitor = NWPathMonitor()
    // NWPathMonitor needs its own serial queue; updates arrive off-main and
    // we marshal them onto the main actor below.
    private let queue = DispatchQueue(label: "ag.nuke.capture.networkmonitor")

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            // Capture the verdict off-main (NWPath is not main-isolated), then
            // hop to the main actor to publish it.
            let unmetered = NetworkMonitor.evaluate(path)
            Task { @MainActor in
                self?.isUnmetered = unmetered
            }
        }
        monitor.start(queue: queue)
    }

    /// Pure verdict over an NWPath — kept nonisolated so it can run on the
    /// monitor's queue inside the handler.
    private nonisolated static func evaluate(_ path: NWPath) -> Bool {
        (path.status == .satisfied)
            && !path.isExpensive
            && !path.isConstrained
            && (path.usesInterfaceType(.wifi) || path.usesInterfaceType(.wiredEthernet))
    }
}
