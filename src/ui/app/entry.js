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

    var runtime = options.runtime || RUNTIME.createRuntime(tavoApi, hostWindow && hostWindow.localStorage, function () { return featureFlags; }, {
      window: hostWindow,
      notice: function (reason) {
        if (reason === 'stateChanged') return setTimeout(render, 0);
         if (reason === 'snapshotCorrupted') return showToast(I18N.dict().toast.snapshotCorrupted, true);
         if (reason === 'storageCorrupted') return showToast(I18N.dict().toast.storageCorrupted, true);
        if (reason === 'syncConflict') return showToast(I18N.dict().toast.syncConflict, true);
        if (reason === 'persistenceFailed') return showToast(I18N.dict().toast.persistenceFailed, true);
        }
      });
    var disposed = false;
    function dispose() {
      if (disposed) return;
      disposed = true;
       runtime.dispose();
       if (uiObserver) { try { uiObserver.disconnect(); } catch (_) {} uiObserver = null; }
      if (hostWindow && typeof hostWindow.removeEventListener === 'function') hostWindow.removeEventListener('pagehide', dispose);
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
    // 清除标记：clearAllData/clearFeatureData 执行时置真，generation:success 时检查并丢弃
    // protocol block——防止生成中清除后数据复活（清空 → 旧 protocol 写回 = 数据复活）。
    var clearPending = false;
    var discardedEnvelopeHashes = Object.create(null);
    var activeGenerationKeys = Object.create(null);
    var preClearGenerationKeys = Object.create(null);
    var postClearGenerationKeys = Object.create(null);
    // generation:prepare 与 success 之间保存本轮实际注入的可见实体集，
    // 让采样窗口外的旧 ID 即使被模型猜中也不能修改。
    var preparedBaselines = Object.create(null);
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
      if (!record || compareFeatureRecord(record, { revision: featureRevision, writer: featureLastWriter }) <= 0) return false;
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
          var data = event && event.data;
          if (!data || data.type !== 'yz-features-changed') return;
          acceptFeatureRecord(data.record);
        };
      }
      if (hostWindow && typeof hostWindow.addEventListener === 'function') {
        hostWindow.addEventListener('storage', function (event) {
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
        var latest = null;
        try { latest = parseFeatureRecord(await Promise.resolve(tavoApi.get(FEATURES_KEY, 'global'))); } catch (_) {}
        if (latest && compareFeatureRecord(latest, record) > 0) {
          acceptFeatureRecord(latest);
          return latest;
        }
        var raw = JSON.stringify(record);
        try { await Promise.resolve(tavoApi.set(FEATURES_KEY, raw, 'global')); } catch (_) {}
        try { hostWindow.localStorage.setItem('yz:features', raw); } catch (_) {}
        if (featureChannel) {
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
