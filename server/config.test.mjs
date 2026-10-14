// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { defaultModel, loadConfig } from './config.mjs';

const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    const target = resolve(directory);
    if (!target.startsWith(`${resolve(tmpdir())}${sep}mianmian-config-test-`)) throw new Error('Unexpected test directory');
    rmSync(target, { recursive: true, force: true });
  }
});

describe('local credential configuration', () => {
  it('reads only the key from the supplied env file without modifying it or inheriting K2.5', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mianmian-config-test-'));
    directories.push(directory);
    const source = 'NVIDIA_API_KEY=test-only-key\nAGENT_VISION_MODEL=moonshotai/kimi-k2.5\n';
    writeFileSync(join(directory, 'source.env'), source);
    writeFileSync(join(directory, '.env'), 'NVIDIA_ENV_FILE=source.env\n');
    expect(loadConfig({}, directory)).toEqual({ apiKey: 'test-only-key', model: defaultModel });
    expect(readFileSync(join(directory, 'source.env'), 'utf8')).toBe(source);
  });

  it('allows local model and credential overrides', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mianmian-config-test-'));
    directories.push(directory);
    writeFileSync(join(directory, '.env'), 'NVIDIA_API_KEY=local-test-key\nNVIDIA_MODEL=local-model\n');
    expect(loadConfig({}, directory)).toEqual({ apiKey: 'local-test-key', model: 'local-model' });
    expect(loadConfig({ NVIDIA_API_KEY: 'environment-test-key', NVIDIA_MODEL: 'environment-model' }, directory)).toEqual({ apiKey: 'environment-test-key', model: 'environment-model' });
  });
});
