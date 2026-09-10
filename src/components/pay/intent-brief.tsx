import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney, formatTimestamp } from '@/lib/pay-flow/money';

export interface IntentBriefData {
  amount: string;
  currency: 'USD';
  recipientName: string;
  sourceName: string;
  customerReference?: string;
  intentRef?: string;
  composedAt?: string;
}

/**
 * The intent in brief (UI-002): the same summary card on the review step
 * and the state page, so the customer reviews and later inspects exactly
 * the same intent. Presentation only — amounts and parties are what the
 * customer composed and the port echoed back.
 */
export function IntentBrief({ data, title = 'The intent' }: { data: IntentBriefData; title?: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div className="flex items-baseline justify-between gap-4 sm:block">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount</dt>
            <dd className="text-sm font-semibold sm:mt-0.5">{formatMoney(data.amount, data.currency)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 sm:block">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recipient</dt>
            <dd className="text-sm font-medium sm:mt-0.5">{data.recipientName}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 sm:block">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Funded from</dt>
            <dd className="text-sm sm:mt-0.5">{data.sourceName}</dd>
          </div>
          {data.customerReference ? (
            <div className="flex items-baseline justify-between gap-4 sm:block">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your reference</dt>
              <dd className="text-sm sm:mt-0.5">{data.customerReference}</dd>
            </div>
          ) : null}
          {data.intentRef ? (
            <div className="flex items-baseline justify-between gap-4 sm:block">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Intent reference</dt>
              <dd className="font-mono text-xs sm:mt-0.5">{data.intentRef}</dd>
            </div>
          ) : null}
          {data.composedAt ? (
            <div className="flex items-baseline justify-between gap-4 sm:block">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Composed at</dt>
              <dd className="text-xs text-muted-foreground sm:mt-0.5">{formatTimestamp(data.composedAt)}</dd>
            </div>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}
