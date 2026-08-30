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

// 把「视为 UTC 的 YYYY-MM-DD HH:mm」换算成本地时区同格式字符串（formatDateTime 已改本地时区）。
function localExpected(utcStr) {
  const d = new Date(utcStr.replace(' ', 'T') + ':00Z');
  const pad = (x) => (x < 10 ? '0' : '') + x;
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// ---------- 加载插件内部模块 ----------
// ANCHOR 用 entry.js 尾部的 smoke-bootstrap 注释作锚（注释后即 app 创建/启动引导，
// 截断时不会执行）。锚定注释而非代码字符串，避免变量改名破坏截断。
const ANCHOR = '/* smoke-bootstrap */';
const source = read('entry.js');
const cut = source.indexOf(ANCHOR);
if (cut < 0) throw new Error('未找到 entry.js 的 /* smoke-bootstrap */ 标记，请同步更新 tests/smoke.mjs 的 ANCHOR');
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
// 发布契约：版本漂移会静默破坏升级迁移（pluginVersion 变化触发 pendingFull 强制全量重写）。
eq(manifest.version, M.PLUGIN_VERSION, 'manifest 版本与 PLUGIN_VERSION 一致');
eq(releaseKey, 'releaseNotes.' + String(manifest.version).replace(/\./g, '_'), 'releaseNotes 键后缀与版本号对应');

// P1：侧边栏动作声明
{
  const sideIds = (manifest.contributes.sidebar || []).map((x) => x.id);
  eq(sideIds, ['open-jade', 'resync-history', 'clear-data'], 'sidebar 声明 open-jade/resync-history/clear-data');
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
ok(/fab\.hidden = !enabled\(\) \|\| !chatActive \|\| overlay\.classList\.contains\('open'\);/.test(source), 'FAB 显隐受 enabled + chatActive + 玉兆打开 三重门控（打开时隐藏防遮挡误触）');
// 回归保护：侧边栏「清除玉兆数据」必须走二次确认——首击只弹确认 toast（内嵌「确认清除」
// 按钮），确认按钮才真正执行，防止误触不可恢复操作。
ok(/plugin\.onSidebarAction\('clear-data', armSidebarClear\)/.test(source), '侧边栏注册 clear-data 动作');
ok(/showConfirm\(dict\.toast\.clearTitle, dict\.toast\.clearConfirm, dict\.toast\.clearConfirmAction, clearAllData\)/.test(source), '首击只弹居中确认对话框（showConfirm），确认才真正清除');
ok(/Object\.keys\(CORE\.FEATURE_FIELDS\)\.forEach/.test(source) && /player\.myComments = \[\];/.test(source), 'clearAllData 归零角色域与玩家域全部功能字段 + 评论源');
// 回归保护：清除后必须重置同步状态并强制下一轮全量重建——否则 status 残留
// 「complete」假绿、旧角色名/摘要继续显示、meta-only diff 轮提前返回，空数据却显示已同步。
ok(/state\.pendingFull = true;[\s\S]*?state\.sync = \{ status: 'empty'/.test(source), 'clearAllData 置 pendingFull 并重置 sync（清假绿 + 强制重建）');
ok(/function clearFeatureData\(featureId\) \{\s*var blank/.test(source) && /pendingFull = true;/.test(source), '单功能清空同样置 pendingFull 强制重建');
ok(/plugin\.onSidebarAction\('resync-history'/.test(source) && /plugin\.onSidebarAction\('clear-data'/.test(source), '侧边栏 resync-history 与 clear-data 双动作并存');
// 回归保护：确认框必须是 body 级居中 modal（独立于 overlay 与 toast），最高 z-index，
// 带半透明遮罩——宿主侧边栏展开等布局变化不能把确认入口遮挡到看不见。
ok(/#yz1-confirm\{position:fixed;left:0;top:0;width:100%;height:100%;z-index:' \+ \(Z_INDEX_TOP \+ 2\)/.test(source), '确认框为 body 级全屏居中 modal 且 z-index 高于 toast（+2）');
ok(/\.yz-confirm-backdrop\{[^}]*background:rgba\(0,0,0,\.55\)/.test(source), '确认框带半透明遮罩（视觉聚焦，明确表达模态等待决策）');
ok(/showConfirm\(title, message, okLabel, fn\)/.test(source) && /host\.classList\.add\('show'\)/.test(source), 'showConfirm 渲染标题/文案/确认按钮并显示 modal');
ok(/if \(btn\.classList\.contains\('yz-confirm-ok'\)/.test(source) && /setTimeout\(fn, 0\)/.test(source), '确认按钮才执行 fn（微任务防竞态），点取消/遮罩只关闭');
// 回归保护：确认框必须锁定弹起时的聊天——确认时校验仍指向同一聊天才执行，
// 否则收起并丢弃，杜绝弹框期间切换聊天后「确认清除」误清新聊天数据。
ok(/var confirmChatId = null;/.test(source) && /confirmChatId = runtime\.activeChatId;/.test(source), 'showConfirm 捕获并锁定弹起时的聊天');
ok(/var lockedChat = confirmChatId;/.test(source) && /lockedChat !== runtime\.activeChatId\) return;/.test(source), '确认时校验聊天未切换才执行，否则丢弃');
ok(/hideConfirm\(\);\s*close\(\);\s*render\(\);/.test(source), 'chat:closed 时收起确认框（锁定的聊天已失效）');
// 回归保护：玩家域表单「种类已存在」报错必须走双语文案，绝不能直出字面 undefined。
ok(/playerFormKindClash: tr\('runtime\.player\.formKindClash'\),/.test(source), 'buildDict 接线 playerFormKindClash（防直出 undefined）');
ok(/duration \|\| 2400/.test(source), 'showToast 保留自定义展示时长（默认 2.4s）');
// 回归保护：showToast 必须先清空上一条——2.4s 内连续两条 toast 不串接、
// 旧内嵌按钮（撤销等）不残留（残留按钮会触发被替换后的新动作）。
ok(/function showToast\(text, bad, action, duration\) \{[\s\S]*?if \(!toast\) return;[\s\S]*?clearToast\(\);[\s\S]*?toastAction = action && action\.fn \? action\.fn : null;/.test(source), 'showToast 开头先 clearToast（不串接、清残留按钮）');
// 回归保护：太极核心不能是死按钮——角色域主页点击打开同步诊断（与插件描述一致），
// 功能页/玩家域保持回主界面语义。
ok(/if \(action === 'core'\) \{\s*if \(nav\.app !== 'home' \|\| domain === 'player'\) return resetSearch\(\), render\(\);\s*return openSyncDetail\(\);\s*\}/.test(source), '太极核心主页点击打开同步诊断（功能页/玩家域回主界面）');
// 回归保护：封印 msg/forum 后发讯/群聊/评论必须明示不可送达——否则消息写入玩家域却
// 永远到不了角色，看着像已发送（假成功）。
ok(/featureFlags\.msg === false\) \{ showToast\(I18N\.dict\(\)\.toast\.sealedMsg, true\); return; \}/.test(source), '封印 msg 后发讯明示（不假成功）');
ok(/featureFlags\.msg === false\) \{ showToast\(I18N\.dict\(\)\.toast\.sealedMsg, true\); return; \}/.test(source), '封印 msg 后群聊发言明示');
ok(/featureFlags\.forum === false\) \{ showToast\(I18N\.dict\(\)\.toast\.sealedForum, true\); return; \}/.test(source), '封印 forum 后评论明示');
// 回归保护：非聊天页重渲染必须保留滚动位置（发论坛评论/搜索后不再跳顶）。
ok(/var savedScroll = \(\(nav\.view === 'chat' \|\| nav\.view === 'gchat'\) && !search\) \? null : pageNode\.scrollTop;/.test(source) && /pageNode\.scrollTop = savedScroll;/.test(source), '重渲染前保存滚动位置并恢复（非聊天页/检索态）');
// 回归保护：确认框点遮罩/Esc 关闭（与文档承诺一致），点非按钮区域等同取消。
ok(/if \(!btn\) \{ cancelConfirm\(\); return; \}/.test(source), '确认框点遮罩等同取消');
ok(/hostDocument\.addEventListener\('keydown', function \(event\) \{\s*if \(event\.key !== 'Escape'\) return;/.test(source), '确认框支持 Esc 关闭');
// 回归保护：快照恢复 in-flight 锁——进行中再点不触发误导性「聊天已切换」红 toast。
ok(/var restoreBusy = false;/.test(source) && /if \(restoreBusy\) \{ showToast\(I18N\.dict\(\)\.toast\.restoreBusy\); return; \}/.test(source), 'resync-history 有 in-flight 锁（防重入）');
// 回归保护：非聊天页（宿主主页/设置等）侧边栏/输入动作不操作上一个聊天的残留数据。
ok(/if \(!chatActive\) \{ showToast\(I18N\.dict\(\)\.toast\.noChat, true\); return; \}/.test(source), 'open()/resync/clear 非聊天页统一门控（不作用于残留聊天）');
// 回归保护：聊天详情检索时不钉底（搜旧消息不被拉回底部）、非聊天页重渲染恢复滚动位置。
ok(/#yz1-overlay\.loading\{display:flex/.test(source), 'open() 异步加载期间有 loading 态');
// 回归保护：生成失败/取消回退已读游标（玩家消息不被提前标已读）。
ok(/var cursorBeforePrepare = null;/.test(source) && /runtime\.restorePlayerReadCursor\(runtime\.activeChatId, cursorBeforePrepare\);/.test(source), '生成失败/取消回退已读游标');
// S1 回归：发送按钮防抖——sending 锁防止并发 syncPlayerChannel。
ok(/var sending = false;/.test(source) && /if \(sending\) return;/.test(source), '发送按钮有 sending 防抖锁');
// S2 回归：封印时发送区域显示封印横幅（非活跃输入框）。
ok(/var sealed = flags && flags\.msg === false;/.test(source) && /yz-composer-sealed/.test(source), '封印时传讯区显示封印横幅');
// S4 回归：清除标记——clearAllData/clearFeatureData 置 clearPending，generation:success 时丢弃。
ok(/var clearPending = false;/.test(source) && /clearPending = true;/.test(source), '清除操作设置 clearPending 防数据复活');
// S5 回归：overlay 开关 epoch——open()/close() 增减 epoch 防异步竞态。
ok(/var openEpoch = 0;/.test(source) && /var epoch = \+\+openEpoch;/.test(source), 'overlay 开关有 epoch 计数器防异步竞态');
// S6 回归：本地数据损坏警告——load() 检测 JSON 损坏并弹 toast。
ok(/var rawMirror = localGet\(/.test(source) && /mirrorCorrupted/.test(source), 'load() 检测 localStorage 数据损坏并警告');
// 回归保护：自己刚发的消息不计为角色域未读（refreshPlayerContact 排除 ownIds）。
ok(/var ownIds = \{\};\s*var player = playerCurrent\(\);/.test(source) && /!ownIds\[String\(message\.id\)\]\) unread \+= 1;/.test(source), 'refreshPlayerContact 排除自己发过的消息（不计角色域未读）');
// 回归保护：卦名允许两行换行（en 长卦名小屏不截断）。
ok(/\.yz-node b\{[^}]*display:-webkit-box;-webkit-line-clamp:2/.test(source), '卦名两行换行（en 不截断）');
// 回归保护：英文顶栏窄屏适配（媒体查询隐藏副标、缩字距）。
ok(/@media \(max-width:374px\)\{\.yz-topbar\{gap:6px\}/.test(source), '窄屏顶栏适配（防 EN 溢出）');
// 回归保护：封印后给「启封」撤销按钮（误封可一键回退）。
ok(/toast\.sealed[\s\S]*?label: I18N\.dict\(\)\.unseal/.test(source), '封印后 toast 带「启封」撤销按钮');
// 回归保护：超长标识行截断按字段边界（不腰斩 id）。
ok(/var lastSep = cut\.lastIndexOf\('｜'\);\s*if \(lastSep > 0\) cut = cut\.slice\(0, lastSep\);/.test(source), '第五轮截断按「｜」边界切（不腰斩 id）');
// 回归保护：玩家域主页同步行为纯展示（无手形）。
ok(/\.yz-sync\.yz-sync-static\{cursor:default\}/.test(source), '玩家域主页同步行纯展示（不伪装可点）');
// 回归保护：确认框语言切换刷新文案 + 无障碍焦点（aria 关联 + 焦点入取消）。
ok(/function refreshConfirmText\(\) \{/.test(source) && /box\.setAttribute\('aria-labelledby', titleId\);/.test(source), '确认框语言刷新 + aria 关联 + 焦点入取消');
// 回归保护：英文「New/Edit+名词」补空格（en 不粘连成 NewFolder）。
ok(/function playerVerbNoun\(verb, noun\) \{/.test(source) && /verb \+ ' ' \+ noun : verb \+ noun;/.test(source), 'playerVerbNoun 按语言补空格（en 不粘连）');
// 回归保护：带操作按钮的 toast（清除确认等）文案较长，nowrap+overflow 会把按钮挤出可视区，
// 必须允许换行且不裁剪，保证「确认清除」按钮始终可见。
ok(/\.yz-toast\.has-action\{white-space:normal;max-width:92%;overflow:visible;text-overflow:clip;line-height:1.5\}/.test(source), 'has-action toast 允许换行、不裁剪（按钮不被挤出）');
ok(/toast\.classList\.toggle\('has-action', !!\(action && action\.label\)\);/.test(source), 'showToast 按是否有操作按钮切换 has-action 类');
ok(/toast\.classList\.remove\('show', 'bad', 'has-action'\);/.test(source), 'clearToast 复位 has-action 类');
// 回归保护：× 关闭玉兆后 FAB 必须立即恢复可见（close() 内按同一门控刷新 fab.hidden，
// 否则悬浮球一直消失，重开玉兆只能走侧边栏，步骤繁琐）。
const closeBody = source.slice(source.indexOf('function close()'), source.indexOf('function bindOverlay'));
ok(/fab\.hidden = !enabled\(\) \|\| !chatActive;/.test(closeBody), 'close() 内直接刷新 FAB 显隐（× 关闭后悬浮球立即回来）');
// 回归保护：全局 Toast 通道——toast 宿主独立于 overlay（overlay 关闭时 display:none 会藏掉
// overlay 内的 toast），长按 FAB 复位/侧边栏重建等玉兆未打开时的提示才能可见。
ok(/#yz1-toast\{position:fixed/.test(source) && source.includes("hostDocument.body.appendChild(toastHost)"), 'toast 宿主为 body 级全局浮层（非 overlay 内，玉兆未打开也可见）');
ok(!/renderShell[^}]*data-toast/.test(source) && !/<div class="yz-toast" data-toast>/.test(source), 'shell 模板不再内嵌 overlay 内 toast（已迁移到全局宿主）');
// 回归保护：FAB chatActive 启动兜底——插件重载后宿主不再重发 chat:opened，启动时主动探测一次。
ok(source.indexOf('chatActive 启动兜底') >= 0 && source.includes('tavoApi.chat.current') && /startChat && startChat\.id != null/.test(source), '启动时主动探测当前聊天置 chatActive（防 FAB 永久隐藏）');// 回归保护：表单校验定位化——reason → 字段高亮 focus + 行内错误提示；数量步进按钮。
ok(/flagFormError\(fieldKey, message\)/.test(source) && /box\.classList\.add\('error'\)/.test(source), '保存失败按字段高亮 focus + 行内错误提示');
ok(/REASON_FIELD = \{ name: 'name'/.test(source), 'reason 映射到具体表单字段');
ok(/data-action="qty-step"/.test(source), '数量字段带步进按钮');
// 回归保护：拖拽跟手——触摸不被滚动劫持 + 手势中禁用位置过渡（否则按钮滞后于指针）。
ok(/#yz1-fab\{[^}]*touch-action:none/.test(source), 'FAB 声明 touch-action:none，触摸拖拽不被页面滚动劫持');
ok(/#yz1-fab\.dragging\{transition:none\}/.test(source), 'FAB 拖拽中禁用位置过渡动画');
// 回归保护：图标与点击反馈——玉璧 SVG、禁用方形触摸高亮、按压为圆形缩放。
ok(/id="yzJadeFace"/.test(source) && source.includes('fab.innerHTML = FAB_ICON'), 'FAB 图标为玉璧 SVG（FAB_ICON 常量）');
ok(/#yz1-fab\{[^}]*-webkit-tap-highlight-color:transparent/.test(source), 'FAB 禁用系统方形触摸高亮');
ok(/#yz1-fab:active\{transform:scale\(/.test(source), 'FAB 按压反馈为圆形缩放');
ok(/!enabled\(\) \|\| !autoStrip\(\)/.test(source), '正文剥离有 enabled 门控');
// 回归保护：generation:success 内剥离必须先于快照应用（防 5 秒预算超时丢弃剥离结果）。
// 切片端点用相邻事件字符串而非局部变量名，避免改名破坏测试。
const successHandler = source.slice(source.indexOf("plugin.on('generation:success'"), source.indexOf("plugin.on('generation:error'"));
ok(successHandler.indexOf('stripEventFields(event)') >= 0 && successHandler.indexOf('stripEventFields(event)') < successHandler.indexOf('applyText('), 'success 先同步剥离再应用快照');

// 回归保护：全部渲染出来的 data-action 按钮都有对应的 bindOverlay 路由分支（双向一致），
// 防止新增按钮忘了挂处理器或删除分支后留下死按钮。源码级扫描，无需 DOM。
// 按钮存在动态路径（button('navigate', ...) 助手），需一并收集 button( 字面量。
{
  const staticActions = [...source.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]).filter((a) => a.indexOf('+') < 0);
  const buttonActions = [...source.matchAll(/button\('([^']+)'/g)].map((m) => m[1]);
  const actionLiterals = [...new Set([...staticActions, ...buttonActions])];
  const handlerLiterals = [...new Set([...source.matchAll(/action === '([^']+)'/g)].map((m) => m[1]))];
  ok(actionLiterals.length > 0 && handlerLiterals.length > 0, '源码级扫描到 data-action 与路由分支');
  ok(actionLiterals.every((a) => handlerLiterals.includes(a)), '全部 data-action 按钮都有路由分支');
  ok(handlerLiterals.every((h) => actionLiterals.includes(h)), '全部路由分支都有对应按钮');
}

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
  ok(evEmpty.text && evEmpty.text.length > 0 && !evEmpty.text.includes('<yz_jade>'), '剥离后为空时回填非空占位（不含协议块）');

  // 信封择优：text 含协议取 text；仅 content 含协议取 content；皆无时取非空字段。
  eq(M.pickEnvelopePayload({ text: '<yz_jade>x</yz_jade>正文', content: '<yz_jade>y</yz_jade>' }), '<yz_jade>x</yz_jade>正文', 'text 含信封优先');
  eq(M.pickEnvelopePayload({ content: '<yz_jade>y</yz_jade>正文', text: '普通文本' }), '<yz_jade>y</yz_jade>正文', '仅 content 含信封取 content');
  eq(M.pickEnvelopePayload({ content: '普通', text: '' }), '普通', '皆无信封时取非空字段');
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
  const revAfterHydrate = rt.current().revision;
  await rt.switchChat('chat-1'); // 历史未变，第二次开聊
  ok(rt.current().hydration && rt.current().hydration.sig, '水化签名已记录');
  await rt.switchChat('chat-1');
  eq(rt.current().revision, revAfterHydrate, '历史未变时不重复水化应用');
  host.setHistory(host.history().concat([{ id: 'm2', role: 'assistant', content: jade('h2', MSG_MIN) }]));
  await rt.switchChat('chat-1');
  ok(rt.current().revision > revAfterHydrate, '新楼层到达后增量应用');

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

  // 重建 = 从世界书快照恢复（权威存储）：内存被污染后回到存储版本，且不混入他聊天数据
  const hostSeed = fakeHost();
  hostSeed.current.chat = 'chat-1';
  hostSeed.seedBook('玉兆档案·chat-1', [{
    identifier: 'yz-snap-1', name: '玉兆快照', enabled: false,
    content: JSON.stringify({ v: 2, ver: M.PLUGIN_VERSION, rev: 7, updatedAt: 0, kind: 'role', index: 1, total: 1, body: JSON.stringify({ revision: 7, pluginVersion: M.PLUGIN_VERSION, updatedAt: 0, tablet: { name: '李逍遥', groups: [] }, chats: { contacts: [], groups: [] }, processedTurns: ['h1'] }) })
  }]);
  const rtSeed = M.createRuntime(hostSeed.api, null, () => ({}));
  await rtSeed.switchChat('chat-1');
  rtSeed.current().tablet.name = '污染';
  rtSeed.current().revision = 99;
  const rebuiltX = await rtSeed.rebuildFromHistory('chat-1');
  eq(rebuiltX.restored, true, '世界书有快照时重建成功');
  eq(rtSeed.current().revision, 7, '重建恢复世界书快照的 revision');
  eq(rtSeed.current().tablet.name, '李逍遥', '重建从世界书快照恢复玉牌');
  ok(rtSeed.current().processedTurns.indexOf('t-live') < 0, '重建后仅含快照中的轮次（不含其他聊天的 t-live）');
}
await runtimeCase();

// 重建从世界书快照恢复：快照存在则覆盖内存；无快照时保留现状
console.log('# Runtime · 世界书快照重建');
{
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-1');
  await rt.applyText(jade('k1', TABLET_OK + MSG_MIN), 'chat-1', 'generation:success');
  eq(rt.current().revision, 1, '同步一轮基线');
  const tick = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };
  await tick();
  const res = await rt.rebuildFromHistory('chat-1');
  eq(res.restored, true, '世界书有快照时重建成功');
  eq(rt.current().revision, 1, '重建后 revision 与快照一致');
  eq(rt.current().tablet.name, '李逍遥', '重建后玉牌数据恢复');
  eq(rt.current().chats.contacts.length, 2, '重建后联系人保留');
  await rt.rebuildFromHistory('chat-1');
  eq(rt.current().revision, 1, '再次重建同样保持快照版本');

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
  eq(rt2.current().tablet.name, '李逍遥', '无快照时保留现有内存数据');

  // 空白聊天（从未同步）：保持空白（不产生假数据）
  const host3 = fakeHost();
  const rt3 = M.createRuntime(host3.api, null, () => ({}));
  await rt3.switchChat('chat-3');
  const res3 = await rt3.rebuildFromHistory('chat-3');
  eq(res3.restored, false, '空白聊天重建不恢复');
  eq(rt3.current().revision, 0, '空白聊天重建后仍空白');
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
  eq(rt.current().revision, 1, 'applyText 同步更新内存态，不等落盘');
  await flushWorld();
  ok(store.has(rt.LOCAL_PREFIX + 'chat-save'), '后台队列把状态写入本地镜像（缓存）');
  const snapBook = host.lorebooks().find((b) => b.name === '玉兆档案·chat-save');
  ok(snapBook && snapBook.entries.some((e) => e.identifier === 'yz-snap-1'), '数据变化即同步世界书快照分片');

  // 世界书权威：新会话（无本地镜像）从世界书分片快照恢复
  const host2 = fakeHost();
  host2.seedBook('玉兆档案·chat-1', [{
    identifier: 'yz-snap-1', name: '玉兆快照', enabled: false,
    content: JSON.stringify({ v: 2, ver: M.PLUGIN_VERSION, rev: 3, updatedAt: 0, kind: 'role', index: 1, total: 1, body: JSON.stringify({ revision: 3, chats: { contacts: [], groups: [] } }) })
  }]);
  const rt2 = M.createRuntime(host2.api, null, () => ({}));
  await rt2.switchChat('chat-1');
  eq(rt2.current().revision, 3, '世界书快照分片可加载（无本地缓存）');

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
  eq(rtRace2.current().tablet.name, '李逍遥', '镜像恢复的玉牌数据完整（名字）');

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
  const bigState = M.CORE.blankState('chat-big');
  bigState.revision = 2;
  bigState.updatedAt = Date.now();
  const bigText = '字'.repeat(1300);
  bigState.chats = {
    contacts: [{ id: 'c1', name: '长谈', messages: Array.from({ length: 80 }, (_, i) => ({ id: 'm' + i, side: 'other', time: 'x', text: bigText + i })), preview: '' }],
    groups: []
  };
  const bigRt = M.createRuntime(hostBig.api, null, () => ({}));
  const bigEntries = bigRt.buildSnapshotEntries(bigState, M.CORE.blankPlayerState('chat-big'));
  ok(bigEntries.length > 1, '大状态拆为多片快照');
  ok(bigEntries.every((e) => e.enabled === false && e.probability === 0), '所有快照分片永不注入');
  hostBig.seedBook('玉兆档案·chat-big', bigEntries.map((e) => ({ ...e })));
  const bigRt2 = M.createRuntime(hostBig.api, null, () => ({}));
  await bigRt2.switchChat('chat-big');
  eq(bigRt2.current().revision, 2, '多片快照拼接还原');
  const bigRestored = bigRt2.current().chats.contacts[0].messages;
  eq(bigRestored.length, 20, '多片快照数据完整（归一保尾 20 条）');
  ok(bigRestored[19].text === bigText + '79', '分片边界无截断');

  // 旧版单条 yz-snap（无分片包装，内容为状态 JSON）读取兼容
  const hostLegacy = fakeHost();
  const legacyState = { revision: 7, pluginVersion: '2.0.2', chats: { contacts: [{ id: 'c1', name: '旧人', messages: [], preview: '' }], groups: [] } };
  hostLegacy.seedBook('玉兆档案·chat-legacy', [{ identifier: 'yz-snap', name: '玉兆快照', enabled: false, content: JSON.stringify(legacyState) }]);
  const legacyRt = M.createRuntime(hostLegacy.api, null, () => ({}));
  await legacyRt.switchChat('chat-legacy');
  eq(legacyRt.current().revision, 7, '旧版单条 yz-snap 兼容读取');
  eq(legacyRt.current().chats.contacts[0].name, '旧人', '旧快照数据完整');
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
  state.tablet.groups = M.CORE.normalizeTablet({ groups: [{ id: 'look', fields: [{ key: '外貌', value: '眉目清朗' }] }] }).groups;
  eq(M.VIEWS.fieldValue(state.tablet, 'look', 'appearance'), '眉目清朗', 'fieldValue 命中路径（规范键匹配）');
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
  eq((tAll.match(/yz-field/g) || []).length, 13, '无关键词渲染全部字段');
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
  ok(M.VIEWS.renderPage(M.CORE.blankState('f8'), { app: 'map', view: 'root', params: {}, stack: [] }, {}, {}).includes('data-marker="map"'), '空地图页正常渲染（无检索框，防纯占位）');

  // 回归：检索空态文案与清除按钮键双语齐全。
  ['runtime.search.placeholder', 'runtime.search.clear', 'runtime.search.noMatch'].forEach((k) => {
    ok(!!zhCatalog[k] && !!enCatalog[k], `检索文案 ${k} 双语齐全`);
  });
}

// ---------- P1 · 同步详情页 ----------
console.log('# P1 · 同步详情页');
{
  eq(M.VIEWS.formatDateTime(Date.UTC(2026, 7, 23, 4, 5)), localExpected('2026-08-23 04:05'), 'formatDateTime 输出补零格式（本地时区）');
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
  ok(html.includes(zhCatalog['runtime.diag.tech']) && html.includes('turn-77'), '开发者信息折叠块内展示最近轮次');
  ok(html.includes(zhCatalog['runtime.diag.tech']) && html.includes('generation:success'), '开发者信息折叠块内展示来源原文');
  ok(html.includes(zhT('runtime.feature.tablet')), 'applied 分区按功能名翻译');
  ok(html.includes(zhCatalog['assess.issue.map.rows']), 'issues 按 catalog 翻译');
  ok(html.includes(zhCatalog['runtime.diag.updated']) && html.includes(localExpected('2026-08-23 12:34')), '更新时间为手工 YYYY-MM-DD HH:mm（本地时区）');
  ok(!html.includes('toLocaleString'), '不使用 toLocaleString');
  ok(html.includes('yz-meter') && html.includes('%'), '容量进度条与百分比渲染');
  ok(html.includes(zhCatalog['runtime.diag.tech']) && html.includes('chat-detail'), '开发者信息折叠块内展示聊天标识');
  ok(!html.includes(zhCatalog['runtime.diag.lastError']), 'lastError 为空时不显示该行');
  const errState = M.CORE.clone(st);
  errState.sync.lastError = 'parse-error';
  errState.sync.status = 'invalid';
  const errHtml = M.VIEWS.renderSyncDetail(errState);
  ok(errHtml.includes(zhCatalog['runtime.diag.err.parse-error']), 'lastError 错误码走 catalog 翻译');
  const unkState = M.CORE.clone(st);
  unkState.sync.lastError = 'mystery-code';
  ok(M.VIEWS.renderSyncDetail(unkState).includes('mystery-code'), '未知错误码回退原文');
  ok(M.VIEWS.renderSyncDetail(errState).includes(zhCatalog['runtime.diag.action.invalid']), '无效态展示恢复行动指引');

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
  ok(expPanel.includes('data-export-output') && expPanel.includes('readonly') && expPanel.includes('data-action="copy-export"'), '导出面板只读 textarea + 复制按钮');
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
  // 回归：误贴任意 JSON（无玉兆特征字段）绝不能「导入成功」后清空当前角色域数据。
  eq(rt.importState(JSON.stringify({ foo: 1 })).reason, 'parse', '无玉兆特征字段的任意 JSON 拒收（防误贴清空数据）');
  eq(rt.importState(JSON.stringify({ version: 1 })).reason, 'parse', '非玉兆结构的 JSON 拒收');
  eq(rt.current().revision, 7, '拒收后当前内存态未被覆盖');
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
  const books = ah.lorebooks();
  eq(books.length, 1, '归档建书一次');
  eq(books[0].name, '玉兆档案·chat-1', '书名带聊天标识');
  const entries = books[0].entries;
  ok(entries.length === 3, '归档条目 + 全状态快照分片条目');
  const snapEntry = entries.find((e) => e.identifier === 'yz-snap-1');
  ok(snapEntry && snapEntry.enabled === false, '快照条目为禁用备份（永不注入）');
  const snapWrap = JSON.parse(snapEntry.content);
  ok(snapWrap.v === 2 && snapWrap.kind === 'role' && snapWrap.total === 1 && snapWrap.index === 1, '快照分片带包装（版本/域/片序）');
  ok(JSON.parse(snapWrap.body).chats.contacts.some((c) => c.id === 'c1'), '快照内容为整份状态');
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
  eq(grt.current().revision, 3, '世界书为空时从本地镜像恢复');
  eq(grt.current().chats.contacts[0].messages[0].text, '重要消息', '恢复的数据完整');
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
  eq(srt2.current().revision, 1, '本地镜像被清后从世界书快照恢复');
  ok(srt2.current().chats.contacts.some((c) => c.id === 'c1'), '快照恢复的联系人完整');

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
  // CORE：玩家域空白/归一结构——无模型域字段；forum 分区只承载玩家自己的帖子
  const ps = M.CORE.blankPlayerState('pc1');
  eq(ps.chatId, 'pc1', '空白玩家域带聊天标识');
  ok(!('sync' in ps) && !('revision' in ps) && !('processedTurns' in ps) && !('hydration' in ps), '玩家域无模型域字段');
  eq(ps.forum.posts.length, 0, '玩家域论坛分区空白');
  const pn = M.CORE.normalizePlayerState({
    sync: { status: 'complete' }, revision: 99, processedTurns: ['x'], pendingFull: true,
    chats: { contacts: [{ id: M.CORE.PLAYER_THREAD_ID, name: '李逍遥', messages: [{ id: 'pm-1', side: 'self', time: '2026-08-29', text: '在吗' }] }], groups: [] },
    market: { orders: [{ id: 'o1', name: '灵丹', status: '已拍下', price: '5', time: 'x', side: 'buy' }] },
    forum: { posts: [{ id: 'p1', author: 'a', title: 't', body: 'b' }, { id: 'fp-1', owner: 'player', author: '悦琳', title: '寻师', body: '求指点' }] }
  }, 'pc2');
  eq(pn.chatId, 'pc2', '玩家域归一保留聊天标识');
  ok(!('sync' in pn) && !('revision' in pn) && !('processedTurns' in pn) && !('hydration' in pn) && !('pendingFull' in pn), '玩家域归一剥离模型域字段');
  eq(pn.forum.posts.length, 1, '玩家域论坛只保留玩家帖子');
  eq(pn.forum.posts[0].id, 'fp-1', '非玩家帖子被剥离');
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
  eq(pc.unread, 0, '自己刚发的消息不计为角色域未读（已读游标随发送推进）');

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
  eq(rt.current().chats.contacts.find((c) => c.id === M.CORE.PLAYER_CONTACT_ID).unread, 0, '新发消息不计为角色域未读（ownIds 排除）');
  // 回归：生成失败/取消回退已读游标——prepare 推进后失败，玩家消息重新计未读。
  rt.restorePlayerReadCursor('chat-1', 0);
  eq(rt.current().chats.contacts.find((c) => c.id === M.CORE.PLAYER_CONTACT_ID).unread, 0, '回退游标后自己消息仍不计角色域未读（ownIds 排除）');
  const pv2 = M.VIEWS.renderMsgPlayer(rt.current(), rt.playerCurrent(), { app: 'msg', view: 'chat', params: { id: M.CORE.PLAYER_THREAD_ID }, stack: [] }, '');
  ok(pv2.includes(zhCatalog['runtime.player.statusSent']), '未读未回消息显示已送达');

  // 重建（从世界书快照恢复）→ 角色域玩家传讯与玩家线程完整保留
  await flushWorld();
  await rt.rebuildFromHistory('chat-1');
  const pc2 = rt.current().chats.contacts.find((c) => c.id === M.CORE.PLAYER_CONTACT_ID);
  ok(pc2 && pc2.messages.length === 3, '重建后角色域玩家传讯随快照恢复（pm-1、r1、pm-2）');
  eq(rt.playerThread(rt.playerCurrent()).messages.length, 3, '玩家线程数据在重建后完整保留');
}

{
  // 评审加固回归：伪造 pm-N 拒绝、未读 side 过滤、内容对账还原、伪造删除
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-r1');
  await rt.applyText(jade('r1', TABLET_OK + '<yz_msg>\ncontact｜c1｜林月如｜道侣｜今日｜0｜安好\ncontact｜c2｜酒剑仙｜师尊｜今日｜0｜饮酒\nmsg｜c1｜m1｜other｜昨日｜勿念\nmsg｜c1｜m2｜self｜今日｜定当赴约\nmsg｜c2｜m3｜other｜今日｜来喝酒\nmsg｜c2｜m4｜other｜今日｜速来\ngroup｜g1｜青云内门｜30｜今日｜0｜集合\ngmsg｜g1｜gm1｜掌门｜other｜今日｜卯时议事\ngmsg｜g1｜gm2｜长老｜other｜今日｜不得迟到\n</yz_msg>'), 'chat-r1', 'test');
  rt.sendPlayerMessage('chat-r1', '道友可在？');
  await rt.syncPlayerChannel('chat-r1');
  rt.markPlayerRead('chat-r1');
  const pc = () => rt.current().chats.contacts.find((c) => c.id === M.CORE.PLAYER_CONTACT_ID);
  eq(pc().messages.length, 1, '玩家传讯入库');
  eq(pc().unread, 0, '玩家消息注入即已读');

  // 模型伪造新 pm-N（side=self 自回复）被 diff 门禁拒绝
  await rt.applyText('<yz_jade><yz_meta>\nturn｜r2｜李逍遥｜回复｜diff\n</yz_meta><yz_msg>\n+msg｜yz-player｜pm-2｜self｜今日｜在的\n</yz_msg></yz_jade>', 'chat-r1', 'test');
  eq(pc().messages.length, 1, '模型无法伪造新 pm-N 玩家消息');

  // 模型以普通新 id 回复正常，且不计入未读（side 过滤）
  await rt.applyText('<yz_jade><yz_meta>\nturn｜r3｜李逍遥｜回复｜diff\n</yz_meta><yz_msg>\n+msg｜yz-player｜r1｜self｜今日｜在的\n</yz_msg></yz_jade>', 'chat-r1', 'test');
  eq(pc().messages.length, 2, '模型普通 id 回复正常入库');
  eq(pc().unread, 0, '模型自回复不计入未读（未读只数 side=other）');
  eq(rt.current().sync.playerReadCursor, 1, '模型自回复不推进已读游标');

  // full 轮篡改既有玩家消息 + 伪造超序号 pm-N → 内容对账还原与删除
  await rt.applyText(jade('r4', TABLET_OK + '<yz_msg>\ncontact｜yz-player｜道友｜外界｜今日｜0｜在吗\nmsg｜yz-player｜pm-1｜self｜今日｜被篡改的话\nmsg｜yz-player｜pm-99｜other｜今日｜捏造的话\ncontact｜c1｜林月如｜道侣｜今日｜0｜安好\nmsg｜c1｜m1｜other｜昨日｜勿念\nmsg｜c1｜m2｜self｜今日｜定当赴约\ngroup｜g1｜青云内门｜30｜今日｜0｜集合\ngmsg｜g1｜gm1｜掌门｜other｜今日｜卯时议事\ngmsg｜g1｜gm2｜长老｜other｜今日｜不得迟到\n</yz_msg>'), 'chat-r1', 'test');
  await rt.syncPlayerChannel('chat-r1');
  const pcAfter = pc();
  eq(pcAfter.messages.length, 2, '伪造超序号 pm-N 被对账删除');
  ok(pcAfter.messages.some((m) => m.id === 'pm-1' && m.text === '道友可在？' && m.side === 'other'), '全量轮篡改的玩家消息被对账还原');
  ok(pcAfter.messages.some((m) => m.id === 'r1'), '模型回复保留');
  ok(pcAfter.messages.every((m) => m.id !== 'pm-99'), '伪造消息不在角色域');

  // diff 正文含竖线：尾部字段完整合并（与 full 路径同规则）
  await rt.applyText('<yz_jade><yz_meta>\nturn｜r5｜李逍遥｜diff\n</yz_meta><yz_msg>\n+msg｜c1｜m9｜other｜今日｜正文前半｜正文后半\n</yz_msg></yz_jade>', 'chat-r1', 'test');
  ok(rt.current().chats.contacts[0].messages.some((m) => m.id === 'm9' && m.text === '正文前半｜正文后半'), 'diff 正文含竖线完整合并不截断');
}

{
  // Runtime：玩家群聊发言 → 角色域群组（幂等/重建/只读防护）；玩家发言不凑达标
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-g');
  await rt.applyText('<yz_jade><yz_meta>\nturn｜t1｜李逍遥｜同步\n</yz_meta><yz_msg>\ncontact｜c1｜林月如｜道侣｜今日｜0｜安好\ncontact｜c2｜酒剑仙｜师尊｜今日｜2｜饮酒\nmsg｜c1｜m1｜other｜昨日｜勿念\nmsg｜c1｜m2｜self｜今日｜定当赴约\nmsg｜c2｜m3｜other｜今日｜来喝酒\nmsg｜c2｜m4｜other｜今日｜速来\ngroup｜g1｜青云内门｜30｜今日｜5｜集合\ngmsg｜g1｜gm1｜掌门｜other｜今日｜卯时议事\ngmsg｜g1｜gm2｜长老｜other｜今日｜不得迟到\ngmsg｜g1｜gm0｜李逍遥｜self｜今日｜掌门定下集合\n</yz_msg></yz_jade>', 'chat-g', 'test');

  const sent = rt.sendPlayerGroupMessage('chat-g', 'g1', '各位道友安好');
  ok(sent && /^pmg-\d+$/.test(sent.id), '群聊发言返回 pmg id');
  await rt.syncPlayerGroups('chat-g');
  const g1 = rt.current().chats.groups.find((g) => g.id === 'g1');
  eq(g1.messages.length, 4, '玩家发言进角色域群组（含角色 self 消息）');
  const pmg = g1.messages.find((m) => m.id === sent.id);
  ok(pmg && pmg.side === 'other' && pmg.sender === '道友', '玩家发言在角色域为对方消息（side=other + 玩家名）');
  await rt.syncPlayerGroups('chat-g');
  eq(rt.current().chats.groups.find((g) => g.id === 'g1').messages.length, 4, '群聊发言重复同步幂等（无副本）');

  // 模型删改/伪造玩家发言全部被门禁拒绝
  await rt.applyText('<yz_jade><yz_meta>\nturn｜t2｜李逍遥｜diff\n</yz_meta><yz_msg>\n-gmsg｜g1｜pmg-1\n+gmsg｜g1｜pmg-1｜掌门｜self｜今日｜改写发言\n+gmsg｜g1｜pmg-9｜道友｜self｜今日｜伪造发言\n</yz_msg></yz_jade>', 'chat-g', 'test');
  const g1b = rt.current().chats.groups.find((g) => g.id === 'g1');
  ok(g1b.messages.some((m) => m.id === 'pmg-1' && m.text === '各位道友安好'), '玩家群聊发言不可删改');
  ok(!g1b.messages.some((m) => m.id === 'pmg-9'), '模型无法伪造 pmg 玩家发言');

  // 模型后续轮次以普通 gmsg 自然回复，玩家域（渲染角色域）可见
  await rt.applyText('<yz_jade><yz_meta>\nturn｜t3｜李逍遥｜diff\n</yz_meta><yz_msg>\n+gmsg｜g1｜gm3｜掌门｜other｜今日｜欢迎道友\n</yz_msg></yz_jade>', 'chat-g', 'test');
  ok(rt.current().chats.groups.find((g) => g.id === 'g1').messages.some((m) => m.id === 'gm3'), '模型以普通 gmsg 自然回复群聊');

  // 窗口外历史发言不丢、不被顶成"最新消息"：pmg 恒注入基线（drop:false），
  // 全量轮照抄后原位保留；镜像裁剪豁免 pmg；重插按 pmg 序号锚点定位。
  const gmIds = Array.from({ length: 10 }, (_, i) => ({ id: 'gm-x' + i, sender: '掌门', side: 'other', time: '今日', text: '旧讯' + i }));
  const gbusy = rt.current().chats.groups.find((g) => g.id === 'g1');
  gbusy.messages = gmIds.concat(gbusy.messages); // pmg-1 被 10 条模型消息挤到窗口外
  const jNow = M.PROMPT.buildCurrent(rt.current(), {}, () => 0.42).join('\n');
  ok(jNow.includes('gmsg｜g1｜pmg-1｜'), '窗口外玩家发言仍恒注入基线');
  ok(!jNow.includes('gmsg｜g1｜gm-x0｜'), '窗口外模型消息走归档行（不注入行）');
  // 全量轮照抄基线（pmg 行照抄）：parse 后 pmg 原位保留，最新消息仍是模型回复
  const bs = jNow.split('\n').filter((line) => /^(contact|msg|group|gmsg)｜/.test(line)).join('\n');
   const res5 = await rt.applyText('<yz_jade><yz_meta>\nturn｜t5｜李逍遥｜改写｜full\n</yz_meta>' + TABLET_OK + '<yz_msg>\n' + bs + '\ngmsg｜g1｜gm99｜掌门｜other｜今日｜最新发言\n</yz_msg></yz_jade>', 'chat-g', 'test');
  const gAfter = rt.current().chats.groups.find((g) => g.id === 'g1');
  ok(gAfter.messages.some((m) => m.id === 'pmg-1'), '全量轮照抄后玩家发言保留');
  eq(gAfter.messages[gAfter.messages.length - 1].id, 'gm99', '全量轮后最新消息是模型回复（玩家历史发言未被顶到最新）');
  ok(gAfter.messages.indexOf(gAfter.messages.find((m) => m.id === 'pmg-1')) < gAfter.messages.indexOf(gAfter.messages.find((m) => m.id === 'gm99')), '玩家历史发言位置在模型回复之前');

  // 镜像裁剪豁免 pmg：超过 24 条时从最旧的非玩家消息裁起，pmg 原位保留
  const gbig = rt.current().chats.groups.find((g) => g.id === 'g1');
  const bigGm = Array.from({ length: 26 }, (_, i) => ({ id: 'gmb-' + i, sender: '掌门', side: 'other', time: '今日', text: '补' + i }));
  gbig.messages = bigGm.concat(gbig.messages);
  const playerG2 = rt.playerCurrent().chats.groups.find((g) => g.id === 'g1');
  await rt.syncPlayerGroups('chat-g');
  const gTrim = rt.current().chats.groups.find((g) => g.id === 'g1');
  eq(gTrim.messages.length, 24, '群聊消息保尾 24');
  ok(gTrim.messages.some((m) => m.id === 'pmg-1') && gTrim.messages.some((m) => m.id === 'gm99'), '裁剪豁免玩家发言（pmg 与最新模型消息都在）');

  // 重插锚点：角色域有 pmg-1、缺 pmg-2 时，补回的 pmg-2 插到 pmg-1 之后（不追加尾部）
  const gSeq = rt.current().chats.groups.find((g) => g.id === 'g1');
  gSeq.messages = gSeq.messages.filter((m) => m.id !== 'pmg-2');
  const playerG = rt.playerCurrent().chats.groups.find((g) => g.id === 'g1');
  if (!playerG.messages.some((m) => m.id === 'pmg-2')) {
    playerG.messages.push({ id: 'pmg-2', side: 'self', time: '今日', text: '第二句' });
  }
  await rt.syncPlayerGroups('chat-g');
  const gSeqAfter = rt.current().chats.groups.find((g) => g.id === 'g1');
  const pmg1Idx = gSeqAfter.messages.findIndex((m) => m.id === 'pmg-1');
  const pmg2Idx = gSeqAfter.messages.findIndex((m) => m.id === 'pmg-2');
  ok(pmg1Idx >= 0 && pmg2Idx === pmg1Idx + 1, '补回的玩家发言按序号插到既有锚点之后');

  // 模型删除群组：玩家已发言的群组经对账自动重建（玩家真实发言不丢）
  await rt.applyText('<yz_jade><yz_meta>\nturn｜t4｜李逍遥｜diff\n</yz_meta><yz_msg>\n-group｜g1\n</yz_msg></yz_jade>', 'chat-g', 'test');
  const g1c = rt.current().chats.groups.find((g) => g.id === 'g1');
  ok(g1c && g1c.messages.some((m) => m.id === 'pmg-1'), '模型删除群组后玩家发言由对账重建');

  // 群聊只有玩家发言时群聊底线不达标（玩家发言不凑数）
  const gOnlyPmg = {
    contacts: [{ id: 'c1', name: 'n1', messages: [{ id: 'a', side: 'other', text: 'x' }, { id: 'b', side: 'other', text: 'y' }], preview: '' }, { id: 'c2', name: 'n2', messages: [{ id: 'c', side: 'other', text: 'x' }, { id: 'd', side: 'other', text: 'y' }], preview: '' }],
    groups: [{ id: 'g1', name: 'g', messages: [{ id: 'pmg-1', side: 'self', text: 'x' }, { id: 'pmg-2', side: 'self', text: 'y' }] }]
  };
  eq(M.CORE.assess({ version: 1, turn: { id: 't', roleName: 'r', summary: 's' }, chats: gOnlyPmg }, {}).msg.groups, false, '群聊仅玩家发言不满足群聊消息底线');

  // 视图：玩家域群聊详情带发言输入框；角色域群聊详情无
  const pvG = M.VIEWS.renderPage(rt.current(), { app: 'msg', view: 'gchat', params: { id: 'g1' }, stack: [] }, {}, {}, 'player', rt.playerCurrent());
  ok(pvG.includes('data-group-msg-input') && pvG.includes('data-action="send-group-msg"'), '玩家域群聊详情渲染发言输入框');
  const cvG = M.VIEWS.renderPage(rt.current(), { app: 'msg', view: 'gchat', params: { id: 'g1' }, stack: [] }, {}, {}, 'character', rt.playerCurrent());
  ok(!cvG.includes('data-group-msg-input'), '角色域群聊详情无发言输入框');
  // 气泡左右按渲染视角：玩家消息在角色域左侧（对方），角色消息在玩家域左侧（对方）。
  const rowSelf = '<div class="yz-bubble-row self">';
  const rowOther = '<div class="yz-bubble-row other">';
  ok(pvG.includes(rowSelf + '<div class="yz-bubble-wrap">') && pvG.indexOf(rowSelf) < pvG.indexOf('各位道友安好'), '玩家域视角：玩家消息在右侧气泡');
  ok(cvG.includes(rowOther) && cvG.indexOf('各位道友安好') > cvG.indexOf(rowOther), '角色域视角：玩家消息在左侧气泡');
  ok(cvG.includes(rowSelf), '角色域存在自己的气泡（self 消息）');
  ok(cvG.indexOf('卯时议事') < cvG.indexOf(rowSelf), '角色域视角：角色自己消息在右侧气泡（other 在左）');
  ok(cvG.indexOf('掌门定下集合') > cvG.indexOf(rowSelf), '角色域视角：self 消息落在右侧气泡');
  ok(pvG.indexOf('卯时议事') > pvG.indexOf(rowOther) && pvG.indexOf('卯时议事') < pvG.indexOf(rowSelf), '玩家域视角：角色消息在左侧气泡');
  ok(pvG.indexOf('掌门定下集合') > pvG.indexOf(rowOther) && pvG.indexOf('掌门定下集合') < pvG.indexOf(rowSelf), '玩家域视角：角色 self 消息同样在左侧气泡');
}

{
  // Runtime：玩家论坛评论 → 角色域帖子（幂等/只读防护）；玩家评论不凑达标
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-f');
  await rt.applyText('<yz_jade><yz_meta>\nturn｜t1｜李逍遥｜同步\n</yz_meta><yz_forum>\npost｜p1｜李逍遥｜蜀山弟子｜闲谈｜今日｜蜀山论剑｜明日山下切磋｜5\ncomment｜p1｜林月如｜今日｜来观战\npost｜p2｜酒剑仙｜师尊｜闲谈｜今日｜一醉方休｜今夜对饮｜3\ncomment｜p2｜李逍遥｜今日｜好\n</yz_forum></yz_jade>', 'chat-f', 'test');

  const sentC = rt.sendPlayerComment('chat-f', 'p1', '算我一个');
  ok(sentC && /^pmc-\d+$/.test(sentC.id), '论坛评论返回 pmc id');
  await rt.syncPlayerPosts('chat-f');
  const p1 = rt.current().forum.posts.find((p) => p.id === 'p1');
  ok(p1.comments.some((c) => c.id === sentC.id && c.owner === 'player' && c.author === '道友'), '玩家评论镜像进角色域帖子');
  await rt.syncPlayerPosts('chat-f');
  eq(rt.current().forum.posts.find((p) => p.id === 'p1').comments.filter((c) => c.id === sentC.id).length, 1, '评论重复同步幂等（无副本）');

  // 模型覆盖/删除玩家评论被门禁拒绝
  const pmc = rt.playerCurrent().myComments.find((c) => c.id === sentC.id);
  await rt.applyText('<yz_jade><yz_meta>\nturn｜t2｜李逍遥｜diff\n</yz_meta><yz_forum>\n-comment｜p1｜道友｜' + pmc.time + '｜算我一个\n+comment｜p1｜道友｜' + pmc.time + '｜算我一个（被改写）\n</yz_forum></yz_jade>', 'chat-f', 'test');
  const p1b = rt.current().forum.posts.find((p) => p.id === 'p1');
  ok(p1b.comments.some((c) => c.id === sentC.id && c.text === '算我一个'), '玩家评论本体不可被删改');
  const forged = p1b.comments.filter((c) => c.text === '算我一个（被改写）');
  ok(forged.every((c) => /^cm-/.test(c.id)), '改写版本只会成为普通 cm 新评论，不顶替玩家评论');

  // 模型以 +comment 自然回复（角色帖子上追加）
  await rt.applyText('<yz_jade><yz_meta>\nturn｜t3｜李逍遥｜diff\n</yz_meta><yz_forum>\n+comment｜p1｜林月如｜今日｜同去同去\n</yz_forum></yz_jade>', 'chat-f', 'test');
  ok(rt.current().forum.posts.find((p) => p.id === 'p1').comments.some((c) => c.text === '同去同去'), '模型以 +comment 自然回复');

  // 角色帖只有玩家评论时不满足评论数底线（玩家评论不凑数）
  const forumOnlyPmc = {
    posts: [
      { id: 'p1', author: '角色甲', title: 't1', body: 'b', comments: [{ id: 'pmc-1', owner: 'player', author: '道友', time: 'x', text: 'c' }] },
      { id: 'p2', author: '角色乙', title: 't2', body: 'b', comments: [{ id: 'cm-1', author: '丙', time: 'x', text: 'c' }] }
    ]
  };
  eq(M.CORE.assess({ version: 1, turn: { id: 't', roleName: 'r', summary: 's' }, forum: forumOnlyPmc }, {}).forum.ok, false, '角色帖仅玩家评论不满足评论底线');

  // 视图：玩家域帖子详情带评论输入框；角色域无
  const pvF = M.VIEWS.renderPage(rt.current(), { app: 'forum', view: 'post', params: { id: 'p1' }, stack: [] }, {}, {}, 'player', rt.playerCurrent());
  ok(pvF.includes('data-comment-input') && pvF.includes('data-action="send-comment"'), '玩家域帖子详情渲染评论输入框');
  const cvF = M.VIEWS.renderPage(rt.current(), { app: 'forum', view: 'post', params: { id: 'p1' }, stack: [] }, {}, {}, 'character', rt.playerCurrent());
  ok(!cvF.includes('data-comment-input'), '角色域帖子详情无评论输入框');
}

{
  // Runtime：玩家域持久化（本地镜像缓存 + 世界书 yz-psnap 快照分片），镜像清空后可恢复
  const host = fakeHost();
  host.current.chat = 'chat-s';
  const store = new Map();
  const local = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  const rt = M.createRuntime(host.api, local, () => ({}));
  await rt.switchChat('chat-s');
  rt.sendPlayerMessage('chat-s', '存储测试');
  await rt.syncPlayerChannel('chat-s');
  await flushWorld();
  ok(store.has(rt.PLAYER_LOCAL_PREFIX + 'chat-s'), '玩家域写入本地镜像');
  const pbook = host.lorebooks().find((b) => b.name === '玉兆档案·chat-s');
  const psnap = pbook && pbook.entries.find((e) => e.identifier === 'yz-psnap-1');
  ok(psnap && psnap.enabled === false, '玩家域快照进世界书（禁用条目）');
  const pWrap = JSON.parse(psnap.content);
  ok(pWrap.kind === 'player' && JSON.parse(pWrap.body).chats.contacts[0].id === M.CORE.PLAYER_THREAD_ID, '玩家域快照内容为玩家线程');
  const rt2 = M.createRuntime(host.api, null, () => ({}));
  await rt2.switchChat('chat-s');
  eq(rt2.playerThread(rt2.playerCurrent()).messages.length, 1, '本地镜像清空后玩家域从世界书快照恢复');
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
  ok(curBig.join('\n').length <= 9000, '未读行保留时总注入仍受上限约束');

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

  // 群聊是公开数据：玩家域群组列表/群聊详情渲染角色域数据并带「公开」标识。
  cs.chats.groups = [{ id: 'g9', name: '青云内门', members: 30, time: '今日', unread: 5, preview: '集合', messages: [{ id: 'gm1', sender: '掌门', side: 'other', time: '今日', text: '卯时议事' }] }];
  const pGroups = M.VIEWS.renderPage(cs, { app: 'msg', view: 'groups' }, {}, {}, 'player', ps);
  ok(pGroups.includes('青云内门') && pGroups.includes(zhCatalog['runtime.player.publicTag']), '玩家域群组列表渲染角色域群聊并带公开标识');
  const pGchat = M.VIEWS.renderPage(cs, { app: 'msg', view: 'gchat', params: { id: 'g9' }, stack: [] }, {}, {}, 'player', ps);
  ok(pGchat.includes('卯时议事') && pGchat.includes('data-marker="msg-gchat"') && pGchat.includes(zhCatalog['runtime.player.publicTag']), '玩家域群聊详情渲染角色域消息并带公开标识');
  const pGchatMissing = M.VIEWS.renderPage(cs, { app: 'msg', view: 'gchat', params: { id: 'nope' }, stack: [] }, {}, {}, 'player', ps);
  ok(pGchatMissing.includes(zhCatalog['runtime.player.publicTag']) || !pGchatMissing.includes('卯时议事'), '玩家域群聊缺失 id 显示空态不泄漏');
  const pChatsTag = M.VIEWS.renderPage(cs, { app: 'msg' }, {}, {}, 'player', ps);
  ok(!pChatsTag.includes(zhCatalog['runtime.player.publicTag']), '玩家域传讯列表不带公开标识');

  // 数据域隔离：玩家域空白时绝不回退渲染角色域私有数据（评审加固）。
  const iso = M.CORE.blankState('iso1');
  iso.tablet.groups = [{ id: 'basic', fields: [{ key: '名字', value: '角色甲' }] }];
  iso.notes.folders = [{ id: 'f1', name: '秘密册', count: 1 }];
  iso.notes.notes = [{ id: 'n1', folderId: 'f1', title: '角色备忘', body: 'x', updated: '', locked: false }];
  iso.space.items = [{ id: 'i1', name: '角色道具', qty: 1, grade: '', desc: '' }];
  iso.market.orders = [{ id: 'o1', name: '角色订单', status: '', price: '', time: '', side: 'buy' }];
  iso.chats.contacts = [{ id: 'c9', name: '角色密友', relation: '', time: '', unread: 0, preview: '', messages: [] }];
  const isoPlayer = M.CORE.blankPlayerState('iso1');
  const isoTablet = M.VIEWS.renderPage(iso, { app: 'tablet' }, {}, {}, 'player', isoPlayer);
  ok(!isoTablet.includes('角色甲'), '玩家域玉牌页不渲染角色域数据');
  const isoNotes = M.VIEWS.renderPage(iso, { app: 'notes' }, {}, {}, 'player', isoPlayer);
  ok(!isoNotes.includes('秘密册') && !isoNotes.includes('角色备忘'), '玩家域玉册页不渲染角色域备忘');
  const isoSpace = M.VIEWS.renderPage(iso, { app: 'space' }, {}, {}, 'player', isoPlayer);
  ok(!isoSpace.includes('角色道具'), '玩家域芥子空间不渲染角色域物品');
  const isoOrders = M.VIEWS.renderPage(iso, { app: 'market', view: 'orders' }, {}, {}, 'player', isoPlayer);
  ok(!isoOrders.includes('角色订单'), '玩家域订单页不渲染角色域订单');
  const isoMsg = M.VIEWS.renderPage(iso, { app: 'msg' }, {}, {}, 'player', isoPlayer);
  ok(!isoMsg.includes('角色密友'), '玩家域传讯列表不渲染角色域联系人');

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
  // 回归：编辑即内容变化，时间戳必须刷新——否则列表仍显示旧时间，用户以为「没存上」。
  ok(M.CORE.hasText(p().notes.notes[0].updated), '编辑后备忘 updated 非空');
  ok(p().notes.notes[0].updated !== undefined && p().notes.notes[0].updated !== '', '备忘编辑后 updated 被写入');

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
  eq(rt.playerSaveEntity('currency', { kind: '仙晶', amount: '9' }, '').reason, 'kindClash', '重命名撞已有种类拒绝（区分于空种类）');

  // 坊市订单：创建 + 方向归一 + 编辑
  eq(rt.playerSaveEntity('order', { name: '符纸', status: '已拍下', price: '5灵石', side: 'sell' }, '').ok, true, '创建订单成功');
  eq(p().market.orders[0].id, 'po-1', '订单 id 从 po-1 开始');
  eq(p().market.orders[0].side, 'sell', '卖出方向归一');
  eq(rt.playerSaveEntity('order', { name: '符纸', status: '已完成', price: '5灵石', side: 'buy' }, 'po-1').ok, true, '编辑订单成功');
  eq(p().market.orders[0].status, '已完成', '订单状态已更新');
  // 回归：编辑即内容变化，订单时间戳必须刷新（与新建一致）。
  ok(M.CORE.hasText(p().market.orders[0].time), '编辑后订单 time 非空');
  eq(rt.playerSaveEntity('order', { name: '', side: 'buy' }, '').reason, 'name', '空物品名拒绝保存');
  eq(rt.playerSaveEntity('badkind', {}, '').reason, 'kind', '未知 kind 拒绝');

  // 删除：玉册夹级联其下备忘；missing 拒删
  eq(rt.playerDeleteEntity('note', 'pn-1').ok, true, '删除备忘成功');
  eq(p().notes.notes.length, 0, '备忘已删除');
  eq(rt.playerDeleteEntity('folder', 'pf-1').ok, true, '删除玉册夹成功');
  eq(p().notes.folders.length, 1, '玉册夹已删除');
  ok(!p().notes.notes.some((n) => n.folderId === 'pf-1'), '删除玉册夹级联删除其下备忘');
  eq(rt.playerDeleteEntity('folder', 'pf-9').ok, false, '找不到的实体拒绝删除');

  // 撤销删除（playerRestoreEntity）：实体快照回插，玉册夹连同其下备忘一并还原
  const undoSnap = { kind: 'folder', id: 'pf-1', entity: { id: 'pf-1', name: '杂记改', count: 0 }, notes: [{ id: 'pn-1', title: '约定', body: '卯时山门', folderId: 'pf-1', locked: true }] };
  eq(rt.playerRestoreEntity('folder', undoSnap).ok, true, '撤销删除玉册夹成功');
  eq(p().notes.folders.some((f) => f.id === 'pf-1'), true, '玉册夹已还原');
  eq(p().notes.notes.length, 1, '玉册夹下备忘一并还原');
  eq(rt.playerRestoreEntity('note', {}).ok, false, '无快照的撤销拒绝');
  eq(rt.playerRestoreEntity('item', { entity: { id: 'pi-1', name: '丹', qty: 1 } }).ok, true, '撤销删除物品成功');
  eq(p().space.items.some((i) => i.id === 'pi-1'), true, '物品已还原');
  const beforeUndo = p().space.items.length;
  rt.playerRestoreEntity('item', { entity: { id: 'pi-1', name: '丹', qty: 1 } });
  eq(p().space.items.length, beforeUndo, '重复撤销幂等不产生副本');

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
  // 持久化恢复：本地镜像 → 世界书快照，玩家域数据进世界书
  const host = fakeHost();
  host.current.chat = 'chat-c';
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-c');
  rt.playerSaveEntity('folder', { name: '杂记' }, '');
  rt.playerSaveEntity('note', { title: '约定', body: '卯时', folderId: 'pf-1' }, '');
  rt.playerSaveEntity('item', { name: '丹', qty: 1 }, '');
  await flushWorld();
  const rt3 = M.createRuntime(host.api, null, () => ({}));
  await rt3.switchChat('chat-c');
  const restored = rt3.playerCurrent();
  eq(restored.notes.folders.length, 1, '重载后玉册夹恢复');
  eq(restored.notes.notes.length, 1, '重载后备忘恢复');
  eq(restored.space.items.length, 1, '重载后物品恢复');
  const cbook = host.lorebooks().find((b) => b.name === '玉兆档案·chat-c');
  ok(cbook && cbook.entries.some((e) => e.identifier === 'yz-psnap-1'), '玩家域 CRUD 进世界书快照');
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

  // 数量步进：qty 字段带 −/+ 按钮（data-action="qty-step"），不进列表行
  const itemForm = M.VIEWS.renderPage(cs, { app: 'space', view: 'form', params: { kind: 'item', id: 'pi-1' } }, {}, {}, 'player', ps);
  ok(itemForm.includes('data-action="qty-step"') && itemForm.includes('data-delta="-1"') && itemForm.includes('data-delta="1"'), '数量字段带 −/+ 步进按钮');
  ok(itemForm.includes('maxlength="120"') && itemForm.includes('maxlength="3000"'), '表单输入带 maxlength（与 cleanText 上限一致）');
}

{
  // 视图：全已读入口 + 超限截断痕迹（线程已归档/评论满额）
  const cs = M.CORE.blankState('c1');
  cs.sync = { status: 'complete', roleName: '李逍遥', summary: 's', applied: [], appliedSeen: [], issues: [], updatedAt: 1 };
  const ps = M.CORE.blankPlayerState('c1');
  ps.chats = { contacts: [{ id: M.CORE.PLAYER_THREAD_ID, name: '李逍遥', relation: 'x', time: '今日', unread: 3, preview: '在', messages: [] }], groups: [] };
  const chatList = M.VIEWS.renderPage(cs, { app: 'msg', view: 'chats' }, {}, {}, 'player', ps);
  ok(chatList.includes('data-action="mark-thread-read"') && chatList.includes(zhCatalog['runtime.player.markAllRead']), '有未读时玩家域会话列表提供「全部已读」');
  const chatListRead = M.VIEWS.renderPage(cs, { app: 'msg', view: 'chats' }, {}, {}, 'player', M.CORE.blankPlayerState('c1'));
  ok(!chatListRead.includes('data-action="mark-thread-read"'), '无未读时不显示「全部已读」');
  ps.chats.contacts[0].archived = true;
  const threadDetail = M.VIEWS.renderPage(cs, { app: 'msg', view: 'chat', params: { id: M.CORE.PLAYER_THREAD_ID } }, {}, {}, 'player', ps);
  ok(threadDetail.includes(zhCatalog['runtime.player.msgArchived'].replace('{n}', '20')), '线程窗口截断过时顶部展示「更早已归档」痕迹');
  const cs2 = M.CORE.blankState('c1');
  cs2.forum = { posts: [{ id: 'fp-1', owner: 'player', author: '我', section: '', time: 'x', title: '问剑', body: 'b', resonance: 0, comments: Array.from({ length: 20 }, (_, i) => ({ id: 'cm-' + i, author: 'n' + i, time: 't', text: 'c' + i })) }] };
  const postFull = M.VIEWS.renderPage(cs2, { app: 'forum', view: 'post', params: { id: 'fp-1' } }, {}, {}, 'player', M.CORE.blankPlayerState('c1'));
  ok(postFull.includes(zhCatalog['runtime.forum.commentsFull']), '评论满 20 条时展示「已达上限已归档」痕迹');
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
  eq(dg1.tablet.groups.find((g) => g.id === 'gong').fields.length, 1, '功法组内 canonical 键合并为一行');
  eq(dg1.tablet.groups.find((g) => g.id === 'gong').fields[0].value, '御剑术', 'canonical 键更新功法');
  const dg2 = M.CORE.applySnapshot(dg1, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜dg2｜李逍遥｜结缘｜diff\n</yz_meta><yz_tablet>\n+field｜羁绊｜师尊｜酒剑仙\n</yz_tablet></yz_jade>'), {}).state;
  eq(dg2.tablet.groups.find((g) => g.id === 'bond').fields.length, 2, '羁绊组追加新行');
  const dg3 = M.CORE.applySnapshot(dg2, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜dg3｜李逍遥｜缘尽｜diff\n</yz_meta><yz_tablet>\n-field｜羁绊｜师尊\n</yz_tablet></yz_jade>'), {}).state;
  eq(dg3.tablet.groups.find((g) => g.id === 'bond').fields.length, 1, '删除羁绊一行后保留道侣行');
  const dg4 = M.CORE.applySnapshot(dg3, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜dg4｜李逍遥｜弃功｜diff\n</yz_meta><yz_tablet>\n-field｜功法｜功法名\n</yz_tablet></yz_jade>'), {}).state;
  eq(dg4.tablet.groups.find((g) => g.id === 'gong').fields[0].value, '御剑术', '删空功法组被达标门禁拦截不落盘');

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

  // 视图：玉牌页按组名渲染新组标题
  const tsView = M.CORE.blankState('v-gong');
  tsView.tablet = M.CORE.normalizeTablet(TABLET_OBJ);
  const tbl = M.VIEWS.renderTablet(tsView, '');
  ok(tbl.includes(zhCatalog['runtime.group.gong']) && tbl.includes(zhCatalog['runtime.group.bond']), '玉牌页渲染功法/羁绊组标题');
  const tblKw = M.VIEWS.renderTablet(tsView, '青云剑诀');
  ok(tblKw.includes('青云剑诀') && !tblKw.includes('林月如'), '新组字段参与检索过滤');
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
  eq(mp1.map.places.length, 3, '地点名录追加新地点');
  const mp2 = M.CORE.applySnapshot(mp1, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜mp2｜李逍遥｜改说明｜diff\n</yz_meta><yz_map>\n+place｜p1｜青云山｜东域｜护山大阵所在\n</yz_map></yz_jade>'), {}).state;
  eq(mp2.map.places.find((p) => p.id === 'p1').desc, '护山大阵所在', '+place 按 id 整行替换');
  const mp3 = M.CORE.applySnapshot(mp2, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜mp3｜李逍遥｜弃一处｜diff\n</yz_meta><yz_map>\n-place｜p2\n</yz_map></yz_jade>'), {}).state;
  eq(mp3.map.places.length, 2, '-place 删除指定地点');
  const mp4 = M.CORE.applySnapshot(mp3, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜mp4｜李逍遥｜删多了｜diff\n</yz_meta><yz_map>\n-place｜p3\n</yz_map></yz_jade>'), {}).state;
  eq(mp4.map.places.length, 2, '删到 2 处以下被达标门禁拦截');

  // 达标：地点至少 2 处
  const aOk = M.CORE.assess({ version: 1, turn: { id: 't', roleName: 'r', summary: 's' }, map: mp3.map }, {});
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

  // 视图：地点名录区块 + 检索过滤；玩家域同渲染
  const mpView = M.CORE.blankState('v-map');
  mpView.map = M.CORE.normalizeMap({ current: { place: '青云山', domain: '东域', desc: '山门' }, tracks: [{ id: 't1', place: '山门', action: '入门' }], places: [{ id: 'p1', name: '青云山', domain: '东域', desc: '灵气充沛' }, { id: 'p2', name: '藏经阁', domain: '东域', desc: '藏书万卷' }] });
  const mv = M.VIEWS.renderMap(mpView, '');
  ok(mv.includes(zhCatalog['runtime.map.placesTitle']) && mv.includes('藏经阁'), '舆图页渲染地点名录');
  const mpOrder = M.CORE.blankState('v-map-order');
  mpOrder.map = { tracks: [{ id: 't1', time: '昨日', place: '山门', action: '入门' }, { id: 't2', time: '今日', place: '演武场', action: '晨练' }] };
  const mvOrder = M.VIEWS.renderMap(mpOrder, '');
  ok(mvOrder.indexOf('演武场') >= 0 && mvOrder.indexOf('演武场') < mvOrder.indexOf('山门'), '行踪按时间逆序渲染（最新在前）');
  const mvKw = M.VIEWS.renderMap(mpView, '藏书');
  ok(mvKw.includes('藏经阁') && !mvKw.includes('灵气充沛'), '地点名录按名称/描述过滤（当前位置保留）');
  const pv = M.VIEWS.renderPage(mpView, { app: 'map', view: 'root', params: {}, stack: [] }, {}, {}, 'player', M.CORE.blankPlayerState('pv'));
  ok(!pv.includes('藏经阁'), '玩家域舆图渲染玩家域数据源，不泄漏角色域地点名录');
  // 回归：无当前所在地但有行踪/地点时，hero 占位不得泄漏 "undefined" 字样。
  const mpNoCurrent = M.CORE.blankState('v-map-nocur');
  mpNoCurrent.map = { current: { place: '', domain: '', desc: '' }, tracks: [{ id: 't1', time: '今日', place: '演武场', action: '晨练' }], places: [] };
  const mvNoCurrent = M.VIEWS.renderMap(mpNoCurrent, '');
  ok(!/undefined/.test(mvNoCurrent), '无当前所在地时不渲染 undefined 占位');
  const mpPNoCurrent = M.CORE.blankPlayerState('v-map-pnocur');
  mpPNoCurrent.map = { current: { place: '', domain: '', desc: '' }, tracks: [{ id: 't1', time: '今日', place: '演武场', action: '晨练' }], places: [] };
  const pvNoCurrent = M.VIEWS.renderPage(mpNoCurrent, { app: 'map', view: 'root', params: {}, stack: [] }, {}, {}, 'player', mpPNoCurrent);
  ok(!/undefined/.test(pvNoCurrent), '玩家域舆图无当前所在地时不渲染 undefined 占位');
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
  eq(mk1.market.requests.length, 2, '求购区追加新求购');
  const mk2 = M.CORE.applySnapshot(mk1, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜mk2｜李逍遥｜改出价｜diff\n</yz_meta><yz_market>\n+request｜r1｜百年灵草｜下品｜急收｜9灵石｜炼丹师\n</yz_market></yz_jade>'), {}).state;
  eq(mk2.market.requests.find((r) => r.id === 'r1').price, '9灵石', '+request 按 id 整行替换');
  const mk3 = M.CORE.applySnapshot(mk2, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜mk3｜李逍遥｜撤一条｜diff\n</yz_meta><yz_market>\n-request｜r2\n</yz_market></yz_jade>'), {}).state;
  eq(mk3.market.requests.length, 1, '-request 删除指定求购');
  const mk4 = M.CORE.applySnapshot(mk3, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜mk4｜李逍遥｜撤光了｜diff\n</yz_meta><yz_market>\n-request｜r1\n</yz_market></yz_jade>'), {}).state;
  eq(mk4.market.requests.length, 1, '删空求购区被达标门禁拦截');

  // 达标：求购至少 1 条
  const mOk = M.CORE.assess({ version: 1, turn: { id: 't', roleName: 'r', summary: 's' }, market: mk3.market }, {});
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

  // 视图：求购 tab（公开数据，双域一致）展示与过滤
  const mkView = M.CORE.blankState('v-mk');
  mkView.market = M.CORE.normalizeMarket({ listings: [{ id: 'l1', name: '灵草', grade: '', desc: '', price: '10灵石', seller: '坊主' }], auctions: [], orders: [], requests: [{ id: 'r1', name: '百年灵草', grade: '下品', desc: '炼丹急用', price: '8灵石', author: '炼丹师' }] });
  const rv = M.VIEWS.renderMarket(mkView, { app: 'market', view: 'requests', params: {} }, '');
  ok(rv.includes(zhCatalog['runtime.tab.requests']) && rv.includes('炼丹急用'), '求购页渲染求购公告');
  ok(rv.includes('8灵石') && rv.includes('炼丹师'), '求购出价与求购人展示');
  const rvKw = M.VIEWS.renderMarket(mkView, { app: 'market', view: 'requests', params: {} }, '灵草');
  ok(rvKw.includes('炼丹师') && !rvKw.includes('坊主'), '求购按物品名/求购人过滤');
  const rvPlayer = M.VIEWS.renderPage(mkView, { app: 'market', view: 'requests', params: {}, stack: [] }, {}, {}, 'player', M.CORE.blankPlayerState('pv2'));
  ok(rvPlayer.includes('炼丹急用') && rvPlayer.includes(zhCatalog['runtime.player.publicTag']), '玩家域求购区为公开数据带标识');
  const rvOrders = M.VIEWS.renderMarket(mkView, { app: 'market', view: 'orders', params: {} }, '');
  ok(!rvOrders.includes('炼丹急用'), '求购内容不进订单页（tab 栏标签是导航，正常出现）');
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
    eq(rtU.current().forum.posts[0].unread, 4, '帖子 unread 随协议解析入库');
    await rtU.applyText('<yz_jade><yz_meta>\nturn｜u3｜李逍遥｜回复｜diff\n</yz_meta><yz_forum>\n+post｜p1｜李逍遥｜长老｜闲聊｜今日｜论剑改｜切磋改｜1\n</yz_forum></yz_jade>', 'chat-u', 'test');
    eq(rtU.current().forum.posts[0].unread, 4, 'diff 更新帖子内容保留 unread');
    // 列表渲染：有新回复的帖子置顶 + 光效
    const rF = M.VIEWS.renderPage(rtU.current(), { app: 'forum', view: 'root', params: {}, stack: [] }, {}, {}, 'character', rtU.playerCurrent());
    const fList = rF.slice(rF.indexOf('yz-page-list'), rF.indexOf('</main>'));
    ok(fList.includes('class="yz-row yz-unread-row"'), '未读帖子行带光效 class');
    ok(fList.indexOf('data-id="p1"') < fList.indexOf('data-id="p2"'), '未读帖子置顶');
    await rtU.applyText('<yz_jade><yz_meta>\nturn｜u4｜李逍遥｜已读｜diff\n</yz_meta><yz_forum>\n+post｜p1｜李逍遥｜长老｜闲聊｜今日｜论剑改｜切磋改｜1｜0\n</yz_forum></yz_jade>', 'chat-u', 'test');
    eq(rtU.current().forum.posts[0].unread, 0, 'diff 显式 unread=0 清零（已读处理回复）');
  }
  {
    // 评审加固：全量轮照抄基线时 pmc-* 评论被重编为 cm-N —— 双键去重防重复 + owner 认领
    const hostV = fakeHost();
    const rtV = M.createRuntime(hostV.api, null, () => ({}));
    await rtV.switchChat('chat-r2');
    await rtV.applyText(jade('r1', TABLET_OK + '<yz_forum>\npost｜p1｜李逍遥｜长老｜闲聊｜今日｜论剑｜切磋｜1\npost｜p2｜酒剑仙｜师尊｜闲聊｜今日｜对饮｜今夜｜2\ncomment｜p1｜林月如｜今日｜来观战\ncomment｜p2｜李逍遥｜今日｜好\n</yz_forum>'), 'chat-r2', 'test');
    rtV.sendPlayerComment('chat-r2', 'p1', '算我一个');
    await rtV.syncPlayerPosts('chat-r2');
    ok(rtV.current().forum.posts[0].comments.some((c) => c.id === 'pmc-1'), '玩家评论入库');
    // full 轮：模型照抄基线（评论行无 id），pmc-1 被解析器重编为 cm-N 副本
    await rtV.applyText(jade('r2', TABLET_OK + '<yz_forum>\npost｜p1｜李逍遥｜长老｜闲聊｜今日｜论剑｜切磋｜1\npost｜p2｜酒剑仙｜师尊｜闲聊｜今日｜对饮｜今夜｜2\ncomment｜p1｜林月如｜今日｜来观战\ncomment｜p1｜道友｜' + rtV.playerCurrent().myComments[0].time + '｜算我一个\ncomment｜p2｜李逍遥｜今日｜好\n</yz_forum>'), 'chat-r2', 'test');
    await rtV.syncPlayerPosts('chat-r2');
    const cs = rtV.current().forum.posts[0].comments;
    eq(cs.filter((c) => c.text === '算我一个').length, 1, '全量轮重编后不产生重复玩家评论');
    ok(cs.some((c) => c.owner === 'player' && c.text === '算我一个'), '重编副本被认领为玩家评论（owner 补回）');
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
  eq(fd1.forum.posts.find((p) => p.id === 'p1').title, '寻师', '模型 +post 改写玩家帖子被拒');
  const fd2 = M.CORE.applySnapshot(fd1, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜fd2｜李逍遥｜删帖｜diff\n</yz_meta><yz_forum>\n-post｜p1\n</yz_forum></yz_jade>'), {}).state;
  eq(fd2.forum.posts.length, 4, '模型 -post 删除玩家帖子被拒');
  const fd3 = M.CORE.applySnapshot(fd2, M.PROTOCOL.parse('<yz_jade><yz_meta>\nturn｜fd3｜李逍遥｜评论｜diff\n</yz_meta><yz_forum>\n+comment｜p1｜李逍遥｜今日｜我来指点\n</yz_forum></yz_jade>'), {}).state;
  eq(fd3.forum.posts.find((p) => p.id === 'p1').comments.length, 1, '模型可在玩家帖子下评论');

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
  ok(prZh.includes('owner 为 player 的帖子是玩家的真实发帖') && prZh.includes('可以用 +comment 行'), 'zh 玩家帖子保护规则');
  ok(M.PROMPT.buildPrompt('en', {}, { forceFull: true, current: [] }).includes('real posts by the player'), 'en 玩家帖子保护规则');
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

  // 强制集：玩家交互过的条目必定注入（不参与概率）
  st.chats.contacts.push({ id: M.CORE.PLAYER_CONTACT_ID, name: '道友', unread: 2, preview: '', messages: [{ id: 'pm-1', side: 'other', time: 'x', text: '在吗' }] });
  st.chats.contacts[0].unread = 3;
  st.chats.groups[0].messages.push({ id: 'pmg-1', sender: '道友', side: 'other', time: 'x', text: '我在' });
  st.chats.groups[1].unread = 4;
  st.forum.posts.push({ id: 'pm1', owner: 'player', author: '悦琳', title: '我的帖', body: 'x' });
  st.forum.posts[0].comments.push({ id: 'pmc-1', owner: 'player', author: '道友', time: 'x', text: '我的评论' });
  st.forum.posts[5].unread = 7;
  const cur3 = M.PROMPT.buildCurrent(st, {}, () => 0.42);
  const j3 = cur3.join('\n');
  ok(j3.includes('contact｜yz-player｜'), '玩家传讯联系人必定注入');
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

{
  // 有新回复（未读）的联系人/群聊：列表置顶 + 呼吸光效 class（双域一致）
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-unr');
  await rt.applyText(jade('u1', TABLET_OK + '<yz_msg>\ncontact｜c1｜林月如｜道侣｜今日｜0｜安好\ncontact｜c2｜酒剑仙｜师尊｜今日｜2｜饮酒\ncontact｜c3｜赵灵儿｜红颜｜今日｜0｜安好\nmsg｜c1｜m1｜other｜昨日｜勿念\nmsg｜c1｜m2｜self｜今日｜定当赴约\nmsg｜c2｜m3｜other｜今日｜来喝酒\nmsg｜c2｜m4｜other｜今日｜速来\nmsg｜c3｜m5｜other｜今日｜安好\nmsg｜c3｜m6｜other｜今日｜保重\ngroup｜g1｜青云内门｜30｜今日｜3｜集合\ngroup｜g2｜蜀山剑派｜12｜今日｜0｜静默\ngmsg｜g1｜gm1｜掌门｜other｜今日｜卯时议事\ngmsg｜g1｜gm2｜长老｜other｜今日｜不得迟到\ngmsg｜g2｜gm3｜掌门｜other｜今日｜安好\ngmsg｜g2｜gm4｜长老｜other｜今日｜保重\n</yz_msg>'), 'chat-unr', 'test');
  const rC = M.VIEWS.renderPage(rt.current(), { app: 'msg', view: 'chats', params: {}, stack: [] }, {}, {}, 'character', rt.playerCurrent());
  const listC = rC.slice(rC.indexOf('yz-page-list'), rC.indexOf('</main>'));
  ok(listC.indexOf('data-id="c2"') < listC.indexOf('data-id="c1"'), '未读联系人置顶');
  ok(listC.indexOf('data-id="c2"') < listC.indexOf('data-id="c3"'), '未读联系人排最上方');
  ok(listC.includes('class="yz-row yz-unread-row"'), '未读联系人行带光效 class');
  const rG = M.VIEWS.renderPage(rt.current(), { app: 'msg', view: 'groups', params: {}, stack: [] }, {}, {}, 'character', rt.playerCurrent());
  const gList = rG.slice(rG.indexOf('yz-page-list'), rG.indexOf('</main>'));
  ok(gList.indexOf('data-id="g1"') < gList.indexOf('data-id="g2"'), '未读群组置顶');
  const rPG = M.VIEWS.renderPage(rt.current(), { app: 'msg', view: 'groups', params: {}, stack: [] }, {}, {}, 'player', rt.playerCurrent());
  ok(rPG.includes('class="yz-row yz-unread-row"'), '玩家域群组列表同样带光效 class');
}

{
  // 运行时：创建/校验/镜像/幂等/对账/删除
  const ph = fakeHost();
  const prt = M.createRuntime(ph.api, null, () => ({}));
  await prt.switchChat('chat-1');
  eq((await prt.playerSaveEntity('post', { title: '寻师', section: '闲聊', body: '求指点' }, '')).ok, true, '创建帖子成功');
  eq(prt.playerCurrent().forum.posts[0].id, 'fp-1', '帖子 id 从 fp-1 开始');
  eq(prt.playerCurrent().forum.posts[0].owner, 'player', '玩家域帖子 owner=player');
  eq(prt.playerSaveEntity('post', { title: '', body: 'x' }, '').reason, 'title', '空标题拒绝');
  eq((await prt.playerSaveEntity('post', { title: '寻师改', body: '改文' }, 'fp-1')).ok, true, '编辑帖子成功');
  eq(prt.playerCurrent().forum.posts[0].body, '改文', '帖子正文已更新');

  // 镜像：角色域出现玩家帖子，作者名回填（无 persona 时回退 catalog 名）
  await prt.syncPlayerPosts('chat-1');
  const cp = prt.current().forum.posts.find((p) => p.id === 'fp-1');
  ok(!!cp && cp.owner === 'player', '镜像进角色域论坛');
  eq(cp.author, zhCatalog['runtime.player.fallbackName'], '作者名回填玩家名');
  await prt.syncPlayerPosts('chat-1');
  eq(prt.current().forum.posts.filter((p) => p.id === 'fp-1').length, 1, '重复镜像幂等不产生副本');

  // 对账：全量轮模型漏写玩家帖子 → applyText 后的自动镜像按玩家域补回
  const fullNoPlayer = '<yz_jade><yz_meta>\nturn｜pp1｜李逍遥｜全量\n</yz_meta><yz_forum>\npost｜c1｜李逍遥｜长老｜闲聊｜今日｜论剑｜切磋｜1\npost｜c2｜李逍遥｜长老｜闲聊｜今日｜论道｜坐而论道｜1\ncomment｜c1｜长老｜今日｜好\ncomment｜c2｜弟子｜今日｜善\n</yz_forum></yz_jade>';
  const pp1 = await prt.applyText(fullNoPlayer, 'chat-1', 'test');
  const restored = prt.current().forum.posts.find((p) => p.id === 'fp-1');
  ok(!!restored && restored.owner === 'player' && restored.body === '改文', '全量轮后自动镜像按玩家域补回被覆盖的帖子');
  ok(prt.current().forum.posts.some((p) => p.id === 'c1'), '角色自己的帖子保留');
  // 模型改写过玩家帖子（带 id 无 owner）→ diff 保护拒改，评论允许
  const pp2 = await prt.applyText('<yz_jade><yz_meta>\nturn｜pp2｜李逍遥｜重写\n</yz_meta><yz_forum>\n+post｜fp-1｜李逍遥｜长老｜闲聊｜今日｜被模型写｜恶意｜0\n+comment｜fp-1｜李逍遥｜今日｜指点\n</yz_forum></yz_jade>', 'chat-1', 'test');
  const afterPp2 = prt.current().forum.posts.find((p) => p.id === 'fp-1');
  eq(afterPp2.owner, 'player', '模型改写不剥落 owner 标记');
  eq(afterPp2.title, '寻师改', '模型 +post 改写玩家帖子被拒');
  eq(afterPp2.comments.length, 1, '角色侧评论保留');

  // 删除：玩家域删帖后角色域同步移除
  eq(prt.playerDeleteEntity('post', 'fp-1').ok, true, '删除玩家帖子');
  await prt.syncPlayerPosts('chat-1');
  ok(!prt.current().forum.posts.some((p) => p.id === 'fp-1'), '角色域同步移除已删帖子');
  eq(prt.playerDeleteEntity('post', 'fp-1').ok, false, '重复删除报 missing');

  // {{user}} persona 解析：有 persona 时作者名用 persona.name
  const ph2 = fakeHost();
  ph2.api.chat.current = async () => ({ id: ph2.current.chat, persona: { name: '悦琳' } });
  const prt2 = M.createRuntime(ph2.api, null, () => ({}));
  await prt2.switchChat('chat-1');
  await prt2.playerSaveEntity('post', { title: '寻师', body: '求指点' }, '');
  await prt2.syncPlayerPosts('chat-1');
  eq(prt2.current().forum.posts.find((p) => p.owner === 'player').author, '悦琳', '作者名 = {{user}}（persona.name）');

  // 封印论坛：镜像不工作
  const ph3 = fakeHost();
  const prt3 = M.createRuntime(ph3.api, null, () => ({ forum: false }));
  await prt3.switchChat('chat-1');
  await prt3.playerSaveEntity('post', { title: '寻师', body: '求指点' }, '');
  await prt3.syncPlayerPosts('chat-1');
  eq(prt3.current().forum.posts.length, 0, '封印论坛后玩家帖子不镜像角色域');

  // 我的帖子被评论的未读信号：角色侧新评论 → 镜像后玩家帖 unread +1；打开详情清零。
  const pu4 = fakeHost();
  const prt4 = M.createRuntime(pu4.api, null, () => ({}));
  await prt4.switchChat('chat-unread');
  await prt4.playerSaveEntity('post', { title: '求指点', body: '如何炼气' }, '');
  await prt4.syncPlayerPosts('chat-unread');
  eq(prt4.playerCurrent().forum.posts[0].unread, 0, '新帖初始未读为 0');
  // 角色论坛先达标（2 帖各有评论），再以 diff 轮在玩家帖上回复
  const fu = await prt4.applyText(jade('f0', TABLET_OK + MSG_MIN + '<yz_forum>\npost｜c1｜李逍遥｜长老｜闲聊｜今日｜论剑｜切磋｜1\ncomment｜c1｜长老｜今日｜好\npost｜c2｜林月如｜弟子｜闲聊｜今日｜论道｜坐而论道｜1\ncomment｜c2｜弟子｜今日｜善\n</yz_forum>'), 'chat-unread', 'test');
  eq(fu.changed, true, '角色论坛达标轮应用成功');
  const puTurn = await prt4.applyText(jade('u1', TABLET_OK + MSG_MIN + '<yz_forum>\n+comment｜fp-1｜李逍遥｜今日｜心法要义\n</yz_forum>'), 'chat-unread', 'test');
  eq(puTurn.changed, true, '模型评论轮次应用成功');
  await prt4.syncPlayerPosts('chat-unread');
  eq(prt4.playerCurrent().forum.posts[0].unread, 1, '角色新评论镜像后玩家帖未读为 1');
  eq(prt4.current().forum.posts.find((p) => p.id === 'fp-1').unread, 1, '角色域行同步未读');
  // 打开详情清零（客户端推进 seen 游标）→ 再镜像不重复计
  prt4.markPostRead('fp-1');
  await prt4.syncPlayerPosts('chat-unread');
  eq(prt4.playerCurrent().forum.posts[0].unread, 0, '打开详情后未读清零且不复发');
  await prt4.applyText(jade('u2', TABLET_OK + MSG_MIN + '<yz_forum>\n+comment｜fp-1｜李逍遥｜今日｜第二解\n</yz_forum>'), 'chat-unread', 'test');
  await prt4.syncPlayerPosts('chat-unread');
  eq(prt4.playerCurrent().forum.posts[0].unread, 1, '新评论再次镜像未读 +1');
}

{
  // 视图：玩家域论坛 CTA/标记/编辑按钮；角色域无 CRUD 控件；表单路由
  const fcs = M.CORE.blankState('v-forum');
  fcs.sync = { status: 'complete', roleName: '李逍遥', summary: 's', applied: [], appliedSeen: [], issues: [], updatedAt: 1 };
  fcs.forum = M.CORE.normalizeForum({ posts: [{ id: 'fp-1', owner: 'player', author: '悦琳', title: '寻师', body: '求指点', time: '今日', comments: [] }, { id: 'c1', author: '李逍遥', title: '论剑', body: '切磋', time: '今日', comments: [] }] });
  const fps = M.CORE.blankPlayerState('v-forum');
  fps.forum = M.CORE.normalizeForum({ posts: [{ id: 'fp-1', owner: 'player', author: '悦琳', title: '寻师', body: '求指点', time: '今日', comments: [] }] });

  const pList = M.VIEWS.renderPage(fcs, { app: 'forum', view: 'root', params: {}, stack: [] }, {}, {}, 'player', fps);
  ok(pList.includes('data-action="player-new"') && pList.includes('data-kind="post"'), '玩家域论坛有发帖 CTA');
  ok(pList.includes('data-action="player-edit"') && pList.includes('data-id="fp-1"'), '玩家帖子行尾有编辑按钮');
  ok(pList.includes(zhCatalog['runtime.player.postTag']), '玩家帖子带身份标记');
  const cList = M.VIEWS.renderPage(fcs, { app: 'forum', view: 'root', params: {}, stack: [] }, {}, {}, 'character', fps);
  ok(!cList.includes('data-action="player-edit"') && !cList.includes('data-action="player-new"'), '角色域论坛无 CRUD 控件');
  ok(cList.includes(zhCatalog['runtime.player.postTag']), '玩家帖子身份标记双域一致（与基线 owner 字段同语义）');

  // 详情页：玩家帖子可编辑入口；角色帖子无
  const pDetail = M.VIEWS.renderPage(fcs, { app: 'forum', view: 'post', params: { id: 'fp-1' }, stack: [] }, {}, {}, 'player', fps);
  ok(pDetail.includes('data-action="player-edit"') && pDetail.includes('data-id="fp-1"'), '玩家帖子详情有编辑入口');
  const cDetail = M.VIEWS.renderPage(fcs, { app: 'forum', view: 'post', params: { id: 'c1' }, stack: [] }, {}, {}, 'player', fps);
  ok(!cDetail.includes('data-action="player-edit"'), '角色帖子详情无编辑入口');

  // 表单页：post 字段预填 + 新建无预填
  const form = M.VIEWS.renderPage(fcs, { app: 'forum', view: 'form', params: { kind: 'post', id: 'fp-1' }, stack: [] }, {}, {}, 'player', fps);
  ok(form.includes('value="寻师"') && form.includes(zhCatalog['runtime.player.fieldSection']), '发帖表单预填标题与版块');
  const newForm = M.VIEWS.renderPage(fcs, { app: 'forum', view: 'form', params: { kind: 'post' }, stack: [] }, {}, {}, 'player', fps);
  ok(newForm.includes('data-marker="player-form"') && !newForm.includes('value="寻师"'), '新建发帖表单无预填');
  const cForm = M.VIEWS.renderPage(fcs, { app: 'forum', view: 'form', params: { kind: 'post' }, stack: [] }, {}, {}, 'character', fps);
  ok(!cForm.includes('data-marker="player-form"'), '角色域论坛不渲染发帖表单');
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
  // 用户可控字段（正文/名字/评论/描述）注入 HTML/属性载荷后，任何渲染路径都不得
  // 输出未转义原文——防止误删 escapeHtml 后测试仍全绿。
  const hostile = '<script>alert(1)</script>';
  const quote = '"><img src=x onerror=alert(1)>';
  const st = M.CORE.blankState('x1');
  st.sync = { status: 'complete', roleName: '李逍遥', summary: 's', applied: [], appliedSeen: [], issues: [], updatedAt: 1 };
  st.chats = M.CORE.normalizeChats({ contacts: [{ id: 'c1', name: hostile, messages: [{ id: 'm1', side: 'other', text: quote }] }], groups: [] });
  st.forum = M.CORE.normalizeForum({ posts: [{ id: 'p1', author: hostile, title: hostile, body: quote, comments: [{ id: 'cm1', author: hostile, text: quote }] }] });
  st.market = M.CORE.normalizeMarket({ listings: [{ id: 'l1', name: hostile, desc: quote }], auctions: [], orders: [], requests: [{ id: 'r1', name: hostile, desc: quote }] });
  st.space = M.CORE.normalizeSpace({ currencies: [], items: [{ id: 'i1', name: hostile, desc: quote, qty: 1 }] });
  st.map = M.CORE.normalizeMap({ current: { place: hostile }, tracks: [], places: [{ id: 'pl1', name: hostile, desc: quote }] });
  const stHtml = [
    M.VIEWS.renderHome(st, {}),
    M.VIEWS.renderMsg(st, { app: 'msg', view: 'chats', params: {}, stack: [] }, ''),
    M.VIEWS.renderForum(st, { app: 'forum', view: 'root', params: {}, stack: [] }, '', '', false),
    M.VIEWS.renderMarket(st, { app: 'market', view: 'root', params: {}, stack: [] }, '', '', false),
    M.VIEWS.renderSpace(st, { app: 'space', view: 'root', params: {}, stack: [] }, ''),
    M.VIEWS.renderMap(st, { app: 'map', view: 'root', params: {}, stack: [] }, '')
  ].join('\n');
  // escapeHtml 只转义 <>&\"：转义后的文本仍含 onerror= 字样，断言须盯原始标签形态
  //（<script> / <img 出现即未转义，&lt; 前缀说明已转义）。
  ok(!stHtml.includes('<script>') && !stHtml.includes('<img') && !stHtml.includes('"><img'), '恶意载荷不得以未转义标签出现');
  ok(stHtml.includes('&lt;script&gt;') && stHtml.includes('&quot;'), '恶意载荷均被转义');
}
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
  rt.playerSaveEntity('currency', { kind: '灵石', amount: '10' }, '');
  const failKind = rt.playerSaveEntity('currency', { kind: '灵石', amount: '20' }, '妖丹');
  ok(failKind && failKind.ok === false, '货币重命名撞已有种类被拒绝');
  eq(rt.playerCurrent().space.currencies.filter((c) => c.kind === '灵石').length, 1, '撞种类后无重复行');
  rt.playerSaveEntity('folder', { name: '玉册夹' }, '');
  const failFolder = rt.playerSaveEntity('folder', { name: '' }, 'pf-1');
  ok(failFolder && failFolder.ok === false, '文件夹改名空名被拒绝');
  ok(rt.playerCurrent().notes.folders.some((f) => f.name === '玉册夹'), '失败路径不产生空名文件夹（无级联删除）');
}
{
  // 评审加固：diffChats 对 yz-player 的只读防护（可回复、不可删/伪造/改写玩家消息）
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-guard');
  await rt.applyText(jade('g0', GUARD_FULL), 'chat-guard', 'test');
  rt.sendPlayerMessage('chat-guard', '在吗');
  await rt.syncPlayerChannel('chat-guard');
  await rt.applyText(jade('g2', '<yz_msg>\n+msg｜yz-player｜r1｜self｜丙午年五月十二 午时｜在的\n+msg｜yz-player｜pm-2｜other｜今日｜伪造\n-msg｜yz-player｜pm-1\n+msg｜yz-player｜pm-1｜self｜今日｜改写\n</yz_msg>'), 'chat-guard', 'test');
  const gc = rt.current().chats.contacts.find((c) => c.id === M.CORE.PLAYER_CONTACT_ID);
  ok(gc.messages.some((m) => m.id === 'r1' && m.side === 'self'), '模型可追加自己的回复');
  ok(!gc.messages.some((m) => m.id === 'pm-2'), '伪造玩家侧消息被拒');
  ok(gc.messages.some((m) => m.id === 'pm-1' && m.side === 'other' && m.text === '在吗'), '玩家消息不可被删/改写');
}
{
  // 评审加固：parse 空判定含求购/地点；导出超限面板拦截
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
  const manage = M.VIEWS.renderManage(bigState, {}, { dataPanel: 'export' });
  ok(manage.includes(zhCatalog['runtime.manage.exportTooBig']), '导出超限显示拦截提示');
  ok(!manage.includes('data-export-output'), '导出超限不渲染可复制面板');
}
{
  // 评审加固：传讯通道消息超过 20 条后镜像幂等且保尾（此前头部切片导致重复推送）
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-20');
  for (let i = 1; i <= 22; i += 1) rt.sendPlayerMessage('chat-20', '消息' + i);
  await rt.syncPlayerChannel('chat-20');
  const pc = rt.current().chats.contacts.find((c) => c.id === M.CORE.PLAYER_CONTACT_ID);
  eq(pc.messages.length, 20, '镜像后联系人线程保尾 20 条');
  await rt.syncPlayerChannel('chat-20');
  eq(rt.current().chats.contacts.find((c) => c.id === M.CORE.PLAYER_CONTACT_ID).messages.length, 20, '超 20 条后重复同步不再膨胀');
  const ids = new Set(rt.current().chats.contacts.find((c) => c.id === M.CORE.PLAYER_CONTACT_ID).messages.map((m) => m.id));
  eq(ids.size, 20, '镜像消息 id 无重复');
  rt.markPlayerRead('chat-20');
  eq(rt.current().sync.playerReadCursor, 22, '已读游标扫全量（非头部切片）');
  eq(rt.current().chats.contacts.find((c) => c.id === M.CORE.PLAYER_CONTACT_ID).unread, 0, '全量消息未读清零');
}

{
  // 评审加固：镜像/世界书 tie-break——revision 平局时取更新时间更新的镜像，
  // 陈旧世界书快照不得覆盖新镜像（rev-0 聊天 + 切走后 save 只落镜像的场景）
  const host = fakeHost();
  host.current.chat = 'chat-tie';
  const store = new Map();
  const local = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  const staleWorld = M.CORE.normalizeState(M.CORE.blankState('chat-tie'), 'chat-tie');
  staleWorld.revision = 5;
  staleWorld.sync = { status: 'complete', roleName: '李逍遥', summary: '旧', applied: [], appliedSeen: [], issues: [], updatedAt: 100 };
  host.seedBook('玉兆档案·chat-tie', [{ identifier: 'yz-snap-1', name: '玉兆快照', enabled: false, content: JSON.stringify({ v: 2, ver: M.PLUGIN_VERSION, rev: 5, updatedAt: 100, kind: 'role', index: 1, total: 1, body: JSON.stringify(staleWorld) }) }]);
  const freshMirror = JSON.parse(JSON.stringify(staleWorld));
  freshMirror.sync.summary = '新';
  freshMirror.sync.updatedAt = 200;
  store.set('yz-jade-v1:chat-tie', JSON.stringify(freshMirror));
  const rt = M.createRuntime(host.api, local, () => ({}));
  await rt.switchChat('chat-tie');
  eq(rt.current().sync.summary, '新', 'revision 平局时更新的镜像胜出');
  eq(rt.current().sync.updatedAt, 200, '镜像数据未被陈旧世界书覆盖');
  await flushWorld();
  const healed = host.lorebooks().find((b) => b.name === '玉兆档案·chat-tie');
  const healedWrap = JSON.parse(healed.entries.find((e) => e.identifier === 'yz-snap-1').content);
  eq(JSON.parse(healedWrap.body).sync.summary, '新', '世界书被镜像数据治愈（回写）');
}

{
  // 评审加固：玩家帖 id 撞角色帖 → 双方同步改名（fp-<n> 找空位），角色帖保留
  const host = fakeHost();
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-collide');
  await rt.applyText(jade('y1', TABLET_OK + MSG_MIN + '<yz_forum>\npost｜fp-2｜掌门｜长老｜公告｜今日｜角色帖｜内容｜3\ncomment｜fp-2｜长老｜今日｜已知\npost｜p2｜长老｜长老｜闲聊｜昨日｜论剑｜切磋记录｜1\ncomment｜p2｜弟子｜昨日｜围观\n</yz_forum>'), 'chat-collide', 'test');
  await rt.playerSaveEntity('post', { title: '一帖', body: 'b' }, '');
  await rt.playerSaveEntity('post', { title: '二帖', body: 'b' }, '');
  await rt.syncPlayerPosts('chat-collide');
  const rolePost = rt.current().forum.posts.find((p) => p.id === 'fp-2');
  const playerIds = rt.current().forum.posts.filter((p) => p.owner === 'player').map((p) => p.id);
  ok(!!rolePost && rolePost.title === '角色帖', '撞车后角色帖未被覆盖');
  ok(playerIds.length === 2 && playerIds.every((id) => id !== 'fp-2'), '玩家帖改名避让（' + playerIds.join(',') + '）');
}
{
  // 评审加固：镜像 await 后的陈旧快照不得覆盖新轮次（双通道交错竞态）
  let gate;
  const gatePromise = new Promise((r) => { gate = r; });
  let ccalls = 0;
  const host = {
    current: { chat: 'chat-race' },
    api: {
      get: () => null, set: () => {},
      chat: { current: async () => { ccalls += 1; if (ccalls === 3) await gatePromise; return { id: 'chat-race' }; }, update: async () => {} },
      message: { find: async () => [] }, lorebook: {}
    }
  };
  const rt = M.createRuntime(host.api, null, () => ({}));
  await rt.switchChat('chat-race');
  const player = rt.playerCurrent();
  player.forum = M.CORE.normalizeForum({ posts: [{ id: 'fp-1', owner: 'player', title: '寻师改', body: '改文', comments: [] }] });
  player.updatedAt = Date.now();
  const syncing = rt.syncPlayerPosts('chat-race');
  await rt.applyText(jade('x2', TABLET_OK + MSG_MIN + '<yz_forum>\npost｜p1｜掌门｜长老｜公告｜今日｜议事｜卯时集合｜3\ncomment｜p1｜长老｜今日｜已知\npost｜p2｜长老｜长老｜闲聊｜昨日｜论剑｜切磋记录｜1\ncomment｜p2｜弟子｜昨日｜围观\n</yz_forum>'), 'chat-race', 'test');
  gate();
  await syncing;
  ok(rt.current().forum.posts.some((p) => p.id === 'p2'), '陈旧镜像不覆盖新轮次（新帖保留）');
  ok(!!rt.current().forum.posts.find((p) => p.id === 'fp-1'), '玩家帖子仍镜像在场');
}

// ---------- 结果 ----------
console.log('');
if (failures.length) {
  console.error(`冒烟失败 ${failures.length} 项 / 通过 ${passed} 项`);
  process.exit(1);
} else {
  console.log(`冒烟全部通过：${passed} 项`);
}
