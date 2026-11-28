// Keyboard and mouse state with edge-triggered presses and pointer lock.
import { KeyState } from './keys.ts';

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
