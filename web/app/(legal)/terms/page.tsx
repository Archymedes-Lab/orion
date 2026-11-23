import type { Metadata } from "next";
import { terms } from "@orion/copy/legal.ts";
import { withLocale } from "@orion/i18n/index.ts";
import { Legal } from "@/components/Legal";
import { getT, requestLocale } from "@/lib/locale-server";

const copy = async () => { const locale = await requestLocale(); return withLocale(locale, () => terms()); };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Beta terms"), description: (await copy()).intro };
}

export default async function Page() {
  return <Legal copy={await copy()} />;
}
