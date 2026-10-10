import { redirect } from "next/navigation";

/** Old duty-phone link (/push?staff=Guard B) → the guard app, same person. */
export default async function PushPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const staff = typeof sp.staff === "string" ? sp.staff : null;
  redirect(staff ? `/guard?staff=${encodeURIComponent(staff)}` : "/guard");
}
