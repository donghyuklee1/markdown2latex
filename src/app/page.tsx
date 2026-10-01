import Header from "@/components/Header";
import Workspace from "@/components/Workspace";
import ShortcutsDialog from "@/components/ShortcutsDialog";
import { ToastProvider } from "@/components/Toast";

/**
 * Single-page workspace. Every transformation happens in the browser, so there
 * is no route handler, no server action, and nothing to log.
 */
export default function Page() {
  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
        <Header />
        <Workspace />
      </div>
      <ShortcutsDialog />
    </ToastProvider>
  );
}
