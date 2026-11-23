import type { Metadata } from "next";
import { getT } from "@/lib/locale-server";
import { DecisionPage } from "./decision";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Decision"), robots: { index: false } };
}

export default async function Page({ params }: PageProps<"/app/d/[id]">) {
  const { id } = await params;
  return <DecisionPage id={id} />;
}
