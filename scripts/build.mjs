import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPTS_DIR, '..');
const ENTRY = path.join(ROOT, 'entry.js');
const UI = path.join(ROOT, 'ui', 'jade.html');
const UI_TEMPLATE = path.join(ROOT, 'src', 'ui', 'jade.template.html');
const UI_MARKER = '<!-- yu-zhao-ui-script -->';

const DATA_MODULES = [
  ['core', 'Core / state model'],
  ['protocol', 'Protocol parsing'],
  ['i18n', 'Localization'],
  ['runtime', 'Runtime / persistence'],
  ['prompt', 'Prompt construction']
];

const UI_MODULES = [
  ['views/shared', 'UI views / shared helpers'],
  ['views/tablet', 'UI views / jade tablet'],
  ['views/messages', 'UI views / messages'],
  ['views/forms', 'UI views / player forms'],
  ['views/notes', 'UI views / notes'],
  ['views/forum', 'UI views / forum'],
  ['views/market', 'UI views / market'],
  ['views/space', 'UI views / pocket space'],
  ['views/map', 'UI views / map'],
  ['views/sync', 'UI views / sync detail'],
  ['views/manage', 'UI views / management'],
  ['views/page', 'UI views / page dispatch'],
  ['app/entry', 'UI app / entry state'],
  ['app/shell', 'UI app / shell and rendering'],
  ['app/state', 'UI app / transient state'],
  ['app/data-actions', 'UI app / data actions'],
  ['app/navigation', 'UI app / navigation'],
  ['app/overlay', 'UI app / overlay events'],
  ['app/messaging', 'UI app / messaging'],
  ['app/forms', 'UI app / forms'],
  ['app/fab', 'UI app / floating button'],
  ['app/dom-strip', 'UI app / DOM stripping'],
  ['app/hooks', 'UI app / hook handlers']
];

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

function buildUi() {
  const template = readFileSync(UI_TEMPLATE, 'utf8');
  if (!template.includes(UI_MARKER)) throw new Error('UI template marker is missing');
  const dataSections = DATA_MODULES.map(([name, label]) => `  /* ---------- ${label} ---------- */\n${readSource(`src/${name}.js`)}`);
  const uiSections = UI_MODULES.map(([name, label]) => `    /* ---------- ${label} ---------- */\n${readSource(`src/ui/${name}.js`)}`);
  const script = [
    '<script>',
    '(function () {',
    "  'use strict';",
    "  var host = typeof window !== 'undefined' ? window : globalThis;",
    '',
    dataSections.join('\n\n'),
    '',
    '  var shared = host.__YU_ZHAO__;',
    '  if (!shared || shared.__bridgeVersion !== 1) {',
    '    var uiResolve = null;',
    '    shared = {',
    '      __bridgeVersion: 1,',
    '      ready: false,',
    '      ui: null,',
    '      uiReady: new Promise(function (resolve) { uiResolve = resolve; }),',
    '      attachUI: function (app) {',
    '        if (shared.ui && shared.ui !== app && typeof shared.ui.dispose === \'function\') {',
    '          try { shared.ui.dispose(); } catch (_) {}',
    '        }',
    '        shared.ui = app;',
    '        shared.ready = true;',
    '        if (uiResolve) uiResolve(app);',
    '      }',
    '    };',
    '    host.__YU_ZHAO__ = shared;',
    '  }',
    '  shared.CORE = CORE;',
    '  shared.PROTOCOL = PROTOCOL;',
    '  shared.I18N = I18N;',
    '  shared.RUNTIME = RUNTIME;',
    '  shared.PROMPT = PROMPT;',
    '  shared.tr = tr;',
    '  shared.makeTranslator = makeTranslator;',
    '  shared.dbg = dbg;',
    '  shared.ready = true;',
    '  try {',
    "    if (typeof host.CustomEvent === 'function' && typeof host.dispatchEvent === 'function') host.dispatchEvent(new host.CustomEvent('yu-zhao-shared-ready'));",
    '  } catch (_) {}',
    '',
    '  function boot(shared) {',
    '    if (!shared) return;',
    '    var CORE = shared.CORE;',
    '    var PROTOCOL = shared.PROTOCOL;',
    '    var I18N = shared.I18N;',
    '    var RUNTIME = shared.RUNTIME;',
    '    var PROMPT = shared.PROMPT;',
    '    var tr = shared.tr;',
    '    var makeTranslator = shared.makeTranslator;',
    '    var dbg = shared.dbg;',
    '    var stableHash = CORE.stableHash;',
    '    var cleanText = CORE.cleanText;',
    '    var safeObject = CORE.safeObject;',
    '    var safeArray = CORE.safeArray;',
    '    var hasText = CORE.hasText;',
    '    var keyId = CORE.keyId;',
    '    var GROUP_ORDER = CORE.GROUP_ORDER;',
    '    var MAX_SNAPSHOT_BYTES = CORE.MAX_SNAPSHOT_BYTES;',
    '    var formatDateTime = CORE.formatDateTime;',
    '',
    uiSections.join('\n\n'),
    '',
    '    var app = APP.create({ tavo: tavo, document: document, window: window, runtime: RUNTIME });',
    '    shared.attachUI(app);',
    '    Promise.resolve(app.start()).catch(function (error) {',
    "      try { console.error('[Yu Zhao] UI start failed', error); } catch (_) {}",
    '    });',
    '  }',
    '',
    '  boot(shared);',
    '})();',
    '</script>'
  ].join('\n');
  return template.replace(UI_MARKER, () => script);
}

const generatedEntry = buildEntry();
const generatedUi = buildUi();
if (process.argv.includes('--check')) {
  const currentEntry = readFileSync(ENTRY, 'utf8');
  const currentUi = readFileSync(UI, 'utf8');
  if (currentEntry !== generatedEntry || currentUi !== generatedUi) {
    console.error('generated files are out of date; run node scripts/build.mjs');
    process.exitCode = 1;
  }
} else {
  writeFileSync(ENTRY, generatedEntry, 'utf8');
  writeFileSync(UI, generatedUi, 'utf8');
}
