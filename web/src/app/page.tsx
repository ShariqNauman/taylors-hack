import { Suspense } from "react";
import { LiveScreen } from "@/components/live/live-screen";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <LiveScreen />
    </Suspense>
  );
}
