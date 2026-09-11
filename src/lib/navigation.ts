/**
 * PaySwap product shell — THE navigation grammar (UI-001).
 *
 * P1 — there is exactly ONE navigation grammar for the whole product. It is
 * defined here, in the application shell, and consumed by every surface:
 * the shell header, the shell footer, and every route render their
 * navigation through `resolveNavigation` plus the shared `NavList`
 * renderer (src/components/shell/nav-list.tsx). No surface may define a
 * local navigation paradigm, ad hoc menu, or orphan route; extensions to
 * the grammar go through this module — never around it.
 *
 * This module also pins the shared breakpoint set (P10): the only
 * breakpoint set surfaces may use, defined and documented once here.
 */

/** The five product roles (UX contract Section 4). Role truth is an authoritative input. */
export const ROLES = [
  'customer',
  'merchant',
  'provider',
  'operator',
  'administrator',
] as const;
export type Role = (typeof ROLES)[number];

/** Navigation audiences: the five roles plus the unauthenticated viewer. */
export const NAV_AUDIENCES = ['unauthenticated', ...ROLES] as const;
export type NavAudience = (typeof NAV_AUDIENCES)[number];

/** `available` routes render and navigate; `planned` routes are reserved but inert. */
export type NavEntryStatus = 'available' | 'planned';

/** Where the entry renders: the header (primary) or the footer. */
export type NavEntryKind = 'primary' | 'footer';

export interface NavEntry {
  readonly id: string;
  readonly label: string;
  /** Route reserved by the grammar. Planned routes stay inert until their owning work item ships. */
  readonly href: string;
  readonly description: string;
  /** Audiences allowed to see and reach this entry (P8: role-gated). */
  readonly audiences: readonly NavAudience[];
  readonly status: NavEntryStatus;
  readonly kind: NavEntryKind;
}

const EVERY_AUDIENCE: readonly NavAudience[] = [
  'unauthenticated',
  'customer',
  'merchant',
  'provider',
  'operator',
  'administrator',
];

/**
 * The full navigation registry — the single place later work items register
 * their surfaces. Planned entries reserve routes in the grammar now and are
 * rendered inert (non-navigating, tagged Planned) until they ship; this is
 * what keeps the entry points documented and the routes non-orphan (P1).
 */
export const NAVIGATION_ENTRIES: readonly NavEntry[] = [
  {
    id: 'home',
    label: 'Home',
    href: '/',
    description: 'Shell entry surface for every audience (UI-001).',
    audiences: EVERY_AUDIENCE,
    status: 'available',
    kind: 'primary',
  },
  {
    id: 'state-primitives',
    label: 'State primitives (verification)',
    href: '/state-primitives',
    description:
      'UI-001 verification surface: state-primitive matrix, environment derivation, role-routing matrix, grammar registry.',
    audiences: EVERY_AUDIENCE,
    status: 'available',
    kind: 'footer',
  },
  {
    id: 'customer-intents',
    label: 'Intent creation',
    href: '/customer/intents',
    description: 'Customer surface — planned; ships in a later work item.',
    audiences: ['customer'],
    status: 'planned',
    kind: 'primary',
  },
  {
    id: 'customer-tracking',
    label: 'Personal tracking & evidence',
    href: '/customer/tracking',
    description: 'Customer surface — planned; ships in a later work item.',
    audiences: ['customer'],
    status: 'planned',
    kind: 'primary',
  },
  {
    id: 'customer-recovery',
    label: 'Waiting & recovery',
    href: '/customer/recovery',
    description: 'Customer surface — planned; ships in a later work item.',
    audiences: ['customer'],
    status: 'planned',
    kind: 'primary',
  },
  {
    id: 'customer-disputes',
    label: 'Mediation & disputes',
    href: '/customer/disputes',
    description: 'Customer surface — planned; ships in a later work item.',
    audiences: ['customer'],
    status: 'planned',
    kind: 'primary',
  },
  {
    // UI-002: customer payment intent surface — the first available customer entry.
    id: 'customer.pay.compose',
    label: 'Send a payment intent',
    href: '/pay',
    description:
      'State the outcome you want, review the full consequences in plain language, and submit a single payment intent explicitly.',
    audiences: ['customer'],
    status: 'available',
    kind: 'primary',
  },
  {
    // UI-003: merchant checkout surface (splice from spec/product/merchant-nav-entries.json).
    id: 'merchant-checkout',
    label: 'Checkout',
    href: '/checkout',
    description:
      'Review open offers and quotes with their full consequences before any commitment; accept or decline explicitly.',
    audiences: ['merchant'],
    status: 'available',
    kind: 'primary',
  },
  {
    id: 'merchant-offers',
    label: 'Offers & quotes',
    href: '/merchant/offers',
    description: 'Merchant surface — planned; ships in a later work item.',
    audiences: ['merchant'],
    status: 'planned',
    kind: 'primary',
  },
  {
    id: 'merchant-tracking',
    label: 'Merchant tracking & evidence',
    href: '/merchant/tracking',
    description: 'Merchant surface — planned; ships in a later work item.',
    audiences: ['merchant'],
    status: 'planned',
    kind: 'primary',
  },
  {
    // UI-004: provider capability surface (splice from spec/product/provider-nav-entries.json).
    id: 'provider-capabilities',
    label: 'Capabilities',
    href: '/capabilities',
    description:
      'Read-only presentation of protocol capability and routing truth, exactly as the authority reports it.',
    audiences: ['provider'],
    status: 'available',
    kind: 'primary',
  },
  {
    id: 'provider-tracking',
    label: 'Provider positions & tracking',
    href: '/provider/tracking',
    description: 'Provider surface — planned; ships in a later work item.',
    audiences: ['provider'],
    status: 'planned',
    kind: 'primary',
  },
  {
    id: 'operator-overview',
    label: 'Operations overview (read-only)',
    href: '/operator/overview',
    description:
      'Operator surface — planned; read-only visibility bounded by protocol authorities.',
    audiences: ['operator'],
    status: 'planned',
    kind: 'primary',
  },
  {
    id: 'administrator-visibility',
    label: 'Administration (visibility only)',
    href: '/administrator/visibility',
    description:
      'Administrator surface — planned; administrative visibility only. UI visibility is never protocol authority.',
    audiences: ['administrator'],
    status: 'planned',
    kind: 'primary',
  },
  {
    // UI-002: intent-flow verification harness — available to every audience.
    id: 'verification.intent-flow',
    label: 'Intent flow verification',
    href: '/verification/intent-flow',
    description:
      'Verification harness for the customer payment intent surface: full workflow, the intent state matrix including UNKNOWN, the role matrix, and the adapter boundary report.',
    audiences: EVERY_AUDIENCE,
    status: 'available',
    kind: 'footer',
  },
  {
    // UI-005: universal track/status surface — one entry for every audience
    // (splice from spec/product/track-nav-entries.json).
    id: 'track',
    label: 'Track a payment',
    href: '/track',
    description:
      'Look up the current state, plain-language history, and proof trail of a tracked payment or settlement reference.',
    audiences: EVERY_AUDIENCE,
    status: 'available',
    kind: 'footer',
  },
  {
    // UI-003: checkout-flow verification harness (verification tooling).
    id: 'verification.checkout-flow',
    label: 'Checkout flow verification',
    href: '/verification/checkout-flow',
    description:
      'Merchant checkout verification harness: accept/decline flows, state matrix, role matrix, adapter boundary report.',
    audiences: ['merchant', 'operator', 'administrator'],
    status: 'available',
    kind: 'footer',
  },
  {
    // UI-007: provider liquidity surface (splice from
    // spec/product/liquidity-nav-entries.json).
    id: 'provider-liquidity',
    label: 'Liquidity positions',
    href: '/liquidity',
    description:
      'Read-only liquidity, credit, and queued positions quoted by the Liquidity Authority and the Credit Authority (runtime ARRIVING; presentation-only mock backing).',
    audiences: ['provider'],
    status: 'available',
    kind: 'primary',
  },
  {
    // UI-007: operator oversight surface (splice from
    // spec/product/liquidity-nav-entries.json).
    id: 'operator-oversight',
    label: 'Oversight',
    href: '/oversight',
    description:
      'Authority-quoted oversight aggregates permitted to operators by the Liquidity Authority and the Credit Authority (runtime ARRIVING; presentation-only mock backing).',
    audiences: ['operator'],
    status: 'available',
    kind: 'primary',
  },
];

/**
 * Name of the session signal carrying the SIMULATED authoritative audience
 * used by verification surfaces (UI-002). This is a test/verification
 * mechanism in the same NON-AUTHORITATIVE class as the mock intent adapter:
 * it grants no product capability by itself — every guarded surface still
 * evaluates the audience through guardSurface on entry (P8). Role truth
 * remains an authoritative input; the identity work item replaces this
 * simulated signal with its real authoritative source when it ships.
 */
export const SHELL_AUDIENCE_COOKIE = 'payswap-shell-audience';

/** Navigation resolved for exactly one audience. */
export interface ResolvedNavigation {
  readonly primary: readonly NavEntry[];
  readonly footer: readonly NavEntry[];
}

/**
 * Resolve the navigation for one audience (P8). Entries whose audiences do
 * not include the viewer are filtered out here — for navigation, content,
 * and deep links alike.
 */
export function resolveNavigation(audience: NavAudience): ResolvedNavigation {
  const visible = NAVIGATION_ENTRIES.filter((entry) =>
    entry.audiences.includes(audience),
  );
  return {
    primary: visible.filter((entry) => entry.kind === 'primary'),
    footer: visible.filter((entry) => entry.kind === 'footer'),
  };
}

/**
 * Deep-link role check (P1, P8). Status views are deep-linkable, and direct
 * entry re-checks the viewer role with this helper. A deep link never
 * bypasses the grammar or the role gate. Role-gated surfaces call this on
 * direct entry when they ship.
 */
export function guardSurface(
  audience: NavAudience,
  allowed: readonly NavAudience[],
): boolean {
  return allowed.includes(audience);
}

/**
 * The audience the live shell renders. Role assignment is an authoritative
 * input (identity/configuration) — the UI never self-assigns, infers, or
 * escalates roles (P8). No identity input exists in UI-001, so the shell
 * renders the unauthenticated view — least visibility. When the identity
 * work item ships, it feeds this function from its authoritative input.
 */
export function getShellAudience(): NavAudience {
  return 'unauthenticated';
}

/**
 * The shared breakpoint set (P10) — defined once, here, and documented.
 * Surfaces MUST NOT define divergent sets. Values mirror the Tailwind CSS
 * default scale used by the shell stylesheet (src/app/globals.css).
 */
export const BREAKPOINTS = [
  {
    name: 'sm',
    minWidthPx: 640,
    role: 'Large phones: single-column layouts; touch targets stay 44px.',
  },
  {
    name: 'md',
    minWidthPx: 768,
    role: 'Tablets: two-column content grids; navigation stays one row.',
  },
  {
    name: 'lg',
    minWidthPx: 1024,
    role: 'Small laptops: three-column matrices; role matrix opens up.',
  },
  {
    name: 'xl',
    minWidthPx: 1280,
    role: 'Desktops: full shell width; no behavior changes.',
  },
  {
    name: '2xl',
    minWidthPx: 1536,
    role: 'Large screens: content caps at the max shell width.',
  },
] as const;

/**
 * Grammar rules, surfaced verbatim on the verification surface so the
 * documentation and the implementation share one source.
 */
export const NAVIGATION_GRAMMAR_RULES: readonly string[] = [
  'Primary navigation is declared only in the grammar module (src/lib/navigation.ts) and rendered only through the shared NavList component (src/components/shell/nav-list.tsx).',
  'Back/close semantics: the shell renders no ad hoc back or close controls. Back is the platform back affordance (browser history); close returns to the parent surface declared by the owning surface when it ships. Behavior is identical everywhere because no surface redefines it.',
  'Deep links: status views are deep-linkable, and direct entry re-checks the viewer role with guardSurface. A deep link never bypasses the grammar or the role gate.',
  'Role filtering: entries declare their audiences; unknown or unauthenticated viewers get least visibility (P8).',
  'Planned entries reserve routes in the grammar but stay inert (non-navigating, tagged Planned) until the owning work item ships them.',
  'Extensions to the grammar go through this module — never around it.',
];

/** Display label for one audience. */
export function audienceLabel(audience: NavAudience): string {
  switch (audience) {
    case 'unauthenticated':
      return 'Unauthenticated';
    case 'customer':
      return 'Customer';
    case 'merchant':
      return 'Merchant';
    case 'provider':
      return 'Provider';
    case 'operator':
      return 'Operator';
    case 'administrator':
      return 'Administrator';
  }
}

/** Short note explaining one audience panel on the verification surface. */
export function audienceNote(audience: NavAudience): string {
  switch (audience) {
    case 'unauthenticated':
      return 'Least visibility (P8). This is the live shell view today — UI-001 ships no identity input, so the shell never guesses a role.';
    case 'customer':
      return 'Customer surfaces: intent creation, personal tracking and evidence, waiting/recovery, mediation and dispute views. Planned — later work items.';
    case 'merchant':
      return 'Merchant surfaces: checkout and offer/quote handling, merchant-side tracking and evidence. Planned — later work items.';
    case 'provider':
      return 'Provider surfaces: capability presentation, provider-side positions and tracking. Planned — later work items.';
    case 'operator':
      return 'Operator surfaces: read-only operational visibility, exactly as permitted by the owning protocol authorities. Planned — later work item.';
    case 'administrator':
      return 'Administrator surfaces: administrative visibility, exactly as permitted. UI visibility is never protocol authority. Planned — later work item.';
  }
}
