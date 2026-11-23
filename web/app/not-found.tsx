import Link from "next/link";
import { Star, Wordmark } from "@/components/brand";
import { getT } from "@/lib/locale-server";

export default async function NotFound() {
  const t = await getT();
  return (
    <main id="main" className="wrap" style={{ minHeight: "100dvh", display: "grid", alignContent: "center", gap: "var(--s-6)" }}>
      <Link href="/" aria-label={t("ORION home")}><Wordmark height={18} /></Link>
      <div className="stack gap-4" style={{ maxWidth: 560 }}>
        <span className="row gap-2"><Star size={12} /><span className="t-label">404</span></span>
        <h1 className="t-d2">{t("There’s nothing at this address.")}</h1>
        <p className="t-lead muted">{t("The link may be old, or the page has moved.")}</p>
        <div className="row gap-3"><Link href="/" className="o-btn o-btn--primary">{t("Home")}</Link><Link href="/app" className="o-btn o-btn--ghost">{t("Ask ORION")}</Link></div>
      </div>
    </main>
  );
}
