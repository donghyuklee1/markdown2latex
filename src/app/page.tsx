import Header from "@/components/Header";
import AppShell from "@/components/AppShell";
import ShortcutsDialog from "@/components/ShortcutsDialog";
import AccountDock from "@/components/account/AccountDock";
import Onboarding from "@/components/onboarding/Onboarding";
import LoginScreen from "@/components/account/LoginScreen";
import AiKeyDialog from "@/components/ai/AiKeyDialog";
import { ToastProvider } from "@/components/Toast";
import AuthGate from "@/components/account/AuthGate";

/**
 * Single-page workspace. Every transformation happens in the browser; there is
 * no server code. AI calls go from the browser to Google with the user's own
 * key, and accounts talk to Supabase directly. With accounts set up, the
 * workspace opens only for a signed-in user, on that user's own data.
 */
export default function Page() {
  return (
    <ToastProvider>
      <AuthGate>
        <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
          <Header />
          <AppShell />
        </div>
        <ShortcutsDialog />
        <AccountDock />
        <Onboarding />
        <LoginScreen />
        <AiKeyDialog />
      </AuthGate>
    </ToastProvider>
  );
}
