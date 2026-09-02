  function renderPage(state, nav, flags, ui) {
    nav = nav || { app: 'home', view: 'root', params: {}, stack: [] };
    ui = ui || {};
    var space = ui.space || state;
    var search = ui.search || '';
    var t = I18N.dict();
    var tag = ui.spaceName || '';
    if (nav.app === 'tablet') return renderTablet(space, search, undefined, ui);
    if (nav.app === 'msg') return renderMsg(space, nav, search, flags, ui);
    if (nav.app === 'notes') return renderNotes(space, nav, search, true, ui);
    if (nav.app === 'forum') {
      if (nav.view === 'form') return renderSpaceForm(space, nav, ui);
      return renderForum(space, nav, search, tag, true, ui);
    }
    if (nav.app === 'market') return renderMarket(space, nav, search, tag, true, ui);
    if (nav.app === 'space') return renderSpace(space, nav, search, true, ui);
    if (nav.app === 'map') return renderMap(space, search, tag);
    if (nav.app === 'sync') return '<main class="yz-page-inner" data-marker="sync">' + yzHeader(I18N.dict().diag.title) + renderSyncDetail(space, state) + '</main>';
    if (nav.app === 'manage') return renderManage(state, flags, ui, nav);
    return '';
  }

  function yzHeader(title, tabs, showBack) {
    return '<header class="yz-app-header">' + yzBackButton(showBack !== false) + '<h2 class="yz-page-title" tabindex="-1">' + (tabs ? title : String(title)) + '</h2>' +
      '<span class="yz-spacer"></span></header>';
  }

  function yzTabs(items, active) {
    return '<nav class="yz-tabs" role="tablist">' + items.map(function (item) {
      var selected = active === item[0];
      return '<button type="button" role="tab" class="yz-tab' + (selected ? ' active' : '') + '" aria-selected="' + (selected ? 'true' : 'false') + '" data-action="switch-view" data-view="' + CORE.escapeHtml(item[0]) + '">' + CORE.escapeHtml(item[1]) + '</button>';
    }).join('') + '</nav>';
  }

  function button(action, label, attrs, cls) {
    attrs = attrs || {};
    var extra = Object.keys(attrs).map(function (key) { return ' data-' + key + '="' + CORE.escapeHtml(attrs[key]) + '"'; }).join('');
    return '<button type="button" class="' + CORE.escapeHtml(cls || '') + '" data-action="' + CORE.escapeHtml(action) + '"' + extra + '>' + label + '</button>';
  }

  function yzBackButton(showBack) {
    if (showBack === false) return '';
    return '<button type="button" class="yz-btn yz-back" data-action="back" aria-label="' + CORE.escapeHtml(I18N.dict().back) + '">‹</button>';
  }

  var VIEWS = {
    FEATURES: FEATURES,
    renderHome: renderHome,
    renderTablet: renderTablet,
    renderMsg: renderMsg,
    renderNotes: renderNotes,
    renderForum: renderForum,
    renderMarket: renderMarket,
    renderSpace: renderSpace,
    renderMap: renderMap,
    renderManage: renderManage,
    renderPage: renderPage,
    renderSyncDetail: renderSyncDetail,
    renderSpaceForm: renderSpaceForm,
    renderNodes: renderNodes,
    syncStatusOf: syncStatusOf,
    formatDateTime: CORE.formatDateTime,
    snapshotUsage: snapshotUsage,
    unreadTotal: unreadTotal,
    nodeBadge: nodeBadge,
    nextWipeState: nextWipeState,
    WIPE_CONFIRM_MS: WIPE_CONFIRM_MS,
    fieldValue: fieldValue,
    groupName: groupName,
    fieldName: fieldName,
    searchKw: searchKw,
    searchBox: searchBox
  };
