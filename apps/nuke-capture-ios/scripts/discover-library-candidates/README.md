# Local Photos candidate replay

This compiles the same Foundation-only selector used by the iOS Library. It reads a private JSON export from stdin and writes JSON to stdout. It makes no network or model call and does not file or upload photos.

From `apps/nuke-capture-ios`:

```sh
swiftc Sources/NukeCapture/LibraryCandidateDiscovery.swift scripts/discover-library-candidates/main.swift -o /private/tmp/library-candidates
/private/tmp/library-candidates < /absolute/private/input.json > /absolute/private/output.json
```

Input:

```json
{
  "targetVehicleId": "vehicle UUID or empty string",
  "timeZoneIdentifier": "America/Los_Angeles",
  "seedAssetIds": ["selected source photo ID"],
  "assets": [{
    "id": "stable PhotoKit local ID",
    "sourceVersion": "current modification-date version or null",
    "captureAt": "2025-05-13T21:40:00Z",
    "captureClockBasis": "photokit_creation",
    "latitude": null,
    "longitude": null,
    "labels": [],
    "reviewSourceVersion": null,
    "labelSource": null,
    "exactVehicleIds": [],
    "filedVehicleId": null,
    "recordedVehicleIds": [],
    "isPersonal": false
  }]
}
```

Use `null` for missing GPS, including Photos' `-180` sentinel. `captureAt` is ISO 8601; set `captureClockBasis` to `original_exif` only when the original was actually read, otherwise `photokit_creation`. The selector uses the supplied timezone for local workdays. A cached Vision label is used only when `reviewSourceVersion` equals the current `sourceVersion`. If a label came directly from current Photos metadata, set `labelSource` to `current_source_metadata`. With neither provenance, labels are ignored. An exact serial match remains a candidate; `filedVehicleId` is only a recorded local association. Both can conflict.

The output keeps three different sets: `candidates` near an exact serial candidate or chosen source seed; `unplaced` all source-visible images, because this input has no owner-confirmed filing status; and `workPool` locally work-tagged source images. `recordedVehicleIds` may list several historical local associations for one visible source. They are review controls even when the current image is unread or its prior review is stale; they never independently anchor or remove a photo. `filedVehicleId` is accepted for older replay inputs and has the same limited meaning. A chosen source seed replaces target anchors for that pass. A target with no anchor and no chosen seed can have zero `candidates` while the source inventory remains available. Every candidate needs review. Reasons explain the deterministic rule, not a probability or a confirmed vehicle/work claim.

The iOS source catalog and this selector cover images only. Videos, inaccessible Photos, unavailable clocks, stale or unread originals, and changes to Photos permission remain explicit coverage limits. Broad work tags and an anchor's workday or approximate location can include another car or personal image; the selector exposes conflicts for review and never changes the privacy or filing gates. A selected source seed can retrieve nearby no-GPS frames from their clocks even when Vision labels are unavailable. Only the current permission-visible source list is supplied to the selector; removed sources vanish on the next catalog refresh.

Offline replay check:

```sh
swiftc Sources/NukeCapture/LibraryCandidateDiscovery.swift Tests/LibraryCandidateDiscoveryReplay.swift -o /private/tmp/library-candidate-tests
/private/tmp/library-candidate-tests
```
