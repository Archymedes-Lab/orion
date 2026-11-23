import Image from "next/image";
import Link from "next/link";
import { Icon, Star, Wordmark, type IconName } from "@/components/brand";
import { CityClock, DecisionBar, Reveal } from "@/components/client";
import { Photo } from "@/components/site";
import { FuturesDemo } from "@/components/FuturesDemo";
import { Ambient } from "@/components/Ambient";
import { ButtonLink, Glass, GridLines, Index, Meter, Tag } from "@/components/ui";
import { msg } from "@orion/i18n/index.ts";
import { PHOTOS, type PhotoKey } from "@/lib/photos";
import { getT } from "@/lib/locale-server";
import s from "./landing.module.css";

const EVERYDAY: { q: string; icon: IconName; factors: string[]; photo: PhotoKey; pos?: string; cls: string }[] = [
  // Led by what people actually bring to a decision tool: job offers, quitting, housing and moving (launch research,
  // October 2026), with one everyday choice to show it is quick.
  { q: msg("Accept this offer or keep looking?"), icon: "career", factors: [msg("Career"), msg("Finance"), msg("Growth")], photo: "earthAsia", cls: s.t1 },
  { q: msg("Quit my job or stay another year?"), icon: "career", factors: [msg("Security"), msg("Growth"), msg("Wellbeing")], photo: "iss", cls: s.t2 },
  { q: msg("Rent or buy a home?"), icon: "money", factors: [msg("Cost"), msg("Flexibility"), msg("Stability")], photo: "moon", cls: s.t3 },
  { q: msg("Move to a new city for work or stay?"), icon: "travel", factors: [msg("Career"), msg("People"), msg("Cost")], photo: "halfEarth", cls: s.t4 },
  { q: msg("Take this trip or save the money?"), icon: "travel", factors: [msg("Experience"), msg("Cost"), msg("Timing")], photo: "galaxy", cls: s.t5 },
  { q: msg("Coffee here or on the way?"), icon: "coffee", factors: [msg("Cost"), msg("Time"), msg("Energy"), msg("Quality")], photo: "orion", cls: s.t6 },
];

const STEPS = [
  { n: "01", title: msg("Describe it"), body: msg("Type the decision the way you’d say it to a friend. Name your options, or let ORION suggest them."), meta: msg("Natural language · 2–4 options") },
  { n: "02", title: msg("ORION weighs it"), body: msg("It finds what matters, scores every option against every factor in one pass, and checks how sure it can be."), meta: msg("Up to 8 factors · scored together") },
  { n: "03", title: msg("Get a verdict"), body: msg("A plain answer first: which option comes out ahead on what matters to you, and why. Depth is one tap away."), meta: msg("Verdict first · details on demand") },
];

const PRINCIPLES: { icon: IconName; title: string; body: string }[] = [
  { icon: "shield", title: msg("It won’t just agree with you"), body: msg("Push back and ORION keeps its call unless you give it a new fact. Odds, not flattery.") },
  { icon: "insights", title: msg("The downside, up front"), body: msg("See each option’s worst case, whether you could undo it, and how sure ORION is.") },
  { icon: "bulb", title: msg("What would change it"), body: msg("Know what would flip the answer — and the options you hadn’t thought of.") },
  { icon: "history", title: msg("Decide, then learn"), body: msg("Record your choice, ask friends without swaying them, and check back at two and six months.") },
];

const BUSINESS = [msg("Hire now or wait a quarter"), msg("Raise prices or hold"), msg("Build or buy"), msg("Enter a new market"), msg("Which supplier to sign"), msg("Cut a product line"), msg("Remote, hybrid or office"), msg("Spend on growth or runway")];

const HERO_FOOT = [[msg("No grids"), msg("ORION does the rating")], [msg("Honest odds"), msg("not a chatbot’s opinion")], [msg("Verdict first"), msg("depth when you want it")], [msg("Private"), msg("your decisions stay yours")]];
const STATS = [["0", msg("grids to fill in — ORION scores every option against every factor itself")], ["1", msg("question at most, and only when the call is genuinely close")], ["2–4", msg("options compared side by side, named by you or suggested")], ["8", msg("factors weighed at most, each with a reason you can read")]];

export default async function Landing() {
  const t = await getT();
  return (
    <>
        {/* ── Hero ───────────────────────────────────────────── */}
        <section className={s.hero}>
          <Photo name="hero" priority className={s.heroPhoto} position="50% 80%"
            scrim="linear-gradient(180deg, rgb(5 8 15 / 0.55) 0%, rgb(5 8 15 / 0.08) 26%, rgb(5 8 15 / 0.05) 52%, rgb(5 8 15 / 0.7) 84%, var(--bg) 100%)" />
          <Ambient scene="dawn" style={{ zIndex: 0 }} />
          <GridLines />
          <div className={`wrap ${s.heroInner}`}>
            <div className={`${s.heroMeta} rise`}>
              <span className="t-label" style={{ color: "rgb(255 255 255 / 0.8)" }}>{t("Decision intelligence — Nº 01")}</span>
              <Tag tone="blue">{t("Beta now open")}</Tag>
            </div>
            <div className={`grid ${s.heroGrid}`}>
              <div className="c-1-8 stack gap-6">
                <h1 className={s.mark}><Wordmark height={160} draw /></h1>
                <p className={`t-tracked ${s.tagline} rise`} style={{ "--i": 6 } as React.CSSProperties}>
                  {t("Make better decisions.")}<br />{t("Live a better life.")}
                </p>
                <span className="o-rule rise" style={{ "--i": 7 } as React.CSSProperties} />
              </div>
              <div className={`c-9-4 ${s.aside} rise`} style={{ "--i": 8 } as React.CSSProperties}>
                <p className="t-lead" style={{ color: "#fff" }}>{t("Clear questions. Deeper insights.")}<br />{t("A brighter tomorrow.")}</p>
                <CityClock />
              </div>
              <div className={`c-1-7 ${s.heroBar} rise`} style={{ "--i": 9 } as React.CSSProperties}>
                <DecisionBar />
              </div>
            </div>
            <div className={`${s.heroFoot} rise`} style={{ "--i": 10 } as React.CSSProperties}>
              {HERO_FOOT.map(([a, b]) => (
                <div key={a}><span className="t-small ink">{t(a)}</span><span className="t-micro">{t(b)}</span></div>
              ))}
            </div>
          </div>
          <span className={s.scrollCue} aria-hidden />
        </section>

        {/* ── 01 Method ──────────────────────────────────────── */}
        <section id="how" className="section">
          <div className="wrap stack gap-8">
            <Reveal><Index n="01">{t("Method")}</Index></Reveal>
            <div className="grid" style={{ rowGap: "var(--s-6)" }}>
              <Reveal className="c-1-8"><h2 className="t-d2">{t("Say it the way you’d say it to a friend. ORION does the weighing.")}</h2></Reveal>
              <Reveal className="c-9-4" i={1}><p className="t-lead muted" style={{ alignSelf: "end" }}>{t("No forms, no scoring grids. You describe; ORION reads, weighs and answers — and shows its working when you ask.")}</p></Reveal>
            </div>
            <div className={s.steps}>
              {STEPS.map((st, i) => (
                <Reveal key={st.n} i={i} className={s.step}>
                  <span className={s.stepN}>{st.n}</span>
                  <h3 className="t-h3">{t(st.title)}</h3>
                  <p className="t-body muted">{t(st.body)}</p>
                  <span className="t-mono faint">{t(st.meta)}</span>
                </Reveal>
              ))}
            </div>
            <Reveal className={s.stage}>
              <Photo name="stage" position="50% 50%" scrim="linear-gradient(180deg, rgb(5 8 15 / 0.1), rgb(5 8 15 / 0.35))" />
              <Ambient scene="night" style={{ zIndex: -1 }} />
              <Glass className={s.demo}>
                <div className={s.demoQ}>
                  <span className={s.demoIcon}><Icon name="coffee" size={22} /></span>
                  <div className="stack">
                    <span className="t-label">{t("You asked")}</span>
                    <span className="ink" style={{ fontSize: "1.0625rem" }}>{t("Coffee here or on the way?")}</span>
                  </div>
                </div>
                <div className="stack gap-2">
                  <span className="t-label blue">{t("ORION’s call")}</span>
                  <span className={s.verdict}>{t("Go with here.")}</span>
                  <p className="t-small">{t("It wins on quality and energy, and the time you lose is small.")}</p>
                </div>
                <div className="stack gap-4">
                  <Meter label={t("Here")} value={0.72} display="72" lead />
                  <Meter label={t("On the way")} value={0.58} display="58" />
                </div>
                <div className="row gap-2 wrap-row">
                  {[t("Cost"), t("Time"), t("Energy"), t("Quality")].map((f) => <span key={f} className="o-chip o-chip--quiet">{f}</span>)}
                </div>
              </Glass>
              <span className="t-micro" style={{ position: "absolute", left: 24, bottom: 18, color: "rgb(255 255 255 / 0.6)" }}>{t("Illustration of a result")}</span>
            </Reveal>
          </div>
        </section>

        {/* ── 02 Everyday ────────────────────────────────────── */}
        <section id="everyday" className="section" style={{ paddingTop: 0 }}>
          <div className="wrap stack gap-8">
            <Reveal><Index n="02">{t("Everyday")}</Index></Reveal>
            <div className="grid" style={{ rowGap: "var(--s-5)" }}>
              <Reveal className="c-1-7"><h2 className="t-d2">{t("Real questions.")}<br />{t("Real insights.")}<br /><span className="muted">{t("For everyday life.")}</span></h2></Reveal>
              <Reveal className="c-9-4" i={1}><p className="t-body muted" style={{ alignSelf: "end" }}>{t("Small choices add up. Tap any of these to see how ORION reads it — then ask your own.")}</p></Reveal>
            </div>
            <div className={s.mosaic}>
              {EVERYDAY.map((e, i) => (
                <Reveal key={e.q} i={i % 3} className={`${s.tile} ${e.cls}`} as="div">
                  <Link href={`/app?q=${encodeURIComponent(t(e.q))}`} aria-label={t("Ask ORION: {question}", { question: t(e.q) })} style={{ position: "absolute", inset: 0, zIndex: 2 }} />
                  <div className="o-photo"><Image src={PHOTOS[e.photo].src} alt="" fill sizes="(max-width: 899px) 100vw, 50vw" style={{ objectPosition: e.pos ?? "center" }} /></div>
                  <Glass className={s.qcard}>
                    <div className={s.qtop}>
                      <Icon name={e.icon} size={22} />
                      <span className={s.qtext}>{t(e.q)}</span>
                      <span className="o-arrow o-arrow--sm" aria-hidden><Icon name="arrow" size={15} strokeWidth={1.8} /></span>
                    </div>
                    <div className="row gap-2 wrap-row">{e.factors.map((f) => <span key={f} className="o-chip o-chip--quiet">{t(f)}</span>)}</div>
                  </Glass>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── 03 Aftermath ───────────────────────────────────── */}
        <section id="aftermath" className="section" style={{ paddingTop: 0 }}>
          <div className="wrap stack gap-8">
            <Reveal><Index n="03">{t("Aftermath")}</Index></Reveal>
            <div className="grid" style={{ rowGap: "var(--s-5)" }}>
              <Reveal className="c-1-7"><h2 className="t-d2">{t("Picture living with it,")}<br /><span className="muted">{t("not just making it.")}</span></h2></Reveal>
              <Reveal className="c-9-4" i={1}><p className="t-body muted" style={{ alignSelf: "end" }}>{t("From the first days to years out: where each choice could lead, how sure ORION can be, which path comes out ahead and when the lead changes. Drag to turn it, press play to walk through time, click a path to picture it.")}</p></Reveal>
            </div>
            <Reveal i={1}><FuturesDemo /></Reveal>
          </div>
        </section>

        {/* ── 03 Principles ──────────────────────────────────── */}
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap stack gap-8">
            <Reveal><Index n="04">{t("Principles")}</Index></Reveal>
            <div className={s.principles}>
              {PRINCIPLES.map((p, i) => (
                <Reveal key={p.title} i={i} className={s.principle}>
                  <Icon name={p.icon} size={26} className="blue" />
                  <h3 className="t-label ink" style={{ marginTop: "var(--s-3)" }}>{t(p.title)}</h3>
                  <p className="t-small">{t(p.body)}</p>
                </Reveal>
              ))}
            </div>
            <div className={s.stats}>
              {STATS.map(([v, l], i) => (
                <Reveal key={v} i={i}><div className="o-stat"><span className="o-stat__v">{v}</span><span className="o-stat__l">{t(l)}</span></div></Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── 04 Business (paper) ────────────────────────────── */}
        <section className="section paper" id="business">
          <div className="wrap grid" style={{ rowGap: "var(--s-7)", alignItems: "center" }}>
            <div className="c-1-5 stack gap-6">
              <Reveal><Index n="05">{t("For business")}</Index></Reveal>
              <Reveal i={1}><h2 className="t-d2">{t("Decisions that move a company.")}</h2></Reveal>
              <Reveal i={2}><p className="t-lead">{t("Give ORION a short company profile — stage, runway, appetite for risk — and every decision is weighed for your business, not for a person’s life.")}</p></Reveal>
              <Reveal i={3}>
                <ul className={s.bizList}>
                  {BUSINESS.map((b, i) => <li key={b}><span>{String(i + 1).padStart(2, "0")}</span><span>{t(b)}</span></li>)}
                </ul>
              </Reveal>
              <Reveal i={4} className="row gap-3 wrap-row">
                <ButtonLink href="/business" variant="primary" arrow>{t("ORION for business")}</ButtonLink>
                <ButtonLink href="/app/company" variant="ghost">{t("Set up a company profile")}</ButtonLink>
              </Reveal>
            </div>
            <Reveal className={`c-7-6 ${s.bizPhoto}`} i={1}>
              <Photo name="business" scrim="linear-gradient(180deg, transparent 40%, rgb(5 8 15 / 0.45))" />
              <Glass className={s.qcard} style={{ width: "min(100%, 380px)", "--glass": "rgb(255 255 255 / 0.7)" } as React.CSSProperties}>
                <div className={s.qtop} style={{ color: "var(--ink)" }}>
                  <Icon name="building" size={22} />
                  <span className={s.qtext}>{t("Hire now or wait a quarter?")}</span>
                  <span className="o-arrow o-arrow--sm" aria-hidden><Icon name="arrow" size={15} strokeWidth={1.8} /></span>
                </div>
                <div className="row gap-2 wrap-row">{[t("Runway"), t("Growth"), t("Team load"), t("Risk")].map((f) => <span key={f} className="o-chip o-chip--quiet">{f}</span>)}</div>
              </Glass>
            </Reveal>
          </div>
        </section>

        {/* ── Closing ────────────────────────────────────────── */}
        <section className={s.closing}>
          <Photo name="closing" position="50% 50%" scrim="radial-gradient(ellipse at 50% 55%, transparent 0 30%, var(--bg) 78%)" />
          <div className="wrap stack gap-6" style={{ alignItems: "center" }}>
            <Reveal><Star size={28} pulse /></Reveal>
            <Reveal i={1}><h2 className="t-d1">{t("A clearer you, a brighter tomorrow.")}</h2></Reveal>
            <Reveal i={2}><p className="t-lead muted" style={{ marginInline: "auto" }}>{t("ORION is in open beta. Bring the decision that’s been on your mind.")}</p></Reveal>
            <Reveal i={3}><ButtonLink href="/app" variant="primary" size="lg" tracked arrow>{t("Join the beta")}</ButtonLink></Reveal>
          </div>
        </section>
    </>
  );
}
