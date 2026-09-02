    function openSpaceForm(kind, id, folderId) {
      if (kind === 'contact') {
        clearToast();
        nav.stack.push({ app: nav.app, view: nav.view, params: nav.params });
        nav.view = 'contact-form';
        nav.params = { kind: 'contact', id: id || '' };
        resetSearch();
        armedWipe = null;
        return render();
      }
      clearToast();
      nav.stack.push({ app: nav.app, view: nav.view, params: nav.params });
      nav.view = 'form';
      nav.params = { kind: kind, id: id || '', folderId: folderId || '' };
      resetSearch();
      armedWipe = null;
      render();
    }

    // 保存：读取表单全部 data-form-field（含隐藏 folderId、checkbox）→ 直写玩家域。
    // 保存失败定位化：reason → 具体字段 + 输入框高亮 focus + 行内错误提示。
    // 表单页不整页重渲染（渲染会用落盘值覆盖编辑中内容），这里直接操作 DOM。
    function clearFormErrors() {
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      if (!overlay) return;
      Array.prototype.forEach.call(overlay.querySelectorAll('.yz-form-input.error'), function (el) { el.classList.remove('error'); });
      Array.prototype.forEach.call(overlay.querySelectorAll('.yz-form-field-error'), function (el) { el.remove(); });
    }

    function flagFormError(fieldKey, message) {
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      if (!overlay) return;
      clearFormErrors();
      var box = overlay.querySelector('[data-form-field="' + fieldKey + '"]');
      if (!box) return;
      box.classList.add('error');
      var note = hostDocument.createElement('p');
      note.className = 'yz-form-field-error';
      note.textContent = message;
      box.parentNode.insertBefore(note, box.nextSibling);
      box.focus();
    }

    async function saveSpaceForm(kind, id) {
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      var scope = overlay && overlay.querySelector('[data-page]');
      if (!scope) return;
      var raw = {};
      var fields = scope.querySelectorAll('[data-form-field]');
      Array.prototype.forEach.call(fields, function (el) {
        var key = el.getAttribute('data-form-field');
        if (el.type === 'checkbox') raw[key] = el.checked;
        else raw[key] = el.value;
      });
      var dict = I18N.dict();
      // reason → 字段名（playerFormFields 的 key 与运行时校验点一致）。
      var REASON_FIELD = { name: 'name', title: 'title', kind: 'kind', kindClash: 'kind' };
      var space = runtime.activeSpace();
      var saveButton = scope.querySelector('[data-action="entity-save"]');
      var busy = beginBusy(busyKey('form', kind + ':' + id), [saveButton].concat(Array.prototype.slice.call(fields)));
      if (!busy) return;
      var context = captureUiContext();
      try {
        var result = space ? runtime.spaceSaveEntity(space.id, kind, raw, id) : { ok: false, reason: 'space' };
        if (!result || !result.ok) {
          var reason = (result && result.reason) || '';
          if (reason === 'folder') {
            clearFormErrors();
            showToast(dict.playerFormNeedFolder, true);
            return;
          }
          if (reason === 'missing') { showToast(dict.spaceMissingEntity, true); return; }
          if (reason === 'full') { showToast(dict.spaceEntityFull, true); return; }
          var fieldKey = REASON_FIELD[reason];
          if (fieldKey) {
            var label = '';
            playerFormFields(kind, null, dict).forEach(function (f) { if (f.key === fieldKey) label = f.label; });
            var message = reason === 'kindClash' ? dict.playerFormKindClash : tr('runtime.player.formFieldError', { field: label || dict.playerFieldName });
            flagFormError(fieldKey, message);
            showToast(message, true);
            return;
          }
          showToast(dict.spaceMissingEntity, true);
          return;
        }
        var persisted = await Promise.resolve(result.saved);
        if (!persisted || !persisted.ok) { showToast(dict.toast.persistenceFailed, true); return; }
        var currentOverlay = hostDocument.getElementById(OVERLAY_ID);
        var currentSave = currentOverlay && currentOverlay.querySelector('[data-action="entity-save"]');
        if (uiContextMatches(context) && currentSave === saveButton) {
          backNav();
          showToast(I18N.dict().playerSaved);
        }
      } catch (error) {
        dbg('space form save failed', error);
        showToast(dict.toast.persistenceFailed, true);
      } finally {
        endBusy(busy);
      }
    }

    // 删除：两击确认（复用管理页武装状态机，key = kind:id），确认后直写当前空间。
    // 删除成功给出「撤销」入口（会话内快照）：玉册夹级联删除其下备忘也一并还原。
    var undoSnap = null;

    async function undoDelete() {
      if (!undoSnap) return;
      var snap = undoSnap;
      undoSnap = null;
      if (snap.chatId && String(snap.chatId) !== String(runtime.activeChatId)) {
        showToast(I18N.dict().toast.stale, true);
        return;
      }
      var result = snap.spaceSnapshot ? runtime.restoreSpace(snap.entity) : runtime.spaceRestoreEntity(snap);
      var persisted = result && result.saved ? await Promise.resolve(result.saved) : result;
      if (result && result.ok && persisted && persisted.ok !== false) {
        showToast(I18N.dict().playerRestored);
        render();
      } else {
        showToast(I18N.dict().spaceMissingEntity, true);
      }
    }

    async function deleteSpaceItem(kind, id, extraId) {
      var key = kind + ':' + id + (extraId ? ':' + extraId : '');
      var next = VIEWS.nextWipeState(armedWipe, key, Date.now());
      clearAppTimeout(wipeTimer);
      wipeTimer = 0;
      var space = runtime.activeSpace();
      if (!next) {
        var result = space ? runtime.spaceDeleteEntity(space.id, kind, id, extraId || '') : { ok: false, reason: 'space' };
        armedWipe = null;
        if (result.ok) {
          var persisted = await Promise.resolve(result.saved);
          if (!persisted || !persisted.ok) { showToast(I18N.dict().toast.persistenceFailed, true); render(); return; }
          undoSnap = result.snapshot && result.snapshot.entity ? result.snapshot : null;
          // 撤销 toast 用 6s 窗口：手机端「读 toast + 抬手点击」2.4s 通常不够。
          if (undoSnap) showToast(I18N.dict().playerDeleted, false, { label: I18N.dict().playerUndo, fn: undoDelete }, 6000);
          else showToast(I18N.dict().playerDeleted);
          backNavSkippingDeleted(kind, id, extraId);
          return;
        }
        showToast(result && result.reason === 'missing' ? I18N.dict().spaceMissingEntity : I18N.dict().spaceMissingEntity, true);
        return;
      }
      armedWipe = next;
      wipeTimer = setAppTimeout(function () {
        armedWipe = null;
        stopWipeCountdown();
        // 武装超时（未确认）：只复位按钮文案，不整页重渲染——表单里未保存的编辑不能被
        // 实体旧值覆盖（整页 render 会用落盘实体重建表单，丢失编辑中的输入）。
        var node = hostDocument.querySelector('#' + OVERLAY_ID + ' .yz-clear-btn.armed[data-wipe-base]');
        if (node) {
          node.classList.remove('armed');
          node.textContent = I18N.dict().playerDelete;
          if (node.dataset && node.dataset.wipeLabel) node.setAttribute('aria-label', node.dataset.wipeLabel);
          if (node.dataset) { delete node.dataset.wipeBase; delete node.dataset.wipeLabel; }
        } else {
          render();
        }
      }, VIEWS.WIPE_CONFIRM_MS + 50);
      startWipeCountdown();
      // 武装第一击：局部更新按钮文案，不整页重渲染（保留表单未保存的编辑）。
      var confirmKey = 'delete' + kind.charAt(0).toUpperCase() + kind.slice(1) + 'Confirm';
      var confirmLabel = I18N.dict()[confirmKey] || I18N.dict().deleteConfirmShort || I18N.dict().playerDeleteConfirm;
      var btn = hostDocument.querySelector('#' + OVERLAY_ID + ' [data-kind="' + CORE.escapeHtml(kind) + '"][data-id="' + CORE.escapeHtml(String(id)) + '"].yz-clear-btn') ||
        hostDocument.querySelector('#' + OVERLAY_ID + ' [data-action="delete-' + CORE.escapeHtml(kind) + '"][data-id="' + CORE.escapeHtml(String(id)) + '"]');
      if (btn) {
        btn.classList.add('armed');
        if (btn.getAttribute('aria-label')) btn.setAttribute('data-wipe-label', btn.getAttribute('aria-label'));
        btn.setAttribute('data-wipe-base', confirmLabel);
        btn.setAttribute('aria-label', confirmLabel);
        btn.textContent = confirmLabel;
        return;
      }
      render();
    }

    // ---------- 空间管理 UI 动作 ----------
    async function createSpaceFromForm() {
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      var box = overlay && overlay.querySelector('[data-space-input]');
      var name = box ? String(box.value || '') : '';
      if (!CORE.hasText(name.trim())) { showToast(I18N.dict().spaceNameRequired, true); return; }
      var button = box && box.parentNode && box.parentNode.querySelector ? box.parentNode.querySelector('[data-action="space-create"]') : null;
      var busy = beginBusy(busyKey('space-create', ''), [box, button]);
      if (!busy) return;
      var context = captureUiContext();
      try {
        var result = runtime.createSpace(name.trim());
        if (!result.ok) {
          showToast(result.reason === 'full' ? I18N.dict().spaceLimitReached : result.reason === 'clash' ? I18N.dict().spaceNameClash : I18N.dict().spaceNameRequired, true);
          return;
        }
        var persisted = await Promise.resolve(result.saved);
        if (!persisted || !persisted.ok) { showToast(I18N.dict().toast.persistenceFailed, true); return; }
        var currentOverlay = hostDocument.getElementById(OVERLAY_ID);
        var currentBox = currentOverlay && currentOverlay.querySelector('[data-space-input]');
        if (uiContextMatches(context) && currentBox === box) {
          box.value = '';
          showToast(I18N.dict().spaceCreated);
          render();
        }
      } catch (error) {
        dbg('space create failed', error);
        showToast(I18N.dict().toast.persistenceFailed, true);
      } finally {
        endBusy(busy);
      }
    }

    async function toggleSpaceFlag(id, flag) {
      if (flag !== 'sendToAI' && flag !== 'allowAIWrite') return;
      var space = CORE.findSpaceState(runtime.current(), id);
      var result = runtime.setSpaceFlag(id, flag, !(space && space[flag]));
      if (!result.ok && result.reason === 'default') { showToast(I18N.dict().spaceDefaultWrite, true); return; }
      if (!result.ok) { showToast(I18N.dict().toast.persistenceFailed, true); return; }
      var persisted = await Promise.resolve(result.saved);
      if (!persisted || !persisted.ok) { showToast(I18N.dict().toast.persistenceFailed, true); return; }
      render();
    }

    // 删除空间（两击确认 + 撤销）：默认空间删除后由 AI 写入自动重建。
    async function deleteSpaceRow(id) {
      var key = 'space:' + id;
      var next = VIEWS.nextWipeState(armedWipe, key, Date.now());
      clearAppTimeout(wipeTimer);
      wipeTimer = 0;
      if (!next) {
        var result = runtime.deleteSpace(id);
        armedWipe = null;
        if (result.ok) {
          var persisted = await Promise.resolve(result.saved);
          if (!persisted || !persisted.ok) { showToast(I18N.dict().toast.persistenceFailed, true); render(); return; }
           undoSnap = { spaceSnapshot: true, chatId: runtime.activeChatId, entity: result.snapshot };
          showToast(I18N.dict().spaceDeleted, false, { label: I18N.dict().playerUndo, fn: undoDelete }, 6000);
          if (nav.app === 'manage' && nav.view === 'spaces') nav.stack = [];
          render();
          return;
        }
        render();
        return;
      }
      armedWipe = next;
      wipeTimer = setAppTimeout(function () {
        armedWipe = null;
        stopWipeCountdown();
        render();
      }, VIEWS.WIPE_CONFIRM_MS + 50);
      startWipeCountdown();
       var btn = hostDocument.querySelector('#' + OVERLAY_ID + ' [data-action="space-delete"][data-id="' + CORE.escapeHtml(id) + '"]');
       if (btn) {
         var currentSpace = CORE.findSpaceState(runtime.current(), id);
         var deleteConfirm = currentSpace && currentSpace.isDefault ? I18N.dict().spaceDeleteDefaultConfirm : I18N.dict().spaceDeleteConfirm;
         var spaceName = currentSpace && CORE.spaceDisplayName(runtime.current(), currentSpace, I18N.dict().spaceDefaultName);
         btn.classList.add('armed');
         btn.setAttribute('data-wipe-base', deleteConfirm);
         btn.setAttribute('aria-label', contextualLabel(deleteConfirm, spaceName));
         btn.textContent = deleteConfirm + tr('runtime.sep.count', { n: Math.ceil(VIEWS.WIPE_CONFIRM_MS / 1000) });
         return;
      }
      render();
    }

    async function renameSpaceRow(id) {
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      var box = overlay && overlay.querySelector('[data-space-rename="' + id + '"]');
      var name = box ? String(box.value || '') : '';
      if (!CORE.hasText(name.trim())) { showToast(I18N.dict().spaceNameRequired, true); return; }
      var result = runtime.renameSpace(id, name.trim());
      if (!result.ok) {
        showToast(result.reason === 'clash' ? I18N.dict().spaceNameClash : result.reason === 'default' ? I18N.dict().spaceDefaultNameLocked : I18N.dict().spaceNameRequired, true);
        return;
      }
      var persisted = await Promise.resolve(result.saved);
      if (!persisted || !persisted.ok) { showToast(I18N.dict().toast.persistenceFailed, true); render(); return; }
      showToast(I18N.dict().spaceRenamed);
      render();
    }
