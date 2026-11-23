import type { Metadata } from "next";
import { Suspense } from "react";
import { getT } from "@/lib/locale-server";
import { Ask } from "./ask";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Decide"), robots: { index: false } };
}

export default function Page() {
  return <Suspense><Ask /></Suspense>;
}
