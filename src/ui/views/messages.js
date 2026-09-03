  /* ---------- UI views / messages (Dui) ---------- */
  var VIEWS_MESSAGES = {
    render: function (ctx) {
      var runtime = ctx.runtime;
      var state = ctx.state;
      var tr = ctx.tr || function (k) { return k; };
      var space = runtime ? runtime.activeSpace() : null;
      var chats = (space && space.chats) || { contacts: [], groups: [] };

      var tab = state.activeTab || 'contacts';

      // 1. 如果当前选定了具体会话 (Chat Thread Detail)
      if (state.selectedId) {
        var isGroup = state.selectedId.indexOf('group-') === 0;
        var threadId = isGroup ? state.selectedId.slice(6) : state.selectedId;
        var threadType = isGroup ? 'group' : 'contact';
        var threadObj = null;
        var messages = [];

        if (isGroup) {
          threadObj = CORE.safeArray(chats.groups).find(function (g) { return String(g.id) === String(threadId); });
          messages = threadObj ? CORE.safeArray(threadObj.messages, 100) : [];
        } else {
          threadObj = CORE.safeArray(chats.contacts).find(function (c) { return String(c.id) === String(threadId); });
          messages = threadObj ? CORE.safeArray(threadObj.messages, 100) : [];
        }

        var title = threadObj ? (isGroup ? threadObj.name : (threadObj.name + (threadObj.relation ? (' (' + threadObj.relation + ')') : ''))) : '传音符对话';

        var bubblesHtml = messages.length === 0
          ? VIEWS_SHARED.renderEmpty('灵符尚无传音记录，请在下方寄出道语')
          : messages.map(function (m) {
              var isSelf = m.direction === 'self';
              var senderName = m.sender || (isSelf ? (tr('runtime.label.self') || '我') : (threadObj ? threadObj.name : '道友'));
              return '<div class="yz-msg-bubble ' + (isSelf ? 'yz-self' : 'yz-other') + '">' +
                '<div style="font-size: 11px; opacity: 0.75; margin-bottom: 2px;">' + CORE.escapeHtml(senderName) + '</div>' +
                '<div>' + CORE.escapeHtml(m.text || m.body || '') + '</div>' +
                '<div class="yz-msg-meta">' + CORE.escapeHtml(m.time || '') + '</div>' +
              '</div>';
            }).join('');

        return '<div class="yz-msg-container">' +
          VIEWS_SHARED.renderHeader({
            title: title,
            icon: '☱',
            subtitle: isGroup ? ('群友 ' + (threadObj.memberCount || 0) + ' 位') : '万里传音',
            actions: [
              { id: 'yz-btn-thread-back', label: '返回列表' }
            ]
          }) +
          '<div class="yz-chat-stream" id="yz-chat-stream">' + bubblesHtml + '</div>' +
          '<div class="yz-chat-input-bar">' +
            '<input type="text" id="yz-msg-input" class="yz-input" placeholder="' + (tr('runtime.space.msgPlaceholder') || '拟定传音符...') + '">' +
            '<button id="yz-msg-send" class="yz-btn-primary">' + (tr('runtime.space.send') || '发出传音') + '</button>' +
          '</div>' +
        '</div>';
      }

      // 2. 列表视图 (Contacts / Groups List)
      var headerHtml = VIEWS_SHARED.renderHeader({
        title: tr('runtime.feature.msg') || '交流讯息',
        subtitle: '兑卦 · 泽 · 传音问候',
        icon: '☱',
        actions: [
          { id: 'yz-btn-add-contact', label: tr('runtime.space.addContact') || '新增传音人', primary: true }
        ]
      });

      var tabs = [
        { id: 'contacts', label: tr('runtime.tab.contacts') || '传音道友', badge: chats.contacts ? chats.contacts.length : 0 },
        { id: 'groups', label: tr('runtime.tab.groups') || '修仙宗门群', badge: chats.groups ? chats.groups.length : 0 }
      ];

      var search = state.searchQuery;
      var listHtml = '';

      if (tab === 'contacts') {
        var contacts = CORE.safeArray(chats.contacts, 100);
        if (search) {
          contacts = contacts.filter(function (c) {
            return (c.name && c.name.toLowerCase().indexOf(search) >= 0) ||
                   (c.relation && c.relation.toLowerCase().indexOf(search) >= 0) ||
                   (c.preview && c.preview.toLowerCase().indexOf(search) >= 0);
          });
        }

        if (contacts.length === 0) {
          listHtml = VIEWS_SHARED.renderEmpty(search ? '未找到对应传音道友' : '暂无传音联系人，可点击右上角新增');
        } else {
          listHtml = '<div style="display: flex; flex-direction: column; gap: 8px;">' +
            contacts.map(function (c) {
              var unreadBadge = Number(c.unread) > 0 ? ('<span class="yz-fab-badge" style="position: static; margin-left: 6px;">' + c.unread + '</span>') : '';
              return '<div class="yz-card yz-contact-item" data-id="' + CORE.escapeHtml(c.id) + '" style="cursor: pointer; flex-direction: row; align-items: center; justify-content: space-between;">' +
                '<div style="display: flex; align-items: center; gap: 12px;">' +
                  '<div style="width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #1e40af, #3b82f6); display: flex; align-items: center; justify-content: center; font-family: var(--yz-font-serif); font-size: 16px; color: #fff; border: 1px solid var(--yz-border-jade);">' +
                    CORE.escapeHtml((c.name || '友').slice(0, 1)) +
                  '</div>' +
                  '<div>' +
                    '<div style="display: flex; align-items: center; gap: 6px;">' +
                      '<span style="font-weight: 600; color: var(--yz-text-primary); font-size: 14px;">' + CORE.escapeHtml(c.name) + '</span>' +
                      (c.relation ? ('<span style="font-size: 11px; padding: 1px 6px; border-radius: 4px; background: rgba(52, 211, 153, 0.15); color: var(--yz-jade-light); border: 1px solid var(--yz-border-jade);">' + CORE.escapeHtml(c.relation) + '</span>') : '') +
                      unreadBadge +
                    '</div>' +
                    '<div style="font-size: 12px; color: var(--yz-text-muted); margin-top: 2px; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + CORE.escapeHtml(c.preview || '点击进入传音符信道...') + '</div>' +
                  '</div>' +
                '</div>' +
                '<div style="text-align: right; font-size: 11px; color: var(--yz-text-muted);">' +
                  '<div>' + CORE.escapeHtml(c.time || '') + '</div>' +
                '</div>' +
              '</div>';
            }).join('') +
          '</div>';
        }
      } else {
        var groups = CORE.safeArray(chats.groups, 100);
        if (search) {
          groups = groups.filter(function (g) {
            return (g.name && g.name.toLowerCase().indexOf(search) >= 0) ||
                   (g.preview && g.preview.toLowerCase().indexOf(search) >= 0);
          });
        }

        if (groups.length === 0) {
          listHtml = VIEWS_SHARED.renderEmpty('暂无加入宗门群聊');
        } else {
          listHtml = '<div style="display: flex; flex-direction: column; gap: 8px;">' +
            groups.map(function (g) {
              var unreadBadge = Number(g.unread) > 0 ? ('<span class="yz-fab-badge" style="position: static; margin-left: 6px;">' + g.unread + '</span>') : '';
              return '<div class="yz-card yz-group-item" data-id="' + CORE.escapeHtml(g.id) + '" style="cursor: pointer; flex-direction: row; align-items: center; justify-content: space-between;">' +
                '<div style="display: flex; align-items: center; gap: 12px;">' +
                  '<div style="width: 40px; height: 40px; border-radius: 10px; background: linear-gradient(135deg, #065f46, #059669); display: flex; align-items: center; justify-content: center; font-family: var(--yz-font-serif); font-size: 16px; color: #fff; border: 1px solid var(--yz-border-jade);">' +
                    '群' +
                  '</div>' +
                  '<div>' +
                    '<div style="display: flex; align-items: center; gap: 6px;">' +
                      '<span style="font-weight: 600; color: var(--yz-text-primary); font-size: 14px;">' + CORE.escapeHtml(g.name) + '</span>' +
                      '<span style="font-size: 11px; color: var(--yz-text-muted);">(' + (g.memberCount || 0) + '人)</span>' +
                      unreadBadge +
                    '</div>' +
                    '<div style="font-size: 12px; color: var(--yz-text-muted); margin-top: 2px; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + CORE.escapeHtml(g.preview || '点击进入群聊...') + '</div>' +
                  '</div>' +
                '</div>' +
                '<div style="text-align: right; font-size: 11px; color: var(--yz-text-muted);">' +
                  '<div>' + CORE.escapeHtml(g.time || '') + '</div>' +
                '</div>' +
              '</div>';
            }).join('') +
          '</div>';
        }
      }

      return '<div class="yz-subview">' +
        headerHtml +
        VIEWS_SHARED.renderTabs(tabs, tab) +
        VIEWS_SHARED.renderSearchBar('搜索联系人/宗门群聊/传音内容...', state.searchQuery) +
        listHtml +
      '</div>';
    },

    bindEvents: function (el, ctx) {
      var state = ctx.state;
      var navigation = ctx.navigation;
      var forms = ctx.forms;
      var dataActions = ctx.dataActions;
      var runtime = ctx.runtime;

      // 滚动聊天流到底部
      var stream = el.querySelector('#yz-chat-stream');
      if (stream) {
        stream.scrollTop = stream.scrollHeight;
      }

      var backBtn = el.querySelector('#yz-btn-thread-back');
      if (backBtn) {
        backBtn.addEventListener('click', function () {
          if (runtime && state.selectedId) {
            var isGroup = state.selectedId.indexOf('group-') === 0;
            var tType = isGroup ? 'group' : 'contact';
            var tId = isGroup ? state.selectedId.slice(6) : state.selectedId;
            runtime.markSpaceThreadSeen(tType, tId);
          }
          navigation.selectItem(null);
        });
      }

      var sendBtn = el.querySelector('#yz-msg-send');
      var msgInput = el.querySelector('#yz-msg-input');
      function doSend() {
        if (!msgInput || !dataActions || !state.selectedId) return;
        var text = String(msgInput.value || '').trim();
        if (!text) return;
        var isGroup = state.selectedId.indexOf('group-') === 0;
        var tType = isGroup ? 'group' : 'contact';
        var tId = isGroup ? state.selectedId.slice(6) : state.selectedId;
        dataActions.sendMessage(tType, tId, text);
        msgInput.value = '';
      }
      if (sendBtn) sendBtn.addEventListener('click', doSend);
      if (msgInput) {
        msgInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') doSend();
        });
      }

      var addContactBtn = el.querySelector('#yz-btn-add-contact');
      if (addContactBtn && forms) {
        addContactBtn.addEventListener('click', function () {
          forms.openContactForm();
        });
      }

      var tabBtns = el.querySelectorAll('.yz-tab-btn');
      tabBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var t = btn.getAttribute('data-tab');
          if (t) navigation.setTab(t);
        });
      });

      var contactItems = el.querySelectorAll('.yz-contact-item');
      contactItems.forEach(function (item) {
        item.addEventListener('click', function () {
          var id = item.getAttribute('data-id');
          if (runtime && id) runtime.markSpaceThreadSeen('contact', id);
          navigation.selectItem(id);
        });
      });

      var groupItems = el.querySelectorAll('.yz-group-item');
      groupItems.forEach(function (item) {
        item.addEventListener('click', function () {
          var id = item.getAttribute('data-id');
          if (runtime && id) runtime.markSpaceThreadSeen('group', id);
          navigation.selectItem('group-' + id);
        });
      });
    }
  };
