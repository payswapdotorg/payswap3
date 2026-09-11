"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Search } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * UI-005 — the reference-lookup form on the track entry surface.
 *
 * The surface tracks by reference only — never a browse-all listing — so
 * this form's only job is to take the reference the viewer was given and
 * hand it to the status view at /track/[referenceId], where the role check
 * and authorization happen server-side on direct entry. No lookup result
 * is ever produced client-side.
 */

const EMPTY_REFERENCE_ERROR =
  "Enter a reference to look up — the code the payer, the merchant, or support gave you (for example one starting with PWS- or STL-).";

export function TrackLookupForm() {
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = reference.trim();
    if (trimmed.length === 0) {
      setError(EMPTY_REFERENCE_ERROR);
      return;
    }
    setError(null);
    startTransition(() => {
      router.push(`/track/${encodeURIComponent(trimmed)}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="track-reference" className="text-sm font-medium">
          Payment or settlement reference
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="track-reference"
            name="reference"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. PWS-9QM2"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            aria-invalid={error !== null}
            aria-describedby={error !== null ? "track-reference-error" : undefined}
            className="min-h-11 font-mono sm:flex-1"
          />
          <Button type="submit" disabled={isPending} className="min-h-11 sm:w-auto">
            {isPending ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Search aria-hidden="true" />
            )}
            {isPending ? "Looking up…" : "Look up reference"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          References are not case-sensitive. What you can see for a reference depends on the
          role you are viewing as.
        </p>
      </div>
      {error !== null ? (
        <Alert variant="destructive" id="track-reference-error">
          <AlertTitle>Enter a reference</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
