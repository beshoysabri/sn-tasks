/**
 * Standard Notes' component protocol, from Money Month's bridge (hand-written like Commonplace Year's).
 *
 * Create the bridge at module load (main.tsx), not in a React effect: Standard
 * Notes sends `component-registered` while the iframe loads, often before React
 * mounts. Differences from the older plugins' bridge:
 * - a save names the note it belongs to and is dropped if that note isn't open;
 * - nothing is queued before a note arrives, and nothing is saved on load;
 * - locked notes are never saved (Standard Notes would pop an alert);
 * - sync echoes (`isMetadataUpdate`) are ignored;
 * - themes are reloaded only when their list of URLs changes.
 */

export interface OpenNote {
  uuid: string
  title: string
  text: string
  locked: boolean
}

export interface HostInfo {
  environment?: string // 'web' | 'desktop' | 'native-mobile-web'
  platform?: string
}

/** What the editor knows from Standard Notes; a new object whenever it changes (for useSyncExternalStore). */
export interface BridgeState {
  registered: boolean
  note: OpenNote | null
  componentData: Record<string, unknown>
  host: HostInfo
}

type Post = (message: Record<string, unknown>, origin: string) => void

interface Item {
  uuid: string
  content_type?: string
  content?: { text?: string; appData?: Record<string, Record<string, unknown>>; [key: string]: unknown }
  isMetadataUpdate?: boolean
  [key: string]: unknown
}

export const THEME_EVENT = 'tasks-theme-changed'

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

function isLocked(item: Item): boolean {
  return item.content?.appData?.['org.standardnotes.sn']?.locked === true
}

export class StandardNotesBridge {
  private state: BridgeState = { registered: false, note: null, componentData: {}, host: {} }
  private sessionKey: string | null = null
  private origin = '*'
  private item: Item | null = null
  private themes: string[] = []
  private replies = new Map<string, { action: string; callback: (data: unknown) => void }>()
  private listeners = new Set<() => void>()
  private readonly win: Window
  private readonly post: Post

  constructor(win: Window = window, post?: Post) {
    this.win = win
    this.post =
      post ??
      ((message, origin) => {
        if (win.parent === win) return
        try {
          win.parent.postMessage(message, origin)
        } catch {
          win.parent.postMessage(message, '*')
        }
      })
    win.addEventListener('message', this.onMessage)
    // The phone apps deliver messages on document.
    win.document.addEventListener('message', this.onMessage as EventListener)
  }

  dispose(): void {
    this.win.removeEventListener('message', this.onMessage)
    this.win.document.removeEventListener('message', this.onMessage as EventListener)
    this.listeners.clear()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): BridgeState => this.state

  private update(patch: Partial<BridgeState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  /** Saves new text for a note. Returns false (and sends nothing) unless that note is open and unlocked. */
  save(uuid: string, text: string, preview?: string): boolean {
    const item = this.item
    if (!this.state.registered || !item || item.uuid !== uuid || isLocked(item)) return false
    const updated: Item = {
      ...item,
      content: { ...item.content, text, ...(preview !== undefined ? { preview_plain: preview } : {}) },
    }
    this.item = updated
    this.send('save-items', { items: [updated] })
    this.update({ note: this.snapshot(updated) })
    return true
  }

  /** Small preferences synced across the user's devices (not stored in the note). */
  setComponentData(data: Record<string, unknown>): void {
    const componentData = { ...this.state.componentData, ...data }
    this.send('set-component-data', { componentData })
    this.update({ componentData })
  }

  private snapshot(item: Item): OpenNote {
    return {
      uuid: item.uuid,
      title: typeof item.content?.title === 'string' ? item.content.title : '',
      text: typeof item.content?.text === 'string' ? item.content.text : '',
      locked: isLocked(item),
    }
  }

  private onMessage = (event: Event) => {
    let data: unknown = (event as MessageEvent).data
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch {
        return
      }
    }
    if (!isRecord(data) || typeof data.action !== 'string') return

    if (data.action === 'component-registered') {
      this.sessionKey = typeof data.sessionKey === 'string' ? data.sessionKey : null
      this.origin = (event as MessageEvent).origin || '*'
      const inner = isRecord(data.data) ? data.data : {}
      this.update({
        registered: true,
        componentData: isRecord(data.componentData) ? { ...data.componentData } : {},
        host: {
          environment: typeof inner.environment === 'string' ? inner.environment : undefined,
          platform: typeof inner.platform === 'string' ? inner.platform : undefined,
        },
      })
      const urls = Array.isArray(inner.activeThemeUrls) ? inner.activeThemeUrls : []
      this.applyThemes(urls.filter((u): u is string => typeof u === 'string'))
      this.send('stream-context-item', {}, (reply) => this.receiveItem(reply))
      return
    }
    if (data.action === 'themes') {
      const inner = isRecord(data.data) ? data.data : {}
      const urls = Array.isArray(inner.themes) ? inner.themes : []
      this.applyThemes(urls.filter((u): u is string => typeof u === 'string'))
      return
    }
    const original = isRecord(data.original) ? data.original : undefined
    const id = typeof original?.messageId === 'string' ? original.messageId : undefined
    const pending = id ? this.replies.get(id) : undefined
    if (!pending || !id) return
    // Standard Notes reuses the stream-context-item reply for every later change, so keep it.
    if (pending.action !== 'stream-context-item') this.replies.delete(id)
    pending.callback(data.data)
  }

  private receiveItem(reply: unknown) {
    if (!isRecord(reply)) return
    const candidate = isRecord(reply.item) ? reply.item : Array.isArray(reply.items) ? reply.items[0] : reply
    if (!isRecord(candidate) || typeof candidate.uuid !== 'string' || !isRecord(candidate.content)) return
    const item = candidate as Item
    if (item.isMetadataUpdate) return // the echo of a sync; the content hasn't changed
    this.item = item
    this.update({ note: this.snapshot(item) })
  }

  private send(action: string, data: Record<string, unknown>, callback?: (data: unknown) => void) {
    if (!this.state.registered) return
    const messageId = newId()
    if (callback) this.replies.set(messageId, { action, callback })
    this.post({ action, data, messageId, sessionKey: this.sessionKey, api: 'component' }, this.origin)
  }

  private applyThemes(urls: string[]) {
    if (urls.length === this.themes.length && urls.every((u, i) => u === this.themes[i])) return
    this.themes = urls
    const doc = this.win.document
    doc.querySelectorAll('link[data-sn-theme]').forEach((el) => el.remove())
    const loads = urls.map((url) => {
      const link = doc.createElement('link')
      link.rel = 'stylesheet'
      link.href = url
      link.setAttribute('data-sn-theme', '')
      const done = new Promise<void>((resolve) => {
        link.addEventListener('load', () => resolve())
        link.addEventListener('error', () => resolve())
      })
      doc.head.appendChild(link)
      return done
    })
    const notify = () => this.win.dispatchEvent(new CustomEvent(THEME_EVENT))
    if (loads.length) Promise.all(loads).then(notify)
    else notify()
  }
}
