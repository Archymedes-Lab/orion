import type { Metadata } from "next";
import { Workspace } from "@/components/Workspace";
import { getT } from "@/lib/locale-server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: { default: t("Workspace"), template: "%s · ORION" }, robots: { index: false, follow: false } };
}

/** The workspace: a quiet rail and one column of work. No marketing chrome, no footer. */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Workspace>{children}</Workspace>
  );
}
