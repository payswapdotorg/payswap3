/**
 * Pay-flow draft store (UI-002, client).
 *
 * Holds ONLY what the customer is composing, before any submit. This is
 * presentation state, not durable financial state (N5): nothing here is
 * an intent, nothing here is applied anywhere, and submitting does not
 * read from this store directly — the explicit submit passes the draft
 * through the port with the reviewed consequence report attached. The
 * draft persists in sessionStorage so a mid-flow reload does not lose
 * composition work; it never persists an outcome.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CompositionOptions, IntentConsequenceReport, IntentDraft } from '@/lib/protocol/intent-port';

export interface PayFlowDraft {
  outcomeStatement: string;
  recipientId: string;
  sourceId: string;
  amount: string;
  customerReference: string;
}

interface PayFlowState {
  draft: PayFlowDraft | null;
  /** The consequence report issued for the current draft (review step). */
  consequenceReport: IntentConsequenceReport | null;
  setDraft: (draft: PayFlowDraft) => void;
  setConsequenceReport: (report: IntentConsequenceReport | null) => void;
  clearFlow: () => void;
}

export const usePayDraftStore = create<PayFlowState>()(
  persist(
    (set) => ({
      draft: null,
      consequenceReport: null,
      setDraft: (draft) => set({ draft }),
      setConsequenceReport: (consequenceReport) => set({ consequenceReport }),
      clearFlow: () => set({ draft: null, consequenceReport: null }),
    }),
    {
      name: 'psw.pay.draft.v1',
      storage: createJSONStorage(() => sessionStorage),
      // Only the in-progress draft survives a reload — never a report
      // (reports are re-quoted fresh on review) and never any outcome.
      partialize: (state) => ({ draft: state.draft }),
      skipHydration: true,
    }
  )
);

export const EMPTY_DRAFT: PayFlowDraft = {
  outcomeStatement: '',
  recipientId: '',
  sourceId: '',
  amount: '',
  customerReference: '',
};

export function isDraftComplete(draft: PayFlowDraft): boolean {
  return (
    draft.outcomeStatement.length > 0 &&
    draft.recipientId.length > 0 &&
    draft.sourceId.length > 0 &&
    /^\d{1,9}(\.\d{1,2})?$/.test(draft.amount) &&
    Number(draft.amount) > 0
  );
}

/** Resolve the composed draft against the port's composition options. */
export function toIntentDraft(
  draft: PayFlowDraft,
  options: CompositionOptions
): IntentDraft | null {
  const recipient = options.recipients.find((party) => party.id === draft.recipientId);
  const source = options.sources.find((party) => party.id === draft.sourceId);
  if (!recipient || !source) return null;
  return {
    outcomeKind: 'send-payment',
    outcomeStatement: draft.outcomeStatement,
    amount: draft.amount,
    currency: options.currency,
    recipient,
    source,
    customerReference: draft.customerReference.trim() || undefined,
  };
}
