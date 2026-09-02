
    function watchUi() {
      if (uiObserver || !hostDocument.documentElement) return;
      var Observer = hostWindow && hostWindow.MutationObserver;
      if (typeof Observer !== 'function') return;
      try {
        uiObserver = new Observer(function () {
          if (disposed) return;
          if (!hostDocument.getElementById(OVERLAY_ID) || !hostDocument.getElementById(FAB_ID) ||
              !hostDocument.getElementById('yz1-toast') || !hostDocument.getElementById('yz1-confirm')) return;
          uiObserver.disconnect();
          uiObserver = null;
          render();
        });
        uiObserver.observe(hostDocument.documentElement, { childList: true, subtree: true });
        onCleanup(function () {
          try { observer.disconnect(); } catch (_) {}
          if (uiObserver === observer) uiObserver = null;
        });
      } catch (_) { uiObserver = null; }
    }

    // 全屏 overlay、FAB、Toast 和确认框由 Tavo 的 /chat HTML fragment 提供；入口只绑定行为。
    // 片段可能晚于 entry 挂载，因此首次找不到时观察文档，挂载完成后再渲染。
    function ensureShell() {
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      if (!overlay) { watchUi(); return null; }
      if (!overlay.__yzBound) bindOverlay(overlay);
      var fab = hostDocument.getElementById(FAB_ID);
      if (!fab) { watchUi(); return null; }
      if (!fab.__yzBound) bindFab(fab);
      if (!fab.__yzPositionRestored) {
        fab.__yzPositionRestored = true;
        restoreFabPosition(fab);
      }
      // 全局 Toast 宿主：独立于 overlay（overlay 关闭时 display:none 会把 toast 一起藏掉）。
      var toastHost = hostDocument.getElementById('yz1-toast');
      if (toastHost && !toastHost.__yzBound) {
        toastHost.__yzBound = true;
        markBound(toastHost);
        // 内嵌操作按钮（撤销等）：点击先收起 toast 再执行注册的 handler（放微任务，避开清空竞态）。
        listen(toastHost, 'click', function (event) {
          var btn = event.target && event.target.closest ? event.target.closest('.yz-toast-action') : null;
          if (!btn || !toastAction) return;
          var fn = toastAction;
          toastAction = null;
          clearToast();
          setAppTimeout(fn, 0);
        });
      }
      // 全局确认对话框宿主：body 级居中 modal，独立于 overlay 与 toast——宿主侧边栏
      // 展开等布局变化不会遮挡它（小 toast 会被挤到看不见的位置）。
      var confirmHost = hostDocument.getElementById('yz1-confirm');
      if (!toastHost || !confirmHost) { watchUi(); return null; }
      if (confirmHost && !confirmHost.__yzBound) {
        confirmHost.__yzBound = true;
        markBound(confirmHost);
        // 点「确认」执行 fn；点「取消」、遮罩或 Esc 只关闭（取消操作不触发 fn）。
        // 遮罩点击：event.target 是 .yz-confirm-backdrop（或确认框自身），均非按钮 → 走取消分支。
        listen(confirmHost, 'click', function (event) {
          var target = event.target;
          var btn = target && target.closest ? target.closest('.yz-confirm-actions button') : null;
          // 点在按钮之外（遮罩/空白）等同取消。
          if (!btn) { cancelConfirm(); return; }
          if (btn.classList.contains('yz-confirm-ok') && confirmAction) {
            var fn = confirmAction;
            var lockedChat = confirmChatId;
            confirmAction = null;
            hideConfirm();
            // 确认框弹起期间用户可能已切换聊天：校验仍指向同一聊天才执行，
            // 否则收起并丢弃——绝不能拿「确认清除」误清新聊天的数据。
            if (lockedChat !== null && lockedChat !== runtime.activeChatId) return;
            // 放微任务：先收起确认框再执行清除（与 toast 操作按钮同一防竞态约定）。
            setAppTimeout(fn, 0);
          } else {
            cancelConfirm();
          }
        });
        listen(confirmHost, 'keydown', function (event) {
          if (event.key !== 'Tab') return;
          var focusables = Array.prototype.filter.call(confirmHost.querySelectorAll('button, input, select, textarea, summary, [href], [tabindex]:not([tabindex="-1"])'), function (el) {
            return !el.disabled && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length > 0));
          });
          if (!focusables.length) return;
          var first = focusables[0];
          var last = focusables[focusables.length - 1];
          var active = hostDocument.activeElement;
          if (event.shiftKey && (active === first || !confirmHost.contains(active))) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && (active === last || !confirmHost.contains(active))) {
            event.preventDefault();
            first.focus();
          }
        });
        // Esc 关闭确认框：挂在 document 上（确认框本身常无焦点），确认框开着时优先收它。
        listen(hostDocument, 'keydown', function (event) {
          if (event.key !== 'Escape') return;
          var host = hostDocument.getElementById('yz1-confirm');
          if (host && host.classList.contains('show')) {
            event.preventDefault();
            event.stopPropagation();
            cancelConfirm();
          }
        });
        function cancelConfirm() {
          confirmAction = null;
          hideConfirm();
        }
      }
      return overlay;
    }

    // 危险操作二次确认：居中 modal（遮罩 + 标题 + 文案 + 取消/确认），
    // 比小 toast 醒目得多，宿主侧边栏展开时也不会被遮挡。无操作时保持显示，
    // 用户点「取消」或遮罩外关闭；只有点「确认」才执行 fn。
    // confirmChatId：弹框时锁定的聊天，确认时校验仍指向同一聊天才执行——
    // 防弹框期间切换聊天后「确认清除」误清新聊天的数据。
    var confirmAction = null;
    var confirmChatId = null;
    // 最近一次确认框参数：语言切换时重放，保证开着的确认框文案随语言刷新。
    var confirmLast = null;
    function showConfirm(title, message, okLabel, fn) {
      clearToast();
      var host = hostDocument.getElementById('yz1-confirm');
      if (!host) return;
      confirmAction = fn || null;
      confirmChatId = runtime.activeChatId;
      confirmLast = { title: title, message: message, okLabel: okLabel };
      var titleNode = host.querySelector('.yz-confirm-title');
      var msgNode = host.querySelector('.yz-confirm-msg');
      var okBtn = host.querySelector('.yz-confirm-ok');
      var cancelBtn = host.querySelector('.yz-confirm-cancel');
      if (titleNode) titleNode.textContent = title;
      if (msgNode) msgNode.textContent = message;
      if (okBtn) okBtn.textContent = okLabel;
      if (cancelBtn) cancelBtn.textContent = I18N.dict().cancel;
      // 无障碍：标题/正文与对话框关联（aria-labelledby/describedby），焦点移入「取消」
      // 按钮——默认焦点放安全动作，避免误触「确认」清空数据。
      var titleId = 'yz-confirm-title';
      var msgId = 'yz-confirm-msg';
      var box = host.querySelector('.yz-confirm-box');
      if (box) {
        if (titleNode) titleNode.id = titleId;
        if (msgNode) msgNode.id = msgId;
        host.setAttribute('aria-labelledby', titleId);
        host.setAttribute('aria-describedby', msgId);
      }
      host.classList.add('show');
      if (cancelBtn && typeof cancelBtn.focus === 'function') cancelBtn.focus();
    }
    // 语言切换后重放确认框文案（按钮/遮罩/Esc 关闭时清掉 confirmLast）。
    function refreshConfirmText() {
      var host = hostDocument.getElementById('yz1-confirm');
      if (!host || !confirmLast || !host.classList.contains('show')) return;
      var titleNode = host.querySelector('.yz-confirm-title');
      var msgNode = host.querySelector('.yz-confirm-msg');
      var okBtn = host.querySelector('.yz-confirm-ok');
      var cancelBtn = host.querySelector('.yz-confirm-cancel');
      if (titleNode) titleNode.textContent = confirmLast.title;
      if (msgNode) msgNode.textContent = confirmLast.message;
      if (okBtn) okBtn.textContent = confirmLast.okLabel;
      if (cancelBtn) cancelBtn.textContent = I18N.dict().cancel;
    }
    function hideConfirm() {
      confirmAction = null;
      confirmChatId = null;
      confirmLast = null;
      var host = hostDocument.getElementById('yz1-confirm');
      if (host) host.classList.remove('show');
    }

    function clearToast() {
      clearAppTimeout(toastTimer);
      toastTimer = 0;
      toastAction = null;
      var toast = hostDocument.getElementById('yz1-toast');
      if (toast) { toast.classList.remove('show', 'bad', 'has-action'); toast.innerHTML = ''; }
    }

    // 可选内嵌操作按钮（撤销/确认等）：text 用文本节点（防注入），按钮走委托。
    // duration：默认 2.4s；确认类（如清除玉兆数据）需要更长的阅读/决策窗口。
    function showToast(text, bad, action, duration) {
      if (disposed) return;
      var toast = hostDocument.getElementById('yz1-toast');
      if (!toast) return;
      // 先清空上一条：2.4s 内连续两条 toast 不拼接、旧内嵌按钮（撤销等）不残留——
      // 否则旧按钮还在 DOM 里、toastAction 已被替换，点了会触发错动作。
      clearToast();
      toastAction = action && action.fn ? action.fn : null;
      toast.appendChild(hostDocument.createTextNode(text));
      if (action && action.label) {
        var btn = hostDocument.createElement('button');
        btn.type = 'button';
        btn.className = 'yz-toast-action';
        btn.textContent = action.label;
        toast.appendChild(btn);
      }
      toast.classList.toggle('bad', !!bad);
      toast.classList.toggle('has-action', !!(action && action.label));
      toast.classList.add('show');
      toastTimer = setAppTimeout(clearToast, duration || (bad ? 6000 : 2400));
    }

    // shell DOM 只在首次创建，语言切换不会重建：顶栏品牌与各 aria-label 属于静态节点，
    // 每次渲染时统一刷新，保证切换 App 语言后无上一语言的残留。
    function renderShellStatic(overlay) {
      var t = I18N.dict();
      var jade = overlay.querySelector('#' + JADE_ID);
      if (jade) jade.setAttribute('aria-label', t.appName);
      var brand = overlay.querySelector('.yz-topbar b');
      if (brand) brand.textContent = t.brand.title;
      var sub = overlay.querySelector('.yz-topbar .yz-sub');
      if (sub) sub.textContent = t.brand.sub;
      var closeBtn = overlay.querySelector('[data-action="close"]');
      if (closeBtn) closeBtn.setAttribute('aria-label', t.closePhone);
      // 空间切换按钮：显示当前空间名，点开进入空间管理（切换/新建/删除/开关）。
      var spaceBtn = overlay.querySelector('[data-action="switch-space"]');
      if (spaceBtn) {
        var label = currentSpaceName();
        spaceBtn.textContent = (label || t.spaceShort) + ' ▾';
        spaceBtn.setAttribute('aria-label', tr('runtime.space.switchAria', { name: label || t.spaceShort }));
      }
    }

    function currentSpace() {
      return runtime.activeSpace();
    }

    function currentSpaceName() {
      var state = runtime.current();
      var sp = currentSpace();
      if (!sp) return '';
      return CORE.spaceDisplayName(state, sp, sp.isDefault ? I18N.dict().spaceDefaultName : '');
    }

    function renderPageKey() {
      var space = currentSpace();
      var params = nav.params || {};
      return String(runtime.activeChatId || '') + '|' + String(space && space.id || '') + '|' +
        String(nav.app || '') + '|' + String(nav.view || '') + '|' + String(params.id || '');
    }

    function capturePageDraft(pageNode) {
      if (!pageNode || !pageNode.querySelectorAll) return null;
      var draft = { key: renderPageKey(), fields: Object.create(null), importText: null, focus: null };
      Array.prototype.forEach.call(pageNode.querySelectorAll('[data-form-field]'), function (field) {
        var key = field.getAttribute('data-form-field');
        draft.fields[key] = field.type === 'checkbox' ? !!field.checked : String(field.value == null ? '' : field.value);
      });
      var importBox = pageNode.querySelector('[data-import-input]');
      if (importBox) draft.importText = String(importBox.value || '');
      var active = hostDocument.activeElement;
      if (active && pageNode.contains(active)) {
        ['data-search-input', 'data-thread-input', 'data-comment-input', 'data-form-field', 'data-import-input'].some(function (attribute) {
          if (!active.getAttribute || active.getAttribute(attribute) === null) return false;
          draft.focus = { attribute: attribute, value: active.getAttribute(attribute) || '' };
          draft.focus.selectionStart = typeof active.selectionStart === 'number' ? active.selectionStart : null;
          draft.focus.selectionEnd = typeof active.selectionEnd === 'number' ? active.selectionEnd : null;
          return true;
        });
      }
      return draft;
    }

    function restorePageDraft(pageNode, draft) {
      if (!pageNode || !draft || draft.key !== renderPageKey()) return false;
      Object.keys(draft.fields).forEach(function (key) {
        var field = pageNode.querySelector('[data-form-field="' + CORE.escapeHtml(key) + '"]');
        if (!field) return;
        if (field.type === 'checkbox') field.checked = !!draft.fields[key];
        else field.value = draft.fields[key];
      });
      if (draft.importText !== null) {
        var importBox = pageNode.querySelector('[data-import-input]');
        if (importBox) importBox.value = draft.importText;
      }
      if (!draft.focus) return false;
      var selector = '[' + draft.focus.attribute + ']';
      if (draft.focus.attribute === 'data-form-field') selector = '[data-form-field="' + CORE.escapeHtml(draft.focus.value) + '"]';
      var target = pageNode.querySelector(selector);
      if (!target || typeof target.focus !== 'function') return false;
      target.focus();
      if (draft.focus.selectionStart != null && typeof target.setSelectionRange === 'function') {
        try { target.setSelectionRange(draft.focus.selectionStart, draft.focus.selectionEnd); } catch (_) {}
      }
      return true;
    }

    // 切换空间：停留在当前页面（子页消毒后），重渲染即看到新空间数据。
    function switchSpaceTo(id) {
      return withDiscardGuard(function () { return switchSpaceToNow(id); });
    }

    async function switchSpaceToNow(id) {
      var result = runtime.setActiveSpace(id);
      if (!result || !result.ok) {
        showToast(I18N.dict().spaceMissingEntity, true);
        return;
      }
      var persisted;
      try { persisted = await Promise.resolve(result.saved); } catch (_) { persisted = null; }
      if (!persisted || !persisted.ok) {
        showToast(I18N.dict().toast.persistenceFailed, true);
        render();
        return;
      }
      // 子页消毒：详情/表单页在新空间可能没有对应实体，回退到该 app 根视图。
      if (nav.app === 'msg' && (nav.view === 'chat' || nav.view === 'gchat' || nav.view === 'contact-form')) { nav.view = 'chats'; nav.params = {}; nav.stack = []; }
      else if (nav.app === 'notes' && (nav.view === 'note' || nav.view === 'folder' || nav.view === 'form')) { nav.view = 'folders'; nav.params = {}; nav.stack = []; }
      else if ((nav.app === 'market' || nav.app === 'space' || nav.app === 'forum') && nav.view === 'form') { nav.view = nav.app === 'market' ? 'listings' : nav.app === 'space' ? 'items' : 'root'; nav.params = {}; nav.stack = []; }
      resetSearch();
      clearToast();
      render();
    }

    // {{user}} 解析（chat.persona.name）：聊天切换时刷新，供用户发言署名。
    function refreshOwnerName() {
      runtime.resolveOwnerName().then(function () { if (!disposed) render(); }).catch(function () {});
    }

    function render() {
      if (disposed) return;
      var overlay = ensureShell();
      if (!overlay) return;
      renderShellStatic(overlay);
      var state = runtime.current();
      var space = runtime.activeSpace();
      var spaceName = currentSpaceName();
      var fab = hostDocument.getElementById(FAB_ID);
      if (fab) {
        // 玉兆打开时隐藏 FAB：全屏面板之上不再飘一个可点的玉佩（点击会静默踢回主页）。
        fab.hidden = !enabled() || !chatActive || overlay.classList.contains('open');
        // aria-label 随语言切换刷新：FAB 只在首次创建，不重渲染。
        fab.setAttribute('aria-label', I18N.dict().fabLabel);
      }
      // 插件被禁用时收起已打开的 overlay。
      if (!enabled() && overlay.classList.contains('open')) closeNow();
      var home = overlay.querySelector('[data-home]');
      var pageNode = overlay.querySelector('[data-page]');
      if (!home || !pageNode) return;
      var pageKey = renderPageKey();
      var changedPage = pageKey !== lastRenderedPageKey;
      var pageDraft = capturePageDraft(pageNode);
      if (nav.app === 'home') {
        home.classList.remove('hidden');
        pageNode.hidden = true;
        pageNode.innerHTML = '';
        var homeWrap = hostDocument.createElement('div');
        homeWrap.innerHTML = VIEWS.renderHome(state, featureFlags, { space: space, spaceName: spaceName });
        if (homeWrap.firstElementChild) home.outerHTML = homeWrap.firstElementChild.outerHTML;
        var freshHome = overlay.querySelector('[data-home]');
        if (freshHome) {
          var syncNode = freshHome.querySelector('[data-sync]');
          if (syncNode && home !== freshHome) renderHomeSync(syncNode, space);
        }
      } else {
        if (home) home.classList.add('hidden');
        // 注意：shell 初始模板中 page 带 hidden 属性（CSS [hidden]{display:none!important}），
        // 必须用 .hidden property 移除属性本身；classList.remove('hidden') 只能移除同名 class。
        pageNode.hidden = false;
        // 保留滚动位置：重渲染前记录（聊天详情未检索时除外——它固定贴底）。
        // 否则发论坛评论/搜索/管理页展开诊断等任何重渲染都会把长页弹回顶部，
        // 用户每次发一条评论都要重新滚到底部。聊天详情带检索时同样要恢复位置，
        // 不能每次按键都被钉回底部。
        var scrollNode = pageNode.querySelector('.yz-page-inner') || pageNode;
        var savedScroll = ((nav.view === 'chat' || nav.view === 'gchat') && !search) ? null : scrollNode.scrollTop;
        if (nav.app === 'tablet') {
          tabletOpenGroups = Object.create(null);
          var details = pageNode.querySelectorAll('details[data-group-id]');
          for (var d = 0; d < details.length; d += 1) {
            tabletOpenGroups[details[d].getAttribute('data-group-id')] = details[d].open;
          }
        }
        var focused = hostDocument.activeElement;
        var searchFocused = !!(focused && focused.getAttribute && focused.getAttribute('data-search-input') !== null);
        var threadFocused = !!(focused && focused.getAttribute && focused.getAttribute('data-thread-input') !== null);
        var commentFocused = !!(focused && focused.getAttribute && focused.getAttribute('data-comment-input') !== null);
        pageNode.innerHTML = VIEWS.renderPage(state, nav, featureFlags, { diagOpen: diagOpen, dataPanel: dataPanel, armed: armedWipe, search: search, space: space, spaceName: spaceName, tabletOpenGroups: tabletOpenGroups });
        syncBusyUi(pageNode);
        // 首页无导航历史时隐藏返回按钮：nav.stack 为空且当前是入口页时隐藏。
        var backBtn = pageNode.querySelector('.yz-back');
        if (backBtn) backBtn.hidden = nav.app === 'home' && nav.stack.length === 0;
        // 聊天详情（私讯/群聊/传讯）滚动到底部：每次重渲染后都贴最新消息，不把用户弹回最旧。
        // 但检索旧消息时不能钉底——否则每次按键都被拉回底部，看不到上面匹配的上下文。
        if ((nav.view === 'chat' || nav.view === 'gchat') && !search) {
          var bubbles = pageNode.querySelector('.yz-bubbles');
          if (bubbles) bubbles.scrollTop = bubbles.scrollHeight;
        } else if (savedScroll !== null && savedScroll > 0) {
          // 非聊天页恢复原滚动位置（发评论/搜索后不再跳顶）。
          var freshScrollNode = pageNode.querySelector('.yz-page-inner') || pageNode;
          freshScrollNode.scrollTop = savedScroll;
        }
        // 检索框每次按键都整体重渲染：焦点丢给新的输入框并恢复光标到末尾，
        // 否则输入一个字符后失去焦点、无法连续键入。
        if (searchFocused) {
          var freshInput = pageNode.querySelector('[data-search-input]');
          if (freshInput) {
            freshInput.focus();
            try { freshInput.setSelectionRange(search.length, search.length); } catch (_) {}
          }
        }
        // 发言输入框同理（会话/论坛评论）：整体重渲染后恢复焦点，支持连续输入。
        if (threadFocused || commentFocused) {
          var boxType = threadFocused ? 'data-thread-input' : 'data-comment-input';
          if (boxType) {
            var freshAny = pageNode.querySelector('[' + boxType + ']');
            if (freshAny) freshAny.focus();
          }
        }
        var draftFocused = pageDraft && pageDraft.key === pageKey ? restorePageDraft(pageNode, pageDraft) : false;
        if (!searchFocused && !threadFocused && !commentFocused && !draftFocused && changedPage) {
          var pageTitle = pageNode.querySelector('.yz-page-title');
          if (pageTitle && typeof pageTitle.focus === 'function') pageTitle.focus();
        }
      }
      var live = hostDocument.getElementById('yz1-live');
      if (live && changedPage) {
        var announcement = nav.app === 'home' ? (spaceName || I18N.dict().appName) :
          ((pageNode.querySelector('.yz-page-title') || {}).textContent || I18N.dict().appName);
        live.textContent = announcement;
      }
      lastRenderedPageKey = pageKey;
    }

    function renderHomeSync(node, space) {
      if (!node) return;
      var t = I18N.dict();
      var st = VIEWS.syncStatusOf(space);
      node.className = 'yz-sync ' + CORE.escapeHtml(st.status);
      node.innerHTML = '<i></i><span>' + CORE.escapeHtml(st.text) + '</span>';
      var sync = (space && space.sync) || {};
      var hero = node.parentElement && node.parentElement.querySelector('.yz-hero-line');
      if (hero) {
        var heroTitle = CORE.hasText(sync.roleName) ? sync.roleName : t.appName;
        hero.innerHTML = '<b>' + CORE.escapeHtml(heroTitle) + '</b><p>' + CORE.escapeHtml(sync.summary || t.awaitingSync) + '</p>';
      }
    }

    // 管理页瞬态状态在离开页面（回主页/开功能页/关 overlay）时复位，避免残留确认态或展开面板。
