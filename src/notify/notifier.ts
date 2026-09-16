import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

/**
 * Delivering a message to a member of the care circle.
 *
 * `notify_member` always records the message in the care log — that is the part
 * the family can rely on. Actually pushing it to a phone is a separate concern,
 * behind this interface, so the tool works identically whether or not a delivery
 * channel is configured. That matters: a caregiving system must not appear to have
 * told someone when it only wrote a note.
 */

export interface DeliveryResult {
  /** Whether the message left the system, as opposed to only being recorded. */
  delivered: boolean;
  /** How it went out, for the audit trail. */
  channel: 'none' | 'sns';
  detail?: string;
}

export interface Notifier {
  readonly channel: DeliveryResult['channel'];
  deliver(input: { to: string; toName: string; from: string; message: string }): Promise<DeliveryResult>;
}

/**
 * The default: record-only. The message is in the care log; nothing is pushed.
 * Honest about it — `delivered: false` — so callers never imply a phone buzzed.
 */
export class RecordOnlyNotifier implements Notifier {
  readonly channel = 'none' as const;
  async deliver(): Promise<DeliveryResult> {
    return { delivered: false, channel: 'none' };
  }
}

/**
 * Publishes to an SNS topic, so a real subscription (SMS, email, a push endpoint)
 * receives the message. One topic for the household; the recipient is carried as a
 * message attribute so a subscriber can filter to its own member.
 *
 * A delivery failure is reported, never thrown: the message is already safely in
 * the care record, and losing the push is not worth losing the turn.
 */
export class SnsNotifier implements Notifier {
  readonly channel = 'sns' as const;
  readonly #sns: SNSClient;
  readonly #topicArn: string;

  constructor(opts: { topicArn: string; region?: string; client?: SNSClient }) {
    this.#topicArn = opts.topicArn;
    this.#sns = opts.client ?? new SNSClient(opts.region ? { region: opts.region } : {});
  }

  async deliver(input: { to: string; toName: string; from: string; message: string }): Promise<DeliveryResult> {
    try {
      const result = await this.#sns.send(new PublishCommand({
        TopicArn: this.#topicArn,
        Subject: `CareCircle: a message from ${input.from}`,
        Message: `${input.from} for ${input.toName}:\n\n${input.message}`,
        MessageAttributes: {
          recipient: { DataType: 'String', StringValue: input.to },
        },
      }));
      return { delivered: true, channel: 'sns', ...(result.MessageId ? { detail: result.MessageId } : {}) };
    } catch (err) {
      return { delivered: false, channel: 'sns', detail: `delivery failed: ${(err as Error).message}` };
    }
  }
}

/** Pick a notifier from the environment: SNS when a topic is named, else record-only. */
export function notifierFromEnv(): Notifier {
  const topicArn = process.env['CARECIRCLE_SNS_TOPIC'];
  if (!topicArn) return new RecordOnlyNotifier();
  return new SnsNotifier({
    topicArn,
    ...(process.env['AWS_REGION'] ? { region: process.env['AWS_REGION'] } : {}),
  });
}
