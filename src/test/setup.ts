import "@testing-library/jest-dom/vitest"

// jsdom has no PointerEvent; without it a test can't say a press came from a finger.
if (typeof window !== 'undefined' && !('PointerEvent' in window)) {
  class PointerEvent extends MouseEvent {
    readonly pointerType: string
    readonly pointerId: number
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerType = init.pointerType ?? 'mouse'
      this.pointerId = init.pointerId ?? 1
    }
  }
  Object.defineProperty(window, 'PointerEvent', { value: PointerEvent, configurable: true, writable: true })
}
