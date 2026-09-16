/**
 * Run the tool-selection evals and print a report.
 *
 *   npm run evals                 the whole corpus
 *   npm run evals -- gap          only cases whose id starts with "gap"
 *   npm run evals -- --json       machine-readable, for CI
 *
 * Requires the MCP server running and AWS credentials with Bedrock access.
 */
import { writeFileSync } from 'node:fs';
import { runEvals, summarise, MEMBER_LABEL } from '../src/evals/run.ts';
import { providerFromEnv } from '../src/sim/providers.ts';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const filter = args.find((a) => !a.startsWith('--'));

const endpoint = process.env.CARECIRCLE_URL ?? 'http://localhost:8787/mcp';
const provider = providerFromEnv();
const modelId = provider.modelId;

// Free-tier planners are rate limited per minute, so pace by default and let it
// be overridden when the account has headroom.
const paceMs = Number(process.env.EVALS_PACE_MS ?? (provider.name === 'gemini' ? 6_000 : 0));

process.stdout.write(`Running ${filter ? `"${filter}" ` : ''}cases on ${provider.name}...`);
const results = await runEvals({
  endpoint, provider, paceMs,
  ...(filter ? { filter } : {}),
  onProgress: (done, total) => {
    process.stdout.write(`\rRunning on ${provider.name}: ${done}/${total}   `);
  },
});
process.stdout.write('\r' + ' '.repeat(50) + '\r');
const s = summarise(results);

if (asJson) {
  console.log(JSON.stringify({ modelId, ...s }, null, 2));
} else {
  console.log(`\nCareCircle tool selection · ${provider.name} · ${modelId}`);
  console.log(`${'─'.repeat(64)}`);
  if (s.accuracy === null) {
    console.log(`  No cases ran. ${s.errored} failed to reach the model.\n`);
    console.log(`  ${s.errors[0]?.reason ?? ''}\n`);
    process.exit(1);
  }
  console.log(`  ${s.passed}/${s.total} correct · ${(s.accuracy * 100).toFixed(1)}%`);
  if (s.errored > 0) {
    console.log(`  ${s.errored} case(s) never reached the model and are excluded.`);
  }
  console.log('');

  console.log('  By category');
  for (const c of [...s.byCategory].sort((a, b) => a.passed / a.total - b.passed / b.total)) {
    const bar = '█'.repeat(Math.round((c.passed / c.total) * 20)).padEnd(20, '·');
    console.log(`    ${c.category.padEnd(9)} ${bar} ${String(c.passed).padStart(2)}/${c.total}`);
  }

  if (s.failures.length > 0) {
    console.log(`\n  Failures (${s.failures.length}) — each one is a tool description to fix`);
    for (const f of s.failures) {
      console.log(`\n    ${f.case.id}  ${MEMBER_LABEL[f.case.member]}`);
      console.log(`    "${f.case.utterance}"`);
      console.log(`    → ${f.reason}`);
      if (f.case.note) console.log(`      (${f.case.note})`);
    }
  }
  console.log('');
}

writeFileSync('evals-results.json', JSON.stringify({
  provider: provider.name, modelId, at: new Date().toISOString(), ...s,
  results: results.map((r) => ({
    id: r.case.id, utterance: r.case.utterance, member: r.case.member,
    chosen: r.chosen, pass: r.pass, reason: r.reason,
  })),
}, null, 2));

process.exit(s.failures.length > 0 && process.env.EVALS_STRICT === '1' ? 1 : 0);
