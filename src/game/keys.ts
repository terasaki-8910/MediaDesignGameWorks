// Which key an event is, and which keys are held. Pure (no DOM): tests/keys.test.ts runs it with plain objects.
//
// The game names keys by `KeyboardEvent.code` (KeyW, ArrowUp, Space: the key's place, whatever the layout or the IME).
// Some remote desktops and keyboard tools send an empty `code` or 'Unidentified', and a keydown that an IME handles can
// arrive with keyCode 229 and key 'Process'; for those the key's character (and, last, the old keyCode) names the key.

export interface KeyLike {
  code?: string;
  key?: string;
  keyCode?: number;
  repeat?: boolean;
}

/** The `code` names the game reads (input.ts users), by the character the key types. */
const BY_KEY: Readonly<Record<string, string>> = {
  ' ': 'Space', Spacebar: 'Space', Enter: 'Enter', Escape: 'Escape', Esc: 'Escape', Tab: 'Tab',
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
  Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight', // (old Edge and IE)
  Shift: 'ShiftLeft', Control: 'ControlLeft', Alt: 'AltLeft', Backspace: 'Backspace',
};

/** The old `keyCode` of the keys the game uses. 229 ("Process": an IME has the key) names nothing. */
const BY_KEYCODE: Readonly<Record<number, string>> = {
  8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'ShiftLeft', 17: 'ControlLeft', 18: 'AltLeft', 27: 'Escape', 32: 'Space',
  37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown',
};

/** The key's `code` name: `e.code` when the browser gave one, else what `e.key`, then `e.keyCode`, says; null when nothing does. */
export function keyId(e: KeyLike): string | null {
  if (e.code && e.code !== 'Unidentified') return e.code;
  const key = e.key;
  if (key && key !== 'Unidentified' && key !== 'Process' && key !== 'Dead') {
    if (key.length === 1) {
      if (/[a-z]/i.test(key)) return `Key${key.toUpperCase()}`;
      if (/[0-9]/.test(key)) return `Digit${key}`;
    }
    if (BY_KEY[key]) return BY_KEY[key];
  }
  const kc = e.keyCode;
  if (kc !== undefined) {
    if (kc >= 65 && kc <= 90) return `Key${String.fromCharCode(kc)}`;
    if (kc >= 48 && kc <= 57) return `Digit${kc - 48}`;
    if (BY_KEYCODE[kc]) return BY_KEYCODE[kc];
  }
  return null;
}

/** The keys held now, and the presses since the game last looked (edge-triggered). */
export class KeyState {
  private held = new Set<string>();
  private hits = new Set<string>();

  /** Returns the key's name, or null when the event names no key the game can read. */
  down(e: KeyLike): string | null {
    const id = keyId(e);
    if (!id) return null;
    // a repeat re-asserts the hold: after a keyup that could not be told apart (see up) a key still held comes back with its next repeat
    this.held.add(id);
    if (!e.repeat) this.hits.add(id);
    return id;
  }

  /**
   * A key came up. When the event names no key (an IME ate its identity) which one it was is not known, and a key left held
   * would walk the player for ever: nothing is held then, and a key still down comes back with its next auto-repeat.
   */
  up(e: KeyLike): string | null {
    const id = keyId(e);
    if (id) this.held.delete(id);
    else this.held.clear();
    return id;
  }

  isDown(id: string) {
    return this.held.has(id);
  }

  hit(...ids: string[]) {
    return ids.some((c) => this.hits.has(c));
  }

  press(id: string) {
    this.hits.add(id);
  }

  hold(id: string, on: boolean) {
    if (on) this.held.add(id);
    else this.held.delete(id);
  }

  /** Window lost focus: no key is held any more as far as the game can tell. */
  releaseAll() {
    this.held.clear();
  }

  endFrame() {
    this.hits.clear();
  }
}
