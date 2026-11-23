// Signing out from anywhere: end the session, forget "continue as guest", clear the decision on screen, and land on
// the welcome page.
import { useRouter } from "expo-router";
import { useAccount } from "./store";
import { useGate } from "./gate";
import { useSession } from "../store/session";
import { useBusiness } from "../business/profile";

export function useSignOut() {
  const router = useRouter();
  return async () => {
    await useAccount.getState().logout();
    useGate.getState().reset();
    useSession.getState().reset();
    // The device data was erased with the sign-out; reload so the next person does not inherit this company.
    await useBusiness.getState().load();
    router.replace("/account");
  };
}
