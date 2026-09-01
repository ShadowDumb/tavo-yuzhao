    function createHookHandlers() {
      function generationKey(event) {
        event = event || {};
        return CORE.cleanText(event.generationId || event.requestId || event.generation || '', 120);
      }
      async function resyncHistory(){
          // 禁用态与 open() 同语义：统一门控，不静默、不真实改数据。
          if (!enabled()) { showToast(I18N.dict().toast.disabled, true); return; }
          // 非聊天页不操作（activeChatId 是上一个聊天的残留，恢复/清除会作用到它）。
          if (!chatActive) { showToast(I18N.dict().toast.noChat, true); return; }
          // 防重入：异步恢复进行中再点直接忽略（避免误导性的「聊天已切换」红 toast）。
          if (restoreBusy) { showToast(I18N.dict().toast.restoreBusy); return; }
          restoreBusy = true;
          var result = null;
          try {
            result = await runtime.rebuildFromHistory(runtime.activeChatId);
          } catch (error) {
            dbg('snapshot restore failed', error);
            restoreBusy = false;
            showToast(I18N.dict().toast.restoreFailed, true);
            return;
          }
          restoreBusy = false;
          runtime.syncArchive(runtime.activeChatId);
          render();
          // stale：异步窗口内切了聊天（结果不属于当前会话），不误报「无快照」。
          if (result && result.stale) { showToast(I18N.dict().toast.stale, true); return; }
          showToast(result && result.restored ? I18N.dict().toast.rebuilt : I18N.dict().toast.noSnapshot);
        }
      var rebuildTimer = 0;
      // 不带信封的 message:updated（编辑中间楼层等）不改变水化签名：去抖从世界书快照
      // 恢复一次，让法器数据与权威存储保持一致（数据源是世界书，编辑正文不影响它）。
      function scheduleRebuild() {
        if (rebuildTimer) return;
        rebuildTimer = setTimeout(async function () {
          rebuildTimer = 0;
          try {
            await runtime.rebuildFromHistory(runtime.activeChatId);
            runtime.syncArchive(runtime.activeChatId);
            render();
          } catch (error) { dbg('snapshot restore failed', error); }
        }, 600);
      }

      async function onMessage(event) {
        if (!enabled()) return;
        var message = event && event.message || {};
        if (message.role !== 'assistant') return;
        var payload = pickEnvelopePayload(message);
        if (!containsEnvelope(payload)) {
          if ((event.type || '') === 'message:updated') scheduleRebuild();
          return;
        }
        var chatId = await runtime.resolveCurrentChatId(event);
        if (discardedEnvelopeHashes[stableHash(payload)]) {
          if (autoStrip()) stripEventFields(message);
          delete discardedEnvelopeHashes[stableHash(payload)];
          return;
        }
        var messageKey = generationKey(event);
        var visibility = preparedBaselines[chatId + '|' + messageKey] || preparedBaselines[chatId + '|'];
        var result = await runtime.applyText(payload, chatId, event.type || 'message', { visibility: visibility });
        if (result.parseError) showToast(I18N.dict().toast.parseError, true, { label: I18N.dict().diag.title, fn: function () { openSyncDetail(); } });
        if (result.oversized) showToast(I18N.dict().toast.oversized, true);
        if (result.changed) runtime.syncArchive(chatId);
        render();
        setTimeout(stripVisibleBlocks, 0);
      }
      async function onChatOpened(event){
        chatActive = true;
        undoSnap = null;
        await runtime.switchChat(await runtime.resolveCurrentChatId(event));
        nav = { app: 'home', view: 'root', params: {}, stack: [] };
        // 换聊天后放弃上一聊天的离开位置：新会话从主页开始。
        savedNav = null;
        // 切换聊天后刷新 {{user}} 用户身份名缓存（发言署名用；用户身份可能随聊天不同）。
        refreshOwnerName();
        render();
      }

      async function onChatUpdated(event){
        var hostId = await runtime.resolveCurrentChatId();
        var eventId = runtime.eventChatId(event);
        if (eventId && eventId !== hostId) return;
        if (hostId !== runtime.activeChatId) await runtime.switchChat(hostId);
        render();
      }

      function onChatClosed(){
        // 离开聊天（含切到宿主设置等非聊天页）时收起 overlay 并隐藏 FAB：
        // 避免继续显示上一个聊天的数据，也避免悬浮入口压在非聊天页面上。
        chatActive = false;
        // 收起可能弹起的确认对话框（其锁定的聊天已失效，继续挂着会误清新聊天）。
        hideConfirm();
        close();
        render();
      }

      async function onGenerationPrepare(event){
        if (!enabled()) return event;
        // 七个功能全部封印时提示词只剩空壳，模型也不会输出协议块：直接跳过注入省 token。
        if (!anyFeatureEnabled()) return event;
        // 有稳定请求 id 时，仅放行清除之后开始的新一轮；清除前已在飞的请求仍丢弃。
        // 宿主没有请求 id 时，保守地保留 clearPending，直到收到一轮结果后解除。
        var prepareKey = generationKey(event);
        if (clearPending) {
          if (prepareKey) postClearGenerationKeys[prepareKey] = true;
        } else {
          if (prepareKey) activeGenerationKeys[prepareKey] = true;
          discardedEnvelopeHashes = Object.create(null);
        }
        // 重新生成/继续同样经过这里：注入基线前先确保目标聊天的持久化状态已加载完毕
        // （插件重载后 switchChat 的加载/水化是异步的，直接读内存会拿到空白态 → 空基线）。
        var chatId = await runtime.resolveCurrentChatId(event);
        if (chatId !== runtime.activeChatId) await runtime.switchChat(chatId);
        await runtime.settle();
        var liveChatId = await runtime.resolveCurrentChatId();
        var eventChatId = runtime.eventChatId(event);
        if (chatId !== runtime.activeChatId || liveChatId !== chatId || (eventChatId && eventChatId !== chatId)) return event;
        var state = runtime.current();
        var defaultSpace = CORE.defaultSpaceState(state);
        var spaceInfos = state.spaces.map(function (sp) {
          return {
            name: CORE.spaceDisplayName(state, sp, ''),
            isDefault: !!sp.isDefault,
            sendToAI: sp.sendToAI !== false,
            allowAIWrite: sp.allowAIWrite !== false
          };
        });
        var allIssues = [];
        state.spaces.forEach(function (sp) {
          CORE.safeArray(sp.sync && sp.sync.issues, 20).forEach(function (issue) { if (allIssues.length < 6) allIssues.push(issue); });
        });
        var currentRows = PROMPT.buildCurrent(state, featureFlags);
        preparedBaselines[chatId + '|'] = currentRows.visibility;
        if (prepareKey) preparedBaselines[chatId + '|' + prepareKey] = currentRows.visibility;
        var ctx = {
          // 强制全量轮：默认空间从未同步、封印切换/版本更新后的持久化标记，或本轮内存标记；
          // 其余轮次一律 diff 增量（非默认空间恒 diff，见提示词空间规则）。
          forceFull: !defaultSpace || defaultSpace.revision === 0 || flagsDirty || state.pendingFull === true,
          issues: allIssues,
          spaces: spaceInfos,
          characterName: defaultSpace ? CORE.spaceDisplayName(state, defaultSpace, '') : '',
          // 当前数据基线：全量轮与 diff 轮都注入（sendToAI 空间分组），模型据此沿用既有 id 与未变化行。
          current: currentRows
        };
        return PROMPT.mutatePrepareEvent(event, promptLang(), featureFlags, ctx);
      }

      async function onGenerationSuccess(event){
        if (!enabled()) return event;
        var raw = pickEnvelopePayload(event);
        var successKey = generationKey(event);
        var allowedAfterClear = !!(successKey && postClearGenerationKeys[successKey]);
        var wasInFlightBeforeClear = !!(successKey && preClearGenerationKeys[successKey]);
        if (wasInFlightBeforeClear) {
          if (autoStrip()) stripEventFields(event);
          if (containsEnvelope(raw)) discardedEnvelopeHashes[stableHash(raw)] = Date.now();
          delete preClearGenerationKeys[successKey];
          return event;
        }
        // 清除进行中时丢弃本轮 protocol block：用户在生成期间清了数据，旧协议写回会复活已清除的数据。
        if (clearPending && !allowedAfterClear) {
          if (autoStrip()) stripEventFields(event);
          if (containsEnvelope(raw)) discardedEnvelopeHashes[stableHash(raw)] = Date.now();
          if (!successKey) clearPending = false;
          render();
          return event;
        }
        if (allowedAfterClear) {
          delete postClearGenerationKeys[successKey];
          clearPending = false;
          preClearGenerationKeys = Object.create(null);
        } else if (successKey) {
          delete activeGenerationKeys[successKey];
        }
        // 该 Hook 每个 handler 只有约 5 秒预算且超时整体丢弃：先同步完成纯字符串的正文剥离
        // （阻止协议块进入已保存消息的关键动作），快照应用走异步、持久化已在 runtime 后台化。
        if (autoStrip()) stripEventFields(event);
        if (containsEnvelope(raw)) {
          try {
            var chatId = await runtime.resolveCurrentChatId(event);
            var visibility = preparedBaselines[chatId + '|' + successKey] || preparedBaselines[chatId + '|'];
            var result = await runtime.applyText(raw, chatId, 'generation:success', { visibility: visibility });
            delete preparedBaselines[chatId + '|' + successKey];
            delete preparedBaselines[chatId + '|'];
            if (result.parseError) showToast(I18N.dict().toast.parseError, true, { label: I18N.dict().diag.title, fn: function () { openSyncDetail(); } });
            if (result.oversized) showToast(I18N.dict().toast.oversized, true);
            // 成功落过一轮全量后清除强制全量标记（内存 + 持久化）。
            if (result.full && result.changed) {
              flagsDirty = false;
              var st = runtime.current();
              if (st && st.pendingFull) {
                st.pendingFull = false;
                runtime.saveChat(runtime.activeChatId);
              }
            }
            // 数据有变化时后台刷新世界书（消息归档条目 + 全状态快照；不占用本 Hook 的 5 秒预算等待）。
            if (result.changed) runtime.syncArchive(chatId);
          } catch (error) { dbg('generation:success apply failed', error); }
        }
        render();
        return event;
      }

      function onGenerationError(){
        if (!enabled()) return;
        clearPending = false;
        discardedEnvelopeHashes = Object.create(null);
        activeGenerationKeys = Object.create(null);
        preClearGenerationKeys = Object.create(null);
        postClearGenerationKeys = Object.create(null);
        showToast(I18N.dict().toast.generationError, true);
      }

      function onGenerationCancelled(){
        if (!enabled()) return;
        clearPending = false;
        discardedEnvelopeHashes = Object.create(null);
        activeGenerationKeys = Object.create(null);
        preClearGenerationKeys = Object.create(null);
        postClearGenerationKeys = Object.create(null);
        showToast(I18N.dict().toast.cancelled, true);
      }
      return {
        open: open,
        resyncHistory: resyncHistory,
        clearData: armSidebarClear,
        chatOpened: onChatOpened,
        chatUpdated: onChatUpdated,
        chatClosed: onChatClosed,
        generationPrepare: onGenerationPrepare,
        generationSuccess: onGenerationSuccess,
        messageAdded: onMessage,
        messageUpdated: onMessage,
        messageDeleted: async function (event) {
          var id = await runtime.resolveCurrentChatId(event);
          if (id !== runtime.activeChatId) return;
          await runtime.rebuildFromHistory(id);
          runtime.syncArchive(id);
          render();
        },
        generationError: onGenerationError,
        generationCancelled: onGenerationCancelled
      };
    }
    async function start() {
      if (started || disposed) return;
      started = true;
      if (hostWindow && typeof hostWindow.addEventListener === 'function') hostWindow.addEventListener('pagehide', dispose);
      setupFeatureSync();
      try {
        var i18nApi = tavoApi.plugin && tavoApi.plugin.i18n;
        if (i18nApi && typeof i18nApi.onChange === 'function') i18nApi.onChange(function () { I18N.invalidate(); refreshConfirmText(); render(); });
      } catch (_) {}
      await loadFeatureFlags();
      ensureShell();
      var id = await runtime.resolveCurrentChatId();
      await runtime.switchChat(id);
      refreshOwnerName();
      // FAB chatActive 启动兜底：宿主可能已停在聊天页而不重发 chat:opened（插件重载等），
      // 此时 FAB 会永久隐藏。启动时主动探测一次：宿主 API 能返回当前聊天即视为在聊天中
      // （不能用 resolveCurrentChatId——它回退到 activeChatId，非聊天页也会得到非空值）。
      try {
        var startChat = tavoApi.chat && typeof tavoApi.chat.current === 'function' ? await Promise.resolve(tavoApi.chat.current()) : null;
        if (startChat && startChat.id != null && CORE.hasText(startChat.id)) chatActive = true;
      } catch (_) {}
      render();
       hostDocument.addEventListener('keydown', function (event) {
         if (event.key !== 'Escape') return;
         var confirm = hostDocument.getElementById('yz1-confirm');
         if (confirm && confirm.classList.contains('show')) {
           event.preventDefault();
           event.stopImmediatePropagation();
           hideConfirm();
           return;
         }
         close();
       }, true);
      // 从设置页等返回聊天页时刷新 FAB 显隐与 overlay 状态（配置变化无 Hook 可订阅；
      // 部分环境返回时不翻转 visibilitychange，补充 window focus 兜底）。
      hostDocument.addEventListener('visibilitychange', function () { if (!hostDocument.hidden) render(); });
      hostWindow.addEventListener('focus', function () { render(); });
      // 增量剥离通道：变更记录排队 + 220ms 防抖，只扫描新增/变化的文本节点，
      // 避免流式生成期间的高频变更触发全文档扫描。队列设上限防内存膨胀。
      var stripTimer = 0;
      var pendingMutations = [];

      function scheduleStrip(batch) {
        pendingMutations = pendingMutations.concat(batch);
        if (pendingMutations.length > 2000) pendingMutations = pendingMutations.slice(-2000);
        if (stripTimer) return;
        stripTimer = setTimeout(function () {
          stripTimer = 0;
          var queued = pendingMutations;
          pendingMutations = [];
          var overlay = hostDocument.getElementById(OVERLAY_ID);
          // overlay 打开时用户在法器界面内，本轮后台剥离直接放弃。
          if (overlay && overlay.classList.contains('open')) return;
          stripFromMutations(queued);
        }, 220);
      }

      try {
        var observer = new hostWindow.MutationObserver(scheduleStrip);
        observer.observe(hostDocument.documentElement, { childList: true, subtree: true, characterData: true });
      } catch (error) { dbg('MutationObserver unavailable', error); }
      stripVisibleBlocks();
    }

    // 宿主只消费 start；open/close/render 均由闭包内的绑定函数直接引用。
    return { start: start, dispose: dispose, hooks: function () { return hookHandlers || (hookHandlers = createHookHandlers()); } };
  }

  var APP = { create: create, pickEnvelopePayload: pickEnvelopePayload, stripEventFields: stripEventFields };
