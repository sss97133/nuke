// TusUpload.swift — resumable uploads to Supabase Storage (the TUS protocol, version 1.0.0).
//
// A preview is small, but the full file is not, and a phone drops off Wi-Fi mid-transfer. TUS lets an
// upload continue from the byte the server already holds: the create call returns an upload URL, each
// PATCH sends one 6 MiB chunk, and after a relaunch a HEAD says where to resume. The upload URL and
// offset are persisted by the caller (VideoUploadRecord), so a killed app picks up where it stopped.
//
// Request building and chunk planning are pure so the unit tests cover them without a network.
// The URLSession is configured Wi-Fi only (no cellular, expensive or constrained links) by default.

import Foundation

struct TusProgress: Codable, Equatable, Sendable {
    var uploadURL: String? = nil
    var offset: Int64 = 0
}

enum TusError: Error, Equatable {
    case createFailed(Int)
    case patchFailed(Int)
    case missingLocation
    case missingOffset
    case sourceUnreadable
}

enum Tus {
    static let version = "1.0.0"

    static var endpoint: URL {
        var url = Config.supabaseURL
        url.append(path: "storage/v1/upload/resumable")
        return url
    }

    static func b64(_ s: String) -> String { Data(s.utf8).base64EncodedString() }

    static func metadataHeader(bucket: String, objectName: String, contentType: String) -> String {
        [("bucketName", bucket), ("objectName", objectName), ("contentType", contentType), ("cacheControl", "3600")]
            .map { "\($0.0) \(b64($0.1))" }
            .joined(separator: ",")
    }

    private static func base(_ url: URL, method: String, accessToken: String) -> URLRequest {
        var r = URLRequest(url: url)
        r.httpMethod = method
        r.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        r.setValue(Config.supabaseAnonKey, forHTTPHeaderField: "apikey")
        r.setValue(version, forHTTPHeaderField: "Tus-Resumable")
        return r
    }

    /// POST that creates the upload. `x-upsert: false`: an object already at the path is a 409, never overwritten.
    static func createRequest(endpoint: URL, accessToken: String, length: Int64,
                              bucket: String, objectName: String, contentType: String) -> URLRequest {
        var r = base(endpoint, method: "POST", accessToken: accessToken)
        r.setValue(String(length), forHTTPHeaderField: "Upload-Length")
        r.setValue(metadataHeader(bucket: bucket, objectName: objectName, contentType: contentType),
                   forHTTPHeaderField: "Upload-Metadata")
        r.setValue("false", forHTTPHeaderField: "x-upsert")
        return r
    }

    static func headRequest(url: URL, accessToken: String) -> URLRequest {
        base(url, method: "HEAD", accessToken: accessToken)
    }

    static func patchRequest(url: URL, accessToken: String, offset: Int64) -> URLRequest {
        var r = base(url, method: "PATCH", accessToken: accessToken)
        r.setValue(String(offset), forHTTPHeaderField: "Upload-Offset")
        r.setValue("application/offset+octet-stream", forHTTPHeaderField: "Content-Type")
        return r
    }

    /// The next byte range to send, or nil when the file is complete.
    static func nextChunk(offset: Int64, total: Int64, chunkBytes: Int = VideoSyncConfig.tusChunkBytes) -> Range<Int64>? {
        guard offset >= 0, offset < total else { return nil }
        return offset..<min(total, offset + Int64(chunkBytes))
    }

    static func offset(from response: HTTPURLResponse) -> Int64? {
        response.value(forHTTPHeaderField: "Upload-Offset").flatMap { Int64($0) }
    }

    /// The upload URL from a create response (absolute, or relative to the endpoint).
    static func uploadURL(from response: HTTPURLResponse, endpoint: URL) -> URL? {
        guard let location = response.value(forHTTPHeaderField: "Location") else { return nil }
        return URL(string: location, relativeTo: endpoint)?.absoluteURL
    }

    /// A session that never uses cellular, a hotspot or Low Data Mode when `wifiOnly`.
    static func makeSession(wifiOnly: Bool) -> URLSession {
        let c = URLSessionConfiguration.default
        c.allowsCellularAccess = !wifiOnly
        c.allowsExpensiveNetworkAccess = !wifiOnly
        c.allowsConstrainedNetworkAccess = !wifiOnly
        c.waitsForConnectivity = false
        c.timeoutIntervalForRequest = 60
        return URLSession(configuration: c)
    }

    /// Sends `file` to `bucket/objectName`, resuming from `progress`. `persist` is called after every
    /// step that changes it. Returns normally when the object is complete (or already exists: the path
    /// is keyed by the asset, so an existing object is this same upload).
    nonisolated static func upload(file: URL, bucket: String, objectName: String, contentType: String,
                                   accessToken: String, progress: TusProgress, session: URLSession,
                                   persist: @Sendable (TusProgress) -> Void) async throws {
        var state = progress
        guard let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value,
              size > 0 else { throw TusError.sourceUnreadable }

        // Resume: ask the server where the upload stands; a vanished upload URL starts over.
        if let s = state.uploadURL, let url = URL(string: s) {
            let (_, resp) = try await session.data(for: headRequest(url: url, accessToken: accessToken))
            if let http = resp as? HTTPURLResponse, http.statusCode == 200 || http.statusCode == 204,
               let off = offset(from: http) {
                state.offset = off
            } else {
                state = TusProgress()
            }
        }
        if state.uploadURL == nil {
            let req = createRequest(endpoint: endpoint, accessToken: accessToken, length: size,
                                    bucket: bucket, objectName: objectName, contentType: contentType)
            let (_, resp) = try await session.data(for: req)
            guard let http = resp as? HTTPURLResponse else { throw TusError.createFailed(0) }
            if http.statusCode == 409 { return }                       // already there
            guard http.statusCode == 201 else { throw TusError.createFailed(http.statusCode) }
            guard let url = uploadURL(from: http, endpoint: endpoint) else { throw TusError.missingLocation }
            state = TusProgress(uploadURL: url.absoluteString, offset: 0)
        }
        persist(state)

        guard let urlString = state.uploadURL, let url = URL(string: urlString),
              let handle = try? FileHandle(forReadingFrom: file) else { throw TusError.sourceUnreadable }
        defer { try? handle.close() }
        while let range = nextChunk(offset: state.offset, total: size) {
            try handle.seek(toOffset: UInt64(range.lowerBound))
            guard let chunk = try handle.read(upToCount: Int(range.upperBound - range.lowerBound)),
                  Int64(chunk.count) == range.upperBound - range.lowerBound else { throw TusError.sourceUnreadable }
            let (_, resp) = try await session.upload(for: patchRequest(url: url, accessToken: accessToken, offset: state.offset), from: chunk)
            guard let http = resp as? HTTPURLResponse, http.statusCode == 204 || http.statusCode == 200 else {
                throw TusError.patchFailed((resp as? HTTPURLResponse)?.statusCode ?? 0)
            }
            guard let next = offset(from: http) else { throw TusError.missingOffset }
            state.offset = next
            persist(state)
        }
    }
}
