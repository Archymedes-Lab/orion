import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { getT } from "@/lib/locale-server";
import { Answer } from "./answer";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Help a friend decide"), robots: { index: false, follow: false } };
}

/** A friend's view of a shared decision: the title and options only, never the question or ORION's call. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getT();
  return (
    <>
      <header className="wrap row between" style={{ paddingBlock: "var(--s-5)" }}>
        <Link href="/" aria-label={t("ORION home")}><Wordmark height={17} /></Link>
        <LanguageSwitch />
      </header>
      <main id="main" className="wrap" style={{ paddingBlock: "var(--s-7) var(--s-9)", maxWidth: 640 }}>
        <Answer id={id} />
      </main>
    </>
  );
}
