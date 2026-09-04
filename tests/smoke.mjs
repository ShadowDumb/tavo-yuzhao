/*
 * 玉兆冒烟测试（node tests/smoke.mjs，无外部依赖）
 *
 * 覆盖面：
 * 1. 数据层：Core 消毒/校验/应用、Protocol 解析/剥离、Prompt 注入与封印、
 *    Runtime 状态机（去重/水化签名/切聊竞态/重建/空间生命周期）、持久化队列与缓存淘汰、
 *    manifest 与 catalog 结构校验。
 * 2. UI 层：太极八卦盘与 8 卦位视图渲染、传音符对话流、记事/坊市/论坛/空间/舆图/管理交互、
 *    UI 导航与状态机、表单与数据操作（真实发帖/传音/撤销恢复）、Tavo Hook 生命周期桥接。
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const readMany = (paths) => paths.map(read).join('\n\n');

execFileSync(process.execPath, ['scripts/build.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' });

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
const runtimeSource = read('src/runtime.js');
const dataSource = readMany(['src/core.js', 'src/protocol.js', 'src/i18n.js', 'src/runtime.js', 'src/prompt.js']);
const uiSource = readMany([
  'src/ui/views/shared.js',
  'src/ui/views/wheel.js',
  'src/ui/views/tablet.js',
  'src/ui/views/messages.js',
  'src/ui/views/notes.js',
  'src/ui/views/market.js',
  'src/ui/views/forum.js',
  'src/ui/views/space.js',
  'src/ui/views/map.js',
  'src/ui/views/manage.js',
  'src/ui/views/sync.js',
  'src/ui/views/page.js',
  'src/ui/app/state.js',
  'src/ui/app/dialogs.js',
  'src/ui/app/data-actions.js',
  'src/ui/app/forms.js',
  'src/ui/app/fab.js',
  'src/ui/app/navigation.js',
  'src/ui/app/dom-strip.js',
  'src/ui/app/hooks.js',
  'src/ui/app/shell.js',
  'src/ui/app/entry.js'
]);
// 源码片段共享同一测试闭包。
const probe = `(function () {
${dataSource}
${uiSource}
  globalThis.__YZ_SMOKE__ = {
    CORE, PROTOCOL, PROMPT,
    createRuntime: RUNTIME.createRuntime,
    makeTranslator: makeTranslator,
    setTranslator: function (t) { TRANSLATE = t; },
    i18n: I18N,
    MAX_SNAPSHOT_BYTES: MAX_SNAPSHOT_BYTES,
    PLUGIN_VERSION: PLUGIN_VERSION,
    VIEWS_SHARED, VIEWS_WHEEL, VIEWS_TABLET, VIEWS_MESSAGES, VIEWS_NOTES,
    VIEWS_MARKET, VIEWS_FORUM, VIEWS_SPACE, VIEWS_MAP, VIEWS_MANAGE, VIEWS_SYNC,
    PAGE, createUiState, createDialogs, createDataActions, createForms, createFab,
    createNavigation, createDomStrip, createHooks, createShell, APP
  };
})();
`;
new Function(probe)();
const M = globalThis.__YZ_SMOKE__;

// v3 空间模型：读「当前聊天默认空间」的分区/同步/revision（旧用例的 dflt(rt.current()).tablet 等）。
function dflt(state) { return M.CORE.defaultSpaceState(state) || (state && state.spaces && state.spaces[0]) || state; }
// 把 rt.current() 的顶层读取重定向到默认空间。
function rcur(rt) { return dflt(rt.current()); }

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
}

// ---------- manifest 与 catalog 结构 ----------
console.log('# manifest / catalog');
const manifest = JSON.parse(read('manifest.json'));
ok(manifest.specVersion === 2, 'specVersion 为 2');
ok(/^\d+\.\d+\.\d+$/.test(manifest.version), 'version 是合法 SemVer');
eq(manifest.permissions.slice().sort(), ['generate', 'message', 'variable'], 'permissions 仅含实际使用的能力');

// 构建产物完整性回归：build 用模板 String.replace 时会把替换文本里的 `$&` 当引用展开，
// 破坏 core.js 的 regex 转义（'\\$&' 被替换成整段 marker，产生 SyntaxError，UI 脚本不执行）。
// 回归点：产物必须不残留 marker 文本，且 core.js 的 regex 转义保持字面 `'\\$&'`。
{
  const jade = read('ui/jade.html');
  const corrupted = "'\\\\<!-- yu-zhao-ui-script -->'";
  ok(!jade.includes(corrupted) && !jade.includes('yu-zhao-ui-script -->'), 'ui/jade.html 无 String.replace $& 展开污染');
  const opens = (jade.match(/<script[\s>]/gi) || []).length;
  const closes = (jade.match(/<\/script>/gi) || []).length;
  ok(opens === 1 && closes === 1, `ui/jade.html 恰含一个可执行脚本块 (open=${opens} close=${closes})`);
}
ok(existsSync(path.join(ROOT, manifest.entry)), 'entry 文件存在');
ok(existsSync(path.join(ROOT, manifest.cover)), 'cover 文件存在');

const releaseKey = manifest.releaseNotes && manifest.releaseNotes.$t;
ok(!!releaseKey && zhCatalog[releaseKey] && enCatalog[releaseKey], 'releaseNotes 键在双语 catalog 中存在');
ok(Object.keys(zhCatalog).every((k) => !/^releaseNotes\./.test(k) || k === releaseKey), 'catalog 只保留当前版本 releaseNotes');
// 发布契约：版本漂移会静默破坏升级迁移（pluginVersion 变化触发 pendingFull 强制全量重写）。
eq(manifest.version, M.PLUGIN_VERSION, 'manifest 版本与 PLUGIN_VERSION 一致');
eq(releaseKey, 'releaseNotes.' + String(manifest.version).replace(/\./g, '_'), 'releaseNotes 键后缀与版本号对应');

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

// ---------- Core ----------
console.log('# Core 消毒与状态规范化');
{
  const dirty = { a: '__proto__', __proto__: { x: 1 }, constructor: 'bad', nested: { deep: { deeper: 'v' } }, arr: Array(150).fill(1) };
  const clean = M.CORE.sanitize(dirty);
  ok(!('__proto__' in clean) && clean.a !== undefined, '危险键被过滤');
  ok(clean.nested.deep.deeper === 'v', '正常嵌套字段保留');
  eq(clean.arr.length, 100, '数组限长 100');

  const v1 = M.CORE.normalizeState(JSON.parse('{"tablet":{"name":"李逍遥"},"sync":{"status":"complete"},"processedTurns":["t1","t2"]}'), 'chat-9');
  // v1→v2 迁移：顶层分区数据读入即整体搬进默认空间。
  eq(v1.spaces.length, 1, 'v1 状态迁移出一个空间');
  ok(v1.spaces[0].isDefault && v1.spaces[0].id === 'sp0', '迁移空间是默认空间 sp0');
  eq(v1.spaces[0].tablet.name, '李逍遥', 'v1→v2 分区数据迁入默认空间');
  eq(v1.spaces[0].processedTurns.length, 2, 'v1→v2 processedTurns 迁移');
  eq(v1.pluginVersion, '', 'v1→v2 版本置空触发强制全量重写');
  eq(v1.chatId, 'chat-9', 'chatId 归一');

  const v2 = M.CORE.normalizeState({ spaces: [
    { id: 'sp0', isDefault: true, tablet: { name: '角色' }, sync: { roleName: '云十三' } },
    { id: 'sp1', name: '我', chats: { contacts: [{ id: 'c-1', name: '张三', messages: [] }], groups: [] } }
  ], activeSpaceId: 'sp1', migratedPlayer: true }, 'chatA');
  eq(v2.spaces.length, 2, 'v2 空间列表保留');
  eq(v2.activeSpaceId, 'sp1', 'activeSpaceId 持久化');
  ok(v2.migratedPlayer === true, 'migratedPlayer 标记持久化');
  eq(M.CORE.findSpaceState(v2, '我').id, 'sp1', 'findSpaceState 按名称定位');
  eq(M.CORE.findSpaceState(v2, 'sp0').isDefault, true, 'findSpaceState 按 id 定位');
  eq(M.CORE.findSpaceState(v2, ''), M.CORE.defaultSpaceState(v2), '空键定位默认空间');
  eq(M.CORE.findSpaceState(v2, '不存在'), null, '未知空间名返回 null（写入拒收）');
  ok(v2.spaces[1].allowAIWrite === true && v2.spaces[1].sendToAI === true, '自定义空间默认发送AI+可写');
  const noDefault = M.CORE.normalizeState({ spaces: [{ id: 'sp1', name: '甲' }] }, 'c');
  eq(noDefault.spaces.length, 1, '默认空间可被删除（不自动补）');
  ok(!M.CORE.defaultSpaceState(noDefault), 'defaultSpaceState 缺省返回 null');
  ok(M.CORE.ensureDefaultSpace(noDefault).isDefault && noDefault.spaces.length === 2, 'ensureDefaultSpace 重建默认空间');
  const dupName = M.CORE.normalizeState({ spaces: [
    { id: 'sp0', isDefault: true }, { id: 'sp1', name: '甲' }, { id: 'sp2', name: '甲' }, { id: 'sp2', name: '乙' }
  ] }, 'c');
  eq(dupName.spaces.map((s) => s.name), ['', '甲', '甲-1', '乙'], '重名空间归一化补后缀（默认空间名恒空）');
  eq(dupName.spaces.map((s) => s.id)[0], 'sp0', '默认空间 id 稳定');
  eq(dupName.spaces.slice(1).map((s) => s.name), ['甲', '甲-1', '乙'], '自定义重名修复');
  ok(new Set(dupName.spaces.map((s) => s.id)).size === dupName.spaces.length, '重复 id 重发后保持唯一');
  const defLock = M.CORE.normalizeState({ spaces: [{ id: 'sp0', isDefault: true, allowAIWrite: false, name: '强行改名' }] }, 'c');
  ok(defLock.spaces[0].allowAIWrite === true && defLock.spaces[0].name === '', '默认空间强制 AI 可写且名字恒空');
  eq(M.CORE.spaceDisplayName({ id: 'sp0', isDefault: true, sync: { roleName: '白茯苓' } }), '白茯苓', '默认空间显示名跟随 roleName');
  eq(M.CORE.spaceDisplayName({ id: 'sp0', isDefault: true, sync: { roleName: '' } }, '默认空间'), '默认空间', '默认空间 roleName 为空时返回 fallback');
  eq(M.CORE.spaceDisplayName({ id: 'sp1', isDefault: false, name: '分身历练空间' }), '分身历练空间', '自定义空间显示名取自身 name');
  eq(M.CORE.spaceDisplayName(null, '默认空间'), '默认空间', 'space 为空时返回 fallback');

  // 用户线程未读重算：pm 发言后的尾随回复数 − seen；无用户发言的线程不触碰。
  const legacyCh = M.CORE.normalizeState({ spaces: [{ id: 'sp1', name: '甲', chats: { contacts: [{ id: 'yz-character', name: '李逍遥', messages: [{ id: 'pm-1', side: 'self', text: '旧信' }] }], groups: [] } }] }, 'lc');
  eq(M.CORE.findSpaceState(legacyCh, '甲').chats.contacts[0].id, 'c-yz-character', '旧固定通道联系人迁移为 c- 前缀（进门禁保护）');
  const space = M.CORE.blankUserSpace('c', { id: 'sp1', name: '我' });
  space.chats.contacts = [
    { id: 'c-1', name: '甲', unread: 0, seen: 0, messages: [{ id: 'pm-1', side: 'self', text: 'a' }, { id: 'm1', side: 'self', text: 'b' }, { id: 'm2', side: 'self', text: 'c' }] },
    { id: 'k1', name: '乙', unread: 5, seen: 0, messages: [{ id: 'm1', side: 'self', text: 'x' }] }
  ];
  M.CORE.recomputeThreadUnread(space);
  eq(space.chats.contacts[0].unread, 2, '用户线程未读 = 尾随回复数');
  eq(space.chats.contacts[1].unread, 5, '模型线程未读不被客户端重算覆盖');
  space.chats.contacts[0].seen = 2;
  M.CORE.recomputeThreadUnread(space);
  eq(space.chats.contacts[0].unread, 0, 'seen 对齐后未读清零');
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
  'field｜功法｜功法名｜青云剑诀',
  'field｜羁绊｜道侣｜林月如',
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

  const multiEnvelope = '<yz_jade><yz_meta>\nturn｜turn-m1｜仙｜第一块｜full\n</yz_meta></yz_jade>\n' +
    '<yz_jade><yz_meta>\nturn｜turn-m2｜仙｜第二块｜full\n</yz_meta></yz_jade>';
  const multiSnapshots = M.PROTOCOL.extractSnapshots(multiEnvelope);
  eq(multiSnapshots.map((item) => item.turn.id), ['turn-m1', 'turn-m2'], '多个协议块按顺序全部解析');

  ok(M.PROTOCOL.parse('普通剧情文本，没有协议。') === null, '无协议文本返回 null');

  eq(M.PROTOCOL.stripStreamTail('他握紧了剑<yz_'), '他握紧了剑', '流式半截标签剥离');
  eq(M.PROTOCOL.stripStreamTail('他握紧了剑<y'), '他握紧了剑', '流式 <y 剥离');
  eq(M.PROTOCOL.stripStreamTail('他握紧了剑<'), '他握紧了剑', '流式孤立 < 剥离');
  eq(M.PROTOCOL.stripStreamTail('他握紧了剑，纵身而上。'), '他握紧了剑，纵身而上。', '普通正文不受影响');

  const stripped = M.PROTOCOL.stripBlocks('剧情正文。\n' + FULL_JADE + '\n尾随文字。');
  ok(stripped.startsWith('剧情正文。') && stripped.endsWith('尾随文字。') && !stripped.includes('<yz_jade>'), 'stripBlocks 移除完整协议块');
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
  let history = [];
  let findCalls = 0;
  const queriedRoles = [];
  const lorebooks = new Map(); // id -> {id, name, entries}
  let loreSeq = 0;
  const chatUpdates = [];
  return {
    current,
    setHistory(rows) { history = rows; },
    history() { return history.slice(); },
    findCalls() { return findCalls; },
    rolesQueried() { return queriedRoles.slice(); },
    lorebooks() { return Array.from(lorebooks.values()); },
    chatUpdates() { return chatUpdates.slice(); },
    // 测试辅助：直接以整本书写入世界书（模拟旧数据/另一客户端已写入的权威数据）。
    seedBook(name, entries) {
      const b = Array.from(lorebooks.values()).find((x) => x.name === name);
      if (b) { b.entries = (entries || []).slice(); return b.id; }
      loreSeq += 1;
      lorebooks.set(loreSeq, { id: loreSeq, name, entries: (entries || []).slice() });
      return loreSeq;
    },
    api: {
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
const TABLET_OK = '<yz_tablet>\nfield｜基本｜名字｜李逍遥\nfield｜基本｜性别｜男\nfield｜基本｜身高｜175cm\nfield｜基本｜体重｜60kg\nfield｜仪容｜外貌｜清朗\nfield｜仪容｜穿着｜道袍\nfield｜修为｜灵根｜天灵根\nfield｜修为｜体质｜凡体\nfield｜修为｜境界｜炼气\nfield｜修为｜状态｜佳\nfield｜功法｜功法名｜青云剑诀\nfield｜羁绊｜道侣｜林月如\nfield｜隐秘｜身世｜弃徒\n</yz_tablet>';
const MSG_MIN = '<yz_msg>\ncontact｜c1｜林月如｜道侣｜今日｜0｜安好\ncontact｜c2｜酒剑仙｜师尊｜今日｜2｜饮酒\nmsg｜c1｜m1｜other｜昨日｜勿念\nmsg｜c1｜m2｜self｜今日｜定当赴约\nmsg｜c2｜m3｜other｜今日｜来喝酒\nmsg｜c2｜m4｜other｜今日｜速来\ngroup｜g1｜青云内门｜30｜今日｜5｜集合\nmsg占位忽略\ngmsg｜g1｜gm1｜掌门｜other｜今日｜卯时议事\ngmsg｜g1｜gm2｜长老｜other｜今日｜不得迟到\n</yz_msg>';
const MSG_ARCH = '<yz_msg>\ncontact｜c1｜林月如｜道侣｜今日｜0｜安好\ncontact｜c2｜酒剑仙｜师尊｜今日｜2｜饮酒\nmsg｜c1｜m1｜other｜昨日｜勿念\nmsg｜c1｜m2｜other｜昨日｜别忘\nmsg｜c1｜m3｜other｜昨日｜三事\nmsg｜c1｜m4｜self｜今日｜四时练剑\nmsg｜c1｜m5｜other｜今日｜五更同行\nmsg｜c1｜m6｜self｜今日｜六合归一\nmsg｜c1｜m7｜other｜今日｜七窍玲珑\nmsg｜c1｜m8｜other｜今日｜八荒来朝\nmsg｜c2｜x1｜other｜今日｜喝酒\nmsg｜c2｜x2｜other｜今日｜速来\ngroup｜g1｜青云内门｜30｜今日｜5｜集合\ngmsg｜g1｜gm1｜掌门｜other｜今日｜卯时议事\ngmsg｜g1｜gm2｜长老｜other｜今日｜排班\ngmsg｜g1｜gm3｜弟子｜other｜今日｜报到\ngmsg｜g1｜gm4｜长老｜other｜今日｜巡山\ngmsg｜g1｜gm5｜掌门｜other｜今日｜传令\ngmsg｜g1｜gm6｜弟子｜other｜今日｜收到\ngmsg｜g1｜gm7｜长老｜other｜今日｜守夜\ngmsg｜g1｜gm8｜掌门｜other｜今日｜明晨集合\n</yz_msg>';

// P2 矩阵共用夹具：直接构造对象快照，供 CORE.applySnapshot / buildCurrent 使用
const TABLET_OBJ = {
  name: '李逍遥',
  groups: [
    { id: 'basic', fields: [{ key: '名字', value: '李逍遥' }, { key: '性别', value: '男' }, { key: '身高', value: '175cm' }, { key: '体重', value: '60kg' }] },
    { id: 'look', fields: [{ key: '外貌', value: '清朗' }, { key: '穿着', value: '道袍' }] },
    { id: 'cult', fields: [{ key: '灵根', value: '天灵根' }, { key: '体质', value: '凡体' }, { key: '境界', value: '炼气三层' }, { key: '状态', value: '良好' }] },
    { id: 'gong', fields: [{ key: '功法名', value: '青云剑诀' }] },
    { id: 'bond', fields: [{ key: '道侣', value: '林月如' }] },
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
  eq(dflt(rt.current()).revision, 0, '空白聊天初始 revision 0');

  // 全量快照应用
  const r1 = await rt.applyText(jade('t1', TABLET_OK + MSG_MIN), 'chat-1', 'test');
  ok(r1.changed === true, '有效快照应用成功');
  ok(dflt(rt.current()).sync.status === 'partial', '仅 tablet/msg 达标时状态 partial');
  ok(dflt(rt.current()).tablet.name === '李逍遥', '玉牌写入状态');

  // 同一轮重复投递（同 turnId 同内容，双通道场景）→ 去重
  const revBefore = dflt(rt.current()).revision;
  const r2 = await rt.applyText(jade('t1', TABLET_OK + MSG_MIN), 'chat-1', 'test');
  ok(r2.changed !== true && dflt(rt.current()).revision === revBefore, '同 turnId 同内容不重复计 revision');
  ok(dflt(rt.current()).tablet.name === '李逍遥', '重复轮次不破坏已有数据');

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
  eq(dflt(rt.current()).revision, revBefore, '拒收不改写状态');

  // 解析失败标记
  const badText = '剧情<yz_weird_block>残缺';
  await rt.applyText(badText, 'chat-1', 'test');
  eq(dflt(rt.current()).sync.lastError, 'parse-error', '疑似协议但解析失败时记录 lastError');

  // 重新生成：模型复用同一 turnId 但内容已变 → 必须应用，不能被去重误杀
  const regenText = jade('t1', TABLET_OK.replace('名字｜李逍遥', '名字｜赵灵儿') + MSG_MIN);
  const r3 = await rt.applyText(regenText, 'chat-1', 'regen');
  ok(r3.changed === true, '同 turnId 新内容按重新生成应用');
  ok(dflt(rt.current()).tablet.name === '赵灵儿', '重新生成轮更新玉牌数据');
  const r4 = await rt.applyText(regenText, 'chat-1', 'message');
  ok(r4.changed !== true, '同 turnId 同内容双通道投递仍去重');

  // 水化签名：历史不变 → 不重复应用；新增楼层 → 增量应用
  host.setHistory([{ id: 'm1', role: 'assistant', content: jade('h1', TABLET_OK) }]);
  await rt.switchChat('chat-1');
  const revAfterHydrate = dflt(rt.current()).revision;
  await rt.switchChat('chat-1'); // 历史未变，第二次开聊
  ok(rt.current().hydration && rt.current().hydration.sig, '水化签名已记录（v2 顶层）');
  await rt.switchChat('chat-1');
  eq(dflt(rt.current()).revision, revAfterHydrate, '历史未变时不重复水化应用');
  host.setHistory(host.history().concat([{ id: 'm2', role: 'assistant', content: jade('h2', MSG_MIN) }]));
  await rt.switchChat('chat-1');
  ok(dflt(rt.current()).revision > revAfterHydrate, '新楼层到达后增量应用');

  // 封印：被 seal 的功能既不判定也不应用
  flags.msg = false;
  flags.forum = false;
  const sealedText = jade('t-seal', MSG_MIN + '<yz_forum>\npost｜p1｜作者｜散修｜闲聊｜今日｜标题|正文|1\ncomment｜p1｜路人｜今日｜顶\n</yz_forum>');
  const rSeal = await rt.applyText(sealedText, 'chat-1', 'test');
  const sealedApplied = rSeal.assessment && rSeal.assessment.applied || [];
  ok(!sealedApplied.includes('msg') && !sealedApplied.includes('forum'), '封印功能的数据不被应用');
  ok(!dflt(rt.current()).sync.issues.some((i) => i.path === 'msg.contacts' || i.path === 'forum.posts'), '封印功能不参与完整性判定');
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
  ok(dflt(rt.current()).revision >= 1, '切聊期间落地的写入得以保留');

  // 重建 = 从世界书快照恢复（权威存储）：内存被污染后回到存储版本，且不混入他聊天数据
  const hostSeed = fakeHost();
  hostSeed.current.chat = 'chat-1';
  const seededState = M.CORE.normalizeState({
    schemaVersion: 2,
    chatId: 'chat-1',
    pluginVersion: M.PLUGIN_VERSION,
    spaces: [{
      id: 'sp0', isDefault: true, revision: 7, updatedAt: 1,
      tablet: { name: '李逍遥', groups: [] },
      chats: { contacts: [], groups: [] }, notes: { folders: [], notes: [] },
      forum: { posts: [] }, market: { listings: [], auctions: [], orders: [], requests: [] },
      space: { currencies: [], items: [] }, map: { current: { place: '', domain: '', desc: '' }, tracks: [], places: [] },
      processedTurns: ['h1']
    }]
  }, 'chat-1');
  hostSeed.seedBook('玉兆档案·chat-1', [{
    identifier: 'yz-snap-1', name: '玉兆快照', enabled: false,
    content: JSON.stringify({ v: 2, ver: M.PLUGIN_VERSION, rev: 7, updatedAt: 0, kind: 'role', index: 1, total: 1, body: JSON.stringify(seededState) })
  }]);
  const rtSeed = M.createRuntime(hostSeed.api, null, () => ({}));
  await rtSeed.switchChat('chat-1');
  dflt(rtSeed.current()).tablet.name = '污染';
  dflt(rtSeed.current()).revision = 99;
  const rebuiltX = await rtSeed.rebuildFromHistory('chat-1');
  eq(rebuiltX.restored, true, '世界书有快照时重建成功');
  eq(dflt(rtSeed.current()).revision, 7, '重建恢复世界书快照的 revision');
  eq(dflt(rtSeed.current()).tablet.name, '李逍遥', '重建从世界书快照恢复玉牌');
  ok(dflt(rtSeed.current()).processedTurns.indexOf('t-live') < 0, '重建后仅含快照中的轮次（不含其他聊天的 t-live）');
}
await runtimeCase();

// 重建从世界书快照恢复：快照存在则覆盖内存；无快照时保留现状
console.log('# Runtime · 世界书快照重建');
{
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-1');
  await rt.applyText(jade('k1', TABLET_OK + MSG_MIN), 'chat-1', 'generation:success');
  eq(dflt(rt.current()).revision, 1, '同步一轮基线');
  const tick = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };
  await tick();
  const res = await rt.rebuildFromHistory('chat-1');
  eq(res.restored, true, '世界书有快照时重建成功');
  eq(dflt(rt.current()).revision, 1, '重建后 revision 与快照一致');
  eq(dflt(rt.current()).tablet.name, '李逍遥', '重建后玉牌数据恢复');
  eq(dflt(rt.current()).chats.contacts.length, 2, '重建后联系人保留');
  await rt.rebuildFromHistory('chat-1');
  eq(dflt(rt.current()).revision, 1, '再次重建同样保持快照版本');

  // 快照被删（模拟世界书数据丢失）：保留现有数据，不清空
  const host2 = fakeHost();
  const rt2 = M.createRuntime(host2.api, null, () => ({}));
  await rt2.switchChat('chat-2');
  await rt2.applyText(jade('k2', TABLET_OK), 'chat-2', 'test');
  await tick();
  const book2 = host2.lorebooks().find((x) => x.name === '玉兆档案·chat-2');
  await host2.api.lorebook.update({ id: book2.id, name: book2.name, entries: [] });
  const res2 = await rt2.rebuildFromHistory('chat-2');
  eq(res2.restored, false, '无快照时重建不恢复');
  eq(dflt(rt2.current()).tablet.name, '李逍遥', '无快照时保留现有内存数据');

  // 空白聊天（从未同步）：保持空白（不产生假数据）
  const host3 = fakeHost();
  const rt3 = M.createRuntime(host3.api, null, () => ({}));
  await rt3.switchChat('chat-3');
  const res3 = await rt3.rebuildFromHistory('chat-3');
  eq(res3.restored, false, '空白聊天重建不恢复');
  eq(dflt(rt3.current()).revision, 0, '空白聊天重建后仍空白');
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
  await seed.syncArchive('chat-1');

  let delay = 0;
  const slowApi = {
    chat: host.api.chat,
    message: host.api.message,
    lorebook: {
      find: async (name) => { await new Promise((r) => setTimeout(r, delay)); return host.api.lorebook.find(name); },
      create: async (book) => { await new Promise((r) => setTimeout(r, delay)); return host.api.lorebook.create(book); },
      update: async (book) => { await new Promise((r) => setTimeout(r, delay)); return host.api.lorebook.update(book); }
    }
  };

  // settle：prepare 注入基线前等到异步加载完成，不再读到空白态
  const rt = M.createRuntime(slowApi, null, () => ({}));
  delay = 25;
  const switching = rt.switchChat('chat-1');
  await rt.settle();
  ok(dflt(rt.current()).tablet.name === '李逍遥', 'settle 等到异步加载完成，注入前能读到持久化数据');
  await switching;

  // 空白占位：加载窗口内仅读过 current()（未写入过数据）→ 持久化状态不被顶掉
  const rt2 = M.createRuntime(slowApi, null, () => ({}));
  const switching2 = rt2.switchChat('chat-1');
  rt2.current(); // 模拟旧版同步 prepare 在窗口内读了内存（创建空白占位）
  await switching2;
  ok(dflt(rt2.current()).tablet.name === '李逍遥', '空白占位不丢弃持久化状态');

  // 真正写入过的内存态（窗口内应用了快照）仍优先于旧持久化版本
  const rt3 = M.createRuntime(slowApi, null, () => ({}));
  const switching3 = rt3.switchChat('chat-1');
  await rt3.applyText(jade('s2', TABLET_OK.replace('名字｜李逍遥', '名字｜赵灵儿')), 'chat-1', 'test');
  await switching3;
  ok(dflt(rt3.current()).tablet.name === '赵灵儿', '窗口内写入的新数据不被旧持久化状态覆盖');
}

// ---------- Runtime 持久化与缓存 ----------
console.log('# Runtime 持久化与缓存');
const flushQueue = () => new Promise((resolve) => setTimeout(resolve, 0));
const flushWorld = async () => { await flushQueue(); await flushQueue(); };
{
  // 后台落盘队列：applyText 返回即完成内存更新，清空微任务后本地镜像与宿主均写入
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
  eq(dflt(rt.current()).revision, 1, 'applyText 同步更新内存态，不等落盘');
  await flushWorld();
  ok(store.has(rt.LOCAL_PREFIX + 'chat-save'), '后台队列把状态写入本地镜像（缓存）');
  const snapBook = host.lorebooks().find((b) => b.name === '玉兆档案·chat-save');
  ok(snapBook && snapBook.entries.some((e) => e.identifier === 'yz-snap-1'), '数据变化即同步世界书快照分片');

  // 世界书权威：新会话（无本地镜像）从世界书分片快照恢复
  const host2 = fakeHost();
  const authorityState = M.CORE.normalizeState({
    schemaVersion: 2,
    pluginVersion: M.PLUGIN_VERSION,
    spaces: [{ id: 'sp0', isDefault: true, revision: 3, chats: { contacts: [], groups: [] } }]
  }, 'chat-1');
  host2.seedBook('玉兆档案·chat-1', [{
    identifier: 'yz-snap-1', name: '玉兆快照', enabled: false,
    content: JSON.stringify({ v: 2, ver: M.PLUGIN_VERSION, rev: 3, updatedAt: 0, kind: 'role', index: 1, total: 1, body: JSON.stringify(authorityState) })
  }]);
  const rt2 = M.createRuntime(host2.api, null, () => ({}));
  await rt2.switchChat('chat-1');
  eq(dflt(rt2.current()).revision, 3, '世界书快照分片可加载（无本地缓存）');

  // 重复投递轮次不再触发落盘
  const host3 = fakeHost();
  host3.current.chat = 'chat-dup';
  const rt3 = M.createRuntime(host3.api, null, () => ({}));
  await rt3.switchChat('chat-dup');
  await rt3.applyText(jade('t-dup', TABLET_OK), 'chat-dup', 'test');
  await flushWorld();
  const booksAfterFirst = JSON.stringify(host3.lorebooks());
  await rt3.applyText(jade('t-dup', TABLET_OK), 'chat-dup', 'test');
  await flushWorld();
  eq(JSON.stringify(host3.lorebooks()), booksAfterFirst, '重复轮次不重复写世界书');

  // 切聊后对新聊天写入只影响自己的镜像键与世界书（按聊天独立成书，无跨聊天污染）
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
  await flushWorld();
  ok(raceStore.has(rtRace.LOCAL_PREFIX + 'chat-a'), 'chat-a 写入本地镜像');
  hostRace.current.chat = 'chat-b';
  await rtRace.switchChat('chat-b');
  await rtRace.applyText(jade('t-race2', TABLET_OK.replace('炼气', '筑基')), 'chat-b', 'test');
  await flushWorld();
  ok(raceStore.has(rtRace.LOCAL_PREFIX + 'chat-a') && raceStore.has(rtRace.LOCAL_PREFIX + 'chat-b'), '各聊天镜像键独立，无跨聊天污染');
  const booksA = hostRace.lorebooks().find((b) => b.name === '玉兆档案·chat-a');
  const booksB = hostRace.lorebooks().find((b) => b.name === '玉兆档案·chat-b');
  ok(booksA && booksB, '每个聊天独立成书');
  // 回到 chat-a：镜像恢复的数据完整（chat-a 最后一次保存的是切走前的数据）
  hostRace.current.chat = 'chat-a';
  const rtRace2 = M.createRuntime(hostRace.api, raceLocal, () => ({}));
  await rtRace2.switchChat('chat-a');
  eq(dflt(rtRace2.current()).tablet.name, '李逍遥', '镜像恢复的玉牌数据完整（名字）');

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

  // 快照分片 round-trip：超过单片上限的状态拆多片写入，读取时按 index 拼接还原
  const hostBig = fakeHost();
  hostBig.current.chat = 'chat-big';
  const bigState = M.CORE.normalizeState(null, 'chat-big');
  const bigText = '字'.repeat(2900);
  const bigSpace = M.CORE.defaultSpaceState(bigState);
  bigSpace.revision = 2;
  bigSpace.updatedAt = Date.now();
  // 单条消息正文被 normalize 截到 3000 字：要多片快照需多个联系人各自留满 20 条长消息。
  bigSpace.chats = M.CORE.normalizeChats({
    contacts: Array.from({ length: 6 }, (_, c) => ({ id: 'c' + c, name: '长谈' + c, preview: '', messages: Array.from({ length: 20 }, (_, i) => ({ id: 'm' + i, side: 'other', time: 'x', text: bigText + c + '-' + i })) })),
    groups: []
  });
  const bigRt = M.createRuntime(hostBig.api, null, () => ({}));
  const bigEntries = bigRt.buildSnapshotEntries(bigState);
  ok(bigEntries.length > 1, '大状态拆为多片快照');
  ok(bigEntries.every((e) => e.enabled === false && e.probability === 0), '所有快照分片永不注入');
  hostBig.seedBook('玉兆档案·chat-big', bigEntries.map((e) => ({ ...e })));
  const bigRt2 = M.createRuntime(hostBig.api, null, () => ({}));
  await bigRt2.switchChat('chat-big');
  eq(dflt(bigRt2.current()).revision, 2, '多片快照拼接还原');
  const bigRestored = dflt(bigRt2.current()).chats.contacts[0].messages;
  eq(bigRestored.length, 20, '多片快照数据完整（归一保尾 20 条）');
  ok(bigRestored[19].text === bigText + '0-19', '分片边界无截断');

}

// ---------- P1 · 管理页（诊断区/清空/导入导出）----------
console.log('# P1 · 管理页');
{
  // 单功能清空的分区映射：msg → state.chats
  eq(M.CORE.FEATURE_FIELDS.msg, 'chats', 'msg 功能映射到 state.chats');
  eq(M.CORE.blankFeatureField('forum'), { posts: [] }, 'blankFeatureField 返回分区空白结构');
  eq(M.CORE.blankFeatureField('nope'), null, '未知功能无空白结构');
}

// ---------- P1 · appliedSeen 持久化与导入 ----------
console.log('# P1 · appliedSeen 与 importState');
{
  let ps = M.CORE.blankState('ps');
  ps.isDefault = true; ps.id = 'sp0';
  ps.sync.appliedSeen = ['notes', 'msg'];
  eq(dflt(M.CORE.normalizeState(ps, 'ps')).sync.appliedSeen, ['notes', 'msg'], 'normalizeState 保留 appliedSeen（默认空间内）');
  eq(dflt(M.CORE.normalizeState({ spaces: [{ id: 'sp0', isDefault: true }] }, 'x')).sync.appliedSeen, [], '缺省自动补空数组');
  const pr = M.CORE.applySnapshot(M.CORE.normalizeState(ps, 'ps'), snapOf('pv', 'full', { chats: MSG_OBJ }), {});
  const prs = dflt(pr.state);
  ok(prs.sync.appliedSeen.indexOf('msg') < 0 && prs.sync.appliedSeen.indexOf('notes') >= 0, '本轮应用的分区从 seen 中移除');
}
{
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('imp');
  eq(rt.importState(JSON.stringify({ revision: 7 })).reason, 'parse', '缺少 v3 空间结构的 JSON 拒收');
  eq(dflt(rt.current()).revision, 0, '拒收弱结构后当前内存态未被覆盖');
  const importable = M.CORE.normalizeState({ schemaVersion: 2, spaces: [{ id: 'sp0', isDefault: true, revision: 7, tablet: { name: '导入档', groups: [] } }] }, 'imp');
  const candidate = rt.importState(JSON.stringify(importable));
  ok(candidate.ok && dflt(rt.current()).revision === 0, '当前 v3 存档先解析为候选，不立即替换');
  const committed = rt.commitImport(candidate.state);
  await committed.saved;
  eq(dflt(rt.current()).revision, 7, '确认提交后导入替换内存态');
  eq(rt.importState('{bad json').reason, 'parse', '非法 JSON 拒收');
  eq(rt.importState('x'.repeat(200001)).reason, 'oversized', '超出容量拒收');
  // 回归：误贴任意 JSON（无玉兆特征字段）绝不能「导入成功」后清空当前角色域数据。
  eq(rt.importState(JSON.stringify({ foo: 1 })).reason, 'parse', '无玉兆特征字段的任意 JSON 拒收（防误贴清空数据）');
  eq(rt.importState(JSON.stringify({ version: 1 })).reason, 'parse', '非玉兆结构的 JSON 拒收');
  eq(dflt(rt.current()).revision, 7, '拒收后当前内存态未被覆盖');
}

// ---------- P2 · 协议：mode/skip/digest ----------
console.log('# P2 · 协议 skip 与 digest');
{
  const partParsed = M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜tp1｜李逍遥｜只更玉牌｜part\n</yz_meta><yz_tablet>\nfield｜基本｜名字｜李逍遥\nfield｜基本｜性别｜男\nfield｜基本｜身高｜175cm\nfield｜基本｜体重｜60kg\nfield｜仪容｜外貌｜清朗\nfield｜仪容｜穿着｜道袍\nfield｜修为｜灵根｜天灵根\nfield｜修为｜体质｜凡体\nfield｜修为｜境界｜炼气\nfield｜修为｜状态｜佳\nfield｜功法｜功法名｜青云剑诀\nfield｜羁绊｜道侣｜林月如\nfield｜隐秘｜身世｜弃徒\n</yz_tablet></yz_jade>');
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
  eq(dflt(r2.state).sync.status, 'complete', 'part 出现且达标 → complete');
  eq(r2.applied.slice().sort(), ['msg', 'tablet'], 'part 应用出现分区');
  eq(dflt(r2.state).sync.issues, [], 'part 达标无 issue');

  // R3 part 出现但不达标 → 丢弃保旧、partial
  let st3 = M.CORE.blankState('m2');
  st3 = M.CORE.applySnapshot(st3, snapOf('f0', 'full', { tablet: TABLET_OBJ }), {}).state;
  const r3 = M.CORE.applySnapshot(st3, snapOf('p2', 'part', { chats: { contacts: [], groups: [] } }, { present: ['msg'] }), {});
  eq(dflt(r3.state).sync.status, 'partial', 'part 出现但不达标 → partial');
  eq(r3.applied, [], '不达标分区不应用');
  ok(dflt(r3.state).sync.issues.some((i) => i.code === 'msg.contacts'), 'issue 来自本轮出现分区');
  eq(dflt(r3.state).tablet.name, '李逍遥', '未出现分区的旧数据保留');

  // R4 part skip 且旧数据达标 → 静默通过
  let st4 = M.CORE.blankState('m3');
  st4 = M.CORE.applySnapshot(st4, snapOf('f1', 'full', { chats: MSG_OBJ }), {}).state;
  const r4 = M.CORE.applySnapshot(st4, snapOf('p3', 'part', {}, { skipped: { msg: '无变化' } }), {});
  eq(dflt(r4.state).sync.status, 'complete', 'part skip 且旧数据达标 → complete');
  eq(r4.applied, [], 'skip 分区不进 applied');
  eq(dflt(r4.state).sync.issues, [], 'skip 达标不计 issue');
  eq(dflt(r4.state).chats.contacts.length, 2, 'skip 分区旧数据原样保留');

  // R5 part skip 但旧数据缺失 → 沿用现有 issue code、partial
  const r5 = M.CORE.applySnapshot(M.CORE.blankState('m4'), snapOf('p4', 'part', {}, { skipped: { map: '未探索' } }), {});
  eq(dflt(r5.state).sync.status, 'partial', 'part skip 但旧数据缺失 → partial');
  ok(dflt(r5.state).sync.issues.some((i) => i.code === 'map.rows'), 'skip 不达标沿用现有 issue code');

  // R6 part meta-only 且 revision>0 → 状态保持、摘要更新、不动 revision
  let st6 = M.CORE.blankState('m5');
  st6 = M.CORE.applySnapshot(st6, snapOf('f2', 'full', { tablet: TABLET_OBJ }), {}).state;
  const revBefore = dflt(st6).revision;
  const issuesBefore = dflt(st6).sync.issues.length;
  const statusBefore = dflt(st6).sync.status;
  const r6 = M.CORE.applySnapshot(st6, snapOf('p5', 'part', {}), {});
  eq(dflt(r6.state).sync.status, statusBefore, 'meta-only 保持原状态');
  eq(dflt(r6.state).revision, revBefore, 'meta-only 不加 revision');
  eq(dflt(r6.state).sync.issues.length, issuesBefore, 'meta-only 不新增 issue');
  eq(dflt(r6.state).sync.summary, '增量摘要', 'meta-only 刷新摘要');
  eq(dflt(r6.state).sync.turnId, 'p5', 'meta-only 更新轮次');

  // R7 part meta-only 且 revision===0 → invalid
  const r7 = M.CORE.applySnapshot(M.CORE.blankState('m6'), snapOf('p6', 'part', {}), {});
  eq(dflt(r7.state).sync.status, 'invalid', '从未同步收到 meta-only → invalid');
  eq(dflt(r7.state).revision, 0, 'invalid 轮不加 revision');

  // R8 full 轮内出现 skip 行 → 按分区缺失处理（v1.6 行为）
  const fullWithSkip = M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜f9｜李逍遥｜全量\n</yz_meta><yz_map>\nskip｜不该出现\n</yz_map></yz_jade>');
  eq(fullWithSkip.turn.mode, '', 'mode 缺省按 full 处理');
  const r8 = M.CORE.applySnapshot(M.CORE.blankState('m7'), fullWithSkip, {});
  ok(dflt(r8.state).sync.issues.some((i) => i.code === 'map.rows'), 'full 轮 skip 行按分区缺失记 issue');

  // assess 双参调用兼容（oldState 缺省视为不达标）
  const compat = M.CORE.assess(snapOf('pc', 'part', {}, { skipped: { map: 'y' } }), {});
  ok(compat.part === true && compat.issues.some((i) => i.code === 'map.rows'), 'assess 双参调用兼容');
}

// ---------- P2 · 当前数据基线与提示词 ----------
console.log('# P2 · 当前数据基线与提示词');
// 提示词 issue 回声按当前激活语种翻译：先激活 zh，测试结尾再临时切 en 验证后恢复。
M.setTranslator(M.makeTranslator({ plugin: { i18n: { t: zhT } } }));
M.i18n.invalidate();
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
  eq(rt.tablet.groups.length, 6, '基线玉牌六组回环');
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
    + '<yz_market>\nlisting｜l1｜灵草｜下品｜百年份｜10灵石｜坊主\nauction｜a1｜古剑｜上品｜锈蚀｜100｜150｜1时辰｜3\norder｜o1｜符纸｜已成交｜5灵石｜今日｜买\nrequest｜r1｜百年灵草｜下品｜急收炼丹｜8灵石｜炼丹师\n</yz_market>'
    + '<yz_space>\ncurrency｜灵石｜120\nitem｜i1｜养神丹｜2｜中品｜宁神益气\nitem｜i2｜驱邪符｜5｜下品｜辟邪护身\n</yz_space>'
    + '<yz_map>\ncurrent｜青云山｜东域｜山门所在\ntrack｜t1｜昨日｜山门｜入门\ntrack｜t2｜今日｜演武场｜晨练\nplace｜p1｜青云山｜东域｜山门所在，灵气充沛\nplace｜p2｜演武场｜东域｜弟子晨练之地\n</yz_map>');
  const base = M.CORE.blankState('d1');
  const r0 = M.CORE.applySnapshot(base, M.PROTOCOL.parse(BASE_FULL), {});
  ok(dflt(r0.state).sync.status === 'complete', '基线状态先落一轮全量 complete');

  // diff 轮：upsert 更新玉牌境界、追加消息、删除群消息、评论增删、物品删除、舆图更新
  const diffText = '<yz_jade><yz_meta>\nturn｜d1｜李逍遥｜突破与迁移｜diff\n</yz_meta><yz_tablet>\n+field｜修为｜境界｜筑基一层\n</yz_tablet><yz_msg>\n+msg｜c1｜m9｜other｜今日｜恭贺师兄突破\n-gmsg｜g1｜gm2\n</yz_msg><yz_forum>\n+comment｜p1｜弟子｜今日｜恭贺掌门\n-comment｜p1｜长老｜今日｜已知\n</yz_forum><yz_space>\n-item｜i1\n+currency｜灵石｜20\n</yz_space><yz_map>\n+current｜落霞峰｜东域｜闭关之地\n+track｜t3｜今日｜落霞峰｜闭关\n</yz_map></yz_jade>';
  const ds = M.PROTOCOL.parse(diffText);
  ok(ds && Object.keys(ds.diff).length === 5, 'diff 快照解析出 5 个带操作行的分区');
  eq(ds.turn.mode, 'diff', 'meta 第 5 字段 diff 解析');
  eq(ds.diff.tablet[0].type, 'field', 'tablet 操作行类型解析');
  ok(ds.diff.msg.some((o) => o.type === 'msg' && o.add) && ds.diff.msg.some((o) => o.type === 'gmsg' && !o.add), 'msg 分区混含 +msg 与 -gmsg');

  const r1 = M.CORE.applySnapshot(r0.state, ds, {});
  ok(dflt(r1.state).tablet.name === '李逍遥', 'diff 后玉牌名字保留');
  eq(dflt(M.CORE.applySnapshot(r0.state, ds, {}).state).tablet.name, '李逍遥', '重复应用幂等');
  const cult = dflt(r1.state).tablet.groups.find((g) => g.id === 'cult');
  ok(cult.fields.some((f) => f.value === '筑基一层'), '+field upsert 更新境界');
  ok(cult.fields.some((f) => f.key === '灵根' && f.value === '天灵根'), '未提及字段原样保留');
  const c1 = dflt(r1.state).chats.contacts.find((c) => c.id === 'c1');
  ok(c1.messages.some((m) => m.id === 'm9'), '+msg 追加新消息');
  ok(c1.messages.some((m) => m.id === 'm2'), '未提及消息保留');
  const g1 = dflt(r1.state).chats.groups.find((g) => g.id === 'g1');
  ok(g1 && !g1.messages.some((m) => m.id === 'gm2'), '-gmsg 删除指定群消息');
  const p1 = dflt(r1.state).forum.posts.find((p) => p.id === 'p1');
  ok(p1.comments.some((c) => c.text === '恭贺掌门'), '+comment 追加评论');
  ok(!p1.comments.some((c) => c.text === '已知'), '-comment 按整行删除评论');
  ok(!dflt(r1.state).space.items.some((i) => i.id === 'i1'), '-item 删除物品');
  eq(dflt(r1.state).space.currencies[0].amount, '20', '+currency 按种类 upsert 更新数额');
  eq(dflt(r1.state).map.current.place, '落霞峰', '+current 替换当前位置');
  ok(dflt(r1.state).map.tracks.some((t) => t.id === 't3') && dflt(r1.state).map.tracks.some((t) => t.id === 't1'), 'track 追加且旧行保留');
  ok(r1.applied.length === 5, 'diff 轮 5 个触及分区全部应用');
  eq(dflt(r1.state).sync.status, 'complete', 'diff 轮保持 complete');
  eq(dflt(r1.state).revision, dflt(r0.state).revision + 1, 'diff 轮 revision +1');

  // 模型只输出变化行但忘写 mode → 以行形态识别为 diff，数据不被整块替换清掉
  const noMode = M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜d2｜李逍遥｜忘写模式\n</yz_meta><yz_msg>\n+msg｜c1｜m10｜other｜今日｜再贺\n</yz_msg></yz_jade>');
  const r2 = M.CORE.applySnapshot(r1.state, noMode, {});
  ok(dflt(r2.state).chats.contacts.find((c) => c.id === 'c2'), '未声明 mode 的 diff 行不整块替换（其余联系人保留）');
  ok(dflt(r2.state).chats.contacts.find((c) => c.id === 'c1').messages.some((m) => m.id === 'm10'), '未声明 mode 的 + 行仍应用');

  // meta-only diff 轮：无变化，仅刷新摘要
  const r3 = M.CORE.applySnapshot(r2.state, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜d3｜李逍遥｜风平浪静｜diff\n</yz_meta></yz_jade>'), {});
  ok(r3.changed !== true || r3.applied.length === 0, 'meta-only diff 轮无分区应用');
  eq(dflt(r3.state).revision, dflt(r2.state).revision, 'meta-only diff 轮不动 revision');
  eq(dflt(r3.state).sync.summary, '风平浪静', 'meta-only diff 轮刷新摘要');

  // 未触及分区若数据确实不达标：diff 轮重推导并保留 issue（供模型 + 行修复），数据不动
  const holed = M.CORE.clone(r2.state);
  dflt(holed).market.orders = [];
  const r4 = M.CORE.applySnapshot(holed, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜d4｜李逍遥｜只动玉牌｜diff\n</yz_meta><yz_tablet>\n+field｜修为｜状态｜闭关\n</yz_tablet></yz_jade>'), {});
  ok(dflt(r4.state).sync.issues.some((i) => i.code === 'market.rows'), '未触及且不达标的分区在 diff 轮重推导 issue 回显');
  ok(dflt(r4.state).market.orders.length === 0, '未触及分区数据不动');

  // 删除行触发最低线不达标：分区不落盘、记 issue（红色感叹号的正确来源）
  const r5 = M.CORE.applySnapshot(r4.state, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜d5｜李逍遥｜散尽家财｜diff\n</yz_meta><yz_space>\n-currency｜灵石\n</yz_space></yz_jade>'), {});
  ok(dflt(r5.state).space.currencies.length === 1, '合并后不达标的分区不落盘（旧数据保留）');
  ok(dflt(r5.state).sync.issues.some((i) => i.code === 'space.rows'), '不达标分区记 issue 供回声修复');

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
  eq(dflt(cap1.state).chats.groups[0].messages.length, 24, '群消息上限 24');
  eq(dflt(cap1.state).chats.groups[0].messages[0].id, 'gm7', 'full 超限保留最新（最旧淘汰）');
  ok(dflt(cap1.state).chats.groups[0].messages.some((m) => m.id === 'gm30'), 'full 超限最新消息在场');
  eq(dflt(cap1.state).chats.contacts[0].messages.length, 20, '联系人消息上限 20');

  // 3. diff 满员追加：多轮后群聊能收到最新消息（用户报障场景）
  const cap2 = M.CORE.applySnapshot(cap1.state, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜cap2｜李逍遥｜新令｜diff\n</yz_meta><yz_msg>\n+gmsg｜g1｜gm31｜长老｜other｜今日｜新令\n</yz_msg></yz_jade>'), {});
  eq(dflt(cap2.state).chats.groups[0].messages.length, 24, '满员 +gmsg 后仍保持上限 24');
  ok(dflt(cap2.state).chats.groups[0].messages.some((m) => m.id === 'gm31'), '满员时最新群消息被收下');
  ok(!dflt(cap2.state).chats.groups[0].messages.some((m) => m.id === 'gm7'), '满员时最旧群消息被淘汰');
  const cap3 = M.CORE.applySnapshot(cap2.state, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜cap3｜李逍遥｜传话｜diff\n</yz_meta><yz_msg>\n+msg｜c1｜m21｜other｜今日｜回话\n</yz_msg></yz_jade>'), {});
  eq(dflt(cap3.state).chats.contacts[0].messages.length, 20, '联系人满员 +msg 后仍保持上限 20');
  ok(dflt(cap3.state).chats.contacts[0].messages.some((m) => m.id === 'm21'), '联系人消息满员时同样收下最新');
  ok(!dflt(cap3.state).chats.contacts[0].messages.some((m) => m.id === 'm1'), '联系人满员时最旧被淘汰');

  // 4. 记事玉册数量统计：文件夹计数按实际笔记派生（不再信任模型声明的 count）
  const noteNorm = M.CORE.normalizeNotes({ folders: [{ id: 'f1', name: '杂记', count: 99 }, { id: 'f2', name: '秘录', count: 0 }], notes: many(2, 'n').map((m) => ({ id: m.id, folderId: 'f1', updated: '今日', locked: false, title: '题' + m.id, body: '文' + m.id })) });
  eq(noteNorm.folders[0].count, 2, '文件夹计数按实际笔记派生（忽略声明值）');
  eq(noteNorm.folders[1].count, 0, '空文件夹计数为 0');
  const noteState = M.CORE.blankState('n1');
  const n0 = M.CORE.applySnapshot(noteState, M.PROTOCOL.parse(jade('n0', '<yz_notes>\nfolder｜f1｜杂记｜99\nfolder｜f2｜秘录｜0\nnote｜n1｜f1｜今日｜false｜约定｜卯时山门\nnote｜n2｜f1｜今日｜false｜心法｜不可外传\nnote｜n3｜f1｜今日｜true｜药方｜三七\nnote｜n4｜f2｜今日｜false｜见闻｜坊市新品\n</yz_notes>')), {});
  eq(dflt(n0.state).notes.folders.find((f) => f.id === 'f1').count, 3, 'diff 前文件夹计数与笔记一致');
  const n1 = M.CORE.applySnapshot(n0.state, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜n1｜李逍遥｜补记｜diff\n</yz_meta><yz_notes>\n+note｜n5｜f1｜今日｜false｜新悟｜大道至简\n</yz_notes></yz_jade>'), {});
  eq(dflt(n1.state).notes.folders.find((f) => f.id === 'f1').count, 4, '+note 后文件夹计数 +1');
  const n2 = M.CORE.applySnapshot(n1.state, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜n2｜李逍遥｜删记｜diff\n</yz_meta><yz_notes>\n-note｜n1\n</yz_notes></yz_jade>'), {});
  eq(dflt(n2.state).notes.folders.find((f) => f.id === 'f1').count, 3, '-note 后文件夹计数 -1');

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
  ok(curHuge.join('\n').length <= 9000, '基线超预算时逐行淘汰，注入量有硬上限');
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
  const curMaxed = M.PROMPT.buildCurrent(maxed, {}, () => 0);
  ok(curMaxed.join('\n').length <= 9000, '极端满配态注入量仍受上限约束');
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
  const curMaxed2 = M.PROMPT.buildCurrent(maxed2, {}, () => 0);
  ok(curMaxed2.join('\n').length <= 9000, '归档行让位后注入量收敛到上限内');
  ok(curMaxed2.some((r) => r.startsWith('contact｜c0｜')), '归档行让位后实体标识行仍在');
  ok(curMaxed2.some((r) => r.startsWith('track｜t0｜')), '归档行让位后舆图行仍在（不可淘汰）');

  // 6d. tablet 字段行末位淘汰：长字段值不会撑爆上限
  const bigTab = M.CORE.blankState('w4');
  bigTab.tablet.groups = [{ id: 'basic', fields: Array.from({ length: 11 }, (_, i) => ({ key: '字段' + i, value: '字'.repeat(3000) })) }];
  const curTab = M.PROMPT.buildCurrent(bigTab, {});
  ok(curTab.join('\n').length <= 9000, '长玉牌字段值同样受上限约束');

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
  // save 触发的首轮 syncArchive 与显式调用（busy 合并）都在微任务里推进：排干一次再断言。
  await new Promise((r) => setTimeout(r, 0));
  const books = ah.lorebooks();
  eq(books.length, 1, '归档建书一次');
  eq(books[0].name, '玉兆档案·chat-1', '书名带聊天标识');
  const entries = books[0].entries;
  ok(entries.length === 3, '归档条目 + 全状态快照分片条目');
  const snapEntry = entries.find((e) => e.identifier === 'yz-snap-1');
  ok(snapEntry && snapEntry.enabled === false, '快照条目为禁用备份（永不注入）');
  const snapWrap = JSON.parse(snapEntry.content);
  ok(snapWrap.v === 2 && snapWrap.kind === 'role' && snapWrap.total === 1 && snapWrap.index === 1, '快照分片带包装（版本/域/片序）');
  ok(JSON.parse(snapWrap.body).spaces.some((sp) => sp.chats.contacts.some((c) => c.id === 'c1')), '快照内容为整份状态（含全部空间）');
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
  const art2 = M.createRuntime({ chat: ah2.api.chat, message: ah2.api.message }, null, () => ({}));
  await art2.switchChat('chat-1');
  const degraded = await art2.syncArchive('chat-1');
  eq(degraded.ok, false, '无世界书能力时归档降级不报错');

  // 窗口内消息不足（≤6 条）：无归档条目，但同步过的聊天仍建快照书（备份层）
  const ah3 = fakeHost();
  const art3 = M.createRuntime(ah3.api, null, () => ({}));
  await art3.switchChat('chat-1');
  await art3.applyText(jade('a3', MSG_MIN), 'chat-1', 'test');
  await art3.syncArchive('chat-1');
  await new Promise((r) => setTimeout(r, 0));
  eq(ah3.lorebooks().length, 1, '同步过的聊天建快照书');
  const snapOnly = ah3.lorebooks()[0].entries;
  ok(snapOnly.length === 1 && snapOnly[0].identifier === 'yz-snap-1', '仅有快照条目无归档条目');
  eq(ah3.chatUpdates().length, 1, '快照书同样挂接当前聊天');

  // 封印交流讯息：不生成归档条目
  const ah4 = fakeHost();
  const art4 = M.createRuntime(ah4.api, null, () => ({ msg: false }));
  const sealedState = M.CORE.blankState('a4');
  sealedState.chats = { contacts: [{ id: 'c1', name: '林月如', messages: many(8, 'm') }], groups: [] };
  eq(art4.buildArchiveEntries(sealedState).length, 0, '封印交流讯息不归档');
}

// ---------- P2 · v3 评审边界回归 ----------
console.log('# P2 · v3 评审边界回归');
{
  // P2-01：发送基线与 AI 写入是两个独立策略。
  const policy = M.PROMPT.buildPrompt('zh', {}, { forceFull: false, current: [], spaces: [
    { name: '仅写入', isDefault: false, sendToAI: false, allowAIWrite: true },
    { name: '仅读取', isDefault: false, sendToAI: true, allowAIWrite: false }
  ] });
  ok(policy.includes('不送入基线') && policy.includes('允许 AI 写入'), 'sendToAI 关闭时提示词仍明确允许 AI 写入');
  ok(policy.includes('送入基线') && policy.includes('拒收 AI 写入'), 'allowAIWrite 关闭时提示词仍明确送入基线');

  // P2-02：名称不能占用任何空间 ID，定位不会因 ID 优先级发生歧义。
  const clashState = M.CORE.normalizeState({ spaces: [
    { id: 'sp0', isDefault: true }, { id: 'sp1', name: 'sp1' }, { id: 'sp2', name: 'SP2' }
  ] }, 'p2-clash');
  ok(clashState.spaces.every((sp) => !sp.isDefault ? !clashState.spaces.some((other) => other.id.toLowerCase() === sp.name.toLowerCase()) : true), '归一化保持空间 ID/name 不冲突');
  ok(M.CORE.findSpaceState(clashState, 'sp1').id === 'sp1' && M.CORE.findSpaceState(clashState, 'sp1').name !== 'sp1', 'ID/name 冲突修复后 ID 定位唯一');

  // P2-03：特殊名称进入协议时只传 token，解析可还原原名。
  const specialName = '手账 | 春\"\t册';
  const specialState = M.CORE.normalizeState({ spaces: [{ id: 'sp1', name: specialName, chats: { contacts: [{ id: 'c1', name: '可见联系人', messages: [] }], groups: [] } }] }, 'p2-route');
  const special = specialState.spaces[0];
  const specialRows = M.PROMPT.buildCurrent(specialState, {});
  const specialToken = M.CORE.encodeSpaceRoute(special.name);
  ok(specialToken && specialRows.join('\n').includes('space="' + specialToken + '"') && !specialRows.join('\n').includes('space="' + special.name + '"'), '特殊空间名使用可逆且协议安全的路由 token');
  const specialParsed = M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜route｜角色｜回写｜diff｜' + specialToken + '\n</yz_meta></yz_jade>');
  eq(specialParsed.turn.space, special.name, '空间路由 token 解析还原原名称');

  // P2-04：满容量且缺默认空间时不挤掉任何自定义空间；默认位于末尾也优先保留。
  const sixCustom = M.CORE.normalizeState({ spaces: Array.from({ length: 6 }, (_, i) => ({ id: 'sp' + (i + 1), name: '域' + i })) }, 'p2-cap');
  const beforeNames = sixCustom.spaces.map((sp) => sp.name);
  eq(M.CORE.ensureDefaultSpace(sixCustom), null, '无容量时默认空间不强行扩成第七个');
  eq(sixCustom.spaces.map((sp) => sp.name), beforeNames, '默认空间重建失败时自定义空间数据不丢');
  const defaultLast = M.CORE.normalizeState({ spaces: [{ id: 'sp1', name: '甲' }, { id: 'sp2', name: '乙' }, { id: 'sp0', isDefault: true }] }, 'p2-default-last');
  ok(M.CORE.defaultSpaceState(defaultLast) && defaultLast.spaces.length === 3, '默认空间排在输入末尾时仍保留');

  // P2-05/P2-14：只有空间元数据、meta-only 和拒写诊断也写入权威世界书。
  const mh = fakeHost();
  mh.current.chat = 'p2-meta';
  const mrt = M.createRuntime(mh.api, null, () => ({}));
  await mrt.switchChat('p2-meta');
  const metaSpace = mrt.createSpace('只保存元数据');
  await metaSpace.saved;
  const metaFlag = mrt.setSpaceFlag(metaSpace.id, 'sendToAI', false);
  await metaFlag.saved;
  const metaActive = mrt.setActiveSpace(metaSpace.id);
  await metaActive.saved;
  await mrt.saveChat('p2-meta');
  const mReload = M.createRuntime(mh.api, null, () => ({}));
  await mReload.switchChat('p2-meta');
  const restoredMeta = M.CORE.findSpaceState(mReload.current(), metaSpace.id);
  ok(restoredMeta && restoredMeta.name === '只保存元数据' && restoredMeta.sendToAI === false && mReload.current().activeSpaceId === metaSpace.id, '空白聊天空间元数据从权威快照恢复');
  await mrt.applyText('<yz_jade><yz_meta>\nturn｜p2-meta-only｜角色｜只记摘要｜diff\n</yz_meta></yz_jade>', 'p2-meta', 'test');
  await mrt.applyText('<yz_jade><yz_meta>\nturn｜p2-unknown｜角色｜未知空间｜diff｜不存在\n</yz_meta><yz_msg>\n-msg｜bad-parent｜bad-id\n</yz_msg></yz_jade>', 'p2-meta', 'test');
  await mrt.saveChat('p2-meta');
  const mReload2 = M.createRuntime(mh.api, null, () => ({}));
  await mReload2.switchChat('p2-meta');
  ok(M.CORE.defaultSpaceState(mReload2.current()).sync.issues.some((issue) => issue.code === 'space.unknown'), '拒写 issue 重载后仍在权威状态');

  // P2-06：未知实体/父实体的 diff 行拒写且形成诊断。
  const unknownState = M.CORE.normalizeState({ spaces: [{ id: 'sp0', isDefault: true, chats: { contacts: [{ id: 'c1', name: '甲', messages: [] }], groups: [] } }] }, 'p2-unknown-core');
  const unknownResult = M.CORE.applySnapshot(unknownState, { turn: { id: 'u1', mode: 'diff' }, diff: { msg: [{ add: false, type: 'msg', values: ['c1', 'missing'] }] } }, {});
  ok(!unknownResult.state.spaces[0].chats.contacts[0].messages.length && unknownResult.assessment.issues.some((issue) => issue.code === 'diff.unknown'), '未知 diff ID 不改数据并记 diff.unknown');

  // P2-07：采样未选中的实体即使仍存在，也不能被本轮 diff 改写。
  const sampled = M.CORE.normalizeState({ spaces: [{ id: 'sp0', isDefault: true, chats: { contacts: Array.from({ length: 5 }, (_, i) => ({ id: 'c' + i, name: '人' + i, messages: [] })), groups: [] } }] }, 'p2-hidden');
  const sampledCurrent = M.PROMPT.buildCurrent(sampled, {}, () => 0);
  const hiddenResult = M.CORE.applySnapshot(sampled, { turn: { id: 'hidden', mode: 'diff' }, diff: { msg: [{ add: false, type: 'contact', values: ['c4'] }] } }, {}, sampledCurrent.visibility);
  ok(sampled.spaces[0].chats.contacts.some((contact) => contact.id === 'c4') && hiddenResult.assessment.issues.some((issue) => issue.code === 'diff.hidden'), '采样窗口外联系人 diff fail-closed');

  // P2-08：窗口淘汰后靠累计 replyCount/seenReplies 继续计算未读。
  const longMessages = [{ id: 'pm-1', side: 'self', text: '我说' }].concat(Array.from({ length: 30 }, (_, i) => ({ id: 'r' + i, side: 'other', text: '回' + i })));
  const longChats = M.CORE.normalizeChats({ contacts: [{ id: 'c-1', name: '甲', messages: longMessages }], groups: [] });
  const unreadState = { chats: longChats, forum: { posts: [] } };
  M.CORE.recomputeThreadUnread(unreadState);
  eq(longChats.contacts[0].messages.length, 20, '长线程仍只保留消息窗口');
  eq(longChats.contacts[0].replyCount, 30, '窗口外回复累计数持久保留');
  eq(longChats.contacts[0].unread, 30, '窗口外回复仍计入未读');
  longChats.contacts[0].seenReplies = 12;
  M.CORE.recomputeThreadUnread(unreadState);
  eq(longChats.contacts[0].unread, 18, '持久 seenReplies 继续扣除未读');
  const longPost = M.CORE.normalizeForum({ posts: [{ id: 'fp', owner: 'player', title: '帖', comments: Array.from({ length: 25 }, (_, i) => ({ id: 'cm-' + i, author: '人', time: '' + i, text: '评' + i })) }] });
  const postUnreadState = { chats: { contacts: [], groups: [] }, forum: longPost };
  M.CORE.recomputeThreadUnread(postUnreadState);
  eq(longPost.posts[0].comments.length, 20, '长帖子仍只保留评论窗口');
  eq(longPost.posts[0].replyCount, 25, '窗口外评论累计数持久保留');
  eq(longPost.posts[0].unread, 25, '窗口外评论仍计入未读');

  // P2-09：评论满额时拒写，不通过保尾截断丢掉旧评论。
  const fullHost = fakeHost();
  const fullRt = M.createRuntime(fullHost.api, null, () => ({}));
  await fullRt.switchChat('p2-comments');
  const fullSid = fullRt.createSpace('评论空间').id;
  fullRt.spaceSaveEntity(fullSid, 'post', { title: '满帖', body: '正文' }, '');
  const fullPost = M.CORE.findSpaceState(fullRt.current(), fullSid).forum.posts[0];
  fullPost.comments = Array.from({ length: 20 }, (_, i) => ({ id: 'cm-' + i, author: '旧人', time: '' + i, text: '旧评论' + i }));
  const oldComment = fullPost.comments[0].text;
  const fullComment = fullRt.sendSpaceComment(fullSid, fullPost.id, '新评论');
  eq(fullComment.reason, 'full', '评论满额拒绝新评论');
  eq(fullPost.comments.length, 20, '评论满额不改变旧评论数量');
  eq(fullPost.comments[0].text, oldComment, '评论满额不丢最旧评论');

  // P2-10/P2-11：撤销快照绑定聊天，空间 ID 重用不假成功。
  const undoHost = fakeHost();
  const undoRt = M.createRuntime(undoHost.api, null, () => ({}));
  await undoRt.switchChat('p2-undo-a');
  const undoSid = undoRt.createSpace('待撤销').id;
  undoRt.spaceSaveEntity(undoSid, 'contact', { name: '旧联系人' }, '');
  const entityDelete = undoRt.spaceDeleteEntity(undoSid, 'contact', M.CORE.findSpaceState(undoRt.current(), undoSid).chats.contacts[0].id, '');
  await entityDelete.saved;
  await undoRt.switchChat('p2-undo-b');
  eq(undoRt.spaceRestoreEntity(entityDelete.snapshot).reason, 'chat', '实体撤销绑定原聊天');
  await undoRt.switchChat('p2-undo-a');
  const deletedSpace = undoRt.deleteSpace(undoSid);
  await deletedSpace.saved;
  const reused = undoRt.createSpace('新空间');
  eq(reused.id, undoSid, '删除后新空间复用旧 ID');
  eq(undoRt.restoreSpace(deletedSpace.snapshot).reason, 'id-reused', '空间 ID 重用时撤销失败而非假成功');

  // P2-12：实体撤销先检查父实体和容量。
  const restoreRt = M.createRuntime(fakeHost().api, null, () => ({}));
  await restoreRt.switchChat('p2-restore');
  const restoreSid = restoreRt.createSpace('容量空间').id;
  eq(restoreRt.spaceRestoreEntity({ chatId: 'p2-restore', spaceId: restoreSid, kind: 'message', parentId: 'gone', entity: { id: 'm1', text: '孤儿' } }).reason, 'missing', '父线程消失时消息撤销拒绝');
  for (let i = 0; i < 10; i += 1) restoreRt.spaceSaveEntity(restoreSid, 'contact', { name: '联系人' + i }, '');
  eq(restoreRt.spaceRestoreEntity({ chatId: 'p2-restore', spaceId: restoreSid, kind: 'contact', entity: { id: 'c-restored', name: '超量' } }).reason, 'full', '实体列表满额时撤销拒绝');

  // P2-13：最终序列化结果（含标签/换行）严格不超过预算。
  const hugeSpaces = { spaces: Array.from({ length: 6 }, (_, s) => ({ id: 'sp' + (s + 1), name: '空间' + s, chats: { contacts: Array.from({ length: 10 }, (_, c) => ({ id: 'c' + s + '-' + c, name: '人' + c, messages: Array.from({ length: 20 }, (_, i) => ({ id: 'm' + i, side: 'other', text: '字'.repeat(3000) })) })), groups: [] } })) };
  const hardCurrent = M.PROMPT.buildCurrent(M.CORE.normalizeState(hugeSpaces, 'p2-budget'), {});
  ok(hardCurrent.join('\n').length <= M.PROMPT.MAX_BASELINE_CHARS, '多空间最终基线严格不超过 MAX_BASELINE_CHARS');
}

// ---------- R2 · 用户流程与可用性修复 ----------
console.log('# R2 · 用户流程与可用性修复');
{
  ok(/function refreshThreadSummary\(thread, deletedMessage/.test(runtimeSource) && /refreshThreadSummary\(target, snapshot\.entity, deletedIndex, previousAnchorIndex\);/.test(runtimeSource), '删除消息后重算线程摘要');

  const r2Host = fakeHost();
  const r2Rt = M.createRuntime(r2Host.api, null, () => ({}));
  await r2Rt.switchChat('r2-flow');
  const r2Space = r2Rt.createSpace('流程空间');
  await r2Space.saved;
  const r2Contact = r2Rt.spaceSaveEntity(r2Space.id, 'contact', { name: '联系人' }, '');
  await r2Contact.saved;
  const r2Thread = M.CORE.findSpaceState(r2Rt.current(), r2Space.id).chats.contacts[0];
  r2Thread.messages = [
    { id: 'pm-1', side: 'self', time: '一', text: '我的话' },
    { id: 'reply-1', side: 'other', time: '二', text: '回复' },
    { id: 'reply-2', side: 'other', time: '三', text: '最后回复' }
  ];
  r2Thread.anchorId = 'pm-1'; r2Thread.replyCount = 2; r2Thread.seenReplies = 0; r2Thread.unread = 2;
  const deletedMessage = r2Rt.spaceDeleteEntity(r2Space.id, 'message', 'reply-2', r2Thread.id);
  await deletedMessage.saved;
  const refreshedThread = M.CORE.findSpaceState(r2Rt.current(), r2Space.id).chats.contacts[0];
  eq(refreshedThread.preview, '回复', '删除最后一条消息后线程摘要正文更新');
  eq(refreshedThread.time, '二', '删除最后一条消息后线程摘要时间更新');
  eq(refreshedThread.replyCount, 1, '删除消息后累计回复数重算');
  const seen = r2Rt.markSpaceThreadSeen(r2Space.id, refreshedThread.id);
  ok(seen.ok && seen.saved && (await seen.saved).ok, '打开线程的已读游标返回并等待保存结果');
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
  vh.seedBook('玉兆档案·chat-1', [{ identifier: 'yz-snap-1', name: '玉兆快照', enabled: false, content: JSON.stringify({ v: 2, ver: '2.0.2', rev: 5, updatedAt: 0, kind: 'role', index: 1, total: 1, body: JSON.stringify(oldState) }) }]);
  const vrt = M.createRuntime(vh.api, null, () => ({}));
  await vrt.switchChat('chat-1');
  eq(vrt.current().pluginVersion, M.PLUGIN_VERSION, '更新后版本号立即落盘');
  eq(vrt.current().pendingFull, true, '版本变化置持久化强制全量标记');

  const FULL_V = jade('v1', TABLET_OK
    + '<yz_msg>\ncontact｜c1｜林月如｜道侣｜今日｜0｜安好\ncontact｜c2｜酒剑仙｜师尊｜今日｜2｜饮酒\nmsg｜c1｜m1｜other｜昨日｜勿念\nmsg｜c1｜m2｜self｜今日｜定当赴约\nmsg｜c2｜m3｜other｜今日｜来喝酒\nmsg｜c2｜m4｜other｜今日｜速来\ngroup｜g1｜青云内门｜30｜今日｜5｜集合\ngmsg｜g1｜gm1｜掌门｜other｜今日｜卯时议事\ngmsg｜g1｜gm2｜长老｜other｜今日｜不得迟到\ngmsg｜g1｜gm3｜弟子｜other｜今日｜收到\n</yz_msg>'
    + '<yz_notes>\nfolder｜f1｜杂记｜2\nfolder｜f2｜秘录｜1\nnote｜n1｜f1｜今日｜false｜约定｜卯时山门\nnote｜n2｜f2｜今日｜true｜心法｜不可外传\nnote｜n3｜f1｜昨日｜false｜见闻｜坊市有新品灵草\n</yz_notes>'
    + '<yz_forum>\npost｜p1｜掌门｜长老｜公告｜今日｜议事｜卯时集合｜3\ncomment｜p1｜长老｜今日｜已知\ncomment｜p1｜弟子｜今日｜恭候\npost｜p2｜长老｜长老｜闲聊｜昨日｜论剑｜切磋记录｜1\ncomment｜p2｜弟子｜昨日｜围观\n</yz_forum>'
    + '<yz_market>\nlisting｜l1｜灵草｜下品｜百年份｜10灵石｜坊主\nauction｜a1｜古剑｜上品｜锈蚀｜100｜150｜1时辰｜3\norder｜o1｜符纸｜已成交｜5灵石｜今日｜买\nrequest｜r1｜百年灵草｜下品｜急收炼丹｜8灵石｜炼丹师\n</yz_market>'
    + '<yz_space>\ncurrency｜灵石｜120\nitem｜i1｜养神丹｜2｜中品｜宁神益气\nitem｜i2｜驱邪符｜5｜下品｜辟邪护身\n</yz_space>'
    + '<yz_map>\ncurrent｜青云山｜东域｜山门所在\ntrack｜t1｜昨日｜山门｜入门\ntrack｜t2｜今日｜演武场｜晨练\nplace｜p1｜青云山｜东域｜山门所在，灵气充沛\nplace｜p2｜演武场｜东域｜弟子晨练之地\n</yz_map>');
  const vr1 = await vrt.applyText(FULL_V, 'chat-1', 'test');
  ok(vr1.changed, '更新后全量轮应用成功');
  eq(dflt(vrt.current()).sync.status, 'complete', '更新后全量轮完整达标');
  eq(vrt.current().pendingFull, false, '全量轮成功后清除强制全量标记');

  const diffSnap = '<yz_jade><yz_meta>\nturn｜v2｜李逍遥｜增量｜diff\n</yz_meta><yz_msg>\n+msg｜c1｜m9｜other｜丙午年五月十二 午时｜新消息\n</yz_msg></yz_jade>';
  const vr2 = await vrt.applyText(diffSnap, 'chat-1', 'test');
  ok(vr2.changed, '后续 diff 轮应用成功');
  eq(vrt.current().pendingFull, false, 'diff 轮不清除（已清除状态保持）');

  // 2. normalizeState 保留版本字段与标记
  const ns = M.CORE.normalizeState({ pluginVersion: '2.1.0', pendingFull: true }, 'chat-1');
  eq(ns.pluginVersion, '2.1.0', 'normalizeState 保留版本号');
  eq(ns.pendingFull, true, 'normalizeState 保留强制全量标记');

  // 3. 世界书为空、本地镜像有数据（旧宿主键迁移场景）→ 镜像恢复并回写世界书
  const gh = fakeHost();
  const gs = M.CORE.blankState('chat-1');
  gs.revision = 3;
  gs.chats = { contacts: [{ id: 'c1', name: '林月如', messages: [{ id: 'm1', side: 'other', time: '丙午年五月十二 午时', text: '重要消息' }] }], groups: [] };
  const gStore = new Map();
  gStore.set('yz-jade-v1:chat-1', JSON.stringify(gs));
  const gLocal = {
    getItem: (k) => (gStore.has(k) ? gStore.get(k) : null),
    setItem: (k, v) => { gStore.set(k, String(v)); }
  };
  const grt = M.createRuntime(gh.api, gLocal, () => ({}));
  await grt.switchChat('chat-1');
  eq(dflt(grt.current()).revision, 3, '世界书为空时从本地镜像恢复');
  eq(dflt(grt.current()).chats.contacts[0].messages[0].text, '重要消息', '恢复的数据完整');
  eq(grt.current().pendingFull, true, '恢复后版本变化仍触发强制全量');
  await flushWorld();
  const gBook = gh.lorebooks().find((b) => b.name === '玉兆档案·chat-1');
  ok(gBook && gBook.entries.some((e) => e.identifier === 'yz-snap-1'), '镜像恢复后回写世界书（自动迁移）');

  // 4. 本地镜像被清（换设备）→ 世界书快照恢复并回写镜像
  const sh = fakeHost();
  const sStore = new Map();
  const sLocal = {
    getItem: (k) => (sStore.has(k) ? sStore.get(k) : null),
    setItem: (k, v) => { sStore.set(k, String(v)); }
  };
  const srt = M.createRuntime(sh.api, sLocal, () => ({}));
  await srt.switchChat('chat-1');
  await srt.applyText(jade('s1', MSG_ARCH), 'chat-1', 'test');
  await srt.syncArchive('chat-1');
  eq(sh.lorebooks().length, 1, '快照建书一次');
  const srt2 = M.createRuntime(sh.api, null, () => ({}));
  await srt2.switchChat('chat-1');
  eq(dflt(srt2.current()).revision, 1, '本地镜像被清后从世界书快照恢复');
  ok(dflt(srt2.current()).chats.contacts.some((c) => c.id === 'c1'), '快照恢复的联系人完整');

  // 5. 零同步数据聊天（revision 0）不建快照书
  const eh = fakeHost();
  const ert = M.createRuntime(eh.api, null, () => ({}));
  await ert.switchChat('chat-1');
  await ert.syncArchive('chat-1');
  eq(eh.lorebooks().length, 0, '零同步数据聊天不建快照书');
}

// ---------- 双玉兆 · 玩家域与传讯通道（一期核心）----------
console.log('# 用户空间 · 核心与运行时');
{
  // CORE 纯函数：id 生成确定性、实体查找（含新增 contact）
  eq(M.CORE.playerNextId([], 'pn-'), 'pn-1', '空集合 id 从 1 开始');
  eq(M.CORE.playerNextId([{ id: 'pn-1' }, { id: 'pn-3' }], 'pn-'), 'pn-4', 'id 取集合最大编号 +1');
  const findSt = M.CORE.blankUserSpace('f', { id: 'sp1', name: '甲' });
  findSt.notes = { folders: [{ id: 'pf-1', name: '杂记' }], notes: [] };
  findSt.chats = { contacts: [{ id: 'c-1', name: '遥', messages: [] }], groups: [] };
  eq(M.CORE.playerFindEntity(findSt, 'folder', 'pf-1').name, '杂记', 'playerFindEntity 按 id 查找');
  eq(M.CORE.playerFindEntity(findSt, 'contact', 'c-1').name, '遥', '空间实体查找覆盖联系人');
  eq(M.CORE.playerFindEntity(findSt, 'folder', 'pf-x'), null, '找不到返回 null');
  eq(M.CORE.playerFindEntity(findSt, 'nope', 'x'), null, '未知 kind 返回 null');
}

{
  // Runtime 空间生命周期：创建/重名/开关/删除/撤销/默认空间重建
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-1');
  await rt.applyText(jade('t1', TABLET_OK + MSG_MIN), 'chat-1', 'test');
  eq(rt.current().spaces.length, 1, '初始仅默认空间');
  ok(M.CORE.defaultSpaceState(rt.current()).isDefault, '默认空间在位');

  eq(rt.createSpace('   ').ok, false, '空名空间拒建');
  const c1 = rt.createSpace('我');
  ok(c1.ok && c1.id, '创建空间成功');
  eq(rt.createSpace('我').reason, 'clash', '重名空间拒建');
  eq(rt.createSpace(' 我 ').reason, 'clash', 'trim 后重名同样拒建');
  eq(rt.createSpace('sp0').reason, 'clash', '空间名不得占用默认空间 id');
  let guard = 0;
  while (rt.current().spaces.length < 6 && guard < 10) { guard += 1; rt.createSpace('域' + guard); }
  eq(rt.current().spaces.length, 6, '空间数达到上限 6');
  eq(rt.createSpace('第七域').reason, 'full', '空间数量上限拒建');

  const sid = c1.id;
  const sp0 = () => M.CORE.findSpaceState(rt.current(), sid);
  ok(sp0().sendToAI && sp0().allowAIWrite, '自定义空间默认发送AI+允许写入');
  rt.setSpaceFlag(sid, 'sendToAI', false);
  eq(sp0().sendToAI, false, '发送AI开关生效');
  rt.setSpaceFlag(sid, 'sendToAI', true);
  eq(sp0().sendToAI, true, '发送AI可再开');
  eq(rt.setSpaceFlag(M.CORE.DEFAULT_SPACE_ID, 'allowAIWrite', false).reason, 'default', '默认空间强制 AI 可写（拒关）');
  eq(rt.setSpaceFlag(sid, 'bogus', true).ok, false, '未知开关键拒收');
  eq(rt.renameSpace(M.CORE.DEFAULT_SPACE_ID, 'X').reason, 'default', '默认空间不可改名（名字跟随角色）');
  ok(rt.renameSpace(sid, '本人').ok, '自定义空间可改名');
  eq(rt.renameSpace(sid, '域1').reason, 'clash', '改名撞已有空间名拒收');

  const del = rt.deleteSpace(sid);
  ok(del.ok && del.snapshot.id === sid, '删除空间返回快照');
  ok(!M.CORE.findSpaceState(rt.current(), sid), '空间已消失');
  ok(rt.restoreSpace(del.snapshot).ok, '撤销删除成功');
  ok(M.CORE.findSpaceState(rt.current(), sid), '空间已还原');

  // 默认空间删除 → AI 无空间参数的写入自动重建
  const ddel = rt.deleteSpace(M.CORE.DEFAULT_SPACE_ID);
  ok(ddel.ok && !M.CORE.defaultSpaceState(rt.current()), '默认空间可删除');
  await rt.applyText(jade('t-def', TABLET_OK + MSG_MIN), 'chat-1', 'test');
  ok(M.CORE.defaultSpaceState(rt.current()), '无空间参数的写入重建默认空间');
  eq(dflt(rt.current()).tablet.name, '李逍遥', '重建后的默认空间承接 AI 数据');
}

{
  // 删除唯一默认空间 → 新建自定义空间 → AI 无空间参数写入重建默认空间：
  // activeSpaceId 应保持「未显式选择」状态，可见空间惰性解析回重建的默认空间，
  // 而不是被归一化钉到空的自定义空间（否则 UI 停在空空间，看不到已落盘的数据）。
  const host = fakeHost();
  host.current.chat = 'chat-def-rebuild';
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-def-rebuild');
  ok(M.CORE.defaultSpaceState(rt.current()), '初始存在默认空间');
  const del = rt.deleteSpace(M.CORE.DEFAULT_SPACE_ID);
  await del.saved;
  ok(!M.CORE.defaultSpaceState(rt.current()) && rt.current().spaces.length === 0, '删除唯一默认空间后没有任何空间');
  const made = rt.createSpace('用户甲');
  await made.saved;
  eq(rt.current().activeSpaceId, '', '删除唯一空间后 activeSpaceId 为空（未显式选择）');
  const visibleId = () => {
    const st = rt.current();
    const sp = M.CORE.findSpaceState(st, st.activeSpaceId) || st.spaces[0];
    return sp && sp.id;
  };
  eq(visibleId(), made.id, '无默认空间时可见空间回退到首个自定义空间');
  await rt.applyText(jade('rebuild-1', TABLET_OK + MSG_MIN), 'chat-def-rebuild', 'test');
  await rt.saveChat('chat-def-rebuild');
  const def = M.CORE.defaultSpaceState(rt.current());
  ok(def && def.tablet.name === '李逍遥', 'AI 写入重建默认空间并承接数据');
  eq(rt.current().activeSpaceId, '', 'activeSpaceId 不被归一化改写');
  eq(visibleId(), M.CORE.DEFAULT_SPACE_ID, '重建后可见空间解析到默认空间，不再停在空自定义空间');
  const reload = M.createRuntime(host.api, null, () => ({}));
  await reload.switchChat('chat-def-rebuild');
  const defR = M.CORE.defaultSpaceState(reload.current());
  const visibleR = M.CORE.findSpaceState(reload.current(), reload.current().activeSpaceId) || reload.current().spaces[0];
  ok(defR && defR.tablet.name === '李逍遥' && visibleR && visibleR.id === M.CORE.DEFAULT_SPACE_ID, '权威快照重载后仍看到重建的默认空间数据');
}

{
  // 写入路由：按空间名路由；未知/只读/全量轮三种拒写；空间间数据隔离
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-r');
  await rt.applyText(jade('f0', TABLET_OK + MSG_MIN), 'chat-r', 'test');
  const c = rt.createSpace('甲');
  const sid = c.id;
  // 用户联系人（c- 前缀门禁保护）
  rt.spaceSaveEntity(sid, 'contact', { name: '夭夭', relation: '同门' }, '');
  const threadId = M.CORE.findSpaceState(rt.current(), sid).chats.contacts[0].id;
  const sent = rt.sendSpaceMessage(sid, threadId, '师兄何在');
  ok(/^pm-\d+$/.test(sent.id), '用户发言 id=pm-N');

  const spaceText = '<yz_jade><yz_meta>\nturn｜r1｜李逍遥｜回话｜diff｜甲\n</yz_meta><yz_msg>\n+msg｜' + threadId + '｜ra1｜other｜丙午年五月十二 午时｜在此\n</yz_msg></yz_jade>';
  await rt.applyText(spaceText, 'chat-r', 'test');
  const spAfter = M.CORE.findSpaceState(rt.current(), sid);
  const tc = spAfter.chats.contacts.find((x) => x.id === threadId);
  ok(tc.messages.some((m) => m.id === 'ra1'), 'AI 按空间名路由写入用户线程');
  eq(tc.unread, 1, '尾随回复计未读');
  rt.markSpaceThreadSeen(sid, threadId);
  eq(M.CORE.findSpaceState(rt.current(), sid).chats.contacts.find((x) => x.id === threadId).unread, 0, '打开线程 seen 对齐、未读清零');
  // 默认空间未被污染
  ok(!dflt(rt.current()).chats.contacts.some((x) => x.id === threadId), '用户线程不进默认空间');

  // 门禁：模型不得改删用户联系人与用户发言
  await rt.applyText('<yz_jade><yz_meta>\nturn｜r2｜李逍遥｜篡改｜diff｜甲\n</yz_meta><yz_msg>\n-contact｜' + threadId + '\n+msg｜' + threadId + '｜pm-99｜other｜今日｜伪造\n+msg｜' + threadId + '｜ra1｜self｜今日｜改写\n</yz_msg></yz_jade>', 'chat-r', 'test');
  const guarded = M.CORE.findSpaceState(rt.current(), sid).chats.contacts.find((x) => x.id === threadId);
  ok(guarded && guarded.messages.some((m) => m.id === 'ra1' && m.text === '在此'), '-contact/+msg pm-99/+改写 全部被门禁拒绝');
  ok(!guarded.messages.some((m) => m.id === 'pm-99'), '伪造 pm-N 被拒');

  // 拒写：未知空间
  const before = dflt(rt.current()).revision;
  await rt.applyText('<yz_jade><yz_meta>\nturn｜r3｜李逍遥｜未知｜diff｜不存在空间\n</yz_meta><yz_msg>\n+contact｜z1｜路人｜无｜今日｜0｜\n</yz_msg></yz_jade>', 'chat-r', 'test');
  ok(!M.CORE.findSpaceState(rt.current(), '不存在空间'), '未知空间不建档');
  ok(rt.current().spaces.some((x) => x.id === sid) && M.CORE.defaultSpaceState(rt.current()).sync.issues.some((i) => i.code === 'space.unknown'), '未知空间写入记 space.unknown issue');
  // 拒写：只读空间
  rt.setSpaceFlag(sid, 'allowAIWrite', false);
  await rt.applyText('<yz_jade><yz_meta>\nturn｜r4｜李逍遥｜越权｜diff｜甲\n</yz_meta><yz_msg>\n+msg｜' + threadId + '｜rb1｜other｜今日｜越权行\n</yz_msg></yz_jade>', 'chat-r', 'test');
  ok(!M.CORE.findSpaceState(rt.current(), sid).chats.contacts.find((x) => x.id === threadId).messages.some((m) => m.id === 'rb1'), '只读空间拒收一切写入');
  ok(M.CORE.findSpaceState(rt.current(), sid).sync.issues.some((i) => i.code === 'space.denied'), '拒写记 space.denied issue');
  rt.setSpaceFlag(sid, 'allowAIWrite', true);
  // 拒写：用户空间只接受 diff（全量轮抹数据防线）
  await rt.applyText('<yz_jade><yz_meta>\nturn｜r5｜李逍遥｜全量抹除｜full｜甲\n</yz_meta><yz_msg>\ncontact｜z9｜凭空｜无｜今日｜0｜\n</yz_msg></yz_jade>', 'chat-r', 'test');
  eq(M.CORE.findSpaceState(rt.current(), sid).chats.contacts.length, 1, '非默认空间全量轮被丢弃');
  ok(M.CORE.findSpaceState(rt.current(), sid).sync.issues.some((i) => i.code === 'space.full'), '用户空间全量轮记 space.full issue');
}

{
  // 旧玩家域迁移：镜像键数据 →「我」空间；旧键删除；幂等标记
  const host = fakeHost();
  const legacyStore = new Map();
  legacyStore.set('yz-jade-player-v1:chat-m', JSON.stringify({
    chatId: 'chat-m', updatedAt: 123,
    tablet: { groups: [{ id: 'basic', fields: [{ key: '名字', value: '旧我' }] }] },
    chats: { contacts: [{ id: 'yz-character', name: '李逍遥', messages: [{ id: 'pm-1', side: 'self', time: '今日', text: '旧传讯' }] }], groups: [{ id: 'pg-1', name: '旧群', messages: [] }] },
    notes: { folders: [{ id: 'pf-1', name: '手札' }], notes: [{ id: 'pn-1', folderId: 'pf-1', title: '旧备忘', body: 'x' }] },
    market: { listings: [{ id: 'pl-1', name: '旧物' }], auctions: [], orders: [], requests: [] },
    space: { currencies: [{ kind: '灵石', amount: '10' }], items: [] },
    map: { current: { place: '旧山门' }, tracks: [], places: [] },
    forum: { posts: [{ id: 'fp-1', owner: 'player', title: '旧帖', author: '我' }] }
  }));
  const gLocal = {
    getItem: (k) => (legacyStore.has(k) ? legacyStore.get(k) : null),
    setItem: (k, v) => { legacyStore.set(k, String(v)); },
    removeItem: (k) => { legacyStore.delete(k); }
  };
  const rt = M.createRuntime(host.api, gLocal, () => ({}));
  await rt.switchChat('chat-m');
  const me = rt.current().spaces.find((x) => !x.isDefault);
  ok(me && me.name === '我', '旧玩家域迁移为「我」空间');
  eq(me.chats.contacts[0].messages.length, 1, '旧传讯线程保留');
  eq(me.notes.notes.length, 1, '旧备忘保留');
  eq(me.tablet.groups.length, 1, '旧玉牌分区保留');
  eq(me.chats.groups.length, 1, '旧群聊分区保留');
  eq(me.market.listings.length, 1, '旧坊市分区保留');
  eq(me.space.currencies.length, 1, '旧储物分区保留');
  eq(me.map.current.place, '旧山门', '旧舆图分区保留');
  eq(me.forum.posts[0].owner, 'player', '旧玩家帖 owner 标记保留');
  ok(!legacyStore.has('yz-jade-player-v1:chat-m'), '迁移后旧玩家域镜像键删除');
  ok(rt.current().migratedPlayer === true, 'migratedPlayer 标记持久化');
  // 再次进入不重复迁移
  await rt.switchChat('chat-m');
  eq(rt.current().spaces.filter((x) => x.name === '我').length, 1, '迁移幂等（不重复建档）');
}

{
  // 空间实体 CRUD（取代玩家域 CRUD）：校验/级联/撤销/落盘；不写默认空间
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-1');
  const sid = rt.createSpace('我').id;
  const p = () => M.CORE.findSpaceState(rt.current(), sid);

  // 联系人：新建（自定义名称）+ 必填校验 + 编辑
  eq(rt.spaceSaveEntity(sid, 'contact', { name: '' }, '').reason, 'name', '空名称联系人拒绝保存');
  eq(rt.spaceSaveEntity(sid, 'contact', { name: '遥' }, '').ok, true, '新增联系人成功');
  const cContact = p().chats.contacts[0];
  ok(/^c-/.test(cContact.id), '用户联系人 id 带 c- 前缀');
  eq(rt.spaceSaveEntity(sid, 'contact', { name: '改遥', relation: '好友' }, cContact.id).ok, true, '编辑联系人成功');
  eq(p().chats.contacts[0].name, '改遥', '联系人名称已更新');

  // 玉册夹/备忘/物品/钱财/订单（沿用二期语义）
  eq(rt.spaceSaveEntity(sid, 'folder', { name: '杂记' }, ''), { ok: true }, '创建玉册夹成功');
  eq(p().notes.folders[0].id, 'pf-1', '玉册夹 id 从 pf-1 开始');
  eq(rt.spaceSaveEntity(sid, 'folder', { name: '' }, '').reason, 'name', '空名称拒绝保存');
  eq(rt.spaceSaveEntity(sid, 'note', { title: '约定', body: '卯时山门', folderId: 'pf-1', locked: true }, '').ok, true, '创建备忘成功');
  eq(rt.spaceSaveEntity(sid, 'note', { title: 'x', folderId: 'pf-99' }, '').reason, 'folder', '不存在父玉册夹拒绝保存');
  eq(p().notes.folders.find((f) => f.id === 'pf-1').count, 1, '文件夹计数按笔记派生');
  eq(rt.spaceSaveEntity(sid, 'item', { name: '养神丹', qty: 2 }, '').ok, true, '创建物品成功');
  eq(rt.spaceSaveEntity(sid, 'currency', { kind: '灵石', amount: '100' }, '').ok, true, '创建钱财成功');
  eq(rt.spaceSaveEntity(sid, 'currency', { kind: '灵石', amount: '9' }, '').reason, 'kindClash', '重命名撞已有种类拒绝');
  eq(rt.spaceSaveEntity(sid, 'order', { name: '符纸', side: 'sell' }, '').ok, true, '创建订单成功');
  eq(p().market.orders[0].side, 'sell', '卖出方向归一');
  eq(rt.spaceSaveEntity(sid, 'tablet-field', { group: 'basic', key: '名字', value: '李逍遥' }, '').ok, true, '新增玉牌属性成功');
  eq(rt.spaceSaveEntity(sid, 'tablet-field', { group: 'basic', key: '名字', value: '李大侠' }, '名字').ok, true, '编辑玉牌属性成功');
  const tfDel = rt.spaceDeleteEntity(sid, 'tablet-field', '名字', 'basic');
  ok(tfDel.ok && tfDel.snapshot.entity.value === '李大侠', '删除玉牌属性成功');
  eq(rt.spaceRestoreEntity(tfDel.snapshot).ok, true, '撤销删除玉牌属性成功');
  eq(rt.spaceSaveEntity(sid, 'badkind', {}, '').reason, 'kind', '未知 kind 拒绝');

  // 删除（带快照）+ 撤销；级联
  const folderDel = rt.spaceDeleteEntity(sid, 'folder', 'pf-1');
  ok(folderDel.ok && folderDel.snapshot.notes.length === 1, '删除玉册夹级联备忘并带回快照');
  eq(p().notes.notes.length, 0, '级联删除生效');
  eq(rt.spaceRestoreEntity(folderDel.snapshot).ok, true, '撤销删除玉册夹成功');
  eq(p().notes.notes.length, 1, '撤销级联一并还原');
  eq(rt.spaceDeleteEntity(sid, 'note', 'nope').ok, false, '找不到的实体拒绝删除');
  eq(rt.spaceRestoreEntity({}).ok, false, '无快照的撤销拒绝');

  // 发言与评论：论坛评论 pmc- 保护 + 用户帖 owner=player
  const postSave = rt.spaceSaveEntity(sid, 'post', { title: '问剑', body: '求指点', section: '闲聊' }, '');
  ok(postSave.ok, '发帖成功');
  const posted = p().forum.posts[0];
  eq(posted.owner, 'player', '用户帖带 owner=player');
  const cmt = rt.sendSpaceComment(sid, posted.id, '我来答');
  ok(/^pmc-\d+$/.test(cmt.id), '用户评论 id=pmc-N');
  await rt.applyText('<yz_jade><yz_meta>\nturn｜cr1｜李逍遥｜篡改评论｜diff｜我\n</yz_meta><yz_forum>\n-comment｜' + posted.id + '｜' + '我' + '｜任意｜文本不存在\n+post｜' + posted.id + '｜甲｜乙｜闲聊｜今日｜改写｜改写｜0\n</yz_forum></yz_jade>', 'chat-1', 'test');
  eq(p().forum.posts[0].title, '问剑', '模型不得改写用户帖（diff 门禁）');

  // CRUD 不写默认空间
  eq(dflt(rt.current()).notes.folders.length, 0, '空间 CRUD 不写默认空间玉册');
  eq(dflt(rt.current()).chats.contacts.length, 0, '空间 CRUD 不写默认空间联系人');
}

{
  // 持久化：空间数据随整份状态进世界书快照；重载可恢复；新聊天无残留
  const host = fakeHost();
  host.current.chat = 'chat-c';
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-c');
  const sid = rt.createSpace('我').id;
  rt.spaceSaveEntity(sid, 'folder', { name: '杂记' }, '');
  rt.spaceSaveEntity(sid, 'note', { title: '约定', body: '卯时', folderId: 'pf-1' }, '');
  const iid = rt.createSpace('乙').id;
  rt.spaceSaveEntity(iid, 'item', { name: '丹', qty: 1 }, '');
  await flushWorld();
  const rt3 = M.createRuntime(host.api, null, () => ({}));
  await rt3.switchChat('chat-c');
  const restored = M.CORE.findSpaceState(rt3.current(), sid);
  eq(restored.notes.folders.length, 1, '重载后玉册夹恢复');
  eq(restored.notes.notes.length, 1, '重载后备忘恢复');
  eq(M.CORE.findSpaceState(rt3.current(), iid).space.items.length, 1, '第二空间数据独立恢复');
  const cbook = host.lorebooks().find((b) => b.name === '玉兆档案·chat-c');
  ok(cbook && cbook.entries.every((e) => !/^yz-psnap/.test(e.identifier)), '旧 yz-psnap 域条目不再写入（整本替换自然消失）');
  const host2 = fakeHost();
  const rt2 = M.createRuntime(host2.api, null, () => ({}));
  await rt2.switchChat('chat-new');
  eq(rt2.current().spaces.length, 1, '新聊天仅默认空间（无残留）');
}

// ---------- 四、角色域内容扩展：玉牌扩组（功法/羁绊） ----------
console.log('# 玉牌扩组（功法/羁绊）');
{
  // 组名归一：中文/英文别名全部归入 gong/bond
  eq(M.CORE.groupId('功法'), 'gong', '功法组别名归一');
  eq(M.CORE.groupId('心法'), 'gong', '心法组别名归一');
  eq(M.CORE.groupId('technique'), 'gong', 'technique 别名归一');
  eq(M.CORE.groupId('羁绊'), 'bond', '羁绊组别名归一');
  eq(M.CORE.groupId('缘分'), 'bond', '缘分组别名归一');
  eq(M.CORE.groupId('bonds'), 'bond', 'bonds 别名归一');
  eq(M.CORE.groupId('装备'), null, '未知组名拒绝');

  // normalizeTablet：新组进入固定顺序（修为→功法→羁绊→隐秘）
  const ts = M.CORE.normalizeTablet({
    groups: [
      { id: 'secret', fields: [{ key: '身世', value: '弃徒' }] },
      { id: 'gong', fields: [{ key: '功法名', value: '青云剑诀' }] },
      { id: 'bond', fields: [{ key: '道侣', value: '林月如' }] }
    ]
  });
  eq(ts.groups.map((g) => g.id).join(','), 'gong,bond,secret', '新组按 GROUP_ORDER 重排且未知组剔除');

  // diff：+field 建组/更新、canonical 键去重、-field 删行（走完整应用链路，含达标门禁）
  const dgState = M.CORE.blankState('dg');
  dgState.tablet = M.CORE.normalizeTablet(TABLET_OBJ);
  const dg1 = M.CORE.applySnapshot(dgState, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜dg1｜李逍遥｜换功法｜diff\n</yz_meta><yz_tablet>\n+field｜功法｜主修功法｜御剑术\n</yz_tablet></yz_jade>'), {}).state;
  eq(dflt(dg1).tablet.groups.find((g) => g.id === 'gong').fields.length, 1, '功法组内 canonical 键合并为一行');
  eq(dflt(dg1).tablet.groups.find((g) => g.id === 'gong').fields[0].value, '御剑术', 'canonical 键更新功法');
  const dg2 = M.CORE.applySnapshot(dg1, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜dg2｜李逍遥｜结缘｜diff\n</yz_meta><yz_tablet>\n+field｜羁绊｜师尊｜酒剑仙\n</yz_tablet></yz_jade>'), {}).state;
  eq(dflt(dg2).tablet.groups.find((g) => g.id === 'bond').fields.length, 2, '羁绊组追加新行');
  const dg3 = M.CORE.applySnapshot(dg2, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜dg3｜李逍遥｜缘尽｜diff\n</yz_meta><yz_tablet>\n-field｜羁绊｜师尊\n</yz_tablet></yz_jade>'), {}).state;
  eq(dflt(dg3).tablet.groups.find((g) => g.id === 'bond').fields.length, 1, '删除羁绊一行后保留道侣行');
  const dg4 = M.CORE.applySnapshot(dg3, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜dg4｜李逍遥｜弃功｜diff\n</yz_meta><yz_tablet>\n-field｜功法｜功法名\n</yz_tablet></yz_jade>'), {}).state;
  eq(dflt(dg4).tablet.groups.find((g) => g.id === 'gong').fields[0].value, '御剑术', '删空功法组被达标门禁拦截不落盘');

  // 达标评估：缺组记 issue，补足后全组达标
  const bare = M.CORE.normalizeTablet(TABLET_OBJ);
  const partial = M.CORE.assess({ version: 1, turn: { id: 't', roleName: 'r', summary: 's' }, tablet: bare }, {});
  ok(partial.tablet.ok === true, '六组齐全时玉牌达标');
  const missing = M.CORE.assess({ version: 1, turn: { id: 't', roleName: 'r', summary: 's' }, tablet: M.CORE.normalizeTablet({ groups: [{ id: 'basic', fields: [{ key: '名字', value: '李逍遥' }, { key: '性别', value: '男' }, { key: '身高', value: '175' }, { key: '体重', value: '60' }] }, { id: 'look', fields: [{ key: '外貌', value: '清朗' }, { key: '穿着', value: '道袍' }] }, { id: 'cult', fields: [{ key: '灵根', value: '天灵根' }, { key: '体质', value: '凡体' }, { key: '境界', value: '炼气' }, { key: '状态', value: '佳' }] }] }) }, {});
  ok(missing.tablet.ok === false, '缺功法/羁绊时玉牌不达标');
  ok(missing.tablet.groups.gong === false && missing.tablet.groups.bond === false, '功法/羁绊独立判定');
  ok(missing.issues.some((i) => i.code === 'tablet.gong') && missing.issues.some((i) => i.code === 'tablet.bond'), '缺组 issue 回显');

  // issue 文案双语
  ok(zhCatalog['assess.issue.tablet.gong'] && enCatalog['assess.issue.tablet.gong'], '功法 issue 双语文案存在');

  // 引导：提示词包含新组行与约束
  const pGuide = M.PROMPT.buildPrompt('zh', {}, { forceFull: true, current: [] });
  ok(pGuide.includes('field｜功法｜功法名｜所修功法') && pGuide.includes('field｜羁绊｜羁绊对象｜关系说明'), '引导行含功法/羁绊');
  ok(pGuide.includes('功法（至少 1 门）、羁绊（至少 1 条）'), '约束文本含新组底线');

  // 基线：buildCurrent 含新组字段行
  const dgFull = M.CORE.normalizeTablet(TABLET_OBJ);
  const dgCur = M.PROMPT.buildCurrent({ tablet: dgFull }, {});
  ok(dgCur.includes('field｜gong｜功法名｜青云剑诀'), '基线含功法行');
  ok(dgCur.includes('field｜bond｜道侣｜林月如'), '基线含羁绊行');
}

// ---------- 四·二、舆图地点名录（map.places + 世界书召回） ----------
console.log('# 舆图地点名录');
{
  // 归一：places 过滤空 id/空名
  const nm = M.CORE.normalizeMap({ current: { place: '青云山' }, tracks: [], places: [{ id: 'p1', name: '青云山', domain: '东域', desc: '山门' }, { id: '', name: '无id' }, { id: 'p2', name: '' }, { id: 'p3', name: '演武场' }] });
  eq(nm.places.length, 2, '地点名录过滤空 id/空名');
  eq(nm.places[0].desc, '山门', '地点描述保留');

  // 解析：place 行与中文别名
  const pm = M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜pm1｜李逍遥｜舆图\n</yz_meta><yz_map>\ncurrent｜青云山｜东域｜山门\nplace｜p1｜青云山｜东域｜山门所在\ntrack｜t1｜今日｜演武场｜晨练\n地点｜p2｜藏经阁｜东域｜藏书之地\n</yz_map></yz_jade>');
  eq(pm.map.places.length, 2, 'place 行与地点别名均解析');
  eq(pm.map.places[1].name, '藏经阁', '中文别名解析出地点');
  eq(pm.map.tracks.length, 1, 'track 行不受影响');

  // diff：+place 追加/更新、-place 删除（含达标门禁）
  let mpState = M.CORE.blankState('mp');
  mpState.map = M.CORE.normalizeMap({ current: { place: '青云山', domain: '东域', desc: '山门' }, tracks: [{ id: 't1', place: '山门', action: '入门' }, { id: 't2', place: '演武场', action: '晨练' }], places: [{ id: 'p1', name: '青云山', desc: '山门' }, { id: 'p2', name: '演武场', desc: '练功' }] });
  const mp1 = M.CORE.applySnapshot(mpState, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜mp1｜李逍遥｜新地名｜diff\n</yz_meta><yz_map>\n+place｜p3｜藏经阁｜东域｜藏书万卷\n</yz_map></yz_jade>'), {}).state;
  eq(dflt(mp1).map.places.length, 3, '地点名录追加新地点');
  const mp2 = M.CORE.applySnapshot(mp1, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜mp2｜李逍遥｜改说明｜diff\n</yz_meta><yz_map>\n+place｜p1｜青云山｜东域｜护山大阵所在\n</yz_map></yz_jade>'), {}).state;
  eq(dflt(mp2).map.places.find((p) => p.id === 'p1').desc, '护山大阵所在', '+place 按 id 整行替换');
  const mp3 = M.CORE.applySnapshot(mp2, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜mp3｜李逍遥｜弃一处｜diff\n</yz_meta><yz_map>\n-place｜p2\n</yz_map></yz_jade>'), {}).state;
  eq(dflt(mp3).map.places.length, 2, '-place 删除指定地点');
  const mp4 = M.CORE.applySnapshot(mp3, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜mp4｜李逍遥｜删多了｜diff\n</yz_meta><yz_map>\n-place｜p3\n</yz_map></yz_jade>'), {}).state;
  eq(dflt(mp4).map.places.length, 2, '删到 2 处以下被达标门禁拦截');

  // 达标：地点至少 2 处
  const aOk = M.CORE.assess({ version: 1, turn: { id: 't', roleName: 'r', summary: 's' }, map: dflt(mp3).map }, {});
  ok(aOk.map.ok === true && aOk.map.places === true, '两处地点达标');
  const aNo = M.CORE.assess({ version: 1, turn: { id: 't', roleName: 'r', summary: 's' }, map: M.CORE.normalizeMap({ current: { place: '青云山' }, tracks: [{ id: 't1', place: '山门' }, { id: 't2', place: '演武场' }], places: [] }) }, {});
  ok(aNo.map.ok === false && aNo.map.places === false, '无地点名录不达标');
  ok(aNo.issues.some((i) => i.code === 'map.rows'), '缺地点沿用 map.rows issue code');

  // 基线窗口：超出最近 6 处的地点只给归档摘要行，窗口内全行注入
  const manyPlaces = [];
  for (let i = 1; i <= 9; i += 1) manyPlaces.push({ id: 'p' + i, name: '地点' + i, domain: '东域', desc: '描述' + i });
  const curP = M.PROMPT.buildCurrent({ map: M.CORE.normalizeMap({ current: { place: '青云山' }, tracks: [], places: manyPlaces }) }, {});
  eq(curP.filter((r) => r.startsWith('place｜')).length, 6, '基线只注入最近 6 处地点全行');
  eq(curP.filter((r) => r.startsWith('archived｜place｜')).length, 3, '窗口外 3 处给归档摘要行');

  // 世界书召回：窗口外地点进关键词条目；封印舆图后移除
  const arh = fakeHost();
  const ar = M.createRuntime(arh.api, null, () => ({}));
  const placeState = M.CORE.blankState('a5');
  placeState.revision = 1;
  placeState.map = M.CORE.normalizeMap({ current: { place: '青云山' }, tracks: [], places: manyPlaces });
  const entries = ar.buildArchiveEntries(placeState);
  const pEntry = entries.find((e) => e.identifier === 'yz-map-places');
  ok(!!pEntry, '窗口外地点生成名录条目');
  eq(pEntry.keywords.length, 3, '关键词 = 归档地点名');
  ok(pEntry.keywords.includes('地点1') && pEntry.keywords.includes('地点3'), '关键词覆盖全部归档地点');
  ok(pEntry.content.includes('描述1') && pEntry.content.includes('描述3'), '名录条目含完整地点描述');
  ok(!entries.some((e) => e.identifier === 'yz-c-'), '纯地点状态不生成讯息条目');
  const sealedAr = M.createRuntime(arh.api, null, () => ({ map: false }));
  eq(sealedAr.buildArchiveEntries(placeState).filter((e) => e.identifier === 'yz-map-places').length, 0, '封印舆图后名录条目移除');

  // 引导：提示词含 place 行与底线
  const pMapGuide = M.PROMPT.buildPrompt('zh', {}, { forceFull: true, current: [] });
  ok(pMapGuide.includes('place｜id｜地点名｜所属域｜说明') && pMapGuide.includes('至少两处 place'), '舆图引导含地点名录');
  ok(M.PROMPT.buildPrompt('en', {}, { forceFull: true, current: [] }).includes('place｜id｜place name｜domain｜description'), 'en 引导含地点名录');
  ok(M.PROMPT.buildPrompt('zh', {}, { forceFull: false, current: [] }).includes('-place｜id｜'), '删除帮助含 place 定位行');
}

// ---------- 四·三、坊市求购区（market.requests） ----------
console.log('# 坊市求购区');
{
  // 归一：requests 过滤空 id/空名，字段收敛
  const nmk = M.CORE.normalizeMarket({ listings: [], auctions: [], orders: [], requests: [{ id: 'r1', name: '百年灵草', grade: '下品', desc: '炼丹急用', price: '8灵石', author: '炼丹师' }, { id: '', name: '无id' }, { id: 'r2', name: '' }] });
  eq(nmk.requests.length, 1, '求购过滤空 id/空名');
  eq(nmk.requests[0].author, '炼丹师', '求购人字段保留');

  // 解析：request 行与中文别名
  const pmk = M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜pmk1｜李逍遥｜求购\n</yz_meta><yz_market>\nrequest｜r1｜百年灵草｜下品｜急收｜8灵石｜炼丹师\n求购｜r2｜寒铁｜精铁｜锻剑｜5灵石｜铁匠\n</yz_market></yz_jade>');
  eq(pmk.market.requests.length, 2, 'request 行与求购别名均解析');
  eq(pmk.market.requests[1].name, '寒铁', '中文别名解析出求购');
  eq(pmk.market.listings.length, 0, '求购行不污染其它类型');

  // diff：+request 追加/更新、-request 删除（含达标门禁）
  let mkState = M.CORE.blankState('mk');
  mkState.market = M.CORE.normalizeMarket({ listings: [{ id: 'l1', name: '灵草' }], auctions: [{ id: 'a1', name: '古剑' }], orders: [{ id: 'o1', name: '符纸' }], requests: [{ id: 'r1', name: '百年灵草', price: '8灵石', author: '炼丹师' }] });
  const mk1 = M.CORE.applySnapshot(mkState, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜mk1｜李逍遥｜添求购｜diff\n</yz_meta><yz_market>\n+request｜r2｜寒铁｜精铁｜锻剑｜5灵石｜铁匠\n</yz_market></yz_jade>'), {}).state;
  eq(dflt(mk1).market.requests.length, 2, '求购区追加新求购');
  const mk2 = M.CORE.applySnapshot(mk1, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜mk2｜李逍遥｜改出价｜diff\n</yz_meta><yz_market>\n+request｜r1｜百年灵草｜下品｜急收｜9灵石｜炼丹师\n</yz_market></yz_jade>'), {}).state;
  eq(dflt(mk2).market.requests.find((r) => r.id === 'r1').price, '9灵石', '+request 按 id 整行替换');
  const mk3 = M.CORE.applySnapshot(mk2, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜mk3｜李逍遥｜撤一条｜diff\n</yz_meta><yz_market>\n-request｜r2\n</yz_market></yz_jade>'), {}).state;
  eq(dflt(mk3).market.requests.length, 1, '-request 删除指定求购');
  const mk4 = M.CORE.applySnapshot(mk3, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜mk4｜李逍遥｜撤光了｜diff\n</yz_meta><yz_market>\n-request｜r1\n</yz_market></yz_jade>'), {}).state;
  eq(dflt(mk4).market.requests.length, 1, '删空求购区被达标门禁拦截');

  // 达标：求购至少 1 条
  const mOk = M.CORE.assess({ version: 1, turn: { id: 't', roleName: 'r', summary: 's' }, market: dflt(mk3).market }, {});
  ok(mOk.market.ok === true && mOk.market.requests === true, '有求购时市场达标');
  const mNo = M.CORE.assess({ version: 1, turn: { id: 't', roleName: 'r', summary: 's' }, market: M.CORE.normalizeMarket({ listings: [{ id: 'l1', name: 'x' }], auctions: [{ id: 'a1', name: 'x' }], orders: [{ id: 'o1', name: 'x' }], requests: [] }) }, {});
  ok(mNo.market.ok === false && mNo.market.requests === false, '无求购不达标');
  ok(mNo.issues.some((i) => i.code === 'market.rows'), '缺求购沿用 market.rows issue code');

  // 基线窗口：超窗求购只给归档摘要行
  const manyRequests = [];
  for (let i = 1; i <= 8; i += 1) manyRequests.push({ id: 'r' + i, name: '求购' + i, price: i + '灵石', author: '客' + i });
  const curR = M.PROMPT.buildCurrent({ market: M.CORE.normalizeMarket({ listings: [], auctions: [], orders: [], requests: manyRequests }) }, {});
  eq(curR.filter((r) => r.startsWith('request｜')).length, 6, '基线只注入最近 6 条求购全行');
  eq(curR.filter((r) => r.startsWith('archived｜request｜')).length, 2, '窗口外 2 条给归档摘要行');

  // 引导：约束文本与行模板；删除帮助
  const pReqGuide = M.PROMPT.buildPrompt('zh', {}, { forceFull: true, current: [] });
  ok(pReqGuide.includes('request｜id｜物品名｜品阶｜描述｜出价｜求购人') && pReqGuide.includes('行情、拍卖、订单、求购四类各至少 1 条'), '坊市引导含求购底线');
  ok(M.PROMPT.buildPrompt('en', {}, { forceFull: true, current: [] }).includes('request｜id｜item name｜grade｜description｜offered price｜requester'), 'en 引导含求购行');
  ok(M.PROMPT.buildPrompt('zh', {}, { forceFull: false, current: [] }).includes('-request｜id'), '删除帮助含 request 定位行');
}

// ---------- 五、公开数据玩家身份发布：论坛 owner 维度 ----------
console.log('# 玩家发帖（forum owner 维度）');
{
  // 解析/归一：owner 字段（缺省 = 角色帖子）
  const pf = M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜p5a｜李逍遥｜发帖\n</yz_meta><yz_forum>\npost｜p1｜李逍遥｜长老｜闲聊｜今日｜论剑｜切磋｜1\npost｜p2｜悦琳｜玩家｜闲聊｜今日｜寻师｜求指点｜0｜player\n</yz_forum></yz_jade>');
  eq(pf.forum.posts[0].owner, '', '缺省 owner = 角色帖子');
  eq(pf.forum.posts[1].owner, 'player', '行尾 owner 解析');
  eq(pf.forum.posts[1].body, '求指点', 'owner 在共鸣数之后解析不吞正文');
  const nf = M.CORE.normalizeForum({ posts: [{ id: 'x', title: 't', owner: 'player' }, { id: 'y', title: 't2' }] });
  eq(nf.posts[1].owner, '', '归一化 owner 收敛');

  // 帖子未读机制：unread（第 10 字段）解析 + 旧格式启发式兼容 + 归一化钳制
  const pu = M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜p5b｜李逍遥｜发帖\n</yz_meta><yz_forum>\npost｜p1｜李逍遥｜长老｜闲聊｜今日｜论剑｜切磋｜1｜3\npost｜p2｜悦琳｜玩家｜闲聊｜今日｜寻师｜求指点｜0｜2｜player\npost｜p3｜李逍遥｜长老｜闲聊｜今日｜旧帖｜正文｜1｜player\npost｜p4｜李逍遥｜长老｜闲聊｜今日｜更旧帖｜正文｜1\n</yz_forum></yz_jade>');
  eq(pu.forum.posts[0].unread, 3, '新格式 unread 解析（角色帖）');
  eq(pu.forum.posts[1].unread, 2, '新格式 unread + owner 解析（玩家帖）');
  eq(pu.forum.posts[1].owner, 'player', 'unread 之后 owner 解析');
  eq(pu.forum.posts[2].unread, 0, '旧格式第 10 字段为 owner 时 unread=0（启发式兼容）');
  eq(pu.forum.posts[2].owner, 'player', '旧格式 owner 不被吞');
  eq(pu.forum.posts[3].unread, 0, '旧格式 9 字段帖 unread=0');
  // 玩家帖 unread 由客户端维护（syncPlayerPosts 按评论增量计算、打开详情清零）：
  // parse→normalize 不再钳 0（否则客户端维护值每次归一化被抹掉）；防模型写坏由
  // diff 门禁 + 镜像对账承担（对账以玩家域为准还原，见「运行时：…/对账」段）。
  const pu2 = M.CORE.normalizeForum(M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜p5c｜李逍遥｜发帖\n</yz_meta><yz_forum>\npost｜p1｜悦琳｜玩家｜闲聊｜今日｜寻师｜求指点｜0｜2｜player\npost｜p2｜李逍遥｜长老｜闲聊｜今日｜论剑｜切磋｜1｜3\ncomment｜p1｜李逍遥｜今日｜我来\ncomment｜p2｜林月如｜今日｜观战\n</yz_forum></yz_jade>').forum);
  eq(pu2.posts[0].unread, 2, '玩家帖 unread 保留（客户端维护，不钳 0）');
  eq(pu2.posts[1].unread, 3, '角色帖 unread 保留');
  const nu = M.CORE.normalizeForum({ posts: [{ id: 'x', title: 't', unread: -2 }, { id: 'y', title: 't2', unread: 5 }] });
  eq(nu.posts[0].unread, 0, '负 unread 钳制为 0');
  eq(nu.posts[1].unread, 5, 'unread 归一化保留');
  // buildCurrent：角色帖输出 unread 字段；玩家帖输出 unread + owner
  const cu = M.PROMPT.buildCurrent({ forum: M.CORE.normalizeForum({ posts: [{ id: 'p1', author: '甲', title: '帖一', body: 'x', unread: 4 }, { id: 'p2', owner: 'player', author: '乙', title: '帖二', body: 'x', unread: 0 }] }) }, {});
  ok(cu.some((r) => r.startsWith('post｜p1') && r.endsWith('｜4')), '角色帖基线行含 unread');
  ok(cu.some((r) => r.startsWith('post｜p2') && r.endsWith('｜0｜player')), '玩家帖基线行含 unread 与 owner');
  // diff +post 未显式带 unread 时保留原值；显式带时更新（经 runtime diff 轮验证）
  {
    const hostU = fakeHost();
    const rtU = M.createRuntime(hostU.api, null, () => ({}));
    await rtU.switchChat('chat-u');
    await rtU.applyText(jade('u2', TABLET_OK + '<yz_forum>\npost｜p1｜李逍遥｜长老｜闲聊｜今日｜论剑｜切磋｜1｜4\npost｜p2｜酒剑仙｜师尊｜闲聊｜今日｜对饮｜今夜｜2\ncomment｜p1｜林月如｜今日｜来观战\ncomment｜p2｜李逍遥｜今日｜好\n</yz_forum>'), 'chat-u', 'test');
    eq(dflt(rtU.current()).forum.posts[0].unread, 4, '帖子 unread 随协议解析入库');
    await rtU.applyText('<yz_jade><yz_meta>\nturn｜u3｜李逍遥｜回复｜diff\n</yz_meta><yz_forum>\n+post｜p1｜李逍遥｜长老｜闲聊｜今日｜论剑改｜切磋改｜1\n</yz_forum></yz_jade>', 'chat-u', 'test');
    eq(dflt(rtU.current()).forum.posts[0].unread, 4, 'diff 更新帖子内容保留 unread');
    await rtU.applyText('<yz_jade><yz_meta>\nturn｜u4｜李逍遥｜已读｜diff\n</yz_meta><yz_forum>\n+post｜p1｜李逍遥｜长老｜闲聊｜今日｜论剑改｜切磋改｜1｜0\n</yz_forum></yz_jade>', 'chat-u', 'test');
    eq(dflt(rtU.current()).forum.posts[0].unread, 0, 'diff 显式 unread=0 清零（已读处理回复）');
  }
  {
    // 空间论坛真实发言：用户评论 pmc-N 不可被模型删除/改写（diffForum 门禁）
    const hostV = fakeHost();
    const rtV = M.createRuntime(hostV.api, null, () => ({}));
    await rtV.switchChat('chat-r2');
    await rtV.applyText(jade('r1', TABLET_OK + '<yz_forum>\npost｜p1｜李逍遥｜长老｜闲聊｜今日｜论剑｜切磋｜1\npost｜p2｜酒剑仙｜师尊｜闲聊｜今日｜对饮｜今夜｜2\ncomment｜p1｜林月如｜今日｜来观战\ncomment｜p2｜李逍遥｜今日｜好\n</yz_forum>'), 'chat-r2', 'test');
    const sidV = rtV.createSpace('我').id;
    rtV.spaceSaveEntity(sidV, 'post', { title: '空间帖', body: '正文' }, '');
    const userPost = M.CORE.findSpaceState(rtV.current(), sidV).forum.posts[0];
    const cmt = rtV.sendSpaceComment(sidV, userPost.id, '算我一个');
    ok(/^pmc-\d+$/.test(cmt.id), '空间用户评论 id=pmc-N');
    await rtV.applyText('<yz_jade><yz_meta>\nturn｜r9｜李逍遥｜抹评论｜diff｜我\n</yz_meta><yz_forum>\n-comment｜' + userPost.id + '｜任意｜x｜y\n+post｜' + userPost.id + '｜甲｜乙｜闲聊｜今日｜覆盖｜覆盖｜0\n</yz_forum></yz_jade>', 'chat-r2', 'test');
    const still = M.CORE.findSpaceState(rtV.current(), sidV).forum.posts[0];
    eq(still.title, '空间帖', '模型 +post 不得覆盖用户帖');
    eq(still.comments.length, 1, '模型乱配 -comment 定位不生效');
    ok(still.comments[0].id === 'pmc-1' && still.comments[0].owner === 'player', 'pmc 评论原样保留');
  }

  // diff：模型 +post/-post 不得触碰玩家帖子，评论允许（角色帖子补足达标底线）
  let fs = M.CORE.blankState('fs');
  fs.forum = M.CORE.normalizeForum({ posts: [
    { id: 'p1', owner: 'player', author: '悦琳', title: '寻师', body: '求指点' },
    { id: 'c1', author: '李逍遥', title: '论剑', body: '切磋', comments: [{ id: 'cm1', author: '长老', time: '今日', text: '好' }] },
    { id: 'c2', author: '李逍遥', title: '论道', body: '坐而论道', comments: [{ id: 'cm2', author: '长老', time: '今日', text: '善' }] },
    { id: 'c3', author: '李逍遥', title: '论器', body: '法器交流', comments: [{ id: 'cm3', author: '长老', time: '今日', text: '妙' }] }
  ] });
  const fd1 = M.CORE.applySnapshot(fs, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜fd1｜李逍遥｜改帖｜diff\n</yz_meta><yz_forum>\n+post｜p1｜李逍遥｜长老｜闲聊｜今日｜被改｜覆盖｜0\n</yz_forum></yz_jade>'), {}).state;
  eq(dflt(fd1).forum.posts.find((p) => p.id === 'p1').title, '寻师', '模型 +post 改写玩家帖子被拒');
  const fd2 = M.CORE.applySnapshot(fd1, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜fd2｜李逍遥｜删帖｜diff\n</yz_meta><yz_forum>\n-post｜p1\n</yz_forum></yz_jade>'), {}).state;
  eq(dflt(fd2).forum.posts.length, 4, '模型 -post 删除玩家帖子被拒');
  const fd3 = M.CORE.applySnapshot(fd2, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜fd3｜李逍遥｜评论｜diff\n</yz_meta><yz_forum>\n+comment｜p1｜李逍遥｜今日｜我来指点\n</yz_forum></yz_jade>'), {}).state;
  eq(dflt(fd3).forum.posts.find((p) => p.id === 'p1').comments.length, 1, '模型可在玩家帖子下评论');

  // 达标：玩家帖子不凑数、不拉低达标（与传讯豁免同语义）
  const aOnly = M.CORE.assess({ version: 1, turn: { id: 't', roleName: 'r', summary: 's' }, forum: M.CORE.normalizeForum({ posts: [{ id: 'p1', owner: 'player', title: '寻师' }, { id: 'p2', owner: 'player', title: '寻物' }] }) }, {});
  ok(aOnly.forum.ok === false, '仅玩家帖子不满足角色论坛底线');
  const aMixed = M.CORE.assess({ version: 1, turn: { id: 't', roleName: 'r', summary: 's' }, forum: M.CORE.normalizeForum({ posts: [{ id: 'p1', owner: 'player', title: '寻师', comments: [] }, { id: 'c1', title: '论剑', comments: [{ id: 'cm1', author: 'a', time: 't', text: 'x' }] }, { id: 'c2', title: '论道', comments: [{ id: 'cm2', author: 'a', time: 't', text: 'x' }] }] }) }, {});
  ok(aMixed.forum.ok === true, '角色帖子达标 + 玩家帖子无评论仍达标');

  // 基线：玩家帖子全行注入（owner 字段 + 评论全行、不窗口化）；角色帖子正常窗口化
  const pc = M.PROMPT.buildCurrent({ forum: M.CORE.normalizeForum({ posts: [{ id: 'p1', owner: 'player', author: '悦琳', title: '寻师', body: '求指点', comments: [{ id: 'cm1', author: '李逍遥', time: '今日', text: '我来指点' }] }, { id: 'c1', author: '李逍遥', title: '帖一', body: 'x' }, { id: 'c2', author: '李逍遥', title: '帖二', body: 'x' }, { id: 'c3', author: '李逍遥', title: '帖三', body: 'x' }, { id: 'c4', author: '李逍遥', title: '帖四', body: 'x' }] }) }, {});
  const playerRow = pc.find((r) => r.startsWith('post｜p1'));
  ok(!!playerRow && playerRow.endsWith('｜player'), '玩家帖子行带 owner 字段');
  ok(pc.some((r) => r.startsWith('comment｜p1｜')), '玩家帖子的评论全行注入');
  eq(pc.filter((r) => r.startsWith('post｜')).length, 5, '帖子未超上限全量注入（玩家帖 + 角色帖）');
  ok(!pc.some((r) => r.startsWith('archived｜post｜')), '帖子级归档已由采样替代，窗口内无归档行');

  // 预算淘汰：压预算时角色明细行先丢，玩家帖子行保留（last 标记仅极端场景让位）
  const bigPosts = [];
  for (let i = 1; i <= 16; i += 1) bigPosts.push({ id: 'c' + i, author: '李逍遥', title: '长帖' + i, body: '字'.repeat(2900) });
  bigPosts.push({ id: 'p1', owner: 'player', author: '悦琳', title: '寻师', body: '求指点' });
  const pcBig = M.PROMPT.buildCurrent({ forum: M.CORE.normalizeForum({ posts: bigPosts }) }, {});
  ok(pcBig.some((r) => r.startsWith('post｜p1')), '压预算后玩家帖子仍在基线');
  ok(pcBig.filter((r) => r.startsWith('post｜c')).length <= 4, '采样后角色帖子全行注入不超过采样数');
  ok(pcBig.join('\n').length <= 9000, '采样 + 预算淘汰后注入总量仍受上限约束');

  // 保护规则提示词与引导行
  const prZh = M.PROMPT.buildPrompt('zh', {}, { forceFull: true, current: [] });
  ok(prZh.includes('owner=player 的帖子与 pmc- 评论') && prZh.includes('不得改写、删除、复制或伪造'), 'zh 用户真实发言保护规则');
  ok(M.PROMPT.buildPrompt('en', {}, { forceFull: true, current: [] }).includes('rows owned by the user are real statements'), 'en 用户真实发言保护规则');
  ok(prZh.includes('post｜id｜作者｜身份｜版块｜时间｜标题｜正文｜共鸣数｜unread（新回复数，无则 0）｜owner（玩家帖子填 player，其余省略）'), '引导行含 unread 与 owner 字段');
}

{
  // 条目级注入采样：阈值内全量；超阈值后强制集 + 活跃度加权随机；隐藏条目完全不出现
  const msgs = (n, who) => Array.from({ length: n }, (_, j) => ({ id: who + '-' + j, side: 'other', time: 'x', text: '话' + j }));
  const mkState = () => {
    const st = M.CORE.blankState('smp');
    st.chats = {
      contacts: [
        { id: 'c1', name: '热闹甲', messages: msgs(18, 'a') },
        { id: 'c2', name: '热闹乙', messages: msgs(16, 'b') },
        { id: 'c3', name: '冷清丙', messages: msgs(1, 'c') },
        { id: 'c4', name: '新增丁', messages: [] },
        { id: 'c5', name: '普通戊', messages: msgs(5, 'e') }
      ],
      groups: [
        { id: 'g1', name: '活跃群', messages: msgs(12, 'x').map((m) => Object.assign({ sender: '人' }, m)) },
        { id: 'g2', name: '冷群', messages: [{ id: 'y1', sender: '人', side: 'other', text: 'hi' }] },
        { id: 'g3', name: '新群', messages: [] }
      ]
    };
    st.forum = {
      posts: [
        { id: 'p1', author: '甲', title: '热帖', body: 'x', comments: msgs(10, 'c').map((m) => ({ author: '路人', time: 'x', text: m.text })) },
        { id: 'p2', author: '乙', title: '帖二', body: 'x', comments: [{ author: '路人', time: 'x', text: 'hi' }] },
        { id: 'p3', author: '丙', title: '帖三', body: 'x', comments: [] },
        { id: 'p4', author: '丁', title: '帖四', body: 'x', comments: [] },
        { id: 'p5', author: '戊', title: '帖五', body: 'x', comments: [] },
        { id: 'p6', author: '己', title: '帖六', body: 'x', comments: [] }
      ]
    };
    return st;
  };
  const st = mkState();
  const cur1 = M.PROMPT.buildCurrent(st, {}, () => 0.42);
  const cur2 = M.PROMPT.buildCurrent(st, {}, () => 0.42);
  eq(cur1.join('\n'), cur2.join('\n'), '同一 state + 固定 rng 输出稳定');
  eq(cur1.filter((r) => r.startsWith('contact｜')).length, 3, '联系人超上限注入 3 条');
  eq(cur1.filter((r) => r.startsWith('group｜')).length, 2, '群聊超上限注入 2 条');
  eq(cur1.filter((r) => r.startsWith('post｜')).length, 5, '帖子超上限注入 5 条');

  // 阈值边界：恰好等于上限时全量注入，且不受 rng 影响
  const stN = mkState();
  stN.chats.contacts = stN.chats.contacts.slice(0, 3);
  stN.chats.groups = stN.chats.groups.slice(0, 2);
  stN.forum.posts = stN.forum.posts.slice(0, 5);
  eq(M.PROMPT.buildCurrent(stN, {}, () => 0.42).join('\n'), M.PROMPT.buildCurrent(stN, {}, () => 0.99).join('\n'), '未超上限时不受 rng 影响');
  eq(M.PROMPT.buildCurrent(stN, {}, () => 0.42).filter((r) => r.startsWith('contact｜')).length, 3, '恰好等于上限时全量注入');

  // 活跃度加权：多次采样下活跃条目选中率显著更高；冷门/新增条目保留非零概率
  const picks = { c1: 0, c2: 0, c3: 0, c4: 0, c5: 0 };
  let seqI = 0;
  const seq = () => { const v = (seqI % 11) / 10; seqI += 1; return v; };
  for (let n = 0; n < 300; n += 1) {
    M.PROMPT.buildCurrent(st, {}, seq).forEach((r) => {
      const m = /^contact｜(c\d)｜/.exec(r);
      if (m) picks[m[1]] += 1;
    });
  }
  ok(picks.c1 > picks.c3 && picks.c2 > picks.c3 && picks.c1 > picks.c4, '活跃联系人选中率显著高于冷门条目');
  ok(picks.c3 > 0 && picks.c4 > 0, '冷门/新增条目保留非零概率');

  // 强制集：用户交互过的条目必定注入（不参与概率）
  st.chats.contacts.push({ id: 'c-1', name: '自建', unread: 2, preview: '', messages: [{ id: 'pm-1', side: 'self', time: 'x', text: '在吗' }] });
  st.chats.contacts[0].unread = 3;
  st.chats.groups[0].messages.push({ id: 'pmg-1', sender: '道友', side: 'other', time: 'x', text: '我在' });
  st.chats.groups[1].unread = 4;
  st.forum.posts.push({ id: 'pm1', owner: 'player', author: '悦琳', title: '我的帖', body: 'x' });
  st.forum.posts[0].comments.push({ id: 'pmc-1', owner: 'player', author: '道友', time: 'x', text: '我的评论' });
  st.forum.posts[5].unread = 7;
  const cur3 = M.PROMPT.buildCurrent(st, {}, () => 0.42);
  const j3 = cur3.join('\n');
  ok(j3.includes('contact｜c-1｜'), '用户创建联系人（c- 前缀）必定注入');
  ok(j3.includes('contact｜c1｜'), '未读联系人必定注入');
  ok(j3.includes('group｜g1｜'), '含玩家发言的群聊必定注入');
  ok(j3.includes('group｜g2｜'), '有未读消息的群聊必定注入');
  ok(j3.includes('post｜pm1｜'), '玩家帖子必定注入');
  ok(j3.includes('post｜p1｜'), '含玩家评论的帖子必定注入');
  ok(j3.includes('post｜p6｜'), '有未读新回复的帖子必定注入');
  eq(cur3.filter((r) => r.startsWith('contact｜')).length, 3, '强制集 + 随机补齐仍受注入上限约束');
  eq(cur3.filter((r) => r.startsWith('post｜')).length, 5, '帖子强制集 + 随机补齐到上限');

  // 隐藏条目完全不出现（无 archived 行、无任何提示）
  ok(!j3.includes('archived｜contact') && !j3.includes('archived｜group') && !j3.includes('archived｜post'), '隐藏条目无任何提示行');
}

// ---------- 评审加固：恶意数据渲染契约（XSS 守卫） ----------
console.log('# 评审加固 · 恶意数据渲染契约');
// 全分区达标基线（与 P2 diff 测试的 BASE_FULL 同构）：full 轮只有全部启封分区达标才落盘。
const GUARD_FULL = '<yz_tablet>\nfield｜基本｜名字｜李逍遥\nfield｜基本｜性别｜男\nfield｜基本｜身高｜175cm\nfield｜基本｜体重｜60kg\nfield｜仪容｜外貌｜眉目清朗\nfield｜仪容｜穿着｜青色道袍\nfield｜修为｜灵根｜天灵根\nfield｜修为｜体质｜凡体\nfield｜修为｜境界｜炼气三层\nfield｜修为｜状态｜良好\nfield｜功法｜功法名｜青云剑诀\nfield｜羁绊｜道侣｜林月如\nfield｜隐秘｜身世｜青云宗弃徒\n</yz_tablet>' +
  '<yz_msg>\ncontact｜c1｜林月如｜道侣｜今日｜0｜安好\ncontact｜c2｜酒剑仙｜师尊｜今日｜2｜饮酒\nmsg｜c1｜m1｜other｜昨日｜勿念\nmsg｜c1｜m2｜self｜今日｜定当赴约\nmsg｜c2｜m3｜other｜今日｜来喝酒\nmsg｜c2｜m4｜other｜今日｜速来\ngroup｜g1｜青云内门｜30｜今日｜5｜集合\ngmsg｜g1｜gm1｜掌门｜other｜今日｜卯时议事\ngmsg｜g1｜gm2｜长老｜other｜今日｜不得迟到\n</yz_msg>' +
  '<yz_notes>\nfolder｜f1｜杂记｜2\nfolder｜f2｜秘录｜1\nnote｜n1｜f1｜今日｜false｜约定｜卯时山门\nnote｜n2｜f2｜今日｜true｜心法｜不可外传\nnote｜n3｜f1｜昨日｜false｜见闻｜坊市有新品灵草\n</yz_notes>' +
  '<yz_forum>\npost｜p1｜掌门｜长老｜公告｜今日｜议事｜卯时集合｜3\ncomment｜p1｜长老｜今日｜已知\npost｜p2｜长老｜长老｜闲聊｜昨日｜论剑｜切磋记录｜1\ncomment｜p2｜弟子｜昨日｜围观\n</yz_forum>' +
  '<yz_market>\nlisting｜l1｜灵草｜下品｜百年份｜10灵石｜坊主\nauction｜a1｜古剑｜上品｜锈蚀｜100｜150｜1时辰｜3\norder｜o1｜符纸｜已成交｜5灵石｜今日｜买\nrequest｜r1｜百年灵草｜下品｜急收炼丹｜8灵石｜炼丹师\n</yz_market>' +
  '<yz_space>\ncurrency｜灵石｜120\nitem｜i1｜养神丹｜2｜中品｜宁神益气\nitem｜i2｜驱邪符｜5｜下品｜辟邪护身\n</yz_space>' +
  '<yz_map>\ncurrent｜青云山｜东域｜山门所在\ntrack｜t1｜昨日｜山门｜入门\ntrack｜t2｜今日｜演武场｜晨练\nplace｜p1｜青云山｜东域｜山门所在，灵气充沛\nplace｜p2｜演武场｜东域｜弟子晨练之地\n</yz_map>';
{
  // 第五轮淘汰：标识行（联系人/订单）合计可撑爆预算，截断到短上限后仍不超限
  const wide = M.CORE.blankState('x2');
  const contact = (i) => ({ id: 'c' + i, name: '联系人' + i, messages: [{ id: 'm' + i, side: 'other', text: '字'.repeat(2900) }] });
  wide.chats = { contacts: Array.from({ length: 4 }, (_, i) => contact(i + 1)), groups: [] };
  const rows = M.PROMPT.buildCurrent(wide, {}, () => 0);
  const total = rows.join('').length;
  ok(total <= 9000, '标识行截断后基线不超硬上限（实际 ' + total + '）');
  ok(rows.some((r) => r.includes('contact｜c1｜联系人1')), '截断保留行首 id/name 供 diff 定位');
}
{
  // 评审加固：数值字段负值钳制 + 货币重命名撞种类拒绝 + 校验失败不污染状态
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-neg');
  const neg = M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜n1｜李逍遥｜负值｜full\n</yz_meta><yz_msg>\ncontact｜c1｜道友｜好友｜今日｜-5｜预览\nmsg｜c1｜m1｜other｜今日｜在吗\nmsg｜c1｜m2｜self｜今日｜在\n</yz_msg><yz_forum>\npost｜p1｜掌门｜长老｜公告｜今日｜议事｜正文｜-3\ncomment｜p1｜长老｜今日｜已知\n</yz_forum></yz_jade>');
  eq(neg.chats.contacts[0].unread, 0, '负未读钳制为 0');
  eq(neg.forum.posts[0].resonance, 0, '负共鸣钳制为 0');
  const dsp = M.CORE.DEFAULT_SPACE_ID;
  rt.spaceSaveEntity(dsp, 'currency', { kind: '灵石', amount: '10' }, '');
  const failKind = rt.spaceSaveEntity(dsp, 'currency', { kind: '灵石', amount: '20' }, '妖丹');
  ok(failKind && failKind.ok === false, '货币重命名撞已有种类被拒绝');
  eq(dflt(rt.current()).space.currencies.filter((c) => c.kind === '灵石').length, 1, '撞种类后无重复行');
  rt.spaceSaveEntity(dsp, 'folder', { name: '玉册夹' }, '');
  const failFolder = rt.spaceSaveEntity(dsp, 'folder', { name: '' }, 'pf-1');
  ok(failFolder && failFolder.ok === false, '文件夹改名空名被拒绝');
  ok(dflt(rt.current()).notes.folders.some((f) => f.name === '玉册夹'), '失败路径不产生空名文件夹（无级联删除）');
}
{
  // 评审加固：diffChats 对用户线程（c- 前缀）的真实事件防护（可回复、不可删/伪造/改写）
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-guard');
  await rt.applyText(jade('g0', GUARD_FULL), 'chat-guard', 'test');
  const sidG = rt.createSpace('我').id;
  rt.spaceSaveEntity(sidG, 'contact', { name: '云外君' }, '');
  const thG = M.CORE.findSpaceState(rt.current(), sidG).chats.contacts[0];
  rt.sendSpaceMessage(sidG, thG.id, '在吗');
  await rt.applyText('<yz_jade><yz_meta>\nturn｜g2｜李逍遥｜篡改｜diff｜我\n</yz_meta><yz_msg>\n+msg｜' + thG.id + '｜r1｜self｜丙午年五月十二 午时｜在的\n+msg｜' + thG.id + '｜pm-2｜other｜今日｜伪造\n-msg｜' + thG.id + '｜pm-1\n+msg｜' + thG.id + '｜pm-1｜self｜今日｜改写\n+msg｜' + thG.id + '｜r2｜other｜今日｜NPC插话\n</yz_msg></yz_jade>', 'chat-guard', 'test');
  const gc = M.CORE.findSpaceState(rt.current(), sidG).chats.contacts[0];
  ok(gc.messages.some((m) => m.id === 'r1'), '模型可追加自己的回复（新 id）');
  ok(gc.messages.some((m) => m.id === 'r2'), '模型可补 other 侧第三方插话');
  ok(!gc.messages.some((m) => m.id === 'pm-2'), '伪造 pm-N 玩家消息被拒');
  ok(gc.messages.some((m) => m.id === 'pm-1' && m.text === '在吗'), '玩家消息不可被删/改写');
}

{
  // 评审加固：parse 空判定含求购/地点；满配状态超过快照容量红线
  const onlyRequest = M.PROTOCOL.parse('<yz_jade>\n<yz_market>\nrequest｜r1｜百年灵草｜下品｜急收｜8灵石｜炼丹师\n</yz_market>\n</yz_jade>');
  ok(!!onlyRequest && onlyRequest.market.requests.length === 1, '只有求购行的块不被误判为空');
  const onlyPlace = M.PROTOCOL.parse('<yz_jade>\n<yz_map>\nplace｜p1｜青云山｜东域｜山门所在\n</yz_map>\n</yz_jade>');
  ok(!!onlyPlace && onlyPlace.map.places.length === 1, '只有地点行的块不被误判为空');
  const big = M.CORE.blankState('big');
  // 满配消息堆积（10 联系人 × 20 条 × 3000 字）≈ 600KB，超过 200KB 快照红线。
  const heavyMsgs = Array.from({ length: 20 }, (_, i) => ({ id: 'm' + i, side: 'other', time: '今日', text: '字'.repeat(3000) }));
  big.chats = { contacts: Array.from({ length: 10 }, (_, i) => ({ id: 'c' + i, name: '友' + i, messages: heavyMsgs })), groups: [] };
  const bigState = M.CORE.normalizeState(JSON.parse(JSON.stringify(big)), 'big');
  ok(JSON.stringify(bigState).length > 200000, '满配状态确实超过快照容量红线');
}
{
  // 空间线程保尾 20 条 + 未读生命周期：发送清尾、模型回复计未读、打开清零
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-20');
  const sid20 = rt.createSpace('我').id;
  rt.spaceSaveEntity(sid20, 'contact', { name: '长谈' }, '');
  const th20 = () => M.CORE.findSpaceState(rt.current(), sid20).chats.contacts[0];
  for (let i = 1; i <= 18; i += 1) rt.sendSpaceMessage(sid20, th20().id, '消息' + i);
  eq(th20().messages.length, 18, '18 条全留');
  ok(th20().unread === 0, '自己发言后无未读');
  rt.sendSpaceMessage(sid20, th20().id, '消息19');
  rt.sendSpaceMessage(sid20, th20().id, '消息20');
  eq(th20().messages.length, 20, '20 条边界不丢');
  rt.sendSpaceMessage(sid20, th20().id, '消息21');
  rt.sendSpaceMessage(sid20, th20().id, '消息22');
  eq(th20().messages.length, 20, '超 20 条保尾截断');
  eq(th20().archived, true, '截断留痕 archived');
  ok(new Set(th20().messages.map((m) => m.id)).size === 20, '线程消息 id 无重复');
  await rt.applyText('<yz_jade><yz_meta>\nturn｜q1｜李逍遥｜回复｜diff｜我\n</yz_meta><yz_msg>\n+msg｜' + th20().id + '｜ra1｜self｜今日｜第一解\n+msg｜' + th20().id + '｜ra2｜self｜今日｜第二解\n</yz_msg></yz_jade>', 'chat-20', 'test');
  eq(th20().unread, 2, '尾随两条回复计未读 2');
  rt.markSpaceThreadSeen(sid20, th20().id);
  eq(th20().unread, 0, '打开线程已读清零');
  const ids0 = th20().messages.map((m) => m.id).join(',');
  rt.markSpaceThreadSeen(sid20, th20().id);
  eq(th20().messages.map((m) => m.id).join(','), ids0, '重复已读幂等');
}

{
  // 评审加固：镜像/世界书 tie-break——revision 平局时取更新时间更新的镜像，
  // 陈旧世界书快照不得覆盖新镜像（rev-0 聊天 + 切走后 save 只落镜像的场景）
  const host = fakeHost();
  host.current.chat = 'chat-tie';
  const store = new Map();
  const local = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  const staleWorld = M.CORE.normalizeState(null, 'chat-tie');
  dflt(staleWorld).revision = 5;
  dflt(staleWorld).sync = { status: 'complete', roleName: '李逍遥', summary: '旧', applied: [], appliedSeen: [], issues: [], updatedAt: 100 };
  host.seedBook('玉兆档案·chat-tie', [{ identifier: 'yz-snap-1', name: '玉兆快照', enabled: false, content: JSON.stringify({ v: 2, ver: M.PLUGIN_VERSION, rev: 5, updatedAt: 100, kind: 'role', index: 1, total: 1, body: JSON.stringify(staleWorld) }) }]);
  const freshMirror = JSON.parse(JSON.stringify(staleWorld));
  dflt(freshMirror).sync.summary = '新';
  dflt(freshMirror).sync.updatedAt = 200;
  store.set('yz-jade-v1:chat-tie', JSON.stringify(freshMirror));
  const rt = M.createRuntime(host.api, local, () => ({}));
  await rt.switchChat('chat-tie');
  eq(dflt(rt.current()).sync.summary, '新', 'revision 平局时更新的镜像胜出');
  eq(dflt(rt.current()).sync.updatedAt, 200, '镜像数据未被陈旧世界书覆盖');
  await flushWorld();
  const healed = host.lorebooks().find((b) => b.name === '玉兆档案·chat-tie');
  const healedWrap = JSON.parse(healed.entries.find((e) => e.identifier === 'yz-snap-1').content);
  eq(JSON.parse(healedWrap.body).spaces[0].sync.summary, '新', '世界书被镜像数据治愈（回写）');
}

{
  // 多空间基线注入：sendToAI 空间分组容器、space 属性、开关裁剪、采样上限均摊
  const twoSpaces = M.CORE.normalizeState({ spaces: [
    { id: 'sp0', isDefault: true, sync: { roleName: '云十三' }, chats: { contacts: [{ id: 'k1', name: '角色线人', messages: [{ id: 'm1', side: 'self', time: 't', text: '角色话' }, { id: 'm2', side: 'self', time: 't', text: '角色话2' }], unread: 0, preview: '', seen: 0 }], groups: [] } },
    { id: 'sp1', name: '我', chats: { contacts: [{ id: 'c-1', name: '自建联系人', messages: [{ id: 'pm-1', side: 'self', time: 't', text: '用户话' }], unread: 0, preview: '', seen: 0 }], groups: [] } },
    { id: 'sp2', name: '只本地', sendToAI: false, chats: { contacts: [{ id: 'x1', name: '隐形条目', messages: [{ id: 'm1', side: 'self', time: 't', text: '不该出现' }, { id: 'm2', side: 'self', time: 't', text: '也不该' }], unread: 0, preview: '', seen: 0 }], groups: [] } }
  ] }, 'ms');
  const rows = M.PROMPT.buildCurrent(twoSpaces, {});
  const flat = rows.join('\n');
  ok(flat.includes('<yzc_msg>'), '默认空间容器无 space 属性');
  ok(flat.includes('<yzc_msg space="' + M.CORE.encodeSpaceRoute('我') + '">'), '自定义空间容器带可逆 space token');
  ok(flat.includes('角色线人') && flat.includes('自建联系人'), '两个发送空间的数据都进基线');
  ok(!flat.includes('隐形条目') && !flat.includes('不该出现'), 'sendToAI=false 的空间完全不注入');
  eq(rows.filter((r) => r === '<yzc_msg>').length, 1, '默认空间容器仅一个开标签');
  eq(rows.filter((r) => r === '</yzc_msg>').length, 2, '两组容器共用闭合标签（多空间各成一组）');
  // 三空间均摊：contact 采样上限随发送空间数下降（3→1/空间）
  const many = { spaces: [] };
  for (let s = 0; s < 3; s += 1) {
    const contacts = [];
    for (let i = 0; i < 5; i += 1) contacts.push({ id: 'k' + s + i, name: '人' + s + i, unread: 0, preview: '', seen: 0, messages: [{ id: 'a', side: 'other', time: 't', text: 'x' + s + i + '1' }, { id: 'b', side: 'other', time: 't', text: 'x' + s + i + '2' }] });
    many.spaces.push({ id: 'sp' + (s + 1), name: 'S' + s, chats: { contacts, groups: [] } });
  }
  const manyState = M.CORE.normalizeState(many, 'mm');
  const manyRows = M.PROMPT.buildCurrent(manyState, {}, () => 0.5).filter((r) => r.startsWith('contact｜'));
  ok(manyRows.length <= 3, '注入上限按空间数均摊（' + manyRows.length + ' 行 ≤ 3）');

  // 提示词空间协议：路由规则、可写空间清单、turn 行第 6 字段
  const pZh = M.PROMPT.buildPrompt('zh', {}, { forceFull: false, current: [], spaces: [
    { name: '云十三', isDefault: true, sendToAI: true, allowAIWrite: true },
    { name: '我', isDefault: false, sendToAI: true, allowAIWrite: true },
    { name: '手账', isDefault: false, sendToAI: true, allowAIWrite: false }
  ] });
  ok(pZh.includes('用户空间：法器内并存多个互相隔离的数据空间'), 'zh 含空间协议说明');
  ok(pZh.includes('「我」[送入基线 + 允许 AI 写入') && pZh.includes('「手账」[送入基线 + 拒收 AI 写入'), 'zh 分别列明空间发送/写入权限');
  ok(pZh.includes('第 6 个字段填写对应路由 token'), 'zh turn 行空间字段说明');
  ok(pZh.includes('非默认空间只接受 diff 轮'), 'zh 用户空间 diff-only 约束');
  const pEn = M.PROMPT.buildPrompt('en', {}, { forceFull: false, current: [], spaces: [{ name: 'Me', isDefault: false, sendToAI: true, allowAIWrite: true }] });
  ok(pEn.includes('User spaces:') && pEn.includes('ANOTHER complete <yz_jade> block'), 'en 含空间协议说明');
  ok(pEn.includes('baseline sent') && pEn.includes('AI writes allowed'), 'en 分别列明空间发送/写入权限');
  const pNoSpace = M.PROMPT.buildPrompt('zh', {}, { forceFull: false, current: [], spaces: [{ name: '云十三', isDefault: true, sendToAI: true, allowAIWrite: true }] });
  ok(pNoSpace.includes('（无）'), '仅默认空间时清单为空');
  ok(!/yz-player|传讯通道/.test(pZh), '旧双域通道规则已消失');

  // 用户帖未读：模型 +comment 计数、打开详情 seen 对齐清零
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-pu');
  await rt.applyText(jade('w0', TABLET_OK + MSG_MIN), 'chat-pu', 'test');
  const sid = rt.createSpace('我').id;
  rt.spaceSaveEntity(sid, 'post', { title: '问帖', body: 'b' }, '');
  const post = () => M.CORE.findSpaceState(rt.current(), sid).forum.posts[0];
  eq(post().unread, 0, '新帖无未读');
  await rt.applyText('<yz_jade><yz_meta>\nturn｜w1｜李逍遥｜答疑｜diff｜我\n</yz_meta><yz_forum>\n+comment｜' + post().id + '｜李逍遥｜今日｜答一\n</yz_forum></yz_jade>', 'chat-pu', 'test');
  eq(post().unread, 1, '模型评论计未读');
  rt.markSpacePostSeen(sid, post().id);
  eq(post().unread, 0, '打开详情清零');
  await rt.applyText('<yz_jade><yz_meta>\nturn｜w2｜李逍遥｜再答｜diff｜我\n</yz_meta><yz_forum>\n+comment｜' + post().id + '｜李逍遥｜今日｜答二\n</yz_forum></yz_jade>', 'chat-pu', 'test');
  eq(post().unread, 1, '新评论再计未读（seen 不反弹）');

  // 导入当前 v3 存档：完整 spaces 结构 + 空间数据整体替换
  const ih = fakeHost();
  const irt = M.createRuntime(ih.api, null, () => ({}));
  await irt.switchChat('imp2');
  const v3Save = M.CORE.normalizeState({ schemaVersion: 2, spaces: [{ id: 'sp0', isDefault: true, revision: 9, tablet: { name: '导入者' } }, { id: 'sp7', name: '导入空间', notes: { folders: [], notes: [] } }], migratedPlayer: true }, 'imp2');
  const importCandidate = irt.importState(JSON.stringify(v3Save));
  ok(importCandidate.ok && dflt(irt.current()).revision === 0, '当前 v3 存档先解析为候选');
  const importCommit = irt.commitImport(importCandidate.state);
  await importCommit.saved;
  eq(dflt(irt.current()).revision, 9, '确认提交后导入 revision 生效');
  eq(irt.current().spaces.length, 2, '导入恢复两个空间');
  eq(irt.current().migratedPlayer, true, '导入保留迁移标记');
  eq(irt.importState(JSON.stringify({ spaces: [{ id: 'sp0' }] })).reason, 'parse', '缺少 schemaVersion/isDefault 的 JSON 拒收');
}

// ---------- P1 · v3 数据安全与持久化回归 ----------
console.log('# P1 · v3 数据安全与持久化回归');
{
  const state = M.CORE.normalizeState(null, 'p1-full');
  const base = M.CORE.defaultSpaceState(state);
  base.chats = M.CORE.normalizeChats({
    contacts: [
      { id: 'c-1', name: '我的联系人', messages: [{ id: 'pm-1', side: 'self', text: '用户消息' }] },
      { id: 'c1', name: '角色联系人', messages: [{ id: 'pm-2', side: 'self', text: '不能丢' }] }
    ],
    groups: [{ id: 'g1', name: '群', messages: [{ id: 'pmg-1', side: 'self', text: '群发言' }] }]
  });
  base.forum = M.CORE.normalizeForum({ posts: [
    { id: 'fp-1', owner: 'player', title: '我的帖子', body: '正文', comments: [] },
    { id: 'rp-1', title: '旧角色帖', body: '正文', comments: [{ id: 'pmc-1', owner: 'player', text: '我的评论' }] }
  ] });
  const full = M.CORE.applySnapshot(state, {
    version: 1,
    turn: { id: 'p1-full', roleName: '角色', summary: 'full' },
    chats: MSG_OBJ,
    forum: { posts: [
      { id: 'p1', author: '角色', title: '新帖', body: '正文', comments: [{ id: 'cm-1', text: '回复' }] },
      { id: 'p2', author: '角色', title: '新帖2', body: '正文', comments: [{ id: 'cm-2', text: '回复' }] },
      { id: 'fp-1', owner: '', author: '角色', title: '试图覆盖用户帖', body: '不应覆盖', comments: [] },
      { id: 'evil', owner: 'player', title: '伪造用户帖', body: '不应出现', comments: [] }
    ] }
  }, {});
  const protectedSpace = M.CORE.defaultSpaceState(full.state);
  ok(protectedSpace.chats.contacts.some((c) => c.id === 'c-1'), 'full 不删除用户联系人');
  ok(protectedSpace.chats.contacts.some((c) => c.id === 'c1' && c.messages.some((m) => m.id === 'pm-2')), 'full 保留私讯用户消息');
  ok(protectedSpace.chats.groups[0].messages.some((m) => m.id === 'pmg-1'), 'full 保留群聊用户消息');
  ok(protectedSpace.forum.posts.some((p) => p.id === 'fp-1') && protectedSpace.forum.posts.some((p) => p.id === 'rp-1' && p.comments.some((c) => c.id === 'pmc-1')), 'full 保留用户帖子与评论');
  ok(protectedSpace.forum.posts.find((p) => p.id === 'fp-1').owner === 'player' && !protectedSpace.forum.posts.some((p) => p.id === 'evil'), 'full 拒绝覆盖或新增 owner=player 帖子');

  const forged = M.CORE.applySnapshot(M.CORE.normalizeState(null, 'p1-forge'), {
    turn: { id: 'p1-forge', mode: 'diff' },
    diff: { forum: [{ type: 'post', add: true, values: ['evil', 'a', 'b', 'c', 't', '标题', '正文', '0', 'player'] }] }
  }, {});
  ok(!M.CORE.defaultSpaceState(forged.state).forum.posts.some((p) => p.id === 'evil'), 'diff 拒绝伪造 owner=player 帖子');
}
{
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('p1-clear');
  host.setHistory([{ id: 'old-clear', role: 'assistant', content: jade('old-clear', TABLET_OK) }]);
  await rt.applyText(jade('before-clear', TABLET_OK), 'p1-clear', 'test');
  await rt.saveChat('p1-clear');
  await rt.syncArchive('p1-clear');
  rt.current().spaces = [M.CORE.blankUserSpace('p1-clear', { id: 'sp0', isDefault: true })];
  rt.current().activeSpaceId = 'sp0';
  await rt.saveChat('p1-clear', { forceSnapshot: true });
  await rt.markHistoryCutoff('p1-clear');
  const restored = M.createRuntime(host.api, null, () => ({}));
  await restored.switchChat('p1-clear');
  eq(dflt(restored.current()).revision, 0, '强制空快照阻止清除数据复活');
  eq(host.lorebooks().find((b) => b.name === '玉兆档案·p1-clear').entries.filter((e) => /^yz-snap-/.test(e.identifier)).length, 1, '清除后世界书保留空快照墓碑');
}
{
  const corruptHost = fakeHost();
  corruptHost.seedBook('玉兆档案·p1-corrupt', [{ identifier: 'yz-snap-1', content: '{bad', enabled: false }]);
  const notices = [];
  const corruptRt = M.createRuntime(corruptHost.api, null, () => ({}), { notice: (reason) => notices.push(reason) });
  await corruptRt.switchChat('p1-corrupt');
  ok(notices.includes('snapshotCorrupted'), '损坏世界书快照发出明确诊断');
  eq(dflt(corruptRt.current()).revision, 0, '损坏快照不静默恢复成旧数据');
}
{
  const shared = new Map();
  const local = { getItem: (key) => shared.has(key) ? shared.get(key) : null, setItem: (key, value) => shared.set(key, String(value)) };
  const host = fakeHost();
  const first = M.createRuntime(host.api, local, () => ({}));
  const second = M.createRuntime(host.api, local, () => ({}));
  await first.switchChat('p1-conflict');
  await second.switchChat('p1-conflict');
  const firstSpace = first.createSpace('甲');
  await firstSpace.saved;
  const secondSpace = second.createSpace('乙');
  const secondSaved = await secondSpace.saved;
  ok(secondSaved && secondSaved.ok === false && secondSaved.reason === 'conflict', '跨 tab 旧状态拒绝覆盖新状态');
  ok(!JSON.parse(shared.get(first.LOCAL_PREFIX + 'p1-conflict')).spaces.some((sp) => sp.name === '乙'), '冲突写入未静默覆盖本地数据');
  const retrySpace = second.createSpace('丙');
  const retrySaved = await retrySpace.saved;
  ok(retrySaved && retrySaved.ok === false && retrySaved.reason === 'conflict', 'CAS 冲突后的立即重试仍被拒绝');
  const remoteAfterRetry = JSON.parse(shared.get(first.LOCAL_PREFIX + 'p1-conflict'));
  ok(!remoteAfterRetry.spaces.some((sp) => sp.name === '乙' || sp.name === '丙'), 'CAS 冲突重试不得覆盖远端状态');
}
{
  const failHost = fakeHost();
  const failLocal = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  const notices = [];
  const failRt = M.createRuntime(failHost.api, failLocal, () => ({}), { notice: (reason) => notices.push(reason) });
  await failRt.switchChat('p1-local-fail');
  const created = failRt.createSpace('世界书仍应保存');
  const result = await created.saved;
  ok(result && result.ok === false && result.localOk === false && result.worldOk === true, '本地缓存失败返回降级持久化结果');
  ok(notices.includes('persistenceFailed') && failHost.lorebooks().length === 1, '本地写入失败仍尝试世界书并提示');
}
{
  const largeHost = fakeHost();
  const largeRt = M.createRuntime(largeHost.api, null, () => ({}));
  await largeRt.switchChat('p1-large');
  const largeSpace = M.CORE.defaultSpaceState(largeRt.current());
  const long = '字'.repeat(3000);
  largeSpace.chats = M.CORE.normalizeChats({
    contacts: Array.from({ length: 6 }, (_, i) => ({ id: 'c' + i, name: '联系人' + i, messages: Array.from({ length: 20 }, (_, j) => ({ id: 'm' + i + '-' + j, side: 'other', time: 't', text: long })) })),
    groups: Array.from({ length: 6 }, (_, i) => ({ id: 'g' + i, name: '群' + i, messages: Array.from({ length: 24 }, (_, j) => ({ id: 'gm' + i + '-' + j, sender: '人', side: 'other', time: 't', text: long })) }))
  });
  largeSpace.revision = 1;
  largeSpace.updatedAt = Date.now();
  largeRt.current().updatedAt = Date.now();
  const oldSnapshot = largeRt.buildSnapshotEntries(M.CORE.normalizeState(null, 'p1-large'), { force: true });
  largeHost.seedBook('玉兆档案·p1-large', oldSnapshot);
  const tooLarge = await largeRt.syncArchive('p1-large');
  ok(tooLarge && tooLarge.ok === false && tooLarge.reason === 'snapshot-too-large', '超分片快照返回失败而非空替换');
  ok(largeHost.lorebooks()[0].entries.length === oldSnapshot.length, '超分片失败保留旧恢复点');
}
{
  const worldHost = fakeHost();
  const worldApi = Object.assign({}, worldHost.api, { lorebook: Object.assign({}, worldHost.api.lorebook, { update: async () => { throw new Error('write denied'); } }) });
  const worldRt = M.createRuntime(worldApi, null, () => ({}));
  await worldRt.switchChat('p1-world-fail');
  const created = worldRt.createSpace('无法落盘');
  const result = await created.saved;
  ok(result && result.ok === false && result.worldOk === false, '世界书写入失败返回明确失败');
}
{
  const queueHost = fakeHost();
  const originalUpdate = queueHost.api.lorebook.update;
  let releaseUpdate;
  let updateStarted;
  const updateReady = new Promise((resolve) => { updateStarted = resolve; });
  const updateGate = new Promise((resolve) => { releaseUpdate = resolve; });
  const queueApi = Object.assign({}, queueHost.api, { lorebook: Object.assign({}, queueHost.api.lorebook, {
    update: async (book) => { updateStarted(); await updateGate; return originalUpdate(book); }
  }) });
  const queueRt = M.createRuntime(queueApi, null, () => ({}));
  await queueRt.switchChat('p1-queue');
  const queued = queueRt.createSpace('排队空间');
  await updateReady;
  let switched = false;
  const switching = queueRt.switchChat('p1-queue-other').then(() => { switched = true; });
  await Promise.resolve();
  ok(switched === false, '切聊天等待世界书提交完成');
  releaseUpdate();
  await queued.saved;
  await switching;
}
{
  const rollbackHost = fakeHost();
  const rollbackApi = Object.assign({}, rollbackHost.api, { lorebook: Object.assign({}, rollbackHost.api.lorebook, { update: async () => { throw new Error('rollback'); } }) });
  const rollbackRt = M.createRuntime(rollbackApi, null, () => ({}));
  await rollbackRt.switchChat('p1-rollback');
  const operation = rollbackRt.spaceSaveEntity('sp0', 'contact', { name: '不应留下', relation: '' }, '');
  const persisted = await operation.saved;
  ok(persisted && persisted.ok === false && persisted.worldOk === false, '持久化失败返回失败结果');
  ok(!M.CORE.defaultSpaceState(rollbackRt.current()).chats.contacts.some((contact) => contact.name === '不应留下'), '持久化失败回滚内存实体');
}
{
  const epochHost = fakeHost();
  const epochRt = M.createRuntime(epochHost.api, null, () => ({}));
  await epochRt.switchChat('p1-epoch');
  const beforeClear = epochRt.generationToken('p1-epoch');
  const clear = epochRt.beginClear('p1-epoch');
  const stale = await epochRt.applyText(jade('stale-after-clear', TABLET_OK), 'p1-epoch', 'generation:success', { generationToken: beforeClear, realtime: true });
  ok(clear.ok && clear.epoch > beforeClear.clearEpoch, '清除操作推进 generation clear epoch');
  ok(stale && stale.discarded === true && stale.reason === 'clear-epoch', '清除前 generation 结果被 epoch 门禁丢弃');
}
{
  const protectedState = M.CORE.normalizeState({ spaces: [{ id: 'sp0', isDefault: true, chats: {
    contacts: [{ id: 'c-user', name: '用户联系人', messages: [{ id: 'pm-1', side: 'self', time: 't', text: '用户消息' }] }],
    groups: [{ id: 'g-user', name: '用户群聊', messages: [{ id: 'pmg-1', sender: '我', side: 'self', time: 't', text: '群消息' }] }]
  } }] }, 'p1-protected');
  const fullContacts = Array.from({ length: 10 }, (_, i) => ({ id: 'ai-c-' + i, name: 'AI联系人' + i, messages: [{ id: 'm-' + i + '-1', side: 'other', time: 't', text: '甲' }, { id: 'm-' + i + '-2', side: 'other', time: 't', text: '乙' }] }));
  const fullGroups = Array.from({ length: 6 }, (_, i) => ({ id: 'ai-g-' + i, name: 'AI群聊' + i, messages: [{ id: 'gm-' + i + '-1', sender: '甲', side: 'other', time: 't', text: '甲' }, { id: 'gm-' + i + '-2', sender: '乙', side: 'other', time: 't', text: '乙' }] }));
  const protectedResult = M.CORE.applySnapshot(protectedState, snapOf('p1-protected-full', 'full', { chats: { contacts: fullContacts, groups: fullGroups } }), { tablet: false, forum: false, notes: false, market: false, space: false, map: false });
  const protectedChats = M.CORE.defaultSpaceState(protectedResult.state).chats;
  ok(protectedChats.contacts.some((contact) => contact.id === 'c-user'), 'full 容量满时保留用户联系人');
  ok(protectedChats.groups.some((group) => group.id === 'g-user' && group.messages.some((message) => message.id === 'pmg-1')), 'full 容量满时保留用户群聊');
}
{
  const noBaselineState = M.CORE.normalizeState({ spaces: [{ id: 'sp0', isDefault: true, chats: { contacts: [{ id: 'c-old', name: '旧联系人', messages: [] }], groups: [] } }] }, 'p1-baseline');
  const noBaseline = M.CORE.applySnapshot(noBaselineState, { turn: { id: 'p1-baseline', mode: 'diff' }, diff: { msg: [{ add: false, type: 'contact', values: ['c-old'] }] } }, {}, undefined, { realtime: true });
  const noBaselineContacts = M.CORE.defaultSpaceState(noBaseline.state).chats.contacts;
  ok(noBaselineContacts.some((contact) => contact.id === 'c-old'), '实时 diff 缺失 prepare 基线时不修改旧数据');
  ok(noBaseline.assessment.issues.some((issue) => issue.code === 'diff.hidden'), '实时 diff 缺失 prepare 基线记录拒写 issue');
}
{
  const capacityHost = fakeHost();
  const capacityRt = M.createRuntime(capacityHost.api, null, () => ({}));
  await capacityRt.switchChat('p1-capacity');
  const capacitySpace = M.CORE.defaultSpaceState(capacityRt.current());
  capacitySpace.notes.folders = Array.from({ length: 10 }, (_, i) => ({ id: 'pf-' + i, name: '夹' + i, count: 0 }));
  capacitySpace.notes.notes = Array.from({ length: 30 }, (_, i) => ({ id: 'pn-' + i, folderId: 'pf-0', title: '记' + i, body: '' }));
  capacitySpace.space.items = Array.from({ length: 30 }, (_, i) => ({ id: 'pi-' + i, name: '物' + i, qty: 1, grade: '', desc: '' }));
  capacitySpace.space.currencies = Array.from({ length: 10 }, (_, i) => ({ kind: '币' + i, amount: '1' }));
  capacitySpace.market.orders = Array.from({ length: 12 }, (_, i) => ({ id: 'po-' + i, name: '单' + i, status: '', price: '', time: '', side: 'buy' }));
  capacitySpace.forum.posts = Array.from({ length: 20 }, (_, i) => ({ id: 'fp-' + i, owner: 'character', author: '人', title: '帖' + i, body: '', section: '', comments: [] }));
  eq(capacityRt.spaceSaveEntity('sp0', 'folder', { name: '新夹' }, '').reason, 'full', '文件夹满容量拒绝新建');
  eq(capacityRt.spaceSaveEntity('sp0', 'note', { title: '新记', body: '', folderId: 'pf-0' }, '').reason, 'full', '备忘满容量拒绝新建');
  eq(capacityRt.spaceSaveEntity('sp0', 'item', { name: '新物', qty: 1 }, '').reason, 'full', '物品满容量拒绝新建');
  eq(capacityRt.spaceSaveEntity('sp0', 'currency', { kind: '新币', amount: '1' }, '').reason, 'full', '钱财满容量拒绝新建');
  eq(capacityRt.spaceSaveEntity('sp0', 'order', { name: '新单', status: '', price: '' }, '').reason, 'full', '订单满容量拒绝新建');
  eq(capacityRt.spaceSaveEntity('sp0', 'post', { title: '新帖', body: '' }, '').reason, 'full', '帖子满容量拒绝新建');
}
{
  ok(zhCatalog['runtime.manage.exportNote'].includes('全部用户空间') && !zhCatalog['runtime.space.localHint'].includes('仅存本机'), '中文隐私文案符合 v3 全空间快照语义');
  ok(enCatalog['runtime.manage.exportNote'].includes('every user space') && !enCatalog['runtime.space.localHint'].includes('only on this device'), '英文隐私文案符合 v3 全空间快照语义');
}
{
  ok(!/var archiveQueue = Promise\.resolve\(\);/.test(runtimeSource) && /saveQueue = task\.then/.test(runtimeSource), '本地与世界书提交共用可等待队列');
}
{
  // 运行时销毁：关闭跨 tab 通道并移除 storage 监听，避免测试/宿主进程被 BroadcastChannel 挂住。
  const disposeHost = fakeHost();
  let removed = 0;
  const runtimeWindow = {
    localStorage: null,
    addEventListener: () => {},
    removeEventListener: (name) => { if (name === 'storage') removed += 1; }
  };
  const disposable = M.createRuntime(disposeHost.api, null, () => ({}), { window: runtimeWindow });
  disposable.dispose();
  disposable.dispose();
  ok(removed === 1 && /syncChannel\.close\(\)/.test(runtimeSource), 'runtime dispose 幂等关闭 BroadcastChannel 并移除 storage 监听');
}

// ---------- UI 与视图系统冒烟 ----------
console.log('# UI 视图渲染与交互系统');
{
  const mockHost = fakeHost();
  const rt = M.createRuntime(mockHost.api, null, () => ({ enabled: true, auto_strip: true, lang: 'zh' }));
  await rt.switchChat('ui-smoke-chat');

  // 1. 初始化 Mock UI 状态
  const uiState = M.createUiState();
  ok(uiState.open === false && uiState.activeView === 'wheel', 'UI 初始为关闭态且主视图为 wheel');

  const mockCtx = {
    runtime: rt,
    state: uiState,
    tr: (k) => zhCatalog[k] || k,
    getFlags: () => ({ enabled: true, auto_strip: true, lang: 'zh' })
  };

  // 2. 8 卦位主盘渲染 (八等分空心圆环形扇面)
  const wheelHtml = M.VIEWS_WHEEL.render(mockCtx);
  ok(wheelHtml.includes('yz-taiji-svg'), '八卦盘渲染中央太极 SVG');
  ok(wheelHtml.includes('yz-bagua-annulus-svg'), '八卦盘渲染八等分空心圆 SVG');
  ok(wheelHtml.includes('yz-gua-sector') && (wheelHtml.match(/yz-gua-sector/g) || []).length === 8, '八卦盘包含恰好 8 个环形扇面功能入口');
  ok(wheelHtml.includes('☰') && wheelHtml.includes('☷') && wheelHtml.includes('☵') && wheelHtml.includes('☲'), '八卦盘包含乾坤坎离卦象');
  ok(wheelHtml.includes('☳') && wheelHtml.includes('☴') && wheelHtml.includes('☶') && wheelHtml.includes('☱'), '八卦盘包含震巽艮兑卦象');
  ok(wheelHtml.includes('data-view="tablet"'), '八卦盘包含乾·本命玉牌入口');
  ok(wheelHtml.includes('data-view="msg"'), '八卦盘包含兑·交流讯息入口');
  ok(wheelHtml.includes('data-view="manage"'), '八卦盘包含艮·玉兆管理入口');

  // 2.1 新同步扇面呼吸式高亮与角标删除
  const activeSpace = rt.activeSpace();
  activeSpace.sync.applied = ['msg'];
  activeSpace.sync.appliedSeen = [];
  const wheelNewHtml = M.VIEWS_WHEEL.render(mockCtx);
  ok(wheelNewHtml.includes('yz-gua-sector yz-gua-new') && wheelNewHtml.includes('data-view="msg"'), '新同步分区按钮包含 yz-gua-new 呼吸高亮类');
  ok(!wheelNewHtml.includes('有新同步') && !wheelNewHtml.includes('yz-sector-badge yz-new'), '有新同步角标已被移除');
  activeSpace.sync.appliedSeen = ['msg'];
  const wheelSeenHtml = M.VIEWS_WHEEL.render(mockCtx);
  ok(!wheelSeenHtml.includes('yz-gua-new'), '已查看分区解除呼吸高亮');
  activeSpace.sync.applied = [];
  activeSpace.sync.appliedSeen = [];

  // 3. 乾 · 本命玉牌
  const tabletHtml = M.VIEWS_TABLET.render(mockCtx);
  ok(tabletHtml.includes('本命玉牌') && tabletHtml.includes('基本') && tabletHtml.includes('仪容') && tabletHtml.includes('修为'), '本命玉牌渲染分组字段');
  ok(tabletHtml.includes('功法') && tabletHtml.includes('羁绊') && tabletHtml.includes('隐秘'), '本命玉牌包含功法/羁绊/隐秘分组');
  const activeSpaceTab = rt.activeSpace();
  activeSpaceTab.tablet.groups = [
    { id: 'basic', fields: [{ key: '名字', value: '白茯苓' }, { key: '性别', value: '女' }] },
    { id: 'cult', fields: [{ key: '境界', value: '练气一层' }] }
  ];
  const populatedTabletHtml = M.VIEWS_TABLET.render(mockCtx);
  ok(populatedTabletHtml.includes('白茯苓') && populatedTabletHtml.includes('练气一层'), '本命玉牌正常渲染 groups 数组中的字段');

  // 4. 兑 · 交流讯息
  const msgHtml = M.VIEWS_MESSAGES.render(mockCtx);
  ok(msgHtml.includes('交流讯息') && msgHtml.includes('联系人') && msgHtml.includes('群聊'), '交流讯息渲染联系人与群聊选项卡');

  // 4.1 传音符对话流
  const sp = rt.activeSpace();
  sp.chats.contacts = [{ id: 'c-1', name: '韩立', relation: '道友', messages: [{ id: 'm-1', direction: 'other', text: '厉飞雨道友在否？', time: '午时' }, { id: 'm-2', direction: 'self', text: '在下正是。', time: '未时' }] }];
  uiState.selectedId = 'c-1';
  const threadHtml = M.VIEWS_MESSAGES.render(mockCtx);
  ok(threadHtml.includes('yz-msg-bubble yz-other') && threadHtml.includes('厉飞雨道友在否？'), '对话流渲染对方气泡');
  ok(threadHtml.includes('yz-msg-bubble yz-self') && threadHtml.includes('在下正是。'), '对话流渲染自身气泡');
  uiState.selectedId = null;

  // 5. 离 · 记事玉册
  sp.notes.folders = [{ id: 'f-1', name: '丹方心得' }];
  sp.notes.notes = [{ id: 'n-1', folderId: 'f-1', title: '筑基丹配方', body: '千年灵草三钱', locked: true }];
  const notesHtml = M.VIEWS_NOTES.render(mockCtx);
  ok(notesHtml.includes('记事玉册') && notesHtml.includes('丹方心得') && notesHtml.includes('筑基丹配方'), '记事玉册渲染分类与备忘卡片');
  ok(notesHtml.includes('🔒'), '禁制备忘渲染加锁图标');

  // 6. 震 · 交易坊市
  sp.market.listings = [{ id: 'l-1', name: '青竹蜂云剑', grade: '仙宝', price: '十万上品灵石', seller: '韩立', desc: '七十二口辟邪神竹飞剑' }];
  const marketHtml = M.VIEWS_MARKET.render(mockCtx);
  ok(marketHtml.includes('交易坊市') && marketHtml.includes('青竹蜂云剑') && marketHtml.includes('十万上品灵石'), '交易坊市渲染在售法宝与品阶');

  // 7. 巽 · 天下论坛
  sp.forum.posts = [{ id: 'p-1', title: '论青元剑诀修炼关窍', body: '第三层需以辟邪神雷辅之', author: '厉飞雨', section: '修炼心得', echo: 42, unread: 1, owner: 'player' }];
  const forumHtml = M.VIEWS_FORUM.render(mockCtx);
  ok(forumHtml.includes('天下论坛') && forumHtml.includes('论青元剑诀修炼关窍') && forumHtml.includes('共鸣 42'), '天下论坛渲染帖子与共鸣');
  ok(forumHtml.includes('本尊发帖') || forumHtml.includes('我'), '玩家发帖渲染专属标识');

  // 8. 坎 · 芥子空间
  sp.space.items = [{ id: 'i-1', name: '掌天瓶', grade: '绝品', count: 1, desc: '夺天地造化' }];
  sp.space.currencies = [{ id: 'cur-1', kind: '极品灵石', amount: '8888' }];
  uiState.activeTab = 'items';
  const spaceItemsHtml = M.VIEWS_SPACE.render(mockCtx);
  ok(spaceItemsHtml.includes('芥子空间') && spaceItemsHtml.includes('掌天瓶'), '芥子空间储物页渲染法宝');
  uiState.activeTab = 'currencies';
  const spaceCursHtml = M.VIEWS_SPACE.render(mockCtx);
  ok(spaceCursHtml.includes('极品灵石') && spaceCursHtml.includes('8888'), '芥子空间钱财页渲染灵石数额');
  uiState.activeTab = '';

  // 9. 坤 · 天下舆图
  sp.map.current = { name: '天南·越国', region: '黄枫谷', desc: '青翠群山，灵气浓郁' };
  sp.map.tracks = [{ time: '甲子年', location: '太岳山脉', action: '开辟洞府' }];
  const mapHtml = M.VIEWS_MAP.render(mockCtx);
  ok(mapHtml.includes('天下舆图') && mapHtml.includes('天南·越国') && mapHtml.includes('太岳山脉'), '天下舆图渲染当前所在与云游轨迹');

  // 10. 艮 · 玉兆管理
  const manageHtml = M.VIEWS_MANAGE.render(mockCtx);
  ok(manageHtml.includes('玉兆管理') && manageHtml.includes('八卦功能启闭封印') && manageHtml.includes('九幽诸天 · 空间管理'), '管理页渲染功能封印与多空间管理');

  // 11. 同步诊断面板
  const syncHtml = M.VIEWS_SYNC.render(mockCtx);
  ok(syncHtml.includes('同步诊断') && syncHtml.includes('同步状态'), '同步诊断页渲染状态指标');
  ok(syncHtml.includes('id="yz-btn-clear"') && syncHtml.includes('white-space: nowrap') && syncHtml.includes('width: auto'), '同步诊断清空重置按钮防止折行');
  ok(syncHtml.includes('color: var(--yz-danger)'), '清空重置按钮渲染危险警示色');

  // 12. PAGE 视图路由器调度分发
  const viewsToTest = ['wheel', 'tablet', 'msg', 'notes', 'market', 'forum', 'space', 'map', 'manage', 'sync'];
  for (const v of viewsToTest) {
    uiState.activeView = v;
    const rendered = M.PAGE.render(mockCtx);
    ok(typeof rendered === 'string' && rendered.length > 50, `PAGE 调度分发视图「${v}」渲染正常`);
  }

  // 13. 导航状态机 (Navigation State Machine)
  let renderedCount = 0;
  const mockShell = {
    render: () => { renderedCount += 1; },
    updateVisibility: () => {},
    renderDialogs: () => {}
  };
  const nav = M.createNavigation({ state: uiState, shell: mockShell, runtime: rt });
  nav.open('notes');
  eq(uiState.open, true, 'nav.open 打开 UI');
  eq(uiState.activeView, 'notes', 'nav.open 切换到 notes 视图');
  nav.navigate('forum', { tab: '修炼心得' });
  eq(uiState.activeView, 'forum', 'nav.navigate 进入 forum');
  eq(uiState.activeTab, '修炼心得', 'nav.navigate 设置 tab');
  nav.back();
  eq(uiState.activeView, 'notes', 'nav.back 返回上一个视图');
  nav.close();
  eq(uiState.open, false, 'nav.close 关闭 UI');

  // 14. 实体表单构建 (Entity Forms)
  const forms = M.createForms({ state: uiState, shell: mockShell, tr: mockCtx.tr, dialogs: {}, dataActions: {} });
  forms.openNoteForm({ id: 'n-1', title: '炼丹记', body: '丹成九品' });
  ok(uiState.modal && uiState.modal.type === 'entity-form', 'forms.openNoteForm 唤出模态表单');
  eq(uiState.modal.kind, 'note', '表单类型为 note');
  eq(uiState.modal.initialData.title, '炼丹记', '表单回填初始数据');
  uiState.modal = null;

  // 15. 数据操作分发与撤销 (Data Actions & Undo)
  let undoCalled = false;
  const mockDialogs = {
    toast: () => {},
    confirm: (opts) => { if (opts.onConfirm) opts.onConfirm(); },
    showUndo: (msg, onUndo) => { if (onUndo) { onUndo(); undoCalled = true; } },
    closeModal: () => {}
  };
  const dataActions = M.createDataActions({ runtime: rt, shell: mockShell, dialogs: mockDialogs, tr: mockCtx.tr });
  dataActions.saveEntity('item', { name: '洗髓丹', qty: 5, grade: '灵品' });
  const savedItem = sp.space.items.find((it) => it.name === '洗髓丹');
  ok(!!savedItem && savedItem.qty === 5, 'dataActions.saveEntity 成功写入实体');

  dataActions.deleteEntity('item', savedItem.id, null, '洗髓丹');
  ok(undoCalled, 'dataActions.deleteEntity 触发可撤销回调');
  ok(sp.space.items.some((it) => it.name === '洗髓丹'), '撤销恢复已删除实体');

  // 16. 用户真实发言与评论分发
  dataActions.sendMessage('contact', 'c-1', '道友速来天都峰！');
  const lastMsg = sp.chats.contacts[0].messages.slice(-1)[0];
  ok(lastMsg && lastMsg.text === '道友速来天都峰！' && (lastMsg.side === 'self' || lastMsg.direction === 'self'), 'sendMessage 成功追加自身真实传音');

  dataActions.sendComment('p-1', '道友所言极是！');
  const targetPost = sp.forum.posts.find((p) => p.id === 'p-1');
  const lastComment = targetPost && targetPost.comments && targetPost.comments.slice(-1)[0];
  ok(lastComment && lastComment.text === '道友所言极是！', 'sendComment 成功追加帖子共鸣');

  // 17. 空间生命周期操作
  dataActions.createSpace('蓬莱仙岛');
  ok(rt.current().spaces.some((s) => s.name === '蓬莱仙岛'), 'createSpace 成功新建用户空间');
  const penglai = rt.current().spaces.find((s) => s.name === '蓬莱仙岛');
  dataActions.renameSpace(penglai.id, '蓬莱秘境');
  eq(penglai.name, '蓬莱秘境', 'renameSpace 成功重命名空间');
  dataActions.setSpaceFlag(penglai.id, 'allowAIWrite', false);
  eq(penglai.allowAIWrite, false, 'setSpaceFlag 成功调整 AI 读写开关');

  // 18. Tavo Hook 生命周期桥接
  const hooks = M.createHooks({
    runtime: rt,
    state: uiState,
    shell: mockShell,
    fab: { updateBadge: () => {}, resetPosition: () => {} },
    navigation: nav,
    dialogs: mockDialogs,
    domStrip: { scanNow: () => {} },
    getFlags: () => ({ enabled: true, auto_strip: true, lang: 'zh' })
  });

  // 18.1 generation:prepare 提示词注入
  const genEvent = { text: '师兄安好' };
  await hooks.generationPrepare(genEvent);
  ok(genEvent.text.includes('玉兆') && genEvent.text.includes('<yz_jade>'), 'generationPrepare 成功注入基线提示词');

  // 18.2 generation:success 协议同步剥离与快照应用
  const fullText = '这是正文内容。\n<yz_jade><yz_meta>\nturn|t-ui-1|云中子|更新玉牌|full\n</yz_meta><yz_tablet>\nfield|基本|境界|结丹初期\n</yz_tablet></yz_jade>';
  const successEvent = { text: fullText };
  hooks.generationSuccess(successEvent);
  ok(!successEvent.text.includes('<yz_jade>') && successEvent.text.includes('这是正文内容。'), 'generationSuccess 同步剥离协议块');

  // 18.3 悬浮窗水波纹特效与红点角标移除
  const mockFabEl = {
    classList: {
      _classes: new Set(),
      add: function (c) { this._classes.add(c); },
      remove: function (c) { this._classes.delete(c); },
      contains: function (c) { return this._classes.has(c); }
    },
    style: {},
    addEventListener: () => {}
  };
  const mockDoc = {
    getElementById: (id) => (id === 'yu-zhao-fab' ? mockFabEl : null),
    addEventListener: () => {}
  };
  const fabInstance = M.createFab({ document: mockDoc, window: globalThis });
  fabInstance.updateBadge(2);
  ok(mockFabEl.classList.contains('yz-has-notice'), '有未读消息时悬浮窗增加 yz-has-notice 触发水波纹');
  fabInstance.updateBadge(0);
  ok(!mockFabEl.classList.contains('yz-has-notice'), '未读清零时悬浮窗移除 yz-has-notice 停止水波纹');
  fabInstance.updateNotice(true);
  ok(mockFabEl.classList.contains('yz-has-notice'), 'updateNotice(true) 激活水波纹');
  fabInstance.updateNotice(false);
  ok(!mockFabEl.classList.contains('yz-has-notice'), 'updateNotice(false) 停止水波纹');

  const templateHtml = read('src/ui/jade.template.html');
  ok(!templateHtml.includes('yu-zhao-fab-badge'), '悬浮窗红点角标元素已从模板中彻底移除');
  ok(templateHtml.includes('#yu-zhao-fab.yz-has-notice .yz-fab-pulse'), '水波纹特效改为仅在 yz-has-notice 时出现');

  // 19. APP.create 与 shared.attachUI 契约
  const appInstance = M.APP.create({
    tavo: mockHost.api,
    document: null,
    window: globalThis
  });
  ok(appInstance && typeof appInstance.hooks === 'function' && appInstance.state && appInstance.navigation, 'APP.create 成功组装 UI 实例');
  ok(typeof appInstance.dispose === 'function', 'APP 实例具备 dispose 方法');
  appInstance.dispose();
}

// ---------- 结果 ----------
console.log('');
if (failures.length) {
  console.error(`冒烟失败 ${failures.length} 项 / 通过 ${passed} 项`);
  process.exit(1);
} else {
  console.log(`冒烟全部通过：${passed} 项`);
}
