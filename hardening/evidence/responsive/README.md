# UI-009 responsive evidence

Per-surface JSON + combined CSV. Each breakpoint row records `document.scrollingElement.scrollWidth <= window.innerWidth` and every interactive target measured as its effective hit area (bounding rect expanded by absolute-positioned `::after` hit regions; visually-hidden `sr-only` affordances excluded).

**Pass criteria:** no horizontal scroll at 390/768/1440; every discrete interactive control ≥44×44 effective.

**Documented exceptions (WCAG 2.5.8 success-criterion exceptions):**
- *Inline exception* — links and sentence-level buttons embedded in running text (e.g. "…as of that query. Re-check now", evidence links inside paragraphs, route mentions inside harness table cells) keep sentence line height; enlarging them to 44px would break the reading flow the wording owns.
- *Associated labels* — `<label for>` text is part of its form control, not a standalone target; the controls themselves (inputs 44px, checkbox/radio/switch 48×44 effective hit areas) carry the 44px floor.
These exceptions are recorded per row in the CSV `under24/under44` columns.