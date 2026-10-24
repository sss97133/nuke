// WebLink.swift — one place that turns a recorded source string into a URL a Link can open.
//
// Profile and vehicle pages built links with a bare URL(string:). That returned a URL with no
// scheme for "bringatrailer.com/listing/x" (Link silently does nothing), nil for any URL with a
// space or a leading newline (the row vanished or rendered as a dead label), and accepted
// "http:" with no host. This normalizes once and refuses anything that would not open a page.

import Foundation

enum WebLink {
    static func url(_ raw: String?) -> URL? {
        guard var s = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        let lower = s.lowercased()
        if !lower.hasPrefix("http://") && !lower.hasPrefix("https://") {
            // A bare host path ("bringatrailer.com/listing/x", "www.x.com") is a web page;
            // anything else (an id, "mailto:", a relative path) is not ours to guess.
            guard !s.contains(":"), let host = s.split(separator: "/").first, host.contains("."),
                  !host.hasPrefix(".") else { return nil }
            s = "https://" + s
        }
        let encoded = URL(string: s) ?? s.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed).flatMap(URL.init(string:))
        guard let url = encoded, ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              let host = url.host, host.contains(".") else { return nil }
        return url
    }
}
