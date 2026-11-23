import type { Metadata } from "next";
import { getT } from "@/lib/locale-server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Sign in"), description: t("Sign in to pick up your decisions on any device.") };
}

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children;
}
