import { SiteHeader } from "@/components/site-header";

/** Simple shell for non-live pages (stubs for now). */
export function PageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-slate-500">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </main>
    </>
  );
}
