// Config.swift — app-wide constants for Blur.
//
// v0 is PURE LOCAL: there is no backend URL or key here on purpose. Photos and
// the organization layer live only on this device. The placeholders for the
// future paid-upgrade backend (a DEDICATED Supabase project — never Nuke prod)
// are left as commented breadcrumbs so the "fill in keys" step is obvious when
// the automatic-image-handling phase begins.

import Foundation

enum Config {
    // ─── Identity ────────────────────────────────────────────────────────────
    static let appName = "Blur"

    /// BGAppRefreshTask identifier — must match BGTaskSchedulerPermittedIdentifiers
    /// in project.yml.
    static let refreshTaskID = "ag.nuke.blur.refresh"

    // ─── Scan tuning ─────────────────────────────────────────────────────────
    /// Smart-album subtypes surfaced as galleries in v0, in display order.
    /// These are Apple's own on-device classifications — the free "seed" layer.
    /// (User-created albums are always surfaced first, ahead of these.)

    /// Max thumbnails to keep warm per gallery cover render.
    static let coverThumbnailSide: CGFloat = 160

    // ─── Paid upgrade backend (NOT v0) ───────────────────────────────────────
    // When automatic image handling ships, point these at a NEW, dedicated
    // Supabase project — NOT Nuke production (qkgaybvrernstplzjaam). The free
    // tier must keep working with these unset.
    //
    // static let supabaseURL = URL(string: "https://<NEW-PROJECT>.supabase.co")!
    // static let supabaseAnonKey = "<NEW-PROJECT-ANON-KEY>"   // public by design
}
