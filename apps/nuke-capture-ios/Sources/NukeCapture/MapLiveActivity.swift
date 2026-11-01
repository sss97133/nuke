// MapLiveActivity.swift — what makes the Explore map feel live and fast.
//
//   * ZIPActivityRow / LiveActivityFold: public.map_zip_activity rows (real auction_events + location evidence) folded
//     into a per-ZIP "last 24 hours" signal and the header's "N new today" count. Nothing here is estimated: a ZIP with no
//     row has no activity, and an unread county yields no count at all (the header hides instead of showing 0).
//   * MapObservationWindow presets: the map opens on the last 7 UTC days, not All time.
//   * ViewportSnap: a coarse viewport key so a small pan does not re-run the projection.
//   * ZIPPolygonDiskCache: ZIP polygons are immutable per county; keep the downloaded GeoJSON on the device.
//   * ZIPPulseAnnotation / ZIPPulseView: the pulsing dot drawn on a ZIP with activity in the last 24 hours.

import CoreLocation
import MapKit
import UIKit

// MARK: - Windows

extension MapObservationWindow {
    /// The last `days` UTC calendar days including today (the map's windows are UTC auction-close days).
    static func lastDays(_ days: Int, now: Date = Date()) -> Self {
        let calendar = AuctionLocationClock.calendar
        let today = calendar.startOfDay(for: now)
        guard days > 0, let start = calendar.date(byAdding: .day, value: -(days - 1), to: today),
              let end = calendar.date(byAdding: .day, value: 1, to: today) else { return .all }
        return Self(start: start, end: end)
    }

    /// Windows map_zip_activity answers directly. Longer or unbounded windows stay on the existing paths.
    var isServerEligible: Bool {
        guard let start, let end else { return false }
        return end > start && end.timeIntervalSince(start) <= 90 * 86_400
    }

    var cacheKey: String {
        guard let start, let end else { return "all" }
        return "\(Int(start.timeIntervalSince1970))-\(Int(end.timeIntervalSince1970))"
    }

    var displayLabel: String {
        if self == Self.lastDays(7) { return "Last 7 days" }
        if self == Self.lastDays(30) { return "Last 30 days" }
        return label
    }
}

// MARK: - Rows and fold

/// One row of public.map_zip_activity: per (county partition, ZIP, make).
struct ZIPActivityRow: Decodable, Hashable {
    let county_fips: String?
    let zip: String
    let make: String?
    /// Distinct vehicles whose auction closes inside the requested window (0 when no window was sent).
    let windowed: Int
    let sold_24h: Int
    let listed_24h: Int
    let fresh_24h: Int

    /// The same shape map_zip_counts returns, so the existing ZIP fold colors the window.
    var countRow: ZIPCountRow { ZIPCountRow(county_fips: county_fips, zip: zip, make: make, vehicles: windowed) }
}

struct LiveActivity: Equatable {
    var fresh = 0
    var sold = 0
    var listed = 0
}

enum LiveActivityFold {
    struct Result {
        let total: LiveActivity
        let byZIP: [String: LiveActivity]
    }

    /// Sums last-24h activity over the ZIPs on screen. A ZIP only counts for a partition whose ZCTA membership
    /// contains it (same rule as ZIPCountFold), and the optional make filter is case-insensitive.
    static func fold(_ rows: [ZIPActivityRow], make: String?, crosswalk: [String: String],
                     countyZIPs: [String: Set<String>], visible: Set<String>) -> Result {
        var byZIP: [String: LiveActivity] = [:]
        for row in rows where row.fresh_24h > 0 {
            if let make, row.make?.trimmingCharacters(in: .whitespacesAndNewlines)
                .caseInsensitiveCompare(make) != .orderedSame { continue }
            guard let zip = CountyLocationRow.zip(row.zip), visible.contains(zip), let county = crosswalk[zip] else { continue }
            let partition = row.county_fips ?? ""
            guard countyZIPs[partition]?.contains(zip) ?? (county == partition) else { continue }
            var live = byZIP[zip] ?? LiveActivity()
            live.fresh += row.fresh_24h; live.sold += row.sold_24h; live.listed += row.listed_24h
            byZIP[zip] = live
        }
        var total = LiveActivity()
        for live in byZIP.values { total.fresh += live.fresh; total.sold += live.sold; total.listed += live.listed }
        return Result(total: total, byZIP: byZIP)
    }
}

// MARK: - Viewport snapping

/// Quantizes a visible map rect to half-octave zoom steps and quarter-screen cells, so panning less than about a
/// quarter of the screen yields the same key (no re-projection) while zooming or a real move yields a new one.
struct ViewportSnap: Hashable {
    let x: Int
    let y: Int
    let zoom: Int

    init?(_ rect: MKMapRect?) {
        guard let rect, rect.width.isFinite, rect.width > 0, rect.height.isFinite else { return nil }
        let level = Int((log2(rect.width) * 2).rounded())
        let cell = pow(2.0, Double(level) / 2) / 4
        x = Int((rect.midX / cell).rounded(.down))
        y = Int((rect.midY / cell).rounded(.down))
        zoom = level
    }
}

// MARK: - ZIP polygon disk cache

/// County ZCTA GeoJSON is immutable (map-data/geo/v1/county/<fips>.geojson), so a copy on disk is always valid.
/// It lives in Caches, so the system may reclaim it; a corrupt or missing file just means one network read.
struct ZIPPolygonDiskCache {
    let directory: URL
    var maxFiles = 80

    static let shared = ZIPPolygonDiskCache(
        directory: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("zip-areas-v1", isDirectory: true))

    private func file(_ fips: String) -> URL? {
        guard fips.count == 5, fips.allSatisfy({ $0 >= "0" && $0 <= "9" }) else { return nil }
        return directory.appendingPathComponent("\(fips).geojson")
    }

    func read(_ fips: String) -> Data? {
        guard let url = file(fips), let data = try? Data(contentsOf: url), !data.isEmpty else { return nil }
        return data
    }

    func write(_ data: Data, fips: String) {
        guard let url = file(fips), !data.isEmpty else { return }
        let manager = FileManager.default
        try? manager.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
        trim()
    }

    func remove(_ fips: String) {
        if let url = file(fips) { try? FileManager.default.removeItem(at: url) }
    }

    /// Keeps the most recently written `maxFiles` counties.
    func trim() {
        let manager = FileManager.default
        guard let urls = try? manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey]),
              urls.count > maxFiles else { return }
        let dated = urls.map { url -> (URL, Date) in
            (url, (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast)
        }.sorted { $0.1 < $1.1 }
        for (url, _) in dated.prefix(urls.count - maxFiles) { try? manager.removeItem(at: url) }
    }
}

// MARK: - Pulse annotation

final class ZIPPulseAnnotation: NSObject, MKAnnotation {
    let zip: String
    let coordinate: CLLocationCoordinate2D
    let fresh: Int
    let sold: Int
    let listed: Int
    init(zip: String, coordinate: CLLocationCoordinate2D, fresh: Int, sold: Int, listed: Int) {
        self.zip = zip; self.coordinate = coordinate; self.fresh = fresh; self.sold = sold; self.listed = listed
    }
    var key: String { "\(zip):\(fresh):\(sold):\(listed)" }
    var summary: String {
        "ZIP \(zip): \(fresh) new in the last 24 hours, \(sold) sold, \(listed) newly listed"
    }
}

/// A solid dot with a ring that expands and fades. Reduce Motion keeps the ring still.
final class ZIPPulseView: MKAnnotationView {
    private let ring = CAShapeLayer()
    private let core = CAShapeLayer()

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        frame = CGRect(x: 0, y: 0, width: 44, height: 44)
        backgroundColor = .clear
        canShowCallout = false
        collisionMode = .none
        displayPriority = .required
        zPriority = .max
        ring.fillColor = UIColor.systemOrange.withAlphaComponent(0.35).cgColor
        core.fillColor = UIColor.systemOrange.cgColor
        core.strokeColor = UIColor.white.cgColor
        core.lineWidth = 1.5
        layer.addSublayer(ring); layer.addSublayer(core)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func configure(_ pulse: ZIPPulseAnnotation) {
        let diameter = CGFloat(10 + min(pulse.fresh, 5) * 2)
        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        let rect = CGRect(x: center.x - diameter / 2, y: center.y - diameter / 2, width: diameter, height: diameter)
        for shape in [ring, core] {
            shape.frame = bounds
            shape.path = UIBezierPath(ovalIn: rect).cgPath
        }
        isAccessibilityElement = true
        accessibilityLabel = pulse.summary
        accessibilityTraits = .button
        startPulse()
    }

    private func startPulse() {
        ring.removeAllAnimations()
        guard !UIAccessibility.isReduceMotionEnabled else { return }
        let scale = CABasicAnimation(keyPath: "transform.scale")
        scale.fromValue = 1.0; scale.toValue = 3.0
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0.9; fade.toValue = 0.0
        let group = CAAnimationGroup()
        group.animations = [scale, fade]
        group.duration = 1.8
        group.repeatCount = .infinity
        group.timingFunction = CAMediaTimingFunction(name: .easeOut)
        ring.add(group, forKey: "pulse")
    }

    override func prepareForDisplay() {
        super.prepareForDisplay()
        startPulse()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil { startPulse() }
    }
}
