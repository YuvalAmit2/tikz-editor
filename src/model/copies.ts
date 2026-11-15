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
