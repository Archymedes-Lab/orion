import type { LegalCopy } from "@orion/copy/legal.ts";
import { getT } from "@/lib/locale-server";
import { Index } from "./ui";

/** A legal page as a Swiss reading column: numbered sections, 62-character measure. */
export async function Legal({ copy }: { copy: LegalCopy }) {
  const t = await getT();
  return (
    <article className="grid" style={{ rowGap: "var(--s-7)" }}>
      <header className="c-1-8 stack gap-4">
        <Index n="—">{t("Updated {date}", { date: copy.updated })}</Index>
        <h1 className="t-d2">{copy.title}</h1>
        <p className="t-lead muted">{copy.intro}</p>
      </header>
      <ol className="c-3-8 stack" style={{ listStyle: "none", padding: 0 }}>
        {copy.sections.map(([title, body], i) => (
          <li key={title} className="grid" style={{ gridTemplateColumns: "48px 1fr", columnGap: "var(--s-4)", padding: "var(--s-5) 0", borderTop: "1px solid var(--hair)" }}>
            <span className="t-mono blue" style={{ paddingTop: 4 }}>{String(i + 1).padStart(2, "0")}</span>
            <div className="stack gap-2"><h2 className="t-h3">{title}</h2><p className="t-body muted">{body}</p></div>
          </li>
        ))}
      </ol>
      <p className="c-3-8 t-small">{t("These beta terms were drafted in plain language and are still awaiting legal review.")}</p>
    </article>
  );
}
