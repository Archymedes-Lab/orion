import type { Metadata } from "next";
import { getT } from "@/lib/locale-server";
import { History } from "./view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("History") };
}

export default function Page() {
  return <History />;
}
