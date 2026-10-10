"use client";

import useSWR from "swr";
import { getCameras, getSite } from "@/lib/api";
import { useDetectSiteView } from "@/hooks/use-site-view";
import { SiteHeader } from "./site-header";

/** Desktop shell for every route except /push: header, site view detection, page title. */
export function PageShell({
  title,
  kicker,
  subtitle,
  headerRight,
  children,
}: {
  title?: string;
  kicker?: string;
  subtitle?: React.ReactNode;
  headerRight?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { data: site } = useSWR("site", getSite, { revalidateOnFocus: false });
  const { data: cameras } = useSWR("cameras", getCameras, {
    refreshInterval: 10_000,
  });
  useDetectSiteView(cameras);
  return (
    <>
      <SiteHeader siteName={site?.name} cameraCount={cameras?.length}>
        {headerRight}
      </SiteHeader>
      <main className="mx-auto flex max-w-[1680px] flex-col gap-4 px-4 pb-8 pt-4 sm:px-6">
        {(title || kicker) && (
          <div className="flex flex-col gap-1">
            {kicker && <span className="ee-label text-[12px]">{kicker}</span>}
            {title && (
              <h1 className="ee-display text-[44px] sm:text-[56px]">{title}</h1>
            )}
            {subtitle && (
              <div className="text-[16px] text-ink-2">{subtitle}</div>
            )}
          </div>
        )}
        {children}
      </main>
    </>
  );
}
