// Keyboard and mouse state with edge-triggered presses and pointer lock.
export class Input {
  private keys = new Set<string>();
  private hits = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  rightClick = false;
  locked = false;
  private dragging = false;
  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.hits.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
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
      if (!this.locked) this.dragging = true;
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
  }

  down(code: string) {
    return this.keys.has(code);
  }

  hit(...codes: string[]) {
    return codes.some((c) => this.hits.has(c));
  }

  /** Simulate a key press (debug / automated playtests). */
  press(code: string) {
    this.hits.add(code);
  }

  hold(code: string, on: boolean) {
    if (on) this.keys.add(code);
    else this.keys.delete(code);
  }

  requestLock() {
    if (!this.locked) this.el.requestPointerLock?.()?.catch?.(() => {});
  }

  endFrame() {
    this.hits.clear();
    this.mouseDX = this.mouseDY = this.wheel = 0;
    this.rightClick = false;
  }
}
