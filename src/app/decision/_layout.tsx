import { Slot } from "expo-router";
import { Gate } from "../../components/Gate";

export default function DecisionLayout() {
  return <Gate><Slot /></Gate>;
}
