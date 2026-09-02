    function bindOverlay(overlay) {
      if (overlay.__yzBound) return;
      overlay.__yzBound = true;
      markBound(overlay);
      function focusablesIn(root) {
        return Array.prototype.filter.call(root.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'), function (el) {
          if (el.disabled || el.getAttribute('aria-hidden') === 'true') return false;
          return el.offsetParent !== null || (el.getClientRects && el.getClientRects().length > 0);
        });
      }
      listen(overlay, 'click', function (event) {
        if (overlay.classList.contains('loading')) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        var target = event.target.closest ? event.target.closest('[data-action]') : null;
        if (target) {
          event.stopPropagation();
          var action = target.getAttribute('data-action');
          if (action === 'close') return close();
          if (action === 'back') return backNav();
          if (action === 'open-feature') return openFeature(target.getAttribute('data-feature'));
          if (action === 'switch-view') return switchView(target.getAttribute('data-view'));
          if (action === 'navigate') return navigateView(target.getAttribute('data-view'), { id: target.getAttribute('data-id') || '' });
          if (action === 'toggle-feature') return toggleFeature(target.getAttribute('data-feature'));
          if (action === 'reset-fab') return resetFabPosition();
          if (action === 'sync-detail') return openSyncDetail();
          // 太极中枢：角色域主页点击打开同步诊断（与插件描述「点击太极核心可查看
          // 同步诊断详情」一致，主页中央按钮不能是死按钮）；功能页点击回主界面。
          // 玩家域主页无同步概念（同步诊断仅角色域），保持无操作的「回主界面」语义。
          if (action === 'core') {
            if (nav.app !== 'home') return resetSearch(), render();
            return openSyncDetail();
          }
          if (action === 'toggle-diag') { diagOpen = !diagOpen; return render(); }
          if (action === 'clear-feature') return armOrClearFeature(target.getAttribute('data-feature'));
          if (action === 'toggle-data-panel') return withDiscardGuard(function () {
            var panel = target.getAttribute('data-panel');
            dataPanel = dataPanel === panel ? null : panel;
            render();
          });
          if (action === 'copy-export') return copyExport();
          if (action === 'import-submit') return submitImport();
          if (action === 'clear-search') { resetSearch(); return render(); }
          if (action === 'switch-space') return withDiscardGuard(function () { nav = { app: 'manage', view: 'spaces', params: {}, stack: nav.stack || [] }; render(); });
          if (action === 'send-thread-msg') return sendThreadMessage(target.getAttribute('data-thread-id') || '');
          if (action === 'send-comment') return sendPostComment();
          if (action === 'new-contact') return openSpaceForm('contact', '', '');
          if (action === 'entity-new') return openSpaceForm(target.getAttribute('data-kind'), '', target.getAttribute('data-folder') || '');
          if (action === 'entity-edit') return openSpaceForm(target.getAttribute('data-kind'), target.getAttribute('data-id') || '', '');
          if (action === 'entity-save') return saveSpaceForm(target.getAttribute('data-kind'), target.getAttribute('data-id') || '');
          if (action === 'entity-delete') return deleteSpaceItem(target.getAttribute('data-kind'), target.getAttribute('data-id') || '');
          if (action === 'delete-contact') return deleteSpaceItem('contact', target.getAttribute('data-id') || '');
          if (action === 'delete-group') return deleteSpaceItem('group', target.getAttribute('data-id') || '');
          if (action === 'delete-message') return deleteSpaceItem('message', target.getAttribute('data-id') || '', target.getAttribute('data-parent-id') || '');
          if (action === 'delete-track') return deleteSpaceItem('track', target.getAttribute('data-id') || '');
          if (action === 'delete-place') return deleteSpaceItem('place', target.getAttribute('data-id') || '');
          if (action === 'space-enter') return switchSpaceTo(target.getAttribute('data-id') || '');
          if (action === 'space-create') return createSpaceFromForm();
          if (action === 'space-flag') return toggleSpaceFlag(target.getAttribute('data-id') || '', target.getAttribute('data-flag') || '');
          if (action === 'space-delete') return deleteSpaceRow(target.getAttribute('data-id') || '');
          if (action === 'space-rename') return renameSpaceRow(target.getAttribute('data-id') || '');
          // 数量步进：调整相邻数量输入框的值（不整页重渲染，保留焦点与编辑状态）。
          if (action === 'qty-step') {
            var stepper = target.parentNode;
            var qtyInput = stepper && stepper.querySelector ? stepper.querySelector('[data-form-field="qty"]') : null;
            if (qtyInput) {
              var next = Math.max(0, Math.floor(Number(qtyInput.value) || 0) + (Number(target.getAttribute('data-delta')) || 0));
              qtyInput.value = String(next);
              var minusBtn = stepper.querySelector('[data-delta="-1"]');
              if (minusBtn) minusBtn.disabled = next <= 0;
              clearFormErrors();
              qtyInput.focus();
            }
            return;
          }
          return;
        }
        if (event.target === overlay) close();
      });
      // 检索框输入走 input 事件委托：每次键入只更新内存关键词并重渲染，
      // 纯前端过滤，不触碰任何持久化数据（交互基座第一层的只读约束）。
      listen(overlay, 'input', function (event) {
        if (overlay.classList.contains('loading')) return;
        var lengthInput = event.target && event.target.closest ? event.target.closest('[maxlength]') : null;
        if (lengthInput) {
          var lengthCounter = lengthInput.parentNode && lengthInput.parentNode.querySelector ? lengthInput.parentNode.querySelector('[data-length-counter]') : null;
          if (lengthCounter) lengthCounter.textContent = String(lengthInput.value || '').length + '/' + lengthInput.getAttribute('maxlength');
        }
        var box = event.target.closest ? event.target.closest('[data-search-input]') : null;
        if (!box) return;
        // IME 合成期间（拼音输入法）不触发整页重渲染：每个拼音键位都重建 DOM 会腰斩
        // 合成中的输入法候选；compositionend 后才同步一次。
        if (event.isComposing) return;
        search = String(box.value || '');
        render();
      });
      listen(overlay, 'compositionend', function (event) {
        if (overlay.classList.contains('loading')) return;
        var box = event.target && event.target.closest ? event.target.closest('[data-search-input]') : null;
        if (!box) return;
        search = String(box.value || '');
        render();
      });
      // 模态焦点陷阱：Tab / Shift+Tab 在对话框内的可见按钮间循环，避免焦点移出到背后页面。
      listen(overlay, 'keydown', function (event) {
        if (overlay.classList.contains('loading')) {
          event.preventDefault();
          return;
        }
        // 发言输入框（会话/论坛评论）：回车直接发送（发送后清空输入并重渲染）。
        if (event.key === 'Enter' && event.target && event.target.getAttribute) {
          if (event.target.getAttribute('data-thread-input') !== null) { event.preventDefault(); sendThreadMessage(event.target.getAttribute('data-thread-id') || ''); return; }
          if (event.target.getAttribute('data-comment-input') !== null) { event.preventDefault(); sendPostComment(); return; }
        }
        if (event.key !== 'Tab') return;
        var focusables = focusablesIn(overlay);
        if (!focusables.length) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        var active = hostDocument.activeElement;
        if (event.shiftKey && (active === first || !overlay.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !overlay.contains(active))) {
          event.preventDefault();
          first.focus();
        }
      });
      // 移动端键盘自适应：视觉视口随键盘抬起收缩（100vh 在 iOS WebView 不跟随），
      // 玉兆高度收敛到可视区，否则底部玩家域输入框（composer）被键盘遮挡。
      var vv = hostWindow.visualViewport;
       var fitViewport = function () {
         var jade = overlay.querySelector('#' + JADE_ID);
         if (!jade) return;
         var viewportHeight = vv && Number(vv.height) > 0 ? Number(vv.height) : Number(hostWindow.innerHeight) || 0;
         var room = viewportHeight - 20;
         if (room <= 0) return;
         var normal = room >= 560;
         jade.style.minHeight = normal ? '' : '0px';
          jade.style.height = normal ? '' : Math.max(1, room) + 'px';
        };
        overlay.__yzFit = fitViewport;
        onCleanup(function () { if (overlay.__yzFit === fitViewport) overlay.__yzFit = null; });
        if (vv && typeof vv.addEventListener === 'function') listen(vv, 'resize', fitViewport);
        if (hostWindow && typeof hostWindow.addEventListener === 'function') listen(hostWindow, 'resize', fitViewport);
      // 输入框聚焦时把玉兆内的输入框滚动进可视区（Android WebView 键盘行为差异兜底）。
      listen(overlay, 'focusin', function (event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        if (target.getAttribute('data-thread-input') === null &&
            target.getAttribute('data-comment-input') === null && target.getAttribute('data-search-input') === null &&
            target.getAttribute('data-space-input') === null) return;
        setAppTimeout(function () {
          if (hostDocument.documentElement.contains(target) && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'nearest' });
        }, 300);
      });
    }

    // 会话发言（UI 侧）：读输入框 → 直写当前空间线程（本机操作，不经模型、不可能失败）。
    // 空间 sendToAI 开启时下一轮基线自动携带这条发言；allowAIWrite 开启时 AI 可回帖。
