import { Skeleton } from "@/components/ui";
import { getT } from "@/lib/locale-server";
import s from "./workspace.module.css";

/** Holds the shape of a workspace page while its code loads. */
export default async function Loading() {
  const t = await getT();
  return (
    <div className={s.page} aria-busy="true" aria-label={t("Loading")}>
      <div className="stack gap-5"><Skeleton w={180} h={12} /><Skeleton w="60%" h={44} /><Skeleton h={260} r={32} /></div>
    </div>
  );
}
