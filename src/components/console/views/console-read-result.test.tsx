/**
 * PC-004 — The read-envelope presentation tests: the UNKNOWN discipline of
 * every composed view, proven at the component seam.
 *
 *   - the unavailable branch renders the UNKNOWN chip and NEVER a business
 *     FAILED/SUCCEEDED chip (a transport failure is not a business failure);
 *   - the unavailable branch carries the note verbatim, the infrastructure
 *     disambiguation, the reconciliation path, and full attribution;
 *   - the value branch delegates to the view renderer with the
 *     authority-reported status — the renderValue seam is unreachable for an
 *     unavailable read.
 */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConsoleAuthorityMetadata, ConsoleReadResult } from '@/lib/console/types';
import { ConsoleReadResultView, ConsoleReadUnavailablePanel } from './console-read-result';

/** The unavailable branch of the envelope, narrowed (it is the branch that carries `note`). */
type UnavailableRead<T> = Extract<ConsoleReadResult<T>, { readonly outcome: 'unavailable' }>;

const AUTHORITY: ConsoleAuthorityMetadata = {
  view: 'console.test — fixture view',
  protocolObject: 'fixture protocol object',
  owningAuthority: 'Fixture Authority (test fixture)',
  runtimeBoundary: 'fixture boundary module',
  durableSource: 'fixture durable source',
  unknownSemantics: 'The fixture authority resolves UNKNOWN by re-checking its store.',
  evidenceReference: 'fixture-evidence-records.md',
};

function unavailableResult(): UnavailableRead<{ marker: string }> {
  return {
    outcome: 'unavailable',
    presentationStatus: 'UNKNOWN',
    note: 'The fixture read could not reach its owning authority (connection refused). This is a transport/infrastructure failure, not a business outcome — the DTO stays UNKNOWN.',
    authority: AUTHORITY,
  };
}

describe('PC-004 read-envelope view — unavailable branch (UNKNOWN, never a business verdict)', () => {
  test('renders the UNKNOWN chip and NEVER a business FAILED or SUCCEEDED chip', () => {
    const html = renderToStaticMarkup(
      <ConsoleReadUnavailablePanel
        subject="the fixture read"
        note={unavailableResult().note}
        authority={AUTHORITY}
      />,
    );
    expect(html).toContain('data-console-status="UNKNOWN"');
    expect(html.includes('data-console-status="FAILED"')).toBe(false);
    expect(html.includes('data-console-status="SUCCEEDED"')).toBe(false);
    expect(html).toContain('data-console-read="unavailable"');
  });

  test('carries the note verbatim, the infrastructure disambiguation, and the reconciliation path', () => {
    const result = unavailableResult();
    const html = renderToStaticMarkup(
      <ConsoleReadUnavailablePanel subject="the fixture read" note={result.note} authority={AUTHORITY} />,
    );
    expect(html).toContain(result.note);
    expect(html).toContain('not a business outcome');
    expect(html).toContain('The fixture authority resolves UNKNOWN by re-checking its store.');
  });

  test('carries full source/authority attribution', () => {
    const html = renderToStaticMarkup(
      <ConsoleReadUnavailablePanel subject="the fixture read" note="note" authority={AUTHORITY} />,
    );
    expect(html).toContain('Fixture Authority (test fixture)');
    expect(html).toContain('fixture boundary module');
    expect(html).toContain('fixture durable source');
    expect(html).toContain('fixture-evidence-records.md');
    expect(html).toContain('aria-label="Source and authority attribution"');
  });
});

describe('PC-004 read-envelope view — the branch decision is structural', () => {
  test('renderValue is NEVER invoked for an unavailable read (no business chip can appear)', () => {
    const html = renderToStaticMarkup(
      <ConsoleReadResultView
        result={unavailableResult()}
        subject="the fixture read"
        renderValue={() => <p data-testid="should-never-render">value branch</p>}
      />,
    );
    expect(html.includes('should-never-render')).toBe(false);
    expect(html).toContain('data-console-status="UNKNOWN"');
  });

  test('renderValue receives the value, the authority-reported status, and the authority metadata', () => {
    const result: ConsoleReadResult<{ marker: string }> = {
      outcome: 'value',
      value: { marker: 'fixture-value' },
      status: 'WAITING',
      authority: AUTHORITY,
    };
    let observed: { marker?: string; status?: string; owner?: string } = {};
    renderToStaticMarkup(
      <ConsoleReadResultView
        result={result}
        subject="the fixture read"
        renderValue={(value, status, authority) => {
          observed = { marker: value.marker, status, owner: authority.owningAuthority };
          return <p>{value.marker}</p>;
        }}
      />,
    );
    expect(observed.marker).toBe('fixture-value');
    expect(observed.status).toBe('WAITING');
    expect(observed.owner).toBe('Fixture Authority (test fixture)');
  });
});
