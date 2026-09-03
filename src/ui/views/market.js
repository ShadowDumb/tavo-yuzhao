  /* ---------- UI views / market (Zhen) ---------- */
  var VIEWS_MARKET = {
    render: function (ctx) {
      var runtime = ctx.runtime;
      var state = ctx.state;
      var tr = ctx.tr || function (k) { return k; };
      var space = runtime ? runtime.activeSpace() : null;
      var market = (space && space.market) || { listings: [], auctions: [], orders: [], requests: [] };

      var tab = state.activeTab || 'listings';

      var headerHtml = VIEWS_SHARED.renderHeader({
        title: tr('runtime.feature.market') || '交易坊市',
        subtitle: '震卦 · 雷 · 仙市万象',
        icon: '☳',
        actions: [
          { id: 'yz-btn-market-new', label: '坊市上架', primary: true }
        ]
      });

      var tabs = [
        { id: 'listings', label: tr('runtime.tab.listings') || '坊市行情', badge: market.listings ? market.listings.length : 0 },
        { id: 'auctions', label: tr('runtime.tab.auctions') || '珍宝拍卖', badge: market.auctions ? market.auctions.length : 0 },
        { id: 'orders',   label: tr('runtime.tab.orders') || '交易订单', badge: market.orders ? market.orders.length : 0 },
        { id: 'requests', label: tr('runtime.tab.requests') || '灵材求购', badge: market.requests ? market.requests.length : 0 }
      ];

      var search = state.searchQuery;
      var listHtml = '';

      if (tab === 'listings') {
        var items = CORE.safeArray(market.listings, 100);
        if (search) {
          items = items.filter(function (i) {
            return (i.name && i.name.toLowerCase().indexOf(search) >= 0) ||
                   (i.seller && i.seller.toLowerCase().indexOf(search) >= 0) ||
                   (i.desc && i.desc.toLowerCase().indexOf(search) >= 0);
          });
        }
        if (items.length === 0) listHtml = VIEWS_SHARED.renderEmpty('暂无在售法宝丹药');
        else {
          listHtml = '<div class="yz-card-grid">' + items.map(function (it) {
            return '<div class="yz-card" style="border-top: 2px solid var(--yz-gua-zhen);">' +
              '<div class="yz-card-header">' +
                '<span class="yz-card-title">' + CORE.escapeHtml(it.name) + '</span>' +
                VIEWS_SHARED.renderGradeBadge(it.grade) +
              '</div>' +
              '<div class="yz-card-body">' + CORE.escapeHtml(it.desc || '品相完好，灵气充足') + '</div>' +
              '<div class="yz-card-footer">' +
                '<span>掌柜：' + CORE.escapeHtml(it.seller || '散修') + '</span>' +
                '<span style="color: var(--yz-gold-accent); font-weight: 600; font-size: 13px;">' + CORE.escapeHtml(it.price || '面议') + '</span>' +
              '</div>' +
            '</div>';
          }).join('') + '</div>';
        }
      } else if (tab === 'auctions') {
        var auctions = CORE.safeArray(market.auctions, 50);
        if (auctions.length === 0) listHtml = VIEWS_SHARED.renderEmpty('近期无天阶拍卖');
        else {
          listHtml = '<div class="yz-card-grid">' + auctions.map(function (a) {
            return '<div class="yz-card" style="border-top: 2px solid var(--yz-gold-accent);">' +
              '<div class="yz-card-header">' +
                '<span class="yz-card-title">' + CORE.escapeHtml(a.name) + '</span>' +
                VIEWS_SHARED.renderGradeBadge(a.grade || '珍品') +
              '</div>' +
              '<div style="font-size: 13px; color: var(--yz-text-secondary); line-height: 1.6;">' +
                '<div>当前出价：<span style="color: var(--yz-gold-accent); font-weight: 700;">' + CORE.escapeHtml(a.currentPrice || a.startPrice) + '</span></div>' +
                '<div style="font-size: 12px; color: var(--yz-text-muted);">起拍价：' + CORE.escapeHtml(a.startPrice || '-') + ' · 出价人次：' + (a.bidders || 0) + '</div>' +
              '</div>' +
              '<div class="yz-card-footer">' +
                '<span style="color: var(--yz-danger);">倒计时：' + CORE.escapeHtml(a.timeLeft || '竞价中') + '</span>' +
              '</div>' +
            '</div>';
          }).join('') + '</div>';
        }
      } else if (tab === 'orders') {
        var orders = CORE.safeArray(market.orders, 50);
        if (orders.length === 0) listHtml = VIEWS_SHARED.renderEmpty('暂无交易契约订单');
        else {
          listHtml = '<div style="display: flex; flex-direction: column; gap: 8px;">' + orders.map(function (o) {
            var statusColor = o.status === '已完成' ? '#10b981' : (o.status === '已取消' ? '#f87171' : '#fbbf24');
            return '<div class="yz-card" style="flex-direction: row; align-items: center; justify-content: space-between;">' +
              '<div>' +
                '<div style="font-weight: 600; font-size: 14px; color: var(--yz-text-primary);">' + CORE.escapeHtml(o.item || o.name) + '</div>' +
                '<div style="font-size: 12px; color: var(--yz-text-muted); margin-top: 2px;">买方：' + CORE.escapeHtml(o.buyer || '-') + ' · 卖方：' + CORE.escapeHtml(o.seller || '-') + '</div>' +
              '</div>' +
              '<div style="text-align: right;">' +
                '<div style="color: var(--yz-gold-accent); font-weight: 600;">' + CORE.escapeHtml(o.price || '-') + '</div>' +
                '<span style="font-size: 11px; padding: 1px 6px; border-radius: 4px; color: ' + statusColor + '; border: 1px solid ' + statusColor + '40; background: ' + statusColor + '15;">' + CORE.escapeHtml(o.status || '进行中') + '</span>' +
              '</div>' +
            '</div>';
          }).join('') + '</div>';
        }
      } else {
        var reqs = CORE.safeArray(market.requests, 50);
        if (reqs.length === 0) listHtml = VIEWS_SHARED.renderEmpty('暂无求购悬赏');
        else {
          listHtml = '<div class="yz-card-grid">' + reqs.map(function (r) {
            return '<div class="yz-card">' +
              '<div class="yz-card-header">' +
                '<span class="yz-card-title">' + CORE.escapeHtml(r.item || r.name) + '</span>' +
                '<span style="color: var(--yz-gold-accent); font-size: 12px; font-weight: 600;">赏金：' + CORE.escapeHtml(r.price || '面议') + '</span>' +
              '</div>' +
              '<div class="yz-card-body">' + CORE.escapeHtml(r.desc || '诚心求购，有货道友速速传音') + '</div>' +
              '<div class="yz-card-footer">' +
                '<span>求购人：' + CORE.escapeHtml(r.buyer || '匿名道友') + '</span>' +
              '</div>' +
            '</div>';
          }).join('') + '</div>';
        }
      }

      return '<div class="yz-subview">' +
        headerHtml +
        VIEWS_SHARED.renderTabs(tabs, tab) +
        VIEWS_SHARED.renderSearchBar('搜索坊市宝物/品阶/掌柜...', state.searchQuery) +
        listHtml +
      '</div>';
    },

    bindEvents: function (el, ctx) {
      var navigation = ctx.navigation;
      var forms = ctx.forms;

      var tabBtns = el.querySelectorAll('.yz-tab-btn');
      tabBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var t = btn.getAttribute('data-tab');
          if (t) navigation.setTab(t);
        });
      });

      var newBtn = el.querySelector('#yz-btn-market-new');
      if (newBtn && forms) {
        newBtn.addEventListener('click', function () {
          forms.openItemForm();
        });
      }
    }
  };
