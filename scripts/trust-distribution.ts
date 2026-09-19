/**
 * The trust benchmark, run many times, reported as a distribution.
 *
 * A single run of `npm run trust-benchmark` gives one number for a raw LLM's
 * behaviour - but that number is stochastic: the model is sampled, and the rate at
 * which it turns a silence into an accusation (or erases a source, or reaches for a
 * demeaning frame) varies run to run. A pitch that quotes one run's figure as if it
 * were a constant is overclaiming. This runs each dimension N times and reports the
 * real spread, so any number we cite is one we can stand behind.
 *
 *   npm run trust-distribution           # 5 runs
 *   npm run trust-distribution -- 10     # 10 runs
 *
 * The CareCircle side is deterministic and stays 0 across every run by construction;
 * what varies is only the raw model. Requires Bedrock access.
 */
import { accusationBenchmark, proxyBenchmark, dignityBenchmark, type BenchRates } from './trust-benchmark.ts';

const N = Math.max(1, Number(process.argv[2] ?? 5) | 0);

interface Dim { label: string; run: () => Promise<BenchRates>; }
const dims: Dim[] = [
  { label: 'accusation  (missing record -> "she missed it")', run: accusationBenchmark },
  { label: 'attribution (proxy record reported as own act) ', run: proxyBenchmark },
  { label: 'dignity     (disability framed as a verdict)    ', run: dignityBenchmark },
];

const pct = (x: number, n: number) => (n === 0 ? 0 : (x / n) * 100);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const fmt = (x: number) => x.toFixed(1);

async function main(): Promise<void> {
  console.log(`\nTrust benchmark distribution · ${N} runs · raw Bedrock vs CareCircle engine`);
  console.log('='.repeat(78));

  // Collected per dimension: the raw rate (%) each run, and CareCircle's rate each run.
  const rawRates: Record<string, number[]> = {};
  const ccRates: Record<string, number[]> = {};
  let n: Record<string, number> = {};

  for (let run = 1; run <= N; run++) {
    console.log(`\n\n############################  RUN ${run}/${N}  ############################`);
    for (const d of dims) {
      const r = await d.run();
      (rawRates[d.label] ??= []).push(pct(r.raw, r.n));
      (ccRates[d.label] ??= []).push(pct(r.cc, r.n));
      n[d.label] = r.n;
    }
  }

  console.log(`\n\n${'='.repeat(78)}`);
  console.log(`SUMMARY over ${N} runs  (raw model is sampled; CareCircle is deterministic)`);
  console.log('='.repeat(78));
  for (const d of dims) {
    const raw = rawRates[d.label]!;
    const cc = ccRates[d.label]!;
    const rawMin = Math.min(...raw), rawMax = Math.max(...raw);
    const rawMean = raw.reduce((a, b) => a + b, 0) / raw.length;
    const ccMax = Math.max(...cc);
    console.log(`\n${d.label}   (n=${n[d.label]} per run)`);
    console.log(`  RAW Bedrock : min ${fmt(rawMin)}%  median ${fmt(median(raw))}%  mean ${fmt(rawMean)}%  max ${fmt(rawMax)}%`);
    console.log(`  CareCircle  : ${ccMax === 0 ? '0.0% every run (structurally incapable)' : `up to ${fmt(ccMax)}% — INVESTIGATE`}`);
    console.log(`  per-run raw : [${raw.map(fmt).join(', ')}]`);
  }
  console.log('');
}

main().catch((err) => { console.error(err); process.exit(1); });
