  function renderForum(state, nav, search, tag, player, ui) {
    var t = I18N.dict();
    var forum = CORE.safeObject(state.forum);
    var kw = searchKw(search);
    nav = nav || { app: 'forum', view: 'root', params: {} };
    var view = (nav.view && nav.view !== 'root') ? nav.view : 'root';
    if (player && view === 'form') return renderSpaceForm(state, nav, ui);
    if (view === 'post') {
      var post = null;
      CORE.safeArray(forum.posts, 20).forEach(function (item) { if (String(item.id) === String(nav.params && nav.params.id)) post = item; });
       if (!post) return '<main class="yz-page-inner" data-marker="forum-post">' + yzHeader(t.features.forum, false, tag) + '<div class="yz-empty">' + CORE.escapeHtml(t.guards.post) + '</div></main>';
       var allComments = CORE.safeArray(post.comments, 20);
       var comments = allComments.filter(function (comment) {
        return filterMatch(kw, [comment.author, comment.text, comment.time]);
      }).map(function (comment) {
        return '<div class="yz-comment"><span class="yz-comment-ava">' + ava(comment.author || '?') + '</span><div class="yz-comment-copy"><b>' + CORE.escapeHtml(comment.author || '') + '</b><p>' + CORE.escapeHtml(comment.text) + '</p><time>' + CORE.escapeHtml(comment.time || '') + '</time></div></div>';
      }).join('');
      // 评论窗口超限痕迹：每帖最多 20 条，满额后更早评论不会消失但新评论会静默拒收——
      // 满额提示「已达上限」，避免用户以为评论没发出去是故障。
      var commentsFull = CORE.safeArray(post.comments, 20).length >= 20 && !kw;
      var isMine = String(post.owner || '') === 'player';
      var postArmed = !!(ui && ui.armed && ui.armed.id === 'post:' + String(post.id));
      var editBtn = (player && isMine) ? '<div class="yz-form-actions"><button type="button" class="yz-send" data-action="entity-edit" data-kind="post" data-id="' + CORE.escapeHtml(post.id) + '">' + CORE.escapeHtml(t.playerEdit) + '</button>' +
          '<button type="button" class="yz-clear-btn' + (postArmed ? ' armed' : '') + '" data-action="entity-delete" data-kind="post" data-id="' + CORE.escapeHtml(post.id) + '"' + (postArmed ? ' data-wipe-base="' + CORE.escapeHtml(t.playerDeleteConfirm) + '"' : '') + '>' + CORE.escapeHtml(postArmed ? t.playerDeleteConfirm : t.playerDelete) + '</button></div>' : '';
      // 玩家域（公开数据）：底部评论输入框（data-comment-input 由 App 层绑定发送）。
      var commentBox = player
        ? '<div class="yz-composer"><input type="text" data-comment-input data-post-id="' + CORE.escapeHtml(post.id) + '" placeholder="' + CORE.escapeHtml(t.playerCommentPlaceholder) + '" aria-label="' + CORE.escapeHtml(t.playerCommentPlaceholder) + '" maxlength="3000">' +
          '<button type="button" class="yz-send" data-action="send-comment" data-post-id="' + CORE.escapeHtml(post.id) + '">' + CORE.escapeHtml(t.playerComment) + '</button></div>'
        // 角色域帖子详情不重复只读提示：列表页已有 sticky 提示，连看多帖不反复见到同一句。
        : '';
      return '<main class="yz-page-inner yz-page-composer" data-marker="forum-post">' +
        yzHeader(t.features.forum, false, tag) +
        '<article class="yz-post-paper"><div class="yz-post-meta"><span>' + CORE.escapeHtml(post.author || '') + (CORE.hasText(post.role) ? ' · ' + CORE.escapeHtml(post.role) : '') + (isMine ? ' <i class="yz-player-tag">' + CORE.escapeHtml(t.playerPostTag) + '</i>' : '') + '</span><time>' + CORE.escapeHtml(post.time || '') + '</time></div>' +
        '<h2>' + CORE.escapeHtml(post.title) + '</h2>' +
        (CORE.hasText(post.section) ? '<span class="yz-tag">' + CORE.escapeHtml(post.section) + '</span>' : '') +
        '<p>' + CORE.escapeHtml(post.body) + '</p>' +
        '<div class="yz-resonance">❋ ' + CORE.escapeHtml(String(post.resonance || 0)) + ' ' + CORE.escapeHtml(t.labels.resonance) + '</div></article>' +
        (comments.length || !kw
           ? '<section class="yz-comments"><h3>' + CORE.escapeHtml(String(allComments.length)) + ' ' + CORE.escapeHtml(t.labels.commentsWord) + ' <small style="font-weight:400;color:#7fae9a">(' + CORE.escapeHtml(String(allComments.length)) + '/20)</small></h3>' +
            (commentsFull ? '<div class="yz-archived-note">' + CORE.escapeHtml(t.forumCommentsFull) + '</div>' : '') +
            comments + '</section>'
          : '<div class="yz-empty">' + CORE.escapeHtml(t.searchNoMatch) + '</div>') +
        editBtn +
        commentBox +
        '</main>';
    }
    var posts = unreadFirst(CORE.safeArray(forum.posts, 20).filter(function (post) {
      return filterMatch(kw, [post.title, post.author, post.section, post.body]);
    }));
    var list = posts.length ? posts.map(function (post) {
      var isMine = String(post.owner || '') === 'player';
      var hasUnread = Number(post.unread) > 0;
      // 有新回复（未读）的帖子：数字徽标（99+ 封顶）+ 呼吸光效（与联系人/群聊列表一致）并置顶。
      var unreadBadge = hasUnread ? '<u class="yz-unread">' + CORE.escapeHtml(Number(post.unread) > 99 ? '99+' : String(post.unread)) + '</u>' : '';
      var row = '<b>' + CORE.escapeHtml(post.title) + (isMine ? ' <i class="yz-player-tag">' + CORE.escapeHtml(t.playerPostTag) + '</i>' : '') + '</b><em>' + CORE.escapeHtml((post.author || '') + (CORE.hasText(post.section) ? ' · ' + post.section : '')) + '</em><time>' + CORE.escapeHtml(post.time || '') + unreadBadge + '</time>';
      if (player && isMine) {
        return editableListRow(button('navigate', row, { view: 'post', id: post.id }, 'yz-row' + (hasUnread ? ' yz-unread-row' : '')), 'post', post.id);
      }
      return button('navigate', row, { view: 'post', id: post.id }, 'yz-row' + (hasUnread ? ' yz-unread-row' : ''));
    }).join('') : '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.posts) + '</div>';
    var cta = playerAddBtn('post', '');
    return '<main class="yz-page-inner" data-marker="forum-list">' + yzHeader(t.features.forum, false, tag) + searchBoxIf(CORE.safeArray(state.forum && state.forum.posts, 20).length, search) + '<div class="yz-page-list">' + list + '</div>' + cta + '</main>';
  }

