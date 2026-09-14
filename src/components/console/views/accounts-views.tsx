/**
 * PC-004 — Accounts views (modules console.accounts.*).
 *
 * Design §13: "Accounts and capability views are projections over existing
 * identity, account, provider, and capability authorities." The PC-004
 * inventory of what the repository ACTUALLY exposes found NO account
 * authority at this baseline:
 *
 *   - the only identity signal is the shell audience cookie (a verification
 *     harness simulation resolved through the audience authority — it is not
 *     an account registry and carries no profile/account data);
 *   - the mediation boundary exposes party-role-scoped RECORD queries, not
 *     account listings;
 *   - the ONE provider-side authoritative projection that exists is the
 *     A03 capability registry (the PC-003 capabilities read model).
 *
 * So: customers / merchants / operators render honest recorded-gap
 * projections (UNKNOWN for the account listing itself — never a fabricated
 * account list), and providers additionally composes the capability read
 * model as the provider-side projection, clearly labeled and attributed.
 */

import type { ReactNode } from 'react';
import type { ConsoleReadResult, ConsoleStatus } from '@/lib/console/types';
import type { ConsoleCapabilitiesDto } from '@/lib/console/read-models/capabilities';
import { ConsoleStatusPresentation, ConsoleAuthorityLine } from '@/components/console';
import { ConsoleReadResultView } from './console-read-result';
import { ConsoleGapPanel } from './console-view-chrome';
import { formatConsoleIsoTimestamp } from './view-format';

const SHARED_INVENTORY: readonly string[] = [
  'The shell audience authority (the session signal the console policy resolves server-side) — a role signal only; it holds no account, profile, or membership data.',
  'The mediation API boundary (record queries scoped by party role) — record reads, not account listings.',
  'No customer/merchant/operator account store, registry, or read exists anywhere in the repository at this baseline (recorded, not invented).',
];

export interface ConsoleAccountGapViewProps {
  /** Which account audience this module projects. */
  readonly audience: 'customers' | 'merchants' | 'operators' | 'providers';
  /** The audience-specific inventory line (what was actually inventoried). */
  readonly extraInventory?: readonly string[];
}

function accountGapNote(audience: ConsoleAccountGapViewProps['audience']): string {
  switch (audience) {
    case 'customers':
      return 'No customer account authority or account read exists at this baseline: there is no customer registry, no profile store, and no account-listing boundary the console could compose without inventing one. This projection therefore renders UNKNOWN for the customer account listing — an honest gap, never a fabricated account list.';
    case 'merchants':
      return 'No merchant account authority or account read exists at this baseline: the merchant-scoped surfaces that DO exist (the checkout port behind the checkout sessions module) expose offers and decisions, not merchant accounts or configuration. This projection therefore renders UNKNOWN for the merchant account listing — an honest gap, never a fabricated account list.';
    case 'operators':
      return 'No operator account authority or account read exists at this baseline: the operator-scoped surfaces that DO exist (the operations modules over the health authority) expose telemetry, not operator accounts. This projection therefore renders UNKNOWN for the operator account listing — an honest gap, never a fabricated account list.';
    case 'providers':
      return 'No provider account/profile authority or account read exists at this baseline. The ONE provider-side authoritative projection the repository exposes is the capability registry (rendered below) — identity and profile data have no owning source and render as this recorded gap, never a fabricated profile.';
  }
}

/** The honest account-gap projection for customers/merchants/operators. */
export function ConsoleAccountGapView({ audience, extraInventory }: ConsoleAccountGapViewProps): ReactNode {
  return (
    <section data-console-view={`accounts-${audience}-gap`} className="min-w-0" aria-labelledby={`console-accounts-${audience}-heading`}>
      <h2 id={`console-accounts-${audience}-heading`} className="text-lg font-semibold">
        {audience.charAt(0).toUpperCase() + audience.slice(1)} account projection
      </h2>
      <ConsoleGapPanel
        subject={`the ${audience} account projection`}
        gapNote={accountGapNote(audience)}
        inventory={extraInventory !== undefined ? [...SHARED_INVENTORY, ...extraInventory] : SHARED_INVENTORY}
        authority={{
          owningAuthority:
            'none at this baseline — no account authority exists to own this projection (recorded gap; the account gap is honest UNKNOWN, never an invented listing)',
          runtimeBoundary:
            'this view composes no account read (none exists); module access itself is enforced server-side by the frozen registry policy',
          evidenceReference:
            'spec/console/reconciliation-matrix.md (recorded gaps) · spec/console/PC-004-evidence.md (the PC-004 account inventory)',
        }}
      />
    </section>
  );
}

export interface ConsoleProviderAccountViewProps {
  /** The capabilities read-model envelope (PC-003) — the provider-side projection. */
  readonly capabilities: ConsoleReadResult<ConsoleCapabilitiesDto>;
}

/**
 * The provider account projection: the capability registry composed from the
 * PC-003 capabilities read model (the authoritative provider-side projection
 * that exists), plus the honest identity/profile gap.
 */
export function ConsoleProviderAccountView({ capabilities }: ConsoleProviderAccountViewProps): ReactNode {
  return (
    <section data-console-view="accounts-providers" className="min-w-0" aria-labelledby="console-accounts-providers-heading">
      <h2 id="console-accounts-providers-heading" className="text-lg font-semibold">
        Provider account projection
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-stone-600">
        Identity/profile data has no owning source at this baseline (the recorded gap
        below). The one authoritative provider-side projection the repository exposes is
        the capability registry — composed here exactly as the capability authority
        reports it, with per-item UNKNOWN preserved.
      </p>
      <div className="mt-4">
        <ConsoleAccountGapView audience="providers" />
      </div>
      <section aria-labelledby="console-provider-capability-projection" className="mt-6">
        <h3 id="console-provider-capability-projection" className="text-base font-semibold">
          Provider-side capability projection (the authoritative part)
        </h3>
        <ConsoleReadResultView
          result={capabilities}
          subject="the provider capability projection"
          renderValue={(value: ConsoleCapabilitiesDto, _status: ConsoleStatus, authority) => (
            <div className="min-w-0">
              <div className="mt-2 max-w-3xl rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
                <p>
                  <span className="font-semibold">Boundary facts (the authority's own, verbatim): </span>
                  runtime {value.boundary.runtime} · backing {value.boundary.backing} ·
                  authoritative {String(value.boundary.authoritative)} · owner{' '}
                  {value.boundary.authorityOwner} · registry view generated{' '}
                  {formatConsoleIsoTimestamp(value.generatedAt)}.
                </p>
                <p className="mt-1">
                  {value.boundary.notes} The dedicated capabilities module
                  (console.capabilities) remains provider-scoped; this projection exists
                  here because the frozen registry explicitly authorizes this module's
                  audience (provider + administrator cross-role visibility, design §6/§13).
                </p>
              </div>
              {value.capabilities.length === 0 ? (
                <p className="mt-3 max-w-3xl rounded-xl border border-stone-300 bg-white p-4 text-sm text-stone-700" data-testid="console-provider-capabilities-empty-value">
                  The capability authority answered with an empty registry — a legitimate
                  authoritative VALUE, not an unavailable read.
                </p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2">
                  {value.capabilities.map((capability) => (
                    <li
                      key={capability.capabilityId}
                      data-console-capability={capability.capabilityId}
                      className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
                    >
                      <ConsoleStatusPresentation status={capability.displayStatus} subject={capability.name} />
                      <span className="font-medium">{capability.name}</span>
                      <code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">{capability.capabilityId}</code>
                      <span className="text-xs text-stone-500">{capability.category}</span>
                      <span className="text-xs text-stone-500">
                        {capability.authorityState !== undefined
                          ? `state ${capability.authorityState}`
                          : 'no authoritative report — availability UNKNOWN'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <footer className="mt-4 border-t border-stone-200 pt-3">
                <ConsoleAuthorityLine
                  owningAuthority={authority.owningAuthority}
                  runtimeBoundary={authority.runtimeBoundary}
                  durableSource={authority.durableSource}
                  evidenceReference={authority.evidenceReference}
                />
              </footer>
            </div>
          )}
        />
      </section>
    </section>
  );
}
