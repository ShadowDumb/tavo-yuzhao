  function renderTablet(state, search, emptyText, ui) {
    var t = I18N.dict();
    ui = ui || {};
    var openGroups = ui.tabletOpenGroups;
    var tablet = state.tablet || CORE.blankTablet();
    var kw = searchKw(search);
    var body = '';
    if (CORE.safeArray(tablet.groups, 10).length) {
      var name = tablet.name || fieldValue(tablet, 'basic', 'name');
      var realm = fieldValue(tablet, 'cult', 'realm');
      body = '<div class="yz-hero"><div class="yz-ava">' + CORE.escapeHtml(String(name || t.avaFallback).slice(0, 1)) + '</div><div><b>' + CORE.escapeHtml(name || t.features.tablet) + '</b><small>' + CORE.escapeHtml(realm || '') + '</small></div></div>';
      // 达标fail-state：六组中未达标的组以占位行呈现（页内看到「缺了什么」），并给部分同步提示。
      var present = {};
      var groupById = {};
      CORE.safeArray(tablet.groups, 10).forEach(function (g) { present[g.id] = true; groupById[g.id] = g; });
      // 与 assessTablet 同口径的缺组判定：基本四必要条件、仪容两项、修为四项、其余内容组至少一条。
      function groupFull(id) {
        var g = groupById[id];
        var fields = CORE.safeArray(g && g.fields, 30);
        var keys = {};
        fields.forEach(function (f) { if (f && f.key) keys[CORE.keyId(f.key) || String(f.key).toLowerCase()] = true; });
        if (id === 'basic') return ['name', 'gender', 'height', 'weight'].every(function (k) { return keys[k]; });
        if (id === 'look') return ['appearance', 'clothing'].every(function (k) { return keys[k]; });
        if (id === 'cult') return ['root', 'body', 'realm', 'status'].every(function (k) { return keys[k]; });
        return fields.length >= 1;
      }
      var pending = GROUP_ORDER.filter(function (id) { return present[id] !== true || !groupFull(id); });
      if (pending.length) body += '<div class="yz-empty yz-readonly-hint">' + CORE.escapeHtml(t.tabletPartial) + '</div>';
      // 缺失或缺内容的组给浅色占位行（待同步），与「检索过滤掉」区分。
      pending.forEach(function (id) {
        if (!kw) body += '<section class="yz-group yz-group-pending"><h3>' + CORE.escapeHtml(groupName(id)) + '</h3><div class="yz-field"><small>' + CORE.escapeHtml(t.tabletPendingGroup) + '</small><p class="yz-dim">—</p></div></section>';
      });
      var groups = GROUP_ORDER.map(function (id) {
        var g = groupById[id] || { id: id, fields: [] };
        return { id: id, fields: CORE.safeArray(g.fields, 30).filter(function (field) {
          // 检索同时命中原始键/显示标签/值：显示层本地化后，用户看到的标签也要可命中。
          return filterMatch(kw, [field.key, fieldName(field.key), field.value]);
        }) };
      });
      groups.forEach(function (group) {
        if (!group.fields.length) return;
        // 组折叠 + 计数：字段多的玉牌页可收起长组；重渲染时由 App 恢复用户选择。
        var groupOpen = !openGroups || !Object.prototype.hasOwnProperty.call(openGroups, group.id) || openGroups[group.id] === true;
        body += '<details class="yz-group" data-group-id="' + CORE.escapeHtml(group.id) + '"' + (groupOpen ? ' open' : '') + '><summary><h3>' + CORE.escapeHtml(groupName(group.id)) + '<i class="yz-group-count">' + String(group.fields.length) + '</i></summary>' + group.fields.map(function (field) {
          return '<div class="yz-field"><small>' + CORE.escapeHtml(fieldName(field.key)) + '</small><p>' + CORE.escapeHtml(field.value) + '</p></div>';
        }).join('') + '</details>';
      });
      if (kw && !groups.some(function (g) { return g.fields.length; })) body += '<div class="yz-empty">' + CORE.escapeHtml(t.searchNoMatch) + '</div>';
    } else {
      body = '<div class="yz-empty">' + CORE.escapeHtml(emptyText || t.emptyTablet) + '</div>';
    }
    return '<main class="yz-page-inner" data-marker="tablet">' +
      yzHeader(t.features.tablet) + searchBoxIf(CORE.safeArray(tablet.groups, 10).length, search) + body + '</main>';
  }

