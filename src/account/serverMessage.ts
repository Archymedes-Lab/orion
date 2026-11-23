// What the server says when it refuses something, in the person's language. The server writes its messages in
// English (or, when it knows the language, already translated). Known English messages are translated here; an
// unknown one falls back to a message for its error code, and a message that is already Korean is shown as it is.
import { getLocale, msg, t } from "../i18n/index.ts";

/** The server's own words, exactly as server/auth.ts, server/index.ts and server/paypack.ts write them. */
const KNOWN = new Set([
  msg("That email or password is not right."),
  msg("That email or recovery code is not right."),
  msg("That password is not right."),
  msg("That password is too easy to guess. Try a few unrelated words."),
  msg("Do not use your email address in your password."),
  msg("That username is taken. Try another."),
  msg("An account with this email already exists. Sign in instead."),
  msg("ORION is in a closed beta. Enter a valid invite code to create an account."),
  msg("Too many new accounts from this network. Try again in an hour."),
  msg("Too many attempts. Wait 15 minutes, or reset your password with your recovery code."),
  msg("Too many attempts from this network. Wait 15 minutes."),
  msg("Too many attempts. Wait 15 minutes."),
  msg("Your history is too large to back up right now."),
  msg("Check what you entered and try again."),
  msg("Check the details you entered and try again."),
  msg("Sign in to use ORION"),
  msg("Sign in first"),
  msg("Mobile money could not start that payment. Check the number and try again."),
  msg("Mobile money could not complete that right now. Try again in a moment."),
  msg("Mobile money is not reachable right now. Try again in a moment."),
  msg("Mobile money is not set up correctly on this server"),
  msg("Mobile money is not set up on this server"),
  msg("That plan is not on sale with mobile money"),
  msg("A pass is bought for one decision"),
  msg("Enter an MTN or Airtel Rwanda number, like 078 123 4567."),
]);

/** When the message itself is not one ORION knows: what the code means. */
const BY_CODE: Record<string, string> = {
  bad_credentials: msg("That email or password is not right."),
  weak_password: msg("That password is too easy to guess. Try a few unrelated words."),
  username_taken: msg("That username is taken. Try another."),
  email_taken: msg("An account with this email already exists. Sign in instead."),
  invite_required: msg("ORION is in a closed beta. Enter a valid invite code to create an account."),
  too_many_attempts: msg("Too many attempts. Wait 15 minutes."),
  backup_too_large: msg("Your history is too large to back up right now."),
  invalid_request: msg("Check the details you entered and try again."),
  signed_out: msg("Sign in first"),
};

const MIN_LENGTH = /^Use at least (\d+) characters\. A few unrelated words work well\.$/;
const hangul = /[가-힣]/;

/** The server's message for this refusal, or `fallback` (already translated) when it gave none. */
export function serverMessage(body: Record<string, unknown>, fallback: string): string {
  const said = typeof body.error === "string" ? body.error : "";
  const code = typeof body.code === "string" ? body.code : "";
  if (!said) return fallback;
  if (KNOWN.has(said)) return t(said);
  const short = MIN_LENGTH.exec(said);
  if (short) return t("Use at least {n} characters. A few unrelated words work well.", { n: short[1] });
  // English, or already in the person's language: show it as the server wrote it.
  if (getLocale() === "en" || hangul.test(said)) return said;
  return code && BY_CODE[code] ? t(BY_CODE[code]) : fallback;
}
