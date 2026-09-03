  /* ---------- UI app / hooks ---------- */
  function createHooks(ctx) {
    var runtime = ctx.runtime;
    var state = ctx.state;
    var shell = ctx.shell;
    var fab = ctx.fab;
    var navigation = ctx.navigation;
    var dialogs = ctx.dialogs;
    var domStrip = ctx.domStrip;
    var getFlags = ctx.getFlags || function () { return { enabled: true, auto_strip: true, lang: 'zh' }; };
    var tr = ctx.tr || function (k) { return k; };

    function open(options) {
      if (navigation) navigation.open((options && options.view) || null);
    }

    function resyncHistory() {
      if (runtime && runtime.activeChatId) {
        runtime.rebuildFromHistory(runtime.activeChatId).then(function (res) {
          if (res && res.ok && runtime.syncArchive) {
            runtime.syncArchive(runtime.activeChatId);
          }
          if (dialogs) {
            dialogs.toast(res && res.ok ? (tr('runtime.toast.rebuilt') || '已从历史重新同步') : (tr('runtime.toast.restoreFailed') || '同步重建失败'), res && res.ok ? 'success' : 'warn');
          }
          updateBadges();
          if (shell) shell.render();
        });
      }
    }

    function clearData() {
      if (runtime && runtime.activeChatId && ctx.dataActions) {
        ctx.dataActions.clearChatData(runtime.activeChatId);
      }
    }

    async function chatOpened(event) {
      var chatId = event && (event.chatId || (event.chat && event.chat.id));
      if (!chatId && ctx.tavo && ctx.tavo.chat && typeof ctx.tavo.chat.current === 'function') {
        try {
          var cur = await Promise.resolve(ctx.tavo.chat.current());
          if (cur) chatId = cur.id;
        } catch (_) {}
      }
      state.chatActive = true;
      if (chatId && runtime) {
        await runtime.switchChat(chatId);
        updateBadges();
        if (shell) shell.render();
      }
      if (domStrip) domStrip.scanNow();
      if (shell) shell.updateVisibility();
      return event;
    }

    function chatUpdated(event) {
      if (shell) shell.render();
      return event;
    }

    function chatClosed(event) {
      state.chatActive = false;
      if (navigation) navigation.close();
      if (shell) shell.updateVisibility();
      return event;
    }

    async function generationPrepare(event) {
      if (!event || typeof event !== 'object') return event;
      var flags = getFlags();
      if (flags && flags.enabled === false) return event;
      if (!runtime) return event;

      var current = runtime.current();
      if (!current) return event;

      var sealed = current.sealed || {};
      var featFlags = {};
      var anyEnabled = false;
      ['tablet', 'msg', 'forum', 'notes', 'market', 'space', 'map'].forEach(function (k) {
        var on = !sealed[k];
        featFlags[k] = on;
        if (on) anyEnabled = true;
      });
      if (!anyEnabled) return event;

      var defaultSpace = CORE.defaultSpaceState(current);
      var spaceInfos = (current.spaces || []).map(function (sp) {
        return {
          name: CORE.spaceDisplayName(sp),
          isDefault: !!sp.isDefault,
          sendToAI: sp.sendToAI !== false,
          allowAIWrite: sp.allowAIWrite !== false
        };
      });

      var allIssues = [];
      (current.spaces || []).forEach(function (sp) {
        CORE.safeArray(sp.sync && sp.sync.issues, 20).forEach(function (issue) {
          if (allIssues.length < 6) allIssues.push(issue);
        });
      });

      var currentRows = PROMPT.buildCurrent(current, featFlags);
      var lang = (flags && flags.lang) || 'zh';

      var ctxPrepare = {
        forceFull: !defaultSpace || defaultSpace.revision === 0 || current.pendingFull === true,
        issues: allIssues,
        spaces: spaceInfos,
        characterName: defaultSpace ? CORE.spaceDisplayName(defaultSpace) : '',
        current: currentRows
      };

      return PROMPT.mutatePrepareEvent(event, lang, featFlags, ctxPrepare);
    }

    async function generationSuccess(event) {
      if (!event || typeof event !== 'object') return event;
      var flags = getFlags();
      if (flags && flags.enabled === false) return event;
      if (!runtime) return event;

      var raw = APP.pickEnvelopePayload(event);

      // 1. 同步剥离协议块（阻止写入消息正文）
      if (flags.auto_strip !== false && typeof PROTOCOL !== 'undefined' && PROTOCOL.stripBlocks) {
        APP.stripEventFields(event);
      }

      // 2. 异步解析应用与持久化
      if (APP.containsEnvelope(raw)) {
        try {
          var chatId = (event && (event.chatId || (event.chat && event.chat.id))) || runtime.activeChatId;
          var res = await runtime.applyText(raw, chatId, 'generation:success');
          if (res && res.changed && runtime.syncArchive) {
            runtime.syncArchive(chatId);
          }
          if (res && res.parseError && dialogs) {
            dialogs.toast(tr('runtime.toast.parseError') || '天道机缘解析异常', 'danger');
          }
          updateBadges();
          if (shell) shell.render();
        } catch (err) {
          CORE.dbg('generation:success apply failed', err);
        }
      }

      if (domStrip) domStrip.scanNow();
      return event;
    }

    async function messageAdded(event) {
      var flags = getFlags();
      if (flags && flags.enabled === false) return event;
      var message = (event && event.message) || {};
      if (message.role !== 'assistant') return event;
      var payload = APP.pickEnvelopePayload(message);
      if (!APP.containsEnvelope(payload)) return event;
      if (flags.auto_strip !== false) APP.stripEventFields(message);
      try {
        var chatId = (event && event.chatId) || runtime.activeChatId;
        var res = await runtime.applyText(payload, chatId, event.type || 'message:added');
        if (res && res.changed && runtime.syncArchive) {
          runtime.syncArchive(chatId);
        }
        updateBadges();
        if (shell) shell.render();
      } catch (err) {
        CORE.dbg('messageAdded apply failed', err);
      }
      if (domStrip) domStrip.scanNow();
      return event;
    }

    function messageUpdated(event) {
      if (domStrip) domStrip.scanNow();
      return event;
    }

    async function messageDeleted(event) {
      if (runtime && runtime.activeChatId) {
        await runtime.rebuildFromHistory(runtime.activeChatId);
        if (runtime.syncArchive) runtime.syncArchive(runtime.activeChatId);
        updateBadges();
        if (shell) shell.render();
      }
      return event;
    }

    function generationError(event) {
      if (dialogs) dialogs.toast(tr('runtime.toast.generationError') || '天道机缘感应中断', 'warn');
      return event;
    }

    function generationCancelled(event) {
      if (dialogs) dialogs.toast(tr('runtime.toast.cancelled') || '施法已中止', 'info');
      return event;
    }

    function updateBadges() {
      if (!runtime || !fab) return;
      var space = runtime.activeSpace();
      if (!space) return;
      var unread = 0;
      if (space.chats) {
        CORE.safeArray(space.chats.contacts).forEach(function (c) { unread += Number(c.unread) || 0; });
        CORE.safeArray(space.chats.groups).forEach(function (g) { unread += Number(g.unread) || 0; });
      }
      if (space.forum) {
        CORE.safeArray(space.forum.posts).forEach(function (p) { unread += Number(p.unread) || 0; });
      }
      fab.updateBadge(unread);
    }

    return {
      open: open,
      resyncHistory: resyncHistory,
      clearData: clearData,
      chatOpened: chatOpened,
      chatUpdated: chatUpdated,
      chatClosed: chatClosed,
      generationPrepare: generationPrepare,
      generationSuccess: generationSuccess,
      messageAdded: messageAdded,
      messageUpdated: messageUpdated,
      messageDeleted: messageDeleted,
      generationError: generationError,
      generationCancelled: generationCancelled,
      updateBadges: updateBadges
    };
  }
