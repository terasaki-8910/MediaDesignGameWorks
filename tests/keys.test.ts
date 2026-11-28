import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KeyState, keyId } from '../src/game/keys.ts';

test('the key is named by its code when the browser gives one', () => {
  assert.equal(keyId({ code: 'KeyW', key: 'w', keyCode: 87 }), 'KeyW');
  assert.equal(keyId({ code: 'ArrowUp', key: 'ArrowUp' }), 'ArrowUp');
  // (the code is the key's place: a layout or an IME that types something else does not change it)
  assert.equal(keyId({ code: 'KeyW', key: 'Process', keyCode: 229 }), 'KeyW');
  assert.equal(keyId({ code: 'KeyA', key: 'ち' }), 'KeyA');
});

test('an empty or unidentified code falls back to the key, then to the old keyCode', () => {
  for (const code of ['', 'Unidentified', undefined]) {
    assert.equal(keyId({ code, key: 'w' }), 'KeyW');
    assert.equal(keyId({ code, key: 'W' }), 'KeyW', 'with Shift or Caps Lock');
    assert.equal(keyId({ code, key: 'a' }), 'KeyA');
    assert.equal(keyId({ code, key: 's' }), 'KeyS');
    assert.equal(keyId({ code, key: 'd' }), 'KeyD');
    assert.equal(keyId({ code, key: 'e' }), 'KeyE');
    assert.equal(keyId({ code, key: 'q' }), 'KeyQ');
    assert.equal(keyId({ code, key: 'r' }), 'KeyR');
    assert.equal(keyId({ code, key: ' ' }), 'Space');
    assert.equal(keyId({ code, key: 'Enter' }), 'Enter');
    assert.equal(keyId({ code, key: 'Escape' }), 'Escape');
    assert.equal(keyId({ code, key: 'ArrowUp' }), 'ArrowUp');
    assert.equal(keyId({ code, key: 'ArrowDown' }), 'ArrowDown');
    assert.equal(keyId({ code, key: 'ArrowLeft' }), 'ArrowLeft');
    assert.equal(keyId({ code, key: 'ArrowRight' }), 'ArrowRight');
    assert.equal(keyId({ code, key: 'Shift' }), 'ShiftLeft');
    assert.equal(keyId({ code, key: 'Tab' }), 'Tab');
  }
  assert.equal(keyId({ code: '', key: 'Up' }), 'ArrowUp', 'old Edge');
  assert.equal(keyId({ code: '', key: 'Unidentified', keyCode: 87 }), 'KeyW', 'the old keyCode when the key says nothing');
  assert.equal(keyId({ code: '', key: 'Process', keyCode: 38 }), 'ArrowUp');
});

test('an event that names no key the game reads names none', () => {
  assert.equal(keyId({ code: '', key: 'Process', keyCode: 229 }), null);
  assert.equal(keyId({ code: 'Unidentified', key: 'Unidentified', keyCode: 0 }), null);
  assert.equal(keyId({}), null);
});

test('a held key is not lost when its keydown arrives with keyCode 229 or without a code', () => {
  const k = new KeyState();
  assert.equal(k.down({ code: 'KeyW', key: 'Process', keyCode: 229 }), 'KeyW');
  assert.ok(k.isDown('KeyW'));
  k.down({ code: 'KeyW', key: 'Process', keyCode: 229, repeat: true });
  assert.ok(k.isDown('KeyW'), 'an auto-repeat keeps it');
  k.up({ code: 'KeyW', key: 'w', keyCode: 229 });
  assert.equal(k.isDown('KeyW'), false);
  // a remote desktop that sends no code at all: the key's character holds it, and its keyup (with a code, or without) releases it
  k.down({ code: '', key: 'w', keyCode: 87 });
  assert.ok(k.isDown('KeyW'));
  k.up({ code: 'KeyW' });
  assert.equal(k.isDown('KeyW'), false);
});

test('presses are edge-triggered, and repeats do not press again', () => {
  const k = new KeyState();
  k.down({ code: 'KeyE' });
  k.down({ code: 'KeyE', repeat: true });
  assert.ok(k.hit('KeyE', 'Enter'));
  k.endFrame();
  assert.equal(k.hit('KeyE'), false, 'a press is read once');
  assert.ok(k.isDown('KeyE'), 'the hold stays');
  k.down({ code: 'KeyE', repeat: true });
  assert.equal(k.hit('KeyE'), false, 'a repeat is not a press');
  k.press('KeyQ');
  assert.ok(k.hit('KeyQ'));
});

test('a keyup that cannot be told apart lets nothing walk for ever, and the next repeat brings back what is still down', () => {
  const k = new KeyState();
  k.down({ code: 'KeyW' });
  k.down({ code: 'KeyD' });
  assert.equal(k.up({ code: '', key: 'Process', keyCode: 229 }), null);
  assert.equal(k.isDown('KeyW') || k.isDown('KeyD'), false);
  k.down({ code: 'KeyD', repeat: true });
  assert.ok(k.isDown('KeyD'));
  k.releaseAll();
  assert.equal(k.isDown('KeyD'), false);
  k.hold('KeyS', true);
  assert.ok(k.isDown('KeyS'));
  k.hold('KeyS', false);
  assert.equal(k.isDown('KeyS'), false);
});
