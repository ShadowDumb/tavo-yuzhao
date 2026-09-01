  function renderNotes(state, nav, search, player, ui) {
    var t = I18N.dict();
    var notes = CORE.safeObject(state.notes);
    var kw = searchKw(search);
    nav = nav || { app: 'notes', view: 'folders', params: {} };
    var view = (nav.view && nav.view !== 'root') ? nav.view : 'folders';
    if (player && view === 'form') return renderSpaceForm(state, nav, ui);
    if (view === 'note') {
      var rowNote = null;
      CORE.safeArray(notes.notes, 30).forEach(function (note) { if (String(note.id) === String(nav.params && nav.params.id)) rowNote = note; });
      if (!rowNote) return '<main class="yz-page-inner" data-marker="note-detail">' + yzHeader(t.features.notes) + '<div class="yz-empty">' + CORE.escapeHtml(t.guards.note) + '</div></main>';
      // 详情页直接提供编辑与删除（删除走两击确认，与表单页一致）——否则删除要经表单，
      // 用户从详情页找不到删除入口。
      var actions = '';
      if (player) {
        var noteArmed = !!(ui && ui.armed && ui.armed.id === 'note:' + String(rowNote.id));
        actions = '<div class="yz-form-actions">' +
          '<button type="button" class="yz-send" data-action="entity-edit" data-kind="note" data-id="' + CORE.escapeHtml(rowNote.id) + '">' + CORE.escapeHtml(t.playerEdit) + '</button>' +
          '<button type="button" class="yz-clear-btn' + (noteArmed ? ' armed' : '') + '" data-action="entity-delete" data-kind="note" data-id="' + CORE.escapeHtml(rowNote.id) + '"' + (noteArmed ? ' data-wipe-base="' + CORE.escapeHtml(t.playerDeleteConfirm) + '"' : '') + '>' + CORE.escapeHtml(noteArmed ? t.playerDeleteConfirm : t.playerDelete) + '</button>' +
          '</div>';
      }
      return '<main class="yz-page-inner" data-marker="note-detail">' +
        yzHeader(t.features.notes) +
        '<div class="yz-note-paper"><small>' + (rowNote.locked ? CORE.escapeHtml(t.labels.locked) : '') + '</small><h2>' + CORE.escapeHtml(rowNote.title) + '</h2><time>' + CORE.escapeHtml(rowNote.updated || '') + '</time><p>' + CORE.escapeHtml(rowNote.body) + '</p></div>' +
        actions +
        '</main>';
    }
    if (view === 'folder') {
      var folder = null;
      CORE.safeArray(notes.folders, 10).forEach(function (f) { if (String(f.id) === String(nav.params && nav.params.id)) folder = f; });
       if (!folder) return '<main class="yz-page-inner" data-marker="notes-list">' + yzHeader(t.features.notes) + '<div class="yz-empty">' + CORE.escapeHtml(t.guards.notes) + '</div></main>';
      var rows = CORE.safeArray(notes.notes, 30).filter(function (note) {
        return String(note.folderId) === String(folder.id) && filterMatch(kw, [note.title, note.body]);
      });
      var list = rows.length ? rows.map(function (note) {
        // 玩家域行主区复用角色域的 yz-note-row 竖向卡片布局（标题/正文单行省略/时间独立行），
        // editableListRow 负责包裹行尾编辑按钮——避免 yz-manage-main 横排挤压破版。
        var inner = '<b>' + (note.locked ? '🔒 ' : '') + CORE.escapeHtml(note.title) + '</b><p>' + CORE.escapeHtml(note.body) + '</p><time>' + CORE.escapeHtml(note.updated || '') + '</time>';
        if (player) return editableListRow(button('navigate', inner, { view: 'note', id: note.id }, 'yz-note-row'), 'note', note.id);
        return button('navigate', inner, { view: 'note', id: note.id }, 'yz-note-row');
      }).join('') : '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.notes) + '</div>';
      var cta = player ? playerAddBtn('note', folder.id) : '';
      return '<main class="yz-page-inner" data-marker="notes-list">' +
        yzHeader(CORE.escapeHtml(folder.name)) + searchBoxIf(CORE.safeArray(notes.notes, 30).length, search) + '<div class="yz-page-list">' + list + '</div>' + cta + '</main>';
    }
    var folderCards = CORE.safeArray(notes.folders, 10).filter(function (f) {
      return filterMatch(kw, [f.name]);
    }).map(function (f) {
      var main = button('navigate', '<span class="yz-folder-glyph">📁</span><span class="yz-row-copy"><b>' + CORE.escapeHtml(f.name) + '</b><em>' + CORE.escapeHtml(String(f.count || 0) + ' ' + t.labels.notesWord) + '</em></span>', { view: 'folder', id: f.id }, 'yz-manage-main');
      return player ? editableListRow(main, 'folder', f.id) : button('navigate', '<span class="yz-folder-glyph">📁</span><span class="yz-row-copy"><b>' + CORE.escapeHtml(f.name) + '</b><em>' + CORE.escapeHtml(String(f.count || 0) + ' ' + t.labels.notesWord) + '</em></span>', { view: 'folder', id: f.id }, 'yz-row');
    });
    var body = folderCards.length ? '<div class="yz-page-list">' + folderCards.join('') + '</div>' : '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.folders) + '</div>';
    var cta = player ? playerAddBtn('folder', '') : '';
    return '<main class="yz-page-inner" data-marker="notes-folders">' + yzHeader(t.features.notes) + searchBoxIf(CORE.safeArray(notes.folders, 10).length, search) + body + cta + '</main>';
  }

