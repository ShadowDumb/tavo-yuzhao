/*
 * 玉兆冒烟测试（node tests/smoke.mjs，无外部依赖）
 *
 * 覆盖面：Core 消毒/校验/应用、Protocol 解析/剥离、Prompt 注入与封印、
 * Runtime 状态机（去重/水化签名/切聊竞态/重建）、持久化队列与缓存淘汰、
 * Views 渲染、manifest 与 catalog 结构校验。
 *
 * 实现说明：entry.js 是自启动 IIFE，测试在其尾部 smoke-bootstrap 标记注释处截断源码，
 * 注入一段导出内部模块的代码后用 new Function 执行。标记与引导行绑定，
 * 若 entry.js 尾部结构变化，需同步更新 ANCHOR。
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// ---------- 断言工具 ----------
let passed = 0;
const failures = [];
function ok(cond, name) {
  if (cond) { passed += 1; return; }
  failures.push(name);
  console.error('  ✗ ' + name);
}
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; } else { failures.push(name); console.error(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}

// ---------- 加载插件内部模块 ----------
const ANCHOR = 'var app = APP.create(';
const source = read('entry.js');
const cut = source.indexOf(ANCHOR);
if (cut < 0) throw new Error('未找到 entry.js 的 smoke-bootstrap 标记，请同步更新 tests/smoke.mjs 的 ANCHOR');
const head = source.slice(0, cut);
// 截断点位于 IIFE 内部：probe 借助闭包导出内部模块，随后补回函数收尾。
const probe = head + `
  globalThis.__YZ_SMOKE__ = {
    CORE, PROTOCOL, PROMPT, VIEWS,
    createRuntime: RUNTIME.createRuntime,
    makeTranslator: makeTranslator,
    setTranslator: function (t) { TRANSLATE = t; },
    pickEnvelopePayload: APP.pickEnvelopePayload,
    stripEventFields: APP.stripEventFields,
    i18n: I18N,
    MAX_SNAPSHOT_BYTES: MAX_SNAPSHOT_BYTES,
    STATE_KEY: STATE_KEY,
    BACKUP_PREFIX: BACKUP_PREFIX,
    PLUGIN_VERSION: PLUGIN_VERSION
  };
})();
`;
new Function(probe)();
const M = globalThis.__YZ_SMOKE__;

// ---------- i18n：用真实 catalog 驱动翻译 ----------
const zhCatalog = JSON.parse(read(path.join('locales', 'zh-CN.json')));
const enCatalog = JSON.parse(read(path.join('locales', 'en.json')));

function translatorFor(catalog) {
  return function (key, params) {
    let out = Object.prototype.hasOwnProperty.call(catalog, key) ? catalog[key] : null;
    if (out == null) return key;
    if (params) {
      out = String(out).replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
    }
    return out;
  };
}
const zhT = translatorFor(zhCatalog);
const enT = translatorFor(enCatalog);

console.log('# i18n 字典');
for (const [name, catalog] of [['zh-CN', zhCatalog], ['en', enCatalog]]) {
  M.setTranslator(M.makeTranslator({ plugin: { i18n: { t: translatorFor(catalog) } } }));
  M.i18n.invalidate();
  const shell = M.VIEWS.renderShell(M.CORE.blankState('c'), {});
  ok(shell.includes(catalog['runtime.brand.title']), `${name} renderShell 品牌文案走 catalog`);
  ok(shell.includes('aria-label="' + catalog['runtime.appName'] + '"'), `${name} 对话框 aria-label 走 catalog`);
}

// ---------- manifest 与 catalog 结构 ----------
console.log('# manifest / catalog');
const manifest = JSON.parse(read('manifest.json'));
ok(manifest.specVersion === 2, 'specVersion 为 2');
ok(/^\d+\.\d+\.\d+$/.test(manifest.version), 'version 是合法 SemVer');
eq(manifest.permissions.slice().sort(), ['generate', 'message', 'variable'], 'permissions 仅含实际使用的能力');
ok(existsSync(path.join(ROOT, manifest.entry)), 'entry 文件存在');
ok(existsSync(path.join(ROOT, manifest.cover)), 'cover 文件存在');

const releaseKey = manifest.releaseNotes && manifest.releaseNotes.$t;
ok(!!releaseKey && zhCatalog[releaseKey] && enCatalog[releaseKey], 'releaseNotes 键在双语 catalog 中存在');
ok(Object.keys(zhCatalog).every((k) => !/^releaseNotes\./.test(k) || k === releaseKey), 'catalog 只保留当前版本 releaseNotes');

// P1：侧边栏动作声明
{
  const sideIds = (manifest.contributes.sidebar || []).map((x) => x.id);
  eq(sideIds, ['open-jade', 'resync-history'], 'sidebar 声明 open-jade 与 resync-history');
  (manifest.contributes.sidebar || []).forEach((entry) => {
    const key = entry.label && entry.label.$t;
    ok(!!key && zhCatalog[key] && enCatalog[key], `sidebar ${entry.id} label $t 键双语存在`);
    ok(zhCatalog[key].length <= 48 && enCatalog[key].length <= 48, `sidebar ${entry.id} label ≤ 48 字符`);
  });
}

// P2：同步范围设置已移除——diff 增量成为唯一常规路径，无配置面。
{
  const keys = (manifest.contributes.settings.schema || []).filter((f) => f.key).map((f) => f.key);
  ok(!keys.includes('sync_scope'), 'sync_scope 设置已移除（diff 增量无需配置）');
  eq(keys, ['enabled', 'auto_strip', 'lang'], 'settings 键集为 enabled/auto_strip/lang');
}

const $tKeys = [];
(function collect(node) {
  if (Array.isArray(node)) return node.forEach(collect);
  if (node && typeof node === 'object') {
    if (typeof node.$t === 'string') $tKeys.push(node.$t);
    Object.values(node).forEach(collect);
  }
})(manifest.contributes);
ok($tKeys.every((k) => zhCatalog[k] && enCatalog[k]), 'manifest 引用的 $t 键双语齐全 (' + $tKeys.length + ' 个)');

eq(Object.keys(zhCatalog).length, Object.keys(enCatalog).length, '双语 catalog 键数量一致');
eq(Object.keys(zhCatalog).sort(), Object.keys(enCatalog).sort(), '双语 catalog 键集合一致');
ok(zhCatalog['settings.info'].length <= 500 && enCatalog['settings.info'].length <= 500, 'settings.info ≤ 500 字符');
ok(zhCatalog['plugin.description'].length >= 200 && enCatalog['plugin.description'].length >= 200, 'description ≥ 200 字符');
ok(['actions.openJade'].every((k) => zhCatalog[k].length <= 48 && enCatalog[k].length <= 48), '动作 label ≤ 48 字符');

// 回归保护：FAB 默认位置与复位必须共用常量，不允许再出现硬编码 64px 复位。
ok(/var FAB_MARGIN_BOTTOM = 96;/.test(source) && !/innerHeight - height - 64\)/.test(source), 'FAB 默认/复位位置共用常量（96px）');
ok(/var Z_INDEX_TOP = 2147483646;/.test(source) && !/z-index:\s*2147483647/.test(source), 'z-index 单档 2147483646 常量，保留最大档余量');
ok(/fab\.hidden = !enabled\(\) \|\| !chatActive;/.test(source), 'FAB 显隐受 enabled + chatActive 双重门控');
// 回归保护：拖拽跟手——触摸不被滚动劫持 + 手势中禁用位置过渡（否则按钮滞后于指针）。
ok(/#yz1-fab\{[^}]*touch-action:none/.test(source), 'FAB 声明 touch-action:none，触摸拖拽不被页面滚动劫持');
ok(/#yz1-fab\.dragging\{transition:none\}/.test(source), 'FAB 拖拽中禁用位置过渡动画');
// 回归保护：图标与点击反馈——玉璧 SVG、禁用方形触摸高亮、按压为圆形缩放。
ok(/id="yzJadeFace"/.test(source) && source.includes('fab.innerHTML = FAB_ICON'), 'FAB 图标为玉璧 SVG（FAB_ICON 常量）');
ok(/#yz1-fab\{[^}]*-webkit-tap-highlight-color:transparent/.test(source), 'FAB 禁用系统方形触摸高亮');
ok(/#yz1-fab:active\{transform:scale\(/.test(source), 'FAB 按压反馈为圆形缩放');
ok(/!enabled\(\) \|\| !autoStrip\(\)/.test(source), '正文剥离有 enabled 门控');
// 回归保护：generation:success 内剥离必须先于快照应用（防 5 秒预算超时丢弃剥离结果）。
const successHandler = source.slice(source.indexOf("plugin.on('generation:success'"), source.indexOf('rebuildTimer = 0'));
ok(successHandler.indexOf('stripEventFields(event)') >= 0 && successHandler.indexOf('stripEventFields(event)') < successHandler.indexOf('applyText('), 'success 先同步剥离再应用快照');

// ---------- Core ----------
console.log('# Core 消毒与状态规范化');
{
  const dirty = { a: '__proto__', __proto__: { x: 1 }, constructor: 'bad', nested: { deep: { deeper: 'v' } }, arr: Array(150).fill(1) };
  const clean = M.CORE.sanitize(dirty);
  ok(!('__proto__' in clean) && clean.a !== undefined, '危险键被过滤');
  ok(clean.nested.deep.deeper === 'v', '正常嵌套字段保留');
  eq(clean.arr.length, 100, '数组限长 100');

  const state = M.CORE.normalizeState(JSON.parse('{"tablet":{"name":"李逍遥"},"sync":{"status":"complete"},"processedTurns":["t1","t2"]}'), 'chat-9');
  eq(state.tablet.name, '李逍遥', 'normalizeState 保留合法数据');
  eq(state.chatId, 'chat-9', 'chatId 归一');
  eq(state.processedTurns.length, 2, 'processedTurns 迁移');
}

// ---------- Protocol ----------
console.log('# Protocol 解析');
const FULL_JADE = [
  '<yz_jade>',
  '<yz_meta>',
  'turn｜turn-a1｜李逍遥｜初到青云山｜full',
  '</yz_meta>',
  '<yz_tablet>',
  'field｜基本｜名字｜李逍遥',
  'field｜基本｜性别｜男',
  'field｜基本｜身高｜175cm',
  'field｜基本｜体重｜60kg',
  'field｜仪容｜外貌｜眉目清朗',
  'field｜仪容｜穿着｜青色道袍',
  'field｜修为｜灵根｜天灵根',
  'field｜修为｜体质｜凡体',
  'field｜修为｜境界｜炼气三层',
  'field｜修为｜状态｜良好',
  'field｜隐秘｜身世｜青云宗弃徒',
  '</yz_tablet>',
  '<yz_market>',
  'listing｜l1｜回春丹｜上品｜疗伤圣药｜五十灵石｜药阁',
  'auction｜a1｜古剑｜灵器｜上古遗物｜一百灵石｜二百灵石｜三日｜12',
  'order｜o1｜剑穗｜已拍下｜十灵石｜今日｜买｜附言备注',
  '</yz_market>',
  '</yz_jade>'
].join('\n');

{
  const snap = M.PROTOCOL.parse(FULL_JADE);
  ok(!!snap, '完整协议块可解析');
  eq(snap.turn.id, 'turn-a1', 'meta turn id 解析');
  eq(snap.tablet.name, '李逍遥', '玉牌名字提取');
  eq(snap.market.orders[0].side, '买｜附言备注', '竖线溢出字段合并进末列');
  eq(snap.market.listings[0].price, '五十灵石', '行情价格解析');

  const fenced = '```json\n' + FULL_JADE + '\n```';
  ok(M.PROTOCOL.extractSnapshots(fenced).length >= 1, '代码块包裹的协议块可解析');

  const unclosed = '<yz_jade><yz_meta>\nturn｜turn-u1｜仙｜无闭合标签｜full\n';
  const unclosedSnap = M.PROTOCOL.extractSnapshots(unclosed);
  ok(unclosedSnap.length === 1 && unclosedSnap[0].turn.id === 'turn-u1', '未闭合协议块按宽松模式解析');

  ok(M.PROTOCOL.parse('普通剧情文本，没有协议。') === null, '无协议文本返回 null');

  eq(M.PROTOCOL.stripStreamTail('他握紧了剑<yz_'), '他握紧了剑', '流式半截标签剥离');
  eq(M.PROTOCOL.stripStreamTail('他握紧了剑<y'), '他握紧了剑', '流式 <y 剥离');
  eq(M.PROTOCOL.stripStreamTail('他握紧了剑<'), '他握紧了剑', '流式孤立 < 剥离');
  eq(M.PROTOCOL.stripStreamTail('他握紧了剑，纵身而上。'), '他握紧了剑，纵身而上。', '普通正文不受影响');

  const stripped = M.PROTOCOL.stripBlocks('剧情正文。\n' + FULL_JADE + '\n尾随文字。');
  ok(stripped.startsWith('剧情正文。') && stripped.endsWith('尾随文字。') && !stripped.includes('<yz_jade>'), 'stripBlocks 移除完整协议块');

  const ev = { text: '剧情。\n<yz_jade><yz_meta>\nturn｜x｜r｜s｜full\n</yz_meta></yz_jade>' };
  M.stripEventFields(ev);
  eq(ev.text, '剧情。', 'success 事件正文剥离');

  const evEmpty = { text: '<yz_jade><yz_meta>\nturn｜x｜r｜s｜full\n</yz_meta></yz_jade>' };
  M.stripEventFields(evEmpty);
  ok(evEmpty.text === zhCatalog['runtime.stripFallback'] || evEmpty.text.length > 0, '剥离后为空时回填非空占位');
}

// ---------- Prompt ----------
console.log('# Prompt 注入与封印');
{
  const allIds = ['tablet', 'msg', 'forum', 'notes', 'market', 'space', 'map'];
  const full = M.PROMPT.buildPrompt('zh', {});
  allIds.forEach((id) => ok(full.includes('<yz_' + ({ tablet: 'tablet', msg: 'msg', forum: 'forum', notes: 'notes', market: 'market', space: 'space', map: 'map' })[id] + '>'), '提示词包含区块 yz_' + id));
  ok(full.includes('<yz_jade>') && full.includes('</yz_jade>'), '提示词包含信封开合');

  const sealed = M.PROMPT.buildPrompt('zh', { forum: false, msg: false });
  ok(!sealed.includes('<yz_forum>'), '封印 forum 不注入其区块');
  ok(!sealed.includes('<yz_msg>'), '封印 msg 不注入其区块');
  ok(sealed.includes('<yz_tablet>'), '未封印区块仍注入');

  const en = M.PROMPT.buildPrompt('en', {});
  ok(en.includes('[Yu Zhao') && !full.includes('[Yu Zhao'), '提示词语言由 lang 决定');
  ok(full.includes('self 或 other'), 'zh 提示词约束方向字段固定取值');
  ok(en.includes('exactly self or other'), 'en 提示词约束方向字段固定取值');
  ok(full.includes('时间字段一律使用绝对日期') && full.includes('禁止 今日/昨日'), 'zh 提示词强制绝对日期、禁相对时间');
  ok(en.includes('must be absolute dates') && en.includes('relative words like 今日/昨日'), 'en 提示词强制绝对日期、禁相对时间');
  ok(full.includes('绝对时间如丙午年五月十二午时'), 'zh msg/gmsg 行模板示例绝对日期');
  ok(en.includes('absolute date like 丙午年五月十二午时'), 'en msg/gmsg 行模板示例绝对日期');
  ok(full.includes('时间字段一律写绝对日期'), 'zh 交流讯息约束强调绝对日期（归档召回上下文）');
  ok(en.includes('time fields must be absolute dates'), 'en 交流讯息约束强调绝对日期（归档召回上下文）');

  const event = { text: '前情正文。\n<yz_jade><yz_meta>\nturn｜old｜r｜旧块｜full\n</yz_meta></yz_jade>' };
  M.PROMPT.mutatePrepareEvent(event, 'zh', {});
  ok(event.text.startsWith('前情正文。'), 'prepare 先剥离上一轮残留协议块');
  ok(!event.text.includes('turn｜old'), 'prepare 不保留旧信封内容');
  ok(event.text.includes('【修仙传讯法器') && event.text.includes('</yz_jade>'), 'prepare 追加新提示词');
}

// ---------- Runtime 状态机 ----------
console.log('# Runtime 状态机');

function fakeHost() {
  const current = { chat: 'chat-1', lorebooks: [] };
  const chatScope = new Map(); // chatId -> Map(key -> value)，模拟宿主按当前聊天隔离的 chat 存储
  const globalScope = new Map();
  let history = [];
  let findCalls = 0;
  let setCalls = 0;
  const queriedRoles = [];
  const lorebooks = new Map(); // id -> {id, name, entries}
  let loreSeq = 0;
  const chatUpdates = [];
  return {
    current,
    setHistory(rows) { history = rows; },
    history() { return history.slice(); },
    findCalls() { return findCalls; },
    setCalls() { return setCalls; },
    rolesQueried() { return queriedRoles.slice(); },
    chatKeys() { return Array.from((chatScope.get(current.chat) || new Map()).keys()); },
    seedChat(key, value) { if (!chatScope.has(current.chat)) chatScope.set(current.chat, new Map()); chatScope.get(current.chat).set(key, value); },
    seedGlobal(key, value) { globalScope.set(key, value); },
    clearChat() { chatScope.delete(current.chat); },
    clearGlobal() { globalScope.clear(); },
    lorebooks() { return Array.from(lorebooks.values()); },
    chatUpdates() { return chatUpdates.slice(); },
    api: {
      get(key, scope) {
        if (scope === 'global') return globalScope.get(key) ?? null;
        return (chatScope.get(current.chat) || new Map()).get(key) ?? null;
      },
      set(key, value, scope) {
        setCalls += 1;
        if (scope === 'global') { globalScope.set(key, value); return; }
        if (!chatScope.has(current.chat)) chatScope.set(current.chat, new Map());
        chatScope.get(current.chat).set(key, value);
      },
      chat: {
        current: async () => ({ id: current.chat, lorebooks: (current.lorebooks || []).map((id) => ({ id })) }),
        update: async (patch) => {
          chatUpdates.push(patch);
          if (patch && Array.isArray(patch.lorebooks)) current.lorebooks = patch.lorebooks.slice();
        }
      },
      message: {
        find: async (_query, filter) => {
          findCalls += 1;
          const role = filter && filter.role;
          queriedRoles.push(role ?? null);
          return role ? history.filter((m) => m.role === role) : history.slice();
        }
      },
      lorebook: {
        find: async (name) => Array.from(lorebooks.values()).filter((b) => b.name === name),
        create: async (book) => {
          loreSeq += 1;
          const id = loreSeq;
          lorebooks.set(id, { id, name: book.name, entries: (book && book.entries) || [] });
          return id;
        },
        update: async (book) => {
          const b = lorebooks.get(book.id);
          if (!b) return null;
          b.name = book.name;
          b.entries = (book && book.entries) || [];
          return b;
        }
      }
    }
  };
}

function jade(turnId, extraSections) {
  return '<yz_jade><yz_meta>\nturn｜' + turnId + '｜李逍遥｜同步\n</yz_meta>' + (extraSections || '') + '</yz_jade>';
}
const TABLET_OK = '<yz_tablet>\nfield｜基本｜名字｜李逍遥\nfield｜基本｜性别｜男\nfield｜基本｜身高｜175cm\nfield｜基本｜体重｜60kg\nfield｜仪容｜外貌｜清朗\nfield｜仪容｜穿着｜道袍\nfield｜修为｜灵根｜天灵根\nfield｜修为｜体质｜凡体\nfield｜修为｜境界｜炼气\nfield｜修为｜状态｜佳\nfield｜隐秘｜身世｜弃徒\n</yz_tablet>';
const MSG_MIN = '<yz_msg>\ncontact｜c1｜林月如｜道侣｜今日｜0｜安好\ncontact｜c2｜酒剑仙｜师尊｜今日｜2｜饮酒\nmsg｜c1｜m1｜other｜昨日｜勿念\nmsg｜c1｜m2｜self｜今日｜定当赴约\nmsg｜c2｜m3｜other｜今日｜来喝酒\nmsg｜c2｜m4｜other｜今日｜速来\ngroup｜g1｜青云内门｜30｜今日｜5｜集合\nmsg占位忽略\ngmsg｜g1｜gm1｜掌门｜other｜今日｜卯时议事\ngmsg｜g1｜gm2｜长老｜other｜今日｜不得迟到\n</yz_msg>';
const MSG_ARCH = '<yz_msg>\ncontact｜c1｜林月如｜道侣｜今日｜0｜安好\ncontact｜c2｜酒剑仙｜师尊｜今日｜2｜饮酒\nmsg｜c1｜m1｜other｜昨日｜勿念\nmsg｜c1｜m2｜other｜昨日｜别忘\nmsg｜c1｜m3｜other｜昨日｜三事\nmsg｜c1｜m4｜self｜今日｜四时练剑\nmsg｜c1｜m5｜other｜今日｜五更同行\nmsg｜c1｜m6｜self｜今日｜六合归一\nmsg｜c1｜m7｜other｜今日｜七窍玲珑\nmsg｜c1｜m8｜other｜今日｜八荒来朝\nmsg｜c2｜x1｜other｜今日｜喝酒\nmsg｜c2｜x2｜other｜今日｜速来\ngroup｜g1｜青云内门｜30｜今日｜5｜集合\ngmsg｜g1｜gm1｜掌门｜other｜今日｜卯时议事\ngmsg｜g1｜gm2｜长老｜other｜今日｜排班\ngmsg｜g1｜gm3｜弟子｜other｜今日｜报到\ngmsg｜g1｜gm4｜长老｜other｜今日｜巡山\ngmsg｜g1｜gm5｜掌门｜other｜今日｜传令\ngmsg｜g1｜gm6｜弟子｜other｜今日｜收到\ngmsg｜g1｜gm7｜长老｜other｜今日｜守夜\ngmsg｜g1｜gm8｜掌门｜other｜今日｜明晨集合\n</yz_msg>';

// P2 矩阵共用夹具：直接构造对象快照，供 CORE.applySnapshot / buildCurrent 使用
const TABLET_OBJ = {
  name: '李逍遥',
  groups: [
    { id: 'basic', fields: [{ key: '名字', value: '李逍遥' }, { key: '性别', value: '男' }, { key: '身高', value: '175cm' }, { key: '体重', value: '60kg' }] },
    { id: 'look', fields: [{ key: '外貌', value: '清朗' }, { key: '穿着', value: '道袍' }] },
    { id: 'cult', fields: [{ key: '灵根', value: '天灵根' }, { key: '体质', value: '凡体' }, { key: '境界', value: '炼气三层' }, { key: '状态', value: '良好' }] },
    { id: 'secret', fields: [{ key: '身世', value: '青云宗弃徒' }] }
  ]
};
const MSG_OBJ = {
  contacts: [
    { id: 'c1', name: '林月如', relation: '道侣', time: '今日', unread: 0, preview: '安好', messages: [{ id: 'm1', side: 'other', time: '昨日', text: '勿念' }, { id: 'm2', side: 'self', time: '今日', text: '定当赴约' }] },
    { id: 'c2', name: '酒剑仙', relation: '师尊', time: '今日', unread: 0, preview: '饮酒', messages: [{ id: 'm3', side: 'other', time: '今日', text: '来喝酒' }, { id: 'm4', side: 'other', time: '今日', text: '速来' }] }
  ],
  groups: [
    { id: 'g1', name: '青云内门', members: 30, time: '今日', unread: 5, preview: '集合', messages: [{ id: 'gm1', sender: '掌门', side: 'other', time: '今日', text: '卯时议事' }, { id: 'gm2', sender: '长老', side: 'other', time: '今日', text: '不得迟到' }] }
  ]
};
function snapOf(turnId, mode, sections, extra) {
  return Object.assign(
    { version: 1, turn: { id: turnId, roleName: '李逍遥', summary: '增量摘要', mode: mode } },
    sections || {},
    extra || {}
  );
}

async function runtimeCase() {
  const host = fakeHost();
  const flags = {};
  const rt = M.createRuntime(host.api, null, () => flags);

  await rt.switchChat('chat-1');
  eq(rt.activeChatId, 'chat-1', 'switchChat 设置活跃聊天');
  eq(rt.current().revision, 0, '空白聊天初始 revision 0');

  // 全量快照应用
  const r1 = await rt.applyText(jade('t1', TABLET_OK + MSG_MIN), 'chat-1', 'test');
  ok(r1.changed === true, '有效快照应用成功');
  ok(rt.current().sync.status === 'partial', '仅 tablet/msg 达标时状态 partial');
  ok(rt.current().tablet.name === '李逍遥', '玉牌写入状态');

  // 同一轮重复投递（同 turnId 同内容，双通道场景）→ 去重
  const revBefore = rt.current().revision;
  const r2 = await rt.applyText(jade('t1', TABLET_OK + MSG_MIN), 'chat-1', 'test');
  ok(r2.changed !== true && rt.current().revision === revBefore, '同 turnId 同内容不重复计 revision');
  ok(rt.current().tablet.name === '李逍遥', '重复轮次不破坏已有数据');

  // 超大数据拒收：10 个联系人 × 每人 20 条 2500 字消息 ≈ 500KB，超过 200KB 上限
  const longText = '字'.repeat(2500);
  const rows = [];
  for (let c = 0; c < 10; c += 1) {
    rows.push('contact｜c' + c + '｜道友' + c + '｜故人｜今日｜0｜…');
    for (let m = 0; m < 20; m += 1) rows.push('msg｜c' + c + '｜m' + c + '-' + m + '|other｜今日｜' + longText);
  }
  const bigText = jade('t-big', '<yz_msg>\n' + rows.join('\n') + '\n</yz_msg>');
  const rBig = await rt.applyText(bigText, 'chat-1', 'test');
  eq(rBig.oversized, true, '超容量快照拒收并标记 oversized');
  eq(rt.current().revision, revBefore, '拒收不改写状态');

  // 解析失败标记
  const badText = '剧情<yz_weird_block>残缺';
  await rt.applyText(badText, 'chat-1', 'test');
  eq(rt.current().sync.lastError, 'parse-error', '疑似协议但解析失败时记录 lastError');

  // 重新生成：模型复用同一 turnId 但内容已变 → 必须应用，不能被去重误杀
  const regenText = jade('t1', TABLET_OK.replace('名字｜李逍遥', '名字｜赵灵儿') + MSG_MIN);
  const r3 = await rt.applyText(regenText, 'chat-1', 'regen');
  ok(r3.changed === true, '同 turnId 新内容按重新生成应用');
  ok(rt.current().tablet.name === '赵灵儿', '重新生成轮更新玉牌数据');
  const r4 = await rt.applyText(regenText, 'chat-1', 'message');
  ok(r4.changed !== true, '同 turnId 同内容双通道投递仍去重');

  // 水化签名：历史不变 → 不重复应用；新增楼层 → 增量应用
  host.setHistory([{ id: 'm1', role: 'assistant', content: jade('h1', TABLET_OK) }]);
  await rt.switchChat('chat-1');
  const callsAfterFirst = host.findCalls();
  const revAfterHydrate = rt.current().revision;
  await rt.switchChat('chat-1'); // 历史未变，第二次开聊
  ok(rt.current().hydration && rt.current().hydration.sig, '水化签名已记录');
  await rt.switchChat('chat-1');
  eq(rt.current().revision, revAfterHydrate, '历史未变时不重复水化应用');
  host.setHistory(host.history().concat([{ id: 'm2', role: 'assistant', content: jade('h2', MSG_MIN) }]));
  await rt.switchChat('chat-1');
  ok(rt.current().revision > revAfterHydrate, '新楼层到达后增量应用');
  void callsAfterFirst;

  // 封印：被 seal 的功能既不判定也不应用
  flags.msg = false;
  flags.forum = false;
  const sealedText = jade('t-seal', MSG_MIN + '<yz_forum>\npost｜p1｜作者｜散修｜闲聊｜今日｜标题|正文|1\ncomment｜p1｜路人｜今日｜顶\n</yz_forum>');
  const rSeal = await rt.applyText(sealedText, 'chat-1', 'test');
  const sealedApplied = rSeal.assessment && rSeal.assessment.applied || [];
  ok(!sealedApplied.includes('msg') && !sealedApplied.includes('forum'), '封印功能的数据不被应用');
  ok(!rt.current().sync.issues.some((i) => i.path === 'msg.contacts' || i.path === 'forum.posts'), '封印功能不参与完整性判定');
  delete flags.msg;
  delete flags.forum;

  // 切聊竞态：连续切换，最终以最后一次为准
  const pA = rt.switchChat('chat-a');
  const pB = rt.switchChat('chat-b');
  await Promise.all([pA, pB]);
  eq(rt.activeChatId, 'chat-b', '并发切聊以最后一次为准');

  // 内存版本保护：load 完成前的写入不被持久化旧值覆盖
  host.current.chat = 'chat-c';
  const switching = rt.switchChat('chat-c');
  await rt.applyText(jade('t-live', TABLET_OK), 'chat-c', 'test');
  await switching;
  ok(rt.current().revision >= 1, '切聊期间落地的写入得以保留');

  // 从历史重建（消息删除场景）
  host.current.chat = 'chat-1';
  host.setHistory([{ id: 'm1', role: 'assistant', content: jade('h1', TABLET_OK) }]);
  await rt.switchChat('chat-1');
  await rt.rebuildFromHistory('chat-1');
  ok(rt.current().processedTurns.indexOf('t-live') < 0, '重建后仅剩历史中的轮次');
  eq(rt.current().tablet.name, '李逍遥', '重建恢复历史数据');
}
await runtimeCase();

// 历史无协议块（正文剥离后）的重建：保留现有数据，不复位不清空
console.log('# Runtime · 无协议历史重建保护');
{
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-1');
  await rt.applyText(jade('k1', TABLET_OK + MSG_MIN), 'chat-1', 'generation:success');
  eq(rt.current().revision, 1, '同步一轮基线');
  host.setHistory([{ id: 'm1', role: 'assistant', content: '仅正文，协议块已被剥离。' }]);
  await rt.rebuildFromHistory('chat-1');
  eq(rt.current().revision, 1, '无协议历史重建不清空数据');
  eq(rt.current().tablet.name, '李逍遥', '重建后玉牌数据保留');
  eq(rt.current().chats.contacts.length, 2, '重建后联系人保留');
  const sig = rt.current().hydration && rt.current().hydration.sig;
  ok(!!sig, '保留数据同步水化签名（后续跳过重复扫描）');
  await rt.rebuildFromHistory('chat-1');
  eq(rt.current().revision, 1, '再次重建同样保留');
  // 空白聊天 + 无协议历史：保持空白（不产生假数据）
  const host2 = fakeHost();
  const rt2 = M.createRuntime(host2.api, null, () => ({}));
  await rt2.switchChat('chat-1');
  host2.setHistory([{ id: 'm2', role: 'assistant', content: '没有协议块。' }]);
  await rt2.rebuildFromHistory('chat-1');
  eq(rt2.current().revision, 0, '空白聊天重建后仍空白');
}

// ---------- 重新生成/继续竞态：settle 与空白占位 ----------
console.log('# Runtime · 重载后重新生成竞态');
{
  // 种子：写入持久化状态
  const host = fakeHost();
  const seed = M.createRuntime(host.api, null, () => ({}));
  await seed.switchChat('chat-1');
  await seed.applyText(jade('s1', TABLET_OK), 'chat-1', 'test');
  await seed.saveChat('chat-1');

  let delay = 0;
  const slowApi = {
    get: async (key, scope) => { await new Promise((r) => setTimeout(r, delay)); return host.api.get(key, scope); },
    set: (key, value, scope) => host.api.set(key, value, scope),
    chat: host.api.chat,
    message: host.api.message
  };

  // settle：prepare 注入基线前等到异步加载完成，不再读到空白态
  const rt = M.createRuntime(slowApi, null, () => ({}));
  delay = 25;
  const switching = rt.switchChat('chat-1');
  await rt.settle();
  ok(rt.current().tablet.name === '李逍遥', 'settle 等到异步加载完成，注入前能读到持久化数据');
  await switching;

  // 空白占位：加载窗口内仅读过 current()（未写入过数据）→ 持久化状态不被顶掉
  const rt2 = M.createRuntime(slowApi, null, () => ({}));
  const switching2 = rt2.switchChat('chat-1');
  rt2.current(); // 模拟旧版同步 prepare 在窗口内读了内存（创建空白占位）
  await switching2;
  ok(rt2.current().tablet.name === '李逍遥', '空白占位不丢弃持久化状态');

  // 真正写入过的内存态（窗口内应用了快照）仍优先于旧持久化版本
  const rt3 = M.createRuntime(slowApi, null, () => ({}));
  const switching3 = rt3.switchChat('chat-1');
  await rt3.applyText(jade('s2', TABLET_OK.replace('名字｜李逍遥', '名字｜赵灵儿')), 'chat-1', 'test');
  await switching3;
  ok(rt3.current().tablet.name === '赵灵儿', '窗口内写入的新数据不被旧持久化状态覆盖');
}

// ---------- Runtime 持久化与缓存 ----------
console.log('# Runtime 持久化与缓存');
const flushQueue = () => new Promise((resolve) => setTimeout(resolve, 0));
{
  // 后台落盘队列：applyText 返回即完成内存更新，清空微任务后本地与宿主均已写入
  const host = fakeHost();
  host.current.chat = 'chat-save';
  const store = new Map();
  const local = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); }
  };
  const rt = M.createRuntime(host.api, local, () => ({}));
  await rt.switchChat('chat-save');
  await rt.applyText(jade('t-save', TABLET_OK), 'chat-save', 'test');
  eq(rt.current().revision, 1, 'applyText 同步更新内存态，不等落盘');
  await flushQueue();
  ok(store.has(rt.LOCAL_PREFIX + 'chat-save'), '后台队列把状态写入本地镜像');
  ok(host.chatKeys().includes(M.STATE_KEY), '活跃聊天同步写宿主存储');

  // 单向镜像规则：host 读成功即回写本地
  const host2 = fakeHost();
  const store2 = new Map();
  host2.api.set(M.STATE_KEY, JSON.stringify({ revision: 3 }), 'chat');
  const rt2 = M.createRuntime(host2.api, {
    getItem: () => null,
    setItem: (k, v) => { store2.set(k, String(v)); }
  }, () => ({}));
  await rt2.switchChat('chat-1');
  eq(rt2.current().revision, 3, '宿主存储中的状态可加载');
  ok(store2.has(rt2.LOCAL_PREFIX + 'chat-1'), 'host 读成功时回写本地镜像');

  // 重复投递轮次不再触发落盘
  const host3 = fakeHost();
  host3.current.chat = 'chat-dup';
  const rt3 = M.createRuntime(host3.api, null, () => ({}));
  await rt3.switchChat('chat-dup');
  await rt3.applyText(jade('t-dup', TABLET_OK), 'chat-dup', 'test');
  await flushQueue();
  const savesAfterFirst = host3.setCalls();
  await rt3.applyText(jade('t-dup', TABLET_OK), 'chat-dup', 'test');
  await flushQueue();
  eq(host3.setCalls(), savesAfterFirst, '重复轮次不重复写宿主存储');

  // 宿主已切走（插件尚未收到 chat:opened 的事件延迟窗口）：save 跳过宿主 chat 键，
  // 本地镜像与全局备份仍照常落盘；回到该聊天后 load 回退链恢复数据。
  // 真实时序：宿主切聊天是用户事件（宏任务），只会发生在插件微任务链清空之后，
  // 因此先让写 A 的 save 全部落盘，再模拟宿主切走后的新一轮 save。
  const hostRace = fakeHost();
  const raceStore = new Map();
  const raceLocal = {
    getItem: (k) => (raceStore.has(k) ? raceStore.get(k) : null),
    setItem: (k, v) => { raceStore.set(k, String(v)); }
  };
  hostRace.current.chat = 'chat-a';
  const rtRace = M.createRuntime(hostRace.api, raceLocal, () => ({}));
  await rtRace.switchChat('chat-a');
  await rtRace.applyText(jade('t-race', TABLET_OK), 'chat-a', 'test');
  await flushQueue();
  hostRace.current.chat = 'chat-b';
  await rtRace.applyText(jade('t-race2', TABLET_OK.replace('炼气', '筑基')), 'chat-a', 'test');
  await flushQueue();
  ok(!hostRace.chatKeys().includes(M.STATE_KEY), '宿主已切走时不写宿主 chat 键（防跨聊天污染）');
  ok(raceStore.has(rtRace.LOCAL_PREFIX + 'chat-a'), '宿主切走时本地镜像仍落盘');
  ok(!!hostRace.api.get(M.BACKUP_PREFIX + 'chat-a', 'global'), '宿主切走时全局备份仍落盘');
  hostRace.current.chat = 'chat-a';
  const rtRace2 = M.createRuntime(hostRace.api, raceLocal, () => ({}));
  await rtRace2.switchChat('chat-a');
  const restored = rtRace2.current();
  eq(restored.tablet.name, '李逍遥', '镜像恢复的玉牌数据完整（名字）');
  ok(restored.tablet.groups.some((g) => g.id === 'cult' && g.fields.some((f) => f.key === '境界' && f.value === '筑基')), '镜像恢复包含最新一轮写入（宿主键陈旧时以镜像为准）');

  // 内存聊天缓存 LRU 淘汰
  const host4 = fakeHost();
  const rt4 = M.createRuntime(host4.api, null, () => ({}));
  for (const c of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) await rt4.switchChat(c);
  const ids = rt4.cachedChatIds();
  eq(ids.length, 5, '内存聊天缓存不超过 5 个');
  ok(!ids.includes('c1') && ids.includes('c6'), '最久未访问聊天被淘汰，活跃聊天保留');

  // 历史水化只按 assistant 角色查询（role 枚举不含 character）
  const host5 = fakeHost();
  host5.setHistory([{ id: 'm1', role: 'assistant', content: jade('h-role', TABLET_OK) }]);
  const rt5 = M.createRuntime(host5.api, null, () => ({}));
  await rt5.switchChat('chat-role');
  ok(host5.rolesQueried().length > 0 && host5.rolesQueried().every((r) => r === 'assistant'), '历史查询只使用 assistant 角色');
}

// ---------- Views ----------
console.log('# Views 渲染');
M.setTranslator(M.makeTranslator({ plugin: { i18n: { t: zhT } } }));
M.i18n.invalidate();
{
  const state = M.CORE.blankState('c1');
  state.sync = { status: 'complete', roleName: '李逍遥', summary: '初入青云', issues: [], updatedAt: 1 };

  const home = M.VIEWS.renderHome(state, {});
  ok(home.includes('李逍遥') && home.includes(zhT('runtime.sync.complete')), '主界面渲染角色名与同步状态');
  ok(home.includes('data-action="open-feature"'), '卦位为可点击入口');

  const sealedHome = M.VIEWS.renderHome(state, { forum: false });
  ok(sealedHome.includes('sealed'), '封印卦位带 sealed 态');
  ok(sealedHome.includes(zhT('runtime.seal.glyph')), '封印角标走 catalog');

  const manage = M.VIEWS.renderManage(state, { forum: false });
  ok(manage.includes('data-action="reset-fab"'), '管理页提供显式复位入口');
  ok(manage.includes(zhT('runtime.manage.resetFab')), '复位入口文案走 catalog');
  ok(manage.includes(zhT('runtime.manage.off')), '封印开关显示已封印');

  const shell = M.VIEWS.renderShell(state, {});
  ok(shell.includes('data-action="close"') && shell.includes('role="dialog"'), 'shell 具备关闭按钮与 dialog 语义');

  const emptyMsg = M.VIEWS.renderMsg(state, { app: 'msg', view: 'root', params: {} });
  ok(emptyMsg.includes(zhT('runtime.guard.contacts')), '空讯息页展示引导文案');

  const tabletPage = M.VIEWS.renderPage(state, { app: 'tablet' }, {});
  ok(tabletPage.includes('data-marker="tablet"'), 'renderPage 分发到玉牌页');
  eq(M.VIEWS.fieldValue(state.tablet, 'look', 'appearance'), '', 'fieldValue 缺字段返回空串');
}

// ---------- 交互基座第一层 · 检索筛选 ----------
console.log('# 交互基座 · 检索筛选');
{
  // 关键词工具：空关键词恒匹配（renderX 空串即全量，见下方玉牌 11 字段断言）；大小写不敏感。
  ok(M.VIEWS.searchKw('  abc  ') === 'abc', 'searchKw 去空白并小写');
  eq(M.VIEWS.searchKw(''), '', '空检索串为空关键词');
  ok(M.VIEWS.searchKw('ABC') === 'abc', '关键词统一小写');

  // 检索框结构：placeholder/aria 走 catalog，有值才渲染清除按钮。
  const sbEmpty = M.VIEWS.searchBox('');
  ok(sbEmpty.includes('data-search-input') && sbEmpty.includes(zhCatalog['runtime.search.placeholder']), '检索框带 input 与 catalog placeholder');
  ok(sbEmpty.includes('yz-search-clear hidden'), '无关键词时清除按钮隐藏');
  const sbFull = M.VIEWS.searchBox('剑');
  ok(sbFull.includes('value="剑"') && !sbFull.includes('yz-search-clear hidden') && sbFull.includes('data-action="clear-search"'), '有关键词时显示清除按钮');

  // 玉牌字段过滤：按字段名/值过滤，未命中组不渲染。
  const ts = M.CORE.blankState('f1');
  ts.tablet = M.CORE.normalizeTablet(TABLET_OBJ);
  const tAll = M.VIEWS.renderTablet(ts, '');
  ok(tAll.includes('data-marker="tablet"') && tAll.includes('data-search-input'), '玉牌页带检索框');
  eq((tAll.match(/yz-field/g) || []).length, 11, '无关键词渲染全部字段');
  const tKw = M.VIEWS.renderTablet(ts, '灵根');
  ok(tKw.includes('灵根') && !tKw.includes('身高'), '玉牌按字段名过滤');
  const tKwV = M.VIEWS.renderTablet(ts, '李逍遥');
  ok(tKwV.includes('李逍遥') && !tKwV.includes('性别'), '玉牌按字段值过滤');
  const tNone = M.VIEWS.renderTablet(ts, '不存在的词');
  ok(tNone.includes(zhCatalog['runtime.search.noMatch']) && !tNone.includes('yz-field'), '玉牌无命中显示专属空态');

  // 讯息：联系人列表过滤 + 聊天详情内过滤。
  const ms = M.CORE.blankState('f2');
  ms.chats = M.CORE.normalizeChats(MSG_OBJ);
  const chatList = M.VIEWS.renderMsg(ms, { app: 'msg', view: 'chats', params: {} }, '林月如');
  ok(chatList.includes('林月如') && !chatList.includes('酒剑仙'), '联系人按名称过滤');
  const chatListRel = M.VIEWS.renderMsg(ms, { app: 'msg', view: 'chats', params: {} }, '道侣');
  ok(chatListRel.includes('林月如') && !chatListRel.includes('酒剑仙'), '联系人按关系过滤');
  const chatDetail = M.VIEWS.renderMsg(ms, { app: 'msg', view: 'chat', params: { id: 'c1' } }, '勿念');
  ok(chatDetail.includes('勿念') && !chatDetail.includes('定当赴约'), '聊天详情按消息内容过滤');
  const chatDetailNone = M.VIEWS.renderMsg(ms, { app: 'msg', view: 'chat', params: { id: 'c1' } }, '没有的话');
  ok(chatDetailNone.includes(zhCatalog['runtime.search.noMatch']), '聊天详情无命中显示空态');
  const groupList = M.VIEWS.renderMsg(ms, { app: 'msg', view: 'groups', params: {} }, '青云');
  ok(groupList.includes('青云内门'), '群聊列表按名称过滤');
  const gDetail = M.VIEWS.renderMsg(ms, { app: 'msg', view: 'gchat', params: { id: 'g1' } }, '掌门');
  ok(gDetail.includes('卯时议事') && !gDetail.includes('不得迟到'), '群聊详情按发送者/内容过滤');

  // 玉册：文件夹按名称过滤、文件夹内按标题/正文过滤。
  const ns = M.CORE.blankState('f3');
  ns.notes = { folders: [{ id: 'f1', name: '杂记', count: 1 }, { id: 'f2', name: '秘录', count: 0 }], notes: [{ id: 'n1', folderId: 'f1', updated: '今日', locked: false, title: '约定', body: '卯时山门' }] };
  const folders = M.VIEWS.renderNotes(ns, { app: 'notes', view: 'folders', params: {} }, '秘录');
  ok(folders.includes('秘录') && !folders.includes('杂记'), '玉册文件夹按名称过滤');
  const folderNotes = M.VIEWS.renderNotes(ns, { app: 'notes', view: 'folder', params: { id: 'f1' } }, '卯时');
  ok(folderNotes.includes('约定') && !folderNotes.includes(zhCatalog['runtime.guard.notes']), '文件夹内按正文过滤');
  const folderNone = M.VIEWS.renderNotes(ns, { app: 'notes', view: 'folder', params: { id: 'f1' } }, '无');
  ok(folderNone.includes(zhCatalog['runtime.search.noMatch']), '文件夹内无命中显示空态');

  // 论坛：帖子按标题/作者/版块过滤。
  const fo = M.CORE.blankState('f4');
  fo.forum = { posts: [{ id: 'p1', author: '掌门', role: '长老', section: '公告', time: '今日', title: '议事', body: '卯时集合', resonance: 3, comments: [{ author: '长老', time: '今日', text: '已知' }, { author: '弟子', time: '今日', text: '恭候' }] }] };
  const forumTitle = M.VIEWS.renderForum(fo, { app: 'forum', view: 'root', params: {} }, '议事');
  ok(forumTitle.includes('data-marker="forum-list"') && forumTitle.includes('议事'), '帖子按标题过滤');
  const forumNone = M.VIEWS.renderForum(fo, { app: 'forum', view: 'root', params: {} }, '悬赏');
  ok(forumNone.includes(zhCatalog['runtime.search.noMatch']), '帖子无命中显示空态');
  const postComments = M.VIEWS.renderForum(fo, { app: 'forum', view: 'post', params: { id: 'p1' } }, '长老');
  ok(postComments.includes('已知') && !postComments.includes('恭候'), '帖子评论按评论者过滤');

  // 坊市：行情/订单按名称过滤；芥子空间：物品/钱财按名称过滤；舆图：行踪过滤、当前位置保留。
  const mk = M.CORE.blankState('f5');
  mk.market = { listings: [{ id: 'l1', name: '灵草', grade: '下品', desc: '百年份', price: '10灵石', seller: '坊主' }], auctions: [{ id: 'a1', name: '古剑', grade: '上品', desc: '锈蚀', start: '100', current: '150', timeLeft: '1时辰', bids: 3 }], orders: [{ id: 'o1', name: '符纸', status: '已成交', price: '5灵石', time: '今日', side: '买' }] };
  const listings = M.VIEWS.renderMarket(mk, { app: 'market', view: 'listings', params: {} }, '灵草');
  ok(listings.includes('灵草') && !listings.includes('古剑'), '行情按名称过滤');
  const auctions = M.VIEWS.renderMarket(mk, { app: 'market', view: 'auctions', params: {} }, '锈蚀');
  ok(auctions.includes('古剑') && !auctions.includes('灵草'), '拍卖按描述过滤');
  const orders = M.VIEWS.renderMarket(mk, { app: 'market', view: 'orders', params: {} }, '符纸');
  ok(orders.includes('符纸') && !orders.includes('古剑'), '订单按名称过滤');
  const marketNone = M.VIEWS.renderMarket(mk, { app: 'market', view: 'listings', params: {} }, '无此物');
  ok(marketNone.includes(zhCatalog['runtime.search.noMatch']), '行情无命中显示空态');

  const sp = M.CORE.blankState('f6');
  sp.space = { currencies: [{ kind: '灵石', amount: '120' }], items: [{ id: 'i1', name: '养神丹', qty: 2, grade: '中品', desc: '宁神益气' }] };
  const items = M.VIEWS.renderSpace(sp, { app: 'space', view: 'items', params: {} }, '养神丹');
  ok(items.includes('养神丹') && !items.includes('灵石'), '储物按物品名过滤');
  const coins = M.VIEWS.renderSpace(sp, { app: 'space', view: 'currencies', params: {} }, '灵石');
  ok(coins.includes('灵石') && !coins.includes('养神丹'), '钱财按种类过滤');

  const mp = M.CORE.blankState('f7');
  mp.map = { current: { place: '青云山', domain: '东域', desc: '山门所在' }, tracks: [{ id: 't1', time: '昨日', place: '山门', action: '入门' }, { id: 't2', time: '今日', place: '演武场', action: '晨练' }] };
  const mapTracks = M.VIEWS.renderMap(mp, '演武');
  ok(mapTracks.includes('演武场') && mapTracks.includes('青云山') && !mapTracks.includes('入门'), '舆图行踪过滤、当前位置保留');
  const mapNone = M.VIEWS.renderMap(mp, '荒原');
  ok(mapNone.includes(zhCatalog['runtime.search.noMatch']) && mapNone.includes('青云山'), '舆图无命中行踪时显示空态且当前位置仍在');

  // renderPage 透传 ui.search 到各页面；无 ui 时缺省空关键词不报错。
  const pageSearch = M.VIEWS.renderPage(ms, { app: 'msg', view: 'chats', params: {}, stack: [] }, {}, { search: '林月如' });
  ok(pageSearch.includes('林月如') && !pageSearch.includes('酒剑仙'), 'renderPage 透传检索关键词');
  ok(M.VIEWS.renderPage(M.CORE.blankState('f8'), { app: 'map', view: 'root', params: {}, stack: [] }, {}, {}).includes('data-search-input'), '无检索状态时页面正常渲染');

  // 回归：检索空态文案与清除按钮键双语齐全。
  ['runtime.search.placeholder', 'runtime.search.clear', 'runtime.search.noMatch'].forEach((k) => {
    ok(!!zhCatalog[k] && !!enCatalog[k], `检索文案 ${k} 双语齐全`);
  });
}

// ---------- P1 · 同步详情页 ----------
console.log('# P1 · 同步详情页');
{
  eq(M.VIEWS.formatDateTime(Date.UTC(2026, 7, 23, 4, 5)), '2026-08-23 04:05', 'formatDateTime 输出补零 UTC 格式');
  eq(M.VIEWS.formatDateTime(0), '-', 'formatDateTime 无效时间返回 -');

  const usage = M.VIEWS.snapshotUsage(M.CORE.blankState('u'));
  ok(usage.limit === M.MAX_SNAPSHOT_BYTES && usage.bytes > 0 && usage.percent < 10, 'snapshotUsage 返回字节、上限与百分比');

  const st = M.CORE.blankState('c-detail');
  st.sync.status = 'partial';
  st.sync.turnId = 'turn-77';
  st.sync.lastSource = 'generation:success';
  st.sync.summary = '初入青云';
  st.sync.applied = ['tablet'];
  st.sync.issues = [{ path: 'map.rows', code: 'map.rows' }];
  st.sync.updatedAt = Date.UTC(2026, 7, 23, 12, 34);
  st.chatId = 'chat-detail';
  const html = M.VIEWS.renderSyncDetail(st);
  ok(html.includes(zhCatalog['runtime.diag.turn']) && html.includes('turn-77'), '详情页展示最近轮次');
  ok(html.includes(zhCatalog['runtime.diag.source']) && html.includes('generation:success'), '详情页展示来源原文');
  ok(html.includes(zhT('runtime.feature.tablet')), 'applied 分区按功能名翻译');
  ok(html.includes(zhCatalog['assess.issue.map.rows']), 'issues 按 catalog 翻译');
  ok(html.includes(zhCatalog['runtime.diag.updated']) && html.includes('2026-08-23 12:34'), '更新时间为手工 YYYY-MM-DD HH:mm');
  ok(!html.includes('toLocaleString'), '不使用 toLocaleString');
  ok(html.includes('yz-meter') && html.includes('%'), '容量进度条与百分比渲染');
  ok(html.includes(zhCatalog['runtime.diag.chatId']) && html.includes('chat-detail'), '展示聊天标识');
  ok(!html.includes(zhCatalog['runtime.diag.lastError']), 'lastError 为空时不显示该行');
  const errState = M.CORE.clone(st);
  errState.sync.lastError = 'parse-error';
  ok(M.VIEWS.renderSyncDetail(errState).includes('parse-error'), 'lastError 非空时显示');

  const emptyHtml = M.VIEWS.renderSyncDetail(M.CORE.blankState('c-empty'));
  ok(emptyHtml.includes(zhCatalog['runtime.diag.noIssues']), '空态显示无问题文案');
  ok(emptyHtml.includes(zhCatalog['runtime.diag.none']), '空态显示无应用分区文案');

  const home = M.VIEWS.renderHome(M.CORE.blankState('h1'), {});
  ok(home.includes('data-action="sync-detail"'), '主界面同步行为详情入口按钮');
  ok(home.includes('data-action="core"'), '太极核心为 data-action=core 按钮');
  ok(home.includes(zhCatalog['runtime.core.aria']), '核心 aria-label 走 catalog');
  const syncPage = M.VIEWS.renderPage(M.CORE.blankState('sp'), { app: 'sync', view: 'root', params: {}, stack: [] }, {}, {});
  ok(syncPage.includes('data-marker="sync"') && syncPage.includes(zhCatalog['runtime.diag.title']), 'renderPage 分发 sync 详情页并带标题');
}

// ---------- P1 · 卦位三态徽标 ----------
console.log('# P1 · 卦位三态徽标');
{
  const B = M.VIEWS.nodeBadge;
  const featMsg = M.VIEWS.FEATURES.find((f) => f.id === 'msg');
  const featNotes = M.VIEWS.FEATURES.find((f) => f.id === 'notes');
  const bs = M.CORE.blankState('bd');
  eq(B(featMsg, {}, bs), null, '空白态无徽标');
  bs.chats.contacts = [{ id: 'c', name: '甲', unread: 120 }];
  bs.sync.applied = ['notes'];
  bs.sync.issues = [{ path: 'msg.contacts', code: 'msg.contacts' }];
  eq(B(featMsg, {}, bs).kind, 'alert', '警示优先于未读');
  eq(B(featNotes, {}, bs).kind, 'new', '已应用且未见 → 新');
  bs.sync.appliedSeen = ['notes'];
  eq(B(featNotes, {}, bs), null, '查看后并入 seen，新徽标熄灭');
  bs.sync.issues = [];
  eq(B(featMsg, {}, bs).kind, 'unread', '仅剩未读徽标');
  eq(B(featMsg, {}, bs).label, '99+', '未读上限显示 99+');
  bs.chats.contacts[0].unread = 3;
  eq(B(featMsg, {}, bs).label, '3', '未读计数求和');
  eq(B(featMsg, { msg: false }, bs), null, '封印卦位不显示任何徽标');

  const badgeState = M.CORE.blankState('bd2');
  badgeState.chats.contacts = [{ id: 'c', name: '甲', unread: 120 }];
  const nodesHtml = M.VIEWS.renderNodes({}, badgeState);
  ok(nodesHtml.includes('yz-badge-unread') && nodesHtml.includes('99+'), 'renderNodes 渲染未读角标');
  ok(nodesHtml.includes('99+ 条未读'), 'aria-label 附未读语义');

  // 新同步：仅 b-new 呼吸光效，不渲染文字角标（避免遮挡卦名）；aria 语义保留。
  const newState = M.CORE.blankState('bd3');
  newState.sync.applied = ['notes'];
  const newHtml = M.VIEWS.renderNodes({}, newState);
  ok(newHtml.includes('b-new') && !newHtml.includes('yz-badge-new'), '新同步仅光效，无文字角标');
  ok(newHtml.includes('，' + zhCatalog['runtime.badge.new']), '新同步 aria 语义保留');
}

// ---------- P1 · 管理页（诊断区/清空/导入导出）----------
console.log('# P1 · 管理页');
{
  const MS = M.VIEWS.WIPE_CONFIRM_MS;
  eq(MS, 3000, '两击确认窗口 3 秒');
  let nx = M.VIEWS.nextWipeState(null, 'tablet', 1000);
  ok(nx && nx.id === 'tablet' && nx.expiresAt === 1000 + MS, '首击进入确认态');
  eq(M.VIEWS.nextWipeState(nx, 'tablet', 1000 + MS - 1), null, '窗口内再击确认执行');
  nx = M.VIEWS.nextWipeState({ id: 'tablet', expiresAt: 1000 + MS }, 'tablet', 1000 + MS + 1);
  ok(nx && nx.id === 'tablet' && nx.expiresAt === 1000 + MS + 1 + MS, '超时后重新武装');
  eq(M.VIEWS.nextWipeState(nx, 'msg', 0).id, 'msg', '切换目标重新武装');

  const mstate = M.CORE.blankState('mg');
  const closed = M.VIEWS.renderManage(mstate, {}, {});
  ok(closed.includes('data-action="toggle-diag"'), '管理页顶部诊断折叠头');
  ok(!closed.includes('yz-diag-body'), '诊断默认折叠');
  eq((closed.match(/data-action="clear-feature"/g) || []).length, 7, '七个可启封功能各带清空按钮');
  ok(closed.includes('data-panel="export"') && closed.includes('data-panel="import"'), '导出/导入入口行');
  const openDiag = M.VIEWS.renderManage(mstate, {}, { diagOpen: true });
  ok(openDiag.includes('yz-diag-body') && openDiag.includes(zhCatalog['runtime.diag.chatId']), '展开后复用 renderSyncDetail 内容');
  const expPanel = M.VIEWS.renderManage(mstate, {}, { dataPanel: 'export' });
  ok(expPanel.includes('data-export-output readonly'.split(' ')[0]) && expPanel.includes('readonly') && expPanel.includes('data-action="copy-export"'), '导出面板只读 textarea + 复制按钮');
  const impPanel = M.VIEWS.renderManage(mstate, {}, { dataPanel: 'import' });
  ok(impPanel.includes('data-import-input') && impPanel.includes('data-action="import-submit"'), '导入面板输入框 + 提交按钮');
  const armedPanel = M.VIEWS.renderManage(mstate, {}, { armed: { id: 'tablet', expiresAt: Date.now() + 1000 } });
  ok(armedPanel.includes('yz-clear-btn armed') && armedPanel.includes(zhCatalog['runtime.manage.clearConfirm']), '武装态清空按钮变警示确认文案');
  ok(armedPanel.includes('yzJadeFace'), '复位行与 FAB 共用玉璧图标');

  // 单功能清空的分区映射：msg → state.chats
  eq(M.CORE.FEATURE_FIELDS.msg, 'chats', 'msg 功能映射到 state.chats');
  eq(M.CORE.blankFeatureField('forum'), { posts: [] }, 'blankFeatureField 返回分区空白结构');
  eq(M.CORE.blankFeatureField('nope'), null, '未知功能无空白结构');
}

// ---------- P1 · appliedSeen 持久化与导入 ----------
console.log('# P1 · appliedSeen 与 importState');
{
  let ps = M.CORE.blankState('ps');
  ps.sync.appliedSeen = ['notes', 'msg'];
  eq(M.CORE.normalizeState(ps, 'ps').sync.appliedSeen, ['notes', 'msg'], 'normalizeState 保留 appliedSeen');
  eq(M.CORE.normalizeState({}, 'x').sync.appliedSeen, [], '旧档缺省自动补空数组');
  const pr = M.CORE.applySnapshot(ps, snapOf('pv', 'full', { chats: MSG_OBJ }), {});
  ok(pr.state.sync.appliedSeen.indexOf('msg') < 0 && pr.state.sync.appliedSeen.indexOf('notes') >= 0, '本轮应用的分区从 seen 中移除');
}
{
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('imp');
  eq(rt.importState(JSON.stringify({ revision: 7 })).ok, true, '合法 JSON 导入成功');
  eq(rt.current().revision, 7, '导入替换内存态');
  eq(rt.importState('{bad json').reason, 'parse', '非法 JSON 拒收');
  eq(rt.importState('x'.repeat(200001)).reason, 'oversized', '超出容量拒收');
}

// ---------- P2 · 协议：mode/skip/digest ----------
console.log('# P2 · 协议 skip 与 digest');
{
  const partParsed = M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜tp1｜李逍遥｜只更玉牌｜part\n</yz_meta><yz_tablet>\nfield｜基本｜名字｜李逍遥\nfield｜基本｜性别｜男\nfield｜基本｜身高｜175cm\nfield｜基本｜体重｜60kg\nfield｜仪容｜外貌｜清朗\nfield｜仪容｜穿着｜道袍\nfield｜修为｜灵根｜天灵根\nfield｜修为｜体质｜凡体\nfield｜修为｜境界｜炼气\nfield｜修为｜状态｜佳\nfield｜隐秘｜身世｜弃徒\n</yz_tablet></yz_jade>');
  eq(partParsed.turn.mode, 'part', 'meta 第 5 字段 part 解析');
  eq(partParsed.present, ['tablet'], 'present 记录出现分区');
  ok(!partParsed.skipped, '无 skip 时不产出 skipped 映射');

  const skipParsed = M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜ts1｜李逍遥｜增量｜part\n</yz_meta><yz_tablet>\nfield｜隐秘｜身世｜弃徒\n</yz_tablet><yz_notes>\nskip｜无变化\n</yz_notes></yz_jade>');
  eq(skipParsed.skipped, { notes: '无变化' }, '唯一行 skip 记录原因');
  eq(skipParsed.present, ['tablet'], 'skip 分区不算出现');
  eq(skipParsed.notes, { folders: [], notes: [] }, 'skip 分区不产出数据');

  const mixedParsed = M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜tm1｜李逍遥｜混排\n</yz_meta><yz_market>\nskip｜懒得写\nlisting｜x1｜丹药｜上品｜疗伤｜十灵石｜药阁\n</yz_market></yz_jade>');
  ok(mixedParsed.present.indexOf('market') >= 0 && !mixedParsed.skipped, 'skip 与数据混排时忽略 skip 按数据解析');
  eq(mixedParsed.market.listings.length, 1, '混排数据正常解析');

  const boundary = M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜db1｜李逍遥｜边界\n</yz_meta><yz_tablet>\nfield｜基本｜名字｜李逍遥\n<yz_digest>\nfield｜基本｜污染｜不得解析\n</yz_digest></yz_jade>');
  eq(boundary.tablet.groups.length, 1, 'digest 标签截断宽松分区');
  eq(boundary.tablet.groups[0].fields.length, 1, 'digest 内伪 field 行不进数据');

  eq(M.PROTOCOL.stripStreamTail('他握紧了剑<yz_dig'), '他握紧了剑', '流式 digest 半截标签剥离');
  const cleaned = M.PROTOCOL.stripBlocks('剧情<yz_digest>\ntablet｜basic:名字\n</yz_digest>结尾。');
  ok(cleaned.startsWith('剧情') && cleaned.endsWith('结尾。') && !cleaned.includes('yz_digest'), '独立 digest 块整体剥离');

  // 模型复读 <yz_current> 基线：解析不吞真实分区，剥离整块移除。
  const echoParsed = M.PROTOCOL.parse('正文<yz_current><yzc_tablet>\nfield｜基本｜污染｜不得解析\n</yzc_tablet></yz_current><yz_jade><yz_meta>\nturn｜ec1｜李逍遥｜复读\n</yz_meta><yz_tablet>\nfield｜基本｜名字｜李逍遥\n</yz_tablet></yz_jade>');
  eq(echoParsed.tablet.groups[0].fields.length, 1, 'yzc_ 容器不污染 yz_ 分区解析');
  eq(echoParsed.tablet.groups[0].fields[0].value, '李逍遥', '复读基线时仍取真实数据行');
  const curCleaned = M.PROTOCOL.stripBlocks('剧情<yz_current><yzc_tablet>\nfield｜基本｜名字｜李逍遥\n</yzc_tablet></yz_current>结尾。');
  ok(curCleaned.startsWith('剧情') && curCleaned.endsWith('结尾。') && !curCleaned.includes('yzc_'), 'current 基线复读整块剥离');
  eq(M.PROTOCOL.stripStreamTail('他握紧了剑<yz_current><yzc_tab'), '他握紧了剑', '流式 current 半截标签剥离');
  const bareYzc = M.PROTOCOL.stripBlocks('剧情<yzc_msg>\nmsg｜c1｜m1｜other｜今日｜旧话\n</yzc_msg>结尾。');
  ok(bareYzc.startsWith('剧情') && bareYzc.endsWith('结尾。') && !bareYzc.includes('yzc_'), '裸 yzc_ 容器复读同样剥离');
  eq(M.PROTOCOL.stripStreamTail('他握紧了剑<yzc_msg>'), '他握紧了剑', '流式 yzc_ 半截标签剥离');
}

// ---------- P2 · Core 增量矩阵 ----------
console.log('# P2 · 增量矩阵');
{
  // R2 part 出现且各自达标 → complete
  const r2 = M.CORE.applySnapshot(M.CORE.blankState('m1'), snapOf('p1', 'part', { tablet: TABLET_OBJ, chats: MSG_OBJ }, { present: ['tablet', 'msg'] }), {});
  eq(r2.state.sync.status, 'complete', 'part 出现且达标 → complete');
  eq(r2.applied.slice().sort(), ['msg', 'tablet'], 'part 应用出现分区');
  eq(r2.state.sync.issues, [], 'part 达标无 issue');

  // R3 part 出现但不达标 → 丢弃保旧、partial
  let st3 = M.CORE.blankState('m2');
  st3 = M.CORE.applySnapshot(st3, snapOf('f0', 'full', { tablet: TABLET_OBJ }), {}).state;
  const r3 = M.CORE.applySnapshot(st3, snapOf('p2', 'part', { chats: { contacts: [], groups: [] } }, { present: ['msg'] }), {});
  eq(r3.state.sync.status, 'partial', 'part 出现但不达标 → partial');
  eq(r3.applied, [], '不达标分区不应用');
  ok(r3.state.sync.issues.some((i) => i.code === 'msg.contacts'), 'issue 来自本轮出现分区');
  eq(r3.state.tablet.name, '李逍遥', '未出现分区的旧数据保留');

  // R4 part skip 且旧数据达标 → 静默通过
  let st4 = M.CORE.blankState('m3');
  st4 = M.CORE.applySnapshot(st4, snapOf('f1', 'full', { chats: MSG_OBJ }), {}).state;
  const r4 = M.CORE.applySnapshot(st4, snapOf('p3', 'part', {}, { skipped: { msg: '无变化' } }), {});
  eq(r4.state.sync.status, 'complete', 'part skip 且旧数据达标 → complete');
  eq(r4.applied, [], 'skip 分区不进 applied');
  eq(r4.state.sync.issues, [], 'skip 达标不计 issue');
  eq(r4.state.chats.contacts.length, 2, 'skip 分区旧数据原样保留');

  // R5 part skip 但旧数据缺失 → 沿用现有 issue code、partial
  const r5 = M.CORE.applySnapshot(M.CORE.blankState('m4'), snapOf('p4', 'part', {}, { skipped: { map: '未探索' } }), {});
  eq(r5.state.sync.status, 'partial', 'part skip 但旧数据缺失 → partial');
  ok(r5.state.sync.issues.some((i) => i.code === 'map.rows'), 'skip 不达标沿用现有 issue code');

  // R6 part meta-only 且 revision>0 → 状态保持、摘要更新、不动 revision
  let st6 = M.CORE.blankState('m5');
  st6 = M.CORE.applySnapshot(st6, snapOf('f2', 'full', { tablet: TABLET_OBJ }), {}).state;
  const revBefore = st6.revision;
  const issuesBefore = st6.sync.issues.length;
  const statusBefore = st6.sync.status;
  const r6 = M.CORE.applySnapshot(st6, snapOf('p5', 'part', {}), {});
  eq(r6.state.sync.status, statusBefore, 'meta-only 保持原状态');
  eq(r6.state.revision, revBefore, 'meta-only 不加 revision');
  eq(r6.state.sync.issues.length, issuesBefore, 'meta-only 不新增 issue');
  eq(r6.state.sync.summary, '增量摘要', 'meta-only 刷新摘要');
  eq(r6.state.sync.turnId, 'p5', 'meta-only 更新轮次');

  // R7 part meta-only 且 revision===0 → invalid
  const r7 = M.CORE.applySnapshot(M.CORE.blankState('m6'), snapOf('p6', 'part', {}), {});
  eq(r7.state.sync.status, 'invalid', '从未同步收到 meta-only → invalid');
  eq(r7.state.revision, 0, 'invalid 轮不加 revision');

  // R8 full 轮内出现 skip 行 → 按分区缺失处理（v1.6 行为）
  const fullWithSkip = M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜f9｜李逍遥｜全量\n</yz_meta><yz_map>\nskip｜不该出现\n</yz_map></yz_jade>');
  eq(fullWithSkip.turn.mode, '', 'mode 缺省按 full 处理');
  const r8 = M.CORE.applySnapshot(M.CORE.blankState('m7'), fullWithSkip, {});
  ok(r8.state.sync.issues.some((i) => i.code === 'map.rows'), 'full 轮 skip 行按分区缺失记 issue');

  // assess 双参调用兼容（oldState 缺省视为不达标）
  const compat = M.CORE.assess(snapOf('pc', 'part', {}, { skipped: { map: 'y' } }), {});
  ok(compat.part === true && compat.issues.some((i) => i.code === 'map.rows'), 'assess 双参调用兼容');
}

// ---------- P2 · 当前数据基线与提示词 ----------
console.log('# P2 · 当前数据基线与提示词');
{
  const dg = M.CORE.blankState('dg');
  dg.tablet = M.CORE.normalizeTablet(TABLET_OBJ);
  dg.chats = M.CORE.normalizeChats(MSG_OBJ);
  dg.notes = { folders: [{ id: 'f1', name: '杂记' }], notes: [{ id: 'n1', folderId: 'f1', updated: '今日', locked: true, title: '约定', body: '卯时山门' }] };
  dg.forum = { posts: [{ id: 'p1', author: '掌门', role: '长老', section: '公告', time: '今日', title: '议事', body: '卯时集合', resonance: 3, comments: [{ author: '长老', time: '今日', text: '已知' }] }] };
  dg.market = { listings: [{ id: 'l1', name: '灵草', grade: '下品', desc: '百年份', price: '10灵石', seller: '坊主' }], auctions: [{ id: 'a1', name: '古剑', grade: '上品', desc: '锈蚀', start: '100', current: '150', timeLeft: '1时辰', bids: 3 }], orders: [{ id: 'o1', name: '符纸', status: '已成交', price: '5灵石', time: '今日', side: '买' }] };
  dg.space = { currencies: [{ kind: '灵石', amount: '120' }], items: [{ id: 'i1', name: '养神丹', qty: 2, grade: '中品', desc: '宁神益气' }] };
  dg.map = { current: { place: '青云山', domain: '东域', desc: '山门所在' }, tracks: [{ id: 't1', time: '昨日', place: '山门', action: '入门' }] };

  const cur = M.PROMPT.buildCurrent(dg, {});
  ok(cur.includes('<yzc_tablet>'), '基线用 yzc_ 容器标签');
  eq(M.PROMPT.buildCurrent(M.CORE.clone(dg), {}), cur, '同一 state 输出稳定');
  ok(!M.PROMPT.buildCurrent(dg, { tablet: false }).includes('<yzc_tablet>'), '封印功能不进基线');

  // 回环：基线行（yzc_→yz_）应能被协议解析器无损读回——字段顺序与语法一致的守护。
  const jadeRt = '<yz_jade>\n<yz_meta>\nturn｜rt｜李逍遥｜回环\n</yz_meta>\n' + cur.join('\n').replace(/yzc_/g, 'yz_') + '\n</yz_jade>';
  const rt = M.PROTOCOL.parse(jadeRt);
  ok(rt && rt.tablet.name === '李逍遥', '基线行回环解析出角色名');
  eq(rt.tablet.groups.length, 4, '基线玉牌四组回环');
  eq(rt.chats.contacts.length, 2, '基线联系人回环');
  eq(rt.chats.contacts[0].messages.length, 2, '基线联系人消息回环');
  ok(rt.chats.contacts[0].messages.every((m) => ['m1', 'm2'].includes(m.id)), '消息 id 原样沿用');
  eq(rt.chats.groups[0].members, 30, '群成员数回环');
  ok(rt.notes.notes[0].locked === true, '备忘锁定标记回环');
  eq(rt.forum.posts[0].comments.length, 1, '论坛评论回环');
  eq(rt.market.auctions[0].current, '150', '拍卖当前价回环');
  eq(rt.space.items[0].qty, 2, '物品数量回环');
  ok(rt.map.current.place === '青云山' && rt.map.tracks.length === 1, '舆图当前位置与行踪回环');

  // 值内竖线清洗：行语法不被破坏。
  const pipeState = M.CORE.blankState('p');
  pipeState.map = { current: { place: 'a｜b', domain: '', desc: '' }, tracks: [] };
  ok(!M.PROMPT.buildCurrent(pipeState, {}).join('\n').includes('a｜b'), '值中竖线被清洗');

  // full 模式（forceFull）：完整区块 + 基线沿用约束，无 diff 文案
  const pFull = M.PROMPT.buildPrompt('zh', {}, { forceFull: true, current: cur });
  ok(pFull.includes('<yz_current>') && pFull.includes('id 一律不变'), '强制全量轮注入基线与 id 沿用约束');
  ok(pFull.includes('强制全量同步') && pFull.includes('｜full'), '强制全量轮声明 mode full');
  ok(!pFull.includes('diff 格式') && !pFull.includes('｜diff'), '强制全量轮无 diff 文案');
  ok(pFull.includes('重新生成或续写的回复同样受此约束'), '基线约束覆盖重新生成/续写场景');
  ok(!pFull.includes('skip｜原因') && !pFull.includes('【同步范围｜增量】'), '无 skip/旧增量文案');
  ok(!pFull.includes('<yz_digest>'), 'digest 机制已移除');

  // diff 模式（默认轮次）：+/- 语义、删除行格式、基线 diff 指引
  const ctx = { forceFull: false, issues: [], current: cur };
  const pDiff = M.PROMPT.buildPrompt('zh', {}, ctx);
  ok(pDiff.includes('diff 格式') && pDiff.includes('+ 前缀行新增或更新'), 'diff 模式说明 +/- 语义');
  ok(pDiff.includes('｜diff'), 'diff 轮 turn 行 mode 为 diff');
  ok(pDiff.includes('-msg｜联系人id｜消息id'), 'diff 模式注入删除行格式表');
  ok(pDiff.includes('对照基线出 diff'), 'diff 规则指向基线');
  ok(pDiff.includes('只输出 <yz_meta>'), '无变化轮指引只输出 meta');
  ok(pDiff.includes('本轮已启封：'), 'diff 轮页脚为已启封列表');

  // 多轮防累积：prepare 重注入时旧基线块必须被剥离，不随轮次堆积
  // （散文中提及 yz_current 标签不计——它们会作为剥离锚点连同注入残留一并扫除）。
  const ev1 = M.PROMPT.mutatePrepareEvent({ text: '第一轮正文' }, 'zh', {}, { forceFull: true, issues: [], current: cur });
  const ev2 = M.PROMPT.mutatePrepareEvent({ text: ev1.text }, 'zh', {}, { forceFull: false, issues: [], current: cur });
  eq(ev2.text.split('\n<yz_current>\n').length, 2, 'prepare 重注入基线块不累积');
  ok(ev2.text.startsWith('第一轮正文'), '正文保留在注入文本前部');

  // issue 回声：≤3 条、按 lang 翻译、要求用 + 行补齐
  const echoCtx = { issues: [{ path: 'map.rows', code: 'map.rows' }, { path: 'space.rows', code: 'space.rows' }, { path: 'market.rows', code: 'market.rows' }, { path: 'forum.posts', code: 'forum.posts' }], current: [] };
  const pEcho = M.PROMPT.buildPrompt('zh', {}, echoCtx);
  ok(pEcho.includes(zhCatalog['assess.issue.map.rows']), '回声翻译 issue 文案');
  ok(!pEcho.includes(zhCatalog['assess.issue.forum.posts']), '回声上限 3 条');
  ok(pEcho.includes('用 + 行补齐'), 'diff 回声要求 + 行补齐');
  const pEchoFull = M.PROMPT.buildPrompt('zh', {}, { forceFull: true, issues: [{ path: 'map.rows', code: 'map.rows' }] });
  ok(pEchoFull.includes(zhCatalog['assess.issue.map.rows']) && pEchoFull.includes('或完整输出对应区块'), '强制全量轮回声可完整输出');
  ok(!M.PROMPT.buildPrompt('zh', {}, {}).includes('未达标'), '无 issue 时零回声');

  const prevTranslator = zhT;
  M.setTranslator(M.makeTranslator({ plugin: { i18n: { t: enT } } }));
  M.i18n.invalidate();
  ok(M.PROMPT.buildPrompt('en', {}, { issues: [{ path: 'map.rows', code: 'map.rows' }] }).includes(enCatalog['assess.issue.map.rows']), '回声按 lang 选 en 语种');
  ok(M.PROMPT.buildPrompt('en', {}, { forceFull: false }).includes('Diff format'), 'en 提示词含 diff 说明');
  M.setTranslator(M.makeTranslator({ plugin: { i18n: { t: prevTranslator } } }));
  M.i18n.invalidate();
}

// ---------- P2 · diff 协议：解析与应用 ----------
console.log('# P2 · diff 协议与应用');
{
  // 建立基线状态（达标，各分区数据留足余量供 diff 删除后仍满足底线）
  const BASE_FULL = jade('d0', TABLET_OK
    + '<yz_msg>\ncontact｜c1｜林月如｜道侣｜今日｜0｜安好\ncontact｜c2｜酒剑仙｜师尊｜今日｜2｜饮酒\nmsg｜c1｜m1｜other｜昨日｜勿念\nmsg｜c1｜m2｜self｜今日｜定当赴约\nmsg｜c2｜m3｜other｜今日｜来喝酒\nmsg｜c2｜m4｜other｜今日｜速来\ngroup｜g1｜青云内门｜30｜今日｜5｜集合\ngmsg｜g1｜gm1｜掌门｜other｜今日｜卯时议事\ngmsg｜g1｜gm2｜长老｜other｜今日｜不得迟到\ngmsg｜g1｜gm3｜弟子｜other｜今日｜收到\n</yz_msg>'
    + '<yz_notes>\nfolder｜f1｜杂记｜2\nfolder｜f2｜秘录｜1\nnote｜n1｜f1｜今日｜false｜约定｜卯时山门\nnote｜n2｜f2｜今日｜true｜心法｜不可外传\nnote｜n3｜f1｜昨日｜false｜见闻｜坊市有新品灵草\n</yz_notes>'
    + '<yz_forum>\npost｜p1｜掌门｜长老｜公告｜今日｜议事｜卯时集合｜3\ncomment｜p1｜长老｜今日｜已知\ncomment｜p1｜弟子｜今日｜恭候\npost｜p2｜长老｜长老｜闲聊｜昨日｜论剑｜切磋记录｜1\ncomment｜p2｜弟子｜昨日｜围观\n</yz_forum>'
    + '<yz_market>\nlisting｜l1｜灵草｜下品｜百年份｜10灵石｜坊主\nauction｜a1｜古剑｜上品｜锈蚀｜100｜150｜1时辰｜3\norder｜o1｜符纸｜已成交｜5灵石｜今日｜买\n</yz_market>'
    + '<yz_space>\ncurrency｜灵石｜120\nitem｜i1｜养神丹｜2｜中品｜宁神益气\nitem｜i2｜驱邪符｜5｜下品｜辟邪护身\n</yz_space>'
    + '<yz_map>\ncurrent｜青云山｜东域｜山门所在\ntrack｜t1｜昨日｜山门｜入门\ntrack｜t2｜今日｜演武场｜晨练\n</yz_map>');
  const base = M.CORE.blankState('d1');
  const r0 = M.CORE.applySnapshot(base, M.PROTOCOL.parse(BASE_FULL), {});
  ok(r0.state.sync.status === 'complete', '基线状态先落一轮全量 complete');

  // diff 轮：upsert 更新玉牌境界、追加消息、删除群消息、评论增删、物品删除、舆图更新
  const diffText = '<yz_jade><yz_meta>\nturn｜d1｜李逍遥｜突破与迁移｜diff\n</yz_meta><yz_tablet>\n+field｜修为｜境界｜筑基一层\n</yz_tablet><yz_msg>\n+msg｜c1｜m9｜other｜今日｜恭贺师兄突破\n-gmsg｜g1｜gm2\n</yz_msg><yz_forum>\n+comment｜p1｜弟子｜今日｜恭贺掌门\n-comment｜p1｜长老｜今日｜已知\n</yz_forum><yz_space>\n-item｜i1\n+currency｜灵石｜20\n</yz_space><yz_map>\n+current｜落霞峰｜东域｜闭关之地\n+track｜t3｜今日｜落霞峰｜闭关\n</yz_map></yz_jade>';
  const ds = M.PROTOCOL.parse(diffText);
  ok(ds && Object.keys(ds.diff).length === 5, 'diff 快照解析出 5 个带操作行的分区');
  eq(ds.turn.mode, 'diff', 'meta 第 5 字段 diff 解析');
  eq(ds.diff.tablet[0].type, 'field', 'tablet 操作行类型解析');
  ok(ds.diff.msg.some((o) => o.type === 'msg' && o.add) && ds.diff.msg.some((o) => o.type === 'gmsg' && !o.add), 'msg 分区混含 +msg 与 -gmsg');

  const r1 = M.CORE.applySnapshot(r0.state, ds, {});
  ok(r1.state.tablet.name === '李逍遥', 'diff 后玉牌名字保留');
  eq(M.CORE.applySnapshot(r0.state, ds, {}).state.tablet.name, '李逍遥', '重复应用幂等');
  const cult = r1.state.tablet.groups.find((g) => g.id === 'cult');
  ok(cult.fields.some((f) => f.value === '筑基一层'), '+field upsert 更新境界');
  ok(cult.fields.some((f) => f.key === '灵根' && f.value === '天灵根'), '未提及字段原样保留');
  const c1 = r1.state.chats.contacts.find((c) => c.id === 'c1');
  ok(c1.messages.some((m) => m.id === 'm9'), '+msg 追加新消息');
  ok(c1.messages.some((m) => m.id === 'm2'), '未提及消息保留');
  const g1 = r1.state.chats.groups.find((g) => g.id === 'g1');
  ok(g1 && !g1.messages.some((m) => m.id === 'gm2'), '-gmsg 删除指定群消息');
  const p1 = r1.state.forum.posts.find((p) => p.id === 'p1');
  ok(p1.comments.some((c) => c.text === '恭贺掌门'), '+comment 追加评论');
  ok(!p1.comments.some((c) => c.text === '已知'), '-comment 按整行删除评论');
  ok(!r1.state.space.items.some((i) => i.id === 'i1'), '-item 删除物品');
  eq(r1.state.space.currencies[0].amount, '20', '+currency 按种类 upsert 更新数额');
  eq(r1.state.map.current.place, '落霞峰', '+current 替换当前位置');
  ok(r1.state.map.tracks.some((t) => t.id === 't3') && r1.state.map.tracks.some((t) => t.id === 't1'), 'track 追加且旧行保留');
  ok(r1.applied.length === 5, 'diff 轮 5 个触及分区全部应用');
  eq(r1.state.sync.status, 'complete', 'diff 轮保持 complete');
  eq(r1.state.revision, r0.state.revision + 1, 'diff 轮 revision +1');

  // 模型只输出变化行但忘写 mode → 以行形态识别为 diff，数据不被整块替换清掉
  const noMode = M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜d2｜李逍遥｜忘写模式\n</yz_meta><yz_msg>\n+msg｜c1｜m10｜other｜今日｜再贺\n</yz_msg></yz_jade>');
  const r2 = M.CORE.applySnapshot(r1.state, noMode, {});
  ok(r2.state.chats.contacts.find((c) => c.id === 'c2'), '未声明 mode 的 diff 行不整块替换（其余联系人保留）');
  ok(r2.state.chats.contacts.find((c) => c.id === 'c1').messages.some((m) => m.id === 'm10'), '未声明 mode 的 + 行仍应用');

  // meta-only diff 轮：无变化，仅刷新摘要
  const r3 = M.CORE.applySnapshot(r2.state, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜d3｜李逍遥｜风平浪静｜diff\n</yz_meta></yz_jade>'), {});
  ok(r3.changed !== true || r3.applied.length === 0, 'meta-only diff 轮无分区应用');
  eq(r3.state.revision, r2.state.revision, 'meta-only diff 轮不动 revision');
  eq(r3.state.sync.summary, '风平浪静', 'meta-only diff 轮刷新摘要');

  // 未触及分区若数据确实不达标：diff 轮重推导并保留 issue（供模型 + 行修复），数据不动
  const holed = M.CORE.clone(r2.state);
  holed.market.orders = [];
  const r4 = M.CORE.applySnapshot(holed, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜d4｜李逍遥｜只动玉牌｜diff\n</yz_meta><yz_tablet>\n+field｜修为｜状态｜闭关\n</yz_tablet></yz_jade>'), {});
  ok(r4.state.sync.issues.some((i) => i.code === 'market.rows'), '未触及且不达标的分区在 diff 轮重推导 issue 回显');
  ok(r4.state.market.orders.length === 0, '未触及分区数据不动');

  // 删除行触发最低线不达标：分区不落盘、记 issue（红色感叹号的正确来源）
  const r5 = M.CORE.applySnapshot(r4.state, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜d5｜李逍遥｜散尽家财｜diff\n</yz_meta><yz_space>\n-currency｜灵石\n</yz_space></yz_jade>'), {});
  ok(r5.state.space.currencies.length === 1, '合并后不达标的分区不落盘（旧数据保留）');
  ok(r5.state.sync.issues.some((i) => i.code === 'space.rows'), '不达标分区记 issue 供回声修复');

  // diff 轮不算 full：applyText 的 full 标志为 false（flagsDirty 只能被真全量轮清除）
  const rtHost = fakeHost();
  // 只启封玉牌：其余分区封印，达标判定按已启封集合进行。
  const rt = M.createRuntime(rtHost.api, null, () => ({ msg: false, forum: false, notes: false, market: false, space: false, map: false }));
  await rt.switchChat('chat-1');
  await rt.applyText(jade('fd0', TABLET_OK + MSG_MIN), 'chat-1', 'test');
  const rFull = await rt.applyText(jade('fd1', TABLET_OK.replace('炼气', '筑基') + MSG_MIN), 'chat-1', 'test');
  ok(rFull.full === true, '完整达标 full 轮 full 标志为 true');
  // 部分达标的全量轮不算 full：封印切换/更新后的强制重写必须等真正达标的全量轮才清除标记
  const rPartial = await rt.applyText(jade('fd3', '<yz_tablet>\nfield｜基本｜名字｜赵灵儿\n</yz_tablet>'), 'chat-1', 'test');
  ok(rPartial.full === false, '部分达标 full 轮不算 full');
  const rDiff = await rt.applyText('<yz_jade><yz_meta>\nturn｜fd2｜李逍遥｜迁移｜diff\n</yz_meta><yz_map>\n+current｜落霞峰｜东域｜闭关\n</yz_map></yz_jade>', 'chat-1', 'test');
  ok(rDiff.full === false, 'diff 轮 full 标志为 false');
}

// ---------- P2 · 最新消息保留、基线窗口与世界书归档 ----------
console.log('# P2 · 最新消息保留、基线窗口与世界书归档');
{
  const many = (n, prefix, side) => {
    const rows = [];
    for (let i = 1; i <= n; i += 1) rows.push({ id: prefix + i, side: side || 'other', time: '今日', text: '消息' + i });
    return rows;
  };

  // 1. 超限保留最新：normalizeChats 保尾截断（此前满员时新消息被静默丢弃）
  const chatNorm = M.CORE.normalizeChats({ contacts: [{ id: 'c1', name: '林月如', relation: '道侣', messages: many(30, 'm') }] });
  eq(chatNorm.contacts[0].messages.length, 20, '联系人消息上限 20');
  eq(chatNorm.contacts[0].messages[0].id, 'm11', '超限后最旧消息被淘汰');
  eq(chatNorm.contacts[0].messages[19].id, 'm30', '最新消息保留');

  // 2. full 解析超限：同样保留最新
  let gmsgRows = '';
  for (let i = 7; i <= 30; i += 1) gmsgRows += 'gmsg｜g1｜gm' + i + '｜掌门｜other｜今日｜第' + i + '条\n';
  let contactRows = 'contact｜c1｜林月如｜道侣｜今日｜0｜安好\ncontact｜c2｜酒剑仙｜师尊｜今日｜0｜饮酒\n';
  for (let i = 1; i <= 20; i += 1) contactRows += 'msg｜c1｜m' + i + '｜other｜今日｜第' + i + '条\n';
  contactRows += 'msg｜c2｜m3｜other｜今日｜来喝酒\nmsg｜c2｜m4｜other｜今日｜速来\ngroup｜g1｜青云内门｜30｜今日｜0｜集合\n';
  const fullState = M.CORE.blankState('cap1');
  const cap1 = M.CORE.applySnapshot(fullState, M.PROTOCOL.parse(jade('cap1', '<yz_msg>\n' + contactRows + gmsgRows + '</yz_msg>')), {});
  eq(cap1.state.chats.groups[0].messages.length, 24, '群消息上限 24');
  eq(cap1.state.chats.groups[0].messages[0].id, 'gm7', 'full 超限保留最新（最旧淘汰）');
  ok(cap1.state.chats.groups[0].messages.some((m) => m.id === 'gm30'), 'full 超限最新消息在场');
  eq(cap1.state.chats.contacts[0].messages.length, 20, '联系人消息上限 20');

  // 3. diff 满员追加：多轮后群聊能收到最新消息（用户报障场景）
  const cap2 = M.CORE.applySnapshot(cap1.state, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜cap2｜李逍遥｜新令｜diff\n</yz_meta><yz_msg>\n+gmsg｜g1｜gm31｜长老｜other｜今日｜新令\n</yz_msg></yz_jade>'), {});
  eq(cap2.state.chats.groups[0].messages.length, 24, '满员 +gmsg 后仍保持上限 24');
  ok(cap2.state.chats.groups[0].messages.some((m) => m.id === 'gm31'), '满员时最新群消息被收下');
  ok(!cap2.state.chats.groups[0].messages.some((m) => m.id === 'gm7'), '满员时最旧群消息被淘汰');
  const cap3 = M.CORE.applySnapshot(cap2.state, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜cap3｜李逍遥｜传话｜diff\n</yz_meta><yz_msg>\n+msg｜c1｜m21｜other｜今日｜回话\n</yz_msg></yz_jade>'), {});
  eq(cap3.state.chats.contacts[0].messages.length, 20, '联系人满员 +msg 后仍保持上限 20');
  ok(cap3.state.chats.contacts[0].messages.some((m) => m.id === 'm21'), '联系人消息满员时同样收下最新');
  ok(!cap3.state.chats.contacts[0].messages.some((m) => m.id === 'm1'), '联系人满员时最旧被淘汰');

  // 4. 记事玉册数量统计：文件夹计数按实际笔记派生（不再信任模型声明的 count）
  const noteNorm = M.CORE.normalizeNotes({ folders: [{ id: 'f1', name: '杂记', count: 99 }, { id: 'f2', name: '秘录', count: 0 }], notes: many(2, 'n').map((m) => ({ id: m.id, folderId: 'f1', updated: '今日', locked: false, title: '题' + m.id, body: '文' + m.id })) });
  eq(noteNorm.folders[0].count, 2, '文件夹计数按实际笔记派生（忽略声明值）');
  eq(noteNorm.folders[1].count, 0, '空文件夹计数为 0');
  const noteState = M.CORE.blankState('n1');
  const n0 = M.CORE.applySnapshot(noteState, M.PROTOCOL.parse(jade('n0', '<yz_notes>\nfolder｜f1｜杂记｜99\nfolder｜f2｜秘录｜0\nnote｜n1｜f1｜今日｜false｜约定｜卯时山门\nnote｜n2｜f1｜今日｜false｜心法｜不可外传\nnote｜n3｜f1｜今日｜true｜药方｜三七\nnote｜n4｜f2｜今日｜false｜见闻｜坊市新品\n</yz_notes>')), {});
  eq(n0.state.notes.folders.find((f) => f.id === 'f1').count, 3, 'diff 前文件夹计数与笔记一致');
  const n1 = M.CORE.applySnapshot(n0.state, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜n1｜李逍遥｜补记｜diff\n</yz_meta><yz_notes>\n+note｜n5｜f1｜今日｜false｜新悟｜大道至简\n</yz_notes></yz_jade>'), {});
  eq(n1.state.notes.folders.find((f) => f.id === 'f1').count, 4, '+note 后文件夹计数 +1');
  const n2 = M.CORE.applySnapshot(n1.state, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜n2｜李逍遥｜删记｜diff\n</yz_meta><yz_notes>\n-note｜n1\n</yz_notes></yz_jade>'), {});
  eq(n2.state.notes.folders.find((f) => f.id === 'f1').count, 3, '-note 后文件夹计数 -1');

  // 5. 基线窗口：每实体只注入最近 RECENT_MSG_ROWS 条，超窗部分以 archived 行概括
  const wState = M.CORE.blankState('w1');
  wState.chats = { contacts: [{ id: 'c1', name: '林月如', relation: '道侣', messages: many(20, 'm') }], groups: [] };
  const curW = M.PROMPT.buildCurrent(wState, {});
  eq(curW.filter((r) => r.startsWith('msg｜c1｜')).length, 6, '基线每联系人只注入最近 6 条消息');
  ok(curW.includes('archived｜msg｜c1｜14 条旧消息已归档'), '超窗消息以归档行概括');
  eq(curW.filter((r) => r.startsWith('archived｜')).length, 1, '归档行只出现一次');

  // 6. 基线硬上限：数据再大也逐行淘汰，总注入量封顶
  const huge = M.CORE.blankState('w2');
  const hugeMsgs = [];
  for (let i = 1; i <= 20; i += 1) hugeMsgs.push({ id: 'h' + i, side: 'other', time: '今日', text: '字'.repeat(3000) });
  huge.chats = { contacts: [{ id: 'c1', name: '林月如', messages: hugeMsgs }], groups: [] };
  const curHuge = M.PROMPT.buildCurrent(huge, {});
  ok(curHuge.join('\n').length < 9500, '基线超预算时逐行淘汰，注入量有硬上限');
  ok(curHuge.some((r) => r.startsWith('contact｜c1｜')), '实体标识行永不淘汰');
  ok(curHuge.includes('archived｜msg｜c1｜14 条旧消息已归档'), '归档行不受预算淘汰');

  // 6b. 极端满配态：明细行先淘汰，注入量封顶，标识行永不淘汰
  const maxed = M.CORE.blankState('w3');
  const msgs = (n, text) => Array.from({ length: n }, (_, j) => ({ id: 'm' + j, side: 'other', time: '今日', text }));
  maxed.chats = {
    contacts: Array.from({ length: 10 }, (_, i) => ({ id: 'c' + i, name: '名' + i, messages: msgs(20, '字'.repeat(500)) })),
    groups: Array.from({ length: 6 }, (_, i) => ({ id: 'g' + i, name: '群' + i, messages: msgs(24, '字'.repeat(500)).map((m) => Object.assign({ sender: '人' }, m)) }))
  };
  maxed.notes = {
    folders: Array.from({ length: 10 }, (_, i) => ({ id: 'f' + i, name: '夹' + i })),
    notes: Array.from({ length: 30 }, (_, i) => ({ id: 'n' + i, folderId: 'f' + (i % 10), title: '题' + i, body: '字'.repeat(500) }))
  };
  maxed.market.orders = Array.from({ length: 12 }, (_, i) => ({ id: 'o' + i, name: '丹' + '字'.repeat(130), status: '进行中', price: '1000', time: '今日', side: 'buy' }));
  maxed.space.currencies = Array.from({ length: 10 }, (_, i) => ({ kind: '币种' + i, amount: '9'.repeat(10) }));
  maxed.map.current = { place: '青云山', domain: '中州', desc: '字'.repeat(800) };
  maxed.map.tracks = Array.from({ length: 20 }, (_, i) => ({ id: 't' + i, time: '今日', place: '地' + i, action: '字'.repeat(100) }));
  const curMaxed = M.PROMPT.buildCurrent(maxed, {});
  ok(curMaxed.join('\n').length < 9500, '极端满配态注入量仍受上限约束');
  ok(curMaxed.some((r) => r.startsWith('contact｜c0｜')), '满配态实体标识行仍在');
  ok(curMaxed.some((r) => r.startsWith('order｜o0｜')), '满配态订单行仍在（不可淘汰）');

  // 6c. 明细行耗尽仍超限时归档摘要行为最后防线（全部让位，实体标识行保留）
  const maxed2 = M.CORE.blankState('w3');
  const msgs2 = (n, text) => Array.from({ length: n }, (_, j) => ({ id: 'm' + j, side: 'other', time: '今日', text }));
  maxed2.chats = {
    contacts: Array.from({ length: 10 }, (_, i) => ({ id: 'c' + i, name: '名' + i, messages: msgs2(20, '短讯') })),
    groups: Array.from({ length: 6 }, (_, i) => ({ id: 'g' + i, name: '群' + i, messages: msgs2(24, '短讯').map((m) => Object.assign({ sender: '人' }, m)) }))
  };
  maxed2.notes = { folders: Array.from({ length: 10 }, (_, i) => ({ id: 'f' + i, name: '夹' + i })), notes: [] };
  maxed2.market.orders = Array.from({ length: 12 }, (_, i) => ({ id: 'o' + i, name: '丹' + '字'.repeat(130), status: '进行中', price: '1000', time: '今日', side: 'buy' }));
  maxed2.space.currencies = Array.from({ length: 10 }, (_, i) => ({ kind: '币种' + i, amount: '9'.repeat(10) }));
  maxed2.map.current = { place: '青云山', domain: '中州', desc: '字'.repeat(800) };
  maxed2.map.tracks = Array.from({ length: 20 }, (_, i) => ({ id: 't' + i, time: '今日', place: '地' + i, action: '字'.repeat(150) }));
  const curMaxed2 = M.PROMPT.buildCurrent(maxed2, {});
  ok(curMaxed2.join('\n').length < 9500, '归档行让位后注入量收敛到上限内');
  ok(curMaxed2.some((r) => r.startsWith('contact｜c0｜')), '归档行让位后实体标识行仍在');
  ok(curMaxed2.some((r) => r.startsWith('track｜t0｜')), '归档行让位后舆图行仍在（不可淘汰）');

  // 6d. tablet 字段行末位淘汰：长字段值不会撑爆上限
  const bigTab = M.CORE.blankState('w4');
  bigTab.tablet.groups = [{ id: 'basic', fields: Array.from({ length: 11 }, (_, i) => ({ key: '字段' + i, value: '字'.repeat(3000) })) }];
  const curTab = M.PROMPT.buildCurrent(bigTab, {});
  ok(curTab.join('\n').length < 9500, '长玉牌字段值同样受上限约束');

  // 7. 提示词规则：归档条目只删不整行替换
  const pArch = M.PROMPT.buildPrompt('zh', {}, { forceFull: false, issues: [], current: curW });
  ok(pArch.includes('archived 行是正文未注入的归档旧数据'), 'diff 提示词含归档行规则');
  ok(M.PROMPT.buildPrompt('en', {}, { forceFull: false, issues: [], current: curW }).includes('archived rows mark older data'), 'en 提示词含归档行规则');
  ok(M.PROMPT.buildPrompt('zh', {}, { forceFull: true, issues: [], current: curW }).includes('archived 行是正文未注入的归档旧数据'), 'full 轮同样遵守归档规则');
  ok(M.PROMPT.buildPrompt('zh', {}, { forceFull: true, current: curW }).includes('时间字段仍为相对表述'), 'full 轮强制改写相对时间为绝对日期');
  ok(M.PROMPT.buildPrompt('en', {}, { forceFull: true, current: curW }).includes('rewritten to absolute dates'), 'en full 轮强制改写相对时间');
  ok(!M.PROMPT.buildPrompt('zh', {}, { forceFull: false, current: curW }).includes('时间字段仍为相对表述'), 'diff 轮不强制改写时间（只改剧情相关行）');

  // 8. 世界书归档：窗口外历史镜像成关键词条目并挂接聊天
  const ah = fakeHost();
  const art = M.createRuntime(ah.api, null, () => ({}));
  await art.switchChat('chat-1');
  await art.applyText(jade('a1', MSG_ARCH), 'chat-1', 'test');
  await art.syncArchive('chat-1');
  const books = ah.lorebooks();
  eq(books.length, 1, '归档建书一次');
  eq(books[0].name, '玉兆档案·chat-1', '书名带聊天标识');
  const entries = books[0].entries;
  ok(entries.length === 3, '归档条目 + 全状态快照条目');
  const snapEntry = entries.find((e) => e.identifier === 'yz-snap');
  ok(snapEntry && snapEntry.enabled === false, '快照条目为禁用备份（永不注入）');
  ok(JSON.parse(snapEntry.content).chats.contacts.some((c) => c.id === 'c1'), '快照内容为整份状态');
  const cEntry = entries.find((e) => e.identifier === 'yz-c-c1');
  ok(cEntry && cEntry.keywords.indexOf('林月如') >= 0, '关键词为实体名');
  ok(cEntry.strategy === 'keyword' && cEntry.scanDepth === 4, '条目为关键词触发');
  ok(cEntry.content.includes('勿念') && cEntry.content.includes('别忘'), '归档含窗口外旧消息');
  ok(!cEntry.content.includes('七窍玲珑') && !cEntry.content.includes('八荒来朝'), '最近窗口消息不进归档（不重复注入）');
  const gEntry = entries.find((e) => e.identifier === 'yz-g-g1');
  ok(gEntry && gEntry.keywords.indexOf('青云内门') >= 0 && gEntry.content.includes('卯时议事'), '群归档条目含旧群消息');
  const attaches = ah.chatUpdates();
  eq(attaches.length, 1, '挂接当前聊天一次');
  ok(Array.isArray(attaches[0].lorebooks) && attaches[0].lorebooks[0] === books[0].id, '挂接含归档书 id 且不覆盖既有');

  // 窗口滑动后再次同步：不重复建书、条目内容跟随滑动
  await art.applyText('<yz_jade><yz_meta>\nturn｜a2｜李逍遥｜传讯｜diff\n</yz_meta><yz_msg>\n+msg｜c1｜m9｜other｜今日｜九重天阙\n</yz_msg></yz_jade>', 'chat-1', 'test');
  await art.syncArchive('chat-1');
  eq(ah.lorebooks().length, 1, '再次同步不重复建书');
  const cEntry2 = ah.lorebooks()[0].entries.find((e) => e.identifier === 'yz-c-c1');
  ok(cEntry2.content.includes('三事') && !cEntry2.content.includes('七窍玲珑'), '窗口滑动后新归档消息进入条目');
  eq(ah.chatUpdates().length, 1, '已挂接不再重复调用 chat.update');

  // 无世界书能力：归档静默降级，不抛错
  const ah2 = fakeHost();
  const art2 = M.createRuntime({ get: ah2.api.get, set: ah2.api.set, chat: ah2.api.chat, message: ah2.api.message }, null, () => ({}));
  await art2.switchChat('chat-1');
  const degraded = await art2.syncArchive('chat-1');
  eq(degraded.ok, false, '无世界书能力时归档降级不报错');

  // 窗口内消息不足（≤6 条）：无归档条目，但同步过的聊天仍建快照书（备份层）
  const ah3 = fakeHost();
  const art3 = M.createRuntime(ah3.api, null, () => ({}));
  await art3.switchChat('chat-1');
  await art3.applyText(jade('a3', MSG_MIN), 'chat-1', 'test');
  await art3.syncArchive('chat-1');
  eq(ah3.lorebooks().length, 1, '同步过的聊天建快照书');
  const snapOnly = ah3.lorebooks()[0].entries;
  ok(snapOnly.length === 1 && snapOnly[0].identifier === 'yz-snap', '仅有快照条目无归档条目');
  eq(ah3.chatUpdates().length, 1, '快照书同样挂接当前聊天');

  // 封印交流讯息：不生成归档条目
  const ah4 = fakeHost();
  const art4 = M.createRuntime(ah4.api, null, () => ({ msg: false }));
  const sealedState = M.CORE.blankState('a4');
  sealedState.chats = { contacts: [{ id: 'c1', name: '林月如', messages: many(8, 'm') }], groups: [] };
  eq(art4.buildArchiveEntries(sealedState).length, 0, '封印交流讯息不归档');
}

// ---------- P3 · 版本迁移与备份恢复 ----------
console.log('# P3 · 版本迁移与备份恢复');
{
  // 1. 版本变化 → 持久化强制全量标记；全量轮成功后清除，diff 轮不清除
  const vh = fakeHost();
  const oldState = M.CORE.blankState('chat-1');
  oldState.revision = 5;
  oldState.pluginVersion = '2.0.2';
  oldState.chats = { contacts: [{ id: 'c1', name: '林月如', messages: [{ id: 'm1', side: 'other', time: '今日', text: '旧消息' }] }], groups: [] };
  vh.seedChat(M.STATE_KEY, JSON.stringify(oldState));
  const vrt = M.createRuntime(vh.api, null, () => ({}));
  await vrt.switchChat('chat-1');
  eq(vrt.current().pluginVersion, M.PLUGIN_VERSION, '更新后版本号立即落盘');
  eq(vrt.current().pendingFull, true, '版本变化置持久化强制全量标记');

  const FULL_V = jade('v1', TABLET_OK
    + '<yz_msg>\ncontact｜c1｜林月如｜道侣｜今日｜0｜安好\ncontact｜c2｜酒剑仙｜师尊｜今日｜2｜饮酒\nmsg｜c1｜m1｜other｜昨日｜勿念\nmsg｜c1｜m2｜self｜今日｜定当赴约\nmsg｜c2｜m3｜other｜今日｜来喝酒\nmsg｜c2｜m4｜other｜今日｜速来\ngroup｜g1｜青云内门｜30｜今日｜5｜集合\ngmsg｜g1｜gm1｜掌门｜other｜今日｜卯时议事\ngmsg｜g1｜gm2｜长老｜other｜今日｜不得迟到\ngmsg｜g1｜gm3｜弟子｜other｜今日｜收到\n</yz_msg>'
    + '<yz_notes>\nfolder｜f1｜杂记｜2\nfolder｜f2｜秘录｜1\nnote｜n1｜f1｜今日｜false｜约定｜卯时山门\nnote｜n2｜f2｜今日｜true｜心法｜不可外传\nnote｜n3｜f1｜昨日｜false｜见闻｜坊市有新品灵草\n</yz_notes>'
    + '<yz_forum>\npost｜p1｜掌门｜长老｜公告｜今日｜议事｜卯时集合｜3\ncomment｜p1｜长老｜今日｜已知\ncomment｜p1｜弟子｜今日｜恭候\npost｜p2｜长老｜长老｜闲聊｜昨日｜论剑｜切磋记录｜1\ncomment｜p2｜弟子｜昨日｜围观\n</yz_forum>'
    + '<yz_market>\nlisting｜l1｜灵草｜下品｜百年份｜10灵石｜坊主\nauction｜a1｜古剑｜上品｜锈蚀｜100｜150｜1时辰｜3\norder｜o1｜符纸｜已成交｜5灵石｜今日｜买\n</yz_market>'
    + '<yz_space>\ncurrency｜灵石｜120\nitem｜i1｜养神丹｜2｜中品｜宁神益气\nitem｜i2｜驱邪符｜5｜下品｜辟邪护身\n</yz_space>'
    + '<yz_map>\ncurrent｜青云山｜东域｜山门所在\ntrack｜t1｜昨日｜山门｜入门\ntrack｜t2｜今日｜演武场｜晨练\n</yz_map>');
  const vr1 = await vrt.applyText(FULL_V, 'chat-1', 'test');
  ok(vr1.changed, '更新后全量轮应用成功');
  eq(vrt.current().sync.status, 'complete', '更新后全量轮完整达标');
  eq(vrt.current().pendingFull, false, '全量轮成功后清除强制全量标记');

  const diffSnap = '<yz_jade><yz_meta>\nturn｜v2｜李逍遥｜增量｜diff\n</yz_meta><yz_msg>\n+msg｜c1｜m9｜other｜丙午年五月十二 午时｜新消息\n</yz_msg></yz_jade>';
  const vr2 = await vrt.applyText(diffSnap, 'chat-1', 'test');
  ok(vr2.changed, '后续 diff 轮应用成功');
  eq(vrt.current().pendingFull, false, 'diff 轮不清除（已清除状态保持）');

  // 2. normalizeState 保留版本字段与标记
  const ns = M.CORE.normalizeState({ pluginVersion: '2.1.0', pendingFull: true }, 'chat-1');
  eq(ns.pluginVersion, '2.1.0', 'normalizeState 保留版本号');
  eq(ns.pendingFull, true, 'normalizeState 保留强制全量标记');

  // 3. 宿主 chat 存储被清（卸载场景）→ 全局备份兜底恢复并回写
  const gh = fakeHost();
  const gs = M.CORE.blankState('chat-1');
  gs.revision = 3;
  gs.chats = { contacts: [{ id: 'c1', name: '林月如', messages: [{ id: 'm1', side: 'other', time: '丙午年五月十二 午时', text: '重要消息' }] }], groups: [] };
  gh.seedGlobal(M.BACKUP_PREFIX + 'chat-1', JSON.stringify(gs));
  const grt = M.createRuntime(gh.api, null, () => ({}));
  await grt.switchChat('chat-1');
  eq(grt.current().revision, 3, 'chat 存储被清后从全局备份恢复');
  eq(grt.current().chats.contacts[0].messages[0].text, '重要消息', '恢复的数据完整');
  ok(gh.chatKeys().indexOf(M.STATE_KEY) >= 0, '备份恢复后回写宿主 chat 键');
  eq(grt.current().pendingFull, true, '恢复后版本变化仍触发强制全量');

  // 4. 宿主存储全清（卸载重装）→ 世界书快照恢复
  const sh = fakeHost();
  const srt = M.createRuntime(sh.api, null, () => ({}));
  await srt.switchChat('chat-1');
  await srt.applyText(jade('s1', MSG_ARCH), 'chat-1', 'test');
  await srt.syncArchive('chat-1');
  eq(sh.lorebooks().length, 1, '快照建书一次');
  sh.clearChat();
  sh.clearGlobal();
  const srt2 = M.createRuntime(sh.api, null, () => ({}));
  await srt2.switchChat('chat-1');
  eq(srt2.current().revision, 1, '宿主存储全清后从世界书快照恢复');
  ok(srt2.current().chats.contacts.some((c) => c.id === 'c1'), '快照恢复的联系人完整');
  ok(sh.chatKeys().indexOf(M.STATE_KEY) >= 0, '快照恢复后回写宿主 chat 键');

  // 5. 零同步数据聊天（revision 0）不建快照书
  const eh = fakeHost();
  const ert = M.createRuntime(eh.api, null, () => ({}));
  await ert.switchChat('chat-1');
  await ert.syncArchive('chat-1');
  eq(eh.lorebooks().length, 0, '零同步数据聊天不建快照书');
}

// ---------- 双玉兆 · 玩家域与传讯通道（一期核心）----------
console.log('# 双玉兆 · 玩家域与传讯通道');
{
  // CORE：玩家域空白/归一结构——无模型域字段、无论坛（公开数据不入玩家域存储）
  const ps = M.CORE.blankPlayerState('pc1');
  eq(ps.chatId, 'pc1', '空白玩家域带聊天标识');
  ok(!('sync' in ps) && !('revision' in ps) && !('processedTurns' in ps) && !('hydration' in ps) && !('forum' in ps), '玩家域无模型域字段与论坛');
  const pn = M.CORE.normalizePlayerState({
    sync: { status: 'complete' }, revision: 99, processedTurns: ['x'], pendingFull: true,
    chats: { contacts: [{ id: M.CORE.PLAYER_THREAD_ID, name: '李逍遥', messages: [{ id: 'pm-1', side: 'self', time: '2026-08-29', text: '在吗' }] }], groups: [] },
    market: { orders: [{ id: 'o1', name: '灵丹', status: '已拍下', price: '5', time: 'x', side: 'buy' }] },
    forum: { posts: [{ id: 'p1', author: 'a', title: 't', body: 'b' }] }
  }, 'pc2');
  eq(pn.chatId, 'pc2', '玩家域归一保留聊天标识');
  ok(!('sync' in pn) && !('revision' in pn) && !('processedTurns' in pn) && !('hydration' in pn) && !('pendingFull' in pn) && !('forum' in pn), '玩家域归一剥离模型域字段与论坛');
  ok(!('forum' in pn), '玩家域归一剥离论坛');
  eq(pn.chats.contacts[0].id, M.CORE.PLAYER_THREAD_ID, '玩家线程联系人保留');
  eq(pn.market.orders.length, 1, '玩家域坊市订单归一');

  // assessMsg 豁免：玩家联系人（单消息线程）不拉低角色域达标度，也不凑联系人数
  const playerContact = { id: M.CORE.PLAYER_CONTACT_ID, name: '道友', messages: [{ id: 'pm-1', side: 'other', time: 'x', text: '在吗' }], preview: '', unread: 1 };
  const contact2 = (id, msgs) => ({ id, name: id, messages: msgs.map((m, i) => ({ id, side: 'other', time: 'x', text: m + i })), preview: '' });
  const exemptChats = {
    contacts: [playerContact, contact2('c1', ['a', 'b']), contact2('c2', ['c', 'd'])],
    groups: [{ id: 'g1', name: '青云内门', members: 3, messages: [{ id: 'gm1', side: 'other', text: 'a' }, { id: 'gm2', side: 'other', text: 'b' }] }]
  };
  eq(M.CORE.assess({ version: 1, turn: { id: 't1', roleName: 'r', summary: 's' }, chats: exemptChats }, {}).msg.contacts, true, '玩家联系人豁免：单消息线程不破坏联系人达标');
  const onlyOne = { contacts: [playerContact, contact2('c1', ['a', 'b'])], groups: exemptChats.groups };
  eq(M.CORE.assess({ version: 1, turn: { id: 't2', roleName: 'r', summary: 's' }, chats: onlyOne }, {}).msg.contacts, false, '玩家联系人不凑联系人数（真实缺口仍暴露）');
}

{
  // Runtime：发讯 → 玩家线程 + 角色域 yz-player 联系人；幂等；注入即已读；回复镜像
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-1');
  await rt.applyText(jade('t1', TABLET_OK + MSG_MIN), 'chat-1', 'test');

  const sent = rt.sendPlayerMessage('chat-1', '道友可在？');
  ok(sent && /^pm-\d+$/.test(sent.id), '发送返回玩家消息 id');
  await rt.syncPlayerChannel('chat-1');
  const player = rt.playerCurrent();
  eq(player.chats.contacts.length, 1, '玩家域创建固定角色会话');
  eq(player.chats.contacts[0].id, M.CORE.PLAYER_THREAD_ID, '玩家线程 id 固定');
  const pc = rt.current().chats.contacts.find((c) => c.id === M.CORE.PLAYER_CONTACT_ID);
  ok(pc, '角色域创建 yz-player 联系人');
  eq(pc.messages.length, 1, '玩家消息投递角色域');
  eq(pc.messages[0].id, sent.id, '消息 id 跨域一致（幂等）');
  eq(pc.messages[0].side, 'other', '角色视角为收到的消息');
  eq(pc.unread, 1, '未读数 = 已投递未读消息数');

  await rt.syncPlayerChannel('chat-1');
  eq(rt.current().chats.contacts.find((c) => c.id === M.CORE.PLAYER_CONTACT_ID).messages.length, 1, '重复同步幂等（无副本）');

  rt.markPlayerRead('chat-1');
  eq(rt.current().sync.playerReadCursor, 1, '已读游标推进到 seq 1');
  eq(rt.current().chats.contacts.find((c) => c.id === M.CORE.PLAYER_CONTACT_ID).unread, 0, '注入即已读，未读清零');

  await rt.applyText('<yz_jade><yz_meta>\nturn｜t2｜李逍遥｜回复｜diff\n</yz_meta><yz_msg>\n+msg｜yz-player｜r1｜self｜丙午年五月十二 午时｜在的\n</yz_msg></yz_jade>', 'chat-1', 'test');
  const thread = rt.playerThread(rt.playerCurrent());
  eq(thread.messages.length, 2, '角色回复镜像回玩家线程');
  ok(thread.messages.some((m) => m.id === 'r1' && m.side === 'other' && m.reply === true), '回复以角色消息形态出现');
  const pv = M.VIEWS.renderMsgPlayer(rt.current(), rt.playerCurrent(), { app: 'msg', view: 'chat', params: { id: M.CORE.PLAYER_THREAD_ID }, stack: [] }, '');
  ok(pv.includes(zhCatalog['runtime.player.statusReplied']), '已回状态渲染');
  ok(pv.includes('data-msg-input') && pv.includes('data-action="send-msg"'), '会话页渲染传讯输入框');
  ok(pv.includes('丙午年五月十二 午时'), '回复时间渲染');

  rt.sendPlayerMessage('chat-1', '第二句');
  await rt.syncPlayerChannel('chat-1');
  eq(rt.current().chats.contacts.find((c) => c.id === M.CORE.PLAYER_CONTACT_ID).unread, 1, '新消息未读数为 1');
  const pv2 = M.VIEWS.renderMsgPlayer(rt.current(), rt.playerCurrent(), { app: 'msg', view: 'chat', params: { id: M.CORE.PLAYER_THREAD_ID }, stack: [] }, '');
  ok(pv2.includes(zhCatalog['runtime.player.statusSent']), '未读未回消息显示已送达');

  // 历史重建（角色域从协议历史重建）→ 玩家传讯重新投递，玩家线程保留
  host.setHistory([{ id: 'm1', role: 'assistant', content: jade('h1', TABLET_OK) }]);
  await rt.rebuildFromHistory('chat-1');
  const pc2 = rt.current().chats.contacts.find((c) => c.id === M.CORE.PLAYER_CONTACT_ID);
  ok(pc2 && pc2.messages.length === 2, '历史重建后玩家传讯重新投递角色域');
  eq(rt.playerThread(rt.playerCurrent()).messages.length, 3, '玩家线程数据在重建后完整保留');
}

{
  // Runtime：玩家域三层存储（宿主/镜像/备份），宿主清空后可恢复，不涉及世界书
  const host = fakeHost();
  host.current.chat = 'chat-s';
  const store = new Map();
  const local = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  const rt = M.createRuntime(host.api, local, () => ({}));
  await rt.switchChat('chat-s');
  rt.sendPlayerMessage('chat-s', '存储测试');
  await rt.syncPlayerChannel('chat-s');
  await flushQueue();
  ok(store.has(rt.PLAYER_LOCAL_PREFIX + 'chat-s'), '玩家域写入本地镜像');
  ok(!!host.api.get(rt.PLAYER_STATE_KEY, 'chat'), '玩家域写入宿主 chat 键');
  ok(!!host.api.get(rt.PLAYER_BACKUP_PREFIX + 'chat-s', 'global'), '玩家域写入全局备份');
  eq(host.lorebooks().length, 0, '玩家域数据不进世界书');
  host.clearChat();
  host.clearGlobal();
  const rt2 = M.createRuntime(host.api, local, () => ({}));
  await rt2.switchChat('chat-s');
  eq(rt2.playerThread(rt2.playerCurrent()).messages.length, 1, '宿主清空后玩家域从本地镜像恢复');
}

{
  // buildCurrent：未读行注入上限 + 已读窗口 + 未读行预算优先级
  const st = M.CORE.blankState('w5');
  st.chats = { contacts: [{ id: M.CORE.PLAYER_CONTACT_ID, name: '道友', relation: '外界', unread: 7, preview: 'x', messages: [] }], groups: [] };
  for (let i = 1; i <= 7; i += 1) st.chats.contacts[0].messages.push({ id: 'pm-' + i, side: 'other', time: 'x', text: '消息' + i });
  st.sync.playerReadCursor = 2;
  const cur = M.PROMPT.buildCurrent(st, {});
  eq(cur.filter((r) => r.startsWith('msg｜yz-player｜')).length, 7, '已读 2 条 + 未读 5 条共 7 行全注入');
  eq(cur.filter((r) => /msg｜yz-player｜pm-[3-7]/.test(r)).length, 5, '未读 5 条全注入（≤ 上限 5）');
  ok(!cur.some((r) => r.startsWith('unread｜yz-player｜')), '未读未超上限无摘要行');
  st.chats.contacts[0].messages.push({ id: 'pm-8', side: 'other', time: 'x', text: '八' });
  const cur2 = M.PROMPT.buildCurrent(st, {});
  eq(cur2.filter((r) => r.startsWith('msg｜yz-player｜')).length, 7, '已读窗口 2 条 + 未读上限 5 条');
  eq(cur2.filter((r) => r.startsWith('msg｜yz-player｜pm-8')).length, 1, '超限时最新未读仍全行注入');
  ok(cur2.some((r) => r.startsWith('unread｜yz-player｜')), '超上限生成未读摘要行');
  st.sync.playerReadCursor = 99;
  const cur3 = M.PROMPT.buildCurrent(st, {});
  eq(cur3.filter((r) => r.startsWith('msg｜yz-player｜')).length, 6, '全部已读后按最近窗口 6 条注入');
  ok(cur3.some((r) => r.startsWith('archived｜msg｜yz-player｜')), '已读超窗出归档行');

  // 未读行预算优先级：长未读消息在明细行被淘汰后仍保留
  const big = M.CORE.blankState('w6');
  big.chats = {
    contacts: [
      { id: M.CORE.PLAYER_CONTACT_ID, name: '道友', unread: 1, preview: '', messages: [{ id: 'pm-1', side: 'other', time: 'x', text: '未读'.repeat(1500) }] },
      { id: 'c1', name: '林月如', preview: '', messages: Array.from({ length: 20 }, (_, j) => ({ id: 'm' + j, side: 'other', time: 'x', text: '字'.repeat(500) })) }
    ],
    groups: []
  };
  const curBig = M.PROMPT.buildCurrent(big, {});
  ok(curBig.some((r) => r.startsWith('msg｜yz-player｜pm-1')), '未读行不被预算淘汰');
  ok(curBig.join('\n').length < 9500, '未读行保留时总注入仍受上限约束');

  // 提示词：玩家通道规则（zh/en/full/封印）
  const pChan = M.PROMPT.buildPrompt('zh', {}, { forceFull: false, current: [] });
  ok(pChan.includes('yz-player') && pChan.includes('+msg｜yz-player｜新消息id'), 'zh 提示词含玩家通道回复格式');
  const pChanFull = M.PROMPT.buildPrompt('zh', {}, { forceFull: true, current: [] });
  ok(pChanFull.includes('yz-player'), 'full 轮同样含玩家通道规则');
  const pChanEn = M.PROMPT.buildPrompt('en', {}, { forceFull: false, current: [] });
  ok(pChanEn.includes('yz-player') && pChanEn.includes('+msg｜yz-player｜new-message-id'), 'en 提示词含玩家通道规则');
  const pSealed = M.PROMPT.buildPrompt('zh', { msg: false }, { forceFull: false, current: [] });
  ok(!pSealed.includes('yz-player'), '封印 msg 后无玩家通道规则');
}

{
  // 视图：域切换、公开数据标识、玩家域页面、{{user}} 解析
  const cs = M.CORE.blankState('c1');
  cs.sync = { status: 'complete', roleName: '李逍遥', summary: 's', applied: [], appliedSeen: [], issues: [], updatedAt: 1 };
  const ps = M.CORE.blankPlayerState('c1');
  const home = M.VIEWS.renderHome(cs, {}, { domain: 'player', playerState: ps, playerName: '悦琳' });
  ok(home.includes('悦琳') && home.includes(zhCatalog['runtime.player.homeInfo']), '玩家域主界面展示玩家名与说明');
  ok(home.includes(zhCatalog['runtime.player.sentWord']), '玩家域主界面展示传讯状态行');
  ok(/sealed[^>]{0,200}data-feature="manage"/.test(home), '玩家域管理卦位封印');
  const charHome = M.VIEWS.renderHome(cs, {}, {});
  ok(charHome.includes('data-action="sync-detail"'), '角色域主界面保留同步入口');
  const manageSealed = M.VIEWS.renderNodes({}, cs, { manage: true });
  ok(manageSealed.includes('t-rock sealed'), 'renderNodes 支持玩家域锁定封印');

  const pTablet = M.VIEWS.renderPage(cs, { app: 'tablet' }, {}, {}, 'player', ps);
  ok(pTablet.includes('data-marker="tablet"'), '玩家域玉牌页正常渲染');
  ok(pTablet.includes(zhCatalog['runtime.player.emptyPrivate']), '玩家域玉牌空态用本机维护文案');
  const pTabletChar = M.VIEWS.renderPage(cs, { app: 'tablet' }, {}, {}, 'character', ps);
  ok(!pTabletChar.includes(zhCatalog['runtime.player.emptyPrivate']), '角色域玉牌空态不受玩家域文案影响');
  const pForum = M.VIEWS.renderPage(cs, { app: 'forum' }, {}, {}, 'player', ps);
  ok(pForum.includes('data-marker="forum-list"') && pForum.includes(zhCatalog['runtime.player.publicTag']), '论坛跨域渲染角色数据并带公开标识');
  const pOrders = M.VIEWS.renderPage(cs, { app: 'market', view: 'orders' }, {}, {}, 'player', ps);
  ok(!pOrders.includes(zhCatalog['runtime.player.publicTag']), '坊市订单是私有数据无公开标识');
  const pListings = M.VIEWS.renderPage(cs, { app: 'market', view: 'listings' }, {}, {}, 'player', ps);
  ok(pListings.includes(zhCatalog['runtime.player.publicTag']), '坊市行情是公开数据带标识');
  const pMsg = M.VIEWS.renderPage(cs, { app: 'msg' }, {}, {}, 'player', ps);
  ok(pMsg.includes(zhCatalog['runtime.player.startThread']) && pMsg.includes('data-marker="player-chats"'), '未建立会话时显示首讯入口');

  const noPersonaHost = fakeHost();
  const noPersona = M.createRuntime(noPersonaHost.api, null, () => ({}));
  await noPersona.switchChat('c1');
  eq(await noPersona.resolvePlayerName(), zhCatalog['runtime.player.fallbackName'], '无用户身份时回退 catalog 文案');
  const personaHost = fakeHost();
  personaHost.api.chat.current = async () => ({ id: personaHost.current.chat, persona: { name: '悦琳' } });
  const withPersona = M.createRuntime(personaHost.api, null, () => ({}));
  await withPersona.switchChat('c1');
  eq(await withPersona.resolvePlayerName(), '悦琳', '{{user}} 解析为宿主用户身份名');
}

// ---------- 玩家域 CRUD（二期）：直写、校验、级联 ----------
console.log('# 玩家域 CRUD（二期）');
{
  // CORE 纯函数：id 生成确定性、实体查找
  eq(M.CORE.playerNextId([], 'pn-'), 'pn-1', '空集合 id 从 1 开始');
  eq(M.CORE.playerNextId([{ id: 'pn-1' }, { id: 'pn-3' }], 'pn-'), 'pn-4', 'id 取集合最大编号 +1');
  eq(M.CORE.playerNextId([{ id: 'pm-9' }], 'pn-'), 'pn-1', '前缀不混（pm- 不算 pn-）');
  const findSt = M.CORE.blankPlayerState('f');
  findSt.notes = { folders: [{ id: 'pf-1', name: '杂记' }], notes: [] };
  eq(M.CORE.playerFindEntity(findSt, 'folder', 'pf-1').name, '杂记', 'playerFindEntity 按 id 查找');
  eq(M.CORE.playerFindEntity(findSt, 'folder', 'pf-x'), null, '找不到返回 null');
  eq(M.CORE.playerFindEntity(findSt, 'nope', 'x'), null, '未知 kind 返回 null');
}

{
  // Runtime CRUD：创建/编辑/校验/重命名/删除级联；绝不触碰角色域
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-1');
  const p = () => rt.playerCurrent();

  // 玉册夹：创建 + 必填校验 + 编辑
  eq(rt.playerSaveEntity('folder', { name: '杂记' }, ''), { ok: true }, '创建玉册夹成功');
  eq(p().notes.folders.length, 1, '玉册夹落盘玩家域');
  eq(p().notes.folders[0].id, 'pf-1', '玉册夹 id 从 pf-1 开始');
  eq(rt.playerSaveEntity('folder', { name: '秘录' }, '').ok, true, '创建第二个玉册夹');
  eq(rt.playerSaveEntity('folder', { name: '' }, '').reason, 'name', '空名称拒绝保存');
  eq(rt.playerSaveEntity('folder', { name: '杂记改' }, 'pf-1').ok, true, '编辑玉册夹成功');
  eq(p().notes.folders[0].name, '杂记改', '玉册夹名称已更新');

  // 备忘：归属校验 + 锁定 + 文件夹计数派生
  eq(rt.playerSaveEntity('note', { title: '约定', body: '卯时山门', folderId: 'pf-1', locked: true }, '').ok, true, '创建备忘成功');
  eq(p().notes.notes.length, 1, '备忘落盘');
  eq(p().notes.notes[0].id, 'pn-1', '备忘 id 从 pn-1 开始');
  eq(p().notes.notes[0].locked, true, '锁定标记保存');
  eq(rt.playerSaveEntity('note', { title: 'x', folderId: 'pf-99' }, '').reason, 'folder', '不存在父玉册夹拒绝保存');
  eq(p().notes.folders.find((f) => f.id === 'pf-1').count, 1, '文件夹计数按笔记派生');
  eq(rt.playerSaveEntity('note', { title: '', folderId: 'pf-1' }, '').reason, 'title', '空标题拒绝保存');
  eq(rt.playerSaveEntity('note', { title: '改', body: '新文', folderId: 'pf-1', locked: false }, 'pn-1').ok, true, '编辑备忘成功');
  eq(p().notes.notes[0].body, '新文', '备忘正文已更新');

  // 芥子空间：物品/钱财创建、编辑、货币重命名（种类为键）
  eq(rt.playerSaveEntity('item', { name: '养神丹', qty: 2, grade: '中品', desc: '宁神' }, '').ok, true, '创建物品成功');
  eq(p().space.items[0].id, 'pi-1', '物品 id 从 pi-1 开始');
  eq(rt.playerSaveEntity('item', { name: '养神丹', qty: 5, grade: '上品', desc: '大补' }, 'pi-1').ok, true, '编辑物品成功');
  eq(p().space.items[0].qty, 5, '物品数量已更新');
  eq(rt.playerSaveEntity('currency', { kind: '灵石', amount: '100' }, '').ok, true, '创建钱财成功');
  eq(rt.playerSaveEntity('currency', { kind: '仙晶', amount: '3' }, '灵石').ok, true, '货币重命名（旧种类移除）');
  eq(p().space.currencies.length, 1, '货币重命名不产生副本');
  eq(p().space.currencies[0].kind, '仙晶', '货币种类已更新');
  eq(rt.playerSaveEntity('currency', { kind: '', amount: '1' }, '').reason, 'kind', '空种类拒绝保存');

  // 坊市订单：创建 + 方向归一 + 编辑
  eq(rt.playerSaveEntity('order', { name: '符纸', status: '已拍下', price: '5灵石', side: 'sell' }, '').ok, true, '创建订单成功');
  eq(p().market.orders[0].id, 'po-1', '订单 id 从 po-1 开始');
  eq(p().market.orders[0].side, 'sell', '卖出方向归一');
  eq(rt.playerSaveEntity('order', { name: '符纸', status: '已完成', price: '5灵石', side: 'buy' }, 'po-1').ok, true, '编辑订单成功');
  eq(p().market.orders[0].status, '已完成', '订单状态已更新');
  eq(rt.playerSaveEntity('order', { name: '', side: 'buy' }, '').reason, 'name', '空物品名拒绝保存');
  eq(rt.playerSaveEntity('badkind', {}, '').reason, 'kind', '未知 kind 拒绝');

  // 删除：玉册夹级联其下备忘；missing 拒删
  eq(rt.playerDeleteEntity('note', 'pn-1').ok, true, '删除备忘成功');
  eq(p().notes.notes.length, 0, '备忘已删除');
  eq(rt.playerDeleteEntity('folder', 'pf-1').ok, true, '删除玉册夹成功');
  eq(p().notes.folders.length, 1, '玉册夹已删除');
  ok(!p().notes.notes.some((n) => n.folderId === 'pf-1'), '删除玉册夹级联删除其下备忘');
  eq(rt.playerDeleteEntity('folder', 'pf-9').ok, false, '找不到的实体拒绝删除');

  // CRUD 绝不触碰角色域：角色域 chats/notes 保持空白
  eq(rt.current().chats.contacts.length, 0, '玩家域 CRUD 不写角色域聊天数据');
  eq(rt.current().notes.folders.length, 0, '玩家域 CRUD 不写角色域玉册');

  // 持久化：CRUD 落盘三层存储，重载可恢复
  await flushQueue();
  const host2 = fakeHost();
  const rt2 = M.createRuntime(host2.api, null, () => ({}));
  await rt2.switchChat('chat-1');
  eq(rt2.playerCurrent().notes.folders.length, 0, '新宿主无玩家域数据');
}

{
  // 持久化恢复：同一宿主三层存储链
  const host = fakeHost();
  host.current.chat = 'chat-c';
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-c');
  rt.playerSaveEntity('folder', { name: '杂记' }, '');
  rt.playerSaveEntity('note', { title: '约定', body: '卯时', folderId: 'pf-1' }, '');
  rt.playerSaveEntity('item', { name: '丹', qty: 1 }, '');
  await flushQueue();
  const rt3 = M.createRuntime(host.api, null, () => ({}));
  await rt3.switchChat('chat-c');
  const restored = rt3.playerCurrent();
  eq(restored.notes.folders.length, 1, '重载后玉册夹恢复');
  eq(restored.notes.notes.length, 1, '重载后备忘恢复');
  eq(restored.space.items.length, 1, '重载后物品恢复');
  ok(host.lorebooks().length === 0, '玩家域 CRUD 不进世界书');
}

{
  // 视图：表单页预填/新建/删除武装；列表 CTA 与行尾编辑；角色域不受影响
  const cs = M.CORE.blankState('c1');
  cs.sync = { status: 'complete', roleName: '李逍遥', summary: 's', applied: [], appliedSeen: [], issues: [], updatedAt: 1 };
  const ps = M.CORE.blankPlayerState('c1');
  ps.notes = { folders: [{ id: 'pf-1', name: '杂记', count: 1 }], notes: [{ id: 'pn-1', folderId: 'pf-1', updated: 'x', locked: true, title: '约定', body: '卯时山门' }] };
  ps.space = { currencies: [{ kind: '灵石', amount: '100' }], items: [{ id: 'pi-1', name: '丹', qty: 1, grade: '', desc: '' }] };
  ps.market = { listings: [], auctions: [], orders: [{ id: 'po-1', name: '符纸', status: '已拍下', price: '5灵石', time: 'x', side: 'buy' }] };

  // 列表页：玩家域有 CTA 与行尾编辑按钮
  const pf = M.VIEWS.renderPage(cs, { app: 'notes', view: 'folders' }, {}, {}, 'player', ps);
  ok(pf.includes('data-action="player-new"') && pf.includes('data-kind="folder"'), '玩家域玉册列表有新建 CTA');
  ok(pf.includes('data-action="player-edit"') && pf.includes('data-kind="folder"'), '玩家域玉册行尾有编辑按钮');
  const cf = M.VIEWS.renderPage(cs, { app: 'notes', view: 'folders' }, {}, {}, 'character', ps);
  ok(!cf.includes('data-action="player-new"') && !cf.includes('data-action="player-edit"'), '角色域玉册列表无 CRUD 控件');
  const pFolder = M.VIEWS.renderPage(cs, { app: 'notes', view: 'folder', params: { id: 'pf-1' } }, {}, {}, 'player', ps);
  ok(pFolder.includes('data-action="player-new"') && pFolder.includes('data-kind="note"'), '玩家域玉册夹内有新建备忘 CTA');
  ok(pFolder.includes('data-kind="note"') && pFolder.includes('data-id="pn-1"'), '备忘行尾有编辑按钮');
  const pNote = M.VIEWS.renderPage(cs, { app: 'notes', view: 'note', params: { id: 'pn-1' } }, {}, {}, 'player', ps);
  ok(pNote.includes('data-action="player-edit"') && pNote.includes(zhCatalog['runtime.player.edit']), '备忘详情有编辑入口');
  const pItems = M.VIEWS.renderPage(cs, { app: 'space', view: 'items' }, {}, {}, 'player', ps);
  ok(pItems.includes('data-kind="item"') && pItems.includes('data-id="pi-1"'), '物品行尾有编辑按钮');
  const pCoins = M.VIEWS.renderPage(cs, { app: 'space', view: 'currencies' }, {}, {}, 'player', ps);
  ok(pCoins.includes('data-kind="currency"') && pCoins.includes('data-id="灵石"'), '钱财按种类为编辑键');
  const pOrders = M.VIEWS.renderPage(cs, { app: 'market', view: 'orders' }, {}, {}, 'player', ps);
  ok(pOrders.includes('data-kind="order"') && pOrders.includes('data-id="po-1"'), '订单行尾有编辑按钮');
  const charOrders = M.VIEWS.renderPage(cs, { app: 'market', view: 'orders' }, {}, {}, 'character', ps);
  ok(!charOrders.includes('data-action="player-edit"'), '角色域订单无编辑按钮');

  // 表单页：新建无预填 + 保存按钮；编辑预填 + 删除按钮；武装态文案切换
  const newForm = M.VIEWS.renderPage(cs, { app: 'notes', view: 'form', params: { kind: 'folder' } }, {}, {}, 'player', ps);
  ok(newForm.includes('data-marker="player-form"') && newForm.includes('data-action="player-save"'), '新建表单页渲染');
  ok(!newForm.includes('data-action="player-delete"'), '新建态无删除按钮');
  ok(!newForm.includes('value="杂记"'), '新建表单不预填');
  const editForm = M.VIEWS.renderPage(cs, { app: 'notes', view: 'form', params: { kind: 'folder', id: 'pf-1' } }, {}, {}, 'player', ps);
  ok(editForm.includes('value="杂记"'), '编辑表单预填现有值');
  ok(editForm.includes('data-action="player-delete"') && editForm.includes(zhCatalog['runtime.player.delete']), '编辑态有删除按钮');
  const armedForm = M.VIEWS.renderPage(cs, { app: 'notes', view: 'form', params: { kind: 'folder', id: 'pf-1' } }, {}, { armed: { id: 'folder:pf-1', expiresAt: Date.now() + 1000 } }, 'player', ps);
  ok(armedForm.includes(zhCatalog['runtime.player.deleteConfirm']), '两击确认文案武装态');
  const noteForm = M.VIEWS.renderPage(cs, { app: 'notes', view: 'form', params: { kind: 'note', id: 'pn-1' } }, {}, {}, 'player', ps);
  ok(noteForm.includes('value="约定"') && noteForm.includes('value="pf-1"'), '备忘表单预填标题与父玉册夹');
  const orderForm = M.VIEWS.renderPage(cs, { app: 'market', view: 'form', params: { kind: 'order', id: 'po-1' } }, {}, {}, 'player', ps);
  ok(orderForm.includes('<option value="buy" selected') && orderForm.includes('<option value="sell"'), '订单表单方向选择预填');
}

// ---------- 结果 ----------
console.log('');
if (failures.length) {
  console.error(`冒烟失败 ${failures.length} 项 / 通过 ${passed} 项`);
  process.exit(1);
} else {
  console.log(`冒烟全部通过：${passed} 项`);
}
