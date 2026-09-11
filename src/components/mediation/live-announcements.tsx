"use client";

/**
 * UI-008 — Polite live-region announcer for decision outcomes.
 *
 * SWAP POINT: this is a local announcement component for the mediation
 * surfaces. When the state-primitives team ships a shared live-region
 * announcer, replace `AnnouncementRegion` here with it — the interface is
 * intentionally minimal (`message` string, polite semantics) to make that
 * swap a one-line change per call site.
 *
 * Pattern: an sr-only `role="status"` region whose content is set AFTER MOUNT
 * and on every change, so screen readers announce outcome wording once the
 * region exists and again whenever the message changes. Empty messages are
 * never announced (they are not pushed into the region).
 */

import * as React from "react";

export function AnnouncementRegion({
  message,
  politeness = "polite",
  id,
}: {
  message: string;
  politeness?: "polite" | "assertive";
  id?: string;
}) {
  const [announced, setAnnounced] = React.useState("");

  React.useEffect(() => {
    if (!message) return;
    // Setting content after mount (and on change) is what makes assistive
    // tech announce it; a small delay avoids losing the update to a re-render.
    const timer = window.setTimeout(() => setAnnounced(message), 60);
    return () => window.clearTimeout(timer);
  }, [message]);

  return (
    <div
      id={id}
      role="status"
      aria-live={politeness}
      aria-atomic="true"
      className="sr-only"
      data-announcement-region="true"
    >
      {announced}
    </div>
  );
}
