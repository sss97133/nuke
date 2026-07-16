// Cockpit shared types.
//
// Recovered 2026-05-03 alongside attribute-registry.ts after the source had
// been deployed to prod but never committed to git. Reconstructed from usage
// patterns in attribute-registry.ts (only ResultKind is consumed externally
// from this file at present).
//
// `result_kind` distinguishes substrate (direct measurement on the captured
// artifact — e.g. a vehicle bbox in an image, a pixel-level color reading)
// from projection (inference about the world — e.g. this vehicle is a 1977
// K5 Blazer; period-correctness; ownership era). See observation-projection-boundary.md.

export type ResultKind = "substrate" | "projection";
