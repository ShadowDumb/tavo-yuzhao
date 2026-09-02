    function draftIsDirty() {
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      if (!overlay) return false;
      var page = overlay.querySelector('[data-page]');
      var form = page && page.querySelector('[data-marker="player-form"]');
      if (form) {
        var params = nav.params || {};
        var space = runtime.activeSpace();
        var entity = space && CORE.playerFindEntity(space, params.kind, params.id);
        var expected = Object.create(null);
        playerFormFields(params.kind, entity, I18N.dict()).forEach(function (field) {
          expected[field.key] = field.type === 'checkbox' ? !!field.value : String(field.value == null ? '' : field.value);
        });
        if (params.kind === 'note') expected.folderId = String(params.folderId || (entity && entity.folderId) || '');
        var dirty = false;
        Array.prototype.forEach.call(form.querySelectorAll('[data-form-field]'), function (field) {
          var key = field.getAttribute('data-form-field');
          var value = field.type === 'checkbox' ? !!field.checked : String(field.value == null ? '' : field.value);
          if (value !== (expected[key] == null ? '' : expected[key])) dirty = true;
        });
        if (dirty) return true;
      }
      var importBox = overlay.querySelector('[data-import-input]');
      return !!(importBox && CORE.hasText(importBox.value));
    }

    function withDiscardGuard(action) {
      if (!draftIsDirty()) return action();
      var t = I18N.dict();
      showConfirm(t.playerDiscardTitle, t.playerDiscardMessage, t.playerDiscardAction, action);
      return null;
    }

    function navigateView(view, params) {
      return withDiscardGuard(function () { navigateViewNow(view, params); });
    }

    function navigateViewNow(view, params) {
      clearToast();
      // 同行连点两次不重复压栈：栈顶已是同一页时直接复用，返回不用多按一次。
      var top = nav.stack.length ? nav.stack[nav.stack.length - 1] : null;
      var samePage = top && top.app === nav.app && top.view === nav.view && String(top.params && top.params.id) === String(nav.params && nav.params.id);
      if (!samePage) nav.stack.push({ app: nav.app, view: nav.view, params: nav.params });
      nav.view = view;
      nav.params = params || {};
      if (view === 'chat' || view === 'gchat') clearUnread(params && params.id);
      // 打开帖子详情即视为已读：客户端清零 unread（落盘），角标与呼吸光效不再常驻。
      if (view === 'post') clearPostUnread(params && params.id);
      resetSearch();
      armedWipe = null;
      render();
    }

    function switchView(view) {
      return withDiscardGuard(function () { switchViewNow(view); });
    }

    function switchViewNow(view) {
      clearToast();
      nav.view = view || 'root';
      nav.params = {};
      nav.stack = [];
      resetSearch();
      armedWipe = null;
      render();
    }

    // 删除成功后的回退：仅详情页删除时回到列表；列表页删除只刷新当前列表，
    // 避免用户在批量清理时被无故带回首页。
    function backNavSkippingDeleted(kind, id, parentId) {
      var isDetail = ((kind === 'note') && nav.app === 'notes' && nav.view === 'note' && String(nav.params && nav.params.id) === String(id)) ||
        ((kind === 'post') && nav.app === 'forum' && nav.view === 'post' && String(nav.params && nav.params.id) === String(id)) ||
        ((kind === 'contact') && nav.app === 'msg' && nav.view === 'chat' && String(nav.params && nav.params.id) === String(id)) ||
        ((kind === 'group') && nav.app === 'msg' && nav.view === 'gchat' && String(nav.params && nav.params.id) === String(id));
      var formApps = { contact: 'msg', folder: 'notes', note: 'notes', item: 'space', currency: 'space', order: 'market', post: 'forum' };
      var formApp = formApps[kind];
      if (formApp && nav.app === formApp && nav.view === 'form' && String(nav.params && nav.params.id) === String(id)) isDetail = true;
      if (kind === 'contact' && nav.app === 'msg' && nav.view === 'contact-form' && String(nav.params && nav.params.id) === String(id)) isDetail = true;
      if (isDetail) backNavNow();
      else render();
    }

    function backNav() {
      return withDiscardGuard(backNavNow);
    }

    function backNavNow() {
      clearToast();
      // 离开页面时清理武装态与倒计时定时器：否则武装后返回，3 秒后定时器仍会触发
      // 一次多余的整页 render（且 armed 按钮已不在页面上）。
      stopWipeCountdown();
      clearAppTimeout(wipeTimer);
      wipeTimer = 0;
      if (nav.stack.length) {
        var previous = nav.stack.pop();
        nav.app = previous.app;
        nav.view = previous.view;
        nav.params = previous.params || {};
      } else {
        goHomeNow();
        return;
      }
      resetSearch();
      armedWipe = null;
      render();
    }

    // 线程未读点开即清零：当前空间的会话线程（seen 游标对齐尾随回复数）。
    function clearUnread(id) {
      if (!id) return;
      var space = runtime.activeSpace();
      if (!space) return;
      reportSeenPersistence(runtime.markSpaceThreadSeen(space.id, id));
    }

    // 帖子未读点开即清零（与聊天同语义，当前空间内）。
    function clearPostUnread(id) {
      if (!id) return;
      var space = runtime.activeSpace();
      if (!space) return;
      reportSeenPersistence(runtime.markSpacePostSeen(space.id, id));
    }

    function reportSeenPersistence(result) {
      if (!result || result.ok === false || !result.saved) return;
      Promise.resolve(result.saved).then(function (saved) {
        if (!saved || !saved.ok) {
          showToast(I18N.dict().toast.persistenceFailed, true);
          render();
        }
      }, function () {
        showToast(I18N.dict().toast.persistenceFailed, true);
        render();
      });
    }

    function goHome() {
      return withDiscardGuard(goHomeNow);
    }

    function goHomeNow() {
      clearToast();
      resetManagePanels();
      nav = { app: 'home', view: 'root', params: {}, stack: [] };
      resetSearch();
      render();
    }

    function clearOpenLoading(overlay, epoch) {
      if (!overlay || overlay.__yzLoadingOwner !== appOwner) return;
      if (epoch != null && overlay.__yzLoadingEpoch !== epoch) return;
      overlay.classList.remove('loading');
      overlay.setAttribute('aria-busy', 'false');
      var jade = overlay.querySelector('#' + JADE_ID);
      if (jade) jade.inert = false;
      delete overlay.__yzLoadingEpoch;
      delete overlay.__yzLoadingOwner;
    }

    async function open() {
      // 禁用时也要给反馈（与侧边栏 resync/clear 一致的 disabled toast）：
      // 静默返回会让用户以为点了没反应，尤其经宿主侧边栏「打开玉兆」触发时。
      if (!enabled()) { showToast(I18N.dict().toast.disabled, true); return; }
      // 非聊天页（宿主主页/角色卡/设置）不弹法器：侧边栏/输入动作与 FAB 同门控，
      // 否则会在错误页面之上弹出上一个聊天的数据。
      if (!chatActive) { showToast(I18N.dict().toast.noChat, true); return; }
      ensureShell();
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      if (!overlay) return;
      var epoch = ++openEpoch;
      // 异步加载（切聊水化/从存储读快照）期间先显示 loading 态，避免「点了没反应」。
      overlay.__yzLoadingOwner = appOwner;
      overlay.__yzLoadingEpoch = epoch;
      overlay.classList.add('loading');
      overlay.setAttribute('aria-busy', 'true');
      var loadingJade = overlay.querySelector('#' + JADE_ID);
      if (loadingJade) loadingJade.inert = true;
      try {
        var id = await runtime.resolveCurrentChatId();
        if (id !== runtime.activeChatId) {
          clearGenerationContexts(runtime.activeChatId);
          await runtime.switchChat(id);
        }
        // async 期间用户可能已关闭 overlay：epoch 变了则 abort，防止意外重开。
        if (disposed || epoch !== openEpoch || !overlay) return;
        clearOpenLoading(overlay, epoch);
        overlay.classList.add('open');
        overlay.setAttribute('aria-hidden', 'false');
        clearToast();
        // 确认框若还挂着（弹框期间切了聊天）其锁定聊天已失效：先收起再恢复导航，
        // 避免重新打开后残留一个会误操作的新聊天的确认框。
        hideConfirm();
        resetManagePanels();
        // 回到上次位置：若本会话内曾关闭玉兆，恢复离开时的页面与域（翻一半回来不重头找）；
        // 首开/换聊天后回到主页（savedNav 在 close 时记录、chat:opened 时清空）。
        if (savedNav) {
          nav = savedNav;
          savedNav = null;
        } else {
          nav = { app: 'home', view: 'root', params: {}, stack: [] };
        }
        resetSearch();
        render();
        // 打开时按当前视觉视口收敛玉兆高度（覆盖 iOS 底部工具栏等 vv < 100vh 的场景）。
        if (typeof overlay.__yzFit === 'function') overlay.__yzFit();
        // 打开时把焦点移入对话框。
        var dialog = overlay.querySelector('#' + JADE_ID) || overlay;
        if (typeof dialog.focus === 'function') dialog.focus();
      } catch (error) {
        dbg('open failed', error);
        if (!disposed && epoch === openEpoch) showToast(I18N.dict().toast.persistenceFailed, true);
      } finally {
        clearOpenLoading(overlay, epoch);
      }
    }

    function close() {
      return withDiscardGuard(closeNow);
    }

    function closeNow() {
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      if (!overlay) return;
      ++openEpoch;
      clearToast();
      // 关闭法器时一并收起确认对话框（弹框期间切聊天/关闭后继续确认会误操作）。
      hideConfirm();
      resetManagePanels();
      clearOpenLoading(overlay);
      // 记录离开位置（同一聊天内再打开时恢复），管理页瞬态不保存。
      savedNav = { app: nav.app, view: nav.view, params: nav.params, stack: [] };
      nav = { app: 'home', view: 'root', params: {}, stack: [] };
      resetSearch();
      overlay.classList.remove('open', 'loading');
      overlay.setAttribute('aria-busy', 'false');
      var closedJade = overlay.querySelector('#' + JADE_ID);
      if (closedJade) closedJade.inert = false;
      overlay.setAttribute('aria-hidden', 'true');
      var fab = hostDocument.getElementById(FAB_ID);
      if (fab && typeof fab.focus === 'function') fab.focus();
      // 关闭后立即恢复 FAB 显隐（打开时 render 把 fab.hidden 置 true 隐藏了悬浮球；
      // 这里不走 render，直接按同一门控刷新——否则 × 关闭后 FAB 一直消失，
      // 直到下一次 chat:opened/generation 才重新出现，重开玉兆变得繁琐）。
      if (fab) fab.hidden = !enabled() || !chatActive;
    }
