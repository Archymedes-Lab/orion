// Ask a friend: share a link, see which option friends would pick and what they think matters most.
// Friends' votes sit beside the comparison; they never change the scores.
import { useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { friendAnswers, linkFor, shareDecision, shareUrl, sharingPossible, stopSharing, tally, type FriendAnswer, type ShareLink, type Tally } from "../share/client";
import { copyText, shareText } from "../export/download";
import { colors, radius, spacing } from "../theme/tokens";
import { AppButton, Body, ConfirmButton, Eyebrow, Notice, SectionTitle, Small, Text, tabular } from "./ui";
import { getLocale, t } from "../i18n";

export function FriendsPanel({ decisionId, title, options, factors, privateMode, ensureSaved, onTally }: {
  decisionId: string;
  title: string;
  options: { id: string; label: string }[];
  factors: { id: string; label: string }[];
  privateMode: boolean;
  /** Saves the decision first, so the link belongs to something in History. */
  ensureSaved: () => Promise<boolean>;
  onTally?: (tally: Tally | null) => void;
}) {
  const [link, setLink] = useState<ShareLink | null>(null);
  const [answers, setAnswers] = useState<FriendAnswer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async (current: ShareLink) => {
    const result = await friendAnswers(current);
    if (result.ok) { setAnswers(result.value); setError(null); } else setError(result.error);
  }, []);

  useEffect(() => {
    let live = true;
    setLink(null); setAnswers(null); setError(null); setCopied(false);
    if (!sharingPossible()) return;
    void linkFor(decisionId).then((found) => {
      if (!live || !found) return;
      setLink(found);
      void refresh(found);
    }).catch(() => {});
    return () => { live = false; };
  }, [decisionId, refresh]);

  const counted = answers ? tally(answers, options, factors) : null;
  // Reported by value: a new array with the same answers is not a change.
  const tallyKey = JSON.stringify(counted);
  useEffect(() => { onTally?.(counted); }, [tallyKey]);

  if (!sharingPossible()) return null;
  if (privateMode) return <Small>{t("Asking friends is off in private mode, because it sends the options to the ORION server.")}</Small>;

  const create = async () => {
    setBusy(true); setError(null);
    if (!(await ensureSaved())) { setBusy(false); setError(t("Save the decision first, then try again.")); return; }
    const result = await shareDecision(decisionId, { title, options, factors });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setLink(result.value);
    setAnswers([]);
  };
  const url = link ? shareUrl(link.shareId) : "";
  const copy = async () => setCopied(await copyText(url));
  const remove = async () => {
    if (!link) return;
    setBusy(true);
    const ok = await stopSharing(decisionId, link);
    setBusy(false);
    if (ok) { setLink(null); setAnswers(null); } else setError(t("Could not remove the link. Try again."));
  };
  const most = counted ? Math.max(1, ...counted.votes.map((v) => v.count)) : 1;

  return (
    <View style={{ gap: spacing.sm }}>
      <Eyebrow>{t("Ask a friend")}</Eyebrow>
      {!link ? (
        <>
          <SectionTitle>{t("What would they pick?")}</SectionTitle>
          <Small>
            {t("Get a link to send to people you trust. They see the title, the options and what you are weighing — not the rest of what you wrote — and tell you which they would pick. Only you see their answers. The link lasts 30 days.")}
          </Small>
          <AppButton variant="secondary" icon="people-outline" title={busy ? t("Creating link…") : t("Get a link")} disabled={busy} onPress={() => void create()} style={{ alignSelf: "flex-start" }} />
        </>
      ) : (
        <>
          <View style={{ padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.sunken }}>
            <Text selectable numberOfLines={2} style={{ fontSize: 13, color: colors.body }}>{url}</Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {Platform.OS === "web" && <AppButton variant="secondary" icon={copied ? "checkmark" : "copy-outline"} title={copied ? t("Copied") : t("Copy link")} onPress={() => void copy()} />}
            <AppButton variant="ghost" icon="share-outline" title={t("Send")} onPress={() => void shareText(t("Help me decide: {title}\n{url}", { title, url }), title).then((ok) => { if (!ok) void copy(); })} />
            <AppButton variant="ghost" icon="refresh" title={t("Refresh")} disabled={busy} onPress={() => void refresh(link)} />
          </View>
          {counted && counted.total === 0 && <Small>{t("No answers yet. They appear here as friends reply.")}</Small>}
          {counted && counted.total > 0 && (
            <View style={{ gap: spacing.sm }}>
              <Small>{counted.total === 1 ? t("1 friend has answered:") : t("{n} friends have answered:", { n: counted.total })}</Small>
              {counted.votes.map((v) => (
                <View key={v.optionId} accessibilityLabel={t("{option}: {n} votes", { option: v.label, n: v.count })} style={{ gap: 4 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
                    <Body style={{ flex: 1, fontSize: 15 }}>{v.label}</Body>
                    <Text style={[{ fontSize: 15, color: colors.white }, tabular]}>{v.count}</Text>
                  </View>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.sunken, overflow: "hidden" }}>
                    <View style={{ width: `${(v.count / most) * 100}%`, height: 6, backgroundColor: colors.accent }} />
                  </View>
                </View>
              ))}
              {counted.topFactor && <Small>{t("Most said “{factor}” matters most here.", { factor: getLocale() === "en" ? counted.topFactor.label.toLowerCase() : counted.topFactor.label })}</Small>}
              {counted.notes.slice(0, 5).map((n, i) => (
                <Small key={i} style={{ color: colors.body }}>{t("“{note}” — {name}, for {option}", { note: n.note, name: n.name, option: n.label })}</Small>
              ))}
              <Small>{t("Friends' votes are a second opinion. They do not change ORION's scores.")}</Small>
            </View>
          )}
          {counted && counted.stale > 0 && <Small>{counted.stale === 1 ? t("1 older answer is about options you have since changed.") : t("{n} older answers are about options you have since changed.", { n: counted.stale })}</Small>}
          <View style={{ alignSelf: "flex-start", marginLeft: -18 }}>
            <ConfirmButton title={t("Stop sharing")} confirmTitle={t("Remove the link and answers?")} icon="link-outline" onConfirm={() => void remove()} disabled={busy} />
          </View>
        </>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </View>
  );
}
