  /* ---------- UI app / dialogs ---------- */
  function createDialogs(ctx) {
    var state = ctx.state;
    var document = ctx.document;
    var tr = ctx.tr || function (k) { return k; };

    function toast(message, type, duration) {
      if (!message) return;
      var toastsEl = document ? document.getElementById('yu-zhao-toasts') : null;
      if (!toastsEl || !document) return;
      duration = duration || 3000;
      var item = document.createElement('div');
      item.className = 'yz-toast' + (type ? ' yz-' + type : '');
      item.innerHTML = '<span>' + CORE.escapeHtml(message) + '</span>';
      toastsEl.appendChild(item);
      setTimeout(function () {
        item.style.transition = 'all 0.25s ease';
        item.style.opacity = '0';
        item.style.transform = 'translateY(10px) scale(0.9)';
        setTimeout(function () {
          if (item.parentNode) item.parentNode.removeChild(item);
        }, 250);
      }, duration);
    }

    function confirm(options) {
      options = options || {};
      state.modal = {
        type: 'confirm',
        title: options.title || tr('runtime.toast.clearTitle') || '确认操作',
        message: options.message || tr('runtime.toast.clearConfirm') || '是否确定执行此操作？',
        confirmLabel: options.confirmLabel || tr('runtime.toast.clearConfirmAction') || '确认',
        cancelLabel: options.cancelLabel || tr('runtime.cancel') || '取消',
        danger: !!options.danger,
        onConfirm: options.onConfirm,
        onCancel: options.onCancel
      };
      if (ctx.shell) ctx.shell.renderDialogs();
    }

    function showUndo(message, onUndo, duration) {
      duration = duration || 6000;
      var toastsEl = document ? document.getElementById('yu-zhao-toasts') : null;
      if (!toastsEl || !document) return;
      var item = document.createElement('div');
      item.className = 'yz-toast yz-undo-toast';
      item.style.cssText = 'border-color: var(--yz-border-bright); background: rgba(12, 34, 36, 0.95);';
      item.innerHTML = '<span>' + CORE.escapeHtml(message) + '</span>' +
        '<button class="yz-btn-primary" style="padding: 2px 10px; font-size: 11px; margin-left: 8px;">' + (tr('runtime.player.undo') || '撤销') + '</button>';
      
      var btn = item.querySelector('button');
      var undone = false;
      if (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          undone = true;
          if (typeof onUndo === 'function') onUndo();
          if (item.parentNode) item.parentNode.removeChild(item);
          toast(tr('runtime.player.restored') || '已撤销恢复', 'success');
        });
      }

      toastsEl.appendChild(item);
      setTimeout(function () {
        if (!undone && item.parentNode) {
          item.style.transition = 'all 0.25s ease';
          item.style.opacity = '0';
          setTimeout(function () { if (item.parentNode) item.parentNode.removeChild(item); }, 250);
        }
      }, duration);
    }

    function closeModal() {
      state.modal = null;
      if (ctx.shell) ctx.shell.renderDialogs();
    }

    return {
      toast: toast,
      confirm: confirm,
      showUndo: showUndo,
      closeModal: closeModal
    };
  }
