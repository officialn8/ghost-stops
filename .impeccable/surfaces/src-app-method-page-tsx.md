---
version: 1
slug: "src-app-method-page-tsx"
primary_target: "src/app/method/page.tsx"
related_targets: ["src/components/method/MethodPage.tsx"]
---

# Surface brief: /method, "How the Ghost score works"

Scope: a standalone reading page at `/method`, outside the shell, in the established world. Visitor mode: Read.

Audience and job: the enthusiast reader (PRODUCT.md) who has just read a ledger row or a dossier and wants the method, the data, and the API within reach. Reached from the ledger's foot and from every dossier's Sources section. Success: they recognize the row they were reading, learn what each figure is in the order they scan it, and leave able to argue with the ranking and to pull the data themselves.

Content it must carry: a live ledger row and sign-header excerpt for one real ranked station (the top of the fading tier, falling back to rank 1); the four score parts with weights and their card sentences; the percentile and re-ranking rule; the tiers with their marks; who is ranked (open with recent riders) and who is shown but not ranked (closed, no recent data); peers and when a part is set aside; the data (CTA daily station entries, fare-gate entries, the dataset by name and link, the two-month lag, daily refresh, weekly reconciliation, the live data-through date); the two public API routes and the health route. No claims the code does not make; every number on the page comes from the data or the documented weights.

Constraints: PRODUCT.md and DESIGN.md bind. No em dashes in rendered text; no hue outside the CTA line bars; the type scale as documented; both themes; keyboard reachable; the row reproduction is the real component, so it opens the station.

## Direction contract

THESIS: The page teaches the method from the thing the reader just saw. A live ledger row and the sign header's figures sit at the top, and each element is explained in the order a reader scans it, before any general rule is stated. It refuses the methodology essay and the FAQ wall; the reference material follows the annotation, never leads it.

OWN-WORLD: The Platform Sign, unchanged. Tunnel Black or Station Tile field, Platform Chalk or Tunnel Black type, Archivo for words with the condensed cut only where the ledger already uses it, JetBrains Mono tabular for every figure, hairline rules at 12% ink, 13px Ink 2 sentence-case section headings, the presence marks as the only glyphs, hue only on line bars. No cards, boxes, callout bubbles, or numbered flags: annotations are a definition list whose order is the row's reading order.

STORY: A reader arrives from the foot of the ledger or a dossier's Sources, sees the row they know, reads what rank, score, mark, name, line bars, last week, and riders per day each mean with the station's own values quoted, then how the score is built, which stations are ranked, where the data comes from and how late it runs, and how to fetch it. They trust the ranking more and can dispute it precisely.

FIRST VIEWPORT (1280 wide): the page's own 56px bar (ghost and wordmark linking to the map, "Chicago L", the data-through date in mono, the theme switch), then a reading column with 40px gutters holding the title at 24px sentence case, one 15px lede line, and the annotated row: the real 360px ledger row on the left and its key on the right as a definition list in the row's reading order, each term the element, each description its meaning with the station's live value in mono. Beneath, the sign excerpt (the 56px mono number with the tier word, mark, and rank) with its own two-item key. The primary action is the row itself, which opens the station. On a phone the row sits above its key at full width.

FORM: "The platform sign, annotated", position 6 of 7 on the ranked list; seed key cdccdc50 (surface scope, read mode, dealt 4, 6, 1; the user locked 6).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
