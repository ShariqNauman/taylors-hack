import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";

const ALLOWED = new Set([
  "site",
  "cameras",
  "events",
  "replay",
  "hotspots",
  "plan",
  "proof",
]);

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;
  if (!ALLOWED.has(name)) {
    return NextResponse.json({ error: "unknown mock" }, { status: 404 });
  }
  const file = path.join(process.cwd(), "public", "mock", `${name}.json`);
  const text = await fs.readFile(file, "utf8");
  return new NextResponse(text, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
