  function ava(label, sizeClass) {
    return '<span class="yz-ava' + (sizeClass ? ' ' + sizeClass : '') + '">' + CORE.escapeHtml(String(label || '?').slice(0, 1)) + '</span>';
  }

  // data-action 注册表（静态字符串供冒烟扫描）
  // data-action="delete-contact" data-action="delete-group" data-action="delete-message" data-action="delete-track" data-action="delete-place"
  var CHARACTER_DELETE_ACTIONS = { contact: 'delete-contact', group: 'delete-group', message: 'delete-message', track: 'delete-track', place: 'delete-place' };

  function chatRow(t, row, label, extra) {
    var hasUnread = Number(row.unread) > 0;
    var unreadLabel = hasUnread ? (Number(row.unread) > 99 ? '99+' : String(row.unread)) : '';
    var unread = hasUnread ? '<u class="yz-unread">' + CORE.escapeHtml(unreadLabel) + '</u>' : '';
    var delAction = label === 'gchat' ? 'delete-group' : 'delete-contact';
    var delBtn = '<button type="button" class="yz-row-action" data-action="' + delAction + '" data-id="' + CORE.escapeHtml(String(row.id)) + '">×</button>';
    return '<div class="yz-row" style="display:flex;align-items:center;gap:6px">' + button('navigate', ava(row.name) + '<span class="yz-row-copy"><b>' + CORE.escapeHtml(row.name) + '<i>' + CORE.escapeHtml(row.relation || extra || '') + '</i></b><em>' + CORE.escapeHtml(row.preview || t.awaitingSync) + '</em></span><time>' + CORE.escapeHtml(row.time || '') + unread + '</time>', { view: label, id: row.id }, 'yz-row' + (hasUnread ? ' yz-unread-row' : '')) + delBtn + '</div>';
  }

  // 有新回复（unread > 0）的条目稳定置顶，其余保持原顺序（渲染层排序，不改数据）。
  function unreadFirst(rows) {
    return rows.sort(function (a, b) {
      return (Number(b.unread) > 0 ? 1 : 0) - (Number(a.unread) > 0 ? 1 : 0);
    });
  }

  // 空间会话详情：气泡左右按 side 判定（self=空间本人/用户发言在右）。
  // 联系人/群聊都是空间内普通实体；私聊与群聊都带发言输入框（用户直写不经模型评估）。
  // data-thread-input 由 App 层绑定：sendSpaceMessage / sendSpaceComment。
  function renderMsgDetail(state, nav, group, search, tag, flags, ui) {
    var t = I18N.dict();
    var chats = CORE.safeObject(state.chats);
    var kw = searchKw(search);
    var rows = group ? CORE.safeArray(chats.groups, 6) : CORE.safeArray(chats.contacts, 10);
    var rowItem = null;
    rows.forEach(function (item) { if (String(item.id) === String(nav.params && nav.params.id)) rowItem = item; });
    if (!rowItem) return '<main class="yz-page-inner" data-marker="' + (group ? 'msg-gchat' : 'msg-chat') + '">' + yzHeader(t.features.msg, false, tag) + '<div class="yz-empty">' + CORE.escapeHtml(group ? t.guards.gchat : t.guards.chat) + '<br><small class="yz-archived-hint">' + CORE.escapeHtml(t.guards.chatArchived) + '</small></div></main>';
    var sealed = flags && flags.msg === false;
    var isUserThread = /^c-/.test(String(rowItem.id));
    var userView = isUserThread || state.isDefault === false || ui.userSpaceView === true;
    var bubbles = CORE.safeArray(rowItem.messages, group ? 24 : 20).filter(function (message) {
      return filterMatch(kw, [message.text, message.sender, message.time]);
    }).map(function (message) {
      // 右气泡 = 用户真实发言（pm-*/pmg-*，任何空间）；默认空间的模型线程维持旧语义
      // （self=角色自己的消息在右）；用户空间/用户线程里 AI 一律在左、带发送者名。
      var mine = /^(pm-|pmg-)/.test(String(message.id || '')) ? true : (!userView && message.side === 'self');
      var showSender = !mine && (group || isUserThread || userView);
      var senderName = message.sender || rowItem.name || (message.side === 'self' ? (ui.ownerName || '') : '');
      var sender = showSender ? '<b class="yz-sender">' + CORE.escapeHtml(senderName || '') + '</b>' : '';
      var delBtn = ' <button type="button" class="yz-bubble-del" data-action="delete-message" data-id="' + CORE.escapeHtml(String(message.id)) + '" data-parent-id="' + CORE.escapeHtml(String(rowItem.id)) + '">×</button>';
      return '<div class="yz-bubble-row ' + (mine ? 'self' : 'other') + '">' +
        (!mine && group ? '<span class="yz-bubble-ava">' + ava(message.sender || '?') + '</span>' : '') +
        '<div class="yz-bubble-wrap">' + sender + '<div class="yz-bubble">' + CORE.escapeHtml(message.text) + delBtn + '</div><time>' + CORE.escapeHtml(message.time || '') + '</time></div>' +
        '</div>';
    }).join('');
    if (!bubbles) bubbles = '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.msgThreadEmpty) + '</div>';
    if (rowItem.archived) {
      bubbles = '<div class="yz-archived-note">' + CORE.escapeHtml(tr('runtime.player.msgArchived', { n: group ? 24 : 20 })) + '</div>' + bubbles;
    }
    var title = CORE.escapeHtml(rowItem.name) + (group && Number(rowItem.members) ? ' (' + CORE.escapeHtml(String(rowItem.members)) + CORE.escapeHtml(t.labels.membersUnit) + ')' : '');
    var composer;
    if (sealed) {
      composer = '<div class="yz-composer yz-composer-sealed">' + CORE.escapeHtml(t.toast.sealedMsg) + '</div>';
    } else {
      composer = '<div class="yz-composer"><input type="text" data-thread-input data-thread-id="' + CORE.escapeHtml(String(rowItem.id)) + '" data-group="' + (group ? '1' : '0') + '" placeholder="' + CORE.escapeHtml(t.msgPlaceholder) + '" aria-label="' + CORE.escapeHtml(t.msgPlaceholder) + '" maxlength="3000">' +
        '<button type="button" class="yz-send" data-action="send-thread-msg" data-thread-id="' + CORE.escapeHtml(String(rowItem.id)) + '" data-group="' + (group ? '1' : '0') + '">' + CORE.escapeHtml(t.send) + '</button></div>';
    }
    return '<main class="yz-page-inner yz-page-composer" data-marker="' + (group ? 'msg-gchat' : 'msg-chat') + '">' +
      yzHeader(title, false, tag) + searchBox(search) + '<div class="yz-bubbles">' + bubbles + '</div>' + composer + '</main>';
  }

  function renderMsg(state, nav, search, flags, ui) {
    ui = ui || {};
    var t = I18N.dict();
    nav = nav || { app: 'msg', view: 'chats', params: {} };
    var view = (nav.view && nav.view !== 'root') ? nav.view : 'chats';
    if (view === 'chat') return renderMsgDetail(state, nav, false, search, '', flags, ui);
    if (view === 'gchat') return renderMsgDetail(state, nav, true, search, '', flags, ui);
    if (view === 'contact-form') return renderSpaceForm(state, nav, ui);
    // 会话列表：联系人 + 群聊两个页签；联系人页底部「＋ 新增联系人」（自定义名称）。
    var chats = CORE.safeObject(state.chats);
    var kw = searchKw(search);
    var body;
    if (view === 'groups') {
      var gitems = unreadFirst(CORE.safeArray(chats.groups, 6).filter(function (row) {
        return filterMatch(kw, [row.name, row.preview, row.time]);
      })).map(function (row) { return chatRow(t, row, 'gchat', t.labels.membersUnit); });
      body = gitems.length ? '<div class="yz-page-list">' + gitems.join('') + '</div>' : '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.groups) + '</div>';
      return '<main class="yz-page-inner" data-marker="msg-groups">' + yzHeader(t.features.msg, true) +
        yzTabs([['chats', t.tabs.contacts], ['groups', t.tabs.groups]], view) + searchBoxIf(CORE.safeArray(chats.groups, 6).length, search) + body + '</main>';
    }
    var items = unreadFirst(CORE.safeArray(chats.contacts, 10).filter(function (row) {
      return filterMatch(kw, [row.name, row.relation, row.preview, row.time]);
    })).map(function (row) { return chatRow(t, row, 'chat', ''); });
    body = items.length ? '<div class="yz-page-list">' + items.join('') + '</div>' : '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.contacts) + '</div>';
    var cta = '<button type="button" class="yz-add-btn" data-action="new-contact">＋ ' + CORE.escapeHtml(t.addContact) + '</button>';
    return '<main class="yz-page-inner" data-marker="msg-chats">' + yzHeader(t.features.msg, true) +
      yzTabs([['chats', t.tabs.contacts], ['groups', t.tabs.groups]], view) + searchBoxIf(CORE.safeArray(chats.contacts, 10).length, search) + body + cta + '</main>';
  }

