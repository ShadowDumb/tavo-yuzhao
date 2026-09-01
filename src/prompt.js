  var PROMPT_FEATURES = [
    {
      id: 'tablet',
      en: {
        constraint: '- Life-bound Jade Tablet: all six groups Basic (name/gender/height/weight), Appearance (appearance/clothing), Cultivation (spiritual root/constitution/realm/status), Techniques (at least 1), Bonds (at least 1), Secret (at least 1) must be complete.',
        rows: ['<yz_tablet>', 'field｜Basic｜name｜value', 'field｜Basic｜gender｜value', 'field｜Basic｜height｜value', 'field｜Basic｜weight｜value', 'field｜Appearance｜appearance｜value', 'field｜Appearance｜clothing｜value', 'field｜Cultivation｜spiritual root｜value', 'field｜Cultivation｜constitution｜value', 'field｜Cultivation｜realm｜value', 'field｜Cultivation｜status｜value', 'field｜Techniques｜technique｜value', 'field｜Bonds｜bond｜value', 'field｜Secret｜secret｜value', '</yz_tablet>'],
        name: 'Life-bound Jade Tablet'
      },
      zh: {
        constraint: '- 本命玉牌：基本（名字/性别/身高/体重）、仪容（外貌/穿着）、修为（灵根/体质/境界/状态）、功法（至少 1 门）、羁绊（至少 1 条）、隐秘（至少 1 条）六组齐全。',
        rows: ['<yz_tablet>', 'field｜基本｜名字｜名字', 'field｜基本｜性别｜男或女', 'field｜基本｜身高｜身高', 'field｜基本｜体重｜体重', 'field｜仪容｜外貌｜外貌描写', 'field｜仪容｜穿着｜当前穿着', 'field｜修为｜灵根｜灵根与资质', 'field｜修为｜体质｜体质', 'field｜修为｜境界｜当前境界', 'field｜修为｜状态｜当前状态', 'field｜功法｜功法名｜所修功法', 'field｜羁绊｜羁绊对象｜关系说明', 'field｜隐秘｜隐秘信息｜隐秘信息', '</yz_tablet>'],
        name: '本命玉牌'
      }
    },
    {
      id: 'msg',
      en: {
        constraint: '- Messaging: at least 2 contacts, each with at least 2 messages; at least 1 group, each with at least 2 messages; msg rows must belong to declared contact ids, gmsg rows to declared group ids; the direction field of msg/gmsg must be exactly self or other; time fields must be absolute dates (e.g. 丙午年五月十二 午时), never relative ones like 今日/昨日 — messages are archived to the lorebook, and relative times mislead recall after the story date moves on.',
        rows: ['<yz_msg>', 'contact｜id｜name｜relation｜time｜unread｜preview', 'msg｜contact-id｜message-id｜self or other｜absolute date like 丙午年五月十二午时｜text', 'group｜id｜group name｜member count｜time｜unread｜preview', 'gmsg｜group-id｜message-id｜sender name｜self or other｜absolute date like 丙午年五月十二午时｜text', '</yz_msg>'],
        name: 'Messaging'
      },
      zh: {
        constraint: '- 交流讯息：至少 2 个联系人且每人至少 2 条消息、至少 1 个群且每群至少 2 条消息；msg 行必须属于已声明的联系人，gmsg 行必须属于已声明的群；方向字段固定填 self 或 other；时间字段一律写绝对日期（如 丙午年五月十二 午时），禁止 今日/昨日 等相对时间——消息会进世界书归档，剧情日期变化后被召回时相对时间会误导回顾。',
        rows: ['<yz_msg>', 'contact｜id｜道号或姓名｜关系｜时间｜未读｜预览', 'msg｜联系人id｜消息id｜self或other｜绝对时间如丙午年五月十二午时｜正文', 'group｜群id｜群名｜成员数｜时间｜未读｜预览', 'gmsg｜群id｜消息id｜发送者名｜self或other｜绝对时间如丙午年五月十二午时｜正文', '</yz_msg>'],
        name: '交流讯息'
      }
    },
    {
      id: 'forum',
      en: {
        constraint: '- World Forum: at least 2 posts, each with at least 1 comment; comment rows must reference declared post ids. The 10th field of post rows is unread (new replies: increase by 1 when a new comment arrives, set it to 0 after you have read and handled the replies). Rows may end with an owner field: player (posts by the player, read-only) or absent (character posts).',
        rows: ['<yz_forum>', 'post｜id｜author｜author title｜section｜time｜title｜body｜echo count｜unread (new replies, 0 if none)｜owner (player for player posts, omit otherwise)', 'comment｜post-id｜commenter｜time｜text', '</yz_forum>'],
        name: 'World Forum'
      },
      zh: {
        constraint: '- 天下论坛：至少 2 个帖子，每帖至少 1 条评论；comment 行的帖子 id 必须来自 post 行；post 行第 10 字段为 unread（新回复数：有新评论时 +1，已读处理回复后清零），行尾可带 owner 字段：player（玩家发帖，只读）或缺省（角色发帖）。',
        rows: ['<yz_forum>', 'post｜id｜作者｜身份｜版块｜时间｜标题｜正文｜共鸣数｜unread（新回复数，无则 0）｜owner（玩家帖子填 player，其余省略）', 'comment｜帖子id｜评论者｜时间｜内容', '</yz_forum>'],
        name: '天下论坛'
      }
    },
    {
      id: 'notes',
      en: {
        constraint: '- Jade Notes: at least 2 folders and at least 3 notes; note rows must reference declared folder ids.',
        rows: ['<yz_notes>', 'folder｜id｜name｜note count', 'note｜id｜folder-id｜time｜true or false (locked)｜title｜body', '</yz_notes>'],
        name: 'Jade Notes'
      },
      zh: {
        constraint: '- 记事玉册：至少 2 个文件夹、至少 3 条备忘；note 行的文件夹 id 必须来自 folder 行。',
        rows: ['<yz_notes>', 'folder｜id｜名称｜备忘数量', 'note｜id｜文件夹id｜时间｜true或false｜标题｜正文', '</yz_notes>'],
        name: '记事玉册'
      }
    },
    {
      id: 'market',
      en: {
        constraint: '- Market: at least 1 listing, 1 auction, 1 order and 1 request.',
        rows: ['<yz_market>', 'listing｜id｜item name｜grade｜description｜price｜seller', 'auction｜id｜item name｜grade｜description｜starting price｜current price｜time left｜bidder count', 'order｜id｜item name｜status｜price｜time｜buy or sell', 'request｜id｜item name｜grade｜description｜offered price｜requester', '</yz_market>'],
        name: 'Market'
      },
      zh: {
        constraint: '- 交易坊市：行情、拍卖、订单、求购四类各至少 1 条。',
        rows: ['<yz_market>', 'listing｜id｜物品名｜品阶｜描述｜价格｜卖方', 'auction｜id｜物品名｜品阶｜描述｜起拍价｜当前价｜剩余时间｜出价人数', 'order｜id｜物品名｜状态｜价格｜时间｜买或卖', 'request｜id｜物品名｜品阶｜描述｜出价｜求购人', '</yz_market>'],
        name: '交易坊市'
      }
    },
    {
      id: 'space',
      en: {
        constraint: '- Nebula Space: at least 1 currency kind and at least 1 item.',
        rows: ['<yz_space>', 'currency｜kind｜amount', 'item｜id｜name｜quantity｜grade｜description', '</yz_space>'],
        name: 'Nebula Space'
      },
      zh: {
        constraint: '- 芥子空间：至少 1 种钱财与 1 件物品。',
        rows: ['<yz_space>', 'currency｜种类｜数额', 'item｜id｜名称｜数量｜品阶｜描述', '</yz_space>'],
        name: '芥子空间'
      }
    },
    {
      id: 'map',
      en: {
        constraint: '- World Map: exactly one current row, at least 2 track rows, and at least 2 place rows in the location directory.',
        rows: ['<yz_map>', 'current｜location｜domain｜description', 'track｜id｜time｜place｜action', 'place｜id｜place name｜domain｜description', '</yz_map>'],
        name: 'World Map'
      },
      zh: {
        constraint: '- 天下舆图：恰好一行 current，至少两行 track，地点名录至少两处 place。',
        rows: ['<yz_map>', 'current｜所在地｜所属域｜说明', 'track｜id｜时间｜地点｜动作', 'place｜id｜地点名｜所属域｜说明', '</yz_map>'],
        name: '天下舆图'
      }
    }
  ];

  // 基线注入预算：每轮只发「采样子集 + 最近窗口 + 归档摘要」，消息与地点名录历史正文走世界书关键词召回。
  // 窗口值同时是世界书归档的切分点（archived = 消息去掉最近窗口），两处必须一致。
  var RECENT_MSG_ROWS = 6;
  var RECENT_NOTE_ROWS = 3;
  var RECENT_COMMENT_ROWS = 6;
  var RECENT_LISTING_ROWS = 6;
  var RECENT_AUCTION_ROWS = 6;
  var RECENT_ITEM_ROWS = 10;
  var RECENT_REQUEST_ROWS = 6;
  // 地点名录窗口：窗口之外的地点正文不进基线，完整名录在世界书关键词条目中召回。
  var RECENT_PLACE_ROWS = 6;
  // 基线总字符上限：超限时按五级顺序淘汰——① 其它功能明细行（消息/笔记/帖子等，
  // 世界书对消息有召回）→ ② tablet 字段行（角色设定最重要，明细行中最后丢）→ ③ 归档摘要行
  // → ④ last 标记行（玩家传讯未读行与玩家帖子，真实事件，仅极端场景让位）→
  // ⑤ 超长标识行截断到短上限（保留行首 id/name 供 diff 定位，丢 preview/time 长尾）。
  // 这是每轮注入量的硬上限——数据再大也不会随轮次滚雪球。
  var MAX_BASELINE_CHARS = 9000;
  // 第五轮截断后的单行硬上限：标识行以存在性与 diff 定位为主，长尾字段可弃。
  var ROW_HARD_CAP = 160;

  // 当前数据基线按「发送空间」分组：sendToAI 的空间各出一份 yzc_ 容器组。
  // 默认空间（角色本人空间）的容器不带属性；自定义空间容器带 space="路由 token"，
  // 模型回写该空间时在 turn 行第 6 字段填同一路由 token（缺省 = 默认空间）。
  // 多空间并发注入时条目采样上限按空间数均摊（保底 1），注入总量不随空间数膨胀。
  // 超预算五级淘汰共用同一条池子（见 MAX_BASELINE_CHARS 注释）。
  function spaceBaselineLabel(space, fallback) {
    var name = CORE.spaceDisplayName(null, space, fallback || '');
    return encodeSpaceRoute(name);
  }

  // 单个空间的基线行：与旧版逐分区同构（去掉双域通道特殊注入——用户发言 pm/pmg/pmc
  // 现在就是空间内的普通受保护行，采样强保 + last 标记保证不被预算淘汰）。
  function buildSpaceSections(space, flags, rng, caps, visibility) {
    function on(id) { return !flags || flags[id] !== false; }
    function v(value, cap) {
      return cleanText(value, cap || 3000).replace(/[｜|\t\n\r]/g, ' ');
    }
    function archived(type, id, summary) {
      return 'archived｜' + type + '｜' + id + '｜' + summary;
    }
    var s = safeObject(space);
    var sample = (on('msg') || on('forum')) ? sampleEntries(s.chats, s.forum, rng, caps) : { contacts: [], groups: [], posts: [] };
    visibility = visibility || {};
    visibility.contacts = Object.create(null);
    visibility.groups = Object.create(null);
    visibility.posts = Object.create(null);
    visibility.messages = Object.create(null);
    visibility.comments = Object.create(null);
    sample.contacts.forEach(function (id) { visibility.contacts[String(id)] = true; });
    sample.groups.forEach(function (id) { visibility.groups[String(id)] = true; });
    sample.posts.forEach(function (id) { visibility.posts[String(id)] = true; });
    visibility.folders = Object.create(null);
    visibility.notes = Object.create(null);
    visibility.entities = Object.create(null);
    visibility.currencies = Object.create(null);
    visibility.items = Object.create(null);
    visibility.tracks = Object.create(null);
    visibility.places = Object.create(null);
    visibility.tablet = { groups: Object.create(null), fields: Object.create(null) };
    var sections = [];
    function sec(tag) {
      var item = { tag: tag, rows: [] };
      sections.push(item);
      return item;
    }
    if (on('tablet')) {
      var tab = sec('tablet');
      safeArray(safeObject(s.tablet).groups, 10).forEach(function (group) {
        visibility.tablet.groups[String(group.id)] = true;
        visibility.tablet.fields[String(group.id)] = Object.create(null);
        safeArray(group && group.fields, 30).forEach(function (field) {
          var key = v(field && field.key, 60);
          if (!key) return;
          visibility.tablet.fields[String(group.id)][String(field.key)] = true;
          if (keyId(field.key)) visibility.tablet.fields[String(group.id)][keyId(field.key)] = true;
          // tablet 字段行是叶子明细行（键值同行），值最长 3000 字符：明细行中最后淘汰
          // （基本组信息对角色设定最重要，其余功能先丢）。
          tab.rows.push({ text: 'field｜' + v(group.id, 40) + '｜' + key + '｜' + v(field.value), drop: true });
        });
      });
    }
    if (on('msg')) {
      var m = sec('msg');
      var chats = safeObject(s.chats);
      var chatList = safeArray(chats.contacts, 20).filter(function (c) {
        return c && c.id && sample.contacts.indexOf(String(c.id)) >= 0;
      });
      chatList.forEach(function (contact) {
        if (!contact || !hasText(contact.name) || !contact.id) return;
        m.rows.push({ text: 'contact｜' + v(contact.id, 160) + '｜' + v(contact.name, 120) + '｜' + v(contact.relation, 120) + '｜' + v(contact.time, 80) + '｜' + (Number(contact.unread) || 0) + '｜' + v(contact.preview, 300), drop: false });
        var rows = safeArray(contact.messages, 20);
        visibility.messages[contact.id] = Object.create(null);
        tail(rows, RECENT_MSG_ROWS).forEach(function (message) { if (message && message.id) visibility.messages[contact.id][String(message.id)] = true; });
        var hidden = rows.length - RECENT_MSG_ROWS;
        if (hidden > 0) m.rows.push({ text: archived('msg', v(contact.id, 160), hidden + ' 条旧消息已归档'), drop: false });
        tail(rows, RECENT_MSG_ROWS).forEach(function (message) {
          if (!message || !message.id) return;
          // 用户发言（pm-*）是真实事件：计入预算但保留优先级最高（仅极端超限让位）。
          var mine = /^pm-\d+$/.test(String(message.id));
          m.rows.push({ text: 'msg｜' + v(contact.id, 160) + '｜' + v(message.id, 160) + '｜' + v(message.side, 10) + '｜' + v(message.time, 80) + '｜' + v(message.text), drop: !mine, last: mine });
        });
      });
      var groupList = safeArray(chats.groups, 6).filter(function (g) {
        return g && g.id && sample.groups.indexOf(String(g.id)) >= 0;
      });
      groupList.forEach(function (group) {
        if (!group || !hasText(group.name) || !group.id) return;
        m.rows.push({ text: 'group｜' + v(group.id, 160) + '｜' + v(group.name, 120) + '｜' + (Number(group.members) || 0) + '｜' + v(group.time, 80) + '｜' + (Number(group.unread) || 0) + '｜' + v(group.preview, 300), drop: false });
        var rows = safeArray(group.messages, 24);
        visibility.messages[group.id] = Object.create(null);
        tail(rows, RECENT_MSG_ROWS).forEach(function (message) { if (message && message.id) visibility.messages[group.id][String(message.id)] = true; });
        var hidden = rows.length - RECENT_MSG_ROWS;
        if (hidden > 0) m.rows.push({ text: archived('gmsg', v(group.id, 160), hidden + ' 条旧群消息已归档'), drop: false });
        tail(rows, RECENT_MSG_ROWS).forEach(function (message) {
          if (!message || !message.id) return;
          var mine = /^pmg-\d+$/.test(String(message.id));
          m.rows.push({ text: 'gmsg｜' + v(group.id, 160) + '｜' + v(message.id, 160) + '｜' + v(message.sender, 120) + '｜' + v(message.side, 10) + '｜' + v(message.time, 80) + '｜' + v(message.text), drop: !mine, last: mine });
        });
      });
    }
    if (on('forum')) {
      var f = sec('forum');
      var postList = safeArray(safeObject(s.forum).posts, 20).filter(function (p) {
        return p && p.id && sample.posts.indexOf(String(p.id)) >= 0;
      });
      postList.forEach(function (post) {
        if (!post || !hasText(post.title) || !post.id) return;
        var isUserPost = String(post.owner || '') === 'player';
        // 用户帖子/用户评论（owner=player / pmc-*）是真实事件：全行注入、预算最后让位。
        var rowText = 'post｜' + v(post.id, 160) + '｜' + v(post.author, 120) + '｜' + v(post.role, 120) + '｜' + v(post.section, 60) + '｜' + v(post.time, 80) + '｜' + v(post.title, 200) + '｜' + v(post.body) + '｜' + (Number(post.resonance) || 0) + '｜' + (Number(post.unread) || 0);
        if (isUserPost) rowText += '｜player';
        f.rows.push({ text: rowText, drop: !isUserPost, last: isUserPost });
        var comments = safeArray(post.comments, 20);
        visibility.comments[post.id] = Object.create(null);
        tail(comments, RECENT_COMMENT_ROWS).forEach(function (comment) {
          if (!comment || !comment.author || !comment.time || !comment.text) return;
          visibility.comments[post.id][comment.author + '|' + comment.time + '|' + comment.text] = true;
        });
        var userComments = comments.filter(function (c) { return c && /^pmc-/.test(String(c.id) || ''); });
        var hidden = comments.length - RECENT_COMMENT_ROWS;
        if (hidden > 0) f.rows.push({ text: archived('comment', v(post.id, 160), hidden + ' 条旧评论已归档'), drop: false });
        tail(comments, RECENT_COMMENT_ROWS).forEach(function (comment) {
          if (!comment || !hasText(comment.text)) return;
          var mine = /^pmc-/.test(String(comment.id) || '');
          f.rows.push({ text: 'comment｜' + v(post.id, 160) + '｜' + v(comment.author, 120) + '｜' + v(comment.time, 80) + '｜' + v(comment.text), drop: !mine, last: mine });
        });
      });
    }
    if (on('notes')) {
      var n = sec('notes');
      var notesData = safeObject(s.notes);
      safeArray(notesData.folders, 10).forEach(function (folder) {
        if (!folder || !hasText(folder.name)) return;
        visibility.folders[String(folder.id)] = true;
        n.rows.push({ text: 'folder｜' + v(folder.id, 160) + '｜' + v(folder.name, 120) + '｜' + (Number(folder.count) || 0), drop: false });
      });
      var noteRows = safeArray(notesData.notes, 30);
      noteRows.forEach(function (note, index) {
        if (!note || !note.id || !note.folderId) return;
        if (index < noteRows.length - RECENT_NOTE_ROWS) {
          n.rows.push({ text: archived('note', v(note.id, 160), v(note.title, 200)), drop: false });
          return;
        }
        visibility.notes[String(note.id)] = true;
        n.rows.push({ text: 'note｜' + v(note.id, 160) + '｜' + v(note.folderId, 160) + '｜' + v(note.updated, 80) + '｜' + (note.locked ? 'true' : 'false') + '｜' + v(note.title, 200) + '｜' + v(note.body), drop: true });
      });
    }
    if (on('market')) {
      var k = sec('market');
      var market = safeObject(s.market);
      var listings = safeArray(market.listings, 20);
      listings.forEach(function (item, index) {
        if (!item || !hasText(item.name) || !item.id) return;
        visibility.entities[String(item.id)] = true;
        if (index < listings.length - RECENT_LISTING_ROWS) {
          k.rows.push({ text: archived('listing', v(item.id, 160), v(item.name, 120)), drop: false });
          return;
        }
        k.rows.push({ text: 'listing｜' + v(item.id, 160) + '｜' + v(item.name, 120) + '｜' + v(item.grade, 60) + '｜' + v(item.desc) + '｜' + v(item.price, 80) + '｜' + v(item.seller, 120), drop: true });
      });
      var auctions = safeArray(market.auctions, 12);
      auctions.forEach(function (item, index) {
        if (!item || !hasText(item.name) || !item.id) return;
        visibility.entities[String(item.id)] = true;
        if (index < auctions.length - RECENT_AUCTION_ROWS) {
          k.rows.push({ text: archived('auction', v(item.id, 160), v(item.name, 120)), drop: false });
          return;
        }
        k.rows.push({ text: 'auction｜' + v(item.id, 160) + '｜' + v(item.name, 120) + '｜' + v(item.grade, 60) + '｜' + v(item.desc) + '｜' + v(item.start, 80) + '｜' + v(item.current, 80) + '｜' + v(item.timeLeft, 80) + '｜' + (Number(item.bids) || 0), drop: true });
      });
      safeArray(market.orders, 12).forEach(function (item) {
        if (!item || !hasText(item.name) || !item.id) return;
        visibility.entities[String(item.id)] = true;
        k.rows.push({ text: 'order｜' + v(item.id, 160) + '｜' + v(item.name, 120) + '｜' + v(item.status, 40) + '｜' + v(item.price, 80) + '｜' + v(item.time, 80) + '｜' + v(item.side, 20), drop: false });
      });
      var requests = safeArray(market.requests, 12);
      requests.forEach(function (item, index) {
        if (!item || !hasText(item.name) || !item.id) return;
        visibility.entities[String(item.id)] = true;
        if (index < requests.length - RECENT_REQUEST_ROWS) {
          k.rows.push({ text: archived('request', v(item.id, 160), v(item.name, 120)), drop: false });
          return;
        }
        k.rows.push({ text: 'request｜' + v(item.id, 160) + '｜' + v(item.name, 120) + '｜' + v(item.grade, 60) + '｜' + v(item.desc) + '｜' + v(item.price, 80) + '｜' + v(item.author, 120), drop: true });
      });
    }
    if (on('space')) {
      var sp = sec('space');
      var spaceData = safeObject(s.space);
      safeArray(spaceData.currencies, 10).forEach(function (currency) {
        if (!currency || !hasText(currency.kind)) return;
        visibility.currencies[String(currency.kind)] = true;
        sp.rows.push({ text: 'currency｜' + v(currency.kind, 60) + '｜' + v(currency.amount, 80), drop: false });
      });
      var items = safeArray(spaceData.items, 30);
      items.forEach(function (item, index) {
        if (!item || !hasText(item.name) || !item.id) return;
        visibility.items[String(item.id)] = true;
        if (index < items.length - RECENT_ITEM_ROWS) {
          sp.rows.push({ text: archived('item', v(item.id, 160), v(item.name, 120) + '×' + (Number(item.qty) || 0)), drop: false });
          return;
        }
        sp.rows.push({ text: 'item｜' + v(item.id, 160) + '｜' + v(item.name, 120) + '｜' + (Number(item.qty) || 0) + '｜' + v(item.grade, 60) + '｜' + v(item.desc), drop: true });
      });
    }
    if (on('map')) {
      var mp = sec('map');
      var mapData = safeObject(s.map);
      var current = safeObject(mapData.current);
      if (hasText(current.place)) mp.rows.push({ text: 'current｜' + v(current.place, 120) + '｜' + v(current.domain, 120) + '｜' + v(current.desc), drop: false });
      safeArray(mapData.tracks, 20).forEach(function (track) {
        if (!track || !track.id || !hasText(track.place)) return;
        visibility.tracks[String(track.id)] = true;
        mp.rows.push({ text: 'track｜' + v(track.id, 160) + '｜' + v(track.time, 80) + '｜' + v(track.place, 120) + '｜' + v(track.action, 300), drop: false });
      });
      var places = safeArray(mapData.places, 20);
      places.forEach(function (place, index) {
        if (!place || !place.id || !hasText(place.name)) return;
        visibility.places[String(place.id)] = true;
        if (index < places.length - RECENT_PLACE_ROWS) {
          mp.rows.push({ text: archived('place', v(place.id, 160), v(place.name, 120)), drop: false });
          return;
        }
        mp.rows.push({ text: 'place｜' + v(place.id, 160) + '｜' + v(place.name, 120) + '｜' + v(place.domain, 120) + '｜' + v(place.desc), drop: true });
      });
    }
    return sections;
  }

  function buildCurrent(state, flags, rng) {
    // 接受完整聊天状态（含 spaces）或单个空间对象（视图/测试直传）：后者视为唯一发送空间。
    var allSpaces = state && state.spaces ? safeArray(state.spaces, MAX_SPACES) : (state ? [Object.assign({}, state, { id: DEFAULT_SPACE_ID, isDefault: true, sendToAI: true })] : []);
    var senders = allSpaces.filter(function (sp) { return sp.sendToAI; });
    var share = Math.max(1, senders.length);
    var caps = {
      contacts: Math.max(1, Math.floor(MAX_INJECT_CONTACTS / share)),
      groups: Math.max(1, Math.floor(MAX_INJECT_GROUPS / share)),
      posts: Math.max(1, Math.floor(MAX_INJECT_POSTS / share))
    };
    // 各空间行合并进同一预算池；section 带 space 标签（默认空间 null → 无属性容器）。
    var sections = [];
    var visibility = Object.create(null);
    allSpaces.forEach(function (sp) {
      if (senders.indexOf(sp) >= 0) return;
      // 不送入基线的空间仍保留空可见集：AI 可写开关与发送开关独立，
      // 但对本轮完全不可见的既有实体必须 fail-closed。
      visibility[sp.id] = { contacts: Object.create(null), groups: Object.create(null), posts: Object.create(null), messages: Object.create(null), comments: Object.create(null), folders: Object.create(null), notes: Object.create(null), entities: Object.create(null), currencies: Object.create(null), items: Object.create(null), tracks: Object.create(null), places: Object.create(null), tablet: { groups: Object.create(null), fields: Object.create(null) } };
    });
    senders.forEach(function (sp) {
      visibility[sp.id] = {};
      buildSpaceSections(sp, flags, rng, caps, visibility[sp.id]).forEach(function (item) {
        item.space = sp.isDefault ? null : spaceBaselineLabel(sp);
        item.spaceId = sp.id;
        item.spaceName = sp.isDefault ? '' : cleanText(sp.name, 120);
        // 默认空间行名冲突检查不在此处——自定义空间行 id 命名空间独立（写回按空间路由）。
        sections.push(item);
      });
    });
    // 发送上限：全部行计入预算，五级淘汰见 MAX_BASELINE_CHARS 注释。
    // 实体标识行（contact/group/folder 等存在性与 diff 定位依赖）永不整行淘汰，仅最后截断。
    var total = 0;
    sections.forEach(function (item) {
      item.rows.forEach(function (r) { total += r.text.length; });
    });
    if (total > MAX_BASELINE_CHARS) {
      sections.forEach(function (item) {
        if (item.tag === 'tablet') return;
        item.rows.forEach(function (r) {
          if (r.drop && !r.last && total > MAX_BASELINE_CHARS) {
            total -= r.text.length;
            r.text = '';
          }
        });
      });
      sections.forEach(function (item) {
        if (item.tag !== 'tablet') return;
        item.rows.forEach(function (r) {
          if (r.drop && !r.last && total > MAX_BASELINE_CHARS) {
            total -= r.text.length;
            r.text = '';
          }
        });
      });
      // 第三轮：明细行全丢仍超限的极端满配态下再丢归档摘要行（消息正文在世界书有召回）。
      if (total > MAX_BASELINE_CHARS) {
        sections.forEach(function (item) {
          item.rows.forEach(function (r) {
            if (r.text.indexOf('archived｜') === 0 && !r.last && total > MAX_BASELINE_CHARS) {
              total -= r.text.length;
              r.text = '';
            }
          });
        });
      }
      // 第四轮：归档行也丢光仍超限时，最后丢 last 标记行（用户真实发言，仅极端场景让位）。
      if (total > MAX_BASELINE_CHARS) {
        sections.forEach(function (item) {
          item.rows.forEach(function (r) {
            if (r.last && total > MAX_BASELINE_CHARS) {
              total -= r.text.length;
              r.text = '';
            }
          });
        });
      }
      // 第五轮：标识行全保留也撑爆预算的极端满配态下，把超长标识行截断到短上限
      // （行首 id/name 仍在，diff 可定位；preview/time 等长尾字段放弃）。
      // 截断按字段边界（最后一个「｜」）切割：绝不把 id 拦腰截断，否则下一轮 diff 无法定位该行。
      if (total > MAX_BASELINE_CHARS) {
        sections.forEach(function (item) {
          item.rows.forEach(function (r) {
            if (!r.last && r.text.length > ROW_HARD_CAP && total > MAX_BASELINE_CHARS) {
              total -= r.text.length;
              var cut = r.text.slice(0, ROW_HARD_CAP);
              var lastSep = cut.lastIndexOf('｜');
              if (lastSep > 0) cut = cut.slice(0, lastSep);
              r.text = cut;
              total += r.text.length;
            }
          });
        });
      }
    }
    function renderSections() {
      var result = [];
      sections.forEach(function (item) {
        var rows = [];
        item.rows.forEach(function (r) { if (r.text) rows.push(r.text); });
        if (!rows.length) return;
        result.push('<yzc_' + item.tag + (item.space ? ' space="' + item.space + '"' : '') + '>');
        rows.forEach(function (text) { result.push(text); });
        result.push('</yzc_' + item.tag + '>');
      });
      return result;
    }
    var out = renderSections();
    // 上面的淘汰按数据行长度估算，容器标签和换行仍可能造成边界超出。
    // 最后一层直接以最终序列化结果计量，逐行收缩直到硬上限，绝不返回超预算基线。
    function shrink(text, limit) {
      if (text.length <= limit) return text;
      var cut = text.slice(0, Math.max(1, limit));
      var sep = cut.lastIndexOf('｜');
      return sep > 0 ? cut.slice(0, sep) : cut;
    }
    function overBudget() { return out.join('\n').length - MAX_BASELINE_CHARS; }
    while (overBudget() > 0) {
      var candidate = null;
      sections.forEach(function (item) {
        item.rows.forEach(function (r) {
          if (!r.text) return;
          var preferred = r.drop && !r.last ? 0 : (r.text.indexOf('archived｜') === 0 ? 1 : (r.last ? 2 : 3));
          if (!candidate || preferred < candidate.priority || (preferred === candidate.priority && r.text.length > candidate.row.text.length)) {
            candidate = { row: r, priority: preferred };
          }
        });
      });
      if (!candidate) break;
      var row = candidate.row;
      var before = row.text.length;
      var target = Math.max(1, before - overBudget());
      row.text = shrink(row.text, target);
      out = renderSections();
      if (row.text.length >= before) {
        row.text = before > 1 ? row.text.slice(0, before - 1) : '';
        out = renderSections();
      }
    }
    // 理论上逐行收缩后已经为空；若超长空间标签本身仍越界，宁可丢弃该容器，
    // 也不能返回截断的半个协议标签。
    if (out.join('\n').length > MAX_BASELINE_CHARS) {
      sections.forEach(function (item) { item.rows.forEach(function (r) { r.text = ''; }); });
      out = renderSections();
    }
    // 预算收缩可能移除实体标识行；可见集合必须以最终输出为准，不能沿用
    // 收缩前的采样结果，否则模型看不见的 ID 仍会被当成可更新目标。
    var finalVisibility = Object.create(null);
    allSpaces.forEach(function (sp) {
      finalVisibility[sp.id] = { contacts: Object.create(null), groups: Object.create(null), posts: Object.create(null), messages: Object.create(null), comments: Object.create(null), folders: Object.create(null), notes: Object.create(null), entities: Object.create(null), currencies: Object.create(null), items: Object.create(null), tracks: Object.create(null), places: Object.create(null), tablet: { groups: Object.create(null), fields: Object.create(null) } };
    });
    var activeSection = null;
    out.forEach(function (line) {
      var opening = /^<yzc_([a-z]+)(?: space="([^"]+)")?>$/.exec(line);
      if (opening) {
        activeSection = null;
        sections.forEach(function (item) {
          if (item.tag !== opening[1] || item.space !== (opening[2] || null)) return;
          activeSection = { tag: item.tag, visibility: finalVisibility[item.spaceId] };
        });
        return;
      }
      if (/^<\/yzc_[a-z]+>$/.test(line)) { activeSection = null; return; }
      if (!activeSection || !activeSection.visibility || line.indexOf('archived｜') === 0) return;
      var parts = line.split(/[｜|]/);
      var first = parts[0];
      var vset = activeSection.visibility;
      if (activeSection.tag === 'tablet' && first === 'field') {
        vset.tablet.groups[parts[1]] = true;
        if (!vset.tablet.fields[parts[1]]) vset.tablet.fields[parts[1]] = Object.create(null);
        vset.tablet.fields[parts[1]][parts[2]] = true;
        if (keyId(parts[2])) vset.tablet.fields[parts[1]][keyId(parts[2])] = true;
      }
      else if (activeSection.tag === 'msg' && first === 'contact') vset.contacts[parts[1]] = true;
      else if (activeSection.tag === 'msg' && first === 'group') vset.groups[parts[1]] = true;
      else if (activeSection.tag === 'msg' && (first === 'msg' || first === 'gmsg')) {
        var parent = parts[1];
        if (!vset.messages[parent]) vset.messages[parent] = Object.create(null);
        vset.messages[parent][parts[2]] = true;
      } else if (activeSection.tag === 'forum' && first === 'post') vset.posts[parts[1]] = true;
      else if (activeSection.tag === 'forum' && first === 'comment') {
        if (!vset.comments[parts[1]]) vset.comments[parts[1]] = Object.create(null);
        vset.comments[parts[1]][parts.slice(2).join('|')] = true;
      } else if (activeSection.tag === 'notes' && first === 'folder') vset.folders[parts[1]] = true;
      else if (activeSection.tag === 'notes' && first === 'note') vset.notes[parts[1]] = true;
      else if (activeSection.tag === 'market' && ['listing', 'auction', 'order', 'request'].indexOf(first) >= 0) vset.entities[parts[1]] = true;
      else if (activeSection.tag === 'space' && first === 'currency') vset.currencies[parts[1]] = true;
      else if (activeSection.tag === 'space' && first === 'item') vset.items[parts[1]] = true;
      else if (activeSection.tag === 'map' && first === 'track') vset.tracks[parts[1]] = true;
      else if (activeSection.tag === 'map' && first === 'place') vset.places[parts[1]] = true;
    });
    visibility = finalVisibility;
    try { Object.defineProperty(out, 'visibility', { value: visibility, enumerable: false }); } catch (_) { out.visibility = visibility; }
    return out;
  }

  function buildPrompt(lang, flags, ctx) {
    flags = flags || {};
    ctx = ctx || {};
    function on(id) { return flags[id] !== false; }
    var en = String(lang) === 'en';
    var forceFull = !!ctx.forceFull;
    var lines = [
      '',
      forceFull
        ? (en ? '[Yu Zhao | FORCED FULL sync this turn — output the DEFAULT space in full (user spaces stay diff-only), mandatory]' : '【修仙传讯法器·玉兆｜本轮强制全量同步：默认空间必须整块全量输出（用户空间仍只用 diff），必须执行】')
        : (en ? '[Yu Zhao | Incremental sync in diff format, mandatory]' : '【修仙传讯法器·玉兆｜以 diff 格式增量同步，必须执行】'),
      en ? 'Read the current story, character sheet and relations. After the story text finishes normally, output one <yz_jade> at the end. It is the character\'s artifact data; do not restate it in the story body.' : '读当前剧情、设定与关系。正文正常完成后，在末尾输出一个 <yz_jade>。这是角色的法器数据，不在正文中复述。',
      en ? 'Format: not JSON, not a code block; one row per line, fields separated by ｜ with no ｜ inside values; every section opens and closes on its own tag; rows reference ids declared in the baseline or earlier in the same turn.' : '格式：非 JSON、非代码块；一行一条，字段用 ｜ 分隔，字段内容不使用竖线；每个区块用独立标签开合；行内引用的 id 必须来自基线或本轮同一区块内已声明的 id。',
      en ? 'All time fields in every row must be absolute dates (e.g. 丙午年五月十二 午时); relative words like 今日/昨日 are forbidden — messages are archived to the lorebook and recalled at later story dates.' : '所有行的时间字段一律使用绝对日期（如 丙午年五月十二 午时），禁止 今日/昨日 等相对表述；消息会进世界书归档，在剧情日期更晚时被召回。'
    ];
    if (!forceFull) {
      lines.push(en
        ? 'Diff format: prefix a row with + to add or update it (a row whose id already exists is replaced whole, otherwise appended); prefix with - to delete it (locating fields only); all other baseline rows are kept as-is and must not be restated.'
        : 'diff 格式：+ 前缀行新增或更新（id 已存在则整行替换，不存在则追加）；- 前缀行删除（只需给出定位字段）；基线中其余行原样保留，一律不复述。');
      lines.push(en ? 'If nothing changed this turn, output <yz_meta> only.' : '本轮没有任何数据变化时，只输出 <yz_meta>。');
    }
    lines.push(en ? 'Standing minimums for the artifact data (a forced full turn must establish them all at once; diff turns maintain them):' : '法器数据底线（强制全量轮必须一次全部建立，diff 轮负责维持）：');
    PROMPT_FEATURES.forEach(function (feature) {
      if (!on(feature.id)) return;
      var pack = feature[en ? 'en' : 'zh'];
      lines.push(pack.constraint);
    });
    lines.push(en ? 'No generic templates, no placeholder people, no empty items; everything must be tied to this turn.' : '不得使用通用模板、陌生占位人或空项；所有内容与本轮剧情强相关。');
    // 用户空间规则：多空间注入与写回路由（含拒写语义说明）。
    var spaceLines = [];
    var defaultInfo = null;
    (ctx.spaces || []).forEach(function (sp) {
      var name = sp.isDefault ? (ctx.characterName || (en ? 'default' : '默认')) : cleanText(sp.name, 120);
      var policy = (sp.sendToAI !== false ? (en ? 'baseline sent' : '送入基线') : (en ? 'baseline not sent' : '不送入基线')) +
        ' + ' + (sp.allowAIWrite !== false ? (en ? 'AI writes allowed' : '允许 AI 写入') : (en ? 'AI writes rejected' : '拒收 AI 写入'));
      if (sp.isDefault) defaultInfo = policy;
      else spaceLines.push('「' + name + '」[' + policy + '; route=' + encodeSpaceRoute(sp.name) + ']');
    });
    lines.push(en
      ? '- User spaces: the artifact keeps several isolated data spaces. The default one is YOUR OWN space (character ' + (ctx.characterName || '') + '): ' + (defaultInfo || 'baseline sent + AI writes allowed') + '. Its baseline containers <yzc_*> without a space attribute are its data; your <yz_jade> output without a space field writes it. Other user spaces: ' + (spaceLines.length ? spaceLines.join(', ') : '(none)') + '. Their baseline rows sit in containers tagged space="ROUTE_TOKEN"; to update one, output ANOTHER complete <yz_jade> block whose turn row ends with ｜ROUTE_TOKEN as the 6th field. Route tokens are reversible URI encodings of the displayed names. One block writes exactly one space.'
      : '- 用户空间：法器内并存多个互相隔离的数据空间。默认空间是你（角色 ' + (ctx.characterName || '') + '）本人的空间：' + (defaultInfo || '送入基线 + 允许 AI 写入') + '。基线中不带 space 属性的 <yzc_*> 容器就是它的数据，输出的 <yz_jade> 不带空间字段时写入它。其余用户空间：' + (spaceLines.join('、') || '（无）') + '。它们的数据在基线中带 space="路由 token" 属性标记；需要更新某个用户空间时，另行输出一个完整的 <yz_jade> 块，并在其 turn 行末尾以第 6 个字段填写对应路由 token。路由 token 是显示名称的可逆 URI 编码，不得改写或解码后再填入。一个块只写一个空间。');
    lines.push(en
      ? '- User-space minimums: only diff mode is accepted for non-default spaces (full rewrites of private user data are discarded by the artifact); a space marked read-only rejects every write. In user spaces, in every space, rows owned by the user are real statements: contacts with ids starting c-, messages pm-N/pmg-N, posts with owner player and comments pmc-N — never rewrite, delete, copy or forge them (the artifact rejects such rows). Reply to a user thread by appending a +msg/+gmsg/+comment row with a fresh id.'
      : '- 用户空间约束：非默认空间只接受 diff 轮（全量重写会被法器丢弃）；标注只读的空间拒收一切写入。任何空间内归属用户的行都是真实发言：c- 前缀联系人、pm-N/pmg-N 消息、owner=player 的帖子与 pmc- 评论——不得改写、删除、复制或伪造（这类行会被法器直接拒绝）。要回复用户线程，用全新 id 追加你自己的 +msg/+gmsg/+comment 行即可。');
    lines.push(en
      ? '- Data of every listed space is established fact for this character: act consistently with it, and never move rows between spaces.'
      : '- 各空间的数据都是既定事实：叙事须与之一致，且不得把数据行在空间之间搬运。');
    // issue 回声：当前未达标项（≤3 条，按 lang 选语种），要求模型用 + 行补齐。
    var issueItems = (Array.isArray(ctx.issues) ? ctx.issues : []).slice(0, 3).map(function (issue) {
      var code = issue && issue.code ? String(issue.code) : '';
      var text = code ? tr('assess.issue.' + code) : '';
      return text === 'assess.issue.' + code ? cleanText(issue.path, 80) : text;
    }).filter(function (text) { return CORE.hasText(text); });
    if (issueItems.length) {
      lines.push(en
        ? 'The artifact data is currently incomplete on: ' + issueItems.join('; ') + '. Fix it this turn with + rows' + (forceFull ? ' (or by outputting the full sections).' : '.')
        : '法器数据当前以下项目未达标：' + issueItems.join('；') + '。本轮用 + 行补齐' + (forceFull ? '（或完整输出对应区块）。' : '。'));
    }
    lines.push('<yz_jade>');
    lines.push('<yz_meta>');
    lines.push(forceFull
      ? (en ? 'turn｜unique-turn-id｜character name｜what changed this turn｜full｜(optional target user-space name)' : 'turn｜本轮唯一ID｜角色名｜本轮变化摘要｜full｜（可选）目标用户空间名')
      : (en ? 'turn｜unique-turn-id｜character name｜what changed this turn｜diff｜(optional target user-space name)' : 'turn｜本轮唯一ID｜角色名｜本轮变化摘要｜diff｜（可选）目标用户空间名'));
    lines.push('</yz_meta>');
    PROMPT_FEATURES.forEach(function (feature) {
      if (!on(feature.id)) return;
      lines.push.apply(lines, feature[en ? 'en' : 'zh'].rows);
    });
    if (!forceFull) {
      lines.push(en
        ? 'Delete rows (locating fields only): -field｜group｜key｜ -contact｜id｜ -msg｜contact-id｜message-id｜ -group｜id｜ -gmsg｜group-id｜message-id｜ -post｜id｜ -comment｜post-id｜author｜time｜text｜ -folder｜id｜ -note｜id｜ -listing｜id｜ -auction｜id｜ -order｜id｜ -currency｜kind｜ -item｜id｜ -track｜id｜ -place｜id｜ -request｜id'
        : '删除行（只给定位字段）：-field｜组｜键｜ -contact｜id｜ -msg｜联系人id｜消息id｜ -group｜id｜ -gmsg｜群id｜消息id｜ -post｜id｜ -comment｜帖子id｜评论者｜时间｜内容｜ -folder｜id｜ -note｜id｜ -listing｜id｜ -auction｜id｜ -order｜id｜ -currency｜种类｜ -item｜id｜ -track｜id｜ -place｜id｜ -request｜id');
    }
    lines.push('</yz_jade>');
    // 当前数据基线：全量轮与 diff 轮都注入——模型据此沿用既有 id 与未变化行，
    // 重新生成的数据才能与已同步内容关联（多轮连续性）。
    var currentRows = Array.isArray(ctx.current) ? ctx.current.filter(function (rowText) { return CORE.hasText(rowText); }) : [];
    if (currentRows.length) {
      lines.push(en ? 'Baseline: <yz_current> below is the artifact\'s current data grouped by space — yzc_ containers without a space attribute belong to your default space, containers with space="ROUTE_TOKEN" belong to that user space (route tokens are reversible URI encodings; yzc_ tags are containers only — your output still uses the <yz_jade> format above).' : '基线：<yz_current> 内是法器的当前数据，按空间分组：不带 space 属性的 yzc_ 容器属于你的默认空间，带 space="路由 token" 的属于该用户空间（路由 token 是可逆 URI 编码；yzc_ 标签仅为容器，输出仍用上面的 <yz_jade> 格式）。');
      if (!forceFull) {
        lines.push(en ? '- Diff against this baseline: output only the + / - rows for what this turn\'s story changed; never restate unchanged rows;' : '- 对照基线出 diff：本轮剧情影响了哪些行就输出哪些 +/- 行，未变化的行一律不复述；');
        lines.push(en ? '- New ids must not collide with the baseline.' : '- 新增 id 不得与基线冲突。');
      } else {
        lines.push(en ? '- Carry baseline rows over with ids unchanged unless the story changed them; new ids must not collide.' : '- 未受剧情影响的基线行原样沿用、id 一律不变；新增 id 不得与基线冲突。');
        lines.push(en ? '- Forced full rewrite: rows whose time fields are still relative (今日/昨日/明天 etc.) must be rewritten to absolute dates (e.g. 丙午年五月十二 午时) this turn.' : '- 全量重写：基线中时间字段仍为相对表述（今日/昨日 等）的行，本轮一律改写为绝对日期（如 丙午年五月十二 午时）。');
      }
      lines.push(en ? '- Baseline data is established fact: neither the story nor <yz_jade> may contradict it.' : '- 基线数据视为既定事实，正文与 <yz_jade> 均不得与之矛盾。');
      lines.push(en ? '- Only ids shown in this turn\'s visible baseline may update or delete existing entities; an existing id outside the sampled window is not a valid target and will be rejected.' : '- 只有本轮可见基线中展示的 id 才能更新或删除已有实体；采样窗口外的已有 id 不是有效目标，法器会拒绝该行。');
      lines.push(en ? '- archived rows mark older data whose bodies are not injected: never restate them, and never replace an archived item with a + row (its body would be lost); remove one only with a - row.' : '- 基线中的 archived 行是正文未注入的归档旧数据：不要复述，也不要用 + 行整行替换归档条目（会丢失正文）；需要移除时只用 - 行删除。');
      lines.push(en ? '- This applies to regenerated or continued replies as well: across such turns the artifact data must stay consistent with the baseline.' : '- 重新生成或续写的回复同样受此约束：跨这些轮次法器数据必须与基线保持一致。');
      lines.push('<yz_current>');
      lines.push.apply(lines, currentRows);
      lines.push('</yz_current>');
    }
    var synced = [];
    PROMPT_FEATURES.forEach(function (feature) {
      if (on(feature.id)) synced.push(feature[en ? 'en' : 'zh'].name);
    });
    lines.push((en ? (forceFull ? 'Synced this turn: ' : 'Enabled this turn: ') : (forceFull ? '本轮已同步：' : '本轮已启封：')) + synced.join(en ? ', ' : '、'));
    return lines.join('\n');
  }

  function mutatePrepareEvent(event, lang, flags, ctx) {
    if (!event || typeof event !== 'object') return event;
    var text = PROTOCOL.stripBlocks(String(event.text == null ? '' : event.text));
    event.text = text + (text ? '\n\n' : '') + buildPrompt(lang, flags, ctx);
    return event;
  }

  var PROMPT = { buildPrompt: buildPrompt, buildCurrent: buildCurrent, mutatePrepareEvent: mutatePrepareEvent, MAX_BASELINE_CHARS: MAX_BASELINE_CHARS };
