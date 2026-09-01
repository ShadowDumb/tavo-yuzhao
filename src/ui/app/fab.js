    function clampFab(fab, left, top) {
      var width = fab.offsetWidth || 54, height = fab.offsetHeight || 54;
      var maxX = Math.max(6, hostWindow.innerWidth - width - 6);
      var maxY = Math.max(6, hostWindow.innerHeight - height - 6);
      return { x: Math.max(6, Math.min(Number(left) || 6, maxX)), y: Math.max(6, Math.min(Number(top) || 6, maxY)) };
    }

    function placeFab(fab, position) {
      var next = clampFab(fab, position.x, position.y);
      fab.style.left = next.x + 'px';
      fab.style.top = next.y + 'px';
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
      return next;
    }

    async function restoreFabPosition(fab) {
      var value = null;
      try { value = await Promise.resolve(tavoApi.get(POS_KEY, 'global')); } catch (_) {}
      if (!value) {
        try { value = hostWindow.localStorage.getItem('yz:fab_position'); } catch (_) {}
      }
      if (value) {
        try { placeFab(fab, typeof value === 'string' ? JSON.parse(value) : value); } catch (_) {}
      }
      fab.classList.add('ready');
    }

    async function persistFab(position) {
      var raw = JSON.stringify(position);
      try { await Promise.resolve(tavoApi.set(POS_KEY, raw, 'global')); } catch (_) {}
      try { hostWindow.localStorage.setItem('yz:fab_position', raw); } catch (_) {}
    }

    function resetFabPosition() {
      var fab = hostDocument.getElementById(FAB_ID);
      if (!fab) return;
      var width = fab.offsetWidth || 54, height = fab.offsetHeight || 54;
      var x = Math.max(6, hostWindow.innerWidth - width - FAB_MARGIN_RIGHT);
      var y = Math.max(6, hostWindow.innerHeight - height - FAB_MARGIN_BOTTOM);
      placeFab(fab, { x: x, y: y });
      persistFab({ x: x, y: y });
      suppressClickUntil = Date.now() + 600;
      showToast(I18N.dict().toast.fabReset);
    }

    function bindFab(fab) {
      if (fab.__yzBound) return;
      fab.__yzBound = true;
      var holdTimer = 0;
      function cancelHold() { if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; } }
      fab.addEventListener('click', function (event) {
        if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation(); return; }
        open();
      });
      fab.addEventListener('pointerdown', function (event) {
        if (event.button != null && event.button !== 0) return;
        var rect = fab.getBoundingClientRect();
        drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false };
        try { fab.setPointerCapture(event.pointerId); } catch (_) {}
        cancelHold();
        holdTimer = setTimeout(function () {
          holdTimer = 0;
          if (!drag || drag.moved) return;
          drag = null;
          fab.classList.remove('dragging');
          resetFabPosition();
        }, 900);
      });
      hostDocument.addEventListener('pointermove', function (event) {
        if (!drag || (drag.pointerId != null && event.pointerId !== drag.pointerId)) return;
        var dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
        // 拖拽判定阈值：触屏点按时手指的轻微位移（>4px 很常见）不应被当成拖拽，
        // 否则「想点开玉佩却把它挪了 2px」且该次点击被抑制、毫无反馈。8px 兼顾跟手与防误触。
        if (!drag.moved && Math.hypot(dx, dy) < 8) return;
        cancelHold();
        drag.moved = true;
        fab.classList.add('dragging');
        placeFab(fab, { x: drag.left + dx, y: drag.top + dy });
      }, true);
      function finish(event) {
        if (!drag || (drag.pointerId != null && event.pointerId !== drag.pointerId)) return;
        cancelHold();
        var moved = drag.moved;
        drag = null;
        fab.classList.remove('dragging');
        if (moved) {
          suppressClickUntil = Date.now() + 500;
          var rect = fab.getBoundingClientRect();
          persistFab({ x: Math.round(rect.left), y: Math.round(rect.top) });
        }
      }
      hostDocument.addEventListener('pointerup', finish, true);
      hostDocument.addEventListener('pointercancel', finish, true);
      hostWindow.addEventListener('resize', function () {
        var rect = fab.getBoundingClientRect();
        placeFab(fab, { x: rect.left, y: rect.top });
      });
    }

    // —— 正文协议块剥离（DOM 层）——
    // 权威路径在 Hook 层：generation:success 同步剥离事件正文，message hook 应用快照；
    // DOM 扫描只是兜底，覆盖宿主自行重渲染消息文本的场景（如滚动时懒渲染旧楼层）。
    // 禁用插件或关闭 auto_strip 时必须停止一切 DOM 改写。
