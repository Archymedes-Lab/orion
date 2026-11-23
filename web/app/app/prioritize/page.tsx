import type { Metadata } from "next";
import { Suspense } from "react";
import { getT } from "@/lib/locale-server";
import { Prioritize } from "./view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Prioritize") };
}

export default function Page() {
  return <Suspense><Prioritize /></Suspense>;
}
