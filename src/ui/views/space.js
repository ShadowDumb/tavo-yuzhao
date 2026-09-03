  /* ---------- UI views / pocket space (Kan) ---------- */
  var VIEWS_SPACE = {
    render: function (ctx) {
      var runtime = ctx.runtime;
      var state = ctx.state;
      var tr = ctx.tr || function (k) { return k; };
      var space = runtime ? runtime.activeSpace() : null;
      var spaceData = (space && space.space) || { currencies: [], items: [] };

      var tab = state.activeTab || 'items';

      var headerHtml = VIEWS_SHARED.renderHeader({
        title: tr('runtime.feature.space') || '芥子空间',
        subtitle: '坎卦 · 水 · 须弥藏物',
        icon: '☵',
        actions: [
          { id: 'yz-btn-add-item', label: tab === 'currencies' ? '存入钱财' : '收纳宝物', primary: true }
        ]
      });

      var tabs = [
        { id: 'items', label: tr('runtime.tab.items') || '法宝储物', badge: spaceData.items ? spaceData.items.length : 0 },
        { id: 'currencies', label: tr('runtime.tab.currencies') || '灵石钱财', badge: spaceData.currencies ? spaceData.currencies.length : 0 }
      ];

      var search = state.searchQuery;
      var listHtml = '';

      if (tab === 'items') {
        var items = CORE.safeArray(spaceData.items, 150);
        if (search) {
          items = items.filter(function (i) {
            return (i.name && i.name.toLowerCase().indexOf(search) >= 0) ||
                   (i.grade && i.grade.toLowerCase().indexOf(search) >= 0) ||
                   (i.desc && i.desc.toLowerCase().indexOf(search) >= 0);
          });
        }

        if (items.length === 0) listHtml = VIEWS_SHARED.renderEmpty(search ? '未找到对应法宝' : '芥子空间尚无储物');
        else {
          listHtml = '<div class="yz-card-grid">' + items.map(function (it) {
            return '<div class="yz-card" style="border-top: 2px solid var(--yz-gua-kan);">' +
              '<div class="yz-card-header">' +
                '<span class="yz-card-title">' + CORE.escapeHtml(it.name) + '</span>' +
                '<div style="display: flex; align-items: center; gap: 6px;">' +
                  VIEWS_SHARED.renderGradeBadge(it.grade) +
                  '<span style="font-size: 12px; font-weight: 700; color: var(--yz-jade-light); background: rgba(52, 211, 153, 0.15); padding: 1px 6px; border-radius: 4px;">x' + (it.qty != null ? it.qty : (it.count || 1)) + '</span>' +
                '</div>' +
              '</div>' +
              '<div class="yz-card-body">' + CORE.escapeHtml(it.desc || '静置于芥子空间内') + '</div>' +
              '<div class="yz-card-footer">' +
                '<span>品阶：' + CORE.escapeHtml(it.grade || '凡品') + '</span>' +
                '<div style="display: flex; gap: 6px;">' +
                  '<button class="yz-btn-item-edit yz-btn-icon" data-id="' + CORE.escapeHtml(it.id) + '" style="width: 24px; height: 24px;" title="编辑">✎</button>' +
                  '<button class="yz-btn-item-del yz-btn-icon" data-id="' + CORE.escapeHtml(it.id) + '" data-name="' + CORE.escapeHtml(it.name || '') + '" style="width: 24px; height: 24px; color: var(--yz-danger);" title="取出丢弃">🗑</button>' +
                '</div>' +
              '</div>' +
            '</div>';
          }).join('') + '</div>';
        }
      } else {
        var curs = CORE.safeArray(spaceData.currencies, 50);
        if (curs.length === 0) listHtml = VIEWS_SHARED.renderEmpty('囊中羞涩，暂无灵石入账');
        else {
          listHtml = '<div class="yz-card-grid">' + curs.map(function (c) {
            return '<div class="yz-card" style="border-top: 2px solid var(--yz-gold-accent);">' +
              '<div class="yz-card-header">' +
                '<span class="yz-card-title">' + CORE.escapeHtml(c.kind) + '</span>' +
                '<span style="font-size: 18px; font-weight: 700; color: var(--yz-gold-accent); font-family: var(--yz-font-serif);">' + CORE.escapeHtml(c.amount || '0') + '</span>' +
              '</div>' +
              '<div class="yz-card-footer">' +
                '<span>流通钱财</span>' +
                '<div style="display: flex; gap: 6px;">' +
                  '<button class="yz-btn-cur-edit yz-btn-icon" data-id="' + CORE.escapeHtml(c.id) + '" style="width: 24px; height: 24px;" title="调整数额">✎</button>' +
                  '<button class="yz-btn-cur-del yz-btn-icon" data-id="' + CORE.escapeHtml(c.id) + '" data-name="' + CORE.escapeHtml(c.kind || '') + '" style="width: 24px; height: 24px; color: var(--yz-danger);" title="移除">🗑</button>' +
                '</div>' +
              '</div>' +
            '</div>';
          }).join('') + '</div>';
        }
      }

      return '<div class="yz-subview">' +
        headerHtml +
        VIEWS_SHARED.renderTabs(tabs, tab) +
        VIEWS_SHARED.renderSearchBar('搜索芥子空间物品/法宝/灵石...', state.searchQuery) +
        listHtml +
      '</div>';
    },

    bindEvents: function (el, ctx) {
      var state = ctx.state;
      var navigation = ctx.navigation;
      var forms = ctx.forms;
      var dataActions = ctx.dataActions;
      var runtime = ctx.runtime;

      var tabBtns = el.querySelectorAll('.yz-tab-btn');
      tabBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var t = btn.getAttribute('data-tab');
          if (t) navigation.setTab(t);
        });
      });

      var addBtn = el.querySelector('#yz-btn-add-item');
      if (addBtn && forms) {
        addBtn.addEventListener('click', function () {
          if (state.activeTab === 'currencies') forms.openCurrencyForm();
          else forms.openItemForm();
        });
      }

      var editItemBtns = el.querySelectorAll('.yz-btn-item-edit');
      editItemBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-id');
          var space = runtime ? runtime.activeSpace() : null;
          var items = (space && space.space && space.space.items) || [];
          var target = items.find(function (it) { return String(it.id) === String(id); });
          if (target && forms) forms.openItemForm(target);
        });
      });

      var delItemBtns = el.querySelectorAll('.yz-btn-item-del');
      delItemBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-id');
          var name = btn.getAttribute('data-name');
          if (id && dataActions) dataActions.deleteEntity('item', id, null, name);
        });
      });

      var editCurBtns = el.querySelectorAll('.yz-btn-cur-edit');
      editCurBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-id');
          var space = runtime ? runtime.activeSpace() : null;
          var curs = (space && space.space && space.space.currencies) || [];
          var target = curs.find(function (c) { return String(c.id) === String(id); });
          if (target && forms) forms.openCurrencyForm(target);
        });
      });

      var delCurBtns = el.querySelectorAll('.yz-btn-cur-del');
      delCurBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-id');
          var name = btn.getAttribute('data-name');
          if (id && dataActions) dataActions.deleteEntity('currency', id, null, name);
        });
      });
    }
  };
