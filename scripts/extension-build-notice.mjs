import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const extensionDir = resolve('apps/extension/dist');
const legacyDir = resolve('dist');

console.log(`\nExtension ready: ${extensionDir}`);
console.log('Load or reload this directory in chrome://extensions.');

if (existsSync(resolve(legacyDir, 'manifest.json'))) {
  console.warn(
    `\nWarning: ${legacyDir} is a stale pre-workspace build. ` +
      'Chrome extensions still pointed there will not receive the current branding.',
  );
}
