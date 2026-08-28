import { readBenchmarkPack, readRecordedTrials, summarizeBenchmark } from '../../benchmark/index.js';
import type { CommonCliOptions } from '../options.js';

export async function runBenchmarkCommand(options: CommonCliOptions): Promise<number> {
  if (!options.fixture) {
    process.stderr.write('benchmark requires an explicit --fixture recorded trial file; no harness is executed implicitly\n');
    return 2;
  }
  const pack = await readBenchmarkPack(options.pack ?? 'benchmark-packs/default.json');
  const trials = await readRecordedTrials(options.fixture);
  const summary = summarizeBenchmark(pack, trials);
  if (options.format === 'json') process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  else {
    process.stdout.write(`Benchmark ${summary.packId}\n`);
    for (const scenario of summary.scenarios) process.stdout.write(`  ${scenario.id} ${scenario.status} ${scenario.adhered}/${scenario.sampleCount}${scenario.rate === undefined ? '' : ` ${(scenario.rate * 100).toFixed(1)}%`}\n`);
  }
  return 0;
}
