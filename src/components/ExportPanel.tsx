// Keep or send one decision: a laid-out PDF, a workbook, a copied summary, or the print dialog.
import { useState } from "react";
import { Platform, View } from "react-native";
import type { Report } from "../export/report";
import { copyText, PDF_TYPE, printPage, saveBytes, saveFile, shareText, XLSX_TYPE } from "../export/download";
import { spacing } from "../theme/tokens";
import { AppButton, Eyebrow, Small } from "./ui";
import { msg, t } from "../i18n";

type Action = "pdf" | "excel" | "copy" | "share" | "markdown" | "print";

const DONE: Record<Action, string> = {
  pdf: msg("PDF downloaded — the full write-up, ready to print or send."),
  excel: msg("Excel workbook downloaded — a tab each for the options, what mattered and the scores."),
  copy: msg("Summary copied."),
  share: msg("Shared."),
  markdown: msg("Markdown downloaded."),
  print: msg("Opened for printing — choose “Save as PDF” to keep a copy."),
};

export function ExportPanel({ build }: { build: () => Report }) {
  const [status, setStatus] = useState<string | null>(null);
  const web = Platform.OS === "web";

  const run = async (action: Action) => {
    setStatus(null);
    try {
      const report = build();
      const ok = action === "pdf" ? saveBytes(`${report.filename}.pdf`, report.pdf(), PDF_TYPE)
        : action === "excel" ? saveBytes(`${report.filename}.xlsx`, report.workbook(), XLSX_TYPE)
        : action === "copy" ? await copyText(report.text)
        : action === "share" ? await shareText(report.text, report.filename)
        : action === "markdown" ? saveFile(`${report.filename}.md`, report.markdown, "text/markdown;charset=utf-8")
        : printPage(report.html);
      setStatus(ok
        ? t(DONE[action])
        : action === "print" ? t("Your browser blocked the new tab. Allow pop-ups for ORION and try again.")
        : t("That did not work here. Try another option."));
    } catch {
      setStatus(t("ORION could not build that file. Try another option."));
    }
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Eyebrow>{t("Keep a copy")}</Eyebrow>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {web ? (
          <>
            <AppButton variant="secondary" icon="document-text-outline" title="PDF" onPress={() => void run("pdf")} />
            <AppButton variant="secondary" icon="grid-outline" title="Excel" onPress={() => void run("excel")} />
            <AppButton variant="ghost" icon="copy-outline" title={t("Copy summary")} onPress={() => void run("copy")} />
            <AppButton variant="ghost" icon="logo-markdown" title="Markdown" onPress={() => void run("markdown")} />
            <AppButton variant="ghost" icon="print-outline" title={t("Print")} onPress={() => void run("print")} />
          </>
        ) : (
          <AppButton variant="secondary" icon="share-outline" title={t("Share summary")} onPress={() => void run("share")} />
        )}
      </View>
      <Small>
        {web
          ? t("The PDF is the whole analysis written out. The workbook holds the same numbers, ready to sort.")
          : t("Files download from ORION in a browser; here the summary goes to your share sheet.")}
      </Small>
      {status && <Small>{status}</Small>}
    </View>
  );
}
