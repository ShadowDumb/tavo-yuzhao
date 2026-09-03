  /* ---------- UI app / shell ---------- */
  function createShell(ctx) {
    var document = ctx.document;
    var window = ctx.window;
    var state = ctx.state;
    var runtime = ctx.runtime;
    var navigation = ctx.navigation;
    var tr = ctx.tr || function (k) { return k; };

    function $(id) {
      return document ? document.getElementById(id) : null;
    }

    function updateVisibility() {
      var flags = (typeof ctx.getFlags === 'function' && ctx.getFlags()) || {};
      var isEnabled = flags.enabled !== false;

      var overlay = $('yu-zhao-overlay');
      if (overlay) {
        if (state.open && isEnabled) {
          overlay.classList.add('yz-open');
          overlay.style.display = 'flex';
        } else {
          overlay.classList.remove('yz-open');
          overlay.style.display = 'none';
        }
      }

      var fab = $('yu-zhao-fab');
      if (fab) {
        if (isEnabled && !state.open) {
          fab.style.display = 'flex';
        } else {
          fab.style.display = 'none';
        }
      }
    }

    function renderHeader() {
      var spaceNameEl = $('yu-zhao-space-name');
      if (spaceNameEl) {
        var space = runtime ? runtime.activeSpace() : null;
        var name = space ? CORE.spaceDisplayName(space) : (tr('runtime.space.defaultName') || '默认空间');
        spaceNameEl.textContent = name;
      }

      var backBtn = $('yu-zhao-back-btn');
      if (backBtn) {
        var showBack = state.activeView !== 'wheel' || state.selectedId != null;
        backBtn.style.display = showBack ? 'flex' : 'none';
      }
    }

    function render() {
      try {
        renderHeader();
        var bodyEl = $('yu-zhao-body');
        if (!bodyEl) return;

        if (typeof PAGE !== 'undefined' && typeof PAGE.render === 'function') {
          bodyEl.innerHTML = PAGE.render(ctx);
          if (typeof PAGE.bindEvents === 'function') {
            PAGE.bindEvents(bodyEl, ctx);
          }
        }
        renderDialogs();
      } catch (err) {
        try { console.error('[Yu Zhao] render failed:', err); } catch (_) {}
      }
    }

    function renderDialogs() {
      var dialogsEl = $('yu-zhao-dialogs');
      if (!dialogsEl) return;
      if (!state.modal) {
        dialogsEl.innerHTML = '';
        return;
      }

      var m = state.modal;
      if (m.type === 'confirm') {
        dialogsEl.innerHTML =
          '<div class="yz-modal-backdrop">' +
            '<div class="yz-modal-card">' +
              '<h3 class="yz-modal-title">' + CORE.escapeHtml(m.title) + '</h3>' +
              '<p style="font-size: 13px; color: var(--yz-text-secondary); line-height: 1.6;">' + CORE.escapeHtml(m.message) + '</p>' +
              '<div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px;">' +
                '<button id="yz-dialog-cancel" class="yz-btn-icon" style="width: auto; padding: 6px 14px; font-size: 12px;">' + CORE.escapeHtml(m.cancelLabel) + '</button>' +
                '<button id="yz-dialog-confirm" class="yz-btn-primary" style="padding: 6px 16px; font-size: 12px;' + (m.danger ? ' background: linear-gradient(135deg, #ef4444, #b91c1c);' : '') + '">' + CORE.escapeHtml(m.confirmLabel) + '</button>' +
              '</div>' +
            '</div>' +
          '</div>';

        var cancelBtn = dialogsEl.querySelector('#yz-dialog-cancel');
        var confirmBtn = dialogsEl.querySelector('#yz-dialog-confirm');
        if (cancelBtn) {
          cancelBtn.addEventListener('click', function () {
            if (typeof m.onCancel === 'function') m.onCancel();
            state.modal = null;
            renderDialogs();
          });
        }
        if (confirmBtn) {
          confirmBtn.addEventListener('click', function () {
            if (typeof m.onConfirm === 'function') m.onConfirm();
            state.modal = null;
            renderDialogs();
          });
        }
      } else if (m.type === 'entity-form') {
        var fieldsHtml = (m.fields || []).map(function (f) {
          var val = m.initialData && m.initialData[f.name] != null ? m.initialData[f.name] : (f.defaultValue != null ? f.defaultValue : '');
          if (f.type === 'checkbox') {
            return '<label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--yz-text-primary); cursor: pointer;">' +
              '<input type="checkbox" name="' + f.name + '"' + (val ? ' checked' : '') + ' style="accent-color: var(--yz-jade-light);">' +
              '<span>' + CORE.escapeHtml(f.label) + '</span>' +
            '</label>';
          }
          if (f.type === 'select') {
            var optionsHtml = (f.options || []).map(function (opt) {
              return '<option value="' + CORE.escapeHtml(opt.value) + '"' + (String(opt.value) === String(val) ? ' selected' : '') + '>' + CORE.escapeHtml(opt.label) + '</option>';
            }).join('');
            return '<div style="display: flex; flex-direction: column; gap: 4px;">' +
              '<label style="font-size: 12px; color: var(--yz-text-secondary);">' + CORE.escapeHtml(f.label) + '</label>' +
              '<select name="' + f.name + '" class="yz-input" style="background: rgba(10, 26, 28, 0.9);">' + optionsHtml + '</select>' +
            '</div>';
          }
          if (f.type === 'textarea') {
            return '<div style="display: flex; flex-direction: column; gap: 4px;">' +
              '<label style="font-size: 12px; color: var(--yz-text-secondary);">' + CORE.escapeHtml(f.label) + '</label>' +
              '<textarea name="' + f.name + '" class="yz-input" rows="4" placeholder="' + CORE.escapeHtml(f.placeholder || '') + '">' + CORE.escapeHtml(val) + '</textarea>' +
            '</div>';
          }
          return '<div style="display: flex; flex-direction: column; gap: 4px;">' +
            '<label style="font-size: 12px; color: var(--yz-text-secondary);">' + CORE.escapeHtml(f.label) + '</label>' +
            '<input type="' + (f.type || 'text') + '" name="' + f.name + '" value="' + CORE.escapeHtml(val) + '" class="yz-input" placeholder="' + CORE.escapeHtml(f.placeholder || '') + '">' +
          '</div>';
        }).join('');

        dialogsEl.innerHTML =
          '<div class="yz-modal-backdrop">' +
            '<div class="yz-modal-card" style="max-height: 85vh; overflow-y: auto;">' +
              '<h3 class="yz-modal-title">' + CORE.escapeHtml(m.title) + '</h3>' +
              '<form id="yz-entity-form" style="display: flex; flex-direction: column; gap: 12px;">' +
                fieldsHtml +
                '<div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px;">' +
                  '<button type="button" id="yz-form-cancel" class="yz-btn-icon" style="width: auto; padding: 6px 14px; font-size: 12px;">' + CORE.escapeHtml(m.cancelLabel) + '</button>' +
                  '<button type="submit" class="yz-btn-primary" style="padding: 6px 18px; font-size: 12px;">' + CORE.escapeHtml(m.submitLabel) + '</button>' +
                '</div>' +
              '</form>' +
            '</div>' +
          '</div>';

        var form = dialogsEl.querySelector('#yz-entity-form');
        var formCancel = dialogsEl.querySelector('#yz-form-cancel');
        if (formCancel) {
          formCancel.addEventListener('click', function () {
            state.modal = null;
            renderDialogs();
          });
        }
        if (form) {
          form.addEventListener('submit', function (e) {
            e.preventDefault();
            var formData = {};
            (m.fields || []).forEach(function (f) {
              var input = form.elements[f.name];
              if (!input) return;
              if (f.type === 'checkbox') formData[f.name] = !!input.checked;
              else if (f.type === 'number') formData[f.name] = Number(input.value) || 0;
              else formData[f.name] = String(input.value || '').trim();
            });
            if (typeof m.onSubmit === 'function') m.onSubmit(formData);
            state.modal = null;
            renderDialogs();
          });
        }
      }
    }

    function initHeaderEvents() {
      function nav() {
        return ctx.navigation;
      }
      var logoBtn = $('yu-zhao-logo-btn');
      var spaceBtn = $('yu-zhao-space-btn');
      var backBtn = $('yu-zhao-back-btn');
      var syncBtn = $('yu-zhao-sync-btn');
      var closeBtn = $('yu-zhao-close-btn');
      var overlay = $('yu-zhao-overlay');

      if (overlay && !overlay.dataset.yzBound) {
        overlay.dataset.yzBound = '1';
        overlay.addEventListener('click', function (e) {
          if (e.target === overlay && nav()) {
            nav().close();
          }
        });
      }

      if (logoBtn && !logoBtn.dataset.yzBound) {
        logoBtn.dataset.yzBound = '1';
        logoBtn.addEventListener('click', function () { if (nav()) nav().navigate('wheel'); });
      }
      if (spaceBtn && !spaceBtn.dataset.yzBound) {
        spaceBtn.dataset.yzBound = '1';
        spaceBtn.addEventListener('click', function () { if (nav()) nav().navigate('spaces'); });
      }
      if (backBtn && !backBtn.dataset.yzBound) {
        backBtn.dataset.yzBound = '1';
        backBtn.addEventListener('click', function () { if (nav()) nav().back(); });
      }
      if (syncBtn && !syncBtn.dataset.yzBound) {
        syncBtn.dataset.yzBound = '1';
        syncBtn.addEventListener('click', function () { if (nav()) nav().navigate('sync'); });
      }
      if (closeBtn && !closeBtn.dataset.yzBound) {
        closeBtn.dataset.yzBound = '1';
        closeBtn.addEventListener('click', function () { if (nav()) nav().close(); });
      }

      // Esc 键监听
      if (document && typeof document.addEventListener === 'function' && !document.__yzEscBound) {
        document.__yzEscBound = true;
        document.addEventListener('keydown', function (e) {
          if (e.key === 'Escape' && state.open) {
            if (state.modal) {
              state.modal = null;
              renderDialogs();
            } else if (state.activeView !== 'wheel') {
              if (nav()) nav().back();
            } else {
              if (nav()) nav().close();
            }
          }
        });
      }
    }

    initHeaderEvents();

    return {
      updateVisibility: updateVisibility,
      render: render,
      renderHeader: renderHeader,
      renderDialogs: renderDialogs
    };
  }
