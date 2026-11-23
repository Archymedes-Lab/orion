import { LegalPage } from "../components/Legal";
import { terms } from "../copy/legal";

export default function TermsScreen() {
  return <LegalPage {...terms()} />;
}
