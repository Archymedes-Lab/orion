"use client";
import { Fault } from "@/components/Fault";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <main id="main" className="wrap"><Fault error={error} retry={retry} /></main>;
}
