  /* ---------- UI views / notes (Li) ---------- */
  var VIEWS_NOTES = {
    render: function (ctx) {
      var runtime = ctx.runtime;
      var state = ctx.state;
      var tr = ctx.tr || function (k) { return k; };
      var space = runtime ? runtime.activeSpace() : null;
      var notesData = (space && space.notes) || { folders: [], notes: [] };

      var folders = CORE.safeArray(notesData.folders, 50);
      var allNotes = CORE.safeArray(notesData.notes, 100);

      var activeFolderId = state.activeTab || (folders.length > 0 ? String(folders[0].id) : 'all');

      var headerHtml = VIEWS_SHARED.renderHeader({
        title: tr('runtime.feature.notes') || '记事玉册',
        subtitle: '离卦 · 火 · 文明刻录',
        icon: '☲',
        actions: [
          { id: 'yz-btn-add-note', label: '新建刻录', primary: true }
        ]
      });

      var tabs = [{ id: 'all', label: '全部卷轴', badge: allNotes.length }];
      folders.forEach(function (f) {
        var count = allNotes.filter(function (n) { return String(n.folderId) === String(f.id); }).length;
        tabs.push({ id: String(f.id), label: f.name || '分类', badge: count });
      });

      var search = state.searchQuery;
      var filteredNotes = allNotes;
      if (activeFolderId !== 'all') {
        filteredNotes = filteredNotes.filter(function (n) { return String(n.folderId) === String(activeFolderId); });
      }
      if (search) {
        filteredNotes = filteredNotes.filter(function (n) {
          return (n.title && n.title.toLowerCase().indexOf(search) >= 0) ||
                 (n.body && n.body.toLowerCase().indexOf(search) >= 0);
        });
      }

      var cardsHtml = '';
      if (filteredNotes.length === 0) {
        cardsHtml = VIEWS_SHARED.renderEmpty(search ? '未找到对应玉册记事' : '此分类尚无刻录条目');
      } else {
        cardsHtml = '<div class="yz-card-grid">' +
          filteredNotes.map(function (n) {
            var isLocked = !!n.locked;
            var folderObj = folders.find(function (f) { return String(f.id) === String(n.folderId); });
            var folderName = folderObj ? folderObj.name : '未分类';

            return '<div class="yz-card yz-note-card" data-id="' + CORE.escapeHtml(n.id) + '" style="border-top: 2px solid var(--yz-gua-li); cursor: pointer;">' +
              '<div class="yz-card-header">' +
                '<span class="yz-card-title" style="display: flex; align-items: center; gap: 6px;">' +
                  (isLocked ? '<span style="font-size: 13px;" title="禁制加锁">🔒</span>' : '') +
                  CORE.escapeHtml(n.title || '无题') +
                '</span>' +
                '<span style="font-size: 11px; padding: 1px 6px; border-radius: 4px; background: rgba(248, 113, 113, 0.15); color: var(--yz-danger); border: 1px solid rgba(248, 113, 113, 0.3);">' + CORE.escapeHtml(folderName) + '</span>' +
              '</div>' +
              '<div class="yz-card-body" style="white-space: pre-wrap; max-height: 120px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;">' +
                CORE.escapeHtml(n.body || '') +
              '</div>' +
              '<div class="yz-card-footer">' +
                '<span>' + CORE.escapeHtml(n.time || '') + '</span>' +
                '<div style="display: flex; gap: 6px;">' +
                  '<button class="yz-btn-note-edit yz-btn-icon" data-id="' + CORE.escapeHtml(n.id) + '" style="width: 24px; height: 24px;" title="编辑">✎</button>' +
                  '<button class="yz-btn-note-del yz-btn-icon" data-id="' + CORE.escapeHtml(n.id) + '" data-name="' + CORE.escapeHtml(n.title || '') + '" style="width: 24px; height: 24px; color: var(--yz-danger);" title="删除">🗑</button>' +
                '</div>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>';
      }

      return '<div class="yz-subview">' +
        headerHtml +
        VIEWS_SHARED.renderTabs(tabs, activeFolderId) +
        VIEWS_SHARED.renderSearchBar('搜索记事玉册标题/内容...', state.searchQuery) +
        cardsHtml +
      '</div>';
    },

    bindEvents: function (el, ctx) {
      var state = ctx.state;
      var forms = ctx.forms;
      var dataActions = ctx.dataActions;
      var navigation = ctx.navigation;
      var runtime = ctx.runtime;

      var addBtn = el.querySelector('#yz-btn-add-note');
      if (addBtn && forms) {
        addBtn.addEventListener('click', function () {
          forms.openNoteForm({ folderId: state.activeTab !== 'all' ? state.activeTab : '默认' });
        });
      }

      var tabBtns = el.querySelectorAll('.yz-tab-btn');
      tabBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var t = btn.getAttribute('data-tab');
          if (t) navigation.setTab(t);
        });
      });

      var editBtns = el.querySelectorAll('.yz-btn-note-edit');
      editBtns.forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var id = btn.getAttribute('data-id');
          var space = runtime ? runtime.activeSpace() : null;
          var notes = (space && space.notes && space.notes.notes) || [];
          var target = notes.find(function (n) { return String(n.id) === String(id); });
          if (target && forms) forms.openNoteForm(target);
        });
      });

      var delBtns = el.querySelectorAll('.yz-btn-note-del');
      delBtns.forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var id = btn.getAttribute('data-id');
          var name = btn.getAttribute('data-name');
          if (id && dataActions) dataActions.deleteEntity('note', id, null, name);
        });
      });
    }
  };
