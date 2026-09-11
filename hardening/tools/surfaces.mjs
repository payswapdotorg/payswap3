/**
 * UI-009 audit surface registry.
 *
 * Every materialized route under src/app/ (excluding /api) is enumerated
 * here with the concrete fixture IDs used to exercise deep-link states,
 * the owning audience used for the per-surface accessibility pass, and the
 * expected deep-link access matrix derived from the grammar
 * (src/lib/navigation.ts NAVIGATION_ENTRIES audiences) plus the page-level
 * guards (requireRoleSurface calls in each route module).
 */

export const ROLES = [
  'customer',
  'merchant',
  'provider',
  'operator',
  'administrator',
];
export const AUDIENCES = ['unauthenticated', ...ROLES];
export const BASE_URL = 'http://localhost:3000';
export const AUDIENCE_COOKIE = 'payswap-shell-audience';

/** Deep-link expectation: 'render' (page content) or 'home' (redirect to /). */
export const RENDER = 'render';
export const HOME = 'home';

/**
 * Expected deep-link behavior per audience. Derived from:
 *  - page-level requireRoleSurface guards (authorization as implemented), and
 *  - NAVIGATION_ENTRIES audiences (grammar declaration).
 * A grammar-declared audience set with no matching page guard is itself a
 * finding (deep-link leakage) — flagged by the roles audit, not silently
 * encoded as expected here.
 */
export const ALL = [...AUDIENCES];
export const ROLES_ONLY = [...ROLES];

export const SURFACES = [
  {
    id: 'home',
    route: '/',
    audience: 'unauthenticated',
    deepLink: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER },
    note: 'Shell entry surface (UI-001). Always renders the unauthenticated view (getShellAudience is hardcoded until identity ships).',
  },
  {
    id: 'state-primitives',
    route: '/state-primitives',
    audience: 'unauthenticated',
    deepLink: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER },
    note: 'UI-001 verification surface; grammar entry audiences EVERY_AUDIENCE. Renders the full six-state matrix.',
  },
  {
    id: 'pay-compose',
    route: '/pay',
    audience: 'customer',
    deepLink: { unauthenticated: HOME, customer: RENDER, merchant: HOME, provider: HOME, operator: HOME, administrator: HOME },
    note: 'UI-002 customer intent compose; guard requireRoleSurface(customer).',
  },
  {
    id: 'pay-review',
    route: '/pay/review',
    audience: 'customer',
    deepLink: { unauthenticated: HOME, customer: RENDER, merchant: HOME, provider: HOME, operator: HOME, administrator: HOME },
    note: 'UI-002 consequence review; guard requireRoleSurface(customer). Deep link without a session draft renders the no-draft state.',
  },
  {
    id: 'pay-intent-state',
    route: '/pay/INTENT-2041',
    audience: 'customer',
    deepLink: { unauthenticated: HOME, customer: RENDER, merchant: HOME, provider: HOME, operator: HOME, administrator: HOME },
    note: 'UI-002 intent state deep link; guard requireRoleSurface(customer). Unknown intent id renders the UNKNOWN presentation with reconciliation path (never 404).',
  },
  {
    id: 'checkout-list',
    route: '/checkout',
    audience: 'merchant',
    deepLink: { unauthenticated: HOME, customer: HOME, merchant: RENDER, provider: HOME, operator: HOME, administrator: HOME },
    note: 'UI-003 merchant checkout list; guard requireRoleSurface(merchant).',
  },
  {
    id: 'checkout-decision',
    route: '/checkout/cko_live_offer_001',
    audience: 'merchant',
    deepLink: { unauthenticated: HOME, customer: HOME, merchant: RENDER, provider: HOME, operator: HOME, administrator: HOME },
    note: 'UI-003 checkout decision surface; guard requireRoleSurface(merchant). Live offer scenario.',
  },
  {
    id: 'capabilities',
    route: '/capabilities',
    audience: 'provider',
    deepLink: { unauthenticated: HOME, customer: HOME, merchant: HOME, provider: RENDER, operator: HOME, administrator: HOME },
    note: 'UI-004 provider capability surface; guard requireRoleSurface(provider).',
  },
  {
    id: 'capability-detail',
    route: '/capabilities/intent-acceptance',
    audience: 'provider',
    deepLink: { unauthenticated: HOME, customer: HOME, merchant: HOME, provider: RENDER, operator: HOME, administrator: HOME },
    note: 'UI-004 capability detail deep link; guard requireRoleSurface(provider).',
  },
  {
    id: 'liquidity',
    route: '/liquidity',
    audience: 'provider',
    deepLink: { unauthenticated: HOME, customer: HOME, merchant: HOME, provider: RENDER, operator: HOME, administrator: HOME },
    note: 'UI-007 provider liquidity surface; guard requireRoleSurface(provider).',
  },
  {
    id: 'oversight',
    route: '/oversight',
    audience: 'operator',
    deepLink: { unauthenticated: HOME, customer: HOME, merchant: HOME, provider: HOME, operator: RENDER, administrator: HOME },
    note: 'UI-007 operator oversight surface; guard requireRoleSurface(operator).',
  },
  {
    id: 'track',
    route: '/track',
    audience: 'unauthenticated',
    deepLink: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER },
    note: 'UI-005 universal track entry; grammar entry audiences EVERY_AUDIENCE. Deep links per reference are role-checked through the port lookup (content gate).',
  },
  {
    id: 'track-status-intent',
    route: '/track/PWS-2H8D',
    audience: 'customer',
    deepLink: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER },
    contentGate: { authorized: ['customer', 'merchant', 'operator', 'administrator'], denied: ['unauthenticated', 'provider'] },
    note: 'UI-005 track status deep link. Page renders for all audiences; record content is port role-checked: INTENT_AUDIENCES (customer/merchant/operator/administrator); provider+unauthenticated receive the not-authorized presentation.',
  },
  {
    id: 'track-status-settlement',
    route: '/track/STL-4419',
    audience: 'merchant',
    deepLink: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER },
    contentGate: { authorized: ['merchant', 'provider', 'operator', 'administrator'], denied: ['unauthenticated', 'customer'] },
    note: 'UI-005 settlement track deep link. SETTLEMENT_AUDIENCES (merchant/provider/operator/administrator); customer+unauthenticated receive the not-authorized presentation.',
  },
  {
    id: 'waiting-recovery',
    route: '/track/TRK-4410-QUEUED-LIQ/waiting',
    audience: 'customer',
    deepLink: { unauthenticated: HOME, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER },
    contentGate: { authorized: ['customer', 'merchant', 'operator', 'administrator'], denied: ['provider'] },
    note: 'UI-006 waiting/recovery deep link; guard requireRoleSurface(customer + all other roles) — unauthenticated redirected home. Content gate: allowedViewerRoles excludes provider.',
  },
  {
    id: 'mediation-hub',
    route: '/mediation',
    audience: 'customer',
    deepLink: { unauthenticated: HOME, customer: RENDER, merchant: RENDER, provider: HOME, operator: HOME, administrator: HOME },
    note: 'UI-008 dual-party mediation hub; guard requireRoleSurface(customer,[merchant]).',
  },
  {
    id: 'mediation-case',
    route: '/mediation/case/M-101',
    audience: 'customer',
    deepLink: { unauthenticated: HOME, customer: RENDER, merchant: RENDER, provider: HOME, operator: HOME, administrator: HOME },
    note: 'UI-008 mediation case deep link; guard requireRoleSurface(customer,[merchant]).',
  },
  {
    id: 'dispute-initiation',
    route: '/mediation/dispute/new',
    audience: 'customer',
    deepLink: { unauthenticated: HOME, customer: RENDER, merchant: RENDER, provider: HOME, operator: HOME, administrator: HOME },
    note: 'UI-008 dispute initiation; guard requireRoleSurface(customer,[merchant]).',
  },
  {
    id: 'dispute-detail',
    route: '/mediation/dispute/D-201',
    audience: 'customer',
    deepLink: { unauthenticated: HOME, customer: RENDER, merchant: RENDER, provider: HOME, operator: HOME, administrator: HOME },
    note: 'UI-008 dispute detail deep link; guard requireRoleSurface(customer,[merchant]).',
  },
  {
    id: 'proposal-review',
    route: '/mediation/proposal/P-001',
    audience: 'customer',
    deepLink: { unauthenticated: HOME, customer: RENDER, merchant: RENDER, provider: HOME, operator: HOME, administrator: HOME },
    note: 'UI-008 agent proposal review deep link; guard requireRoleSurface(customer,[merchant]).',
  },
  {
    id: 'verification-intent-flow',
    route: '/verification/intent-flow',
    audience: 'unauthenticated',
    deepLink: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER },
    note: 'UI-002 harness; grammar entry verification.intent-flow audiences EVERY_AUDIENCE. Ungated by design.',
  },
  {
    id: 'verification-checkout-flow',
    route: '/verification/checkout-flow',
    audience: 'merchant',
    deepLink: { unauthenticated: HOME, customer: HOME, merchant: RENDER, provider: HOME, operator: RENDER, administrator: RENDER },
    note: 'UI-003 harness; grammar entry verification.checkout-flow audiences [merchant, operator, administrator]; page guarded with requireRoleSurface(merchant,[operator,administrator]).',
  },
  {
    id: 'verification-capability-flow',
    route: '/verification/capability-flow',
    audience: 'unauthenticated',
    deepLink: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER },
    note: 'UI-004 harness; not a grammar entry; provider-nav-entries.json documents it as verification tooling "left ungated to mirror /verification/intent-flow".',
  },
  {
    id: 'verification-liquidity-flow',
    route: '/verification/liquidity-flow',
    audience: 'unauthenticated',
    deepLink: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER },
    note: 'UI-007 harness; not a grammar entry; ungated verification tooling (same documented pattern as capability-flow).',
  },
  {
    id: 'verification-tracking-flow',
    route: '/verification/tracking-flow',
    audience: 'unauthenticated',
    deepLink: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER },
    note: 'UI-005 harness; not a grammar entry; ungated verification tooling.',
  },
  {
    id: 'verification-waiting-flow',
    route: '/verification/waiting-flow',
    audience: 'unauthenticated',
    deepLink: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER },
    note: 'UI-006 harness; not a grammar entry; ungated verification tooling.',
  },
  {
    id: 'verification-mediation-flow',
    route: '/verification/mediation-flow',
    audience: 'operator',
    deepLink: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER },
    deepLinkDeclared: { unauthenticated: HOME, customer: HOME, merchant: HOME, provider: HOME, operator: RENDER, administrator: RENDER },
    note: 'UI-008 harness; grammar entry verification.mediation-flow audiences [operator, administrator] (also mediation-nav-entries.json) — but the page has NO requireRoleSurface guard: deep links from every other audience render harness content. Deep-link leakage vs the declared gate → waiver candidate (closing it requires adding authorization logic, forbidden by UI-009).',
  },
  {
    id: 'not-found',
    route: '/no-such-route-ui009',
    audience: 'unauthenticated',
    deepLink: { unauthenticated: RENDER, customer: RENDER, merchant: RENDER, provider: RENDER, operator: RENDER, administrator: RENDER },
    note: 'App-level 404 surface (src/app/not-found.tsx).',
  },
];

/**
 * Track references used for the explicit-state coverage pass. Expected display
 * states are taken from the mock tracking authority fixtures
 * (src/lib/protocol/mock-tracking-authority.ts SANDBOX_SESSION_RECORDS):
 * PWS-9QM2/5VBM succeeded, PWS-7F3K waiting, STL-4419 waiting (settlement),
 * PWS-2H8D failed, PWS-4TNN in-progress, PWS-6KLP unknown, PWS-8XRQ action-required.
 */
export const STATE_REFERENCE_PAGES = [
  { route: '/track/PWS-9QM2', audience: 'customer', expect: 'succeeded' },
  { route: '/track/PWS-7F3K', audience: 'customer', expect: 'waiting' },
  { route: '/track/PWS-2H8D', audience: 'customer', expect: 'failed' },
  { route: '/track/PWS-4TNN', audience: 'customer', expect: 'in-progress' },
  { route: '/track/PWS-6KLP', audience: 'customer', expect: 'unknown' },
  { route: '/track/PWS-8XRQ', audience: 'customer', expect: 'action-required' },
];

export const BREAKPOINTS = [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];
