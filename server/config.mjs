import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const defaultModel = 'nvidia/nemotron-3.5-lightning-30b-a3b';

function readEnv(path) {
  try {
    return parseEnv(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

export function loadConfig(environment = process.env, root = projectRoot) {
  const local = readEnv(resolve(root, '.env'));
  const sourcePath = environment.NVIDIA_ENV_FILE || local.NVIDIA_ENV_FILE;
  const source = sourcePath ? readEnv(resolve(root, sourcePath)) : {};
  return {
    apiKey: environment.NVIDIA_API_KEY || local.NVIDIA_API_KEY || source.NVIDIA_API_KEY || '',
    model: environment.NVIDIA_MODEL || local.NVIDIA_MODEL || defaultModel,
  };
}
