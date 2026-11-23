// Ready-made starting points for decisions people make again and again. A template supplies what a good
// comparison of that kind weighs, so the person only names their options. Factors and their starting importance are
// judgement calls, shown and editable like any other reading of a question.
import type { DecisionCategory, Stakes } from "../types.ts";
import type { DecisionMode } from "./mode.ts";
import { listPhrase, msg, t } from "../i18n/index.ts";

export interface DecisionTemplate {
  id: string;
  name: string;
  /** Ionicons name. */
  icon: string;
  mode: DecisionMode;
  stakes: Stakes;
  category: DecisionCategory[];
  /** One line under the name. */
  blurb: string;
  /** Labels and starting values for the option fields (2–4). */
  options: { placeholder: string; value: string }[];
  factors: { label: string; importance: number; reason: string }[];
  /** Business templates show in business mode, personal ones otherwise. Default personal. */
  audience?: "personal" | "business";
  /** The question as the person might have typed it, from their option names. */
  question: (options: string[]) => string;
}

/**
 * The words are written in English with msg() and read in the current language each time they are used, so a
 * template picked after switching to Korean has Korean names, options and factors. Ids and numbers stay as they are.
 */
function localized(raw: DecisionTemplate): DecisionTemplate {
  return {
    ...raw,
    get name() { return t(raw.name); },
    get blurb() { return t(raw.blurb); },
    get options() { return raw.options.map((o) => ({ placeholder: t(o.placeholder), value: o.value && t(o.value) })); },
    get factors() { return raw.factors.map((f) => ({ ...f, label: t(f.label), reason: t(f.reason) })); },
  };
}

// "a or b", "a, b or c" (Korean: "a 또는 b").
const list = (items: string[]) => listPhrase(items, "or");
const lower = (o: string[]) => list(o.map((x) => x.toLowerCase()));

export const TEMPLATES: DecisionTemplate[] = ([
  {
    id: "job-offer", name: msg("Job offer"), icon: "briefcase", mode: "serious", stakes: "significant", category: ["Career", "Money"],
    blurb: msg("A new offer against what you have now."),
    options: [{ placeholder: msg("The offer"), value: msg("Take the new job") }, { placeholder: msg("The alternative"), value: msg("Stay where I am") }],
    factors: [
      { label: msg("Pay"), importance: 0.8, reason: msg("Total compensation, not just salary.") },
      { label: msg("Growth"), importance: 0.8, reason: msg("What you will learn and where it leads.") },
      { label: msg("Work-life balance"), importance: 0.7, reason: msg("Hours, stress, flexibility.") },
      { label: msg("Stability"), importance: 0.5, reason: msg("How secure the role and company are.") },
      { label: msg("Commute"), importance: 0.4, reason: msg("Time and cost of getting there.") },
    ],
    question: (o) => t("Should I {options}?", { options: lower(o) }),
  },
  {
    id: "move-city", name: msg("Moving city"), icon: "home-outline", mode: "serious", stakes: "significant", category: ["Home", "Major life decision"],
    blurb: msg("Relocate, or stay put."),
    options: [{ placeholder: msg("Where you might go"), value: msg("Move to the new city") }, { placeholder: msg("The alternative"), value: msg("Stay where I am") }],
    factors: [
      { label: msg("Cost of living"), importance: 0.7, reason: msg("Rent, prices, taxes.") },
      { label: msg("Career"), importance: 0.7, reason: msg("Jobs and opportunities there.") },
      { label: msg("Friends and family"), importance: 0.8, reason: msg("Who you would be near, or far from.") },
      { label: msg("Lifestyle"), importance: 0.6, reason: msg("What daily life would feel like.") },
      { label: msg("Effort of moving"), importance: 0.3, reason: msg("Hassle and one-off cost.") },
    ],
    question: (o) => t("Should I {options}?", { options: lower(o) }),
  },
  {
    id: "big-purchase", name: msg("Big purchase"), icon: "card-outline", mode: "everyday", stakes: "normal", category: ["Purchase", "Money"],
    blurb: msg("Buy it, wait, or skip it."),
    options: [{ placeholder: msg("Option 1"), value: msg("Buy it now") }, { placeholder: msg("Option 2"), value: msg("Wait for a better deal") }, { placeholder: msg("Option 3 (optional)"), value: msg("Don't buy it") }],
    factors: [
      { label: msg("Cost"), importance: 0.8, reason: msg("What it takes out of your budget.") },
      { label: msg("Need"), importance: 0.7, reason: msg("How much you actually need it.") },
      { label: msg("How much I'd use it"), importance: 0.7, reason: msg("Use per pound/dollar spent.") },
      { label: msg("Regret risk"), importance: 0.4, reason: msg("How likely you are to wish you hadn't.") },
    ],
    question: (o) => t("Should I {options}?", { options: lower(o) }),
  },
  {
    id: "study", name: msg("Go back to study"), icon: "school-outline", mode: "serious", stakes: "significant", category: ["Education", "Career"],
    blurb: msg("A course or degree, or not now."),
    options: [{ placeholder: msg("The course"), value: msg("Enrol in the course") }, { placeholder: msg("The alternative"), value: msg("Keep working instead") }],
    factors: [
      { label: msg("Cost"), importance: 0.7, reason: msg("Fees and lost earnings.") },
      { label: msg("Career payoff"), importance: 0.8, reason: msg("What it opens up afterwards.") },
      { label: msg("Time"), importance: 0.5, reason: msg("Hours a week, and for how long.") },
      { label: msg("Interest"), importance: 0.6, reason: msg("Whether you will enjoy it enough to finish.") },
    ],
    question: (o) => t("Should I {options}?", { options: lower(o) }),
  },
  {
    id: "side-project", name: msg("Start something"), icon: "rocket-outline", mode: "serious", stakes: "significant", category: ["Business", "Personal growth"],
    blurb: msg("A side business or project."),
    options: [{ placeholder: msg("The idea"), value: msg("Start the side business") }, { placeholder: msg("The alternative"), value: msg("Not now") }],
    factors: [
      { label: msg("Income potential"), importance: 0.6, reason: msg("What it could bring in.") },
      { label: msg("Risk"), importance: 0.6, reason: msg("Money and time you could lose.") },
      { label: msg("Time and energy"), importance: 0.7, reason: msg("What it takes from the rest of life.") },
      { label: msg("Learning"), importance: 0.5, reason: msg("What you would get out of it regardless.") },
    ],
    question: (o) => t("Should I {options}?", { options: lower(o) }),
  },
  {
    id: "weekend", name: msg("Weekend plans"), icon: "sunny-outline", mode: "everyday", stakes: "tiny", category: ["Social", "Lifestyle"],
    blurb: msg("Go out, stay in, or something else."),
    options: [{ placeholder: msg("Plan A"), value: msg("Go out with friends") }, { placeholder: msg("Plan B"), value: msg("A quiet weekend at home") }],
    factors: [
      { label: msg("Fun"), importance: 0.8, reason: msg("How much you will enjoy it.") },
      { label: msg("Rest"), importance: 0.6, reason: msg("Whether you will feel recharged.") },
      { label: msg("Cost"), importance: 0.4, reason: msg("What it costs.") },
    ],
    question: (o) => t("This weekend: {options}?", { options: list(o) }),
  },
  {
    id: "food", name: msg("What to eat"), icon: "pizza-outline", mode: "playful", stakes: "tiny", category: ["Food"],
    blurb: msg("The eternal question. ORION will just call it."),
    options: [{ placeholder: msg("Option 1"), value: msg("Pizza") }, { placeholder: msg("Option 2"), value: msg("Tacos") }, { placeholder: msg("Option 3 (optional)"), value: msg("Sushi") }],
    factors: [
      { label: msg("Craving"), importance: 0.9, reason: msg("What you actually want right now.") },
      { label: msg("Effort"), importance: 0.4, reason: msg("How easy it is to get.") },
      { label: msg("Cost"), importance: 0.3, reason: msg("What it costs.") },
      { label: msg("Healthiness"), importance: 0.3, reason: msg("How you will feel after.") },
    ],
    question: (o) => t("{options}?", { options: list(o) }),
  },
  {
    id: "movie", name: msg("Movie night"), icon: "film-outline", mode: "playful", stakes: "tiny", category: ["Lifestyle"],
    blurb: msg("Stop scrolling, start watching."),
    options: [{ placeholder: msg("Movie or show 1"), value: "" }, { placeholder: msg("Movie or show 2"), value: "" }, { placeholder: msg("Movie or show 3 (optional)"), value: "" }],
    factors: [
      { label: msg("Fits my mood"), importance: 0.9, reason: msg("What you feel like tonight.") },
      { label: msg("Length"), importance: 0.4, reason: msg("How late it will keep you up.") },
      { label: msg("Everyone will like it"), importance: 0.5, reason: msg("If you are not watching alone.") },
    ],
    question: (o) => t("Which should I watch: {options}?", { options: list(o) }),
  },
  {
    id: "outfit", name: msg("What to wear"), icon: "shirt-outline", mode: "playful", stakes: "tiny", category: ["Lifestyle"],
    blurb: msg("Two outfits, one decision."),
    options: [{ placeholder: msg("Outfit 1"), value: "" }, { placeholder: msg("Outfit 2"), value: "" }],
    factors: [
      { label: msg("Comfort"), importance: 0.6, reason: msg("How it feels all day.") },
      { label: msg("Style"), importance: 0.8, reason: msg("How you feel in it.") },
      { label: msg("Fits the occasion"), importance: 0.7, reason: msg("Weather and where you are going.") },
    ],
    question: (o) => t("What should I wear: {options}?", { options: list(o) }),
  },
] satisfies DecisionTemplate[]).map(localized);

const we = (o: string[]) => t("Should we {options}?", { options: list(o.map((x) => x[0].toLowerCase() + x.slice(1))) });

// Company decisions. Factors follow the business canon in server/business.ts; weights are typical starting points
// that the company profile and the person's answers then move.
export const BUSINESS_TEMPLATES: DecisionTemplate[] = ([
  {
    id: "biz-hire", name: msg("Hire or contract"), icon: "people-outline", mode: "serious", stakes: "significant", category: ["Business", "Work"], audience: "business",
    blurb: msg("Fill a gap with a hire, a contractor, or not yet."),
    options: [{ placeholder: msg("Option 1"), value: msg("Hire full-time") }, { placeholder: msg("Option 2"), value: msg("Use a contractor or agency") }, { placeholder: msg("Option 3 (optional)"), value: msg("Wait a quarter") }],
    factors: [
      { label: msg("Cash and runway"), importance: 0.8, reason: msg("Salary is a fixed cost that stays when revenue dips.") },
      { label: msg("Speed to impact"), importance: 0.7, reason: msg("How soon the gap is actually filled.") },
      { label: msg("Quality and ownership"), importance: 0.7, reason: msg("Who cares about the outcome a year from now.") },
      { label: msg("Team capacity"), importance: 0.6, reason: msg("Management time to recruit, onboard and lead.") },
      { label: msg("Reversibility"), importance: 0.5, reason: msg("A bad hire is slow and costly to unwind.") },
    ],
    question: we,
  },
  {
    id: "biz-pricing", name: msg("Change pricing"), icon: "pricetag-outline", mode: "serious", stakes: "significant", category: ["Business", "Money"], audience: "business",
    blurb: msg("Raise, restructure, or keep your prices."),
    options: [{ placeholder: msg("The change"), value: msg("Raise prices for new customers") }, { placeholder: msg("Another way"), value: msg("Raise prices for everyone") }, { placeholder: msg("Option 3 (optional)"), value: msg("Keep current pricing") }],
    factors: [
      { label: msg("Revenue impact"), importance: 0.8, reason: msg("Price rises flow almost straight to margin, if customers stay.") },
      { label: msg("Churn risk"), importance: 0.8, reason: msg("How many existing customers you could lose.") },
      { label: msg("Conversion"), importance: 0.6, reason: msg("Whether new sign-ups slow down.") },
      { label: msg("Positioning"), importance: 0.5, reason: msg("What the price says about the product.") },
      { label: msg("Customer trust"), importance: 0.6, reason: msg("How the change lands with people who already pay.") },
    ],
    question: we,
  },
  {
    id: "biz-build-buy", name: msg("Build or buy"), icon: "construct-outline", mode: "serious", stakes: "significant", category: ["Business", "Technology"], audience: "business",
    blurb: msg("Make it yourselves, buy a tool, or partner."),
    options: [{ placeholder: msg("Option 1"), value: msg("Build it in-house") }, { placeholder: msg("Option 2"), value: msg("Buy an existing tool") }, { placeholder: msg("Option 3 (optional)"), value: "" }],
    factors: [
      { label: msg("Total cost"), importance: 0.7, reason: msg("Licences, integration and years of maintenance.") },
      { label: msg("Time to value"), importance: 0.7, reason: msg("How soon it works for customers or the team.") },
      { label: msg("Strategic fit"), importance: 0.8, reason: msg("Build what makes you win; buy what is commodity.") },
      { label: msg("Control and lock-in"), importance: 0.5, reason: msg("Who owns the roadmap and your data.") },
      { label: msg("Team capacity"), importance: 0.6, reason: msg("What the team stops doing to build it.") },
    ],
    question: we,
  },
  {
    id: "biz-vendor", name: msg("Pick a vendor"), icon: "swap-horizontal-outline", mode: "everyday", stakes: "normal", category: ["Business", "Purchase"], audience: "business",
    blurb: msg("Choose between suppliers, tools or agencies."),
    options: [{ placeholder: msg("Vendor 1"), value: "" }, { placeholder: msg("Vendor 2"), value: "" }, { placeholder: msg("Vendor 3 (optional)"), value: "" }],
    factors: [
      { label: msg("Total cost"), importance: 0.7, reason: msg("Price over the contract, not just the first year.") },
      { label: msg("Reliability and support"), importance: 0.8, reason: msg("What happens when it breaks.") },
      { label: msg("Fit with how we work"), importance: 0.6, reason: msg("Integration and day-to-day use.") },
      { label: msg("Contract risk"), importance: 0.5, reason: msg("Length, exit terms, price rises.") },
      { label: msg("Security and compliance"), importance: 0.5, reason: msg("Data handling and obligations you inherit.") },
    ],
    question: (o) => t("Which vendor should we choose: {options}?", { options: list(o) }),
  },
  {
    id: "biz-growth", name: msg("Growth bet"), icon: "trending-up-outline", mode: "serious", stakes: "significant", category: ["Business"], audience: "business",
    blurb: msg("A new market, product, segment or channel."),
    options: [{ placeholder: msg("The bet"), value: msg("Launch in the new market") }, { placeholder: msg("A smaller step"), value: msg("Run a small pilot first") }, { placeholder: msg("Option 3 (optional)"), value: msg("Focus on the core business") }],
    factors: [
      { label: msg("Revenue potential"), importance: 0.7, reason: msg("Size and reach of the opportunity.") },
      { label: msg("Cash and runway"), importance: 0.7, reason: msg("What it costs before it pays back.") },
      { label: msg("Execution risk"), importance: 0.7, reason: msg("Whether the team can actually pull it off.") },
      { label: msg("Focus"), importance: 0.6, reason: msg("What stops getting attention.") },
      { label: msg("Learning"), importance: 0.5, reason: msg("What you find out even if it fails.") },
    ],
    question: we,
  },
  {
    id: "biz-funding", name: msg("Funding"), icon: "cash-outline", mode: "serious", stakes: "major", category: ["Business", "Money"], audience: "business",
    blurb: msg("Raise, borrow, or grow on revenue."),
    options: [{ placeholder: msg("Option 1"), value: msg("Raise from investors") }, { placeholder: msg("Option 2"), value: msg("Grow on revenue") }, { placeholder: msg("Option 3 (optional)"), value: msg("Take a loan") }],
    factors: [
      { label: msg("Cash and runway"), importance: 0.9, reason: msg("Months the company can keep going.") },
      { label: msg("Control and dilution"), importance: 0.7, reason: msg("Ownership and say over the company.") },
      { label: msg("Growth speed"), importance: 0.6, reason: msg("What the money lets you do sooner.") },
      { label: msg("Obligations"), importance: 0.6, reason: msg("Repayments, covenants, investor expectations.") },
      { label: msg("Distraction"), importance: 0.4, reason: msg("Months of founder time spent raising.") },
    ],
    question: we,
  },
  {
    id: "biz-client", name: msg("Big client"), icon: "business-outline", mode: "serious", stakes: "significant", category: ["Business", "Work"], audience: "business",
    blurb: msg("Take the large deal, negotiate, or pass."),
    options: [{ placeholder: msg("Option 1"), value: msg("Accept the deal as offered") }, { placeholder: msg("Option 2"), value: msg("Negotiate the terms") }, { placeholder: msg("Option 3 (optional)"), value: msg("Turn it down") }],
    factors: [
      { label: msg("Revenue and margin"), importance: 0.8, reason: msg("What it brings in after the cost of serving it.") },
      { label: msg("Concentration risk"), importance: 0.7, reason: msg("How exposed you are if this one client leaves.") },
      { label: msg("Focus"), importance: 0.6, reason: msg("Custom work that pulls away from the core product.") },
      { label: msg("Strategic value"), importance: 0.6, reason: msg("Logo, references, a door into a market.") },
      { label: msg("Team strain"), importance: 0.5, reason: msg("Workload on the people who deliver it.") },
    ],
    question: we,
  },
  {
    id: "biz-costs", name: msg("Cut costs"), icon: "cut-outline", mode: "serious", stakes: "major", category: ["Business", "Money"], audience: "business",
    blurb: msg("Where to save, and how deep."),
    options: [{ placeholder: msg("Option 1"), value: msg("Cut tools and discretionary spend") }, { placeholder: msg("Option 2"), value: msg("Pause hiring") }, { placeholder: msg("Option 3 (optional)"), value: msg("Reduce the team") }],
    factors: [
      { label: msg("Runway gained"), importance: 0.9, reason: msg("Months of cash it buys.") },
      { label: msg("Revenue risk"), importance: 0.7, reason: msg("What it could cost in sales or delivery.") },
      { label: msg("Morale and trust"), importance: 0.7, reason: msg("How the team reads the change.") },
      { label: msg("Capability kept"), importance: 0.6, reason: msg("What you can still build and sell afterwards.") },
      { label: msg("Legal obligations"), importance: 0.4, reason: msg("Notice, contracts, consultation; check with a professional.") },
    ],
    question: we,
  },
] satisfies DecisionTemplate[]).map(localized);

export const ALL_TEMPLATES = [...TEMPLATES, ...BUSINESS_TEMPLATES];

export const templateById = (id: string) => ALL_TEMPLATES.find((t) => t.id === id) ?? null;

/** Trimmed, de-duplicated option names (2–4), or null when there are fewer than two. */
export function templateOptions(names: string[]): string[] | null {
  const seen = new Set<string>();
  const clean = names.map((n) => n.trim().replace(/\s+/g, " ").slice(0, 80))
    .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase())).slice(0, 4);
  return clean.length >= 2 ? clean : null;
}
