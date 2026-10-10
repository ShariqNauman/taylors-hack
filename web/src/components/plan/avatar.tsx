import type { Person } from "@/lib/posts";

/** Round picture of a person; initials when there is no picture; a dashed ring for "nobody". */
export function Avatar({ person, size = 36 }: { person: Person | null; size?: number }) {
  const style = { width: size, height: size };
  if (!person)
    return <span aria-hidden="true" style={style} className="inline-block flex-none rounded-full border-2 border-dashed border-line-strong bg-raised" />;
  if (person.photo_url)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={person.photo_url} alt="" width={size} height={size} style={style} className="block flex-none rounded-full bg-raised object-cover" />;
  const initials = person.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
  return (
    <span aria-hidden="true" style={{ ...style, fontSize: size * 0.38 }} className="inline-flex flex-none items-center justify-center rounded-full bg-signal-tint font-extrabold text-signal-ink">
      {initials}
    </span>
  );
}
