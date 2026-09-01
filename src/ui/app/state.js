    function resetManagePanels() {
      diagOpen = false;
      dataPanel = null;
      armedWipe = null;
      clearTimeout(wipeTimer);
      wipeTimer = 0;
    }

    // 检索关键词只属于当前页面：任何导航（前进/后退/切换/回主界面/关闭）都清空，
    // 避免残留关键词把下一页的数据也过滤掉。
    function resetSearch() {
      search = '';
    }

    function markAppliedSeen(featureId) {
      var space = runtime.activeSpace();
      if (!space) return;
      var seen = CORE.safeArray(space.sync && space.sync.appliedSeen, 20);
      if (seen.indexOf(featureId) >= 0) return;
      space.sync.appliedSeen = seen.concat([featureId]).slice(-20);
      runtime.saveChat(runtime.activeChatId);
    }

    function openFeature(featureId) {
      var t = I18N.dict();
      var feature = null;
      VIEWS.FEATURES.forEach(function (f) { if (f.id === featureId) feature = f; });
      if (!feature) return;
      if (feature.toggleable && featureFlags[featureId] === false) {
        showToast(tr('runtime.toast.sealed', { name: t.features[feature.id] || featureId }), true);
        return;
      }
      clearToast();
      resetManagePanels();
      // 查看过该卦位即并入 appliedSeen：下一轮快照再次应用时重新点亮「新」徽标。
      markAppliedSeen(featureId);
      nav = { app: featureId, view: 'root', params: {}, stack: [] };
      resetSearch();
      render();
    }

    // 同步详情页：入栈当前页面，返回键逐级回退到入口页。
    function openSyncDetail() {
      clearToast();
      nav.stack.push({ app: nav.app, view: nav.view, params: nav.params });
      nav.app = 'sync';
      nav.view = 'root';
      nav.params = {};
      resetSearch();
      render();
    }

    // 单功能清空：只重置该分区并落盘；绝不动 processedTurns——否则下一轮相同 turnId 会被去重误挡。
    // 玩家真实数据（传讯/发帖）以玩家域为源：清空角色域分区后立即补投镜像，避免
    // 空窗期导出/注入基线缺玩家数据。
    // 两击确认倒计时：武装后每秒刷新 armed 按钮文案（「(N)」），超时由 wipeTimer 复位。
    // 只在 armed 按钮存在时工作，不整页重渲染（避免打断输入/滚动）。
    var wipeTick = null;
    function startWipeCountdown() {
      stopWipeCountdown();
      wipeTick = setInterval(function () {
        if (!armedWipe) { stopWipeCountdown(); return; }
        var remain = Math.max(0, Math.ceil((armedWipe.expiresAt - Date.now()) / 1000));
        var nodes = hostDocument.querySelectorAll('#' + OVERLAY_ID + ' .armed');
        Array.prototype.forEach.call(nodes, function (node) {
          if (!node.dataset || !node.dataset.wipeBase) return;
          node.textContent = node.dataset.wipeBase + tr('runtime.sep.count', { n: remain });
        });
      }, 500);
    }
    function stopWipeCountdown() {
      if (wipeTick) { clearInterval(wipeTick); wipeTick = null; }
    }
