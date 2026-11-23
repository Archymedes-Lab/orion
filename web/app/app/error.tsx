"use client";
import { Fault } from "@/components/Fault";
import s from "./workspace.module.css";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <div className={s.page}><Fault error={error} retry={retry} home="/app" /></div>;
}
