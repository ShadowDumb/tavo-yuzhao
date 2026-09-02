  function renderSpace(state, nav, search, player, ui) {
    var t = I18N.dict();
    var space = CORE.safeObject(state.space);
    var kw = searchKw(search);
    nav = nav || { app: 'space', view: 'items', params: {} };
    var view = (nav.view && nav.view !== 'root') ? nav.view : 'items';
    if (player && view === 'form') return renderSpaceForm(state, nav, ui);
    var body;
    if (view === 'currencies') {
      var currencies = CORE.safeArray(space.currencies, 10).filter(function (currency) {
        return filterMatch(kw, [currency.kind, currency.amount]);
      });
      body = currencies.length ? '<div class="yz-page-list">' + currencies.map(function (currency) {
        var inner = '<span class="yz-coin">◈</span><span class="yz-row-copy"><b>' + CORE.escapeHtml(currency.kind) + '</b></span><time class="yz-amount">' + CORE.escapeHtml(formatNum(currency.amount)) + '</time>';
        var row = player
           ? '<div class="yz-row yz-static yz-manage-row"><button type="button" class="yz-manage-main yz-row-main" data-action="entity-edit" data-kind="currency" data-id="' + CORE.escapeHtml(String(currency.kind)) + '" aria-label="' + CORE.escapeHtml(playerActionLabel(t.playerEdit, 'currency', currency.kind, t)) + '">' + inner + '</button></div>'
          : '<div class="yz-row yz-static">' + inner + '</div>';
        // 整行已是 entity-edit 按钮：不再叠加行尾 ✎（双入口冗余）。
        return row;
      }).join('') + '</div>' : '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.currencies) + '</div>';
    } else {
      var items = CORE.safeArray(space.items, 30).filter(function (item) {
        return filterMatch(kw, [item.name, item.grade, item.desc]);
      });
      body = items.length ? '<div class="yz-page-list">' + items.map(function (item) {
        // qty=0 也要显示（0 是合法数量）：恒输出数字；qtyText（如「三枚」）优先。
        var qtyShown = item.qtyText || String(Number(item.qty) || 0);
        var row = marketRow(item.name,
          CORE.escapeHtml(item.name), CORE.escapeHtml(item.grade || ''),
          CORE.escapeHtml(item.desc || ''),
          CORE.escapeHtml(qtyShown), !!player, player && { kind: 'item', id: item.id });
        // 整行已是 entity-edit 按钮：不再叠加行尾 ✎（双入口冗余）。
        return row;
      }).join('') + '</div>' : '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.items) + '</div>';
    }
    var cta = playerAddBtn(view === 'currencies' ? 'currency' : 'item', '');
    var hasRows = view === 'currencies' ? CORE.safeArray(space.currencies, 10).length : CORE.safeArray(space.items, 30).length;
    return '<main class="yz-page-inner" data-marker="space-' + CORE.escapeHtml(view) + '">' + yzHeader(t.features.space, true) +
      yzTabs([['items', t.tabs.items], ['currencies', t.tabs.currencies]], view) + searchBoxIf(hasRows, search) + body + cta + '</main>';
  }
