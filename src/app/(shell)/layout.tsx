import { Shell } from "@/components/shell/Shell";

/**
 * The shell (map, ledger, top bar) renders once here and persists across navigation between
 * `/` and every station page, which render into it as children (KTD12).
 */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}
