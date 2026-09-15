/**
 * Check whether Bedrock can actually serve inference before you depend on it.
 *
 *   npm run preflight
 *
 * Exits non-zero when inference is impossible, so it can gate CI or a deploy.
 */
import { diagnoseBedrock, describe } from '../src/sim/preflight.ts';

const region = process.env.AWS_REGION ?? 'us-east-1';
const modelId = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

console.log(`\nBedrock preflight · ${modelId} · ${region}`);
console.log('─'.repeat(70));

const diagnosis = await diagnoseBedrock({ region, modelId });
console.log(describe(diagnosis));

if (diagnosis.state === 'account_hold' || diagnosis.state === 'zero_quota') {
  console.log('\nApplied quotas:');
  for (const q of diagnosis.quotas) {
    console.log(`  ${q.code}  applied=${q.applied}  level=${q.appliedAtLevel ?? 'DEFAULT'}  ${q.name}`);
  }
  console.log('');
  process.exit(1);
}
console.log('');
