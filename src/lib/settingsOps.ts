/**
 * Workspace vocabulary: statuses, labels, types, buckets and custom fields. Renaming or deleting one
 * updates every task that uses it (as in Octarine's Settings → Tasks).
 */
import { CATEGORY_NAMES } from './model/defaults'
import type { Bucket, Field, Label, Status, StatusCategory, TaskType } from './model/types'
import { isClosedCategory, nearestStatusId, normaliseLabel } from './model/workspace'
import { patchTask, type Draft } from './ops'

const slugId = (name: string, taken: string[]) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`
  return id
}

// ───── statuses ─────

export function addStatus(d: Draft, name: string, category: StatusCategory, color?: string): Status | null {
  const ws = d.ws
  const clean = name.trim()
  if (!clean || ws.statuses.some((s) => s.name.toLowerCase() === clean.toLowerCase())) return null
  const status: Status = { id: slugId(clean, ws.statuses.map((s) => s.id)), name: clean, category, color, builtin: false }
  d.set('statuses', [...ws.statuses, status])
  return status
}

export function updateStatus(d: Draft, id: string, patch: { name?: string; color?: string | null }) {
  const ws = d.ws
  d.set('statuses', ws.statuses.map((s) => {
    if (s.id !== id) return s
    const next = { ...s }
    if (patch.name !== undefined && !s.builtin && patch.name.trim()) next.name = patch.name.trim()
    if (patch.color !== undefined) next.color = patch.color ?? undefined
    return next
  }))
}

/** Deletes a custom status; its tasks move to the built-in of its category (or the nearest their project uses). */
export function deleteStatus(d: Draft, id: string) {
  const ws = d.ws
  const status = ws.statuses.find((s) => s.id === id)
  if (!status || status.builtin) return
  const fallback = ws.statuses.find((s) => s.builtin && s.category === status.category)?.id ?? 'todo'
  d.set('statuses', ws.statuses.filter((s) => s.id !== id))
  for (const t of ws.tasks.filter((x) => x.status === id)) {
    const project = t.project ? d.projects.get(t.project) : undefined
    patchTask(d, t.id, { status: nearestStatusId(d.ws, project, fallback) }, false)
  }
  for (const p of [...d.projects.values()].filter((x) => x.statuses?.includes(id))) d.putProject({ ...p, statuses: p.statuses!.filter((s) => s !== id) })
}

export function categoryLabel(c: StatusCategory): string {
  return CATEGORY_NAMES[c]
}

export { isClosedCategory }

// ───── labels ─────

export function addLabel(d: Draft, name: string, color?: string): Label | null {
  const clean = normaliseLabel(name)
  if (!clean || d.ws.labels.some((l) => l.name.toLowerCase() === clean.toLowerCase())) return null
  const label = { name: clean, color }
  d.set('labels', [...d.ws.labels, label])
  return label
}

/** Renames (and recolours) a label everywhere: on tasks, projects, spaces, types and project offers. */
export function updateLabel(d: Draft, name: string, patch: { name?: string; color?: string | null }) {
  const ws = d.ws
  const lower = name.toLowerCase()
  const to = patch.name !== undefined ? normaliseLabel(patch.name) : name
  if (!to) return
  const rename = (list: string[]) => list.map((l) => (l.toLowerCase() === lower ? to : l))
  const exists = ws.labels.some((l) => l.name.toLowerCase() === lower)
  const labels = exists ? ws.labels.map((l) => (l.name.toLowerCase() === lower ? { name: to, color: patch.color === undefined ? l.color : (patch.color ?? undefined) } : l)) : [...ws.labels, { name: to, color: patch.color ?? undefined }]
  d.set('labels', labels)
  if (to === name) return
  for (const t of ws.tasks.filter((x) => x.labels.some((l) => l.toLowerCase() === lower))) patchTask(d, t.id, { labels: rename(t.labels) }, false)
  for (const p of [...d.projects.values()]) {
    if (p.labels.some((l) => l.toLowerCase() === lower) || p.labelsOffered?.some((l) => l.toLowerCase() === lower))
      d.putProject({ ...p, labels: rename(p.labels), labelsOffered: p.labelsOffered ? rename(p.labelsOffered) : undefined })
  }
  d.set('types', d.ws.types.map((ty) => ({ ...ty, labels: rename(ty.labels) })))
  d.set('spaces', d.ws.spaces.map((s) => ({ ...s, labels: rename(s.labels) })))
}

export function deleteLabel(d: Draft, name: string) {
  const lower = name.toLowerCase()
  const keep = (list: string[]) => list.filter((l) => l.toLowerCase() !== lower)
  d.set('labels', d.ws.labels.filter((l) => l.name.toLowerCase() !== lower))
  for (const t of d.ws.tasks.filter((x) => x.labels.some((l) => l.toLowerCase() === lower))) patchTask(d, t.id, { labels: keep(t.labels) }, false)
  for (const p of [...d.projects.values()]) if (p.labels.some((l) => l.toLowerCase() === lower)) d.putProject({ ...p, labels: keep(p.labels) })
  d.set('types', d.ws.types.map((ty) => ({ ...ty, labels: keep(ty.labels) })))
}

// ───── types and buckets ─────

export function addType(d: Draft, name: string, color?: string): TaskType | null {
  const clean = name.trim()
  if (!clean || d.ws.types.some((t) => t.name.toLowerCase() === clean.toLowerCase())) return null
  const type: TaskType = { id: slugId(clean, d.ws.types.map((t) => t.id)), name: clean, color, labels: [], priority: 0 }
  d.set('types', [...d.ws.types, type])
  return type
}

export function updateType(d: Draft, id: string, patch: Partial<Omit<TaskType, 'id'>>) {
  d.set('types', d.ws.types.map((t) => (t.id === id ? { ...t, ...patch, name: patch.name?.trim() || t.name } : t)))
}

/** Tasks lose the type; labels and priorities its rules set stay. */
export function deleteType(d: Draft, id: string) {
  d.set('types', d.ws.types.filter((t) => t.id !== id))
  for (const t of d.ws.tasks.filter((x) => x.type === id)) patchTask(d, t.id, { type: undefined }, false)
}

export function addBucket(d: Draft, name: string, color?: string): Bucket | null {
  const clean = name.trim()
  if (!clean || d.ws.buckets.some((b) => b.name.toLowerCase() === clean.toLowerCase())) return null
  const bucket = { id: slugId(clean, d.ws.buckets.map((b) => b.id)), name: clean, color }
  d.set('buckets', [...d.ws.buckets, bucket])
  return bucket
}

export function updateBucket(d: Draft, id: string, patch: { name?: string; color?: string | null }) {
  d.set('buckets', d.ws.buckets.map((b) => (b.id === id ? { ...b, name: patch.name?.trim() || b.name, color: patch.color === undefined ? b.color : (patch.color ?? undefined) } : b)))
}

/** Its tasks move to No bucket. */
export function deleteBucket(d: Draft, id: string) {
  d.set('buckets', d.ws.buckets.filter((b) => b.id !== id))
  for (const t of d.ws.tasks.filter((x) => x.bucket === id)) patchTask(d, t.id, { bucket: undefined }, false)
  for (const p of [...d.projects.values()].filter((x) => x.buckets?.includes(id))) d.putProject({ ...p, buckets: p.buckets!.filter((b) => b !== id) })
}

/** Moves an item up or down in its list (order is how they appear in groups, columns and pickers). */
export function moveItem<T extends { id?: string; name?: string }>(list: T[], index: number, delta: -1 | 1): T[] {
  const j = index + delta
  if (j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[index], next[j]] = [next[j], next[index]]
  return next
}

// ───── custom fields ─────

const RESERVED = ['status', 'priority', 'labels', 'due', 'type', 'bucket', 'cycle', 'created', 'updated', 'completed', 'cancelled', 'archived', 'order', 'aliases', 'ref']

export function fieldNameProblem(name: string, fields: Field[], selfId?: string): string | null {
  const clean = name.trim()
  if (!clean) return 'A field needs a name.'
  if (RESERVED.includes(clean.toLowerCase())) return `“${clean}” is a built-in property.`
  if (!/^[A-Za-z][A-Za-z ]*$/.test(clean)) return 'Use letters and spaces only.'
  if (fields.some((f) => f.id !== selfId && f.name.toLowerCase() === clean.toLowerCase())) return 'There is already a field with that name.'
  return null
}

export function addField(d: Draft, field: Omit<Field, 'id'>): Field | null {
  if (fieldNameProblem(field.name, d.ws.fields)) return null
  const created = { ...field, name: field.name.trim(), id: slugId(field.name, d.ws.fields.map((f) => f.id)) }
  d.set('fields', [...d.ws.fields, created])
  return created
}

export function updateField(d: Draft, id: string, patch: Partial<Omit<Field, 'id'>>) {
  if (patch.name !== undefined && fieldNameProblem(patch.name, d.ws.fields, id)) return
  d.set('fields', d.ws.fields.map((f) => (f.id === id ? { ...f, ...patch, name: patch.name?.trim() ?? f.name } : f)))
}

/** Deletes a field and its values on every task. */
export function deleteField(d: Draft, id: string) {
  d.set('fields', d.ws.fields.filter((f) => f.id !== id))
  for (const t of d.ws.tasks.filter((x) => id in x.fields)) {
    const fields = { ...t.fields }
    delete fields[id]
    d.putTask({ ...t, fields, updated: d.now })
  }
}

// ───── settings ─────

/** The key for tasks without a project; old IDs keep finding them. */
export function setNoProjectKey(d: Draft, key: string) {
  const ws = d.ws
  if (!/^[A-Z][A-Z0-9]{1,4}$/.test(key) || key === ws.settings.noProjectKey || ws.projects.some((p) => p.key === key)) return
  for (const t of ws.tasks.filter((x) => !x.project)) {
    const old = `${ws.settings.noProjectKey}-${t.number}`
    patchTask(d, t.id, { aliases: [...t.aliases.filter((a) => a !== old), old] }, false)
  }
  d.set('settings', { ...d.ws.settings, noProjectKey: key })
}
