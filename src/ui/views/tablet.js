  /* ---------- UI views / jade tablet (Qian) ---------- */
  var VIEWS_TABLET = {
    render: function (ctx) {
      var runtime = ctx.runtime;
      var state = ctx.state;
      var tr = ctx.tr || function (k) { return k; };
      var space = runtime ? runtime.activeSpace() : null;
      var tablet = (space && space.tablet) || {};

      var headerHtml = VIEWS_SHARED.renderHeader({
        title: tr('runtime.feature.tablet') || '本命玉牌',
        subtitle: '乾卦 · 天 · 角色根本气运',
        icon: '☰',
        actions: [
          { id: 'yz-btn-add-field', label: '新增属性', primary: true }
        ]
      });

      var groups = [
        { key: 'basic', label: tr('runtime.group.basic') || '基本', desc: '形体本源' },
        { key: 'look',  label: tr('runtime.group.look') || '仪容',  desc: '仙姿神貌' },
        { key: 'cult',  label: tr('runtime.group.cult') || '修为',  desc: '灵根境界' },
        { key: 'gong',  label: tr('runtime.group.gong') || '功法',  desc: '绝学法诀' },
        { key: 'bond',  label: tr('runtime.group.bond') || '羁绊',  desc: '红尘仙缘' },
        { key: 'secret',label: tr('runtime.group.secret') || '隐秘',desc: '天机不传' }
      ];

      var search = state.searchQuery;
      var totalFields = 0;

      var groupsHtml = groups.map(function (g) {
        var groupObj = CORE.safeArray(tablet.groups, 10).find(function (item) { return item && item.id === g.key; });
        var fields = CORE.safeArray(groupObj ? groupObj.fields : tablet[g.key], 50);
        if (search) {
          fields = fields.filter(function (f) {
            return (f.key && f.key.toLowerCase().indexOf(search) >= 0) ||
                   (f.value && f.value.toLowerCase().indexOf(search) >= 0);
          });
        }
        totalFields += fields.length;

        var itemsHtml = fields.length === 0
          ? '<div style="font-size: 12px; color: var(--yz-text-muted); padding: 6px 0;">暂无刻录</div>'
          : fields.map(function (f) {
              return '<div class="yz-field-item" data-key="' + CORE.escapeHtml(f.key || '') + '" data-group="' + g.key + '" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-radius: 8px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.04); font-size: 13px; cursor: pointer;">' +
                '<span style="color: var(--yz-text-secondary); font-weight: 500;">' + CORE.escapeHtml(f.key) + '</span>' +
                '<span style="color: var(--yz-text-primary); text-align: right; max-width: 60%; word-break: break-word;">' + CORE.escapeHtml(f.value) + '</span>' +
              '</div>';
            }).join('');

        return '<div class="yz-card" style="border-top: 2px solid var(--yz-gua-qian);">' +
          '<div class="yz-card-header">' +
            '<span class="yz-card-title">' + CORE.escapeHtml(g.label) + '</span>' +
            '<span style="font-size: 11px; color: var(--yz-text-muted);">' + CORE.escapeHtml(g.desc) + '</span>' +
          '</div>' +
          '<div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">' + itemsHtml + '</div>' +
        '</div>';
      }).join('');

      return '<div class="yz-subview">' +
        headerHtml +
        VIEWS_SHARED.renderSearchBar('搜索玉牌属性/境界/功法...', state.searchQuery) +
        (totalFields === 0 && search ? VIEWS_SHARED.renderEmpty('未找到匹配的玉牌属性') : ('<div class="yz-card-grid">' + groupsHtml + '</div>')) +
      '</div>';
    },

    bindEvents: function (el, ctx) {
      var forms = ctx.forms;
      var state = ctx.state;
      var shell = ctx.shell;
      var runtime = ctx.runtime;

      var addBtn = el.querySelector('#yz-btn-add-field');
      if (addBtn && forms) {
        addBtn.addEventListener('click', function () {
          forms.openTabletFieldForm();
        });
      }

      var searchInput = el.querySelector('.yz-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', function () {
          state.searchQuery = String(searchInput.value || '').trim().toLowerCase();
          shell.render();
        });
      }

      var items = el.querySelectorAll('.yz-field-item');
      items.forEach(function (item) {
        item.addEventListener('click', function () {
          var key = item.getAttribute('data-key');
          var group = item.getAttribute('data-group');
          var space = runtime ? runtime.activeSpace() : null;
          var tablet = (space && space.tablet) || {};
          var groupObj = CORE.safeArray(tablet.groups, 10).find(function (item) { return item && item.id === group; });
          var list = (groupObj ? groupObj.fields : tablet[group]) || [];
          var target = list.find(function (f) { return String(f.key) === String(key); });
          if (target && forms) {
            forms.openTabletFieldForm(Object.assign({ group: group }, target));
          }
        });
      });
    }
  };
