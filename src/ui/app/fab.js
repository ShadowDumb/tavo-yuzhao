  /* ---------- UI app / fab ---------- */
  function createFab(ctx) {
    var document = ctx.document;
    var window = ctx.window;
    var dialogs = ctx.dialogs;
    var tr = ctx.tr || function (k) { return k; };

    function getFabEl() {
      return document ? document.getElementById('yu-zhao-fab') : null;
    }
    function getBadgeEl() {
      return document ? document.getElementById('yu-zhao-fab-badge') : null;
    }

    var isDragging = false;
    var moved = false;
    var startX = 0;
    var startY = 0;
    var initialLeft = 0;
    var initialTop = 0;
    var longPressTimer = null;
    var suppressClickUntil = 0;
    var lastOpenTime = 0;

    var DEFAULT_BOTTOM = 96;
    var DEFAULT_RIGHT = 16;
    var POS_KEY = 'yz_fab_pos';

    function clampFab(fab, left, top) {
      var vw = (window && window.innerWidth) || 800;
      var vh = (window && window.innerHeight) || 600;
      var size = (fab && fab.offsetWidth) || 54;
      return {
        x: Math.max(8, Math.min(vw - size - 8, Number(left) || 8)),
        y: Math.max(8, Math.min(vh - size - 8, Number(top) || 8))
      };
    }

    function placeFab(x, y) {
      var fab = getFabEl();
      if (!fab) return;
      var pos = clampFab(fab, x, y);
      fab.style.left = pos.x + 'px';
      fab.style.top = pos.y + 'px';
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
    }

    function resetPosition() {
      var fab = getFabEl();
      if (!fab) return;
      fab.style.left = 'auto';
      fab.style.top = 'auto';
      fab.style.right = DEFAULT_RIGHT + 'px';
      fab.style.bottom = DEFAULT_BOTTOM + 'px';
      try {
        if (window && window.localStorage) window.localStorage.removeItem(POS_KEY);
      } catch (_) {}
      suppressClickUntil = Date.now() + 600;
      if (dialogs) dialogs.toast(tr('runtime.toast.fabReset') || '已复位玉佩位置', 'info');
    }

    function restorePosition() {
      var fab = getFabEl();
      if (!fab) return;
      try {
        if (window && window.localStorage) {
          var saved = window.localStorage.getItem(POS_KEY);
          if (saved) {
            var parsed = JSON.parse(saved);
            if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number') {
              placeFab(parsed.x, parsed.y);
            }
          }
        }
      } catch (_) {}
    }

    function persistPosition(x, y) {
      try {
        if (window && window.localStorage) {
          window.localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(x), y: Math.round(y) }));
        }
      } catch (_) {}
    }

    function updateBadge(count) {
      var badge = getBadgeEl();
      if (!badge) return;
      var num = Number(count) || 0;
      if (num > 0) {
        badge.textContent = num > 99 ? '99+' : String(num);
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }

    function triggerOpen() {
      if (Date.now() < suppressClickUntil) return;
      if (Date.now() - lastOpenTime < 300) return;
      lastOpenTime = Date.now();
      var nav = ctx.navigation;
      if (nav) nav.open();
    }

    function initEvents() {
      var fab = getFabEl();
      if (!fab) return;
      if (fab.dataset && fab.dataset.yzFabBound) return;
      if (fab.dataset) fab.dataset.yzFabBound = '1';

      restorePosition();

      // 原生 Click 监听（兼容性最广的触发通道）
      fab.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (moved) return;
        triggerOpen();
      });

      // Pointer 手势与长按处理
      fab.addEventListener('pointerdown', function (e) {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        isDragging = true;
        moved = false;
        startX = e.clientX;
        startY = e.clientY;

        var rect = fab.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        // 长按 900ms 复位
        longPressTimer = setTimeout(function () {
          if (!moved) {
            resetPosition();
            isDragging = false;
          }
        }, 900);

        try { fab.setPointerCapture(e.pointerId); } catch (_) {}
      });

      function handlePointerMove(e) {
        if (!isDragging) return;
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        // 阈值设为 14px，避免普通点按时微小手抖被判定为拖拽
        if (Math.hypot(dx, dy) > 14) {
          moved = true;
          if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          }
          placeFab(initialLeft + dx, initialTop + dy);
        }
      }

      function handlePointerEnd(e) {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
        if (isDragging) {
          try { fab.releasePointerCapture(e.pointerId); } catch (_) {}
          isDragging = false;
          if (moved) {
            suppressClickUntil = Date.now() + 400;
            var rect = fab.getBoundingClientRect();
            persistPosition(rect.left, rect.top);
          } else {
            // 未拖动：直接触发展开
            triggerOpen();
          }
        }
      }

      fab.addEventListener('pointermove', handlePointerMove);
      fab.addEventListener('pointerup', handlePointerEnd);
      fab.addEventListener('pointercancel', handlePointerEnd);

      if (document) {
        document.addEventListener('pointermove', handlePointerMove);
        document.addEventListener('pointerup', handlePointerEnd);
        document.addEventListener('pointercancel', handlePointerEnd);
      }

      if (window && typeof window.addEventListener === 'function') {
        window.addEventListener('resize', function () {
          var f = getFabEl();
          if (!f) return;
          var rect = f.getBoundingClientRect();
          if (f.style.left && f.style.left !== 'auto') {
            placeFab(rect.left, rect.top);
          }
        });
      }
    }

    initEvents();

    return {
      resetPosition: resetPosition,
      updateBadge: updateBadge
    };
  }
