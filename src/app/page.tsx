import Header from "@/components/Header";
import AppShell from "@/components/AppShell";
import ShortcutsDialog from "@/components/ShortcutsDialog";
import AccountDock from "@/components/account/AccountDock";
import Onboarding from "@/components/onboarding/Onboarding";
import LoginScreen from "@/components/account/LoginScreen";
import { ToastProvider } from "@/components/Toast";

/**
 * Single-page workspace. Every transformation happens in the browser; the
 * only server piece is /api/analyze (shared Gemini key), and accounts talk to
 * Supabase directly from the browser.
 */
export default function Page() {
  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
        <Header />
        <AppShell />
      </div>
      <ShortcutsDialog />
      <AccountDock />
      <Onboarding />
      <LoginScreen />
    </ToastProvider>
  );
}
