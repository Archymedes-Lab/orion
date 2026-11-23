import type { Metadata } from "next";
import { getT } from "@/lib/locale-server";
import { Company } from "./view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Company profile") };
}

export default function Page() {
  return <Company />;
}
