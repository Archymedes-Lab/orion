import { LegalPage } from "../components/Legal";
import { privacy } from "../copy/legal";

export default function PrivacyScreen() {
  return <LegalPage {...privacy()} />;
}
