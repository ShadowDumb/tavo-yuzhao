  function diagRow(label, valueHtml) {
    return '<div class="yz-diag-row"><small>' + CORE.escapeHtml(label) + '</small><p>' + valueHtml + '</p></div>';
  }

  // 同步详情页正文：主界面同步行、太极核心与「玉兆管理」诊断区三个入口共用，不重复实现。
  function renderSyncDetail(state, whole) {
    var t = I18N.dict();
    var sync = state.sync || {};
    var st = syncStatusOf(state);
    var body = '<div class="yz-diag-row"><small>' + CORE.escapeHtml(t.diag.statusLabel) + '</small><p><span class="yz-statusdot ' + CORE.escapeHtml(st.status) + '"></span>' + CORE.escapeHtml(st.text) + '</p></div>';
    // 失败/部分态给可行动的解释：自动补齐或「从快照恢复玉兆数据」恢复，不让用户干瞪眼。
    if (t.diag.action[st.status]) body += '<div class="yz-diag-action">' + CORE.escapeHtml(t.diag.action[st.status]) + '</div>';
    body += diagRow(t.diag.summary, CORE.escapeHtml(sync.summary || t.awaitingSync));
    var applied = CORE.safeArray(sync.applied, 10).map(function (id) { return t.features[id] || id; });
    body += diagRow(t.diag.applied, CORE.escapeHtml(applied.length ? applied.join(tr('runtime.sep.list')) : t.diag.none));
    var issues = CORE.safeArray(sync.issues, 20).map(function (issue) {
      return (issue && (t.issues[issue.code] || t.issues[issue.path])) || (issue && issue.path) || '';
    }).filter(Boolean);
    body += '<div class="yz-diag-row"><small>' + CORE.escapeHtml(t.diag.issuesLabel) + '</small>' +
      (issues.length
        ? '<ul class="yz-diag-issues">' + issues.map(function (line) { return '<li>' + CORE.escapeHtml(line) + '</li>'; }).join('') + '</ul>'
        : '<p>' + CORE.escapeHtml(t.diag.noIssues) + '</p>') +
      '</div>';
    // lastError 仅在非空时显示：错误码走翻译（parse-error/oversized-payload），未知码回退原文。
    if (CORE.hasText(sync.lastError)) {
      var errText = t.diag.err[sync.lastError] || sync.lastError;
      body += diagRow(t.diag.lastError, '<span class="yz-bad-text">' + CORE.escapeHtml(errText) + '</span>');
    }
    body += diagRow(t.diag.updated, CORE.escapeHtml(formatDateTime(sync.updatedAt)));
    var usage = snapshotUsage(whole || state);
    var pct = Math.round(usage.percent);
    body += '<div class="yz-diag-row"><small>' + CORE.escapeHtml(t.diag.storage) + '</small>' +
      '<div class="yz-meter' + (usage.percent > 80 ? ' warn' : '') + '"><i style="width:' + pct + '%"></i></div>' +
      '<em>' + usage.bytes + ' / ' + usage.limit + ' · ' + pct + '%</em></div>';
    // 开发者信息（轮次/来源/累计轮次/聊天标识）折叠收纳：普通用户无需看到内部代号。
    body += '<details class="yz-diag-tech"><summary>' + CORE.escapeHtml(t.diag.tech) + '</summary>' +
      diagRow(t.diag.turn, CORE.escapeHtml(CORE.hasText(sync.turnId) ? sync.turnId : '-')) +
      diagRow(t.diag.source, CORE.escapeHtml(CORE.hasText(sync.lastSource) ? sync.lastSource : '-')) +
      // 累计轮次用单调计数（旧档无该字段时回退到环缓冲长度）。
      diagRow(t.diag.turns, String(sync.totalTurns || CORE.safeArray(state.processedTurns, 80).length)) +
      diagRow(t.diag.chatId, CORE.escapeHtml(state.chatId || '-')) +
      '</details>';
    return body;
  }

  // 单功能清空的两击确认状态机：首击武装，5 秒内再击确认，超时或换目标重新武装。
  var WIPE_CONFIRM_MS = 5000;
