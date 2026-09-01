
    function clearFeatureData(featureId) {
      var blank = CORE.blankFeatureField(featureId);
      if (!blank) return;
      // 清空是跨空间操作：所有用户空间的该分区一起归零（导出/导入的整份状态同样处理）。
      CORE.safeArray(runtime.current().spaces, 6).forEach(function (sp) {
        sp[CORE.FEATURE_FIELDS[featureId]] = CORE.blankFeatureField(featureId);
      });
      // 强制下一轮全量重建：单功能清空后 sync 状态/旧摘要/issue 回声仍指向旧数据，
      // 不清 pendingFull 的话 meta-only diff 轮提前返回，假「complete」绿点残留。
      runtime.current().pendingFull = true;
      runtime.current().updatedAt = Date.now();
      var saved = runtime.saveChat(runtime.activeChatId, { forceSnapshot: true });
      var cutoffSaved = runtime.markHistoryCutoff(runtime.activeChatId);
      armedWipe = null;
      render();
      Promise.all([saved, cutoffSaved]).then(function (results) {
        if (results.every(function (result) { return result && result.ok; })) showToast(tr('runtime.manage.cleared', { name: I18N.dict().features[featureId] || featureId }));
        else showToast(I18N.dict().toast.persistenceFailed, true);
      });
    }

    // 侧边栏「清除玉兆数据」：当前聊天的角色域与玩家域全部数据归零。
    // 调用前必须完成二次确认（首击只弹确认 toast，确认按钮才真正清除）。
    function clearAllData() {
      var chatId = runtime.activeChatId;
      var state = runtime.current();
      // 全部用户空间数据归零：只剩一个空白默认空间（同步状态一并重置）。
      // 强制下一轮全量重建：不清 pendingFull 的话 meta-only diff 轮提前返回，
      // 空数据却显示「已同步」。processedTurns 不清（防历史水化把已清除数据复活）。
      state.spaces = [CORE.blankUserSpace(chatId, { id: CORE.DEFAULT_SPACE_ID, isDefault: true })];
      state.activeSpaceId = CORE.DEFAULT_SPACE_ID;
      state.pendingFull = true;
      state.updatedAt = Date.now();
      var saved = runtime.saveChat(chatId, { forceSnapshot: true });
      var cutoffSaved = runtime.markHistoryCutoff(chatId);
      armedWipe = null;
      render();
      Promise.all([saved, cutoffSaved]).then(function (results) {
        var ok = results.every(function (result) { return result && result.ok; });
        showToast(ok ? I18N.dict().toast.cleared : I18N.dict().toast.persistenceFailed, !ok);
      });
    }

    // 侧边栏清除入口：首击只弹居中确认对话框（防误触不可恢复操作）——
    // 小 toast 会被宿主侧边栏等布局遮挡，确认框固定居中 + 遮罩，任何布局下都可见。
    function armSidebarClear() {
      if (!enabled()) { showToast(I18N.dict().toast.disabled, true); return; }
      // 非聊天页不操作（activeChatId 是上一个聊天的残留）。
      if (!chatActive) { showToast(I18N.dict().toast.noChat, true); return; }
      // 启动瞬间 ensureShell 可能还没执行（宿主异步加载），确认框宿主不存在会静默失败：
      // 先确保 shell（overlay/toast/确认框宿主）已创建再弹框。
      ensureShell();
      var dict = I18N.dict();
      showConfirm(dict.toast.clearTitle, dict.toast.clearConfirm, dict.toast.clearConfirmAction, clearAllData);
    }

    function armOrClearFeature(featureId) {
      var next = VIEWS.nextWipeState(armedWipe, featureId, Date.now());
      clearTimeout(wipeTimer);
      wipeTimer = 0;
      if (!next) {
        stopWipeCountdown();
        clearFeatureData(featureId);
        return;
      }
      armedWipe = next;
      wipeTimer = setTimeout(function () {
        armedWipe = null;
        wipeTimer = 0;
        stopWipeCountdown();
        render();
      }, VIEWS.WIPE_CONFIRM_MS + 50);
      startWipeCountdown();
      render();
    }

    // 全选复制导出的存档：execCommand 在 WebView 内可用性最好，clipboard API 作为补充。
    function copyExport() {
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      var box = overlay && overlay.querySelector('[data-export-output]');
      if (!box) return;
      var dict = I18N.dict();
      box.focus();
      try { box.select(); } catch (_) {}
      try { if (hostDocument.execCommand && hostDocument.execCommand('copy')) return showToast(dict.toast.exported); } catch (_) {}
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(box.value).then(function () { showToast(dict.toast.exported); }, function () { showToast(dict.toast.exportFailed, true); });
          return;
        }
      } catch (_) {}
      showToast(dict.toast.exportFailed, true);
    }

    function submitImport() {
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      var box = overlay && overlay.querySelector('[data-import-input]');
      if (!box) return;
      var result = runtime.importState(box.value);
      if (result.ok) {
        var dict = I18N.dict();
        showConfirm(dict.manage.import, dict.manage.importWarn, dict.manage.importBtn, function () {
          var committed = runtime.commitImport(result.state);
          dataPanel = null;
          render();
          Promise.resolve(committed && committed.saved).then(function (saved) {
            if (saved && saved.ok) showToast(I18N.dict().manage.importDone);
            else showToast(I18N.dict().toast.persistenceFailed, true);
          });
        });
      } else {
        // 按失败原因分发文案：超长 vs 解析失败，用户能判断是贴错还是太长。
        var dict = I18N.dict();
        showToast(result.reason === 'oversized' ? dict.manage.importOversized : dict.manage.importParse, true);
      }
    }
