# ios-vision-triage

The iOS app decides on the phone which photo pixels may leave it (`apps/nuke-capture-ios/Sources/NukeCapture/VisionEngine.swift`).
Photos that reached storage by other paths (iPhoto, archive imports) never met that rule. This folder runs the same
rule on a Mac: `build.sh` compiles `VisionEngine.swift` unchanged (Mac Catalyst target) beside `main.swift`, and
`hold-vehicle.mjs` judges one vehicle's public frames and, with `--apply`, sends the holds to
`hold_frames_by_device_triage` (migration `20261016151000_device_triage_holds_and_public_cover.sql`).

    dotenvx run -- node scripts/ios-vision-triage/hold-vehicle.mjs <vehicle_id>          # verdicts only
    dotenvx run -- node scripts/ios-vision-triage/hold-vehicle.mjs <vehicle_id> --apply  # hold them

Held: clutter (a top-three label is a document, receipt, web or product capture) and personal (a prominent face
and no vehicle). Kept: everything else, including part close-ups Apple does not tag as a vehicle. The rule says
which pixels may be public; it does not say which vehicle a frame shows, so it never un-hides a frame the gate holds.
