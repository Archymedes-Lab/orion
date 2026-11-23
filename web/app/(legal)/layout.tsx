import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { Footer } from "@/components/site";
import { getT } from "@/lib/locale-server";

/** Legal pages: a plain reading column, no marketing chrome beyond the wordmark. */
export default async function LegalLayout({ children }: { children: React.ReactNode }) {
  const t = await getT();
  return (
    <>
      <header className="wrap row between" style={{ paddingBlock: "var(--s-5)" }}>
        <Link href="/" aria-label={t("ORION home")}><Wordmark height={17} /></Link>
        <LanguageSwitch />
      </header>
      <main id="main" className="wrap" style={{ paddingBlock: "var(--s-8) var(--s-9)" }}>{children}</main>
      <Footer />
    </>
  );
}
