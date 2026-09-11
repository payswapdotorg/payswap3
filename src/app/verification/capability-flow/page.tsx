/**
 * UI-004 — Capability flow verification surface.
 *
 * The verification harness route for the provider capability surface, modeled
 * on the UI-002 intent-flow harness (/verification/intent-flow). Like that
 * surface, this is verification tooling, not a provider surface, so it is not
 * role-gated; the provider surfaces themselves are (/capabilities and
 * /capabilities/{capabilityId}).
 */
import { FlaskConical } from "lucide-react";
import { CapabilityFlowHarness } from "@/components/verification/capability-flow-harness";

export const metadata = {
  title: "Capability flow verification — PaySwap",
  description:
    "Verification harness for the UI-004 provider capability surface: state matrix, role matrix, and adapter boundary report.",
};

export default function CapabilityFlowVerificationPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 py-4 sm:px-6">
          <FlaskConical className="size-5 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-base font-semibold tracking-tight">
            Capability flow verification
          </h1>
          <span className="text-xs text-muted-foreground">
            UI-004 · verification surface (not role-gated)
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <CapabilityFlowHarness />
      </main>
      <footer className="mt-auto border-t">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] text-xs text-muted-foreground sm:px-6">
          PaySwap — UI-004 verification harness · the live provider surface is
          role-gated at /capabilities
        </div>
      </footer>
    </div>
  );
}
