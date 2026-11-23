import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter_Tight, Noto_Sans_KR, Outfit } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ErrorReporter } from "@/components/ErrorReporter";
import { LocaleProvider } from "@/components/LocaleProvider";
import { getT, requestLocale } from "@/lib/locale-server";
import "@/styles/globals.css";

// Outfit carries the brand (the posters' light geometric face), Inter Tight sets the text with Swiss grotesk
// precision, Geist Mono sets numbers and indices. Noto Sans KR sets Hangul: it follows the Latin faces in every
// stack, so English is untouched and Korean picks it up glyph by glyph. Google serves it in unicode-range slices, so
// a page downloads only the syllables it shows; it is not preloaded.
const outfit = Outfit({ subsets: ["latin"], weight: ["200", "300", "400", "500"], variable: "--font-outfit", display: "swap" });
const interTight = Inter_Tight({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--font-inter-tight", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-geist-mono", display: "swap" });
const notoKr = Noto_Sans_KR({ weight: ["200", "300", "400", "500", "600"], variable: "--font-noto-kr", display: "swap", preload: false });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
    title: { default: t("ORION — Make better decisions"), template: "%s · ORION" },
    description: t("Describe a decision in your own words. ORION weighs the options and tells you which comes out ahead on what matters to you — for everyday life and for business."),
    openGraph: { title: t("ORION — Make better decisions. Live a better life."), images: ["/images/orbit-horizon.jpg"] },
  };
}

export const viewport: Viewport = { themeColor: "#05080f", colorScheme: "dark" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await requestLocale();
  const t = await getT();
  return (
    <html lang={locale} className={`${outfit.variable} ${interTight.variable} ${mono.variable} ${notoKr.variable}`}>
      <body>
        <LocaleProvider locale={locale}>
          <a href="#main" className="skip-link">{t("Skip to content")}</a>
          {children}
        </LocaleProvider>
        <div className="o-grain" aria-hidden />
        <ErrorReporter />
        {/* Page views, referrers and Core Web Vitals, without cookies or personal data (Vercel Web Analytics). */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
