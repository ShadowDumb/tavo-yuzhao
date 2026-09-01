    function navigateView(view, params) {
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
        ((kind === 'group') && nav.app === 'msg' && nav.view === 'gchat' && String(nav.params && nav.params.id) === String(id)) ||
        ((kind === 'message') && nav.app === 'msg' && (nav.view === 'chat' || nav.view === 'gchat') && String(nav.params && nav.params.id) === String(parentId));
      if (isDetail) backNav();
      else render();
    }

    function backNav() {
      clearToast();
      // 离开页面时清理武装态与倒计时定时器：否则武装后返回，3 秒后定时器仍会触发
      // 一次多余的整页 render（且 armed 按钮已不在页面上）。
      stopWipeCountdown();
      clearTimeout(wipeTimer);
      wipeTimer = 0;
      if (nav.stack.length) {
        var previous = nav.stack.pop();
        nav.app = previous.app;
        nav.view = previous.view;
        nav.params = previous.params || {};
      } else {
        goHome();
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
      if (space) runtime.markSpaceThreadSeen(space.id, id);
    }

    // 帖子未读点开即清零（与聊天同语义，当前空间内）。
    function clearPostUnread(id) {
      if (!id) return;
      var space = runtime.activeSpace();
      if (space) runtime.markSpacePostSeen(space.id, id);
    }

    function goHome() {
      clearToast();
      resetManagePanels();
      nav = { app: 'home', view: 'root', params: {}, stack: [] };
      resetSearch();
      render();
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
      // 异步加载（切聊水化/从存储读快照）期间先显示 loading 态，避免「点了没反应」。
      if (overlay) {
        overlay.classList.add('loading');
        overlay.setAttribute('aria-busy', 'true');
        var loadingJade = overlay.querySelector('#' + JADE_ID);
        if (loadingJade) loadingJade.inert = true;
      }
      var epoch = ++openEpoch;
      var id = await runtime.resolveCurrentChatId();
      if (id !== runtime.activeChatId) await runtime.switchChat(id);
      // async 期间用户可能已关闭 overlay：epoch 变了则 abort，防止意外重开。
      if (epoch !== openEpoch || !overlay) return;
      overlay.classList.remove('loading');
      overlay.setAttribute('aria-busy', 'false');
      var readyJade = overlay.querySelector('#' + JADE_ID);
      if (readyJade) readyJade.inert = false;
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
    }

    function close() {
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      if (!overlay) return;
      ++openEpoch;
      clearToast();
      // 关闭法器时一并收起确认对话框（弹框期间切聊天/关闭后继续确认会误操作）。
      hideConfirm();
      resetManagePanels();
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

