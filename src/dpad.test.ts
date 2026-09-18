import { test } from 'node:test';
import assert from 'node:assert/strict';
import { START, keyOf, reduce, type Nav, type Key } from '../sim-ui/src/lib/dpad.ts';

const COUNTS = { gaps: 3, members: 4 };

/** Drive the reducer with a sequence of buttons, as a person holding a remote would. */
function press(keys: Key[], counts = COUNTS): { nav: Nav; claims: number } {
  let nav = START;
  let claims = 0;
  for (const k of keys) {
    const step = reduce(nav, k, counts);
    nav = step.nav;
    if (step.claim) claims++;
  }
  return { nav, claims };
}

test('the remote is the D-pad: Fire TV arrow keys and Enter map to buttons', () => {
  assert.equal(keyOf('ArrowLeft'), 'left');
  assert.equal(keyOf('ArrowRight'), 'right');
  assert.equal(keyOf('Enter'), 'ok');
  assert.equal(keyOf('a'), null);
});

test('Back arrives as Escape on some devices and Backspace on others', () => {
  // An unhandled Backspace navigates the WebView out of the app, so both must map.
  assert.equal(keyOf('Escape'), 'back');
  assert.equal(keyOf('Backspace'), 'back');
});

test('any button wakes the ambient clock into browsing', () => {
  for (const k of ['left', 'right', 'up', 'down', 'ok'] as Key[]) {
    assert.equal(press([k]).nav.mode, 'browsing', `${k} should wake the surface`);
  }
});

test('browsing wraps in both directions, because a TV list has no edges', () => {
  assert.equal(press(['right', 'left']).nav.gap, 2);       // wake, then back past 0
  assert.equal(press(['right', 'right', 'right', 'right']).nav.gap, 0);
});

test('OK never claims directly - it asks who is taking this on', () => {
  // A remote in a living room carries no identity. Claiming in someone's name
  // because they were nearest the remote is assumption-as-fact, which is the one
  // thing this system refuses to do.
  const { nav, claims } = press(['right', 'ok']);
  assert.equal(nav.mode, 'identifying');
  assert.equal(claims, 0);
});

test('a claim happens only after a person has been named', () => {
  const { nav, claims } = press(['right', 'ok', 'down', 'ok']);
  assert.equal(claims, 1);
  assert.equal(nav.member, 1);
  assert.equal(nav.mode, 'ambient', 'a television should go back to being a television');
});

test('every mode can be backed out of - nobody gets stranded', () => {
  let nav = START;
  const seen = new Set<string>();
  for (const k of ['right', 'ok'] as Key[]) { nav = reduce(nav, k, COUNTS).nav; seen.add(nav.mode); }
  assert.deepEqual([...seen].sort(), ['browsing', 'identifying']);

  nav = reduce(nav, 'back', COUNTS).nav;
  assert.equal(nav.mode, 'browsing');
  nav = reduce(nav, 'back', COUNTS).nav;
  assert.equal(nav.mode, 'ambient');
});

test('the focused gap survives a trip back to the clock', () => {
  // Otherwise glancing away and back re-reads the list from the top, which on a
  // screen across a room is worse than not having moved at all.
  const { nav } = press(['right', 'right', 'back']);
  assert.equal(nav.mode, 'ambient');
  assert.equal(nav.gap, 1);
});

test('an empty board stays ambient however hard the remote is pressed', () => {
  const empty = { gaps: 0, members: 4 };
  for (const k of ['left', 'right', 'ok', 'back'] as Key[]) {
    assert.equal(press([k], empty).nav.mode, 'ambient');
  }
});

test('a gap list that shrinks under the viewer never focuses past its end', () => {
  // The board polls every 4s: someone else can claim the focused gap mid-press.
  const nav: Nav = { mode: 'browsing', gap: 2, member: 0 };
  const step = reduce(nav, 'ok', { gaps: 1, members: 4 });
  assert.equal(step.nav.gap, 0);
});
