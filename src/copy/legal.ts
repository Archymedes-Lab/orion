// The legal pages' copy, shared by the Expo app (src/app/privacy.tsx, terms.tsx) and the web app (web/app/(legal)).
// Each part is wrapped in t(), so it reads in the chosen language; read it through privacy() / terms() at render.
import { t } from "../i18n/index.ts";

export interface LegalCopy { title: string; updated: string; intro: string; sections: [string, string][] }

export const PRIVACY_EN: LegalCopy = {
  "title": "Privacy notice",
  "updated": "27 October 2026",
  "intro": "What ORION stores, where, and who else sees it.",
  "sections": [
    [
      "On your device",
      "Your decisions, how they turned out, your personal context lines and what ORION learned about your priorities are stored in this browser or app. If you use ORION without an account, they stay only in this browser. While you are signed in they are also backed up to your account, and when you sign out they are removed from the device."
    ],
    [
      "Your account",
      "We store your email address, a scrambled (hashed) form of your password and recovery code that cannot be turned back into the originals, and the date you accepted the beta terms. A backup copy of the data on your device is stored with your account so it can follow you to another browser. Decisions made in private mode are never saved, so they are never backed up."
    ],
    [
      "When ORION analyses a decision",
      "The text of your question, and your personal context lines, are sent to our server and passed to AI providers to structure and score it. During the beta these are TypeSafe, Cerebras and, when those are busy, free models reached through OpenRouter. ORION skips free models whose providers say they log prompts or train on them; other providers, free ones especially, may still keep requests under their own policies. Do not include anything you would not want shared with them."
    ],
    [
      "Signing in",
      "A session cookie keeps you signed in for up to 30 days. It cannot be read by scripts and is only sent to ORION. There are no advertising or tracking cookies. To let you make a few decisions without an account, we count them by network address for a day; the count is not linked to what you asked and expires within two days."
    ],
    [
      "Feedback and crash reports",
      "Feedback you send is stored with your account id if you are signed in, and kept for the beta so we can learn from it. If a page hits an error, the error message and the page address are reported and kept for two weeks; the content of your decisions is not. We count page views, where visitors come from and how fast pages load with Vercel Web Analytics and Speed Insights, which use no cookies and do not identify you, and we keep daily totals such as sign-ups and decisions."
    ],
    [
      "Payments",
      "If you subscribe, Stripe handles your payment details. We store only the ids Stripe gives us for your subscription."
    ],
    [
      "Your choices",
      "Profile lets you export everything, erase what is on this device, and delete your account. Deleting your account removes your email, password data and backup from our store straight away. Feedback you sent and records of purchases stay without anything that identifies you, so we can prevent the same payment being reused and learn from beta feedback."
    ],
    [
      "Contact",
      "Use Send feedback in Profile for privacy questions during the beta."
    ]
  ]
};

export const TERMS_EN: LegalCopy = {
  "title": "Beta terms",
  "updated": "4 October 2026",
  "intro": "ORION is in beta. These are the terms for using it during that time, in plain language.",
  "sections": [
    [
      "This is pre-release software",
      "ORION is unfinished. It may contain errors, change without notice, be unavailable at times, or lose data. Do not rely on it as the only copy of anything important; Profile lets you export your data at any time."
    ],
    [
      "ORION helps you think; it does not decide for you",
      "The scores and rankings are estimates built from what you tell it and from AI models that can be wrong. They are not professional advice. For medical, legal, financial or safety decisions, talk to a qualified person. You are responsible for the choices you make."
    ],
    [
      "Your account",
      "You confirm you are 16 or older when you tick the terms box to create an account. Keep your password and recovery code private. One person per account."
    ],
    [
      "Acceptable use",
      "Do not use ORION to break the law, to harm others, to attack or overload the service, or to get around its limits."
    ],
    [
      "Feedback",
      "If you send feedback, we may use it to improve ORION without owing you anything for it."
    ],
    [
      "Price",
      "The beta is free unless a paid plan is clearly offered to you, with its price shown before you pay. Payments are handled by Stripe."
    ],
    [
      "Ending",
      "You can stop using ORION and delete your account at any time from Profile. We may suspend accounts that break these terms, and we may end the beta."
    ],
    [
      "No warranty",
      "ORION is provided as it is, without warranties of any kind, to the extent the law allows. Our liability for the beta is limited to the amount you paid us for it."
    ],
    [
      "Changes",
      "If these terms change in a way that matters, the app will say so and ask you to accept them again before you continue."
    ]
  ]
};

const translate = (copy: LegalCopy): LegalCopy => ({
  title: t(copy.title), updated: t(copy.updated), intro: t(copy.intro),
  sections: copy.sections.map(([heading, body]) => [t(heading), t(body)]),
});
/** The privacy notice in the current language. */
export const privacy = (): LegalCopy => translate(PRIVACY_EN);
/** The beta terms in the current language. */
export const terms = (): LegalCopy => translate(TERMS_EN);
/** English, for code that has not chosen a language yet. */
export const PRIVACY = PRIVACY_EN;
export const TERMS = TERMS_EN;
