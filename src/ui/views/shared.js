  /* ---------- UI views / shared helpers ---------- */
  var VIEWS_SHARED = {
    renderEmpty: function (text, icon) {
      return '<div class="yz-empty">' +
        '<div class="yz-empty-icon">' + (icon || '☯') + '</div>' +
        '<div>' + CORE.escapeHtml(text || '暂无数据，待天道运转') + '</div>' +
      '</div>';
    },

    renderHeader: function (options) {
      options = options || {};
      var actionsHtml = (options.actions || []).map(function (act) {
        return '<button id="' + act.id + '" class="' + (act.primary ? 'yz-btn-primary' : 'yz-btn-icon') + '" style="' + (act.primary ? 'padding: 6px 14px; font-size: 12px;' : '') + '" title="' + CORE.escapeHtml(act.title || '') + '">' +
          (act.icon ? act.icon : '') + (act.label ? (' ' + CORE.escapeHtml(act.label)) : '') +
        '</button>';
      }).join('');

      return '<div class="yz-subview-header">' +
        '<div class="yz-subview-title-group">' +
          (options.icon ? ('<span class="yz-subview-icon">' + options.icon + '</span>') : '') +
          '<h2 class="yz-subview-title">' + CORE.escapeHtml(options.title || '') + '</h2>' +
          (options.subtitle ? ('<span style="font-size: 12px; color: var(--yz-text-muted);">' + CORE.escapeHtml(options.subtitle) + '</span>') : '') +
        '</div>' +
        '<div class="yz-subview-actions">' + actionsHtml + '</div>' +
      '</div>';
    },

    renderTabs: function (tabs, activeTab) {
      var tabsHtml = (tabs || []).map(function (t) {
        var isActive = String(t.id) === String(activeTab);
        return '<button class="yz-tab-btn' + (isActive ? ' yz-active' : '') + '" data-tab="' + CORE.escapeHtml(t.id) + '">' +
          CORE.escapeHtml(t.label) + (t.badge ? (' <span style="font-size: 10px; opacity: 0.8;">(' + t.badge + ')</span>') : '') +
        '</button>';
      }).join('');
      return '<div class="yz-tabs">' + tabsHtml + '</div>';
    },

    renderSearchBar: function (placeholder, query) {
      return '<div class="yz-search-bar">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>' +
        '<input type="text" class="yz-search-input" placeholder="' + CORE.escapeHtml(placeholder || '在万象中检索...') + '" value="' + CORE.escapeHtml(query || '') + '">' +
      '</div>';
    },

    renderGradeBadge: function (grade) {
      var g = String(grade || '').trim();
      if (!g) return '';
      var color = '#94a3b8';
      var bg = 'rgba(148, 163, 184, 0.15)';
      if (/灵|中品|上品/.test(g)) { color = '#38bdf8'; bg = 'rgba(56, 189, 248, 0.15)'; }
      else if (/宝|极品/.test(g)) { color = '#c084fc'; bg = 'rgba(192, 132, 252, 0.15)'; }
      else if (/仙|绝品|道/.test(g)) { color = '#fbbf24'; bg = 'rgba(251, 191, 36, 0.15)'; }
      else if (/神|至尊|禁/.test(g)) { color = '#f87171'; bg = 'rgba(248, 113, 113, 0.15)'; }
      return '<span style="font-size: 11px; padding: 1px 6px; border-radius: 4px; color: ' + color + '; background: ' + bg + '; border: 1px solid ' + color + '40;">' + CORE.escapeHtml(g) + '</span>';
    }
  };
