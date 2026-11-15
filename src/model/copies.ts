// Copies of objects (duplicate, paste, library insert).
import { transformObj, type Affine } from "./geometry";
import { newId, type Obj } from "./types";

/** Copies of `objs` moved by `m`, with new ids. Copied groups become new
 *  groups (not part of the originals' group), and a copied label that labels
 *  copied objects labels the copies; one whose objects weren't copied is a
 *  plain label (it would otherwise jump back to the original). */
export function freshCopies(objs: Obj[], m: Affine): Obj[] {
  const ids = new Map(objs.map((o) => [o.id, newId()]));
  const groups = new Map<string, string>();
  for (const o of objs) if (o.group && !groups.has(o.group)) groups.set(o.group, newId());
  return objs.map((o) => {
    const c = { ...transformObj(o, m), id: ids.get(o.id)! } as Obj;
    if (o.group) c.group = groups.get(o.group);
    if (c.type === "label") {
      const remap = (list: string[] | undefined) => (list && list.length && list.every((i) => ids.has(i)) ? list.map((i) => ids.get(i)!) : undefined);
      const attach = remap(c.attach);
      if (attach) c.attach = attach;
      else delete c.attach;
      const follow = c.follow ? remap(c.follow.ids) : undefined;
      if (c.follow && follow) c.follow = { ...c.follow, ids: follow };
      else delete c.follow;
    }
    return c;
  });
}

/** "a_1" → "a_2", "z_{9}" → "z_{10}": the last numbered subscript in a
 *  label, counted up (for ⌘D, so a row of a_1, a_2, … comes quickly).
 *  Other numbers (\R^2, 2\pi) stay as they are. */
export function nextNumbered(text: string): string {
  const m = text.match(/^(.*_\{?)(\d+)(.*)$/s);
  if (!m) return text;
  return m[1] + String(parseInt(m[2], 10) + 1) + m[3];
}
