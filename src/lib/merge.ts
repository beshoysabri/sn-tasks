/**
 * Three-way merge of a note changed on two devices. base = the text both started from (the last one
 * this editor saved or received), local = what this editor has now, remote = what Standard Notes just
 * delivered. Tasks merge field by field: a field changed on one side wins; changed on both, the side
 * edited later wins, except title and description, which keep the local text and are reported as
 * conflicts (the editor shows "This task changed elsewhere…"). Comments and history from both sides
 * are kept. Nothing is lost when one side deleted what the other changed. Two tasks created on both
 * sides with the same number are renumbered so IDs stay unique.
 */
import type { Project, Task, Workspace } from './model/types'

export interface MergeResult {
  ws: Workspace
  /** Tasks whose title or description changed on both sides (local text kept). */
  conflicts: { id: string; remote: Pick<Task, 'title' | 'description'> }[]
}

export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => same(x, (b as unknown[])[i]))
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

function mergeById<T>(base: T[], local: T[], remote: T[], key: (t: T) => string, both: (b: T, l: T, r: T) => T): T[] {
  const B = new Map(base.map((x) => [key(x), x]))
  const L = new Map(local.map((x) => [key(x), x]))
  const R = new Map(remote.map((x) => [key(x), x]))
  const order = [...new Set([...remote.map(key), ...local.map(key)])]
  const out: T[] = []
  for (const k of order) {
    const b = B.get(k)
    const l = L.get(k)
    const r = R.get(k)
    if (l === undefined && r === undefined) continue
    if (l === undefined) {
      // Created there, or deleted here: a deletion only sticks if the other side didn't change it.
      if (b === undefined || !same(b, r)) out.push(r!)
      continue
    }
    if (r === undefined) {
      if (b === undefined || !same(b, l)) out.push(l)
      continue
    }
    if (same(l, r) || b === undefined || same(b, l)) out.push(r)
    else if (same(b, r)) out.push(l)
    else out.push(both(b, l, r))
  }
  return out
}

/** Field by field: one side changed → that side; both → `pick`. */
function mergeFields<T extends object>(b: T, l: T, r: T, pick: (key: keyof T, lv: unknown, rv: unknown) => unknown): T {
  const out = {} as Record<string, unknown>
  for (const k of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)]) as Set<keyof T & string>) {
    const bv = b[k]
    const lv = l[k]
    const rv = r[k]
    out[k] = same(lv, bv) ? rv : same(rv, bv) ? lv : pick(k, lv, rv)
  }
  return out as T
}

export function merge(base: Workspace, local: Workspace, remote: Workspace): MergeResult {
  const conflicts: MergeResult['conflicts'] = []

  const tasks = mergeById(base.tasks, local.tasks, remote.tasks, (t) => t.id, (b, l, r) => {
    const localLater = l.updated >= r.updated
    const merged = mergeFields(b, l, r, (key, lv, rv) => {
      if (key === 'history') {
        const all = [...(l.history ?? []), ...(r.history ?? [])]
        const seen = new Set<string>()
        return all
          .filter((h) => {
            const id = JSON.stringify([h.at, h.kind, h.from, h.to, h.text])
            if (seen.has(id)) return false
            seen.add(id)
            return true
          })
          .sort((x, y) => x.at.localeCompare(y.at))
      }
      if (key === 'fields') return mergeFields(b.fields, l.fields, r.fields, (_k, flv, frv) => (localLater ? flv : frv))
      if (key === 'title' || key === 'description') return lv
      if (key === 'updated') return localLater ? lv : rv
      return localLater ? lv : rv
    })
    if ((!same(l.title, b.title) && !same(r.title, b.title) && l.title !== r.title) || (!same(l.description, b.description) && !same(r.description, b.description) && l.description !== r.description))
      conflicts.push({ id: l.id, remote: { title: r.title, description: r.description } })
    return merged
  })

  const projects = mergeById(base.projects, local.projects, remote.projects, (p) => p.id, (b, l, r) =>
    mergeFields(b, l, r, (key, lv, rv) => (key === 'next' ? Math.max(Number(lv), Number(rv)) : lv)),
  )

  const pickLocal = <T>(b: T, l: T, r: T) => mergeFields(b as object, l as object, r as object, (_k, lv) => lv) as T
  const ws: Workspace = {
    settings: mergeFields(base.settings, local.settings, remote.settings, (key, lv, rv) => (key === 'noProjectNext' ? Math.max(Number(lv), Number(rv)) : lv)),
    statuses: mergeById(base.statuses, local.statuses, remote.statuses, (s) => s.id, pickLocal),
    labels: mergeById(base.labels, local.labels, remote.labels, (l) => l.name.toLowerCase(), pickLocal),
    types: mergeById(base.types, local.types, remote.types, (t) => t.id, pickLocal),
    buckets: mergeById(base.buckets, local.buckets, remote.buckets, (x) => x.id, pickLocal),
    fields: mergeById(base.fields, local.fields, remote.fields, (f) => f.id, pickLocal),
    filters: mergeById(base.filters, local.filters, remote.filters, (f) => f.id, pickLocal),
    cycleSettings: same(local.cycleSettings, base.cycleSettings) ? remote.cycleSettings : local.cycleSettings,
    cycles: mergeById(base.cycles, local.cycles, remote.cycles, (c) => c.id, pickLocal),
    spaces: mergeById(base.spaces, local.spaces, remote.spaces, (s) => s.id, pickLocal),
    projects,
    tasks,
    preamble: same(local.preamble, base.preamble) ? remote.preamble : local.preamble,
  }
  renumberCollisions(ws, new Set(remote.tasks.map((t) => t.id)))
  return { ws, conflicts }
}

export interface CopyResult extends MergeResult {
  /** Tasks only the copy had, now back. */
  added: number
  /** Tasks both had that took something from the copy. */
  updated: number
}

const historyKey = (h: Task['history'][number]) => JSON.stringify([h.at, h.kind, h.from, h.to, h.text])

/** Both sides' history and comments, each once, oldest first. */
function joinHistory(a: Task['history'], b: Task['history']): Task['history'] {
  const seen = new Set<string>()
  return [...a, ...b]
    .filter((h) => {
      const key = historyKey(h)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((x, y) => x.at.localeCompare(y.at))
}

/**
 * Merge from text: a conflicted copy Standard Notes made has no common base with this note, so nothing
 * is taken away. What only the copy has comes back (tasks, projects, spaces, labels and the rest). For a
 * task both have, the side edited later wins field by field, comments and history from both are kept,
 * and a title or description that differs keeps this note's text and is reported as a conflict. A task
 * the copy brings back whose number is taken here moves up to the next free number.
 */
export function mergeCopy(local: Workspace, copy: Workspace): CopyResult {
  const conflicts: MergeResult['conflicts'] = []
  const fromCopy = new Map(copy.tasks.map((t) => [t.id, t]))
  let updated = 0
  const tasks = local.tasks.map((l) => {
    const r = fromCopy.get(l.id)
    if (!r || same(l, r)) return l
    const localLater = l.updated >= r.updated
    const out = { ...l } as Record<string, unknown>
    for (const k of new Set([...Object.keys(l), ...Object.keys(r)]) as Set<keyof Task & string>) {
      const lv = l[k]
      const rv = r[k]
      if (same(lv, rv) || k === 'title' || k === 'description') continue
      if (k === 'history') out.history = joinHistory(l.history, r.history)
      else if (k === 'aliases') out.aliases = [...new Set([...l.aliases, ...r.aliases])]
      else if (k === 'fields') {
        const fields: Record<string, string> = { ...r.fields, ...l.fields }
        if (!localLater) for (const [id, v] of Object.entries(r.fields)) fields[id] = v
        out.fields = fields
      } else out[k] = localLater ? lv : rv
    }
    if (l.title !== r.title || l.description !== r.description) conflicts.push({ id: l.id, remote: { title: r.title, description: r.description } })
    const merged = out as unknown as Task
    if (!same(merged, l)) updated++
    return merged
  })
  const localIds = new Set(local.tasks.map((t) => t.id))
  const added = copy.tasks.filter((t) => !localIds.has(t.id))
  tasks.push(...added)

  const union = <T>(mine: T[], theirs: T[], key: (x: T) => string) => {
    const have = new Set(mine.map(key))
    return [...mine, ...theirs.filter((x) => !have.has(key(x)))]
  }
  const copyProjects = new Map(copy.projects.map((p) => [p.id, p]))
  const projects = union(local.projects.map((p) => ({ ...p, next: Math.max(p.next, copyProjects.get(p.id)?.next ?? 0) })), copy.projects, (p) => p.id)
  const ws: Workspace = {
    ...local,
    settings: { ...local.settings, noProjectNext: Math.max(local.settings.noProjectNext, copy.settings.noProjectNext) },
    statuses: union(local.statuses, copy.statuses, (x) => x.id),
    labels: union(local.labels, copy.labels, (x) => x.name.toLowerCase()),
    types: union(local.types, copy.types, (x) => x.id),
    buckets: union(local.buckets, copy.buckets, (x) => x.id),
    fields: union(local.fields, copy.fields, (x) => x.id),
    filters: union(local.filters, copy.filters, (x) => x.id),
    cycles: union(local.cycles, copy.cycles, (x) => x.id),
    spaces: union(local.spaces, copy.spaces, (x) => x.id),
    projects,
    tasks,
  }
  // This note's tasks keep their numbers; one the copy brings back moves up if its number is taken.
  renumberCollisions(ws, localIds)
  return { ws, conflicts, added: added.length, updated }
}

/** Two tasks created on two devices can share a number; the one only this device has moves up. */
function renumberCollisions(ws: Workspace, remoteIds: Set<string>) {
  const groups = new Map<string, Task[]>()
  for (const t of ws.tasks) {
    const key = `${t.project ?? ''}#${t.number}`
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const projects = new Map<string, Project>(ws.projects.map((p) => [p.id, p]))
  const maxBy = new Map<string, number>()
  for (const t of ws.tasks) maxBy.set(t.project ?? '', Math.max(maxBy.get(t.project ?? '') ?? 0, t.number))
  for (const p of ws.projects) p.next = Math.max(p.next, (maxBy.get(p.id) ?? 0) + 1)
  ws.settings = { ...ws.settings, noProjectNext: Math.max(ws.settings.noProjectNext, (maxBy.get('') ?? 0) + 1) }
  for (const list of groups.values()) {
    if (list.length < 2) continue
    for (const t of list.filter((x) => !remoteIds.has(x.id))) {
      const index = ws.tasks.indexOf(t)
      const project = t.project ? projects.get(t.project) : undefined
      let number: number
      if (project) {
        number = project.next++
      } else {
        number = ws.settings.noProjectNext
        ws.settings = { ...ws.settings, noProjectNext: number + 1 }
      }
      ws.tasks[index] = { ...t, number }
    }
  }
  ws.projects = ws.projects.map((p) => ({ ...projects.get(p.id)! }))
}
