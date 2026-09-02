import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPTS_DIR, '..');
const ENTRY = path.join(ROOT, 'entry.js');

function readSource(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8').trimEnd();
}

function buildEntry() {
  return [
    '/* Yu Zhao — 修仙传讯法器，协议驱动，八大功能：玉牌/讯息/玉册/论坛/坊市/芥子空间/舆图/管理，i18n 走 tavo.plugin.i18n */',
    '/* Generated file. Edit src/ and run node scripts/build.mjs. */',
    '(function () {',
    "  'use strict';",
    '',
    '  /* ---------- Hook bridge ---------- */',
    readSource('src/entry-hooks.js'),
    '})();',
    ''
  ].join('\n');
}

const generatedEntry = buildEntry();
if (process.argv.includes('--check')) {
  const currentEntry = readFileSync(ENTRY, 'utf8');
  if (currentEntry !== generatedEntry) {
    console.error('generated file is out of date; run node scripts/build.mjs');
    process.exitCode = 1;
  }
} else {
  writeFileSync(ENTRY, generatedEntry, 'utf8');
}
