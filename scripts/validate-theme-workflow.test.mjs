import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const yaml = readFileSync(join(repo, '.github/workflows/validate-theme.yml'), 'utf8');

// WHY: The shallow diff skipped this real validator for every prior PR, hiding
// broken inline Python. Execute the workflow's actual shell instead of a copy.
for (const name of ['Validate manifests', 'Reject fully-resolved theme-asset:// URIs in manifest', 'Check manifest asset references exist', 'Check asset sizes']) {
  test(`CI ${name} runs for Morning Rounds`, () => {
    const start = yaml.indexOf(`      - name: ${name}\n`);
    assert.notEqual(start, -1, `Missing CI step ${name}`);
    const run = yaml.indexOf('        run: |\n', start);
    assert.notEqual(run, -1, `Missing shell block in ${name}`);
    const end = yaml.indexOf('\n      - name:', run + 1);
    const block = yaml.slice(run + '        run: |\n'.length, end === -1 ? undefined : end);
    const script = block.split('\n').map((line) => line.startsWith('          ') ? line.slice(10) : line).join('\n')
      .replaceAll('${{ steps.changed.outputs.themes }}', 'morning-rounds');
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, `${name}: ${result.stdout}${result.stderr}`);
  });
}
