  function parseEnvelope(text, tag) {
    var out = [];
    var pattern = new RegExp('<' + tag + '\\s*>([\\s\\S]*?)<\\/' + tag + '>', 'gi');
    var match;
    while ((match = pattern.exec(String(text || '')))) {
      try {
        out.push({ tag: tag, body: match[1].replace(/^```json\s*|```$/gi, '').trim() });
      } catch (_) {}
    }
    return out;
  }

  function lines(block) {
    return String(block == null ? '' : block).split(/\r?\n/).map(function (line) {
      // 项目符号剥离要求后随空白（markdown 语义）：`-contact｜…` 这类无空格前缀保留给 diff 行。
      return line.trim().replace(/^[-•*]\s+/, '');
    }).filter(function (line) { return line && !/^```/.test(line) && !/^<\/?yz_/i.test(line); });
  }

  function row(line, expected) {
    var values = String(line || '').split(/[｜|\t]/).map(function (value) { return cleanText(value, 3000); });
    if (expected && values.length > expected) values = values.slice(0, expected - 1).concat([values.slice(expected - 1).join('｜')]);
    while (expected && values.length < expected) values.push('');
    return values;
  }

  function typed(block, names) {
    names = Array.isArray(names) ? names : [names];
    names = names.map(function (name) { return String(name).toLowerCase(); });
    return lines(block).filter(function (line) {
      return names.indexOf(String(row(line, 0)[0]).toLowerCase()) >= 0;
    });
  }

  // 行类型别名表：diff 操作行的类型解析（+contact / -msg 等）与 typed() 同源。
  var ROW_TYPES = {
    field: ['field', '字段'],
    contact: ['contact', '联系人'],
    msg: ['msg', 'message', '消息'],
    group: ['group', '群', '群聊'],
    gmsg: ['gmsg', '群消息', '群讯'],
    post: ['post', '帖子'],
    comment: ['comment', '评论'],
    folder: ['folder', '文件夹', '分类'],
    note: ['note', '备忘'],
    listing: ['listing', '商品', '在售'],
    auction: ['auction', '拍卖', '拍品'],
    order: ['order', '订单'],
    request: ['request', '求购', '求购单'],
    currency: ['currency', '灵石', '钱财'],
    item: ['item', '物品'],
    current: ['current', '当前', '所在地'],
    track: ['track', '行踪'],
    place: ['place', '地点', '地名']
  };

  var TYPE_CANON = {};
  Object.keys(ROW_TYPES).forEach(function (canon) {
    ROW_TYPES[canon].forEach(function (alias) { TYPE_CANON[alias] = canon; });
  });

  function canonType(name) {
    return TYPE_CANON[String(name || '').trim().toLowerCase()] || null;
  }

  // diff 操作行：+ 前缀新增/更新（upsert），- 前缀删除；无前缀行宽松按 + 处理。
  // values 为去掉类型字段后的行字段（与各 parse* 的字段序一致）。
  function parseDiffOps(body) {
    var ops = [];
    // diff 行按行类型固定字段数 join 尾部自由文本（与 full 路径 row(line, N) 同规则，
    // 正文/内容含｜时不再截断）。post 行例外：body 之后还有可选的 unread/owner
    // 结构化字段，join 会吞字段，保持逐字段解析（body 内｜由 buildCurrent 清洗规避）。
    var EXPECTED = { msg: 6, gmsg: 7, comment: 5, contact: 7, group: 7 };
    lines(body).forEach(function (line) {
      var add = true;
      var rest = line;
      var sign = line.charAt(0);
      if (sign === '-') { add = false; rest = line.slice(1); }
      else if (sign === '+') { rest = line.slice(1); }
      var values = row(rest, 0);
      var type = canonType(values[0]);
      if (!type) return;
      var expected = EXPECTED[type];
      if (expected && values.length > expected) {
        values = values.slice(0, expected - 1).concat([values.slice(expected - 1).join('｜')]);
      }
      ops.push({ add: add, type: type, values: values.slice(1) });
    });
    return ops;
  }

  function sectionHasDiffRows(body) {
    if (body == null) return false;
    var rows = lines(body);
    for (var i = 0; i < rows.length; i += 1) {
      var ch = rows[i].charAt(0);
      if (ch === '+' || ch === '-') return true;
    }
    return false;
  }

  function section(source, tag) {
    source = String(source || '');
    var strict = source.match(new RegExp('<yz_' + tag + '\\s*>([\\s\\S]*?)<\\/yz_' + tag + '>', 'i'));
    if (strict) return strict[1];
    var open = new RegExp('<yz_' + tag + '\\s*>', 'i').exec(source);
    if (!open) return null;
    var rest = source.slice(open.index + open[0].length);
    // digest/current 也在边界枚举内：模型复读 <yz_digest>/<yz_current> 时不能吞掉后续分区或截断当前分区。
    var next = rest.search(/<\/?yz_(?:jade|meta|tablet|msg|forum|notes|market|space|map|digest|current)\b/i);
    return next >= 0 ? rest.slice(0, next) : rest;
  }

  function parseMeta(body) {
    // turn 行第 6 字段（可选）= 目标用户空间名；缺省/空白 = 默认空间（{{char}}）。
    var meta = { id: '', roleName: '', summary: '', mode: '', space: '' };
    typed(body, ['turn', '轮次']).forEach(function (line) {
      var values = row(line, 6);
      meta.id = cleanText(values[1], 160);
      meta.roleName = cleanText(values[2], 120);
      meta.summary = cleanText(values[3], 500);
      meta.mode = cleanText(values[4], 40);
      meta.space = decodeSpaceRoute(values[5]);
    });
    return meta;
  }

  // 空间名是用户数据，可能包含空格、竖线或引号。协议字段和 yzc 属性统一使用
  // URI 编码 token，解析时还原原名，避免清洗后路由到另一个空间或破坏行语法。
  function encodeSpaceRoute(value) {
    try { return encodeURIComponent(cleanText(value, 120)); } catch (_) { return ''; }
  }

  function decodeSpaceRoute(value) {
    var token = cleanText(value, 600);
    if (!token) return '';
    try { return cleanText(decodeURIComponent(token), 120); } catch (_) { return token; }
  }

  function parseTablet(body) {
    var groups = [];
    typed(body, ['field', '字段']).forEach(function (line) {
      var values = row(line, 4);
      var gid = CORE.groupId(values[1]);
      if (!gid) return;
      var key = cleanText(values[2], 60);
      var value = cleanText(values[3], 3000);
      if (!key) return;
      var group = null;
      groups.forEach(function (g) { if (g.id === gid) group = g; });
      if (!group) { group = { id: gid, fields: [] }; groups.push(group); }
      if (group.fields.length < 30) group.fields.push({ key: key, value: value });
    });
    var tablet = CORE.blankTablet();
    CORE.GROUP_ORDER.forEach(function (id) {
      var group = null;
      groups.forEach(function (g) { if (g.id === id) group = g; });
      if (!group) return;
      group.fields.forEach(function (field) {
        var kid = CORE.keyId(field.key);
        if (id === 'basic') {
          if (kid === 'name' && !tablet.name) tablet.name = field.value;
        }
        if (!tablet.groups.some(function (g) { return g.id === id; })) tablet.groups.push({ id: id, fields: [] });
        tablet.groups.filter(function (g) { return g.id === id; })[0].fields.push(field);
      });
    });
    return tablet;
  }

  function parseMsg(body) {
    var contacts = Object.create(null);
    var out = { contacts: [], groups: [] };
    typed(body, ['contact', '联系人']).forEach(function (line) {
      var values = row(line, 7);
      var id = cleanText(values[1], 160);
      if (!id) return;
      var item = {
        id: id,
        name: cleanText(values[2], 120),
        relation: cleanText(values[3], 120),
        time: cleanText(values[4], 80),
        unread: nzero(values[5]),
        preview: cleanText(values[6], 300),
        messages: []
      };
      if (!hasText(item.name)) return;
      contacts[id] = item;
      if (out.contacts.length < 10) out.contacts.push(item);
    });
    typed(body, ['msg', 'message', '消息']).forEach(function (line) {
      var values = row(line, 6);
      var contact = contacts[cleanText(values[1], 160)];
      if (!contact) return;
      contact.messages.push({
        id: cleanText(values[2], 160),
        side: normalizeSide(values[3]),
        time: cleanText(values[4], 80),
        text: cleanText(values[5], 3000)
      });
      if (!contact.preview && contact.messages.length) contact.preview = contact.messages[contact.messages.length - 1].text;
    });
    var groups = Object.create(null);
    typed(body, ['group', '群', '群聊']).forEach(function (line) {
      var values = row(line, 7);
      var id = cleanText(values[1], 160);
      if (!id) return;
      var item = {
        id: id,
        name: cleanText(values[2], 120),
        members: nzero(values[3]),
        time: cleanText(values[4], 80),
        unread: nzero(values[5]),
        preview: cleanText(values[6], 300),
        messages: []
      };
      if (!hasText(item.name)) return;
      groups[id] = item;
      if (out.groups.length < 6) out.groups.push(item);
    });
    typed(body, ['gmsg', '群消息', '群讯']).forEach(function (line) {
      var values = row(line, 7);
      var group = groups[cleanText(values[1], 160)];
      if (!group) return;
      group.messages.push({
        id: cleanText(values[2], 160),
        sender: cleanText(values[3], 120),
        side: normalizeSide(values[4]),
        time: cleanText(values[5], 80),
        text: cleanText(values[6], 3000)
      });
      if (!group.preview && group.messages.length) group.preview = group.messages[group.messages.length - 1].text;
    });
    return out;
  }

  function parseNotes(body) {
    var out = { folders: [], notes: [] };
    var folders = Object.create(null);
    typed(body, ['folder', '文件夹', '分类']).forEach(function (line) {
      var values = row(line, 4);
      var id = cleanText(values[1], 160);
      if (!id) return;
      var item = { id: id, name: cleanText(values[2], 120), count: Number(values[3]) || 0 };
      if (!hasText(item.name)) return;
      folders[id] = item;
      if (out.folders.length < 10) out.folders.push(item);
    });
    typed(body, ['note', '备忘']).forEach(function (line) {
      var values = row(line, 7);
      var folderId = cleanText(values[2], 160);
      if (!folderId || !folders[folderId]) return;
      if (out.notes.length >= 30) return;
      out.notes.push({
        id: cleanText(values[1], 160),
        folderId: folderId,
        updated: cleanText(values[3], 80),
        locked: flagOf(values[4]),
        title: cleanText(values[5], 200),
        body: cleanText(values[6], 3000)
      });
    });
    return out;
  }

  function parseForum(body) {
    var out = { posts: [] };
    var posts = Object.create(null);
    typed(body, ['post', '帖子']).forEach(function (line) {
      var values = row(line, 11);
      var id = cleanText(values[1], 160);
      if (!id) return;
      // unread（第 10 字段）与 owner（第 11 字段）启发式兼容旧格式：
      // 旧格式第 10 字段是 owner（'player'）；新格式第 10 字段是数字（未读新回复数）。
      var v9 = String(values[9] || '').trim();
      var unread;
      var owner;
      if (v9 === 'player' || !/^\d+$/.test(v9)) {
        unread = 0;
        owner = cleanText(v9, 20);
      } else {
        unread = Number(v9) || 0;
        owner = cleanText(values[10], 20);
      }
      var item = {
        id: id,
        owner: owner,
        unread: unread,
        author: cleanText(values[2], 120),
        role: cleanText(values[3], 120),
        section: cleanText(values[4], 60),
        time: cleanText(values[5], 80),
        title: cleanText(values[6], 200),
        body: cleanText(values[7], 3000),
        resonance: nzero(values[8]),
        comments: []
      };
      if (!hasText(item.title)) return;
      posts[id] = item;
      if (out.posts.length < 20) out.posts.push(item);
    });
    typed(body, ['comment', '评论']).forEach(function (line) {
      var values = row(line, 5);
      var post = posts[cleanText(values[1], 160)];
      if (!post || post.comments.length >= 20) return;
      var text = cleanText(values[4], 3000);
      if (!hasText(text)) return;
      post.comments.push({ id: 'cm-' + (post.comments.length + 1), author: cleanText(values[2], 120), time: cleanText(values[3], 80), text: text });
    });
    return out;
  }

  function parseMarket(body) {
    var out = { listings: [], auctions: [], orders: [], requests: [] };
    typed(body, ['listing', '商品', '在售']).forEach(function (line) {
      var values = row(line, 7);
      var id = cleanText(values[1], 160);
      var name = cleanText(values[2], 120);
      if (!id || !hasText(name) || out.listings.length >= 20) return;
      out.listings.push({ id: id, name: name, grade: cleanText(values[3], 60), desc: cleanText(values[4], 3000), price: cleanText(values[5], 80), seller: cleanText(values[6], 120) });
    });
    typed(body, ['auction', '拍卖', '拍品']).forEach(function (line) {
      var values = row(line, 9);
      var id = cleanText(values[1], 160);
      var name = cleanText(values[2], 120);
      if (!id || !hasText(name) || out.auctions.length >= 12) return;
      out.auctions.push({ id: id, name: name, grade: cleanText(values[3], 60), desc: cleanText(values[4], 3000), start: cleanText(values[5], 80), current: cleanText(values[6], 80), timeLeft: cleanText(values[7], 80), bids: nzero(values[8]) });
    });
    typed(body, ['order', '订单']).forEach(function (line) {
      var values = row(line, 7);
      var id = cleanText(values[1], 160);
      var name = cleanText(values[2], 120);
      if (!id || !hasText(name) || out.orders.length >= 12) return;
      out.orders.push({ id: id, name: name, status: cleanText(values[3], 40), price: cleanText(values[4], 80), time: cleanText(values[5], 80), side: cleanText(values[6], 20) });
    });
    typed(body, ['request', '求购', '求购单']).forEach(function (line) {
      var values = row(line, 7);
      var id = cleanText(values[1], 160);
      var name = cleanText(values[2], 120);
      if (!id || !hasText(name) || out.requests.length >= 12) return;
      out.requests.push({ id: id, name: name, grade: cleanText(values[3], 60), desc: cleanText(values[4], 3000), price: cleanText(values[5], 80), author: cleanText(values[6], 120) });
    });
    return out;
  }

  function parseSpace(body) {
    var out = { currencies: [], items: [] };
    typed(body, ['currency', '灵石', '钱财']).forEach(function (line) {
      var values = row(line, 3);
      var kind = cleanText(values[1], 60);
      if (!hasText(kind) || out.currencies.length >= 10) return;
      out.currencies.push({ kind: kind, amount: cleanText(values[2], 80) });
    });
    typed(body, ['item', '物品']).forEach(function (line) {
      var values = row(line, 6);
      var id = cleanText(values[1], 160);
      var name = cleanText(values[2], 120);
      if (!id || !hasText(name) || out.items.length >= 30) return;
      out.items.push({ id: id, name: name, qty: nzero(values[3]), qtyText: cleanText(values[3], 40), grade: cleanText(values[4], 60), desc: cleanText(values[5], 3000) });
    });
    return out;
  }

  function parseMap(body) {
    var out = { current: { place: '', domain: '', desc: '' }, tracks: [], places: [] };
    typed(body, ['current', '当前', '所在地']).forEach(function (line) {
      var values = row(line, 4);
      var place = cleanText(values[1], 120);
      if (!hasText(place)) return;
      out.current = { place: place, domain: cleanText(values[2], 120), desc: cleanText(values[3], 3000) };
    });
    typed(body, ['track', '行踪']).forEach(function (line) {
      var values = row(line, 5);
      var id = cleanText(values[1], 160);
      var place = cleanText(values[3], 120);
      if (!id || !hasText(place) || out.tracks.length >= 20) return;
      out.tracks.push({ id: id, time: cleanText(values[2], 80), place: place, action: cleanText(values[4], 300) });
    });
    typed(body, ['place', '地点', '地名']).forEach(function (line) {
      var values = row(line, 5);
      var id = cleanText(values[1], 160);
      var name = cleanText(values[2], 120);
      if (!id || !hasText(name) || out.places.length >= 20) return;
      out.places.push({ id: id, name: name, domain: cleanText(values[3], 120), desc: cleanText(values[4], 3000) });
    });
    return out;
  }

  // skip 语义：skip 行必须是区块内唯一数据行；与普通数据混排时忽略 skip、按数据解析。
  function detectSkip(body) {
    if (body == null) return null;
    var rows = lines(body);
    if (!rows.length) return null;
    var reason = '';
    for (var i = 0; i < rows.length; i += 1) {
      var values = row(rows[i], 2);
      if (String(values[0]).toLowerCase() !== 'skip') return null;
      if (!reason) reason = cleanText(values[1], 200);
    }
    return { reason: reason };
  }

  var DATA_SECTIONS = [['tablet', 'tabletBody'], ['msg', 'msgBody'], ['forum', 'forumBody'], ['notes', 'notesBody'], ['market', 'marketBody'], ['space', 'spaceBody'], ['map', 'mapBody']];

  function parse(text) {
    var source = String(text || '');
    if (!/<yz_jade\b|<yz_meta\b|<yz_tablet\b|<yz_msg\b|<yz_forum\b|<yz_notes\b|<yz_market\b|<yz_space\b|<yz_map\b/i.test(source)) return null;
    var metaBody = section(source, 'meta');
    var tabletBody = section(source, 'tablet');
    var msgBody = section(source, 'msg');
    var forumBody = section(source, 'forum');
    var notesBody = section(source, 'notes');
    var marketBody = section(source, 'market');
    var spaceBody = section(source, 'space');
    var mapBody = section(source, 'map');
    var turn = metaBody == null ? null : parseMeta(metaBody);
    // 分区三态：出现（有数据）/ skip（单行 skip｜原因）/ 缺省（整块省略）。
    var bodies = { tablet: tabletBody, msg: msgBody, forum: forumBody, notes: notesBody, market: marketBody, space: spaceBody, map: mapBody };
    // diff 快照：meta 声明 diff，或任一分区出现 +/- 操作行（声明缺失时以行形态为准，
    // 防止模型只输出变化行却被当全量整块替换——那会清掉未提及的数据）。
    var anyDiffRows = DATA_SECTIONS.some(function (pair) { return sectionHasDiffRows(bodies[pair[0]]); });
    var diffMode = anyDiffRows || (turn != null && turn.mode === 'diff');
    if (diffMode) {
      var diff = {};
      DATA_SECTIONS.forEach(function (pair) {
        var id = pair[0];
        var body = bodies[id];
        if (body == null) return;
        var ops = parseDiffOps(body);
        if (ops.length) diff[id] = ops;
      });
      var diffOut = CORE.sanitize({
        version: 1,
        turn: turn || { id: '', roleName: '', summary: '', mode: 'diff' },
        tablet: { groups: [] },
        chats: { contacts: [], groups: [] },
        forum: { posts: [] },
        notes: { folders: [], notes: [] },
        market: { listings: [], auctions: [], orders: [], requests: [] },
        space: { currencies: [], items: [] },
        map: { current: { place: '', domain: '', desc: '' }, tracks: [], places: [] }
      });
      diffOut.diff = diff;
      return diffOut;
    }
    var present = [];
    var skipped = {};
    DATA_SECTIONS.forEach(function (pair) {
      var id = pair[0];
      var body = bodies[id];
      if (body == null) return;
      var skip = detectSkip(body);
      if (skip) { skipped[id] = skip.reason || 'skip'; return; }
      present.push(id);
    });
    var tablet = tabletBody == null || skipped.tablet != null ? { groups: [] } : parseTablet(tabletBody);
    var chats = msgBody == null || skipped.msg != null ? { contacts: [], groups: [] } : parseMsg(msgBody);
    var forum = forumBody == null || skipped.forum != null ? { posts: [] } : parseForum(forumBody);
    var notes = notesBody == null || skipped.notes != null ? { folders: [], notes: [] } : parseNotes(notesBody);
    var market = marketBody == null || skipped.market != null ? { listings: [], auctions: [], orders: [], requests: [] } : parseMarket(marketBody);
    var space = spaceBody == null || skipped.space != null ? { currencies: [], items: [] } : parseSpace(spaceBody);
    var map = mapBody == null || skipped.map != null ? { current: { place: '', domain: '', desc: '' }, tracks: [], places: [] } : parseMap(mapBody);
    if (!turn && !tablet.groups.length && !tablet.name && !chats.contacts.length && !chats.groups.length && !forum.posts.length && !notes.folders.length && !notes.notes.length && !market.listings.length && !market.auctions.length && !market.orders.length && !market.requests.length && !space.currencies.length && !space.items.length && !map.current.place && !map.tracks.length && !map.places.length) return null;
    var out = CORE.sanitize({
      version: 1,
      turn: turn || { id: 'turn-' + CORE.stableHash(source), roleName: '', summary: '', mode: '' },
      tablet: tablet,
      chats: chats,
      forum: forum,
      notes: notes,
      market: market,
      space: space,
      map: map
    });
    if (present.length) out.present = present;
    if (Object.keys(skipped).length) out.skipped = skipped;
    return out;
  }

  var TAG_PREFIX = /(?:<|&lt;)yz(?:_(?:jade|meta|tablet|msg|forum|notes|market|space|map|digest|current)|c_[a-z0-9_]+)\b/i;

  function stripStreamTail(text) {
    text = String(text == null ? '' : text);
    var match = TAG_PREFIX.exec(text);
    if (match) text = text.slice(0, match.index);
    match = /(?:<|&lt;)$/i.exec(text);
    if (match) text = text.slice(0, match.index);
    else {
      match = /(?:<|&lt;)y(?:z(?:_[a-z0-9_]*)?)?$/i.exec(text);
      if (match) text = text.slice(0, match.index);
    }
    return text.trim();
  }

  function stripBlocks(text) {
    return stripStreamTail(String(text == null ? '' : text)
      .replace(/<yz_jade\s*>[\s\S]*?<\/yz_jade>/gi, '')
      // 模型可能把 digest 摘要或 current 基线复读进正文：整块剥离，未闭合时剥到文本末尾。
      .replace(/<yz_digest\s*>[\s\S]*?(?:<\/yz_digest>|$)/gi, '')
      .replace(/<yz_current\s*>[\s\S]*?(?:<\/yz_current>|$)/gi, '')
      // 基线容器（yzc_*）被复读进正文时同样剥离，避免残留的 yzc_ 标签触发误判解析失败。
      .replace(/<yzc_[a-z0-9_]+(?:\s[^>]*)?>[\s\S]*?(?:<\/yzc_[a-z0-9_]+>|$)/gi, '')
      .replace(/<yz_jade\s*>[\s\S]*$/gi, ''));
  }

  function extractSnapshots(text) {
    var source = String(text || '');
    var opens = [];
    var openPattern = /<yz_jade\b[^>]*>/gi;
    var open;
    while ((open = openPattern.exec(source))) opens.push({ index: open.index, end: openPattern.lastIndex });
    // Keep the bare-section path for history fragments and explicit callers.
    if (!opens.length) {
      var parsed = parse(source);
      return parsed ? [parsed] : [];
    }
    var out = [];
    opens.forEach(function (opening, index) {
      var nextOpen = index + 1 < opens.length ? opens[index + 1].index : -1;
      var closePattern = /<\/yz_jade\s*>/gi;
      closePattern.lastIndex = opening.end;
      var close = closePattern.exec(source);
      // A broken envelope must not swallow a later valid envelope. With no
      // closing tag, parsing to the end preserves the existing loose behavior.
      var end = close && (nextOpen < 0 || close.index < nextOpen) ? closePattern.lastIndex : (nextOpen >= 0 ? nextOpen : source.length);
      var blockText = source.slice(opening.index, end);
      var parsedBlock = parse(blockText) || parse(blockText.slice(opening.end));
      if (parsedBlock) out.push(parsedBlock);
    });
    return out;
  }

  var PROTOCOL = {
    parse: parse,
    extractSnapshots: extractSnapshots,
    stripBlocks: stripBlocks,
    stripStreamTail: stripStreamTail
  };
