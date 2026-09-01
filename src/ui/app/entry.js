  var OVERLAY_ID = 'yz1-overlay';
  var JADE_ID = 'yz1-jade';
  var FAB_ID = 'yz1-fab';
  var POS_KEY = 'yz_fab_position';
  var FEATURES_KEY = 'yz_features';

  // 悬浮入口默认贴边距离：CSS 初始位置与复位逻辑必须共用这两个常量，
  // 保证「复位」回到的位置就是初始位置，且远离宿主输入区（bottom 取值需真机复核）。
  var FAB_MARGIN_RIGHT = 16;
  var FAB_MARGIN_BOTTOM = 96;

  // Static UI markup and CSS are provided by the ui/jade.html fragment.

  function containsEnvelope(value) {
    return /<yz_[a-z0-9_]+\b/i.test(String(value == null ? '' : value));
  }

  function pickEnvelopePayload(event) {
    event = event || {};
    var text = String(event.text == null ? '' : event.text);
    var content = String(event.content == null ? '' : event.content);
    if (containsEnvelope(text)) return text;
    if (containsEnvelope(content)) return content;
    return text || content;
  }

  function stripEventFields(event) {
    if (!event || typeof event !== 'object') return event;
    // 宿主事件可能同时携带 text/content，协议择优解析后两个字段都必须剥离，
    // 否则另一个字段会在消息落盘或 DOM 渲染时把协议残片带回来。
    ['text', 'content'].forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(event, key) || event[key] == null) return;
      var raw = String(event[key]);
      var visible = PROTOCOL.stripBlocks(raw);
      if (!visible && containsEnvelope(raw)) visible = I18N.dict().stripFallback;
      event[key] = visible;
    });
    return event;
  }

  function create(options) {
    options = options || {};
    var tavoApi = options.tavo;
    var localDocument = options.document;
    var localWindow = options.window;
    if (!tavoApi || !localDocument || !localWindow) throw new Error('yu zhao dependencies missing');

    var hostWindow, hostDocument;
    // 玉兆为全屏 overlay 型法器 UI，需覆盖整个视口而非局限于消息流内；
    // 宿主若把插件脚本放进 iframe，则挂载到顶层文档，失败时回退当前文档。
    try {
      hostWindow = localWindow.top && localWindow.top.document ? localWindow.top : localWindow;
      hostDocument = hostWindow.document;
    } catch (_) {
      hostWindow = localWindow;
      hostDocument = localDocument;
    }

    var disposed = false;
    var appOwner = {};
    var appCleanups = [];
    var appTimeouts = [];
    var appIntervals = [];
    var busyActions = Object.create(null);
    function listen(target, type, handler, options) {
      if (disposed || !target || typeof target.addEventListener !== 'function') return function () {};
      target.addEventListener(type, handler, options);
      var active = true;
      var remove = function () {
        if (!active) return;
        active = false;
        try { target.removeEventListener(type, handler, options); } catch (_) {}
      };
      appCleanups.push(remove);
      return remove;
    }
    function onCleanup(fn) {
      if (typeof fn === 'function') appCleanups.push(fn);
      return fn;
    }
    function setAppTimeout(fn, delay) {
      var timer = setTimeout(function () {
        var index = appTimeouts.indexOf(timer);
        if (index >= 0) appTimeouts.splice(index, 1);
        if (!disposed) fn();
      }, delay);
      appTimeouts.push(timer);
      return timer;
    }
    function setAppInterval(fn, delay) {
      var timer = setInterval(function () { if (!disposed) fn(); }, delay);
      appIntervals.push(timer);
      return timer;
    }
    function clearAppTimeout(timer) {
      if (timer == null) return;
      clearTimeout(timer);
      var index = appTimeouts.indexOf(timer);
      if (index >= 0) appTimeouts.splice(index, 1);
    }
    function clearAppInterval(timer) {
      if (timer == null) return;
      clearInterval(timer);
      var index = appIntervals.indexOf(timer);
      if (index >= 0) appIntervals.splice(index, 1);
    }
    function markBound(node) {
      if (!node) return;
      onCleanup(function () { if (node.__yzBound) delete node.__yzBound; });
    }
    function clearAppTimers() {
      appTimeouts.slice().forEach(clearAppTimeout);
      appIntervals.slice().forEach(clearAppInterval);
      appTimeouts = [];
      appIntervals = [];
    }
    function clearAppCleanups() {
      var cleanups = appCleanups.slice().reverse();
      appCleanups = [];
      cleanups.forEach(function (fn) { try { fn(); } catch (_) {} });
    }
    var runtime = options.runtime || RUNTIME.createRuntime(tavoApi, hostWindow && hostWindow.localStorage, function () { return featureFlags; }, {
      window: hostWindow,
      notice: function (reason) {
        if (disposed) return;
        if (reason === 'stateChanged') return setAppTimeout(render, 0);
         if (reason === 'snapshotCorrupted') return showToast(I18N.dict().toast.snapshotCorrupted, true);
         if (reason === 'storageCorrupted') return showToast(I18N.dict().toast.storageCorrupted, true);
        if (reason === 'syncConflict') return showToast(I18N.dict().toast.syncConflict, true);
        if (reason === 'persistenceFailed') return showToast(I18N.dict().toast.persistenceFailed, true);
        }
      });
    function dispose() {
      if (disposed) return;
      disposed = true;
      ++openEpoch;
      clearAppTimeout(wipeTimer);
      wipeTimer = 0;
      if (typeof stopWipeCountdown === 'function') stopWipeCountdown();
      if (typeof clearToast === 'function') clearToast();
      if (typeof hideConfirm === 'function') hideConfirm();
      toastAction = null;
      drag = null;
      if (featureChannel) {
        try { featureChannel.onmessage = null; } catch (_) {}
        try { featureChannel.close(); } catch (_) {}
        featureChannel = null;
      }
      if (runtime && typeof runtime.dispose === 'function') { try { runtime.dispose(); } catch (_) {} }
      if (uiObserver) { try { uiObserver.disconnect(); } catch (_) {} uiObserver = null; }
      clearAppTimers();
      clearAppCleanups();
      var overlay = hostDocument && hostDocument.getElementById ? hostDocument.getElementById(OVERLAY_ID) : null;
      if (overlay && overlay.__yzLoadingOwner === appOwner) {
        overlay.classList.remove('loading');
        overlay.setAttribute('aria-busy', 'false');
        var jade = overlay.querySelector('#' + JADE_ID);
        if (jade) jade.inert = false;
        delete overlay.__yzLoadingOwner;
      }
      Object.keys(busyActions).forEach(function (key) {
        busyActions[key].nodes.forEach(function (node) { setBusyNode(node, false); });
      });
      busyActions = Object.create(null);
    }
    I18N.setTranslator(makeTranslator(tavoApi));
    var started = false;
    var hookHandlers = null;
    var toastTimer = 0;
    // toast 内嵌操作按钮的回调（撤销删除等）：showToast 注册，点击后执行一次并清空。
    var toastAction = null;
    var drag = null;
    var suppressClickUntil = 0;
    // 是否处于聊天会话中：chat:opened 置真、chat:closed 置假。
    // 宿主没有「当前路由是否为聊天页」的查询 API，这是控制 FAB 只在聊天内显示的唯一信号。
    var chatActive = false;
    var discardedEnvelopeHashes = Object.create(null);
    // overlay 开关 epoch：open() 是异步的，用户快速关闭后异步完成会重新 addClass('open')。
    // 递增 epoch 后 async 完成时校验未变则 abort，防止 overlay 意外重开。
    var openEpoch = 0;
    var featureFlags = {};
    var featureSaveQueue = Promise.resolve();
    var featureRevision = 0;
    var featureWriterId = 'feature-' + CORE.stableHash(String(Date.now()) + ':' + String(Math.random()));
    var featureLastWriter = '';
    var featureChannel = null;
    var featureSyncReady = false;
    var uiObserver = null;
    VIEWS.FEATURES.forEach(function (feature) { if (feature.toggleable) featureFlags[feature.id] = true; });
    var nav = { app: 'home', view: 'root', params: {}, stack: [] };
    // 封印切换后的内存强制全量标记：toggle 时置位，成功应用一轮 full 后清除。
    // 同语义的持久化标记在 state.pendingFull（重启不丢，见 toggleFeature）。
    var flagsDirty = false;
    // 管理页瞬态 UI 状态：诊断折叠区展开、导出/导入面板、两击清空确认（3 秒超时）。
    var diagOpen = false;
    var dataPanel = null;
    var armedWipe = null;
    // 玉牌各组的折叠偏好只属于界面，不写入空间快照或提示词。
    var tabletOpenGroups = null;
    // 快照恢复的 in-flight 锁：rebuildFromHistory 是异步的，连点两次会触发第二次
    // stale 分支、报误导性的「聊天已切换」红 toast——进行中再点直接忽略。
    var restoreBusy = false;
    var wipeTimer = 0;
    // 列表页/详情页检索关键词：纯内存过滤瞬态，任何导航（含关闭）都复位。
    var search = '';
    // 关闭玉兆时记录离开位置（本会话内再打开恢复；chat:opened 换聊天后清空回主页）。
    // 空间选择持久化在 state.activeSpaceId（每聊天独立），不再需要会话内域记忆。
    var savedNav = null;

    // 每轮生成只接受 prepare 时捕获的清除 epoch。匿名请求也单独保存聊天级上下文，
    // 但清除发生后没有稳定请求 ID 的 success 永远保守丢弃，不能绕过清除保护。
    var generationContexts = Object.create(null);
    var anonymousGenerationCounts = Object.create(null);
    var clearEpochByChat = Object.create(null);

    function generationContextKey(chatId, generationId) {
      return String(chatId || '') + '|' + String(generationId || '');
    }

    function clearGenerationContexts(chatId) {
      var prefix = String(chatId || '') + '|';
      Object.keys(generationContexts).forEach(function (key) {
        if (key.indexOf(prefix) === 0) delete generationContexts[key];
      });
      delete anonymousGenerationCounts[String(chatId || '')];
      discardedEnvelopeHashes = Object.create(null);
    }

    function saveGenerationContext(chatId, generationId, token, visibility) {
      var context = { chatId: String(chatId || ''), generationId: String(generationId || ''), token: token, visibility: visibility };
      generationContexts[generationContextKey(chatId, generationId)] = context;
      if (!generationId) {
        var id = String(chatId || '');
        anonymousGenerationCounts[id] = (anonymousGenerationCounts[id] || 0) + 1;
        // An anonymous success is safe only while exactly one anonymous prepare is pending.
        if (anonymousGenerationCounts[id] === 1) generationContexts[generationContextKey(chatId, '')] = context;
        else delete generationContexts[generationContextKey(chatId, '')];
      }
      return context;
    }

    function getGenerationContext(chatId, generationId) {
      return generationContexts[generationContextKey(chatId, generationId)] || null;
    }

    function consumeGenerationContext(context, anonymousOnly) {
      if (!context) return;
      var exact = generationContextKey(context.chatId, context.generationId);
      var anonymous = generationContextKey(context.chatId, '');
      if (!anonymousOnly && generationContexts[exact] === context) delete generationContexts[exact];
      if (generationContexts[anonymous] === context) delete generationContexts[anonymous];
      if (!context.generationId) {
        var id = String(context.chatId || '');
        delete anonymousGenerationCounts[id];
      }
    }

    function captureGenerationToken(chatId) {
      if (!runtime || typeof runtime.generationToken !== 'function') return null;
      try { return runtime.generationToken(chatId); } catch (_) { return null; }
    }

    function beginClearProtection(chatId) {
      if (!runtime || typeof runtime.beginClear !== 'function') return { ok: false, reason: 'unsupported' };
      var result;
      try { result = runtime.beginClear(chatId); } catch (error) { dbg('begin clear failed', error); return { ok: false, reason: 'failed' }; }
      if (!result || result.ok === false) return result || { ok: false, reason: 'failed' };
      var id = String(chatId || runtime.activeChatId || '');
      clearEpochByChat[id] = Number(result.epoch) || 0;
      clearGenerationContexts(id);
      discardedEnvelopeHashes = Object.create(null);
      return result;
    }

    // data-actions.js 是独立拼接段，清除函数本身不能依赖另一个模块的调用顺序；
    // 在 App 创建时包装它们，确保任何实际状态变更前都先推进 Runtime 清除 epoch。
    function installClearProtection() {
      if (typeof clearFeatureData === 'function') {
        var clearFeature = clearFeatureData;
        clearFeatureData = function (featureId) {
          if (!CORE.blankFeatureField(featureId)) return;
          var result = beginClearProtection(runtime.activeChatId);
          if (!result || result.ok === false) { showToast(I18N.dict().toast.persistenceFailed, true); return; }
          return clearFeature(featureId);
        };
      }
      if (typeof clearAllData === 'function') {
        var clearAll = clearAllData;
        clearAllData = function () {
          var result = beginClearProtection(runtime.activeChatId);
          if (!result || result.ok === false) { showToast(I18N.dict().toast.persistenceFailed, true); return; }
          return clearAll();
        };
      }
    }

    function captureUiContext() {
      var params = nav.params || {};
      var space = runtime && typeof runtime.activeSpace === 'function' ? runtime.activeSpace() : null;
      return {
        chatId: String(runtime.activeChatId || ''),
        spaceId: String(space && space.id || ''),
        app: String(nav.app || ''),
        view: String(nav.view || ''),
        id: String(params.id || '')
      };
    }

    function uiContextMatches(context) {
      if (disposed || !context || String(runtime.activeChatId || '') !== context.chatId) return false;
      var current = captureUiContext();
      return current.spaceId === context.spaceId && current.app === context.app && current.view === context.view && current.id === context.id;
    }

    function setBusyNode(node, busy) {
      if (!node) return;
      if (busy) node.setAttribute('data-busy', 'true');
      else node.removeAttribute('data-busy');
      if ('disabled' in node) node.disabled = !!busy;
    }

    function beginBusy(key, nodes) {
      if (!key || busyActions[key]) return null;
      var item = { key: key, nodes: nodes || [] };
      busyActions[key] = item;
      item.nodes.forEach(function (node) { setBusyNode(node, true); });
      return item;
    }

    function endBusy(item) {
      if (!item || busyActions[item.key] !== item) return;
      delete busyActions[item.key];
      item.nodes.forEach(function (node) { setBusyNode(node, false); });
      syncBusyUi();
    }

    function busyKey(kind, id) {
      var space = runtime && typeof runtime.activeSpace === 'function' ? runtime.activeSpace() : null;
      return kind + '|' + String(runtime.activeChatId || '') + '|' + String(space && space.id || '') + '|' + String(id || '');
    }

    function busyKeyForNode(node) {
      if (!node || !node.getAttribute) return '';
      var action = node.getAttribute('data-action');
      if (node.getAttribute('data-thread-input') !== null) return busyKey('thread', node.getAttribute('data-thread-id') || '');
      if (node.getAttribute('data-comment-input') !== null) return busyKey('comment', node.getAttribute('data-post-id') || '');
      if (node.getAttribute('data-space-input') !== null) return busyKey('space-create', '');
      if (action === 'entity-save') return busyKey('form', (node.getAttribute('data-kind') || '') + ':' + (node.getAttribute('data-id') || ''));
      return '';
    }

    function syncBusyUi(root) {
      if (disposed) return;
      root = root || hostDocument.getElementById(OVERLAY_ID);
      if (!root || !root.querySelectorAll) return;
      Array.prototype.forEach.call(root.querySelectorAll('[data-thread-input], [data-comment-input], [data-space-input], [data-action="entity-save"]'), function (node) {
        var key = busyKeyForNode(node);
        var item = key && busyActions[key];
        var nodes = [node];
        if (node.getAttribute('data-thread-input') !== null || node.getAttribute('data-comment-input') !== null || node.getAttribute('data-space-input') !== null) {
          var parent = node.parentNode;
          var button = parent && parent.querySelector ? parent.querySelector('button[data-action]') : null;
          if (button) nodes.push(button);
        } else {
          var page = node.closest ? node.closest('[data-page]') : null;
          if (page) nodes = nodes.concat(Array.prototype.slice.call(page.querySelectorAll('[data-form-field]')));
        }
        nodes.forEach(function (control) { setBusyNode(control, !!item); });
      });
    }

    installClearProtection();

    // 界面语言唯一真值源是宿主 locale（tavo.plugin.i18n）；
    // lang 设置仅决定注入提示词的语言（生成内容语言策略，见 settings.info）。
    function promptLang() {
      try {
        var value = tavoApi.plugin && tavoApi.plugin.config && tavoApi.plugin.config.get('lang');
        return String(value) === 'en' ? 'en' : 'zh';
      } catch (_) { return 'zh'; }
    }

    function parseFeatureRecord(raw) {
      var parsed = raw;
      if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch (_) { return null; } }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      var flags = parsed.flags && typeof parsed.flags === 'object' && !Array.isArray(parsed.flags) ? parsed.flags : parsed;
      return { flags: flags, revision: Number(parsed.revision) || 0, writer: String(parsed.writer || '') };
    }

    function compareFeatureRecord(a, b) {
      var ar = Number(a && a.revision) || 0;
      var br = Number(b && b.revision) || 0;
      if (ar !== br) return ar - br;
      return String(a && a.writer || '').localeCompare(String(b && b.writer || ''));
    }

    function applyFeatureRecord(record) {
      if (!record || !record.flags) return false;
      VIEWS.FEATURES.forEach(function (feature) {
        if (feature.toggleable) featureFlags[feature.id] = record.flags[feature.id] !== false;
      });
      featureRevision = Number(record.revision) || 0;
      featureLastWriter = String(record.writer || '');
      return true;
    }

    function acceptFeatureRecord(record) {
      if (disposed || !record || compareFeatureRecord(record, { revision: featureRevision, writer: featureLastWriter }) <= 0) return false;
      applyFeatureRecord(record);
      runtime.current().pendingFull = true;
      runtime.saveChat(runtime.activeChatId);
      render();
      return true;
    }

    function setupFeatureSync() {
      if (featureSyncReady) return;
      featureSyncReady = true;
      try {
        var Channel = hostWindow && hostWindow.BroadcastChannel;
        if (!Channel && typeof BroadcastChannel !== 'undefined') Channel = BroadcastChannel;
        if (Channel) featureChannel = new Channel('yz-features');
      } catch (_) { featureChannel = null; }
      if (featureChannel) {
        featureChannel.onmessage = function (event) {
          if (disposed) return;
          var data = event && event.data;
          if (!data || data.type !== 'yz-features-changed') return;
          acceptFeatureRecord(data.record);
        };
      }
      if (hostWindow && typeof hostWindow.addEventListener === 'function') {
        listen(hostWindow, 'storage', function (event) {
          if (!event || event.key !== FEATURES_KEY) return;
          acceptFeatureRecord(parseFeatureRecord(event.newValue));
        });
      }
    }

    // 封印标志从全局存储/本地镜像恢复（FEATURES_KEY）；禁用的功能不注入提示词。
    async function loadFeatureFlags() {
      var raw = null;
      try { raw = await Promise.resolve(tavoApi.get(FEATURES_KEY, 'global')); } catch (_) {}
      var remote = parseFeatureRecord(raw);
      var local = null;
      try { local = parseFeatureRecord(hostWindow.localStorage.getItem('yz:features')); } catch (_) {}
      var record = remote && local ? (compareFeatureRecord(remote, local) >= 0 ? remote : local) : (remote || local);
      if (record) applyFeatureRecord(record);
    }

    function persistFeatureFlags() {
      var record = {
        flags: Object.assign({}, featureFlags),
        revision: featureRevision + 1,
        writer: featureWriterId
      };
      featureRevision = record.revision;
      featureSaveQueue = featureSaveQueue.then(async function () {
        if (disposed) return null;
        var latest = null;
        try { latest = parseFeatureRecord(await Promise.resolve(tavoApi.get(FEATURES_KEY, 'global'))); } catch (_) {}
        if (latest && compareFeatureRecord(latest, record) > 0) {
          acceptFeatureRecord(latest);
          return latest;
        }
        var raw = JSON.stringify(record);
        try { await Promise.resolve(tavoApi.set(FEATURES_KEY, raw, 'global')); } catch (_) {}
        try { hostWindow.localStorage.setItem('yz:features', raw); } catch (_) {}
        if (featureChannel && !disposed) {
          try { featureChannel.postMessage({ type: 'yz-features-changed', record: record }); } catch (_) {}
        }
        return record;
      }).catch(function () {});
      return featureSaveQueue;
    }

    function toggleFeature(featureId) {
      var feature = null;
      VIEWS.FEATURES.forEach(function (item) { if (item.id === featureId) feature = item; });
      if (!feature || !feature.toggleable) return;
      var nowSealed = featureFlags[featureId] !== false;
      featureFlags[featureId] = !nowSealed;
      flagsDirty = true;
      // 封印变化持久化为强制全量标记（重启丢失内存标记后下一轮仍全量刷新）。
      runtime.current().pendingFull = true;
      runtime.saveChat(runtime.activeChatId);
      persistFeatureFlags();
      // 封印是误触高发操作：给「启封」撤销按钮，误封可一键回退（与删除撤销同一模式）。
      // 启封无需确认（回到默认开放状态，无副作用）。
      if (nowSealed) {
        var name = I18N.dict().features[featureId] || featureId;
        showToast(tr('runtime.toast.sealed', { name: name }), false,
          { label: I18N.dict().unseal, fn: (function (fid) { return function () { featureFlags[fid] = true; flagsDirty = true; runtime.current().pendingFull = true; runtime.saveChat(runtime.activeChatId); persistFeatureFlags(); render(); }; })(featureId) }, 6000);
      }
      render();
    }

    function enabled() {
      try {
        var value = tavoApi.plugin && tavoApi.plugin.config && tavoApi.plugin.config.get('enabled');
        return value !== false;
      } catch (_) { return true; }
    }

    // 是否仍有未封印的功能；全封印时跳过提示词注入。
    function anyFeatureEnabled() {
      return VIEWS.FEATURES.some(function (feature) { return feature.toggleable && featureFlags[feature.id] !== false; });
    }

    function autoStrip() {
      try {
        var value = tavoApi.plugin && tavoApi.plugin.config && tavoApi.plugin.config.get('auto_strip');
        return value !== false;
      } catch (_) { return true; }
    }
