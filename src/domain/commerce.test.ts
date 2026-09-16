import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offerFor, offerSpoken, formatPrice } from './commerce.ts';

test('prices are deterministic and formatted for speech', () => {
  const offer = offerFor('prescription_refill', { offerId: 'off_1', itemName: 'heart pill' });
  assert.equal(offer.amountCents, 1200);
  assert.equal(formatPrice(offer.amountCents), '$12.00');
  assert.match(offer.item, /heart pill/);
  assert.equal(offer.simulated, true);
});

test('an offer names its Care Gap when given one', () => {
  const offer = offerFor('prescription_refill', { offerId: 'off_2', obligationId: 'ob_9' });
  assert.equal(offer.obligationId, 'ob_9');
});

test('the spoken line always says nothing is charged until confirmed', () => {
  const offer = offerFor('medical_ride', { offerId: 'off_3', whenText: 'Thursday at 10' });
  const spoken = offerSpoken(offer);
  assert.match(spoken, /\$28\.00/);
  assert.match(spoken, /confirm/i);
});
