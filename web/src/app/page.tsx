import { Suspense } from "react";
import { ShellPreview } from "@/components/shell-preview";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <ShellPreview />
    </Suspense>
  );
}
