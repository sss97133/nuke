// Gallery.swift — the unit of organization in Blur.
//
// A Gallery is a named group of photo assets. In v0 every gallery is SEEDED
// from Apple's own on-device organization — the user's albums and Apple's
// smart albums (Favorites, Selfies, Screenshots, …). The paid upgrade adds
// galleries discovered by passive AI clustering; the type carries a `source`
// so the UI can distinguish "your album" from "Blur found this".

import Foundation

enum GallerySource: String, Codable {
    case userAlbum      // a collection the user created in Photos
    case smartAlbum     // one of Apple's on-device smart albums
    case clustered      // (paid) discovered by Blur's passive clustering
    case manual         // created by the user inside Blur
}

struct Gallery: Identifiable, Hashable {
    let id: String              // PHAssetCollection.localIdentifier, or "manual:<uuid>"
    let title: String
    let source: GallerySource
    /// PHAsset.localIdentifier of every member, newest first.
    let assetIDs: [String]
    /// Cover thumbnail asset (the gallery's "hero"); nil for an empty gallery.
    let coverAssetID: String?

    var count: Int { assetIDs.count }
}
