# ORION — Make better decisions. Live a better life.

Universal decision layer: open app → type what you're deciding → answer 0–3
useful questions → understand trade-offs → choose. Implements the ORION spec
MVP (§58): NL input, option/factor extraction, adaptive questions, JEV,
scenarios, confidence, reversibility, sensitivity, best-next-information,
history, outcome feedback, SQLite persistence, private mode.

## Architecture (§24)

LLM structures (semantic) → deterministic JEV engine (math) → LLM explains.
The model never picks the winner; `expectedUtility()` does. All AI output is
validated (zod, `src/ai/schemas.ts`).

## Layout (§34)

```
src/app/(tabs)/ index(history you)   Decide · History · You
src/app/decision/[id]/analysis.tsx   advanced mode: verdict, limits, criteria,
                                    evidence, outcomes, what-if, unknowns
src/components/  DecisionInput Result ProbabilityBar OfflineForm
src/decision-engine/  expectedValue scenarios uncertainty sensitivity
                      informationGain informationValue constraints policy
                      reasons simulation calibration normalize
                      stoppingRule safety
src/ai/  client(server calls + offline fallback) model(outcomes, criteria,
                      evidence, answers→weights)
         extractDecision generateQuestions explainDecision schemas
src/db/  schema database (expo-sqlite, memory fallback, additive migrations)
         decisions.ts (list/search, delete one, export all, erase all)
src/export/ report(one decision) archive(everything) pdf xlsx download
src/store/ session.ts (submit → parse → scores → answer → commit)
             decisionStore.ts (constraints, evidence, criteria, unknowns)
server/index.ts  POST /decision/parse|score-factors|triage|explain, GET /health, serves dist/
server/http.ts   security headers, rate limit, static files
tests/  engine, scenarios, safety, calibration, decision support, API fallback,
        privacy, preferences, and session lifecycle tests (Bun)
```

## Flow

`submit(input)` → `parseDecision` (server TypeSafe battery, zod-validated;
offline: `parseLocally` + keyword safety; it splits up to four alternatives
and turns a yes/no question into do it / don't; what ORION understood goes on
screen at once) → `scoreFactors` (one Score per option×factor; offline: neutral
outcomes, UI says so) and triaged questions (0–3 by stakes, shown one at a time,
each asking which of the decision's own factors matters most) run side by side
(`scoreAndTriage`), as both need only the parsed decision → answers boost factor
weights ×2 and renormalize → JEV,
scenarios, sensitivity recompute live → commit persists the full model
(options, factors, values, answers) unless private mode. “X matters most”
non-private answers are recorded as affinities (`user_preferences`) and blended as
gentle priors into new decisions; the You screen shows them.

Honesty rule: without real Scores there is no signal — neutral outcomes
(value 0, confidence 0.15) render a tie with wide bands, never fabricated
numbers. Offline users rate every option × factor on a five-step scale
(much worse … much better, i.e. −10, −5, 0, 5, 10; untouched cells are 0) or
switch to exact −10..10 numbers, add a confidence, and compare with the same
deterministic engine.
All-zero estimates are a valid tie. Crisis/dangerous verdicts short-circuit to
the support path; no JEV theater.

## Scenarios, limits, and calibration

A single expected impact per factor is an expectation, not a distribution, so
ORION can model outcomes as well:

- **Outcomes.** Each option carries one or more branches with their own
  probability and confidence. The server asks for them (best/typical/worst, only
  for factor lists short enough to ask about honestly); offline, the user adds an
  optional downside case per option. A single-outcome model is explicitly inert
  and every scenario section says so.
- **All or nothing.** A scenario set is used only if every option has a branch
  and every branch names known factors with in-range values. Out-of-range values
  are rejected rather than clamped, and a partial set is discarded — comparing
  one option with a range against another with a bare number is not honest.
- **Limits.** Hard, soft and preference constraints live in
  `decision_constraints`. Hard limits rule options out with a stated reason;
  soft limits subtract a penalty; preferences break ties. "Lower is better" is
  expressed as a MINIMIZE criterion, which negates the factor rather than
  flipping the answer's meaning.
- **What-if.** `simulate()` recomputes the whole model against changed weights,
  reversibility, or outcome values without touching stored state, and reports
  the new leader, per-option deltas, and the recomputed flip thresholds.
- **Calibration.** Committing a choice records the predicted outcome; History
  collects the user's rating and reports whether ORION has been too optimistic
  or too cautious, on fixed bands so the trend stays readable. Ratings never
  feed back into the model automatically.
Set `EXPO_PUBLIC_ORION_API` (e.g. `http://localhost:3001`) to go online;
`TYPESAFE_API_KEY` lives on the server only.

## Run (development)

```sh
bun install
cp .env.example .env   # optional: add TYPESAFE_API_KEY and/or OPENAI_API_KEY / ANTHROPIC_API_KEY
bun run check          # typecheck + lint + tests
bun run server         # API on 127.0.0.1:3001
EXPO_PUBLIC_ORION_API=http://localhost:3001 bun run web   # app with hot reload on :8081
```

Without `EXPO_PUBLIC_ORION_API` the app runs fully on the device and asks its quick questions instead of scoring.

## Deploy (web)

One process serves the exported web app and the API on the same origin:

```sh
bun run build:web      # exports to dist/ with EXPO_PUBLIC_ORION_API=/ (same origin)
bun run serve          # serves dist/ and /decision/* on PORT (default 3001)
```

or as a container: `docker build -t orion . && docker run -p 3001:3001 --env-file .env orion`.

Every setting is listed in `.env.example`. What the server does for you (`server/http.ts`, `server/index.ts`):

- Security headers on every response and a content security policy on the page (own scripts only, no framing).
- Security headers on every response include HSTS; API answers carry a `default-src 'none'` policy of their own.
- CORS: the page it serves is always allowed; other origins must be in `ORION_ALLOWED_ORIGINS`. With that unset,
  only the Expo dev server (`http://localhost:8081`) calling an API that is itself on localhost is let in.
- `ORION_RATE_LIMIT` requests per minute per client on every API route (429 + `Retry-After`), and
  `ORION_MAX_CONCURRENT` requests at once (503). Behind a proxy set `ORION_TRUST_PROXY` to the number of proxies
  that write `X-Forwarded-For` (1 for one load balancer; the Vercel entry point sets it itself). The address that
  proxy wrote is used, never the client's own claim. Left at 0 behind a proxy, every visitor shares one address:
  the rate limit and the sign-in lock would then apply to everyone at once.
- 32 KB request limit, request/header timeouts, graceful shutdown on SIGTERM.
- One JSON log line per request (method, path, status, ms). Decision text is never logged.
- `GET /health` for load balancers; hashed bundles are cached for a year, the page is revalidated.

Terminate TLS in front of it (a reverse proxy or your platform's load balancer). The posters in `public/` are the
design reference, so `build:web` removes them from `dist/`.

### On Vercel from GitHub

`vercel.json` makes a Git push build both halves: `bun run build:web` (the app) and `scripts/vercel-output.sh` (the API
as one function, plus the routes). Import the repository in Vercel and keep the defaults. For accounts, backups and
shared links, add the **Upstash** integration (it sets `KV_REST_API_URL`/`KV_REST_API_TOKEN`) or set
`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`; add an AI key for scored decisions. Check the deployment at
`/health`: `"database": {"kind": "upstash", "reachable": true}` means accounts will persist. Without Upstash the
welcome page says the copy runs without accounts. Never use `ORION_ACCOUNT_STORE=memory` there: each function
instance would have its own accounts.

## Models

Scoring tries Jev (TypeSafe) first when `TYPESAFE_API_KEY` is set. Parsing, triage, explanations, and scoring when
Jev is absent or fails, go through `server/providers.ts` in this order:

1. **Free models**, if configured: any OpenAI-compatible endpoint (`ORION_COMPAT_*`, or just `OPENROUTER_API_KEY`
   for OpenRouter's `:free` models). The pool holds up to eight; see the router and the list below.
   The schema is sent in the prompt and the reply is validated with zod like every other provider's.
2. OpenAI, then Anthropic (reversed for explanations), if their keys are set.

Which model is tried, and what happens when one fails, is decided by `server/router.ts`:

- **Health memory.** Each model has a record. A failure benches it for a time that fits the failure and doubles
  on repeats: rate limit 30 s (or the provider's `Retry-After`), timeout or 5xx 20 s, unusable output 2 min for
  that task only, rejected key 10 min for every model behind that key, withdrawn model 6 h. A success clears it.
- **Ordering.** Free before paid; available before benched. Among free models, measured fit for the task comes
  first (`server/free-models.ts`: good, unmeasured, busy, slow, small; a task a model failed when measured moves
  it two tiers back), then OpenRouter's live uptime (a model whose endpoints are under 30% over the last 30 min
  goes behind every one that is up), then models that have answered this task before, then the more reliable,
  then the faster. Models OpenRouter serves only to apps it lists are never tried. If everything is benched, the
  two that recover soonest are probed.
- **Live uptime.** The server reads OpenRouter's public `/models/{id}/endpoints` figures for its free pool (no key,
  cached 5 min, waits at most 2 s, only the first time; `ORION_FREE_UPTIME=0` turns it off).
- **Hedging.** If the model that was started is slow (1.5× its usual time, 3–12 s; `ORION_HEDGE_MS`), a second
  free model is started beside it and the first valid answer wins. Reading the question and writing new paths
  start two free models together. Paid models never run in parallel.
- **Limits.** At most 4 attempts and 45 s per request. A quick refusal (rate-limited or withdrawn, answered in
  under 2.5 s) gives its attempt back, up to 8 models in all, so busy free models cost nothing to move past.
  A refusal of the request itself or a rejected key ends it.
- **Free stays free.** Requests to OpenRouter `:free` models carry `provider.max_price` of zero, so OpenRouter
  refuses rather than routes to a paid endpoint.
- **Self-refreshing pool** (`ORION_COMPAT_DISCOVER=1`). Every 6 hours the server reads the free-ai-models list
  and adds up to six healthy `:free` chat models after your own; it skips providers that may train on prompts.
- `GET /health` shows each model's state, when it will be retried, and the order the next request will use.

This memory is per server process and starts empty after a restart.

If all fail the app uses its local parser and quick questions.

### Free models (measured 2026-10-16 and 2026-10-20)

The default pool, in the order the router starts from when nothing is known yet (`DEFAULT_FREE_MODELS`):

| Model | Fit | Measured |
|---|---|---|
| `minimax/minimax-m3.1-flash:free` | good · low reasoning effort | score 2–5 s, parse 7–32 s, new paths 1.8 s at low effort |
| `nvidia/nemotron-3.5-super-vl:free` | good | parse 18 s, score 14 s, new paths 28 s · NVIDIA logs prompts |
| `cohere/north-mini-code:free` | good · low reasoning effort | parse 27 s, score 9 s, new paths 10–14 s |
| `dots-studio/dots-3-note-preview:free` | good, not first for new paths | parse 37 s, score 14 s; often thinks past its output on new paths |
| `poolside/laguna-xs-2.1:free` | busy, not for scoring | parse 5–9 s, new paths 3 s when it gets through |
| `nvidia/nemotron-3-super-120b-a12b:free` | good | passed archymedes-cli's agent task; endpoint was down on 2026-10-20 |
| `poolside/laguna-s-2.1:free` | busy, not for scoring | parse 14 s, new paths 7 s |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | slow | passed all three, scoring took 41 s |

Also profiled and kept out of the default pool: Gemma 4 26B/31B (busy: almost always rate-limited), Xing 4.0
(only parses), Nemotron 3.5 Lightning (slow), `openrouter/free` (unpredictable), LFM 2.5 2.6B (small), and
Inkling and Inkling Small (OpenRouter serves them only to listed apps; never tried). `GET /health` lists every
pool model with its fit, what it is weak at, live uptime and whether it is benched (`freeModels`).

Free models change weekly. `bun scripts/free-models.ts` runs every free model OpenRouter lists now on reading a
question, scoring and writing new paths; update `server/free-models.ts` from it, or set `ORION_COMPAT_MODELS`
(the router still orders by measured fit). They are meant for testing: OpenRouter allows 50 free requests a day
per account, and each decision uses two to four. Free endpoints may log prompts.

## Accounts and the beta

With accounts on, ORION is for people who are signed in. Every screen except `/account`, `/terms` and `/privacy`
sits behind `src/components/Gate.tsx`, which sends anyone signed out to the sign-in page and brings them back to
where they were going. The gate is a convenience, not the lock: the server refuses `/decision/*`, `/billing/*`
(except the public price list) and `/feedback` with `401 {"code":"signed_out"}` unless the request carries a
session, and the app returns to the sign-in page when it sees that answer.
Off until a store is configured (`UPSTASH_REDIS_REST_URL`/`_TOKEN`, or `ORION_ACCOUNT_STORE=memory` for local work);
a server with no store has no sign-in at all and stays open, which is what a local or offline build is.
If the server cannot be reached the app says so and opens nothing, rather than guess that nobody needs to sign in.

- **Sign up / sign in** (`/account`, `server/auth.ts`): a unique username (3–24 letters, numbers, `.`, `-`, `_`;
  shown at the top of every page with **Sign out**), email and a password of 10+ characters with no composition
  rules; passwords are hashed with scrypt. One generic error for a wrong email or password, five wrong tries lock
  sign-in for 15 minutes, and signups are limited per network.
- **Sessions**: a random token in an `HttpOnly; Secure; SameSite=Lax` cookie (`__Host-` prefixed), 30 days; only
  its hash is stored. Changing the password ends every other session, and a session belongs to one account id, so
  it dies with the account even if the same email signs up again.
- **Shared browsers**: signing out backs the device's data up and then erases it from the device (decisions,
  licence, passes). If the backup fails the data stays for the same person to return to; a different account
  signing in erases it first, so one person's history is never merged into another's.
- **Forgot password**: there is no email service, so a recovery code is shown once at signup and resets the
  password (each code works once). Without the code an account cannot be recovered. Adding an email provider and
  a verified sending domain is the step that would allow reset links and email verification.
- **Backup** (`/account/backup`): the device's data is copied to the account after each change and merged in on
  sign-in, so decisions follow the person to another browser. It is a backup, not live sync between open tabs.
- **Delete account** (password required) removes the user record and backup at once.
- **Beta standards**: Beta label and version (`src/release.ts`), plain-language `/terms` and `/privacy` with consent
  recorded at signup, optional invite codes (`ORION_BETA_INVITE_CODES`), in-app feedback (stored in the `feedback`
  list in the store), and crash reports (`/client-error`: message and page only, to the server log).
  **The terms and privacy text were drafted with the code and need a lawyer's review before a wider release.**
- A purchase is attached to the account that activates it and unlocks on any device that account signs in on. A
  checkout link or licence token copied to another account is refused (409 / 401).

## The welcome page

Signed out, the first page anyone sees is `/account`: sign in or create an account on one half, and a scripted demo
of ORION on the other (`src/components/HowItWorksDemo.tsx`: a fun question, a big one, and the check-in afterwards;
it can be paused and is still under reduced motion). "Continue without an account" is remembered on the device
(`src/account/gate.ts`), so the page appears once. Legal pages and friends' links (`/s/…`) never wait behind it.
Without accounts on the server the same page shows the demo and a "Start deciding" button.

## How ORION reads a question (`src/decision-engine/mode.ts`)

- **Is it a decision?** A greeting, a question of fact ("what is the capital of France") or a single word gets a
  short "what are you deciding?" step with examples and a "compare anyway" button. Safety is checked first, so a
  crisis is never held behind it.
- **What kind?** `playful` (pizza or tacos, which movie, what to wear), `everyday`, or `serious` (significant or major
  stakes, or a financial, health or legal domain). Nothing touching jobs, money, health, housing or family is treated
  as a game, whatever the wording. Questions asked: 0 for playful, 1–2 for everyday, 3 for serious.
- **ORION's call** (`src/decision-engine/call.ts`): one decisive sentence on top of the result. *Clear* when the lead is
  bigger than the estimates' uncertainty, *lean* when it is within it (still a pick, said to be close), and *coin* when
  nothing separates the options: for a fun or everyday choice ORION flips a coin and says so ("if that made your heart
  sink, you wanted the other one"). A serious decision is never settled by a coin. Fun decisions show only the call
  until "Show me why".

## Check-ins (`src/decision-engine/followUp.ts`, `src/db/followups.ts`)

Saving a decision plans when ORION comes back: nothing for fun choices; one check after 2 days for everyday ones;
after a week (3 days if hard to undo) and a month for serious ones, plus three months for major ones. An open
("Not yet") decision gets a nudge after 1–3 days. Due check-ins appear at the top of Home with the five ratings, "ask me
later" (3 days) and, for open ones, "pick it up". Rating in History closes them too. The result says when the next
check-in is and, on web, offers it as a calendar file (`.ics`) so it reaches people who do not reopen ORION.

## Aftermath: the future of a choice (`src/decision-engine/aftermath.ts`)

"If you choose this, here is roughly what follows", from the first days to years out. Serious decisions are pictured at
the first days, one month, three months, six months, one year and three years (five years for major ones); everyday
ones to six months; tiny ones a couple of days. ORION checks in at six months and a year for serious choices, so the
long-range picture is tested against what happened; three and five years are labelled projections.

- **Real-time arcs** (`feltAt`, from the factor's name): costs and conveniences are felt at once and stay; the strain of
  a change fades over a few months; pleasures and novelty settle as people adapt; growth, health and relationships
  build over months; money, skills and reputation compound past their first estimate after a few years. The time
  constants are judgement calls, not measurements.
- **Uncertainty grows with distance**: each estimate's own doubt widens with the log of the months ahead, plus life's
  noise, so the odds and the likely range spread the further out you look.
- **Far steps say where things stand** (the biggest gain and the biggest cost), so a long view never hides what was
  given up.
- **Wording model** (`aftermathWithAI`): gets each step's `daysAfter`, horizon and each factor's trend, plus rules and
  worked examples for each horizon. Answers that echo the input's labels or copy an example are rejected and the
  router tries another model. Offline, the engine's own wording varies by horizon.
- Free models need room for this: parse and aftermath get 40 s per model and extra output tokens.
  `ORION_DEBUG_AI=1` logs why a model's answer was rejected (it can include decision text; off by default).

## ORION for businesses (`server/business.ts`, `src/business/`)

A decision can be asked **for me** or **for a business** (switch on Home, or on the You screen). Business mode:

- **Company profile** (You screen, every field optional): name, what it does, stage, team size, cash runway in
  months, appetite for risk, priority this year, free notes. Stored in `user_preferences` so account backup carries
  it; sent with business requests only; never inferred.
- **Business playbook**: a long domain prompt (`BUSINESS_PLAYBOOK`) plus per-task rules for parse, score, triage,
  explain and aftermath. It covers one-way vs two-way doors, the decision families (hiring, pricing, build vs buy,
  vendors, growth bets, funding, big clients, cost cuts, operations, strategy), the business factor canon, how
  stage/runway/risk/priority change the weighing, a scoring scale anchored to quarter/year/company-defining effects,
  confidence bands, and the biases companies fall into (sunk cost, optimism on demand and timelines, HiPPO,
  survivorship). It also applies when a question plainly is about a company (`isBusinessDecision`) even in personal
  mode. Jev gets the company and the lens in its `state`. Code still owns weights, the winner and every number.
- **Business templates**: hire or contract, change pricing, build or buy, pick a vendor, growth bet, funding, big
  client, cut costs. Shown in business mode.
- Offline, the local parser files company questions under Business with business factors.
- `ORION_BUSINESS_PLAYBOOK=off` switches the playbook off (kill switch, and the baseline for the eval).

**Measuring and fine-tuning.** None of the models ORION calls today can be fine-tuned by us (Jev is hosted; the free
models are shared), so the expertise lives in the prompt and is measured by `bun scripts/business-eval.ts`: real
company decisions run through the configured models and are graded on checks taken from the playbook (filed as
Business, 4–7 factors, sensible stakes, status quo offered, no invented numbers, cash weighed heavily on a short
runway, spending marked down on cash, humility on demand forecasts). `--compare` runs the same cases without the
playbook. `--export file.jsonl` writes every answer that passed all its checks as an OpenAI chat fine-tuning set;
upload it to OpenAI fine-tuning, then set `ORION_BUSINESS_MODEL=ft:…` (with `OPENAI_API_KEY`) and that model is
tried first for business decisions (`server/models.ts`, `server/router.ts`). Rerun the eval to check it is better.
Check the licence of whichever model wrote the transcripts before training on them.

## Templates, export, friends

- **Templates** (`src/decision-engine/templates.ts`): job offer, moving city, big purchase, going back to study,
  starting something, weekend plans, what to eat, movie night, what to wear. The person names the options; the
  template brings the factors, which stay editable.
- **Keep a copy** (`src/export/report.ts`): a PDF, an Excel workbook, a copied summary, Markdown or the print dialog;
  a share sheet on phones. The report has the question, the call, the factors, the ranking, what would change it,
  friends' votes and the choice. User text is escaped in the printable page.
- **The file writers** (`src/export/pdf.ts`, `src/export/xlsx.ts`): no dependency and no print dialog. `pdf.ts` is
  enough of PDF 1.4 to lay a report out — the standard Helvetica faces, wrapped text, tables that repeat their header
  across a page break, weight bars, a cover band. `xlsx.ts` writes a stored-entry ZIP of the OOXML parts Excel needs,
  with a frozen dark header row, filters, banded rows, measured column widths and real numbers, percentages and dates.
  Both are asserted structurally in `tests/export-files.test.js` (xref offsets, ZIP CRCs, style counts).
- **Ask a friend** (`server/share.ts`, `src/share/`, page `/s/[id]`): needs the account store. Only the title, option
  names and factor names are sent; friends pick an option, optionally what matters most and a note; only the owner key
  kept on the device reads the answers. Links last 30 days, take at most 50 answers and 5 per network per hour, and are
  removed when the decision is deleted or all data is erased. Votes sit beside the comparison and never change scores.

## Explaining itself

Home shows the three steps and says that vague questions are fine. After a question, "What ORION understood"
lists the options and factors it read, with **Not right? Edit** to correct them and re-run (`session.refine`).
If a question names no options, ORION asks for them before comparing anything. The result says what JEV means.

## Choosing against the comparison ("irrational" choices)

`src/decision-engine/divergence.ts` turns "irrational" into three numbers for any committed choice:

| Number | Meaning |
| --- | --- |
| `gap` | JEV points given up: leader minus the chosen option. |
| `certainty` | `gap` ÷ the two options' combined uncertainty (root of the summed squared half-ranges). |
| `implied` | The smallest change to one factor's weight that makes the chosen option the outright leader. |

Levels: `aligned` (chose the leader), `tossup` (certainty < 0.5 or gap < 0.75: within the noise, not irrational),
`against`, and `strongly_against` (certainty ≥ 1.25 and gap ≥ 2). When no weighting of the listed factors can put
the choice first, the explanation is outside the model: something unlisted is worth at least `gap` points.
The thresholds are judgement calls, set so that low-confidence estimates rarely call a choice irrational.

ORION never blocks the choice. `ChoiceCheck` shows the price, what would justify it, and asks what is behind it:
a factor matters more than stated (the weights are updated and remembered), something is missing (opens the
editor), the scores are wrong (opens the estimates table), or "I am choosing it anyway". The assessment and
reason are saved in `decision_choices`; Insights then shows how such choices turned out, by reason.

## Billing (Stripe)

Off until `STRIPE_SECRET_KEY`, at least one price and `ORION_LICENSE_SECRET` are set (`server/billing.ts`).
Billing itself keeps no database (with accounts on, the purchase is also recorded on the account, see above):

- **Plans** (`src/billing/plans.ts`, structure chosen with Jev via `scripts/jev-guide.ts`): the core product is free
  with no limit on decisions; ORION Pro (yearly, or monthly) opens the paid features on every decision; a one-time
  pass opens them for a single decision for good. Paid features: deep analysis, "what would justify your choice",
  and Insights on how choices turn out. Friend input and reminders are deliberately not on that list.
- Set `STRIPE_PRICE_YEARLY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_PASS` (any subset). Amounts live in Stripe.
- Profile, or the locked feature itself, opens Stripe Checkout. Stripe returns to `/you?checkout=cs_…`; the server
  confirms the session and signs either a 24-hour licence (subscription) or a pass for that decision (one-time).
- The paid features are computed in the app from data on the device, so the lock is in the app, not the server.
  It keeps honest people honest; it is not copy protection.
- `ORION_FREE_DAILY` is now only an optional abuse cap on scored decisions.
- The app renews the licence on start; the server renews only while Stripe reports the subscription `active` or
  `trialing`, so a cancellation takes effect within a day without webhooks.
- *Manage subscription* opens the Stripe billing portal (`scripts/stripe-setup.ts` configures it).
- **Setup:** `STRIPE_SECRET_KEY=sk_test_… bun scripts/stripe-setup.ts https://your-site` creates the product, the three
  prices, the portal and the webhook (rerunnable), and prints the env lines. Do it with a test key first, then live.
- **Webhook** (`STRIPE_WEBHOOK_SECRET`, route `/billing/stripe-webhook`, signature checked, 5-minute replay window):
  on `checkout.session.completed` from a signed-in account (checkout sends the account's email as metadata) the
  purchase is attached to that account even if the buyer never returned to the app. Without the secret the route is
  off and only the return trip fulfils a purchase. Refunds and disputes are not handled: refund in Stripe, and a
  subscription stops within a day, but a one-time pass already issued stays.

Known limits: the free count is per account (per IP address without accounts) and resets when the server restarts.
On a server without accounts the subscription lives on the device that paid and a licence could be copied to
another device.

## Mobile money (Paypack, Rwanda)

For people who pay by phone (MTN MoMo, Airtel Money). Off until `PAYPACK_CLIENT_ID`, `PAYPACK_CLIENT_SECRET`, at least one
`PAYPACK_PRICE_*` (whole RWF) and `ORION_LICENSE_SECRET` are set (`server/paypack.ts`); it works with or without Stripe.

- `POST /billing/paypack/start {plan, phone}` sends the payment prompt (Paypack cash-in, a fresh `Idempotency-Key` each time)
  and returns a signed ticket: reference, plan, amount and start time. The number goes to Paypack only; ORION never stores or logs it.
- `POST /billing/paypack/status {ticket}` answers `pending`, `failed` or `paid`. Paid means the exact reference, a cash-in and the
  full amount; then it returns the same licence or pass a card payment would. The app polls this for about three minutes and
  checks once more on the next start if the page was closed.
- `HEAD|POST /billing/paypack/webhook` is Paypack's `transaction:processed` event. The `X-Paypack-Signature` header must be the
  base64 HMAC-SHA256 of the raw body with `PAYPACK_WEBHOOK_SECRET`; with a store configured the outcome is kept for 30 days so a
  status check need not wait for Paypack's API. Set the URL to `https://<your domain>/billing/paypack/webhook`.
- Mobile money is prepaid: a month is 30 days, a year 365, counted from when the payment started, so checking a ticket twice
  never adds time. The licence carries its end date and the server renews it alone until then (`/billing/refresh`).
  A signed-in purchase is kept on the account, as with Stripe.

## The result: the answer first, the analysis one tap away

Beta testers found the result read like a research paper. For an everyday or serious decision the first screen is now
only: ORION's call in one sentence, why (at most two reasons, from the sensitivity attribution), what would change the
answer (one sentence; `plainFlip` in `src/copy/plain.ts` drops the engine's working, such as "(gap 3.2)"), the Decide /
Not yet buttons, and one button, **Show me the full analysis**. Behind it: the score, the confidence, robustness and
reversibility readouts, the per-factor bars, the questions, More / Less priorities, the ranking, "Explain the trade-offs"
(only ever requested on that tap) and the estimates table. The analysis stays mounted while hidden, so nothing typed or
tapped is lost. No score, scale, chart or percentage appears before the button. A tie says "Too close to call" in the
first line and never invents a winner. Fun decisions keep the call alone until "Show me why"; without AI the quick
questions run first; crisis and support paths are unchanged.

## Changing what matters on the result

Under ORION's call, "What would change the answer" is always shown, and each factor has More / Less (`WhatMatters.tsx`,
`session.nudgeWeight`, `nudgedWeights` in `expectedValue.ts`). A tap scales that factor's weight by 1.6 (floor 2%), renormalises,
and the same deterministic engine re-ranks; ORION then says whether the leader held or changed and why. Nothing is asked of the
AI again and nothing is saved as a preference until the person decides.

## Your data

Decisions, outcomes and preferences live only on the device (SQLite on native, `localStorage` on web). Profile →
*Your data* exports everything — a PDF to read (a summary, then a chapter per decision), an Excel workbook (a tab per
kind of record) or the JSON backup — or erases it; History deletes a single decision with all of its rows
(`src/db/decisions.ts`, `src/export/archive.ts`). The PDF and the workbook are readings of the data: ids become names
and stored JSON becomes sentences, and sharing keys are left out of both. JSON stays the complete copy and the only
one `importData` can restore. Lines under Profile → *Personal context* are sent with each question so scores fit the
person.

## Key rules encoded

- §5/§30 stopping rule: never ask unless it could change the result; tiny +
  reversible + strong leader → "You probably know enough."
- §7 confidence ≠ probability; low confidence widens the band.
- §8 reversibility per option; §9 best-thing-to-learn from dominant factor;
  §10 "what would have to be true" thresholds, solved exactly as
  `gap / weight` rather than guessed as a percentage; §12 analysis ≠ decision;
  §39 offline manual JEV; §41 private decisions and answers are not saved; §42 safety classes
  with professional-advice notices.
- Safety is intent-aware. Violence needs a person as its object and theft needs
  intent phrasing, so "hack together a prototype", "steal the show", "kill
  time", "attack this bug" and "poison the weeds" stay ordinary decisions
  instead of dead-ending. `tests/safety.test.js` pins both directions.
- A render crash shows what broke and a way back, rather than a blank screen.
  Saved decisions are untouched by it.

## Validation and remaining work

Session tests cover manual estimates, save/reopen, repeated saves, private
answers, stale submissions, save failures with rollback using the memory
database, and that a decision and its prediction commit or roll back as one.
Scenario tests pin the all-or-nothing rules and show outcomes reordering a
ranking rather than decorating it. Calibration tests refuse a verdict from fewer
than five reviews. `tests/decisionSupport.test.js` covers the modules the screens
depend on directly: hard constraints removing options, soft penalties moving the
ranking, an unrecognised comparison operator being ignored rather than guessed at,
the reported gap being the adjusted one, and what-if simulation leaving its inputs
untouched.

Two guards live in the engine rather than in the screens, so no caller can
bypass them: a crisis decision is refused a leader and a recommendation by
`evaluatePolicy`, and a support-path decision is never scored by the shared model.

The Decide and Analysis screens read one shared model, so they cannot disagree:
`useDecisionModel` applies criteria, then evidence, then scores, then policy and
robustness in that order. Options ruled out by a hard constraint are shown with
the reason and cannot be committed.

Where ORION declines to answer it says so: no impact estimates yet, a tie, a
decision with a single outcome and therefore no robustness to test, a scenario
battery skipped for exceeding the provider's factor limit, and criteria that
matched no factor. Unresolved questions are saved with their estimated impact so
a later review can resolve them.

The native SQLite backend still needs verification on an Android or iOS device.
On web there is no SQLite backend, so the memory store is mirrored to
`localStorage` (`orion.db.v1`) and history survives a reload; without
`localStorage` the memory fallback is temporary and does not survive restarts.
Insights reads the saved outcome ratings (`src/db/insights.ts`) to show how
often choices that followed the leading option turned out well.

Provider scoring needs a configured server and real TypeSafe key; local tests
exercise deterministic fallback rather than a live provider. The scenario battery
on the server is likewise covered by unit tests against synthetic answers, not
live provider output. Android bundle export verifies Metro compilation, not an
installed app or native runtime. Native navigation dependencies are explicitly
pinned to the versions in the installed Expo SDK 52 compatibility manifest.

Verified on 2026-10-10: 443 tests, TypeScript and ESLint pass (after merging main's Aftermath futures and sign-in hardening). `bun run build:web` served by `bun run serve` was driven
headless (Playwright, Chromium) at 390 px and 1366 px through a fun, an everyday, a serious and a tied decision and the
offline quick questions, with a local stand-in for the AI providers; no console errors, no horizontal overflow, and no
score, scale or percentage on the first screen.

Verified on 2026-10-07: 316 tests, TypeScript and ESLint pass. `bun run build:web` is a script
(`scripts/build-web.ts`) so it also works on Windows, where the old inline `${EXPO_PUBLIC_ORION_API:-/}` built an
offline app.

Earlier, on 2026-10-04: 206 tests, TypeScript and ESLint pass (`bun run check`); `bun run build:web` succeeds and
the result, served by `bun run serve`, was driven in headless Chromium through ask → score → save → resume →
choose → analysis → history → export → delete with no console or content-security-policy errors.

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
