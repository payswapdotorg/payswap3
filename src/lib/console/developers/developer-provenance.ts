/**
 * PC-005 — The honest data-provenance notes for every in-memory developer
 * surface (design §11 architecture ruling).
 *
 * The repository has NO credential/webhook/request-log authority at baseline
 * (the recorded design §17 developer-request-log gap; the reconciliation
 * matrix row stayed PENDING-PC-005 until this work item). PC-005 therefore
 * builds console-owned IN-MEMORY stores under this root:
 *
 *   - module-scoped, process-lifetime state — cleared on restart, labeled
 *     so in the UI;
 *   - SANCTIONED because developer controls are NOT financial truth (design
 *     §11 separates them): an API key record or a webhook endpoint registry
 *     is a developer convenience, never protocol evidence, never a balance,
 *     never a settlement fact — so in-memory avoids inventing durable
 *     infrastructure the protocol does not sanction;
 *   - every store surface renders the note below verbatim, so a viewer can
 *     never mistake this data for durable protocol state.
 *
 * Console logs are diagnostic records, not evidence substitutes (design
 * §11): the diagnostic note below is attached to every request-log surface.
 */

/**
 * The data-provenance note every in-memory developer surface renders.
 * Honest by construction: it names the storage semantics (process memory,
 * cleared on restart) and the authority semantics (not protocol evidence).
 */
export const IN_MEMORY_DEVELOPER_SURFACE_NOTE =
  'In-memory developer surface — not durable, not protocol evidence: this data lives only in the current server process, is cleared on restart, and is developer-tooling state, never financial truth (design §11 separates developer controls from protocol financial truth).';

/**
 * The diagnostic-versus-evidence note every request-log / request-inspector
 * surface renders (design §11: "Console logs are diagnostic records, not
 * evidence substitutes").
 */
export const DEVELOPER_DIAGNOSTIC_NOT_EVIDENCE_NOTE =
  'Diagnostic data, not protocol evidence: these records describe requests that crossed the console API boundary for troubleshooting. They are not A15 evidence, not reconciliation input, and never a financial verdict; the authoritative protocol evidence lives in the closed A15 evidence chain.';
