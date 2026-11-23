// Puts ORION's open design and pricing decisions to Jev (TypeSafe System One), one part of the system at a time.
// Jev picks among alternatives written here, given the state written here: it is a judgement on these options,
// not market data. Results are printed and saved so the decisions can be traced.
//
//   bun scripts/jev-guide.ts            # all parts, in order
//   bun scripts/jev-guide.ts pricing    # only parts whose name starts with "pricing"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { systemOne, type ChoiceQuestion, type ScoreQuestion, type SystemOneQuestion } from "../server/typesafe.ts";

const product = {
  what: "ORION is a web app that helps a person make a decision. They type a question in their own words; ORION names the options and the factors that matter, scores each option on each factor, shows which option comes out ahead and why, what would change it, and lets them record their choice and later how it turned out.",
  audience: "Adults stuck on a personal decision. Acquisition targets decisions that matter (job offer, moving, a big purchase, ending something); everyday choices (what to eat, bus or taxi) keep people coming back.",
  usage_pattern: "Episodic. A person has a hard decision a few times a year and small ones weekly. Most visits are a single decision lasting two to five minutes.",
  stage: "Public beta, desktop web first, free. A few dozen testers.",
  beta_feedback: [
    "Rating every option on every factor themselves was tiring; people want ORION to do the scoring.",
    "The interface must explain itself: people should understand how it works without being told.",
    "People ask vague questions and still expect a useful answer.",
    "People sometimes want to choose an option the comparison does not favour, and do not want to be lectured.",
  ],
  brand: "Calm and premium: dusk sky, frosted glass panels, thin geometric type, one electric blue for the next step. Tagline on the launch posters: 'Make better decisions. Live a better life.' and 'A clearer you, a brighter tomorrow.'",
  principles: ["The analysis informs; the person decides.", "Never fabricate certainty: estimates are shown as estimates.", "One primary action per screen region."],
};

const market = {
  cost_to_serve: "About 0.1 to 1 US cent per decision. Cost does not constrain price.",
  benchmarks: [
    "Freemium apps convert a median 2.1% of downloads to paid by day 35; hard paywalls convert 10.7%, with similar one-year retention.",
    "Lower-priced subscription apps keep a median 36% of yearly subscribers after a year; high-priced ones keep 23%.",
    "AI apps earn more per customer but lose subscribers about 30% faster than other apps.",
    "Offering a one-time purchase beside a subscription is reported to lift total conversion by 15 to 25%.",
    "Download-to-paid conversion is about 2.6% in North America, 2.0% in Western Europe, 1.4% in India and Southeast Asia.",
    "Consumers increasingly resist recurring fees; one-time purchases are gaining share.",
  ],
  payments: "Card payments through Stripe: 2.9% plus 30 US cents per charge, so very small charges lose a large share to fees.",
  growth: "Growth is meant to be organic: search pages for specific dilemmas, shared decision links, and inviting a friend to weigh in. These need people to use ORION free before they pay.",
  competitors: "General chatbots answer decision questions free. Small 'help me decide' apps treat it as entertainment (what to eat, what to watch).",
  not_built_yet: ["Inviting a friend to weigh in on a decision", "Reminders to rate how a decision turned out (needs email)"],
  built: ["Verdict and ranking", "What ORION understood, editable", "Scenario analysis and what would have to be true", "Insights: how past choices turned out, including choices against the comparison", "Account with backup across browsers", "Export of all data"],
};

const choice = (instructions: string, criteria: Record<string, string>): ChoiceQuestion => ({ type: "choice", instructions, criteria });
const PAY_LEVELS = [
  "Nobody would notice if it were missing; it would not move anyone to pay.",
  "A pleasant extra. Some people would use it, but nobody would pay for it on its own.",
  "Clearly useful at the moment of a hard decision. Some people would pay to have it.",
  "The reason someone takes out their card: at the moment of a hard decision they want exactly this.",
];
const HARM_LEVELS = [
  "Locking it changes nothing for free users; they would not miss it.",
  "Free users would notice it is locked but still get a complete, useful answer.",
  "Locking it makes the free product feel cut down, or blocks people from sharing or returning.",
  "Locking it breaks the free product: the core answer would be missing or growth through sharing would stop.",
];
const FEATURES: Record<string, string> = {
  friend_input: "Invite a friend to weigh in on a decision through a link, and see where they agree or disagree.",
  outcome_reminders: "A reminder some weeks later to record how the decision turned out.",
  full_insights: "Insights across all past decisions: how often following the comparison turned out well, and how the person's choices against it turned out.",
  deep_analysis: "Deep analysis of one decision: conservative, expected and optimistic scenarios, what would have to be true for another option to win, and the estimates behind every number.",
  choice_justification: "When the person picks an option the comparison does not favour: what it costs, and what would have to matter more for it to be the better choice.",
  editable_understanding: "Seeing and correcting the options and factors ORION read out of the question.",
  account_backup: "An account that backs decisions up and brings them to another browser.",
  unlimited_history: "Keeping every past decision rather than only the most recent ten.",
  written_explanation: "A written, plain-language explanation of the trade-offs in a decision.",
  data_export: "Exporting everything as a file.",
};
const featureScores = (levels: string[], question: string): Record<string, ScoreQuestion> =>
  Object.fromEntries(Object.entries(FEATURES).map(([key, text]) => [key, { type: "score", instructions: `${question} The feature: ${text}`, criteria: levels }]));

interface Part { name: string; about: string; state: object; questions: Record<string, SystemOneQuestion> }

const PARTS: Part[] = [
  {
    name: "design-home",
    about: "Home: the first screen",
    state: { product, screen: "The first screen a visitor sees. It has one text input, 'What are you deciding?', over a dusk-sky backdrop, with example questions below. A first-time visitor arrives from a search result or a shared link and has never heard of ORION." },
    questions: {
      headline: choice("Which line above the input best gets a first-time visitor to type their own question?", {
        brand_tagline: "The poster tagline: 'A clearer you, a brighter tomorrow.' It sets a mood and says nothing about what the product does.",
        problem_line: "A line that names the visitor's situation and the result: 'Stuck on a decision? See it laid out in two minutes.'",
        question_only: "No headline. The input's own prompt, 'What are you deciding?', shown large, is the only text.",
        outcome_line: "A line about the long-term benefit: 'Decide with a clear head, and find out later if you were right.'",
      }),
      examples: choice("Which example questions should the first screen show, to be clicked or to show what kind of question to ask?", {
        everyday: "Small daily choices only: 'Coffee here or on the way?', 'Gym before work or tonight?', 'Cook at home or order food?'",
        big_decisions: "Decisions that matter only: 'Take the job in Berlin or stay?', 'Rent a bigger flat or stay put?', 'Go back to study or keep working?'",
        mixed: "One everyday choice and two decisions that matter, so both kinds are visibly welcome.",
        none: "No examples; the input stands alone.",
      }),
      how_it_works: choice("Where should the short three-step 'How it works' explanation go on the first screen?", {
        beside_input: "Directly under the input, before the examples, so it is read before the person types.",
        below_examples: "Below the examples, reached by scrolling a little.",
        behind_link: "Hidden behind a 'How it works' link that opens it.",
        first_visit_only: "Shown directly under the input on a person's first visit, and collapsed to a link after they have made a decision.",
      }),
    },
  },
  {
    name: "design-result",
    about: "The result: what a person sees after asking",
    state: { product, screen: "The result page for one decision, on a wide desktop window with a main column and a narrower side column. Parts available: (a) the verdict: the option that comes out ahead, its score, and a sentence on why; (b) a ranking of every option with its likely range; (c) 'What ORION understood': the options and factors it read from the question, with an edit button; (d) 'What will you do?': buttons to record the person's own choice." },
    questions: {
      order: choice("In what order should the main column present these parts?", {
        understood_first: "'What ORION understood' first, then the verdict, then the ranking. The person checks the reading before seeing the answer.",
        verdict_first_understood_last: "The verdict first, then the ranking, then 'What ORION understood' as a full card at the bottom.",
        verdict_first_understood_inline: "The verdict first with a one-line summary of what was understood directly under the page title ('Comparing A and B on cost, time, comfort · Edit'), then the ranking. The full editor opens only when 'Edit' is pressed.",
      }),
      score_name: choice("The score is internally called JEV (an expected-value figure from −10 to +10). What should the interface call it?", {
        jev_only: "'JEV' everywhere, with a sentence explaining it.",
        plain_score: "'Score' everywhere; the term JEV never appears.",
        plain_with_jev_once: "'Score' everywhere, with JEV named once inside the explanation of how the score is calculated.",
      }),
      explanation: choice("How should the explanation of how the score is calculated be offered on the result page?", {
        always_visible: "A short paragraph always visible under the verdict.",
        on_request: "A 'How is this calculated?' link under the verdict that opens the paragraph.",
        one_line_plus_more: "One always-visible line ('Estimates, not facts: each option scored on what matters to you') with a 'How is this calculated?' link for the rest.",
      }),
      verdict_label: choice("What label should sit above the leading option's name?", {
        currently_strongest: "'Currently strongest option': hedged, signals it can change.",
        orions_pick: "'ORION's pick': direct, presents it as a recommendation.",
        comes_out_ahead: "'Comes out ahead on what matters to you': ties the result to the person's own priorities.",
        best_option: "'Best option': shortest and most confident.",
      }),
      commit_placement: choice("Where should 'What will you do?' (the buttons to record the person's own choice) sit on a wide desktop window?", {
        side_panel: "In the side column, staying in view while the main column scrolls.",
        after_verdict: "In the main column directly after the verdict and ranking.",
        bottom_bar: "A bar fixed to the bottom of the window.",
      }),
    },
  },
  {
    name: "design-against",
    about: "When someone chooses against the comparison",
    state: { product, situation: "The person has just recorded a choice that the comparison does not rank first, by a clear margin. ORION can show what the choice costs in score, how sure the comparison is, and what would have to matter more for the choice to be the better one, and can ask what is behind it." },
    questions: {
      presentation: choice("How should ORION respond at that moment?", {
        inline_card: "A calm card in the same panel as the choice buttons: the numbers, then 'What is behind it?' with four answers. The choice is already saved.",
        confirm_dialog: "A dialog that interrupts before saving: 'Are you sure?' with the numbers, and Confirm or Go back.",
        quiet_line: "One quiet line of text noting that another option scores higher; details only if the person asks.",
        nothing: "Nothing. The choice is the person's and is saved without comment.",
      }),
      naming: choice("What should the heading of that response say?", {
        against_the_comparison: "'Against the comparison': neutral, about the numbers.",
        heart_over_head: "'Heart over head': warm, a little playful.",
        your_call: "'Your call': affirms the person's right to choose.",
        irrational: "'Irrational choice': blunt and technical.",
      }),
    },
  },
  {
    name: "design-account",
    about: "Asking people to create an account",
    state: { product, situation: "ORION works without an account; everything then stays in the browser. An account backs decisions up and brings them to another browser. Signing up takes an email and a password." },
    questions: {
      prompt_moment: choice("When should ORION suggest creating an account?", {
        top_bar_only: "Never proactively: a 'Sign in' button in the top bar and a card in Profile.",
        after_first_save: "After the person records their first choice: one dismissible line under the saved message, 'Create a free account to keep this on any device'.",
        before_first_result: "Before showing the first result: sign up to see the answer.",
        on_return_visit: "On a second visit, when the person already has saved decisions: one dismissible line on Home.",
      }),
    },
  },
  {
    name: "design-insights",
    about: "Insights and History before there is data",
    state: { product, situation: "A new person opens Insights or History before they have saved anything. Insights will later show how their choices turned out." },
    questions: {
      empty_insights: choice("What should Insights show before there is any data?", {
        zero_tiles: "The real layout with every figure at zero, plus a short note on what will appear.",
        explanation_only: "Only a short explanation and a button to start a decision.",
        sample_preview: "A clearly labelled example of what Insights will look like after a few decisions, plus a button to start one.",
      }),
    },
  },
  {
    name: "pricing-structure",
    about: "Pricing: the overall structure",
    state: { product, market },
    questions: {
      model: choice("Which pricing structure should ORION adopt once the beta ends?", {
        free_plus_yearly_and_pass: "Free core product; a paid plan billed yearly (with a monthly option); and a one-time pass that unlocks the paid features for a single decision.",
        subscription_only: "Free core product and one paid subscription (monthly or yearly); no one-time purchase.",
        pay_per_decision_only: "Free core product; paid features are bought one decision at a time; no subscription.",
        hard_paywall: "One free decision, then payment is required to use ORION at all.",
        free_forever: "Everything free; no paid plan.",
      }),
      free_meter: choice("What should limit the free product?", {
        daily_count: "A number of analysed decisions per day; everything else is free.",
        depth: "No limit on decisions. The free product gives the full answer; deeper features are paid.",
        first_full_then_depth: "The first decision gets every paid feature free as a taste; after that, no limit on decisions and deeper features are paid.",
        time_trial: "Everything free for 14 days, then payment is required for the deeper features.",
      }),
      during_beta: choice("What should ORION charge during the beta, before the paid features are all built?", {
        free_no_offer: "Nothing. No mention of price.",
        founding_yearly: "Free to use, with an optional founding-member plan at a low yearly price locked for life, to learn whether anyone pays.",
        founding_lifetime: "Free to use, with an optional one-time lifetime purchase for early supporters.",
        waitlist_only: "Free to use; people can join a list to be told when paid plans launch.",
      }),
      regional: choice("How should prices vary by country?", {
        one_global_price: "One price in US dollars everywhere.",
        local_tiers: "Lower prices in local currency for lower-income regions, at roughly half the US price.",
        us_eu_only: "Sell only in North America and Europe at first.",
      }),
    },
  },
  {
    name: "pricing-points",
    about: "Pricing: the price points",
    state: { product, market, premise: "Assume a free core product, a yearly plan with a monthly option, and a one-time pass for a single decision. Prices are for North America and Western Europe, in US dollars." },
    questions: {
      yearly: choice("What should the yearly plan cost?", {
        usd_19: "$19.99 a year.", usd_29: "$29.99 a year.", usd_39: "$39.99 a year.", usd_59: "$59.99 a year.",
      }),
      monthly: choice("What should the monthly option cost?", {
        none: "No monthly option; yearly only.", usd_3: "$3.99 a month.", usd_5: "$4.99 a month.", usd_8: "$7.99 a month.",
      }),
      pass_price: choice("What should the one-time pass for a single decision cost?", {
        usd_2: "$1.99.", usd_3: "$2.99.", usd_5: "$4.99.", usd_8: "$7.99.", usd_10: "$9.99.",
      }),
      pass_scope: choice("What should the one-time pass unlock?", {
        one_decision_forever: "The paid features for one decision, kept for as long as that decision exists.",
        seven_days: "The paid features for every decision for seven days.",
        thirty_days: "The paid features for every decision for thirty days, without renewing.",
      }),
      highlighted: choice("Which option should the plans screen present as the recommended one?", {
        yearly: "The yearly plan.", monthly: "The monthly option.", pass: "The one-time pass.",
      }),
      paywall_moment: choice("At which moment should the paid plan first be offered?", {
        opening_deep_analysis: "When the person opens the deep analysis of a decision.",
        inviting_a_friend: "When the person tries to invite a friend to weigh in.",
        after_committing: "Right after the person records their choice.",
        opening_insights: "When the person opens Insights.",
        profile_only: "Never in the flow; only on the Profile page.",
      }),
    },
  },
  {
    name: "pricing-features-pay",
    about: "Pricing: which features people would pay for",
    state: { product, market },
    questions: featureScores(PAY_LEVELS, "How much would this feature move a person in the middle of a hard decision to pay?"),
  },
  {
    name: "pricing-features-harm",
    about: "Pricing: what locking each feature would cost the free product",
    state: { product, market },
    questions: featureScores(HARM_LEVELS, "If this feature were available only to paying users, what would that do to the free product and to growth?"),
  },
  {
    name: "engine-aftermath",
    about: "Engine: what to improve next in the aftermath model",
    state: {
      product,
      model: "The aftermath pictures what follows from choosing an option at moments from the first days to five years out. Each factor's estimated impact (−10..10) plays out along a pace (felt at once, fades, settles, builds over months, compounds), chosen today by matching keywords in the factor's name; names that match nothing get a default pace. At each moment it shows the net effect, a likely range and the odds of clearly well / mixed / clearly hard from a normal distribution. Just fixed: estimate doubt and life's noise combine as variances, noise levels off after a few years, factor errors are correlated, unsure estimates fade towards 'no difference' further out, and easy-to-undo choices cut the bad tail.",
      data: "Public beta with a few dozen testers. Check-ins record how decisions turned out at set moments, but only a handful of outcomes exist so far, and almost none past three months.",
      beta_feedback: "Testers love the design but found results too dense; the aftermath is now behind 'See the full analysis'. They want a simple answer first.",
    },
    questions: {
      next_improvement: choice("Which single improvement to the aftermath model should be built next, given the data that exists today?", {
        calibrate: "Fit the noise, uncertainty growth, error correlation and pace timings to recorded check-in outcomes, scored on how well predicted odds matched what happened.",
        model_pace: "Have the AI that reads the question also assign each factor its pace, instead of matching keywords in the factor's name, so factors like 'Rent' or 'Kids' stop falling to the default.",
        path_simulation: "Simulate thousands of possible paths through time so the model can say how likely it is to be going well at year one and still at year three, and where options really cross.",
        fat_tails: "Use a fatter-tailed distribution than the normal so rare extreme outcomes years out are not made almost impossible.",
        asymmetric_adaptation: "Let people adapt to gains faster than to some losses, instead of fading both the same way.",
      }),
      pace_source: choice("If the pace of each factor is to be more accurate, where should it come from?", {
        keywords_only: "Keep matching keywords in the factor's name; extend the word lists.",
        model_only: "The AI that reads the question assigns every factor a pace; no keyword matching.",
        model_with_fallback: "The AI assigns a pace when it can; keyword matching fills in when it does not (offline, or a missing or invalid answer).",
      }),
      long_range_display: choice("How should moments years out be shown to someone who opens the full analysis?", {
        same_as_near: "The same as the near term: net effect, range and odds.",
        labelled_projection: "Shown, but clearly labelled as a projection, with the range drawn wider and the odds rounded more coarsely.",
        folded: "Up to a year by default; the years beyond behind a further 'Look further ahead'.",
      }),
    },
  },
  {
    name: "engine-speed",
    about: "Engine: making 'Reading your question' fast",
    state: {
      product,
      measured_2026_10_11: [
        "Reading the question (parse) is one AI call before scoring can start. Testers waited about 15 s in total.",
        "Only free models on OpenRouter are configured. Of 7 free models tried on 3 questions each, 1 of 21 parses succeeded (22.8 s).",
        "Failures: the parse asks for a large answer (about 3,000 characters: options with rationale, risks and reversibility, factors with provenance, obligations, generated options, a provenance map), and most small models return the wrong shape for parts of it, which is rejected and retried on the next model.",
        "The fastest model (a 4B-active mixture of experts) answered in about a second but was rate-limited (HTTP 429) on the free tier.",
        "The rich fields (rationale, risks, provenance, obligations) are shown only in the detailed analysis, which is now behind 'See the full analysis'. The answer needs: title, options, factors with importance and pace, stakes, safety, category.",
        "An offline parser in the app reads options from 'A or B' questions instantly, but guesses poorly for open-ended situations.",
        "A paid small model (gpt-5.4-nano, about 0.02 US cents per parse) is supported but no key is configured.",
      ],
    },
    questions: {
      strategy: choice("Which change would cut the wait for 'Reading your question' the most while keeping answers good?", {
        lean_parse: "Ask for only what the answer needs (title, options, factors with importance and pace, stakes, safety, category), with a small, forgiving schema; fetch the rich fields later, only if the detailed analysis is opened.",
        fix_schema_only: "Keep the full parse but fix the schema mistakes and accept common shape variations, so fewer answers are rejected.",
        race_models: "Keep the full parse and send it to two or three free models at once from the start; take the first valid answer.",
        paid_model: "Add a paid small model key and route parsing there first.",
        local_first: "Start scoring straight away from the offline parser's reading when the question names its options, and use the AI parse only for open-ended questions.",
      }),
      racing: choice("Once the parse is lean, should requests be sent to more than one free model at once?", {
        one_then_hedge: "One model first; start a second only if the first is slow (today's behaviour).",
        two_at_once: "Two different free models from the start; the first valid answer wins, the other is cancelled.",
        three_at_once: "Three at once.",
      }),
    },
  },
];

const only = process.argv[2];
const saved = "node_modules/.cache/orion-check/jev-guide.json";
// Running one part keeps the others' earlier answers.
const results: Record<string, unknown> = existsSync(saved) ? JSON.parse(readFileSync(saved, "utf8")) : {};
for (const part of PARTS.filter((p) => !only || p.name.startsWith(only))) {
  console.log(`\n== ${part.about} ==`);
  const response = await systemOne(part.state, part.questions, { timeoutMs: 45_000 });
  results[part.name] = response.answers;
  for (const [key, answer] of Object.entries(response.answers)) {
    if (answer.type === "choice") {
      const ranked = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]).map(([name, p]) => `${name} ${(p * 100).toFixed(0)}%`).join(", ");
      console.log(`${key}: ${answer.choice} (confidence ${answer.confidence.toFixed(2)}) | ${ranked}`);
    } else if (answer.type === "score") {
      const top = Object.keys(answer.legend).length - 1;
      console.log(`${key}: ${(answer.score / top).toFixed(2)} of 1 (raw ${answer.score.toFixed(2)}/${top}, confidence ${answer.confidence.toFixed(2)})`);
    }
  }
}
mkdirSync("node_modules/.cache/orion-check", { recursive: true });
writeFileSync(saved, JSON.stringify(results, null, 2));
