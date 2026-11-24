// The one seam the tests use: a fake Standard Notes host speaking the component
// protocol to the editor, and recording every message the editor sends back.

import { act } from 'react'
import { StandardNotesBridge } from '../lib/sn/bridge'

export interface Sent {
  action: string
  data: Record<string, unknown>
  messageId: string
  sessionKey: string | null
}

export class FakeStandardNotes {
  readonly sent: Sent[] = []
  readonly bridge: StandardNotesBridge
  private streamId?: string

  constructor() {
    this.bridge = new StandardNotesBridge(window, (message) => this.sent.push(message as unknown as Sent))
  }

  private deliver(data: unknown, asString = false) {
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: asString ? JSON.stringify(data) : data, origin: 'https://app.standardnotes.com' }))
    })
  }

  /** What Standard Notes sends when the editor's iframe has loaded. */
  register({ componentData = {}, themes = [] as string[], asString = false } = {}) {
    this.deliver(
      {
        action: 'component-registered',
        sessionKey: 'session-1',
        componentData,
        data: { uuid: 'component-1', environment: 'web', platform: 'linux-web', activeThemeUrls: themes },
      },
      asString,
    )
    this.streamId = this.sent.find((m) => m.action === 'stream-context-item')?.messageId
  }

  /** The open note, as the reply to stream-context-item (sent again on every change). */
  openNote(text: string, { uuid = 'note-1', locked = false, metadataOnly = false } = {}) {
    this.deliver({
      action: 'reply',
      original: { messageId: this.streamId, action: 'stream-context-item' },
      data: {
        item: {
          uuid,
          content_type: 'Note',
          isMetadataUpdate: metadataOnly,
          content: {
            title: 'Tasks',
            text,
            noteType: 'markdown',
            appData: { 'org.standardnotes.sn': { locked } },
          },
        },
      },
    })
  }

  saves() {
    return this.sent.filter((m) => m.action === 'save-items')
  }

  componentData() {
    return this.sent.filter((m) => m.action === 'set-component-data').map((m) => m.data.componentData)
  }

  dispose() {
    this.bridge.dispose()
  }
}
