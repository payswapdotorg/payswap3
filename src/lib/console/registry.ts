/**
 * PC-001 — The frozen console route/module registry (design §5 information
 * architecture, exact).
 *
 * Top-level grammar (frozen for the change set):
 *
 *   /console
 *   ├── Overview
 *   ├── Payments        [all, [paymentId]]
 *   ├── Checkout        [sessions, configuration, test]
 *   ├── Accounts        [customers, merchants, providers, operators]
 *   ├── Capabilities
 *   ├── Developers      [api-keys, webhooks, logs, request-inspector, environments]
 *   ├── Operations      [queues, execution, reconciliation, unknown, clearing-netting, incidents]
 *   └── Documentation   [api, concepts, examples, guides]
 *
 * Every entry carries its route path, module id, allowed roles (from the
 * design §6 role model — the EXISTING repository role vocabulary
 * `ROLES` in src/lib/navigation.ts), and status. Status policy for the
 * first release: composed feature views are `planned` until PC-004/PC-005
 * merge; only the `/console` foundation root is `available` (PC-001 renders
 * the registry summary + server-derived environment label, no feature
 * views). Later phases flip entries to `available` through their own
 * governed work orders.
 *
 * The registry is the single source of truth for the module-level access map
 * consumed by the role policy (src/lib/console/policy.ts derives
 * CONSOLE_MODULE_ACCESS from these entries), and for the route-role matrix
 * (spec/console/route-role-matrix.md — cross-checked mechanically by
 * src/lib/console/registry.test.ts).
 */

import type { Role } from '@/lib/navigation';
import type {
  ConsoleGroupId,
  ConsoleModuleId,
  ConsoleRouteEntry,
  ConsoleRouteStatus,
} from './types';

/** Brand helper: module ids are registry-controlled strings. */
function moduleId(value: string): ConsoleModuleId {
  return value as ConsoleModuleId;
}

/** Every role in the existing repository vocabulary (design §6 one-for-one). */
const ALL_ROLES: readonly Role[] = [
  'customer',
  'merchant',
  'provider',
  'operator',
  'administrator',
];

/**
 * The module id of the `/console` root (Overview). The console API boundary
 * and the console layout authorize against this id: it is the minimum bar
 * for ANY console access (any authenticated role).
 */
export const CONSOLE_ROOT_MODULE_ID: ConsoleModuleId = moduleId('console.overview');

/** The canonical route of the console root. */
export const CONSOLE_ROOT_HREF = '/console';

/**
 * The frozen route/module registry — design §5 exactly. Ordering follows the
 * frozen information architecture; do not reorder or add entries outside a
 * governed change.
 */
export const CONSOLE_REGISTRY: readonly ConsoleRouteEntry[] = [
  // ── Overview ────────────────────────────────────────────────────────────
  {
    id: CONSOLE_ROOT_MODULE_ID,
    href: CONSOLE_ROOT_HREF,
    label: 'Overview',
    description:
      'Console root: role-aware overview composed in PC-004 — module map, server-derived environment, and the authoritative operations-health summary.',
    group: 'overview',
    allowedRoles: ALL_ROLES,
    status: 'available',
  },
  // ── Payments ────────────────────────────────────────────────────────────
  {
    id: moduleId('console.payments.all'),
    href: '/console/payments',
    label: 'Payments — all',
    description:
      'Payment/activity list scoped to the viewer role (personal payments for customers, merchant payments for merchants, permitted visibility for operators).',
    group: 'payments',
    allowedRoles: ['customer', 'merchant', 'operator'],
    status: 'available',
  },
  {
    id: moduleId('console.payments.detail'),
    href: '/console/payments/[paymentId]',
    label: 'Payment detail',
    description:
      'Flagship payment detail: authority-quoted amount/parties/timestamps/rail/reference, evidence timeline, explicit UNKNOWN presentation.',
    group: 'payments',
    allowedRoles: ['customer', 'merchant', 'operator'],
    status: 'available',
  },
  // ── Checkout ────────────────────────────────────────────────────────────
  {
    id: moduleId('console.checkout.sessions'),
    href: '/console/checkout/sessions',
    label: 'Checkout sessions',
    description:
      'Open checkout sessions and their authority-reported state, scoped to the merchant.',
    group: 'checkout',
    allowedRoles: ['merchant'],
    status: 'available',
  },
  {
    id: moduleId('console.checkout.configuration'),
    href: '/console/checkout/configuration',
    label: 'Checkout configuration',
    description:
      'Merchant checkout account/configuration presentation from its owning authority.',
    group: 'checkout',
    allowedRoles: ['merchant'],
    status: 'available',
  },
  {
    id: moduleId('console.checkout.test'),
    href: '/console/checkout/test',
    label: 'Checkout test',
    description:
      'Test/sandbox checkout exercising the existing command/runtime path — never a console-local payment simulator. Environment signal is server-derived.',
    group: 'checkout',
    allowedRoles: ['customer', 'merchant'],
    status: 'available',
  },
  // ── Accounts ────────────────────────────────────────────────────────────
  {
    id: moduleId('console.accounts.customers'),
    href: '/console/accounts/customers',
    label: 'Accounts — customers',
    description: 'Projection over the existing identity/account authorities (customers).',
    group: 'accounts',
    allowedRoles: ['administrator'],
    status: 'available',
  },
  {
    id: moduleId('console.accounts.merchants'),
    href: '/console/accounts/merchants',
    label: 'Accounts — merchants',
    description:
      'Merchant account/configuration projection: own account for merchants, cross-role visibility for administrators.',
    group: 'accounts',
    allowedRoles: ['merchant', 'administrator'],
    status: 'available',
  },
  {
    id: moduleId('console.accounts.providers'),
    href: '/console/accounts/providers',
    label: 'Accounts — providers',
    description:
      'Provider account projection: own profile for providers, cross-role visibility for administrators.',
    group: 'accounts',
    allowedRoles: ['provider', 'administrator'],
    status: 'available',
  },
  {
    id: moduleId('console.accounts.operators'),
    href: '/console/accounts/operators',
    label: 'Accounts — operators',
    description: 'Operator account projection (cross-role administration).',
    group: 'accounts',
    allowedRoles: ['administrator'],
    status: 'available',
  },
  // ── Capabilities ────────────────────────────────────────────────────────
  {
    id: moduleId('console.capabilities'),
    href: '/console/capabilities',
    label: 'Capabilities',
    description:
      'Read-only presentation of protocol capability and routing truth, exactly as the capability authority reports it (availability never inferred from configuration).',
    group: 'capabilities',
    allowedRoles: ['provider'],
    status: 'available',
  },
  // ── Developers ──────────────────────────────────────────────────────────
  {
    id: moduleId('console.developers.api-keys'),
    href: '/console/developers/api-keys',
    label: 'Developers — API keys',
    description:
      'Environment-scoped API-key controls through the dedicated credential boundary (creation-time-only secret display; explicit auditable revocation).',
    group: 'developers',
    allowedRoles: ['merchant'],
    status: 'planned',
  },
  {
    id: moduleId('console.developers.webhooks'),
    href: '/console/developers/webhooks',
    label: 'Developers — webhooks',
    description:
      'Webhook endpoint ownership and delivery/outcome views referencing authoritative event identifiers.',
    group: 'developers',
    allowedRoles: ['merchant'],
    status: 'planned',
  },
  {
    id: moduleId('console.developers.logs'),
    href: '/console/developers/logs',
    label: 'Developers — logs',
    description:
      'Integration logs with credential/authorization redaction — diagnostic records, never evidence substitutes.',
    group: 'developers',
    allowedRoles: ['merchant'],
    status: 'planned',
  },
  {
    id: moduleId('console.developers.request-inspector'),
    href: '/console/developers/request-inspector',
    label: 'Developers — request inspector',
    description:
      'Request/trace inspection with credentials, authorization headers, and secret-bearing configuration redacted.',
    group: 'developers',
    allowedRoles: ['merchant'],
    status: 'planned',
  },
  {
    id: moduleId('console.developers.environments'),
    href: '/console/developers/environments',
    label: 'Developers — environments',
    description:
      'Environment scoping presentation for developer credentials (sandbox vs production, server-derived signal only).',
    group: 'developers',
    allowedRoles: ['merchant'],
    status: 'planned',
  },
  // ── Operations ──────────────────────────────────────────────────────────
  {
    id: moduleId('console.operations.queues'),
    href: '/console/operations/queues',
    label: 'Operations — queues',
    description:
      'Queue/worker operational visibility from the existing operational telemetry authorities.',
    group: 'operations',
    allowedRoles: ['operator'],
    status: 'available',
  },
  {
    id: moduleId('console.operations.execution'),
    href: '/console/operations/execution',
    label: 'Operations — execution',
    description: 'Durable execution visibility from the existing operational authorities.',
    group: 'operations',
    allowedRoles: ['operator'],
    status: 'available',
  },
  {
    id: moduleId('console.operations.reconciliation'),
    href: '/console/operations/reconciliation',
    label: 'Operations — reconciliation',
    description:
      'Reconciliation state visibility preserving the existing observability taxonomy.',
    group: 'operations',
    allowedRoles: ['operator'],
    status: 'available',
  },
  {
    id: moduleId('console.operations.unknown'),
    href: '/console/operations/unknown',
    label: 'Operations — UNKNOWN cases',
    description:
      'UNKNOWN-case visibility and recovery context from the existing recovery authorities (read-mostly).',
    group: 'operations',
    allowedRoles: ['operator'],
    status: 'available',
  },
  {
    id: moduleId('console.operations.clearing-netting'),
    href: '/console/operations/clearing-netting',
    label: 'Operations — clearing & netting',
    description:
      'Clearing/netting progression visibility from the existing operational authorities.',
    group: 'operations',
    allowedRoles: ['operator'],
    status: 'available',
  },
  {
    id: moduleId('console.operations.incidents'),
    href: '/console/operations/incidents',
    label: 'Operations — incidents',
    description:
      'Incident/recovery health visibility preserving the existing observability taxonomy.',
    group: 'operations',
    allowedRoles: ['operator'],
    status: 'available',
  },
  // ── Documentation ───────────────────────────────────────────────────────
  {
    id: moduleId('console.documentation.api'),
    href: '/console/documentation/api',
    label: 'Documentation — API reference',
    description:
      'API reference generated from the current implemented boundary/contracts where feasible.',
    group: 'documentation',
    allowedRoles: ALL_ROLES,
    status: 'planned',
  },
  {
    id: moduleId('console.documentation.concepts'),
    href: '/console/documentation/concepts',
    label: 'Documentation — concepts',
    description: 'Protocol concepts explained without reinterpreting the frozen protocol.',
    group: 'documentation',
    allowedRoles: ALL_ROLES,
    status: 'planned',
  },
  {
    id: moduleId('console.documentation.examples'),
    href: '/console/documentation/examples',
    label: 'Documentation — examples',
    description:
      'Examples labeled executable / simulated / illustrative, with environment identified.',
    group: 'documentation',
    allowedRoles: ALL_ROLES,
    status: 'planned',
  },
  {
    id: moduleId('console.documentation.guides'),
    href: '/console/documentation/guides',
    label: 'Documentation — guides',
    description: 'Integration guides resolving to maintained repository content only.',
    group: 'documentation',
    allowedRoles: ALL_ROLES,
    status: 'planned',
  },
];

/** Registry entries grouped in the frozen information-architecture order. */
export function consoleRegistryByGroup(): Readonly<Record<ConsoleGroupId, readonly ConsoleRouteEntry[]>> {
  const grouped: Record<ConsoleGroupId, ConsoleRouteEntry[]> = {
    overview: [],
    payments: [],
    checkout: [],
    accounts: [],
    capabilities: [],
    developers: [],
    operations: [],
    documentation: [],
  };
  for (const entry of CONSOLE_REGISTRY) {
    grouped[entry.group].push(entry);
  }
  return grouped;
}

/** Find one registry entry by route path (exact href match). */
export function findConsoleRoute(href: string): ConsoleRouteEntry | undefined {
  return CONSOLE_REGISTRY.find((entry) => entry.href === href);
}

/** Find one registry entry by module id. */
export function findConsoleModule(id: string): ConsoleRouteEntry | undefined {
  return CONSOLE_REGISTRY.find((entry) => entry.id === id);
}

/** Summary counts for the foundation placeholder surface and the contracts API. */
export function consoleRegistrySummary(): {
  readonly totalRoutes: number;
  readonly availableRoutes: number;
  readonly plannedRoutes: number;
  readonly groups: readonly {
    readonly group: ConsoleGroupId;
    readonly routes: number;
  }[];
} {
  const grouped = consoleRegistryByGroup();
  const groups = Object.entries(grouped).map(([group, entries]) => ({
    group: group as ConsoleGroupId,
    routes: entries.length,
  }));
  return {
    totalRoutes: CONSOLE_REGISTRY.length,
    availableRoutes: CONSOLE_REGISTRY.filter((entry) => entry.status === 'available').length,
    plannedRoutes: CONSOLE_REGISTRY.filter((entry) => entry.status === 'planned').length,
    groups,
  };
}

/** Status filter helper for later phases (PC-002 navigation rendering). */
export function consoleRoutesForRole(role: Role): readonly ConsoleRouteEntry[] {
  return CONSOLE_REGISTRY.filter((entry) => entry.allowedRoles.includes(role));
}

/** Re-exported for consumers that build registry-derived type unions. */
export type { ConsoleRouteEntry, ConsoleRouteStatus, ConsoleModuleId, ConsoleGroupId };
