import type { Metadata } from "next";

export const metadata: Metadata = { title: "Push" };

export default function PushPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[430px] flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="ee-display text-[40px]">Start your shift</span>
      <p className="text-[16px] text-ink-2">
        The duty-phone screen is built on its own branch.
      </p>
    </main>
  );
}
