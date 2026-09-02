  function nextWipeState(armed, featureId, now) {
    if (armed && armed.id === featureId && now < armed.expiresAt) return null;
    return { id: featureId, expiresAt: now + WIPE_CONFIRM_MS };
  }

  // 空间管理页：切换/新建/重命名/删除空间 + sendToAI / allowAIWrite 开关。
  function renderSpaceManage(state, t, ui) {
    var spaces = CORE.safeArray(state.spaces, CORE.MAX_SPACES);
    var activeId = state.activeSpaceId;
    var rows = spaces.map(function (sp) {
      var name = CORE.spaceDisplayName(state, sp, t.spaceDefaultName);
      var isActive = sp.id === activeId;
      var armed = !!(ui && ui.armed && ui.armed.id === 'space:' + String(sp.id));
      var badges = '<i class="yz-space-badges">' +
        (sp.isDefault ? '<em class="yz-space-tag">' + CORE.escapeHtml(t.spaceTagDefault) + '</em>' : '') +
        (sp.sendToAI !== false ? '<em class="yz-space-tag">' + CORE.escapeHtml(t.spaceTagSend) + '</em>' : '') +
        (sp.allowAIWrite !== false ? '<em class="yz-space-tag">' + CORE.escapeHtml(t.spaceTagWrite) + '</em>' : '') +
        '</i>';
      var enter = isActive
        ? '<span class="yz-space-current">' + CORE.escapeHtml(t.spaceCurrent) + '</span>'
        : '<button type="button" class="yz-tab" data-action="space-enter" data-id="' + CORE.escapeHtml(sp.id) + '">' + CORE.escapeHtml(t.spaceEnter) + '</button>';
      var writeLocked = !!sp.isDefault;
      var sendBtn = '<button type="button" class="yz-space-toggle" data-action="space-flag" data-flag="sendToAI" data-id="' + CORE.escapeHtml(sp.id) + '" aria-pressed="' + (sp.sendToAI !== false ? 'true' : 'false') + '">' + CORE.escapeHtml(t.spaceSendToggle) + ' ' + (sp.sendToAI !== false ? t.manage.on : t.manage.off) + '</button>';
      var writeBtn = '<button type="button" class="yz-space-toggle' + (writeLocked ? ' locked' : '') + '" data-action="space-flag" data-flag="allowAIWrite" data-id="' + CORE.escapeHtml(sp.id) + '" aria-pressed="' + (sp.allowAIWrite !== false ? 'true' : 'false') + '"' + (writeLocked ? ' disabled aria-disabled="true"' : '') + '>' + CORE.escapeHtml(t.spaceWriteToggle) + ' ' + (sp.allowAIWrite !== false ? t.manage.on : t.manage.off) + '</button>';
      var rename = sp.isDefault ? '' :
        '<div class="yz-space-rename"><input type="text" data-space-rename="' + CORE.escapeHtml(sp.id) + '" value="' + CORE.escapeHtml(sp.name) + '" maxlength="120" aria-label="' + CORE.escapeHtml(t.spaceRenameLabel) + '">' +
        '<button type="button" class="yz-tab" data-action="space-rename" data-id="' + CORE.escapeHtml(sp.id) + '">' + CORE.escapeHtml(t.spaceRenameBtn) + '</button></div>';
       var deleteConfirm = sp.isDefault ? t.spaceDeleteDefaultConfirm : t.spaceDeleteConfirm;
       var deleteLabel = contextualLabel(deleteConfirm, name);
       var del = '<button type="button" class="yz-clear-btn" data-action="space-delete" data-id="' + CORE.escapeHtml(sp.id) + '" aria-label="' + CORE.escapeHtml(deleteLabel) + '" data-wipe-base="' + CORE.escapeHtml(deleteConfirm) + '">' + CORE.escapeHtml(sp.isDefault ? t.spaceDeleteDefault : t.spaceDelete) + '</button>';
      return '<div class="yz-row yz-static yz-manage-row yz-space-row">' +
        '<div class="yz-manage-main" style="display:block"><b>' + CORE.escapeHtml(name) + '</b>' + badges + '</div>' +
        '<div class="yz-space-actions">' + enter + sendBtn + writeBtn + del + '</div>' + rename + '</div>';
    }).join('');
    var addRow = '<div class="yz-space-rename"><input type="text" data-space-input placeholder="' + CORE.escapeHtml(t.spaceNewPlaceholder) + '" maxlength="120" aria-label="' + CORE.escapeHtml(t.spaceNewPlaceholder) + '">' +
      '<button type="button" class="yz-tab" data-action="space-create">' + CORE.escapeHtml(t.spaceCreateBtn) + '</button></div>';
    return '<main class="yz-page-inner" data-marker="manage-spaces">' + yzHeader(t.spaceManageTitle) +
      '<p class="yz-manage-info">' + CORE.escapeHtml(t.spaceManageInfo) + '</p>' +
      '<div class="yz-page-list">' + rows + '</div>' + addRow + '</main>';
  }

  function renderManage(state, flags, ui, nav) {
    var t = I18N.dict();
    flags = flags || {};
    ui = ui || {};
    if (nav && nav.view === 'spaces') return renderSpaceManage(state.spaces ? state : { spaces: [state], chatId: state.chatId }, t, ui);
    var diagState = state.spaces ? (CORE.defaultSpaceState(state) || state) : state;
    var st = syncStatusOf(diagState);
    // 顶部折叠诊断区：头部为状态徽标 + 摘要一行，点击展开与详情页共用的 renderSyncDetail 内容。
    var diag = '<section class="yz-diag">' +
      '<button type="button" class="yz-diag-head" data-action="toggle-diag" aria-expanded="' + (ui.diagOpen ? 'true' : 'false') + '">' +
      '<span class="yz-statusdot ' + CORE.escapeHtml(st.status) + '"></span><b>' + CORE.escapeHtml(st.text) + '</b>' +
      '<span class="yz-diag-sum">' + CORE.escapeHtml((diagState.sync || {}).summary || t.awaitingSync) + '</span>' +
      '</button>' +
      (ui.diagOpen ? '<div class="yz-diag-body">' + renderSyncDetail(diagState, state) + '</div>' : '') +
      '</section>';
    var rows = FEATURES.filter(function (feature) { return feature.toggleable; }).map(function (feature) {
      var onFlag = flags[feature.id] !== false;
      var armed = !!(ui.armed && ui.armed.id === feature.id);
      // 行内两个按钮：主区切换封印，行尾「清空」走两击确认；button 嵌 button 非法，故外层用 div。
      return '<div class="yz-row yz-static yz-manage-row">' +
        '<button type="button" class="yz-manage-main" data-action="toggle-feature" data-feature="' + feature.id + '" aria-pressed="' + (onFlag ? 'true' : 'false') + '" aria-label="' + CORE.escapeHtml(t.features[feature.id] + ' ' + (onFlag ? t.manage.on : t.manage.off)) + '">' +
         '<span class="yz-glyph-sm">' + feature.glyph + '</span><span class="yz-row-copy"><b>' + CORE.escapeHtml(t.features[feature.id]) + '<i>' + CORE.escapeHtml(t.gua[feature.id]) + '</i></b><em>' + CORE.escapeHtml(onFlag ? t.manage.on : t.manage.off) + '</em></span><span class="yz-switch' + (onFlag ? ' on' : '') + '" aria-hidden="true"><i></i></span>' +
        '</button>' +
         '<button type="button" class="yz-clear-btn' + (armed ? ' armed' : '') + '" data-action="clear-feature" data-feature="' + feature.id + '" aria-label="' + CORE.escapeHtml(contextualLabel(armed ? t.manage.clearConfirm : t.manage.clear, t.features[feature.id])) + '"' + (armed ? ' data-wipe-base="' + CORE.escapeHtml(t.manage.clearConfirm) + '"' : '') + '>' + CORE.escapeHtml(armed ? t.manage.clearConfirm : t.manage.clear) + '</button>' +
        '</div>';
    }).join('');
    // 显式复位入口：长按 FAB 复位不可发现，且持久化数据异常或无法拖动时也需要恢复手段。
    var resetRow = '<div class="yz-row yz-static yz-manage-row">' +
      '<button type="button" class="yz-manage-main" data-action="reset-fab"><span class="yz-glyph-sm">' + FAB_ICON + '</span><span class="yz-row-copy"><b>' + CORE.escapeHtml(t.manage.resetFab) + '</b></span></button></div>';
    var spaceRow = '<div class="yz-row yz-static yz-manage-row">' +
      '<button type="button" class="yz-manage-main" data-action="switch-space"><span class="yz-glyph-sm">◎</span><span class="yz-row-copy"><b>' + CORE.escapeHtml(t.spaceManageTitle) + '</b><em>' + CORE.escapeHtml(t.spaceManageSub) + '</em></span></button></div>';
    var dataRows = ['export', 'import'].map(function (kind) {
      var label = kind === 'export' ? t.manage.export : t.manage.import;
      return '<button type="button" class="yz-row yz-static yz-manage-row yz-manage-main" data-action="toggle-data-panel" data-panel="' + kind + '">' +
        '<span class="yz-glyph-sm">' + (kind === 'export' ? '↧' : '↥') + '</span><span class="yz-row-copy"><b>' + CORE.escapeHtml(label) + '</b></span></button>';
    }).join('');
    // 导出/导入共用一行一个面板：导出只读 + 全选复制；导入粘贴 JSON 后校验替换。
    // 导出内容不得超过导入容量红线（importState 拒绝超限），否则导出→导入 round-trip 断裂。
    var panel = '';
    if (ui.dataPanel === 'export') {
      // 容量检查用「用户实际复制的 pretty 文本」长度，与导入侧校验（text.length）同一把尺子：
      // 否则 compact 通过、pretty 超限的存档会出现「导出成功、原样粘贴导入被拒」的 round-trip 断裂。
      var exportPretty = '';
      try { exportPretty = JSON.stringify(state || {}, null, 2); } catch (_) {}
      if (exportPretty.length > MAX_SNAPSHOT_BYTES) {
        panel = '<div class="yz-empty">' + CORE.escapeHtml(t.manage.exportTooBig) + '</div>';
      } else {
        panel = '<div class="yz-io-warn">' + CORE.escapeHtml(t.manage.exportNote) + '</div>' +
          '<textarea class="yz-io" readonly data-export-output>' + CORE.escapeHtml(exportPretty) + '</textarea>' +
          '<div class="yz-io-actions"><button type="button" class="yz-tab" data-action="copy-export">' + CORE.escapeHtml(t.manage.copyAll) + '</button></div>';
      }
    } else if (ui.dataPanel === 'import') {
      panel = '<textarea class="yz-io" data-import-input placeholder="' + CORE.escapeHtml(t.manage.importPlaceholder) + '"></textarea>' +
        '<div class="yz-io-warn">' + CORE.escapeHtml(t.manage.importWarn) + '</div>' +
        '<div class="yz-io-actions"><button type="button" class="yz-tab" data-action="import-submit">' + CORE.escapeHtml(t.manage.importBtn) + '</button></div>';
    }
     return '<main class="yz-page-inner" data-marker="manage">' + yzHeader(t.features.manage) +
       '<p class="yz-manage-info">' + CORE.escapeHtml(t.manage.info) + '</p>' +
       '<details class="yz-manage-help"><summary>' + CORE.escapeHtml(t.manage.helpTitle) + '</summary><p>' + CORE.escapeHtml(t.manage.helpBody) + '</p></details>' +
      diag +
      '<div class="yz-page-list">' + rows + spaceRow + resetRow + dataRows + '</div>' + panel + '</main>';
  }

  // 统一页面渲染：传入当前空间对象（含各分区），不再区分角色域/玩家域。
  // 公开数据概念（跨域一致）随双域一并废除——每个用户空间各自独立一份数据。
