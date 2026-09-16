import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecordOnlyNotifier, SnsNotifier } from './notifier.ts';

test('record-only delivery is honest that nothing was pushed', async () => {
  const r = await new RecordOnlyNotifier().deliver({
    to: 'm_renee', toName: 'Renee', from: 'David', message: 'taking Mom Thursday',
  });
  assert.equal(r.delivered, false);
  assert.equal(r.channel, 'none');
});

test('SNS publishes with the recipient as a filterable attribute', async () => {
  let captured: any = null;
  const fakeClient = {
    send: async (cmd: any) => { captured = cmd.input; return { MessageId: 'mid-123' }; },
  };
  const r = await new SnsNotifier({
    topicArn: 'arn:aws:sns:us-east-1:1:carecircle', client: fakeClient as never,
  }).deliver({ to: 'm_renee', toName: 'Renee', from: 'David', message: 'taking Mom Thursday' });

  assert.equal(r.delivered, true);
  assert.equal(r.channel, 'sns');
  assert.equal(r.detail, 'mid-123');
  assert.equal(captured.TopicArn, 'arn:aws:sns:us-east-1:1:carecircle');
  assert.match(captured.Message, /David for Renee/);
  assert.match(captured.Message, /taking Mom Thursday/);
  // A subscriber must be able to filter to its own member.
  assert.equal(captured.MessageAttributes.recipient.StringValue, 'm_renee');
});

test('an SNS failure is reported, not thrown — the message is already recorded', async () => {
  const failing = { send: async () => { throw new Error('AccessDenied'); } };
  const r = await new SnsNotifier({
    topicArn: 'arn:aws:sns:us-east-1:1:carecircle', client: failing as never,
  }).deliver({ to: 'm_renee', toName: 'Renee', from: 'David', message: 'x' });

  assert.equal(r.delivered, false);
  assert.equal(r.channel, 'sns');
  assert.match(r.detail ?? '', /delivery failed: AccessDenied/);
});
