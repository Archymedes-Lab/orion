import Link from "next/link";
import type { Metadata } from "next";
import { Icon, type IconName } from "@/components/brand";
import { DecisionBar, Reveal } from "@/components/client";
import { Photo } from "@/components/site";
import { ButtonLink, Glass, GridLines, Index } from "@/components/ui";
import { msg } from "@orion/i18n/index.ts";
import { getT } from "@/lib/locale-server";
import s from "./business.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("ORION for business"), description: t("Decisions weighed for your company’s stage, runway and appetite for risk.") };
}

// The same eight templates as the app (src/decision-engine/templates.ts BUSINESS_TEMPLATES), as ready questions.
const TEMPLATES: { icon: IconName; name: string; blurb: string; q: string }[] = [
  { icon: "people", name: msg("Hire or contract"), blurb: msg("Fill a gap with a hire, a contractor, or not yet."), q: msg("Hire full-time, use a contractor, or wait a quarter?") },
  { icon: "money", name: msg("Change pricing"), blurb: msg("Raise, restructure, or keep your prices."), q: msg("Raise prices for new customers, for everyone, or keep current pricing?") },
  { icon: "grid", name: msg("Build or buy"), blurb: msg("Make it yourselves, buy a tool, or partner."), q: msg("Build it in-house or buy an existing tool?") },
  { icon: "check", name: msg("Pick a vendor"), blurb: msg("Choose between suppliers, tools or agencies."), q: msg("Which vendor should we sign: the cheaper one or the established one?") },
  { icon: "chart", name: msg("Growth bet"), blurb: msg("A new market, product, segment or channel."), q: msg("Enter a new market this year or deepen the one we’re in?") },
  { icon: "building", name: msg("Funding"), blurb: msg("Raise, borrow, or grow on revenue."), q: msg("Raise a round, take a loan, or grow on revenue?") },
  { icon: "career", name: msg("Big client"), blurb: msg("Take the large deal, negotiate, or pass."), q: msg("Take the large client deal as offered, negotiate, or pass?") },
  { icon: "minus", name: msg("Cut costs"), blurb: msg("Where to save, and how deep."), q: msg("Cut tooling spend, pause hiring, or reduce marketing?") },
];

const PROFILE = [
  [msg("Stage"), msg("Idea, early, growing or established — a bet that suits a seed company can sink an established one.")],
  [msg("Runway"), msg("Months of cash at today’s burn. ORION treats irreversible spend differently when runway is short.")],
  [msg("Appetite for risk"), msg("Cautious, balanced or bold, so a close call leans the way your company actually plays.")],
  [msg("Goal"), msg("Stay alive, grow, become profitable or build long-term value — what “better” means this year.")],
];

export default async function Business() {
  const t = await getT();
  return (
    <>
        <section className={s.hero}>
          <Photo name="business" priority position="50% 60%" scrim="linear-gradient(180deg, rgb(5 8 15 / 0.6), rgb(5 8 15 / 0.25) 40%, rgb(5 8 15 / 0.8) 85%, var(--bg))" />
          <GridLines />
          <div className={`wrap grid ${s.heroGrid}`}>
            <div className="c-1-8 stack gap-6">
              <span className="t-label rise" style={{ color: "rgb(255 255 255 / 0.8)" }}>{t("ORION for business")}</span>
              <h1 className="t-d1 rise" style={{ "--i": 1 } as React.CSSProperties}>{t("Decisions that move a company.")}</h1>
              <p className="t-lead rise" style={{ "--i": 2, color: "rgb(255 255 255 / 0.85)" } as React.CSSProperties}>{t("The same verdict-first ORION, with a business playbook behind it: every option is weighed for your stage, cash and appetite for risk — not for a person’s life.")}</p>
            </div>
            <div className="c-1-7 rise" style={{ "--i": 3 } as React.CSSProperties}>
              <DecisionBar chips={false} lens="business" placeholder={t("e.g. Hire a second engineer now or wait until next quarter?")} />
            </div>
          </div>
        </section>

        <section className="section paper">
          <div className="wrap stack gap-8">
            <Reveal><Index n="01">{t("The company profile")}</Index></Reveal>
            <div className="grid" style={{ rowGap: "var(--s-6)" }}>
              <Reveal className="c-1-6"><h2 className="t-d2">{t("Four facts change every answer.")}</h2></Reveal>
              <Reveal className="c-8-5" i={1}><p className="t-lead">{t("Fill in what you know; leave the rest blank. ORION never invents company numbers, and it says when a question needs a lawyer or an accountant instead.")}</p></Reveal>
            </div>
            <div className={s.facts}>
              {PROFILE.map(([k, v], i) => (
                <Reveal key={k} i={i} className={s.fact}>
                  <span className="t-mono faint">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="t-h3">{t(k)}</h3>
                  <p className="t-small">{t(v)}</p>
                </Reveal>
              ))}
            </div>
            <Reveal><ButtonLink href="/app/company" variant="primary" arrow>{t("Set up your company profile")}</ButtonLink></Reveal>
          </div>
        </section>

        <section id="templates" className="section">
          <div className="wrap stack gap-8">
            <Reveal><Index n="02">{t("Templates")}</Index></Reveal>
            <Reveal><h2 className="t-d2" style={{ maxWidth: "18ch" }}>{t("Start from the decisions companies face most.")}</h2></Reveal>
            <div className={s.templates}>
              {TEMPLATES.map((tpl, i) => (
                <Reveal key={tpl.name} i={i % 4}>
                  <Link href={`/app?lens=business&q=${encodeURIComponent(t(tpl.q))}`} className={`o-card ${s.template}`}>
                    <div className="row between"><Icon name={tpl.icon} size={22} className="blue" /><span className="o-arrow o-arrow--sm" aria-hidden><Icon name="arrow" size={15} strokeWidth={1.8} /></span></div>
                    <h3 className="t-h3">{t(tpl.name)}</h3>
                    <p className="t-small">{t(tpl.blurb)}</p>
                  </Link>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className={s.closing}>
          <Photo name="businessClose" scrim="linear-gradient(90deg, rgb(5 8 15 / 0.9) 30%, rgb(5 8 15 / 0.35))" />
          <div className="wrap grid">
            <Glass className={`c-1-6 ${s.closingCard}`}>
              <span className="t-label blue">{t("What ORION won’t do")}</span>
              <p className="t-h2">{t("Make up your numbers, give legal or tax advice, or pretend a projection is a forecast.")}</p>
              <p className="t-small">{t("It structures the trade-offs, says how sure it can be, and shows what would change the answer.")}</p>
              <ButtonLink href="/app?lens=business" variant="primary" arrow>{t("Ask a business question")}</ButtonLink>
            </Glass>
          </div>
        </section>
    </>
  );
}
