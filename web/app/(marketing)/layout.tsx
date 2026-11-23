import { SiteNav } from "@/components/client";
import { Footer } from "@/components/site";

/** Marketing chrome: the transparent-to-frosted top bar and the Swiss index footer. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      <main id="main">{children}</main>
      <Footer />
    </>
  );
}
