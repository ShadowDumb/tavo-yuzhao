  /* ---------- UI views / forum (Xun) ---------- */
  var VIEWS_FORUM = {
    render: function (ctx) {
      var runtime = ctx.runtime;
      var state = ctx.state;
      var tr = ctx.tr || function (k) { return k; };
      var space = runtime ? runtime.activeSpace() : null;
      var forum = (space && space.forum) || { posts: [], comments: [] };

      var allPosts = CORE.safeArray(forum.posts, 100);
      var allComments = CORE.safeArray(forum.comments, 300);

      // 1. 帖子详情页 (Post Detail & Comments)
      if (state.selectedId) {
        var post = allPosts.find(function (p) { return String(p.id) === String(state.selectedId); });
        if (!post) {
          return '<div class="yz-subview">' +
            VIEWS_SHARED.renderHeader({ title: '帖子详情', icon: '☴' }) +
            VIEWS_SHARED.renderEmpty('该帖已被天道法则抹去') +
          '</div>';
        }

        var comments = (post.comments && post.comments.length)
          ? post.comments
          : allComments.filter(function (c) { return String(c.postId) === String(post.id); });
        var isPlayer = post.owner === 'player';

        var commentsHtml = comments.length === 0
          ? '<div style="font-size: 13px; color: var(--yz-text-muted); text-align: center; padding: 20px 0;">尚无道友留言，快来抢占仙榜第一评</div>'
          : comments.map(function (c) {
              return '<div style="padding: 10px 14px; border-radius: 10px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.04); display: flex; flex-direction: column; gap: 4px;">' +
                '<div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--yz-text-muted);">' +
                  '<span style="font-weight: 600; color: var(--yz-text-secondary);">' + CORE.escapeHtml(c.commenter || '同道仙友') + '</span>' +
                  '<span>' + CORE.escapeHtml(c.time || '') + '</span>' +
                '</div>' +
                '<div style="font-size: 13px; color: var(--yz-text-primary); line-height: 1.5;">' + CORE.escapeHtml(c.text || c.content || '') + '</div>' +
              '</div>';
            }).join('');

        return '<div class="yz-msg-container">' +
          VIEWS_SHARED.renderHeader({
            title: post.title || '帖子详情',
            icon: '☴',
            subtitle: (post.section || '修仙茶馆') + ' · ' + (post.author || '无名修士')
          }) +
          '<div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding-right: 4px;">' +
            /* 主帖卡片 */
            '<div class="yz-card" style="border-top: 2px solid var(--yz-gua-xun);">' +
              '<div class="yz-card-header">' +
                '<div style="display: flex; align-items: center; gap: 8px;">' +
                  '<span class="yz-card-title" style="font-size: 17px;">' + CORE.escapeHtml(post.title || '无题') + '</span>' +
                  (isPlayer ? '<span style="font-size: 10px; padding: 1px 6px; border-radius: 4px; background: rgba(16, 185, 129, 0.2); color: var(--yz-jade-light); border: 1px solid var(--yz-border-jade);">本尊发帖</span>' : '') +
                '</div>' +
                '<span style="font-size: 12px; color: var(--yz-text-muted);">' + CORE.escapeHtml(post.time || '') + '</span>' +
              '</div>' +
              '<div style="font-size: 14px; color: var(--yz-text-primary); line-height: 1.7; white-space: pre-wrap; margin: 8px 0;">' +
                CORE.escapeHtml(post.body || '') +
              '</div>' +
              '<div class="yz-card-footer">' +
                '<span>作者：' + CORE.escapeHtml(post.author || '修士') + (post.authorTitle ? (' · ' + CORE.escapeHtml(post.authorTitle)) : '') + '</span>' +
                '<span style="color: var(--yz-gold-accent);">✦ 共鸣 ' + (post.echo || 0) + ' 次</span>' +
              '</div>' +
            '</div>' +

            /* 评论区 */
            '<div style="font-family: var(--yz-font-serif); font-size: 15px; font-weight: 600; color: var(--yz-text-primary); margin-top: 8px;">道友共鸣论道 (' + comments.length + ')</div>' +
            '<div style="display: flex; flex-direction: column; gap: 8px;">' + commentsHtml + '</div>' +
          '</div>' +

          /* 底部评论栏 */
          '<div class="yz-chat-input-bar">' +
            '<input type="text" id="yz-comment-input" class="yz-input" placeholder="' + (tr('runtime.player.commentPlaceholder') || '发表共鸣论道观点...') + '">' +
            '<button id="yz-comment-send" class="yz-btn-primary">' + (tr('runtime.player.comment') || '共鸣发表') + '</button>' +
          '</div>' +
        '</div>';
      }

      // 2. 帖子列表视图
      var headerHtml = VIEWS_SHARED.renderHeader({
        title: tr('runtime.feature.forum') || '天下论坛',
        subtitle: '巽卦 · 风 · 八方论道',
        icon: '☴',
        actions: [
          { id: 'yz-btn-forum-new', label: '论道发帖', primary: true }
        ]
      });

      var tab = state.activeTab || 'all';
      var tabs = [
        { id: 'all', label: '全部仙帖', badge: allPosts.length },
        { id: '修炼心得', label: '修炼心得' },
        { id: '法器交流', label: '法器交流' },
        { id: '悬赏', label: '天下悬赏' },
        { id: '闲聊', label: '修仙闲聊' }
      ];

      var search = state.searchQuery;
      var filteredPosts = allPosts;
      if (tab !== 'all') {
        filteredPosts = filteredPosts.filter(function (p) { return p.section === tab; });
      }
      if (search) {
        filteredPosts = filteredPosts.filter(function (p) {
          return (p.title && p.title.toLowerCase().indexOf(search) >= 0) ||
                 (p.body && p.body.toLowerCase().indexOf(search) >= 0) ||
                 (p.author && p.author.toLowerCase().indexOf(search) >= 0);
        });
      }

      var listHtml = '';
      if (filteredPosts.length === 0) {
        listHtml = VIEWS_SHARED.renderEmpty(search ? '未找到相关论道仙帖' : '本版块尚无道友开讲');
      } else {
        listHtml = '<div style="display: flex; flex-direction: column; gap: 10px;">' +
          filteredPosts.map(function (p) {
            var isPlayer = p.owner === 'player';
            var commentCount = (p.comments && p.comments.length)
              ? p.comments.length
              : allComments.filter(function (c) { return String(c.postId) === String(p.id); }).length;
            var unreadBadge = Number(p.unread) > 0 ? ('<span class="yz-fab-badge" style="position: static; margin-left: 6px;">' + p.unread + '</span>') : '';

            return '<div class="yz-card yz-post-card" data-id="' + CORE.escapeHtml(p.id) + '" style="border-top: 2px solid var(--yz-gua-xun); cursor: pointer;">' +
              '<div class="yz-card-header">' +
                '<div style="display: flex; align-items: center; gap: 8px;">' +
                  '<span class="yz-card-title">' + CORE.escapeHtml(p.title || '无题') + '</span>' +
                  (p.section ? ('<span style="font-size: 11px; padding: 1px 6px; border-radius: 4px; background: rgba(74, 222, 128, 0.15); color: var(--yz-gua-xun); border: 1px solid var(--yz-border-jade);">' + CORE.escapeHtml(p.section) + '</span>') : '') +
                  (isPlayer ? '<span style="font-size: 10px; padding: 1px 4px; border-radius: 4px; background: rgba(16, 185, 129, 0.2); color: var(--yz-jade-light);">我</span>' : '') +
                  unreadBadge +
                '</div>' +
                '<span style="font-size: 11px; color: var(--yz-text-muted);">' + CORE.escapeHtml(p.time || '') + '</span>' +
              '</div>' +
              '<div class="yz-card-body" style="max-height: 48px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">' +
                CORE.escapeHtml(p.body || '') +
              '</div>' +
              '<div class="yz-card-footer">' +
                '<span>' + CORE.escapeHtml(p.author || '修士') + (p.authorTitle ? (' · ' + CORE.escapeHtml(p.authorTitle)) : '') + '</span>' +
                '<div style="display: flex; gap: 12px;">' +
                  '<span style="color: var(--yz-gold-accent);">✦ 共鸣 ' + (p.echo || 0) + '</span>' +
                  '<span>💬 论道 ' + commentCount + '</span>' +
                '</div>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>';
      }

      return '<div class="yz-subview">' +
        headerHtml +
        VIEWS_SHARED.renderTabs(tabs, tab) +
        VIEWS_SHARED.renderSearchBar('在天下论坛中检索论道话题...', state.searchQuery) +
        listHtml +
      '</div>';
    },

    bindEvents: function (el, ctx) {
      var state = ctx.state;
      var navigation = ctx.navigation;
      var forms = ctx.forms;
      var dataActions = ctx.dataActions;
      var runtime = ctx.runtime;

      var commentSend = el.querySelector('#yz-comment-send');
      var commentInput = el.querySelector('#yz-comment-input');
      function doSendComment() {
        if (!commentInput || !dataActions || !state.selectedId) return;
        var text = String(commentInput.value || '').trim();
        if (!text) return;
        dataActions.sendComment(state.selectedId, text);
        commentInput.value = '';
      }
      if (commentSend) commentSend.addEventListener('click', doSendComment);
      if (commentInput) {
        commentInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') doSendComment();
        });
      }

      var newBtn = el.querySelector('#yz-btn-forum-new');
      if (newBtn && forms) {
        newBtn.addEventListener('click', function () {
          forms.openPostForm();
        });
      }

      var tabBtns = el.querySelectorAll('.yz-tab-btn');
      tabBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var t = btn.getAttribute('data-tab');
          if (t) navigation.setTab(t);
        });
      });

      var postCards = el.querySelectorAll('.yz-post-card');
      postCards.forEach(function (card) {
        card.addEventListener('click', function () {
          var id = card.getAttribute('data-id');
          if (runtime && id) runtime.markSpacePostSeen(id);
          navigation.selectItem(id);
        });
      });
    }
  };
