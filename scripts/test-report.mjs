#!/usr/bin/env node
/**
 * Runs the complete Vitest suite with the JSON reporter and turns the real
 * machine-readable result into a clean, human-readable TEST_REPORT.md.
 *
 * The report is generated only from actual test results; a missing or failed
 * run is reported honestly and the script exits with the runner's status.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const jsonPath = join(root, '.vitest-report.json');
const markdownPath = join(root, 'TEST_REPORT.md');
const vitestCli = join(root, 'node_modules', 'vitest', 'vitest.mjs');

if (!existsSync(vitestCli)) {
  console.error('Vitest is not installed. Run `npm install` first.');
  process.exit(1);
}

if (existsSync(jsonPath)) rmSync(jsonPath);

const started = Date.now();
const run = spawnSync(
  process.execPath,
  [vitestCli, 'run', '--reporter=json', '--outputFile', jsonPath],
  { cwd: root, stdio: 'inherit' },
);
const wallSeconds = ((Date.now() - started) / 1000).toFixed(2);

let report;
try {
  report = JSON.parse(readFileSync(jsonPath, 'utf8'));
} catch (error) {
  const message = [
    '# DownFlow test report',
    '',
    'The test run did not produce a readable Vitest JSON report.',
    '',
    `- Exit code: ${run.status ?? 'unknown'}`,
    `- Runner error: ${error instanceof Error ? error.message : String(error)}`,
    '',
    'Run `npm test` to reproduce the failure in the console.',
    '',
  ].join('\n');
  writeFileSync(markdownPath, message, 'utf8');
  console.error(message);
  process.exit(run.status ?? 1);
}

const suites = Array.isArray(report.testResults) ? report.testResults : [];
const total = report.numTotalTests ?? suites.reduce((sum, suite) => sum + (suite.assertionResults?.length ?? 0), 0);
const passed = report.numPassedTests ?? 0;
const failed = report.numFailedTests ?? 0;
const pending = report.numPendingTests ?? 0;
const allAssertions = suites.flatMap((suite) => suite.assertionResults ?? []);
const testDurationMs = allAssertions.reduce((sum, test) => sum + (test.duration ?? 0), 0);
const success = report.success === true && failed === 0;
const date = new Date(report.startTime ?? Date.now()).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
const nodeVersion = process.version;
const vitestVersion = JSON.parse(
  readFileSync(join(root, 'node_modules', 'vitest', 'package.json'), 'utf8'),
).version;
const normalizedRoot = root.replaceAll('\\', '/');
const displayPath = (value) =>
  String(value ?? 'unknown').replaceAll('\\', '/').replace(normalizedRoot, '').replace(/^\/+/, '');

const lines = [
  '# DownFlow automated test report',
  '',
  `Generated: ${date}`,
  '',
  'This report was generated from a real `vitest run --reporter=json` execution.',
  'It is not hand-written and no test results are simulated.',
  '',
  '## Environment',
  '',
  `- Node.js: ${nodeVersion}`,
  `- Vitest: ${vitestVersion}`,
  '- Browser APIs: Node `fetch`/`Blob` with a real local HTTP server, `fake-indexeddb`, and a stateful Chrome API mock',
  '',
  '## Summary',
  '',
  '| Metric | Result |',
  '| --- | --- |',
  `| Status | ${success ? 'PASS' : 'FAIL'} |`,
  `| Test files | ${suites.length} |`,
  `| Tests | ${total} |`,
  `| Passed | ${passed} |`,
  `| Failed | ${failed} |`,
  `| Skipped | ${pending} |`,
  `| Test time | ${(testDurationMs / 1000).toFixed(2)}s |`,
  `| Wall time | ${wallSeconds}s |`,
  '',
  '## Suites',
  '',
  '| Test file | Tests | Passed | Failed | Duration |',
  '| --- | ---: | ---: | ---: | ---: |',
];

for (const suite of suites) {
  const assertions = suite.assertionResults ?? [];
  const suitePassed = assertions.filter((test) => test.status === 'passed').length;
  const suiteFailed = assertions.filter((test) => test.status === 'failed').length;
  const suiteDuration =
    typeof suite.startTime === 'number' && typeof suite.endTime === 'number'
      ? (suite.endTime - suite.startTime) / 1000
      : assertions.reduce((sum, test) => sum + (test.duration ?? 0), 0) / 1000;
  const file = displayPath(suite.name ?? suite.testFilePath);
  lines.push(`| \`${file}\` | ${assertions.length} | ${suitePassed} | ${suiteFailed} | ${suiteDuration.toFixed(2)}s |`);
}

lines.push('', '## Test cases', '');

for (const suite of suites) {
  const file = displayPath(suite.name ?? suite.testFilePath);
  lines.push(`### ${file}`, '');
  for (const test of suite.assertionResults ?? []) {
    const icon = test.status === 'passed' ? 'PASS' : test.status === 'failed' ? 'FAIL' : 'SKIP';
    const name = test.fullName || test.title || '(unnamed test)';
    const time = typeof test.duration === 'number' ? ` (${test.duration} ms)` : '';
    lines.push(`- **${icon}** ${name}${time}`);
    for (const message of test.failureMessages ?? []) {
      lines.push('', '  ```text', ...String(message).split('\n').map((line) => `  ${line}`), '  ```', '');
    }
  }
  lines.push('');
}

lines.push(
  '## What is covered',
  '',
  '- Download metadata persistence, queue ordering, and interrupted-transfer recovery',
  '- HTTP Range probing, Content-Range validation, retry policy, and bandwidth limits',
  '- Real local HTTP segmented transfers: multi-segment assembly, resume, Range fallback, and safety limits',
  '- Chrome Downloads state mapping and the coordinator state machine (queue, pause, resume, cancel, remove)',
  '- Scheduler due-job selection plus background alarm scheduling',
  '- Filename/path safety, duplicate policies, categories, and MIME/extension detection',
  '- HLS/DASH manifest parsing and HLS segment assembly order',
  '- Statistics derived from stored download records and settings persistence',
  '',
  '## Not covered by automated tests',
  '',
  'These require a real Chrome installation and are listed in `docs/CHROME_VERIFICATION.md`:',
  '',
  '- Loading the unpacked extension, popup/side-panel rendering, and real Chrome UI interactions',
  '- Chrome-managed file writes, download prompts, and native download events',
  '- OPFS behavior under Chrome storage pressure and service-worker suspension',
  '- DRM-protected media rejection on live sites and site-specific interception behavior',
  '',
);

writeFileSync(markdownPath, lines.join('\n'), 'utf8');
if (existsSync(jsonPath)) rmSync(jsonPath);

console.log(`\nWrote ${markdownPath} (${passed}/${total} passed, ${failed} failed).`);
process.exit(success ? 0 : 1);
