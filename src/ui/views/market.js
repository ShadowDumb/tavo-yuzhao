  function marketRow(avatarName, title, sub, meta, foot, asButton, editTarget) {
    var inner = ava(avatarName) + '<span class="yz-row-copy"><b>' + title + '<i>' + sub + '</i></b><em>' + meta + '</em></span><time>' + foot + '</time>';
    // asButton：玩家域可编辑列表的主区（yz-manage-main 是 flex 按钮，布局与行一致）。
    // 绑 entity-edit 让整行可点进编辑表单，避免「可点无动作」的假 affordance。
    if (asButton) {
      var attrs = ' data-action="entity-edit" data-kind="' + CORE.escapeHtml(editTarget && editTarget.kind || '') + '" data-id="' + CORE.escapeHtml(String(editTarget && editTarget.id || '')) + '"';
      attrs += ' aria-label="' + CORE.escapeHtml(playerActionLabel(I18N.dict().playerEdit, editTarget && editTarget.kind || '', avatarName)) + '"';
      return '<div class="yz-row yz-static yz-manage-row"><button type="button" class="yz-manage-main yz-row-main"' + attrs + '>' + inner + '</button></div>';
    }
    return '<div class="yz-row yz-static">' + inner + '</div>';
  }

  // 角色域只读边界提示条：私有数据页在角色域展示操作归属，避免用户误以为功能缺失。
  function readOnlyHint(text) {
    return '<div class="yz-empty yz-readonly-hint">' + CORE.escapeHtml(text) + '</div>';
  }

  function renderMarket(state, nav, search, tag, player, ui) {
    var t = I18N.dict();
    var market = CORE.safeObject(state.market);
    var kw = searchKw(search);
    nav = nav || { app: 'market', view: 'listings', params: {} };
    var view = (nav.view && nav.view !== 'root') ? nav.view : 'listings';
    if (player && view === 'form') return renderSpaceForm(state, nav, ui);
    var body;
    // 当前 tab 是否有数据：空列表不渲染检索框（纯占位）。
    var hasRows = view === 'orders' ? CORE.safeArray(market.orders, 12).length
      : view === 'requests' ? CORE.safeArray(market.requests, 12).length
      : view === 'auctions' ? CORE.safeArray(market.auctions, 12).length
      : CORE.safeArray(market.listings, 20).length;
    if (view === 'auctions') {
      var auctions = CORE.safeArray(market.auctions, 12).filter(function (auction) {
        return filterMatch(kw, [auction.name, auction.grade, auction.desc, auction.start, auction.current, auction.timeLeft]);
      });
      body = auctions.length ? '<div class="yz-page-list">' + auctions.map(function (auction) {
        return marketRow(auction.name,
          CORE.escapeHtml(auction.name), CORE.escapeHtml(auction.grade || ''),
          '<span class="yz-price">' + CORE.escapeHtml(t.labels.startPrice + ' ' + formatNum(auction.start)) + ' → ' + CORE.escapeHtml(formatNum(auction.current)) + '</span> · ' + CORE.escapeHtml(auction.desc || ''),
          CORE.escapeHtml(auction.timeLeft || '') + '<u class="yz-res">' + CORE.escapeHtml(String(auction.bids || 0)) + ' ' + CORE.escapeHtml(t.labels.bidsUnit) + '</u>');
      }).join('') + '</div>' : '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.auctions) + '</div>';
    } else if (view === 'orders') {
      // 方向显示做归一化（买入/卖出），检索也按显示文案匹配，否则搜「买入」命不中 raw buy/sell。
      var sideLabel = function (side) { return /^(buy|买|求购|购)/i.test(side) ? t.labels.buy : (/^(sell|卖|出售|售)/i.test(side) ? t.labels.sell : side); };
      var orders = CORE.safeArray(market.orders, 12).filter(function (order) {
        return filterMatch(kw, [order.name, order.status, order.price, order.time, order.side, sideLabel(order.side)]);
      });
      body = orders.length ? '<div class="yz-page-list">' + orders.map(function (order) {
        var side = sideLabel(order.side) || '';
        // 买/卖颜色区分：买（支出）蓝、卖（收入）金，与股票面板习惯对齐。
        var sideCls = /^(buy|买|求购|购)/i.test(order.side) ? 'yz-side buy' : 'yz-side sell';
        var row = marketRow(order.name,
          CORE.escapeHtml(order.name), '<span class="' + sideCls + '">' + CORE.escapeHtml(side) + '</span>',
           CORE.escapeHtml(orderStatusLabel(order.status)),
          CORE.escapeHtml(order.time || '') + '<u class="yz-price-tag">' + CORE.escapeHtml(formatNum(order.price)) + '</u>', !!player, player && { kind: 'order', id: order.id });
        // 整行已是 entity-edit 按钮：不再叠加行尾 ✎（双入口同一动作，✎ 冗余）。
        return player ? row : row;
      }).join('') + '</div>' : '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.orders) + '</div>';
    } else if (view === 'requests') {
      // 求购区是公开数据（与行情/拍卖同源，跨域一致）：展示求购公告与出价。
      // 求购行脚下展示「买入 <价>」，检索字段补上该前缀与买入标签，避免搜「买入」命不中。
      var requests = CORE.safeArray(market.requests, 12).filter(function (request) {
        return filterMatch(kw, [request.name, request.grade, request.desc, request.price, request.author, t.labels.buy + ' ' + request.price]);
      });
      body = requests.length ? '<div class="yz-page-list">' + requests.map(function (request) {
        return marketRow(request.name,
          CORE.escapeHtml(request.name), CORE.escapeHtml(request.grade || ''),
          CORE.escapeHtml(request.desc || ''),
          CORE.escapeHtml(request.author || '') + '<u class="yz-price-tag">' + CORE.escapeHtml(t.labels.buy + ' ' + formatNum(request.price)) + '</u>');
      }).join('') + '</div>' : '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.requests) + '</div>';
    } else {
      var listings = CORE.safeArray(market.listings, 20).filter(function (listing) {
        return filterMatch(kw, [listing.name, listing.grade, listing.desc, listing.price, listing.seller]);
      });
      body = listings.length ? '<div class="yz-page-list">' + listings.map(function (listing) {
        return marketRow(listing.name,
          CORE.escapeHtml(listing.name), CORE.escapeHtml(listing.grade || ''),
          CORE.escapeHtml(listing.desc || ''),
          CORE.escapeHtml(listing.seller || '') + '<u class="yz-price-tag">' + CORE.escapeHtml(formatNum(listing.price)) + '</u>');
      }).join('') + '</div>' : '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.listings) + '</div>';
    }
    var cta = view === 'orders' ? playerAddBtn('order', '') : '';
    return '<main class="yz-page-inner" data-marker="market-' + CORE.escapeHtml(view) + '">' + yzHeader(t.features.market, true) +
      yzTabs([['listings', t.tabs.listings], ['requests', t.tabs.requests], ['auctions', t.tabs.auctions], ['orders', t.tabs.orders]], view) + searchBoxIf(hasRows, search) + body + cta + '</main>';
  }

  // 纯数字串加千分位；非纯数字（含单位/文本）原样返回——金额字段是自由文本。
  function formatNum(value) {
    var s = String(value == null ? '' : value).trim();
    if (!/^-?\d+$/.test(s)) return s;
    var neg = s.charAt(0) === '-';
    var digits = neg ? s.slice(1) : s;
    var out = '';
    for (var i = digits.length; i > 0; i -= 3) {
      out = (i >= 3 ? digits.slice(Math.max(0, i - 3), i) : digits.slice(0, i)) + (out ? ',' + out : '');
    }
    return (neg ? '-' : '') + out;
  }
