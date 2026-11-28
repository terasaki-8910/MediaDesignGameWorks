// Keyboard and mouse state with edge-triggered presses and pointer lock.
import { KeyState } from './keys.ts';

/** A pointer (mouse, pen or finger) over the canvas: CSS pixels from its top left, and the size of the canvas in CSS pixels. */
export interface PointerSample { id: number; type: string; x: number; y: number; width: number; height: number }

/**
 * What the game does with a pointer that takes hold of something (Fold Mode's drag). `down` says whether the press takes hold
 * of anything; if it does, the pointer is captured (its moves and its release come here, wherever it goes), the mouse's
 * compatibility events are suppressed (so the press is no click and no look-round), and nothing else reads it.
 */
export interface PointerGrab {
  down(p: PointerSample): boolean;
  move(p: PointerSample): void;
  up(p: PointerSample): void;
  /** The pointer was taken from us (a gesture, a lost capture, the window lost focus). */
  cancel(): void;
}

export class Input {
  private readonly keys = new KeyState();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  rightClick = false;
  /** A left click on the canvas this frame (it skips the establishing view). */
  clicked = false;
  locked = false;
  private dragging = false;
  /** Set by the game; see PointerGrab. */
  grab: PointerGrab | null = null;
  /** The last place a pointer was seen over the canvas (null: none is over it). */
  pointer: PointerSample | null = null;
  /** A pointer is holding something: the mouse does not look round meanwhile. */
  grabbing = false;
  private grabId: number | null = null;
  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    // (keys.ts: `e.code` names the key; when it is empty or 'Unidentified' the character stands in, and a keydown an IME took is still read)
    window.addEventListener('keydown', (e) => {
      const id = this.keys.down(e);
      if (id && ['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(id)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.up(e));
    window.addEventListener('blur', () => this.keys.releaseAll());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked || this.dragging) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    el.addEventListener('mousedown', (e) => {
      if (e.button === 2) this.rightClick = true;
      if (e.button === 0) this.clicked = true;
      if (!this.locked) this.dragging = true;
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    // Pointer events carry the mouse, a pen and a finger alike. Only a primary pointer (the first finger; the left button) can take hold.
    const sample = (e: PointerEvent): PointerSample => {
      const r = el.getBoundingClientRect();
      return { id: e.pointerId, type: e.pointerType, x: e.clientX - r.left, y: e.clientY - r.top, width: r.width, height: r.height };
    };
    const letGo = (id: number | null, call: (g: PointerGrab) => void) => {
      if (id === null || id !== this.grabId) return;
      this.grabId = null;
      this.grabbing = false;
      try {
        el.releasePointerCapture(id);
      } catch {
        /* it is already gone */
      }
      if (this.grab) call(this.grab);
    };
    el.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || this.grabId !== null || this.locked) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const p = sample(e);
      this.pointer = p;
      if (!this.grab?.down(p)) return;
      this.grabId = e.pointerId;
      this.grabbing = true;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer that has already gone: its up never comes, and the lost capture below lets go */
      }
      e.preventDefault(); // (no mousedown follows: this is neither a click nor the start of looking round)
    });
    el.addEventListener('pointermove', (e) => {
      const p = sample(e);
      if (e.pointerId === this.grabId) this.grab?.move(p);
      this.pointer = p;
    });
    el.addEventListener('pointerup', (e) => {
      const p = sample(e);
      if (e.pointerType !== 'mouse') this.pointer = null; // (a finger that has lifted is not hovering)
      letGo(e.pointerId, (g) => g.up(p));
    });
    el.addEventListener('pointercancel', (e) => letGo(e.pointerId, (g) => g.cancel()));
    el.addEventListener('lostpointercapture', (e) => letGo(e.pointerId, (g) => g.cancel()));
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerId !== this.grabId) this.pointer = null;
    });
    window.addEventListener('blur', () => letGo(this.grabId, (g) => g.cancel()));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
  }

  down(code: string) {
    return this.keys.isDown(code);
  }

  hit(...codes: string[]) {
    return this.keys.hit(...codes);
  }

  /** Simulate a key press (debug / automated playtests). */
  press(code: string) {
    this.keys.press(code);
  }

  hold(code: string, on: boolean) {
    this.keys.hold(code, on);
  }

  requestLock() {
    if (!this.locked) this.el.requestPointerLock?.()?.catch?.(() => {});
  }

  endFrame() {
    this.keys.endFrame();
    this.mouseDX = this.mouseDY = this.wheel = 0;
    this.rightClick = false;
    this.clicked = false;
  }
}
