# ORION design system

Source of truth: the Archymedes posters in `public/`. Live reference: run the app and open `/design`
(Profile → Design system). Code: `src/theme/tokens.ts` (values) and `src/components/ui.tsx` (primitives).

## Look
Dusk sky, frosted glass panels with thin light borders, white text in a light geometric face (Outfit),
wide-tracked uppercase labels, and **one** electric blue (`accent`) for the next step. Desktop web first
(`useLayout()`: `shell` ≥ 900px shows the top bar, `split` ≥ 1200px puts panels side by side); phones get one column.

## Tokens (`src/theme/tokens.ts`)
| Group | Use |
| --- | --- |
| `colors` | Surfaces (`glass`, `frost`, `sunken`), text (`ink`, `body`, `muted`, `faint`), `accent*`, status (`success`, `warning`, `danger`). |
| `type` | `hero` 64 · `pageTitle` 46 · `display` 44 · `screenTitle` 30 · `section` 18 · `body` 16 · `supporting` 14 · `metadata` 12. `tracking(size)` tightens big light headlines and opens small labels. |
| `spacing`, `radius` | One scale each. No one-off numbers in screens. |
| `elevation` | Web box-shadows: `rest`, `raised` (hover), `glow` (primary hover). |
| `motion` | `fast` 140 · `base` 240 · `slow` 480 ms, `stagger` 70, one easing. |

## Primitives (`src/components/ui.tsx`)
`Screen`, `PageHeader`, `Card` (pass `onPress` for a hover-lift card), `Stat`, `EmptyState`, `Skeleton`, `Reveal`,
`AppButton` (primary / secondary / ghost / danger), `ArrowButton`, `IconButton`, `ConfirmButton`, `Chip`, `LabeledField`, `Tag`, `Notice`, `Field`, `CheckRow`,
`Eyebrow`, `Title` (takes `weight`), `SectionTitle`, `Body`, `Small`, `Wordmark`, `Star`, `spot` (cursor-lit edge props), `SiteFooter` (every `Screen`, opt out with `footer={false}`), `HomeBento`. Plus `ProbabilityBar`, `OptionRanking`, `Understood`, `ChoiceCheck`, `DuelCard`, `DecisionResult`, `LegalPage`.

## Depth and motion (2026-10-09 pass)
Taken from what current award-winning product sites share (Linear, Vercel, Raycast, recent Awwwards winners): one accent
used sparingly, big light headlines with tight tracking, structure drawn with light rather than lines, motion that
means something, and every state designed.
- **Sky parallax and dusk**: `Screen` passes its scroll to `Backdrop`; the sky drifts at a fraction of the page speed
  and, on the dawn scene, dims to night under content so text over it stays legible.
- **Top bar**: transparent over the sky at the top of a page, frosted and solid once content scrolls under it
  (`components/scroll.ts`).
- **Lit glass edge**: cards with `[data-spot]` get a border and inner glow that follow the cursor (global CSS and one
  pointer listener in `theme/webFont.ts`; off on touch screens and under reduced motion transitions).
- **Grain**: a faint SVG noise layer over every page, so sky and glass read as material.
- **Page header**: light 46px title with the posters' short blue rule under it; headings are `text-wrap: balance`.

## Rules
1. Blue means "next step". Only one filled-blue button per screen region.
2. Status is written out (`Tag`, `Notice`); colour and icon only support the words. Bars print their value.
3. Interactive things have hover, press (sink) and a keyboard focus ring (global, web).
4. Motion is `Reveal` on entrance, CSS transitions on state change, nothing decorative. It is off under `prefers-reduced-motion`.
5. New primitive → add it to `ui.tsx` **and** show it on `/design` in the same change.
6. No screen-local colours, font sizes or shadows; add a token first.
7. Anything that cannot be undone goes through `ConfirmButton` (press, then confirm in words; it disarms after 4 s).
8. Say how it works where it happens: Home has the three steps, the result shows "What ORION understood" with an
   edit path, and any number on screen has a sentence saying what it means. No jargon without its explanation.
9. Forms: a label above every field, the rule stated before the mistake (password length), one error per field in
   words, and the server's reason shown as written. Never clear what the person typed.
10. Every screen passes `title` to `Screen` (browser tab), and has a loading, an empty and an error state.

## Decisions put to Jev (2026-10-04)
`scripts/jev-guide.ts` asks Jev to choose between written alternatives for each part of the interface. Its pick
and the probability it gave are below. The visual language (posters) was not up for a vote.

| Part | Pick | Probability |
| --- | --- | --- |
| Home headline | A line naming the visitor's problem: "Stuck on a decision? See it laid out in two minutes." | 97% |
| Home examples | One everyday choice and two decisions that matter | 82% |
| How it works | Under the input on a first visit; a link afterwards | 59% |
| Result order | Verdict first; "ORION understood" as one line under the title with Edit | 86% |
| Name of the figure | "Score" in the interface | 54% (JEV named once: 46%; applied: Score, with JEV once in the calculation note) |
| Explaining the score | One line, with "How is this calculated?" for the rest | 96% |
| Verdict label | "Comes out ahead on what matters to you" | 72% |
| Choice buttons | No decision (after the verdict 49%, side panel 47%); left in the side panel | — |
| Choosing against the numbers | A calm inline card, headed "Your call" | 90% / 81% |
| Suggesting an account | Superseded 2026-10-04: sign-in is required before anything else (owner's decision, not put to Jev), so there is nothing to suggest. Jev's earlier pick was one dismissible line after the first saved choice (95%). | — |
| Empty Insights | A labelled example of what will appear | 72% |

Jev chooses among the options it is given, from the description it is given. It is a second opinion, not user
research: re-run the script when the product or the alternatives change, and prefer real beta feedback over it.

## The decision flow (JEV decides)
Verdict first. ORION scores the options and shows the leader, so the person never fills in a grid.
- **Online:** Jev (TypeSafe System One, `server/decision-ai.ts → scoreWithJev`) scores every option × factor in one request.
  A wide JEV lead (gap ≥ 3) needs no questions; a close one asks one "which matters most" question.
- **Offline / no key:** `DuelCard` asks one factor at a time, "which comes out ahead?", one tap each
  (`src/decision-engine/duel.ts`). JEV orders the factors by weight and stops when the rest cannot overturn the lead.
- The options × factors table is still there under "Fine-tune the estimates" for people who want it.
Chosen by asking Jev itself to pick between five candidate flows: `verdict_first` 0.90.
