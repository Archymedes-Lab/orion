// Who is signed in, and the way out, on every page: in the top bar on wide screens, at the top of the page on phones.
import { View } from "react-native";
import { useAccount } from "../account/store";
import { useSignOut } from "../account/signOut";
import { colors } from "../theme/tokens";
import { AppButton, Text } from "./ui";
import { t } from "../i18n";

export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const user = useAccount((a) => a.user);
  const signOut = useSignOut();
  if (!user) return null;
  // Accounts made before usernames existed fall back to the start of the email (the server does the same).
  const name = user.username || user.email.split("@")[0];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View accessibilityLabel={t("Signed in as {name}", { name })} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine }}>
          <Text style={{ fontSize: 13, fontWeight: "500", color: colors.white }}>{name.charAt(0).toUpperCase()}</Text>
        </View>
        <Text numberOfLines={1} style={{ maxWidth: compact ? 120 : 160, fontSize: 14, fontWeight: "500", color: colors.white }}>{name}</Text>
      </View>
      <AppButton
        variant="ghost" icon="log-out-outline" title={t("Sign out")} onPress={() => void signOut()}
        style={{ minHeight: 34, paddingHorizontal: 12 }}
      />
    </View>
  );
}
