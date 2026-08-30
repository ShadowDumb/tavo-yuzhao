/* Yu Zhao — 修仙传讯法器，协议驱动，八大功能：玉牌/讯息/玉册/论坛/坊市/芥子空间/舆图/管理，i18n 走 tavo.plugin.i18n */
(function () {
  'use strict';

  // 调试日志开关：localStorage.yz_debug=1 时在控制台输出关键路径错误，默认静默保证性能。
  var DEBUG = false;
  try { DEBUG = typeof window !== 'undefined' && !!window.localStorage && window.localStorage.getItem('yz_debug') === '1'; } catch (_) {}

  function dbg(message, error) {
    if (!DEBUG) return;
    try { console.debug('[Yu Zhao]', message, error == null ? '' : error); } catch (_) {}
  }

  var cleanText = function (value, limit) {
    var text = String(value == null ? '' : value).replace(/\u0000/g, '').trim();
    return text.slice(0, limit || 3000);
  };

  var escapeHtml = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  };

  var safeObject = function (value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  };

  var safeArray = function (value, limit) {
    return Array.isArray(value) ? value.slice(0, limit || 100) : [];
  };

  // 保尾截断：聊天类数据（消息/评论等按时间追加）超限时淘汰最旧、保留最新。
  var tail = function (value, limit) {
    if (!Array.isArray(value)) return [];
    return value.length > limit ? value.slice(value.length - limit) : value;
  };

  var dangerousKey = function (key) {
    return key === '__proto__' || key === 'prototype' || key === 'constructor';
  };

  function sanitize(value, depth) {
    depth = depth || 0;
    if (depth > 8) return null;
    if (typeof value === 'string') return cleanText(value, 3000);
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'boolean' || value == null) return value;
    if (Array.isArray(value)) return value.slice(0, 100).map(function (item) { return sanitize(item, depth + 1); });
    if (typeof value === 'object') {
      var out = Object.create(null);
      Object.keys(value).slice(0, 100).forEach(function (key) {
        key = cleanText(key, 80);
        if (!key || dangerousKey(key)) return;
        out[key] = sanitize(value[key], depth + 1);
      });
      return out;
    }
    return cleanText(value, 3000);
  }

  function stableHash(value) {
    var text = typeof value === 'string' ? value : JSON.stringify(value);
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function hasText(value) {
    return cleanText(value, 8).length > 0;
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  // 数值字段统一下限：Number(x)||0 只挡 NaN 不挡负数，未读/数量/共鸣等一律非负。
  function nzero(value) {
    return Math.max(0, Number(value) || 0);
  }

  var GROUPS = {
    basic: ['基本', '基础', 'basic'],
    look: ['仪容', '外貌', '外观', 'look', 'appearance'],
    cult: ['修为', '修炼', '修行', 'cultivation', 'cult'],
    gong: ['功法', '心法', '法诀', '绝学', '术法', 'gong', 'technique'],
    bond: ['羁绊', '缘分', '牵挂', 'bond', 'bonds', 'ties', 'connection'],
    secret: ['隐秘', '隐秘信息', '秘密', '隐私', 'secret', 'hidden']
  };

  var CANONICAL = {
    name: ['名字', '姓名', 'name'],
    gender: ['性别', 'gender', 'sex'],
    height: ['身高', 'height'],
    weight: ['体重', 'weight'],
    appearance: ['外貌', 'appearance'],
    clothing: ['穿着', '衣着', 'clothing', 'garments', 'attire'],
    root: ['灵根', 'spiritual root', 'root'],
    body: ['体质', 'constitution', 'physique', 'body'],
    realm: ['境界', '修为境界', 'realm', 'cultivation realm', 'cultivation level'],
    status: ['状态', '当前状态', 'status', 'state', 'condition'],
    technique: ['功法', '功法名', '主修功法', '所学功法', 'technique', 'skill', 'art'],
    bond: ['羁绊', '羁绊对象', '缘分', 'bond', 'tie']
  };

  function groupId(name) {
    var key = cleanText(name, 40).toLowerCase();
    var have = Object.keys(GROUPS);
    for (var i = 0; i < have.length; i += 1) {
      if (GROUPS[have[i]].indexOf(key) >= 0) return have[i];
    }
    return key === 'basic' ? 'basic' : null;
  }

  function keyId(name) {
    var key = cleanText(name, 60).toLowerCase();
    var have = Object.keys(CANONICAL);
    for (var i = 0; i < have.length; i += 1) {
      if (CANONICAL[have[i]].indexOf(key) >= 0) return have[i];
    }
    return null;
  }

  var GROUP_ORDER = ['basic', 'look', 'cult', 'gong', 'bond', 'secret'];

  function blankTablet() {
    return { name: '', groups: [] };
  }

  function blankState(chatId) {
    return {
      schemaVersion: 1,
      chatId: cleanText(chatId || 'unknown', 160),
      revision: 0,
      tablet: blankTablet(),
      chats: { contacts: [], groups: [] },
      notes: { folders: [], notes: [] },
      forum: { posts: [] },
      market: { listings: [], auctions: [], orders: [], requests: [] },
      space: { currencies: [], items: [] },
      map: { current: { place: '', domain: '', desc: '' }, tracks: [], places: [] },
      processedTurns: [],
      hydration: null,
      // 插件版本与持久化强制全量标记：更新/封印变化后下一轮按新提示词全量重写数据。
      pluginVersion: '',
      pendingFull: false,
      sync: { status: 'empty', turnId: '', roleName: '', summary: '', applied: [], appliedSeen: [], issues: [], updatedAt: 0 },
      updatedAt: 0
    };
  }

  // 玩家域与角色域之间的固定传讯通道：角色域中的玩家联系人（模型在此线程自然回复）
  // 与玩家域中的角色联系人（玩家自己的会话线程，镜像角色回复）。
  var PLAYER_CONTACT_ID = 'yz-player';
  var PLAYER_THREAD_ID = 'yz-character';
  // 每轮基线最多注入的未读传讯行数；超出部分只给一条摘要行（计入预算，可淘汰但
  // 优先级最高——仅极端超限时让位，见 buildCurrent 第四轮）。
  var MAX_PLAYER_UNREAD_ROWS = 5;
  // 玩家群聊发言（pmg-*）是真实事件：基线恒注入（最多这个条数，超出给归档摘要行）
  // 且 drop:false——模型 full 轮必须照抄，pmg 从不在 parse 后丢失，避免镜像补回时
  // 把历史发言追加成"最新消息"（顺序错乱）。玩家域源本身 tail(24)，此上限必达。
  var MAX_PLAYER_GROUP_ROWS = 12;

  // 条目级注入采样：联系人/群聊/帖子超过上限后，每轮只向基线注入采样子集——玩家
  // 交互过的条目必定注入（真实事件，消息行必须挂在可见条目下），其余按活跃度加权
  // 随机（score = 1 + min(消息数/评论数, 20)，p ∝ score^γ，钳制 p ≥ β/n 保底冷门与新增条目）。
  // 隐藏条目完全不出现：模型无记忆、只读上下文，不见即不知，不会去修改；diff 门禁
  // 兜底（隐藏条目不可引用）。渲染/存储/评估/世界书归档不受影响，只裁剪注入视图。
  var MAX_INJECT_CONTACTS = 3;
  var MAX_INJECT_GROUPS = 2;
  var MAX_INJECT_POSTS = 5;
  var SAMPLE_WEIGHT_GAMMA = 2;
  var SAMPLE_FLOOR_BETA = 0.5;

  // 加权随机补足：从池中取 count 个不重复条目（p ∝ score^γ，钳制下限 β/n 保证
  // 不活跃/新增条目非零概率）。rng 可注入（测试确定性），默认 Math.random。
  function samplePick(pool, count, rng) {
    var chosen = [];
    var used = {};
    while (chosen.length < count) {
      var rest = [];
      pool.forEach(function (e) { if (!used[e.id]) rest.push(e); });
      if (!rest.length) break;
      var sum = 0;
      rest.forEach(function (e) { sum += Math.pow(e.score, SAMPLE_WEIGHT_GAMMA); });
      var floor = SAMPLE_FLOOR_BETA / rest.length;
      var probs = rest.map(function (e) {
        return Math.max(Math.pow(e.score, SAMPLE_WEIGHT_GAMMA) / sum, floor);
      });
      var total = 0;
      probs.forEach(function (p) { total += p; });
      var r = rng() * total;
      var acc = 0;
      var pick = null;
      for (var i = 0; i < rest.length; i++) {
        acc += probs[i];
        if (r <= acc) { pick = rest[i]; break; }
      }
      if (!pick) pick = rest[rest.length - 1];
      used[pick.id] = true;
      chosen.push(pick.id);
    }
    return chosen;
  }

  // 采样一条目集合：强制集（forced，id→true 全选）+ 加权随机补齐到 cap。
  function sampleSet(items, cap, forced, rng) {
    var chosen = [];
    var seen = {};
    safeArray(items, 20).forEach(function (item) {
      if (item && item.id && forced[String(item.id)]) {
        chosen.push(String(item.id));
        seen[String(item.id)] = true;
      }
    });
    var pool = safeArray(items, 20).filter(function (item) {
      return item && item.id && !seen[String(item.id)];
    }).map(function (item) {
      var count = Array.isArray(item.messages) ? item.messages.length : (Array.isArray(item.comments) ? item.comments.length : 0);
      return { id: String(item.id), score: 1 + Math.min(count, 20) };
    });
    var need = Math.max(0, cap - chosen.length);
    if (need > 0 && pool.length) samplePick(pool, need, rng).forEach(function (id) { chosen.push(id); });
    return chosen;
  }

  // 采样视图：返回 { contacts: [id], groups: [id], posts: [id] }。
  // 未超上限时全量（与历史行为一致）；超上限后强制集 + 加权随机。
  function sampleEntries(chats, forum, rng) {
    rng = rng || Math.random;
    var chatObj = safeObject(chats);
    var contacts = safeArray(chatObj.contacts, 20);
    var groups = safeArray(chatObj.groups, 6);
    var posts = safeArray(safeObject(forum).posts, 20);
    var out = { contacts: [], groups: [], posts: [] };
    if (contacts.length <= MAX_INJECT_CONTACTS) {
      contacts.forEach(function (c) { if (c && c.id) out.contacts.push(String(c.id)); });
    } else {
      var forcedC = {};
      contacts.forEach(function (c) {
        if (c && c.id && (String(c.id) === PLAYER_CONTACT_ID || (Number(c.unread) || 0) > 0)) forcedC[String(c.id)] = true;
      });
      out.contacts = sampleSet(contacts, MAX_INJECT_CONTACTS, forcedC, rng);
    }
    if (groups.length <= MAX_INJECT_GROUPS) {
      groups.forEach(function (g) { if (g && g.id) out.groups.push(String(g.id)); });
    } else {
      var forcedG = {};
      groups.forEach(function (g) {
        if (!g || !g.id) return;
        var hasPlayer = safeArray(g.messages, 24).some(function (m) { return m && /^pmg-/.test(String(m.id) || ''); });
        // 有未读消息（有新回复）或含玩家发言的群组必定注入——与联系人/帖子对称。
        if (hasPlayer || (Number(g.unread) || 0) > 0) forcedG[String(g.id)] = true;
      });
      out.groups = sampleSet(groups, MAX_INJECT_GROUPS, forcedG, rng);
    }
    if (posts.length <= MAX_INJECT_POSTS) {
      posts.forEach(function (p) { if (p && p.id) out.posts.push(String(p.id)); });
    } else {
      var forcedP = {};
      posts.forEach(function (p) {
        if (!p || !p.id) return;
        var playerPost = String(p.owner || '') === 'player';
        var playerComment = safeArray(p.comments, 20).some(function (c) { return c && /^pmc-/.test(String(c.id) || ''); });
        // 有新回复（未读）的帖子与玩家交互帖同属强制包含集（真实事件必须可见）。
        if (playerPost || playerComment || (Number(p.unread) || 0) > 0) forcedP[String(p.id)] = true;
      });
      out.posts = sampleSet(posts, MAX_INJECT_POSTS, forcedP, rng);
    }
    return out;
  }

  // 玩家域实体 id 生成：按集合内现有编号取下一个（pn-<n> / pf-<n> / pi-<n> / po-<n> / fp-<n>），
  // 确定性、重载不冲突——与传讯 pm-<seq> 同模式，玩家直写不经模型。
  function playerNextId(items, prefix) {
    var max = 0;
    safeArray(items, 100).forEach(function (item) {
      var match = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$').exec(String(item && item.id) || '');
      if (match) max = Math.max(max, Number(match[1]) || 0);
    });
    return prefix + (max + 1);
  }

  // 玩家域实体查找（纯函数，视图预填表单与运行时 CRUD 共用）：
  // folder/note → notes，item/currency → space（currency 以种类为键），order → market，
  // post → forum（玩家帖子）。
  function playerFindEntity(pstate, kind, id) {
    id = String(id == null ? '' : id);
    if (kind === 'folder') return safeArray(pstate && pstate.notes && pstate.notes.folders, 10).filter(function (f) { return String(f.id) === id; })[0] || null;
    if (kind === 'note') return safeArray(pstate && pstate.notes && pstate.notes.notes, 30).filter(function (n) { return String(n.id) === id; })[0] || null;
    if (kind === 'item') return safeArray(pstate && pstate.space && pstate.space.items, 30).filter(function (i) { return String(i.id) === id; })[0] || null;
    if (kind === 'currency') return safeArray(pstate && pstate.space && pstate.space.currencies, 10).filter(function (c) { return String(c.kind) === id; })[0] || null;
    if (kind === 'order') return safeArray(pstate && pstate.market && pstate.market.orders, 12).filter(function (o) { return String(o.id) === id; })[0] || null;
    if (kind === 'post') return safeArray(pstate && pstate.forum && pstate.forum.posts, 20).filter(function (p) { return String(p.id) === id; })[0] || null;
    return null;
  }

  // 玩家域状态：与角色域同构的私有数据容器，但完全不参与模型评估。
  // 没有 revision/processedTurns/指纹/hydration——数据由玩家或本机写入，不经模型。
  // forum 分区仅存玩家帖子（owner=player，镜像进角色域论坛成为公开数据）。
  function blankPlayerState(chatId) {
    return {
      schemaVersion: 1,
      chatId: cleanText(chatId || 'unknown', 160),
      updatedAt: 0,
      tablet: blankTablet(),
      chats: { contacts: [], groups: [] },
      notes: { folders: [], notes: [] },
      forum: { posts: [] },
      market: { listings: [], auctions: [], orders: [], requests: [] },
      space: { currencies: [], items: [] },
      map: { current: { place: '', domain: '', desc: '' }, tracks: [], places: [] },
      // 玩家在公开数据上的发言源（群聊消息在 chats.groups、论坛评论在此）：
      // 经跨域镜像进角色域后由模型自然回复；模型不得改写（id 前缀门禁）。
      myComments: [],
      pluginVersion: ''
    };
  }

  function normalizeSide(value) {
    return /^(self|me|自己|我)$/i.test(String(value || '')) ? 'self' : 'other';
  }

  function normalizeChats(raw) {
    raw = safeObject(raw);
    var contacts = safeArray(raw.contacts, 10).map(function (contact) {
      contact = safeObject(contact);
      return {
        id: cleanText(contact.id, 160),
        name: cleanText(contact.name, 120),
        relation: cleanText(contact.relation, 120),
        time: cleanText(contact.time, 80),
        unread: nzero(contact.unread),
        preview: cleanText(contact.preview, 300),
        messages: tail(contact.messages, 20).map(function (message) {
          message = safeObject(message);
          return {
            id: cleanText(message.id, 160),
            side: normalizeSide(message.side),
            time: cleanText(message.time, 80),
            text: cleanText(message.text, 3000)
          };
        }).filter(function (message) { return message.id && hasText(message.text); })
      };
    }).filter(function (contact) { return contact.id && hasText(contact.name); });
    var groups = safeArray(raw.groups, 6).map(function (group) {
      group = safeObject(group);
      return {
        id: cleanText(group.id, 160),
        name: cleanText(group.name, 120),
        members: nzero(group.members),
        time: cleanText(group.time, 80),
        unread: nzero(group.unread),
        preview: cleanText(group.preview, 300),
        messages: tail(group.messages, 24).map(function (message) {
          message = safeObject(message);
          return {
            id: cleanText(message.id, 160),
            sender: cleanText(message.sender, 120),
            side: normalizeSide(message.side),
            time: cleanText(message.time, 80),
            text: cleanText(message.text, 3000)
          };
        }).filter(function (message) { return message.id && hasText(message.text); })
      };
    }).filter(function (group) { return group.id && hasText(group.name); });
    return { contacts: contacts, groups: groups };
  }

  function normalizeNotes(raw) {
    raw = safeObject(raw);
    var folders = safeArray(raw.folders, 10).map(function (folder) {
      folder = safeObject(folder);
      return { id: cleanText(folder.id, 160), name: cleanText(folder.name, 120), count: Number(folder.count) || 0 };
    }).filter(function (folder) { return folder.id && hasText(folder.name); });
    var notes = safeArray(raw.notes, 30).map(function (note) {
      note = safeObject(note);
      return {
        id: cleanText(note.id, 160),
        folderId: cleanText(note.folderId, 160),
        updated: cleanText(note.updated, 80),
        locked: !!note.locked,
        title: cleanText(note.title, 200),
        body: cleanText(note.body, 3000)
      };
    }).filter(function (note) {
      return note.id && note.folderId && hasText(note.title) && folders.some(function (folder) { return String(folder.id) === String(note.folderId); });
    });
    // 文件夹计数按实际笔记数派生：模型声明的 count 只是提示，统计以客户端数据为准
    // （diff 轮增删笔记不会同步改 folder 行的 count，信任声明值会得到错误统计）。
    var counts = Object.create(null);
    notes.forEach(function (note) { counts[note.folderId] = (counts[note.folderId] || 0) + 1; });
    folders.forEach(function (folder) { folder.count = counts[folder.id] || 0; });
    return { folders: folders, notes: notes };
  }

  function normalizeForum(raw) {
    raw = safeObject(raw);
    var posts = safeArray(raw.posts, 20).map(function (post) {
      post = safeObject(post);
      return {
        id: cleanText(post.id, 160),
        // owner 维度：player = 玩家（{{user}}）真实发帖；空 = 角色/模型数据。
        owner: cleanText(post.owner, 20),
        // unread = 新回复数（模型维护：有新评论时递增，处理回复后清零；nzero 钳制）。
        // 玩家帖 unread 由客户端维护（syncPlayerPosts 按评论增量计算，打开详情清零）：
        // 模型被 diff 门禁禁止触碰玩家行，此处不再钳 0，否则客户端维护的值每次归一化被抹掉。
        unread: nzero(post.unread),
        // 客户端已见评论数（玩家帖未读游标）：syncPlayerPosts 用它算新回复，打开详情更新。
        seen: nzero(post.seen),
        author: cleanText(post.author, 120),
        role: cleanText(post.role, 120),
        section: cleanText(post.section, 60),
        time: cleanText(post.time, 80),
        title: cleanText(post.title, 200),
        body: cleanText(post.body, 3000),
        resonance: nzero(post.resonance),
        comments: safeArray(post.comments, 20).map(function (comment) {
          comment = safeObject(comment);
          // owner=player 的评论（pmc-* id）是玩家真实发言，经跨域通道镜像维护。
          return { id: cleanText(comment.id, 160), owner: cleanText(comment.owner, 20), author: cleanText(comment.author, 120), time: cleanText(comment.time, 80), text: cleanText(comment.text, 3000) };
        }).filter(function (comment) { return comment.id && hasText(comment.text); })
      };
    }).filter(function (post) { return post.id && hasText(post.title); });
    return { posts: posts };
  }

  function normalizeMarket(raw) {
    raw = safeObject(raw);
    var listings = safeArray(raw.listings, 20).map(function (listing) {
      listing = safeObject(listing);
      return { id: cleanText(listing.id, 160), name: cleanText(listing.name, 120), grade: cleanText(listing.grade, 60), desc: cleanText(listing.desc, 3000), price: cleanText(listing.price, 80), seller: cleanText(listing.seller, 120) };
    }).filter(function (listing) { return listing.id && hasText(listing.name); });
    var auctions = safeArray(raw.auctions, 12).map(function (auction) {
      auction = safeObject(auction);
      return { id: cleanText(auction.id, 160), name: cleanText(auction.name, 120), grade: cleanText(auction.grade, 60), desc: cleanText(auction.desc, 3000), start: cleanText(auction.start, 80), current: cleanText(auction.current, 80), timeLeft: cleanText(auction.timeLeft, 80), bids: nzero(auction.bids) };
    }).filter(function (auction) { return auction.id && hasText(auction.name); });
    var orders = safeArray(raw.orders, 12).map(function (order) {
      order = safeObject(order);
      return { id: cleanText(order.id, 160), name: cleanText(order.name, 120), status: cleanText(order.status, 40), price: cleanText(order.price, 80), time: cleanText(order.time, 80), side: cleanText(order.side, 20) };
    }).filter(function (order) { return order.id && hasText(order.name); });
    // 求购区：坊市的买公告（与行情配对），公开数据——行 id 由模型声明。
    var requests = safeArray(raw.requests, 12).map(function (request) {
      request = safeObject(request);
      return { id: cleanText(request.id, 160), name: cleanText(request.name, 120), grade: cleanText(request.grade, 60), desc: cleanText(request.desc, 3000), price: cleanText(request.price, 80), author: cleanText(request.author, 120) };
    }).filter(function (request) { return request.id && hasText(request.name); });
    return { listings: listings, auctions: auctions, orders: orders, requests: requests };
  }

  function normalizeSpace(raw) {
    raw = safeObject(raw);
    var currencies = safeArray(raw.currencies, 10).map(function (currency) {
      currency = safeObject(currency);
      return { kind: cleanText(currency.kind, 60), amount: cleanText(currency.amount, 80) };
    }).filter(function (currency) { return hasText(currency.kind); });
    var items = safeArray(raw.items, 30).map(function (item) {
      item = safeObject(item);
      return { id: cleanText(item.id, 160), name: cleanText(item.name, 120), qty: nzero(item.qty), qtyText: cleanText(item.qtyText, 40), grade: cleanText(item.grade, 60), desc: cleanText(item.desc, 3000) };
    }).filter(function (item) { return item.id && hasText(item.name); });
    return { currencies: currencies, items: items };
  }

  function normalizeMap(raw) {
    raw = safeObject(raw);
    var current = safeObject(raw.current);
    var cur = { place: cleanText(current.place, 120), domain: cleanText(current.domain, 120), desc: cleanText(current.desc, 3000) };
    var tracks = safeArray(raw.tracks, 20).map(function (track) {
      track = safeObject(track);
      return { id: cleanText(track.id, 160), time: cleanText(track.time, 80), place: cleanText(track.place, 120), action: cleanText(track.action, 300) };
    }).filter(function (track) { return track.id && hasText(track.place); });
    // 地点名录：角色已知世界的目录（配合世界书关键词召回），id 用于 diff 定位。
    var places = safeArray(raw.places, 20).map(function (place) {
      place = safeObject(place);
      return { id: cleanText(place.id, 160), name: cleanText(place.name, 120), domain: cleanText(place.domain, 120), desc: cleanText(place.desc, 3000) };
    }).filter(function (place) { return place.id && hasText(place.name); });
    return { current: cur, tracks: tracks, places: places };
  }

  function normalizeTablet(raw) {
    raw = safeObject(raw);
    var tablet = blankTablet();
    tablet.name = cleanText(raw.name, 120);
    safeArray(raw.groups, 10).forEach(function (group) {
      var id = groupId(group && group.id || group && group.name);
      if (!id) return;
      var fields = safeArray(group && group.fields, 30).map(function (field) {
        return { key: cleanText(field && (field.key || field.name), 60), value: cleanText(field && field.value, 3000) };
      }).filter(function (field) { return field.key; });
      if (!fields.length) return;
      if (!tablet.groups.some(function (g) { return g.id === id; })) tablet.groups.push({ id: id, fields: fields });
    });
    tablet.groups = GROUP_ORDER.filter(function (id) {
      return tablet.groups.some(function (g) { return g.id === id; });
    }).map(function (id) {
      return tablet.groups.filter(function (g) { return g.id === id; })[0];
    });
    return tablet;
  }

  function normalizeState(raw, chatId) {
    var base = blankState(chatId || (raw && raw.chatId));
    // 存储路径与快照路径同源消毒：过滤危险键（__proto__ 等）并限额，防持久化数据注入。
    raw = sanitize(safeObject(raw));
    base.revision = Number(raw.revision) || 0;
    base.tablet = normalizeTablet(raw.tablet);
    base.chats = normalizeChats(raw.chats);
    base.notes = normalizeNotes(raw.notes);
    base.forum = normalizeForum(raw.forum);
    base.market = normalizeMarket(raw.market);
    base.space = normalizeSpace(raw.space);
    base.map = normalizeMap(raw.map);
    base.processedTurns = safeArray(raw.processedTurns, 80).map(function (x) { return cleanText(x, 160); }).filter(Boolean);
    base.pluginVersion = cleanText(raw.pluginVersion, 40);
    base.pendingFull = !!raw.pendingFull;
    var hydration = safeObject(raw.hydration);
    if (hydration.sig) base.hydration = { sig: cleanText(hydration.sig, 200) };
    var sync = safeObject(raw.sync);
    base.sync = Object.assign(base.sync, sync);
    base.sync.applied = safeArray(sync.applied, 10).map(function (x) { return cleanText(x, 40); }).filter(Boolean);
    // appliedSeen 记录用户已在卦位查看过的「新同步」功能；旧档缺省自动补空数组，无迁移代码。
    base.sync.appliedSeen = safeArray(sync.appliedSeen, 20).map(function (x) { return cleanText(x, 40); }).filter(Boolean);
    base.sync.issues = safeArray(sync.issues, 20).map(function (issue) {
      issue = safeObject(issue);
      return { path: cleanText(issue.path, 80), code: cleanText(issue.code, 80) };
    }).filter(function (issue) { return issue.path && issue.code; });
    base.updatedAt = Number(raw.updatedAt) || 0;
    return base;
  }

  // 玩家域归一：复用各分区归一器，但剥离一切模型域字段（sync/revision/processedTurns/
  // hydration/pendingFull）——玩家域不经模型评估，持久化只需本机可读的数据。
  function normalizePlayerState(raw, chatId) {
    var base = blankPlayerState(chatId || (raw && raw.chatId));
    raw = sanitize(safeObject(raw));
    base.tablet = normalizeTablet(raw.tablet);
    base.chats = normalizeChats(raw.chats);
    base.notes = normalizeNotes(raw.notes);
    // 玩家域论坛只承载玩家自己的帖子（owner=player）：镜像外的帖子不入玩家域存储。
    var playerForum = normalizeForum(raw.forum);
    playerForum.posts = playerForum.posts.filter(function (post) { return String(post.owner) === 'player'; });
    base.forum = playerForum;
    base.market = normalizeMarket(raw.market);
    base.space = normalizeSpace(raw.space);
    base.map = normalizeMap(raw.map);
    // 玩家论坛评论源：白名单式归一（顶层字段，不经分区归一化器）。
    base.myComments = safeArray(raw.myComments, 40).map(function (c) {
      c = safeObject(c);
      return {
        postId: cleanText(c.postId, 160),
        id: cleanText(c.id, 160),
        time: cleanText(c.time, 80),
        text: cleanText(c.text, 3000)
      };
    }).filter(function (c) { return c.postId && c.id && hasText(c.text); });
    base.updatedAt = Number(raw.updatedAt) || 0;
    base.pluginVersion = cleanText(raw.pluginVersion, 40);
    return base;
  }

  // 功能 id 与 state 字段的对应关系：msg 功能的数据存放在 state.chats。
  var FEATURE_FIELDS = { tablet: 'tablet', msg: 'chats', notes: 'notes', forum: 'forum', market: 'market', space: 'space', map: 'map' };

  function blankFeatureField(id) {
    if (id === 'tablet') return blankTablet();
    if (id === 'msg') return { contacts: [], groups: [] };
    if (id === 'notes') return { folders: [], notes: [] };
    if (id === 'forum') return { posts: [] };
    if (id === 'market') return { listings: [], auctions: [], orders: [], requests: [] };
    if (id === 'space') return { currencies: [], items: [] };
    if (id === 'map') return { current: { place: '', domain: '', desc: '' }, tracks: [], places: [] };
    return null;
  }

  function fieldKeys(group) {
    return safeArray(group && group.fields, 30).map(function (field) { return keyId(field && field.key); }).filter(Boolean);
  }

  function hasAll(group, needed) {
    var have = fieldKeys(group);
    return needed.every(function (key) { return have.indexOf(key) >= 0; });
  }

  function assessTablet(tablet) {
    tablet = safeObject(tablet);
    var groups = {};
    safeArray(tablet.groups, 10).forEach(function (g) { groups[g.id] = g; });
    var valid = {};
    valid.basic = !!(groups.basic && hasAll(groups.basic, ['name', 'gender', 'height', 'weight']));
    valid.look = !!(groups.look && hasAll(groups.look, ['appearance', 'clothing']));
    valid.cult = !!(groups.cult && hasAll(groups.cult, ['root', 'body', 'realm', 'status']));
    // 功法/羁绊与隐秘同为内容组：至少一条即可（写什么由引导行与约束文本约定）。
    valid.gong = !!(groups.gong && safeArray(groups.gong.fields, 30).length >= 1);
    valid.bond = !!(groups.bond && safeArray(groups.bond.fields, 30).length >= 1);
    valid.secret = !!(groups.secret && safeArray(groups.secret.fields, 30).length >= 1);
    return {
      ok: GROUP_ORDER.every(function (id) { return valid[id]; }),
      groups: valid
    };
  }

  function assessMsg(chats) {
    chats = safeObject(chats);
    // 玩家传讯联系人（yz-player）是跨域通道写入的真实事件，不是剧情数据：
    // 不参与联系人数与每条消息数底线，避免玩家发讯反而拉低角色域达标度。
    // 群聊里的玩家发言（pmg-*）同理不参与群聊消息数底线（玩家发言不凑达标）。
    var contacts = safeArray(chats.contacts, 10).filter(function (c) { return String(c && c.id) !== PLAYER_CONTACT_ID; });
    var groups = safeArray(chats.groups, 6);
    var valid = {};
    valid.contacts = contacts.length >= 2 && contacts.every(function (c) { return safeArray(c.messages, 20).length >= 2; });
    valid.groups = groups.length >= 1 && groups.every(function (g) {
      return safeArray(g.messages, 24).filter(function (m) { return !/^pmg-/.test(String(m && m.id) || ''); }).length >= 2;
    });
    return { ok: valid.contacts && valid.groups, contacts: valid.contacts, groups: valid.groups };
  }

  function assessNotes(notes) {
    notes = safeObject(notes);
    var valid = {};
    valid.folders = safeArray(notes.folders, 10).length >= 2;
    valid.notes = safeArray(notes.notes, 30).length >= 3;
    return { ok: valid.folders && valid.notes, folders: valid.folders, notes: valid.notes };
  }

  function assessForum(forum) {
    forum = safeObject(forum);
    // 玩家帖子（owner=player）是玩家的真实发帖，不是角色剧情数据：
    // 不参与帖子数与评论数底线，避免玩家发帖反而拉低/顶替角色域论坛达标度。
    // 玩家评论（pmc-*）同理不参与评论数底线（玩家发言不凑达标）。
    var posts = safeArray(forum.posts, 20).filter(function (post) { return (post && post.owner) !== 'player'; });
    return {
      ok: posts.length >= 2 && posts.every(function (post) {
        return safeArray(post.comments, 20).filter(function (c) { return !/^pmc-/.test(String(c && c.id) || ''); }).length >= 1;
      }),
      posts: posts.length >= 2
    };
  }

  function assessMarket(market) {
    market = safeObject(market);
    var valid = {};
    valid.listings = safeArray(market.listings, 20).length >= 1;
    valid.auctions = safeArray(market.auctions, 12).length >= 1;
    valid.orders = safeArray(market.orders, 12).length >= 1;
    valid.requests = safeArray(market.requests, 12).length >= 1;
    return { ok: valid.listings && valid.auctions && valid.orders && valid.requests, listings: valid.listings, auctions: valid.auctions, orders: valid.orders, requests: valid.requests };
  }

  function assessSpace(space) {
    space = safeObject(space);
    var valid = {};
    valid.currencies = safeArray(space.currencies, 10).length >= 1;
    valid.items = safeArray(space.items, 30).length >= 1;
    return { ok: valid.currencies && valid.items, currencies: valid.currencies, items: valid.items };
  }

  function assessMap(map) {
    map = safeObject(map);
    var valid = {};
    valid.current = !!(map.current && hasText(map.current.place));
    valid.tracks = safeArray(map.tracks, 20).length >= 2;
    valid.places = safeArray(map.places, 20).length >= 2;
    return { ok: valid.current && valid.tracks && valid.places, current: valid.current, tracks: valid.tracks, places: valid.places };
  }

  var ASSESS_ORDER = ['tablet', 'msg', 'notes', 'forum', 'market', 'space', 'map'];
  var ASSESSORS = { tablet: assessTablet, msg: assessMsg, notes: assessNotes, forum: assessForum, market: assessMarket, space: assessSpace, map: assessMap };
  var NORMALIZERS = { tablet: normalizeTablet, msg: normalizeChats, notes: normalizeNotes, forum: normalizeForum, market: normalizeMarket, space: normalizeSpace, map: normalizeMap };

  // ---------- diff 应用器：把 +/- 操作行合并进当前分区数据 ----------
  // upsert 语义：id 已存在则整行替换（消息等子行保留），不存在则受各分区上限约束追加。
  // 删除行按定位字段（id / 组+键 / 种类 / 评论整行）匹配。所有应用器最终重新归一化。

  function indexOfById(list, id) {
    for (var i = 0; i < list.length; i += 1) {
      if (list[i] && list[i].id === id) return i;
    }
    return -1;
  }

  function flagOf(value) {
    return /^(true|1|yes|是|锁定)$/i.test(String(value || '').trim());
  }

  function diffTablet(raw, ops) {
    var out = normalizeTablet(raw);
    function matchField(field, key) {
      var kid = keyId(key);
      if (kid && keyId(field.key) === kid) return true;
      return field.key === key;
    }
    ops.forEach(function (op) {
      if (op.type !== 'field') return;
      var gid = groupId(op.values[0]);
      var key = cleanText(op.values[1], 60);
      if (!key) return;
      var group = null;
      out.groups.forEach(function (g) { if (g.id === gid) group = g; });
      if (op.add) {
        if (!gid) return;
        if (!group) { group = { id: gid, fields: [] }; out.groups.push(group); }
        var value = cleanText(op.values[2], 3000);
        var field = null;
        group.fields.forEach(function (f) { if (matchField(f, key)) field = f; });
        if (field) field.value = value;
        else if (group.fields.length < 30) group.fields.push({ key: key, value: value });
      } else if (group) {
        group.fields = group.fields.filter(function (f) { return !matchField(f, key); });
        if (!group.fields.length) out.groups = out.groups.filter(function (g) { return g.id !== gid; });
      }
    });
    out = normalizeTablet(out);
    // 名字始终从基本组名字字段重推导，避免 upsert 名字后 tablet.name 陈旧。
    out.name = '';
    out.groups.forEach(function (g) {
      if (g.id !== 'basic' || out.name) return;
      g.fields.forEach(function (f) {
        if (!out.name && keyId(f.key) === 'name' && hasText(f.value)) out.name = cleanText(f.value, 120);
      });
    });
    return out;
  }

  function diffChats(raw, ops) {
    var out = normalizeChats(raw);
    ops.forEach(function (op) {
      var id = cleanText(op.values[0], 160);
      if (!id) return;
      if (op.type === 'contact') {
        // 玩家传讯联系人（yz-player）由跨域通道镜像维护，模型不得增删改（只读防护，
        // 与 diffForum 对玩家帖子的门禁同语义；提示词亦明令禁止）。
        if (String(id) === PLAYER_CONTACT_ID) return;
        var at = indexOfById(out.contacts, id);
        if (op.add) {
          var name = cleanText(op.values[1], 120);
          if (!hasText(name)) return;
          var contact = { id: id, name: name, relation: cleanText(op.values[2], 120), time: cleanText(op.values[3], 80), unread: nzero(op.values[4]), preview: cleanText(op.values[5], 300), messages: [] };
          if (at >= 0) contact.messages = out.contacts[at].messages;
          if (at >= 0) out.contacts[at] = contact;
          else if (out.contacts.length < 10) out.contacts.push(contact);
        } else if (at >= 0) out.contacts.splice(at, 1);
        return;
      }
      if (op.type === 'group') {
        var gi = indexOfById(out.groups, id);
        if (op.add) {
          var gname = cleanText(op.values[1], 120);
          if (!hasText(gname)) return;
          var group = { id: id, name: gname, members: nzero(op.values[2]), time: cleanText(op.values[3], 80), unread: nzero(op.values[4]), preview: cleanText(op.values[5], 300), messages: [] };
          if (gi >= 0) group.messages = out.groups[gi].messages;
          if (gi >= 0) out.groups[gi] = group;
          else if (out.groups.length < 6) out.groups.push(group);
        } else if (gi >= 0) out.groups.splice(gi, 1);
        return;
      }
      if (op.type === 'msg' || op.type === 'gmsg') {
        var isGroup = op.type === 'gmsg';
        var owner = null;
        out.contacts.forEach(function (c) { if (c.id === id) owner = c; });
        if (isGroup) { owner = null; out.groups.forEach(function (g) { if (g.id === id) owner = g; }); }
        if (!owner) return;
        if (String(id) === PLAYER_CONTACT_ID) {
          // yz-player 线程只读防护：模型只能追加自己的回复（+msg self 新 id）；
          // 禁止删消息、伪造玩家侧消息（side=other）、改写既有玩家消息（pm-*），
          // 也禁止用新的 pm-N 编号伪造玩家消息（pm-N 只由跨域通道按序生成）。
          if (!op.add || isGroup) return;
          if (normalizeSide(op.values[2]) !== 'self') return;
        }
        var mid = cleanText(op.values[1], 160);
        if (!mid) return;
        var mi = indexOfById(owner.messages, mid);
        if (/^pmg-/.test(mid)) {
          // 群聊玩家消息（pmg-*）是跨域通道镜像维护的真实发言：任何增删改一律拒绝
          //（覆盖、删除、伪造新 pmg-* 行都不允许），回复用普通新 id 以自己身份发言。
          return;
        }
        if (/^pm-\d+$/.test(mid)) {
          // 玩家传讯消息（pm-N）同样只由跨域通道按序生成：模型不得伪造新的 pm-N 行
          //（含 side=self 自回复——会被未读统计/镜像误当成玩家消息），回复用普通新 id。
          return;
        }
        if (op.add) {
          // 玩家侧消息（pm-*，side=other）不可被模型改写覆盖；角色只允许新增/改自己的回复。
          if (String(id) === PLAYER_CONTACT_ID && mi >= 0 && owner.messages[mi].side === 'other') return;
          var text = cleanText(isGroup ? op.values[5] : op.values[4], 3000);
          if (!hasText(text)) return;
          var message = isGroup
            ? { id: mid, sender: cleanText(op.values[2], 120), side: normalizeSide(op.values[3]), time: cleanText(op.values[4], 80), text: text }
            : { id: mid, side: normalizeSide(op.values[2]), time: cleanText(op.values[3], 80), text: text };
          // 满员时也要收下新消息：先追加，末尾的 normalizeChats 保尾截断淘汰最旧。
          if (mi >= 0) owner.messages[mi] = message;
          else owner.messages.push(message);
        } else if (mi >= 0) owner.messages.splice(mi, 1);
      }
    });
    return normalizeChats(out);
  }

  function diffForum(raw, ops) {
    var out = normalizeForum(raw);
    ops.forEach(function (op) {
      var id = cleanText(op.values[0], 160);
      if (!id) return;
      if (op.type === 'post') {
        var pi = indexOfById(out.posts, id);
        // 玩家帖子是玩家的真实发帖：模型 +post/-post 一律不得触碰已存在的玩家行
        //（提示词亦明令禁止；门禁只保护已存在行，用新 id 伪造 owner=player 的行
        // 由对账与撞车防护兜底，见 syncPlayerPosts）。
        if (pi >= 0 && out.posts[pi].owner === 'player') return;
        if (op.add) {
          var title = cleanText(op.values[5], 200);
          if (!hasText(title)) return;
          // 兼容旧 diff 格式（第 9 个操作字段是 owner）与新格式（第 9 个操作字段 unread、
          // 第 10 个 owner）。（注意 op.values 已去掉行类型前缀：id 在 [0]，unread 候选在 [8]。）
          var u9 = String(op.values[8] || '').trim();
          var numU = /^\d+$/.test(u9);
          var post = {
            id: id,
            owner: numU ? cleanText(op.values[9], 20) : cleanText(op.values[8], 20),
            unread: numU ? (Number(u9) || 0) : 0,
            author: cleanText(op.values[1], 120), role: cleanText(op.values[2], 120),
            section: cleanText(op.values[3], 60), time: cleanText(op.values[4], 80),
            title: title, body: cleanText(op.values[6], 3000), resonance: nzero(op.values[7]), comments: []
          };
          if (pi >= 0) {
            post.comments = out.posts[pi].comments;
            // 模型更新帖子内容未显式带 unread 时保留原值（避免改标题把未读清零）。
            if (!numU) post.unread = out.posts[pi].unread;
          }
          if (pi >= 0) out.posts[pi] = post;
          else if (out.posts.length < 20) out.posts.push(post);
        } else if (pi >= 0) out.posts.splice(pi, 1);
        return;
      }
      if (op.type === 'comment') {
        var owner = null;
        out.posts.forEach(function (p) { if (p.id === id) owner = p; });
        if (!owner) return;
        var author = cleanText(op.values[1], 120);
        var time = cleanText(op.values[2], 80);
        var text = cleanText(op.values[3], 3000);
        if (!hasText(text)) return;
        // 评论无稳定 id：按整行（作者+时间+内容）精确匹配。
        var ci = -1;
        for (var i = 0; i < owner.comments.length; i += 1) {
          var c = owner.comments[i];
          if (c.author === author && c.time === time && c.text === text) { ci = i; break; }
        }
        if (op.add) {
          // 玩家评论（pmc-*）是跨域通道镜像维护的真实发言：不得被模型改写覆盖或删除。
          if (ci >= 0 && /^pmc-/.test(String(owner.comments[ci].id) || '')) return;
          // 评论 id 取现存最大值 +1，避免删除后 cm-<len+1> 撞已有 id。
          var cmMax = 0;
          owner.comments.forEach(function (c) {
            var cm = /^cm-(\d+)$/.exec(String(c && c.id) || '');
            if (cm) cmMax = Math.max(cmMax, Number(cm[1]) || 0);
          });
          if (ci < 0 && owner.comments.length < 20) owner.comments.push({ id: 'cm-' + (cmMax + 1), author: author, time: time, text: text });
        } else if (ci >= 0) {
          if (/^pmc-/.test(String(owner.comments[ci].id) || '')) return;
          owner.comments.splice(ci, 1);
        }
      }
    });
    return normalizeForum(out);
  }

  function diffNotes(raw, ops) {
    var out = normalizeNotes(raw);
    ops.forEach(function (op) {
      var id = cleanText(op.values[0], 160);
      if (!id) return;
      if (op.type === 'folder') {
        var fi = indexOfById(out.folders, id);
        if (op.add) {
          var name = cleanText(op.values[1], 120);
          if (!hasText(name)) return;
          var folder = { id: id, name: name, count: Number(op.values[2]) || 0 };
          if (fi >= 0) out.folders[fi] = folder;
          else if (out.folders.length < 10) out.folders.push(folder);
        } else if (fi >= 0) out.folders.splice(fi, 1);
        return;
      }
      if (op.type === 'note') {
        var ni = indexOfById(out.notes, id);
        if (op.add) {
          var title = cleanText(op.values[4], 200);
          var body = cleanText(op.values[5], 3000);
          if (!hasText(title) && !hasText(body)) return;
          var note = { id: id, folderId: cleanText(op.values[1], 160), updated: cleanText(op.values[2], 80), locked: flagOf(op.values[3]), title: title, body: body };
          if (ni >= 0) out.notes[ni] = note;
          else if (out.notes.length < 30) out.notes.push(note);
        } else if (ni >= 0) out.notes.splice(ni, 1);
      }
    });
    return normalizeNotes(out);
  }

  function diffMarket(raw, ops) {
    var out = normalizeMarket(raw);
    ops.forEach(function (op) {
      var id = cleanText(op.values[0], 160);
      if (!id) return;
      var list = null;
      var item = null;
      if (op.type === 'listing') {
        list = out.listings;
        var lname = cleanText(op.values[1], 120);
        if (op.add && hasText(lname)) item = { id: id, name: lname, grade: cleanText(op.values[2], 60), desc: cleanText(op.values[3], 3000), price: cleanText(op.values[4], 80), seller: cleanText(op.values[5], 120) };
      } else if (op.type === 'auction') {
        list = out.auctions;
        var aname = cleanText(op.values[1], 120);
        if (op.add && hasText(aname)) item = { id: id, name: aname, grade: cleanText(op.values[2], 60), desc: cleanText(op.values[3], 3000), start: cleanText(op.values[4], 80), current: cleanText(op.values[5], 80), timeLeft: cleanText(op.values[6], 80), bids: nzero(op.values[7]) };
      } else if (op.type === 'order') {
        list = out.orders;
        var oname = cleanText(op.values[1], 120);
        if (op.add && hasText(oname)) item = { id: id, name: oname, status: cleanText(op.values[2], 40), price: cleanText(op.values[3], 80), time: cleanText(op.values[4], 80), side: cleanText(op.values[5], 20) };
      } else if (op.type === 'request') {
        list = out.requests;
        var rname = cleanText(op.values[1], 120);
        if (op.add && hasText(rname)) item = { id: id, name: rname, grade: cleanText(op.values[2], 60), desc: cleanText(op.values[3], 3000), price: cleanText(op.values[4], 80), author: cleanText(op.values[5], 120) };
      }
      if (!list) return;
      var at = indexOfById(list, id);
      if (op.add) {
        if (!item) return;
        if (at >= 0) list[at] = item;
        else if (list.length < (op.type === 'listing' ? 20 : 12)) list.push(item);
      } else if (at >= 0) list.splice(at, 1);
    });
    return normalizeMarket(out);
  }

  function diffSpace(raw, ops) {
    var out = normalizeSpace(raw);
    ops.forEach(function (op) {
      if (op.type === 'currency') {
        var kind = cleanText(op.values[0], 60);
        if (!hasText(kind)) return;
        var ci = -1;
        for (var i = 0; i < out.currencies.length; i += 1) {
          if (out.currencies[i].kind === kind) { ci = i; break; }
        }
        if (op.add) {
          if (ci >= 0) out.currencies[ci].amount = cleanText(op.values[1], 80);
          else if (out.currencies.length < 10) out.currencies.push({ kind: kind, amount: cleanText(op.values[1], 80) });
        } else if (ci >= 0) out.currencies.splice(ci, 1);
        return;
      }
      if (op.type === 'item') {
        var id = cleanText(op.values[0], 160);
        if (!id) return;
        var ii = indexOfById(out.items, id);
        if (op.add) {
          var name = cleanText(op.values[1], 120);
          if (!hasText(name)) return;
          var item = { id: id, name: name, qty: nzero(op.values[2]), qtyText: cleanText(op.values[2], 40), grade: cleanText(op.values[3], 60), desc: cleanText(op.values[4], 3000) };
          if (ii >= 0) out.items[ii] = item;
          else if (out.items.length < 30) out.items.push(item);
        } else if (ii >= 0) out.items.splice(ii, 1);
      }
    });
    return normalizeSpace(out);
  }

  function diffMap(raw, ops) {
    var out = normalizeMap(raw);
    ops.forEach(function (op) {
      if (op.type === 'current') {
        var place = cleanText(op.values[0], 120);
        if (!op.add) return;
        if (!hasText(place)) return;
        out.current = { place: place, domain: cleanText(op.values[1], 120), desc: cleanText(op.values[2], 3000) };
        return;
      }
      if (op.type === 'track') {
        var id = cleanText(op.values[0], 160);
        if (!id) return;
        var ti = indexOfById(out.tracks, id);
        if (op.add) {
          var place = cleanText(op.values[2], 120);
          if (!hasText(place)) return;
          var track = { id: id, time: cleanText(op.values[1], 80), place: place, action: cleanText(op.values[3], 300) };
          if (ti >= 0) out.tracks[ti] = track;
          else if (out.tracks.length < 20) out.tracks.push(track);
        } else if (ti >= 0) out.tracks.splice(ti, 1);
        return;
      }
      if (op.type === 'place') {
        var pid = cleanText(op.values[0], 160);
        if (!pid) return;
        var pIndex = indexOfById(out.places, pid);
        if (op.add) {
          var pname = cleanText(op.values[1], 120);
          if (!hasText(pname)) return;
          var placeItem = { id: pid, name: pname, domain: cleanText(op.values[2], 120), desc: cleanText(op.values[3], 3000) };
          if (pIndex >= 0) out.places[pIndex] = placeItem;
          else if (out.places.length < 20) out.places.push(placeItem);
        } else if (pIndex >= 0) out.places.splice(pIndex, 1);
      }
    });
    return normalizeMap(out);
  }

  var DIFF_APPLIERS = { tablet: diffTablet, msg: diffChats, notes: diffNotes, forum: diffForum, market: diffMarket, space: diffSpace, map: diffMap };

  // 单个功能分区的未达标 issue 列表；issue 只存 path + code，文案在渲染层经 catalog 翻译。
  function featureIssues(id, result) {
    result = safeObject(result);
    if (id === 'tablet') {
      return ['basic', 'look', 'cult', 'gong', 'bond', 'secret'].filter(function (g) { return !safeObject(result.groups)[g]; })
        .map(function (g) { return { path: 'tablet.' + g, code: 'tablet.' + g }; });
    }
    if (id === 'msg') {
      var msgIssues = [];
      if (!result.contacts) msgIssues.push({ path: 'msg.contacts', code: 'msg.contacts' });
      if (!result.groups) msgIssues.push({ path: 'msg.groups', code: 'msg.groups' });
      return msgIssues;
    }
    if (id === 'notes') {
      var noteIssues = [];
      if (!result.folders) noteIssues.push({ path: 'notes.folders', code: 'notes.folders' });
      if (!result.notes) noteIssues.push({ path: 'notes.notes', code: 'notes.notes' });
      return noteIssues;
    }
    return result.ok ? [] : [{ path: id + '.rows', code: id + '.rows' }];
  }

  function assess(snapshot, flags, oldState) {
    snapshot = safeObject(snapshot);
    // 封印（flags[id]===false）的功能不参与完整性判定：提示词不再请求该区块，模型自然不输出，
    // 若仍按全集判定会导致 sync 状态永远停在 partial。
    function on(id) { return !flags || flags[id] !== false; }
    // part 轮只判定出现的分区；skip 分区改判旧数据（oldState 缺省视为不达标）；未出现的分区不判定。
    // full 轮：缺已启封分区即记 issue。
    var part = safeObject(snapshot.turn).mode === 'part';
    var present = part ? safeArray(snapshot.present, 10) : null;
    var skipped = part ? safeObject(snapshot.skipped) : {};
    oldState = safeObject(oldState);
    var results = {};
    var pass = {};
    var applyPlan = {};
    var issues = [];
    function record(list) { list.forEach(function (issue) { if (issues.length < 20) issues.push(issue); }); }
    ASSESS_ORDER.forEach(function (id) {
      var res = ASSESSORS[id](snapshot[FEATURE_FIELDS[id]]);
      results[id] = res;
      if (!on(id)) { pass[id] = false; applyPlan[id] = false; return; }
      if (part && present.indexOf(id) < 0) {
        if (skipped[id] != null) {
          // skip 分区：旧数据达标则静默通过（不应用、不计 applied），不达标沿用该分区现有 issue code。
          var oldResult = ASSESSORS[id](oldState[FEATURE_FIELDS[id]]);
          pass[id] = !!oldResult.ok;
          if (!pass[id]) record(featureIssues(id, oldResult));
        } else {
          pass[id] = true;
        }
        applyPlan[id] = false;
        return;
      }
      pass[id] = res.ok;
      applyPlan[id] = res.ok;
      if (!res.ok) record(featureIssues(id, res));
    });
    return {
      ok: ASSESS_ORDER.every(function (id) { return !on(id) || pass[id]; }),
      part: part,
      apply: applyPlan,
      tablet: results.tablet, msg: results.msg, notes: results.notes, forum: results.forum,
      market: results.market, space: results.space, map: results.map,
      issues: issues
    };
  }

  var MAX_SNAPSHOT_BYTES = 200000;

  function applySnapshot(rawState, rawSnapshot, flags) {
    var state = normalizeState(rawState);
    // 封印的功能既不参与判定也不应用数据：提示词未请求，即使快照残留旧区块也忽略。
    function on(id) { return !flags || flags[id] !== false; }
    var rawSize = 0;
    try { rawSize = JSON.stringify(rawSnapshot).length; } catch (_) { rawSize = MAX_SNAPSHOT_BYTES + 1; }
    if (rawSize > MAX_SNAPSHOT_BYTES) {
      var oversized = { ok: false, tablet: { ok: false }, msg: { ok: false }, notes: { ok: false }, forum: { ok: false }, market: { ok: false }, space: { ok: false }, map: { ok: false }, issues: [{ path: 'payload', code: 'payload.oversized' }], oversized: true };
      state.sync = Object.assign({}, state.sync, { status: state.revision ? state.sync.status : 'invalid', lastError: 'oversized-payload', issues: oversized.issues, updatedAt: Date.now() });
      state.updatedAt = Date.now();
      return { state: state, duplicate: false, applied: [], assessment: oversized, oversized: true };
    }
    var snapshot = sanitize(rawSnapshot);
    var turn = safeObject(snapshot && snapshot.turn);
    var turnId = cleanText(turn.id || ('turn-' + stableHash(snapshot)), 160);
    // 去重指纹 = 轮次 id + 快照内容哈希：同一消息经 generation:success 与 message 钩子
    // 双通道重复投递时内容一致、仍被去重；重新生成/续写常复用同一轮次 id 但内容已变，
    // 指纹含内容哈希保证按新快照应用。
    var fingerprint = turnId.slice(0, 140) + '@' + stableHash(JSON.stringify(snapshot));
    if (state.processedTurns.indexOf(fingerprint) >= 0) return { state: state, duplicate: true, applied: [], assessment: assess(snapshot, flags) };

    // diff 轮：把 +/- 操作行合并进当前分区（未提及的分区原样保留），评估在合并结果上进行。
    var diffOps = safeObject(snapshot.diff);
    var diffMode = turn.mode === 'diff' || Object.keys(diffOps).length > 0;
    var opCount = Object.keys(diffOps).length;
    var merged = null;
    var assessment;
    if (diffMode) {
      var diffResults = {};
      var diffPass = {};
      var diffApply = {};
      var diffIssues = [];
      merged = {};
      ASSESS_ORDER.forEach(function (id) {
        if (!on(id)) { diffPass[id] = false; diffApply[id] = false; return; }
        var ops = safeArray(diffOps[id], 60);
        var data = state[FEATURE_FIELDS[id]];
        if (ops.length) {
          data = DIFF_APPLIERS[id](state[FEATURE_FIELDS[id]], ops);
          merged[id] = data;
        }
        var res = ASSESSORS[id](data);
        diffResults[id] = res;
        diffPass[id] = res.ok;
        // 只有本轮带操作行且合并结果达标的分区才落盘；未提及分区保留旧数据。
        diffApply[id] = ops.length > 0 && res.ok;
        if (!res.ok) featureIssues(id, res).forEach(function (issue) { if (diffIssues.length < 20) diffIssues.push(issue); });
      });
      assessment = {
        ok: ASSESS_ORDER.every(function (id) { return !on(id) || diffPass[id]; }),
        part: false,
        diff: true,
        apply: diffApply,
        tablet: diffResults.tablet, msg: diffResults.msg, notes: diffResults.notes, forum: diffResults.forum,
        market: diffResults.market, space: diffResults.space, map: diffResults.map,
        issues: diffIssues
      };
    } else {
      assessment = assess(snapshot, flags, state);
    }
    var part = assessment.part === true;
    var presentList = safeArray(snapshot.present, 10);
    var skippedMap = part ? safeObject(snapshot.skipped) : {};
    // meta-only：part/diff 轮除 <yz_meta> 外没有任何分区与操作行。
    var metaOnly = (part || diffMode) && !presentList.length && !Object.keys(skippedMap).length && !opCount;
    if (metaOnly && state.revision > 0) {
      // 「本轮无变化」：状态保持原值，仅刷新摘要与轮次；不计 issue、不弹 Toast、不动 revision。
      state.processedTurns.push(fingerprint);
      state.processedTurns = state.processedTurns.slice(-80);
      state.sync = Object.assign({}, state.sync, { totalTurns: (state.sync && state.sync.totalTurns || 0) + 1 });
      state.updatedAt = Date.now();
      state.sync = Object.assign({}, state.sync, {
        turnId: turnId,
        roleName: cleanText(turn.roleName, 120),
        summary: cleanText(turn.summary, 500),
        applied: [],
        updatedAt: state.updatedAt
      });
      return { state: state, duplicate: false, applied: [], assessment: assessment };
    }
    var applied = [];
    ASSESS_ORDER.forEach(function (id) {
      if (!on(id)) return;
      if (!assessment.apply[id]) return;
      // diff 轮的合并结果按功能 id 存放（merged[id]）；full 轮快照按 state 字段存放。
      state[FEATURE_FIELDS[id]] = NORMALIZERS[id](merged ? merged[id] : snapshot[FEATURE_FIELDS[id]]);
      applied.push(id);
    });
    if (applied.length) state.revision += 1;
    // 持久化强制全量标记：成功应用一轮完整全量（所有已启封分区达标）后清除；
    // diff/part 轮不清除——封印切换与版本更新后的重同步必须等真正的全量轮。
    if (!part && !diffMode && assessment.ok) state.pendingFull = false;
    state.processedTurns.push(fingerprint);
    state.processedTurns = state.processedTurns.slice(-80);
    // 累计轮次单调计数（processedTurns 是 80 条环缓冲，会截断；总数必须独立持久化）。
    state.sync = Object.assign({}, state.sync, { totalTurns: (state.sync && state.sync.totalTurns || 0) + 1 });
    state.updatedAt = Date.now();
    var previousSeen = safeArray(state.sync && state.sync.appliedSeen, 20);
    // 状态公式：full/part 沿用既有语义；diff 轮失败不动旧数据，已有数据时最差也只是 partial。
    var nextStatus;
    if (part) nextStatus = metaOnly ? 'invalid' : (assessment.ok ? 'complete' : 'partial');
    else if (assessment.ok) nextStatus = 'complete';
    else if (applied.length) nextStatus = 'partial';
    else if (diffMode && state.revision > 0) nextStatus = 'partial';
    else nextStatus = 'invalid';
    state.sync = {
      status: nextStatus,
      turnId: turnId,
      roleName: cleanText(turn.roleName, 120),
      summary: cleanText(turn.summary, 500),
      applied: applied,
      // 本轮已应用的分区移出 seen：卦位重新点亮「新」徽标，用户查看（openFeature）后再次并入。
      appliedSeen: previousSeen.filter(function (seenId) { return applied.indexOf(seenId) < 0; }),
      issues: assessment.issues.slice(0, 20),
      // 玩家传讯已读游标是跨轮持久状态：sync 整体重建时必须保留，否则注入即已读的
      // 游标被下一轮数据覆盖，未读数随之错误反弹。负值钳制为 0（脏数据防御）。
      playerReadCursor: nzero(Number(state.sync && state.sync.playerReadCursor)) || 0,
      updatedAt: state.updatedAt
    };
    return { state: state, duplicate: false, applied: applied, assessment: assessment };
  }

  var CORE = {
    cleanText: cleanText,
    escapeHtml: escapeHtml,
    sanitize: sanitize,
    stableHash: stableHash,
    clone: clone,
    safeObject: safeObject,
    safeArray: safeArray,
    hasText: hasText,
    groupId: groupId,
    keyId: keyId,
    GROUP_ORDER: GROUP_ORDER,
    PLAYER_CONTACT_ID: PLAYER_CONTACT_ID,
    PLAYER_THREAD_ID: PLAYER_THREAD_ID,
    MAX_PLAYER_UNREAD_ROWS: MAX_PLAYER_UNREAD_ROWS,
    MAX_PLAYER_GROUP_ROWS: MAX_PLAYER_GROUP_ROWS,
    MAX_INJECT_CONTACTS: MAX_INJECT_CONTACTS,
    MAX_INJECT_GROUPS: MAX_INJECT_GROUPS,
    MAX_INJECT_POSTS: MAX_INJECT_POSTS,
    sampleEntries: sampleEntries,
    blankTablet: blankTablet,
    blankState: blankState,
    blankPlayerState: blankPlayerState,
    normalizePlayerState: normalizePlayerState,
    playerNextId: playerNextId,
    playerFindEntity: playerFindEntity,
    FEATURE_FIELDS: FEATURE_FIELDS,
    blankFeatureField: blankFeatureField,
    normalizeState: normalizeState,
    normalizeTablet: normalizeTablet,
    normalizeChats: normalizeChats,
    normalizeNotes: normalizeNotes,
    normalizeForum: normalizeForum,
    normalizeMarket: normalizeMarket,
    normalizeSpace: normalizeSpace,
    normalizeMap: normalizeMap,
    assess: assess,
    applySnapshot: applySnapshot,
    MAX_SNAPSHOT_BYTES: MAX_SNAPSHOT_BYTES
  };
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
    var meta = { id: '', roleName: '', summary: '', mode: '' };
    typed(body, ['turn', '轮次']).forEach(function (line) {
      var values = row(line, 5);
      meta.id = cleanText(values[1], 160);
      meta.roleName = cleanText(values[2], 120);
      meta.summary = cleanText(values[3], 500);
      meta.mode = cleanText(values[4], 40);
    });
    return meta;
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
    var parsed = parse(text);
    if (parsed) return [parsed];
    var out = [];
    var bodies = parseEnvelope(text, 'yz_jade');
    bodies.forEach(function (block) {
      var parsedBlock = parse(block.body) || parse('<yz_jade>\n' + block.body + '\n</yz_jade>');
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

  var TRANSLATE = null;

  function fillParams(text, params) {
    return String(text == null ? '' : text).replace(/\{(\w+)\}/g, function (match, key) {
      return params && params[key] != null ? String(params[key]) : match;
    });
  }

  function tr(key, params) {
    if (TRANSLATE) {
      var out;
      try { out = TRANSLATE(key, params); } catch (_) { out = key; }
      return typeof out === 'string' ? out : String(out);
    }
    return fillParams(key, params);
  }

  var dictCache = null;

  function buildDict() {
    return {
      appName: tr('runtime.appName'),
      avaFallback: tr('runtime.avaFallback'),
      brand: { title: tr('runtime.brand.title'), sub: tr('runtime.brand.sub') },
      closePhone: tr('runtime.closePhone'),
      back: tr('runtime.back'),
      cancel: tr('runtime.cancel'),
      awaitingSync: tr('runtime.awaitingSync'),
      homeEmpty: tr('runtime.home.empty'),
      emptyTablet: tr('runtime.emptyTablet'),
      tabletPartial: tr('runtime.tablet.partial'),
      tabletPendingGroup: tr('runtime.tablet.pendingGroup'),
      stripFallback: tr('runtime.stripFallback'),
      fabLabel: tr('runtime.fab.label'),
      sealGlyph: tr('runtime.seal.glyph'),
      lockGlyph: tr('runtime.seal.lockGlyph'),
      status: { complete: tr('runtime.sync.complete'), partial: tr('runtime.sync.partial'), invalid: tr('runtime.sync.invalid'), empty: tr('runtime.sync.empty') },
      toast: {
        parseError: tr('runtime.toast.parseError'),
        generationError: tr('runtime.toast.generationError'),
        cancelled: tr('runtime.toast.cancelled'),
        sealed: tr('runtime.toast.sealed'),
        fabReset: tr('runtime.toast.fabReset'),
        oversized: tr('runtime.toast.oversized'),
        rebuilt: tr('runtime.toast.rebuilt'),
        noSnapshot: tr('runtime.toast.noSnapshot'),
        disabled: tr('runtime.toast.disabled'),
        restoreFailed: tr('runtime.toast.restoreFailed'),
        stale: tr('runtime.toast.stale'),
        clearTitle: tr('runtime.toast.clearTitle'),
        clearConfirm: tr('runtime.toast.clearConfirm'),
        clearConfirmAction: tr('runtime.toast.clearConfirmAction'),
        cleared: tr('runtime.toast.cleared'),
        exported: tr('runtime.manage.exportDone'),
        exportFailed: tr('runtime.manage.exportFailed')
      },
      badge: { new: tr('runtime.badge.new'), alert: tr('runtime.badge.alert') },
      coreAria: tr('runtime.core.aria'),
      diag: {
        title: tr('runtime.diag.title'),
        statusLabel: tr('runtime.diag.status'),
        summary: tr('runtime.diag.summary'),
        turn: tr('runtime.diag.turn'),
        source: tr('runtime.diag.source'),
        applied: tr('runtime.diag.applied'),
        none: tr('runtime.diag.none'),
        issuesLabel: tr('runtime.diag.issues'),
        noIssues: tr('runtime.diag.noIssues'),
        lastError: tr('runtime.diag.lastError'),
        updated: tr('runtime.diag.updated'),
        storage: tr('runtime.diag.storage'),
        turns: tr('runtime.diag.turns'),
        chatId: tr('runtime.diag.chatId'),
        tech: tr('runtime.diag.tech'),
        err: {
          'parse-error': tr('runtime.diag.err.parse-error'),
          'oversized-payload': tr('runtime.diag.err.oversized-payload')
        },
        action: { partial: tr('runtime.diag.action.partial'), invalid: tr('runtime.diag.action.invalid') }
      },
      issues: {
        'tablet.basic': tr('assess.issue.tablet.basic'),
        'tablet.look': tr('assess.issue.tablet.look'),
        'tablet.cult': tr('assess.issue.tablet.cult'),
        'tablet.gong': tr('assess.issue.tablet.gong'),
        'tablet.bond': tr('assess.issue.tablet.bond'),
        'tablet.secret': tr('assess.issue.tablet.secret'),
        'msg.contacts': tr('assess.issue.msg.contacts'),
        'msg.groups': tr('assess.issue.msg.groups'),
        'notes.folders': tr('assess.issue.notes.folders'),
        'notes.notes': tr('assess.issue.notes.notes'),
        'forum.posts': tr('assess.issue.forum.posts'),
        'forum.rows': tr('assess.issue.forum.rows'),
        'market.rows': tr('assess.issue.market.rows'),
        'space.rows': tr('assess.issue.space.rows'),
        'map.rows': tr('assess.issue.map.rows'),
        'payload.oversized': tr('assess.issue.payload.oversized')
      },
      guards: {
        contacts: tr('runtime.guard.contacts'), groups: tr('runtime.guard.groups'), chat: tr('runtime.guard.chat'), gchat: tr('runtime.guard.gchat'),
        folders: tr('runtime.guard.folders'), notes: tr('runtime.guard.notes'), note: tr('runtime.guard.note'),
        posts: tr('runtime.guard.posts'), post: tr('runtime.guard.post'),         listings: tr('runtime.guard.listings'),
        auctions: tr('runtime.guard.auctions'), orders: tr('runtime.guard.orders'), requests: tr('runtime.guard.requests'), currencies: tr('runtime.guard.currencies'),
        items: tr('runtime.guard.items'), tracks: tr('runtime.guard.tracks')
      },
      searchPlaceholder: tr('runtime.search.placeholder'),
      searchClear: tr('runtime.search.clear'),
      searchNoMatch: tr('runtime.search.noMatch'),
      playerDomain: tr('runtime.player.domain'),
      playerCharacterDomain: tr('runtime.player.characterDomain'),
      playerFallbackName: tr('runtime.player.fallbackName'),
      playerRelation: tr('runtime.player.relation'),
      playerThreadRelation: tr('runtime.player.threadRelation'),
      playerThreadFallback: tr('runtime.player.threadFallback'),
      playerThreadEmpty: tr('runtime.player.threadEmpty'),
      playerNoThread: tr('runtime.player.noThread'),
      playerStartThread: tr('runtime.player.startThread'),
      playerMsgPlaceholder: tr('runtime.player.msgPlaceholder'),
      playerGroupMsgPlaceholder: tr('runtime.player.groupMsgPlaceholder'),
      playerCommentPlaceholder: tr('runtime.player.commentPlaceholder'),
      playerSend: tr('runtime.player.send'),
      playerComment: tr('runtime.player.comment'),
      playerStatusSent: tr('runtime.player.statusSent'),
      playerStatusRead: tr('runtime.player.statusRead'),
      playerStatusReplied: tr('runtime.player.statusReplied'),
      playerSentWord: tr('runtime.player.sentWord'),
      playerRepliedWord: tr('runtime.player.repliedWord'),
      playerHomeInfo: tr('runtime.player.homeInfo'),
      playerManageLocked: tr('runtime.player.manageLocked'),
      playerEmptyInput: tr('runtime.player.emptyInput'),
      playerPublicTag: tr('runtime.player.publicTag'),
      playerDomainShort: tr('runtime.player.domainShort'),
      playerSentToast: tr('runtime.player.sentToast'),
      playerSendFailed: tr('runtime.player.sendFailed'),
      playerStatusUndelivered: tr('runtime.player.statusUndelivered'),
      playerRetry: tr('runtime.player.retry'),
      playerGroupSentToast: tr('runtime.player.groupSentToast'),
      playerCommentSentToast: tr('runtime.player.commentSentToast'),
      playerEmptyPrivate: tr('runtime.player.emptyPrivate'),
      playerMapEmpty: tr('runtime.player.mapEmpty'),
      playerReadOnlyOrders: tr('runtime.player.readOnlyOrders'),
      playerReadOnlySpace: tr('runtime.player.readOnlySpace'),
      playerReadOnlyForum: tr('runtime.player.readOnlyForum'),
      playerEditWord: tr('runtime.player.editWord'),
      playerNewWord: tr('runtime.player.newWord'),
      playerWord: {
        folder: tr('runtime.player.word.folder'), note: tr('runtime.player.word.note'), item: tr('runtime.player.word.item'),
        currency: tr('runtime.player.word.currency'), order: tr('runtime.player.word.order'), post: tr('runtime.player.word.post')
      },
      playerFieldName: tr('runtime.player.fieldName'),
      playerFieldTitle: tr('runtime.player.fieldTitle'),
      playerFieldBody: tr('runtime.player.fieldBody'),
      playerFieldLocked: tr('runtime.player.fieldLocked'),
      playerFieldQty: tr('runtime.player.fieldQty'),
      playerFieldGrade: tr('runtime.player.fieldGrade'),
      playerFieldDesc: tr('runtime.player.fieldDesc'),
      playerFieldKind: tr('runtime.player.fieldKind'),
      playerFieldAmount: tr('runtime.player.fieldAmount'),
      playerFieldItemName: tr('runtime.player.fieldItemName'),
      playerFieldStatus: tr('runtime.player.fieldStatus'),
      playerFieldPrice: tr('runtime.player.fieldPrice'),
      playerFieldSide: tr('runtime.player.fieldSide'),
      playerFieldSection: tr('runtime.player.fieldSection'),
      playerPostTag: tr('runtime.player.postTag'),
      playerSideBuy: tr('runtime.player.sideBuy'),
      playerSideSell: tr('runtime.player.sideSell'),
      playerSave: tr('runtime.player.save'),
      playerEdit: tr('runtime.player.edit'),
      playerDelete: tr('runtime.player.delete'),
      playerDeleteConfirm: tr('runtime.player.deleteConfirm'),
      playerSaved: tr('runtime.player.saved'),
      playerDeleted: tr('runtime.player.deleted'),
      playerUndo: tr('runtime.player.undo'),
      playerRestored: tr('runtime.player.restored'),
      playerFormRequired: tr('runtime.player.formRequired'),
      playerFormNeedFolder: tr('runtime.player.formNeedFolder'),
      playerFormMissing: tr('runtime.player.formMissing'),
      playerQtyStepDown: tr('runtime.player.qtyStepDown'),
      playerQtyStepUp: tr('runtime.player.qtyStepUp'),
      playerMarkAllRead: tr('runtime.player.markAllRead'),
      forumCommentsFull: tr('runtime.forum.commentsFull'),
      labels: {
        self: tr('runtime.label.self'), locked: tr('runtime.label.locked'), membersUnit: tr('runtime.label.membersUnit'),
        notesWord: tr('runtime.label.notesWord'), resonance: tr('runtime.label.resonance'), commentsWord: tr('runtime.label.commentsWord'),
        startPrice: tr('runtime.label.startPrice'), bidsUnit: tr('runtime.label.bidsUnit'), buy: tr('runtime.label.buy'), sell: tr('runtime.label.sell')
      },
      tabs: {
        contacts: tr('runtime.tab.contacts'), groups: tr('runtime.tab.groups'), folders: tr('runtime.tab.folders'), notes: tr('runtime.tab.notes'),
        listings: tr('runtime.tab.listings'), requests: tr('runtime.tab.requests'), auctions: tr('runtime.tab.auctions'), orders: tr('runtime.tab.orders'),
        currencies: tr('runtime.tab.currencies'), items: tr('runtime.tab.items')
      },
      features: {
        tablet: tr('runtime.feature.tablet'), msg: tr('runtime.feature.msg'), forum: tr('runtime.feature.forum'), notes: tr('runtime.feature.notes'),
        market: tr('runtime.feature.market'), space: tr('runtime.feature.space'), map: tr('runtime.feature.map'), manage: tr('runtime.feature.manage')
      },
      gua: {
        tablet: tr('runtime.gua.tablet'), msg: tr('runtime.gua.msg'), notes: tr('runtime.gua.notes'), market: tr('runtime.gua.market'),
        forum: tr('runtime.gua.forum'), space: tr('runtime.gua.space'), map: tr('runtime.gua.map'), manage: tr('runtime.gua.manage')
      },
      groups: { basic: tr('runtime.group.basic'), look: tr('runtime.group.look'), cult: tr('runtime.group.cult'), gong: tr('runtime.group.gong'), bond: tr('runtime.group.bond'), secret: tr('runtime.group.secret') },
      fields: {
        name: tr('runtime.field.name'), gender: tr('runtime.field.gender'), height: tr('runtime.field.height'), weight: tr('runtime.field.weight'),
        appearance: tr('runtime.field.appearance'), clothing: tr('runtime.field.clothing'), root: tr('runtime.field.root'), body: tr('runtime.field.body'),
        realm: tr('runtime.field.realm'), status: tr('runtime.field.status'), technique: tr('runtime.field.technique'), bond: tr('runtime.field.bond')
      },
      manage: {
        info: tr('runtime.manage.info'),
        on: tr('runtime.manage.on'),
        off: tr('runtime.manage.off'),
        resetFab: tr('runtime.manage.resetFab'),
        clear: tr('runtime.manage.clear'),
        clearConfirm: tr('runtime.manage.clearConfirm'),
        export: tr('runtime.manage.export'),
        exportNote: tr('runtime.manage.exportNote'),
        import: tr('runtime.manage.import'),
        importBtn: tr('runtime.manage.importBtn'),
        importDone: tr('runtime.manage.importDone'),
        importBad: tr('runtime.manage.importBad'),
        importOversized: tr('runtime.manage.importOversized'),
        importParse: tr('runtime.manage.importParse'),
        importWarn: tr('runtime.manage.importWarn'),
        copyAll: tr('runtime.manage.copyAll'),
        exportTooBig: tr('runtime.manage.exportTooBig'),
        importPlaceholder: tr('runtime.manage.importPlaceholder')
      },
      mapTitles: { current: tr('runtime.map.currentTitle'), tracks: tr('runtime.map.trackTitle'), places: tr('runtime.map.placesTitle') }
    };
  }

  var I18N = {
    // 缓存整份翻译字典，onChange（语言切换）时失效重建：
    // 避免每次 render 都对宿主发起上百次 t() 同步调用。
    dict: function () { if (!dictCache) dictCache = buildDict(); return dictCache; },
    invalidate: function () { dictCache = null; }
  };

  function makeTranslator(tavoApi) {
    var api = tavoApi && tavoApi.plugin && tavoApi.plugin.i18n;
    if (!api || typeof api.t !== 'function') return fillParams;
    return function (key, params) {
      var out;
      try { out = api.t(key, params); } catch (_) { out = key; }
      return typeof out === 'string' ? out : String(out);
    };
  }

  var LOCAL_PREFIX = 'yz-jade-v1:';
  // 本地镜像只是启动加速缓存：权威数据在世界书（玉兆档案·<chatId> 的分片快照条目），
  // 缓存可随时丢弃（宿主存储不再参与持久化，世界书恢复链见 load）。
  // 玩家域存储：与角色域完全独立的键（本地镜像 + 世界书分片快照）。
  var PLAYER_LOCAL_PREFIX = 'yz-jade-player-v1:';
  // 世界书快照分片：单片内容上限（字符）与单域最多片数。整本世界书 update 原子替换，
  // 快照拆片保证单条目不超宿主单条上限；超出总片数上限时放弃快照（仅诊断提示）。
  var SNAP_SHARD_CHARS = 90000;
  var MAX_SNAP_SHARDS = 5;
  // 插件版本：状态里记录生成时的版本，版本变化置持久化强制全量标记（见 doSwitchChat），
  // 让更新后的第一轮生成按新提示词重写全部数据——旧格式数据不再粘滞。
  // 发布时必须与 manifest.json 的 version 保持一致（冒烟契约测试校验）。
  var PLUGIN_VERSION = '2.2.0';

  function createRuntime() {
    var tavoApi = arguments[0] || {};
    var local = arguments[1] || null;
    var getFlags = typeof arguments[2] === 'function' ? arguments[2] : function () { return null; };

    // 内存态只保留最近使用的少量聊天；淘汰无损——每次写入都会落盘（镜像缓存 + 世界书），
    // 重新进入被淘汰的聊天时从镜像缓存/世界书重新加载。
    var MAX_ACTIVE_CHATS = 5;
    var chats = Object.create(null);
    // 玩家域与角色域同一生命周期：随 switchChat 加载、随 LRU 一并淘汰。
    var playerChats = Object.create(null);
    var lru = [];
    var activeChatId = 'unknown';
    var epoch = 0;
    var saveQueue = Promise.resolve();

    function rememberChat(chatId) {
      var i = lru.indexOf(chatId);
      if (i >= 0) lru.splice(i, 1);
      lru.push(chatId);
    }

    function evictChats() {
      while (lru.length > MAX_ACTIVE_CHATS && lru[0] !== activeChatId) {
        var evicted = lru.shift();
        delete chats[evicted];
        delete playerChats[evicted];
      }
    }

    function localGet(key) {
      try { return local && typeof local.getItem === 'function' ? local.getItem(key) : null; } catch (error) { dbg('local get failed: ' + key, error); return null; }
    }

    function localSet(key, value) {
      try { if (local && typeof local.setItem === 'function') local.setItem(key, value); } catch (error) { dbg('local set failed: ' + key, error); }
    }

    function parseStored(raw) {
      if (raw == null) return null;
      if (typeof raw === 'object') return raw;
      try { return JSON.parse(String(raw)); } catch (_) { return null; }
    }

    // 落盘走后台串行队列：内存态已同步更新，调用方无需等待写完成，
    // 关键路径（generation:success）因此不被存储 IO 占用预算；同 key 写入按入队顺序生效。
    // 持久化语义：本地镜像（缓存，同步写穿）+ 世界书（权威，排队合并同步）。
    // 玩家域与角色域同链路（savePlayer 只换镜像键）。
    function savePlayer(chatId, player) {
      save(chatId, player, { localPrefix: PLAYER_LOCAL_PREFIX });
    }
    function save(chatId, state, profile) {
      profile = profile || {};
      var serialized;
      try { serialized = JSON.stringify(state); } catch (error) { dbg('state serialize failed', error); return saveQueue; }
      if (serialized.length > MAX_SNAPSHOT_BYTES) dbg('serialized state exceeds snapshot limit: ' + serialized.length);
      saveQueue = saveQueue.then(function () {
        localSet((profile.localPrefix || LOCAL_PREFIX) + chatId, serialized);
      }).catch(function (error) { dbg('save failed: ' + chatId, error); });
      // 世界书是权威存储：任何数据变化都排队同步（busy 合并、幂等、失败降级镜像）。
      // 只有"有实际数据"才同步：空白/未加载状态（新聊天、玩家域尚未加载的加载窗口）
      // 不得覆盖已有世界书（否则用空状态清掉权威快照）。
      var p = playerChats[chatId];
      var playerTouched = !!p && ((Number(p.updatedAt) || 0) > 0 || CORE.safeArray(p.chats && p.chats.contacts, 10).length > 0);
      var roleTouched = (Number(state && state.revision) || 0) > 0 || Number(state && state.sync && state.sync.updatedAt) > 0;
      if (chatId === activeChatId && (roleTouched || playerTouched)) syncArchive(chatId);
      return saveQueue;
    }

    // 世界书快照读取：玉兆档案·<chatId> 书里的分片快照条目（yz-snap-N / yz-psnap-N，
    // enabled:false 永不注入）按 index 拼接还原整份状态；兼容旧版单条 yz-snap
    // （内容直接为状态 JSON，无分片包装）。片序缺失/包装损坏时整体放弃（降级镜像）。
    async function lorebookSnapshotState(chatId, kind) {
      kind = kind === 'player' ? 'player' : 'role';
      var lore = tavoApi.lorebook;
      if (!lore || typeof lore.find !== 'function') return null;
      try {
        var found = await Promise.resolve(lore.find(ARCHIVE_NAME_PREFIX + chatId.slice(0, 40), { match: 'exact' }));
        var book = Array.isArray(found) && found[0] && Array.isArray(found[0].entries) ? found[0] : null;
        if (!book) return null;
        var entries = safeArray(book.entries, 200);
        var shards = [];
        entries.forEach(function (entry) {
          var m = /^(yz-snap|yz-psnap)-(\d+)$/.exec(String(entry && entry.identifier) || '');
          if (!m) return;
          if ((m[1] === 'yz-psnap') !== (kind === 'player')) return;
          shards.push({ n: Number(m[2]) || 0, content: entry.content });
        });
        if (shards.length) {
          shards.sort(function (a, b) { return a.n - b.n; });
          var bodies = [];
          var valid = true;
          for (var i = 0; i < shards.length; i += 1) {
            var shard = parseStored(shards[i].content);
            if (!shard || shard.v !== 2 || shard.kind !== kind || shard.index !== i + 1 || shard.total !== shards.length) { valid = false; break; }
            bodies.push(String(shard.body == null ? '' : shard.body));
          }
          if (valid) {
            var parsed = parseStored(bodies.join(''));
            if (parsed) return parsed;
          }
        }
        // 兼容旧版单条 yz-snap（仅角色域；玩家域从未写过单条格式）。
        if (kind === 'role') {
          for (var j = 0; j < entries.length; j += 1) {
            var entry = entries[j];
            if (entry && entry.identifier === 'yz-snap' && hasText(entry.content)) {
              var legacy = parseStored(entry.content);
              if (legacy) return legacy;
            }
          }
        }
      } catch (error) { dbg('lorebook snapshot restore failed', error); }
      return null;
    }

    // 存储恢复链：世界书（权威）→ 本地镜像（缓存）→ 空白。
    // 镜像与世界书同源同内容时取最新：save 先写镜像后排队写世界书（还可能被 busy 合并），
    // 所以镜像的 updatedAt 恒不早于世界书；revision 严格更高或平局时更新者胜。
    // 任何非世界书来源读到的数据都回写世界书（首次使用自动迁移）；世界书读到则回写镜像。
    async function load(chatId) {
      var world = await lorebookSnapshotState(chatId);
      var fromWorld = !!world;
      var mirrored = parseStored(localGet(LOCAL_PREFIX + chatId));
      var mirrorRev = Number(mirrored && mirrored.revision) || 0;
      var worldRev = Number(world && world.revision) || 0;
      var mirrorTime = Number(mirrored && mirrored.updatedAt) || 0;
      var worldTime = Number(world && world.updatedAt) || 0;
      var parsed = null;
      if (mirrored && (!world || mirrorRev > worldRev || (mirrorRev === worldRev && mirrorTime >= worldTime))) {
        parsed = mirrored;
      } else if (world) {
        parsed = world;
      }
      if (parsed) {
        localSet(LOCAL_PREFIX + chatId, JSON.stringify(parsed));
        if (!fromWorld && chatId === activeChatId) syncArchive(chatId);
      }
      return CORE.normalizeState(parsed, chatId);
    }

    // 玩家域存储恢复链：世界书（yz-psnap 分片）→ 本地镜像 → 空白。
    // 无 revision 可比，按 updatedAt 取最新。
    async function loadPlayer(chatId) {
      var world = await lorebookSnapshotState(chatId, 'player');
      var fromWorld = !!world;
      var mirrored = parseStored(localGet(PLAYER_LOCAL_PREFIX + chatId));
      var parsed = null;
      if (mirrored && (!world || (Number(mirrored.updatedAt) || 0) >= (Number(world.updatedAt) || 0))) {
        parsed = mirrored;
      } else if (world) {
        parsed = world;
      }
      if (parsed) {
        localSet(PLAYER_LOCAL_PREFIX + chatId, JSON.stringify(parsed));
        if (!fromWorld && chatId === activeChatId) syncArchive(chatId);
      }
      return CORE.normalizePlayerState(parsed, chatId);
    }

    async function findAssistantMessages() {
      try {
        if (!tavoApi.message || typeof tavoApi.message.find !== 'function') return [];
        var rows = await Promise.resolve(tavoApi.message.find(null, { role: 'assistant' }));
        return Array.isArray(rows) ? rows : [];
      } catch (error) { dbg('message find failed', error); return []; }
    }

    function applySnapshotsToState(state, snapshots, source) {
      var changed = false;
      var oversized = false;
      var assessment = null;
      snapshots.forEach(function (snapshot) {
        var before = state.revision;
        var result = CORE.applySnapshot(state, snapshot, getFlags());
        state = result.state;
        assessment = result.assessment;
        if (result.oversized) oversized = true;
        if (state.revision !== before) changed = true;
      });
      state.sync.lastSource = source || '';
      return { state: state, changed: changed, oversized: oversized, assessment: assessment };
    }

    function historySignature(rows) {
      var last = rows.length ? rows[rows.length - 1] : null;
      var lastId = last && (last.id != null ? last.id : last.messageId);
      return rows.length + ':' + (lastId == null ? '' : String(lastId));
    }

    // 签名一致说明历史未变化且已按该版本水化过。
    function snapshotsPending(state, sig) {
      return !(state && state.hydration && state.hydration.sig === sig);
    }

    async function hydrateHistory(chatId, token, state) {
      var rows = await findAssistantMessages();
      if (token !== epoch || chatId !== activeChatId) return { stale: true, state: state, changed: false };
      // 水化版本标记：消息条数与末条 id 未变化时复用已持久化状态，避免长聊天每次开聊全量重扫。
      // 已知盲区：编辑中间楼层不会改变签名，由 App 层对无信封 message:updated 的去抖重建兜底。
      var sig = historySignature(rows);
      if (!snapshotsPending(state, sig)) return { stale: false, state: state, changed: false };
      var snapshots = [];
      rows.forEach(function (message) {
        PROTOCOL.extractSnapshots(message && (message.content != null ? message.content : message.text) || '').forEach(function (snapshot) { snapshots.push(snapshot); });
      });
      if (!snapshots.length) {
        // 历史中从未出现协议块：也记下签名，之后开聊直接复用，不再全文扫描。
        state.hydration = { sig: sig };
        return { stale: false, state: state, changed: false, marked: true };
      }
      var applied = applySnapshotsToState(state, snapshots, 'history');
      applied.state.hydration = { sig: sig };
      return { stale: false, state: applied.state, changed: true };
    }

    // settle：等待进行中的 switchChat（存储加载 + 历史水化）收尾。generation:prepare 注入
    // 基线前必须等待——插件刚重载（安装/更新后）时加载是异步的，直接读内存会拿到空白态，
    // 注入空基线导致模型凭空重造数据。等待期间若有新的 switchChat 开始则继续等最新的。
    var settleChain = Promise.resolve();

    function settle() {
      var wait = settleChain;
      return wait.then(function () {
        return settleChain === wait ? undefined : settle();
      });
    }

    function switchChat(chatId) {
      var task = doSwitchChat(chatId);
      settleChain = task.catch(function (error) { dbg('switch chat failed', error); });
      return task;
    }

    async function doSwitchChat(chatId) {
      chatId = CORE.cleanText(chatId || 'unknown', 160);
      epoch += 1;
      var token = epoch;
      activeChatId = chatId;
      rememberChat(chatId);
      evictChats();
      // 读存储前等落盘队列排空：上一聊天未写完的 save 会在队列里落镜像缓存，
      // 直接读会读到陈旧/空白数据（rev-0 聊天首条玩家消息曾因此丢失）。
      await saveQueue;
      var loaded = await load(chatId);
      if (token !== epoch || chatId !== activeChatId) return current();
      // load 的 await 期间若有事件真正写入内存（应用过快照、更新过 sync），保留内存版本，
      // 避免被刚读出的旧持久化状态整体覆盖；但仅被 current() 读过的空白占位不算数——
      // 否则持久化状态会被空白态顶掉，随后水化标记签名还会把空白态回写覆盖存储（丢数据）。
      var existing = chats[chatId];
      var touched = !!existing && (existing.revision > 0 || (existing.sync && existing.sync.updatedAt > 0) || safeArray(existing.processedTurns, 80).length > 0);
      if (!touched) chats[chatId] = loaded;
      var state = chats[chatId];
      // 版本变化（插件更新/卸载重装恢复）→ 持久化强制全量标记：下一轮生成按新提示词
      // 全量重写数据（旧格式行全部刷新，不再粘滞）；重启不丢标记。
      if (state.pluginVersion !== PLUGIN_VERSION) {
        state.pluginVersion = PLUGIN_VERSION;
        state.pendingFull = true;
        await save(chatId, state);
      }
      // 玩家域与角色域先后加载：同一聊天下两份独立状态，互不共享任何字段。
      var playerLoaded = await loadPlayer(chatId);
      if (token !== epoch || chatId !== activeChatId) return current();
      var playerExisting = playerChats[chatId];
      var playerTouched = !!playerExisting && (playerExisting.updatedAt > 0 || (playerExisting.chats && safeArray(playerExisting.chats.contacts, 10).length > 0));
      if (!playerTouched) playerChats[chatId] = playerLoaded;
      // 跨域通道对齐：把已发送的传讯补回角色域（历史重建/清空后玩家数据仍存续）。
      if (state.revision > 0) await syncPlayerChannel(chatId);
      if (state.revision > 0) await syncPlayerGroups(chatId);
      if (state.revision > 0) await syncPlayerPosts(chatId);
      var hydrated = await hydrateHistory(chatId, token, state);
      if (hydrated.stale || token !== epoch || chatId !== activeChatId) return current();
      // 水化 await 期间可能有一轮新生成落地（chats[chatId] 已被替换为新对象）：
      // 引用一致才写回，避免用进入时捕获的旧 state 覆盖新轮次（静默回滚）。
      if (chats[chatId] === state) {
        chats[chatId] = hydrated.state;
        if (hydrated.changed || hydrated.marked) await save(chatId, hydrated.state);
        // 水化可能补入新的角色回复：镜像回玩家域会话线程。
        if (hydrated.changed) await syncPlayerChannel(chatId);
        if (hydrated.changed) await syncPlayerGroups(chatId);
        if (hydrated.changed) await syncPlayerPosts(chatId);
      }
      return current();
    }

    async function rebuildFromHistory(chatId) {
      chatId = CORE.cleanText(chatId || activeChatId, 160);
      if (chatId !== activeChatId) return { stale: true, restored: false };
      epoch += 1;
      var token = epoch;
      // 读存储前等落盘队列排空：上一聊天未写完的 save 会在队列里落镜像缓存，
      // 直接读会读到陈旧/空白数据。
      await saveQueue;
      // 重建 = 从权威存储恢复：世界书快照（yz-snap/yz-psnap 分片）→ 本地镜像。
      // 历史消息正文经正文剥离后不含协议块，旧「从历史重建」数据源已随持久化改造
      // 移除；世界书快照才是当前唯一权威来源。
      var loaded = await load(chatId);
      if (token !== epoch || chatId !== activeChatId) return { stale: true, restored: false };
      var playerLoaded = await loadPlayer(chatId);
      if (token !== epoch || chatId !== activeChatId) return { stale: true, restored: false };
      var roleRestored = !!loaded && (Number(loaded.revision) > 0 || Number(loaded.sync && loaded.sync.updatedAt) > 0 || CORE.safeArray(loaded.processedTurns, 80).length > 0);
      var playerRestored = !!playerLoaded && ((Number(playerLoaded.updatedAt) || 0) > 0 || CORE.safeArray(playerLoaded.chats && playerLoaded.chats.contacts, 10).length > 0);
      if (!roleRestored && !playerRestored) {
        // 权威存储中没有玉兆数据（从未同步或已清空）：保留现有数据，不用空白覆盖。
        return { stale: false, restored: false };
      }
      if (roleRestored) {
        // 版本变化（插件更新/卸载重装恢复）→ 强制全量标记：下一轮生成按新提示词全量重写。
        if (loaded.pluginVersion !== PLUGIN_VERSION) {
          loaded.pluginVersion = PLUGIN_VERSION;
          loaded.pendingFull = true;
        }
        chats[chatId] = loaded;
        // 玩家真实数据以玩家域为源：恢复后补投回角色域（幂等，不产生副本）。
        await syncPlayerChannel(chatId);
        await syncPlayerGroups(chatId);
        await syncPlayerPosts(chatId);
      }
      if (playerRestored) playerChats[chatId] = playerLoaded;
      // 恢复结果落盘：镜像 + 世界书快照幂等对齐（含通道补投后的增量）。
      await save(chatId, chats[chatId] || loaded);
      return { stale: false, restored: true };
    }

    function current() {
      if (!chats[activeChatId]) {
        chats[activeChatId] = CORE.blankState(activeChatId);
        rememberChat(activeChatId);
        evictChats();
      }
      return chats[activeChatId];
    }

    // 玩家域当前聊天态：与角色域完全平行的懒加载容器，绝无字段共享。
    function playerCurrent() {
      if (!playerChats[activeChatId]) {
        playerChats[activeChatId] = CORE.blankPlayerState(activeChatId);
        rememberChat(activeChatId);
        evictChats();
      }
      return playerChats[activeChatId];
    }

    // ---------- 双玉兆 · 私讯通道（跨域写入点之一；另有群聊发言/论坛评论两个公开通道）----------
    // 玩家 → 角色：玩家域「与角色会话」的每条 self 消息落为角色域 yz-player 联系人的
    // other 消息——真实事件，不经模型评估（写什么是什么）。模型在后续轮次以普通
    // msg 行（self）自然回复。幂等：消息 id = pm-<seq>，双方按 id upsert，重复同步不产生副本。
    // 玩家名取 {{user}}（宿主用户身份名），拿不到时回退 catalog 文案。
    function playerThread(playerState) {
      var contacts = safeArray(playerState && playerState.chats && playerState.chats.contacts, 10);
      for (var i = 0; i < contacts.length; i += 1) {
        if (String(contacts[i].id) === CORE.PLAYER_THREAD_ID) return contacts[i];
      }
      return null;
    }

    function characterContact(state) {
      var contacts = safeArray(state && state.chats && state.chats.contacts, 10);
      for (var i = 0; i < contacts.length; i += 1) {
        if (String(contacts[i].id) === CORE.PLAYER_CONTACT_ID) return contacts[i];
      }
      return null;
    }

    // 已读游标 = 角色域 yz-player 联系人中玩家侧消息的最高 seq（注入即已读，评审结论）。
    // 负值钳制为 0：脏数据下 seq > cursor 恒真会把未读数全部误计。
    function playerReadCursor(state) {
      return nzero(Number(state && state.sync && state.sync.playerReadCursor)) || 0;
    }

    function maxPlayerSeq(playerState) {
      var thread = playerThread(playerState);
      var max = 0;
      safeArray(thread && thread.messages, 20).forEach(function (message) {
        var n = /^pm-(\d+)$/.exec(String(message && message.id) || '');
        if (n) max = Math.max(max, Number(n[1]) || 0);
      });
      return max;
    }

    // {{user}}：宿主用户身份名（chat.persona.name）；用户身份名缺失时回退本地化文案。
    async function resolvePlayerName() {
      try {
        if (tavoApi.chat && typeof tavoApi.chat.current === 'function') {
          var chat = await Promise.resolve(tavoApi.chat.current());
          var name = chat && chat.persona && chat.persona.name;
          if (hasText(name)) return cleanText(name, 120);
        }
      } catch (error) { dbg('player name resolve failed', error); }
      return I18N.dict().playerFallbackName;
    }

    function characterThreadName(state) {
      return CORE.hasText(state.sync && state.sync.roleName) ? state.sync.roleName : I18N.dict().playerThreadFallback;
    }

    // 玩家传讯的未读数由客户端维护：seq > 已读游标的 other（玩家侧）消息数。
    // 模型输出不得改动；模型自己的回复（side=self）不计入未读。
    function refreshPlayerContact(state, contact) {
      var cursor = playerReadCursor(state);
      var unread = 0;
      var latest = 0;
      var last = null;
      // 未读与游标扫全量消息：头部切片会在超过 20 条时漏计/回退。
      safeArray(contact && contact.messages, 100).forEach(function (message) {
        if (!message) return;
        var n = /^pm-(\d+)$/.exec(String(message.id) || '');
        if (n) {
          var seq = Number(n[1]) || 0;
          latest = Math.max(latest, seq);
          if (message.side === 'other' && seq > cursor) unread += 1;
        }
        last = message;
      });
      contact.unread = unread;
      if (last) {
        contact.preview = last.text || '';
        contact.time = last.time || '';
      }
    }

    // 双向对齐：① 玩家已发送的传讯补投角色域（幂等，历史重建/清空后数据仍存续）；
    // ② 角色回复（模型产出的 self 消息）镜像回玩家域会话线程；③ 刷新未读数/预览。
    // 通道只在消息功能启用时工作——封印 msg 后不再注入/镜像，双方各自保留已有数据。
    // 并发安全：所有 await 都发生在检查/变更之前——检查联系人是否存在与创建必须
    // 在同一同步段内完成，否则并发调用（send 的内部调用 + 显式调用）会创建重复联系人。
    async function syncPlayerChannel(chatId) {
      chatId = CORE.cleanText(chatId || activeChatId, 160);
      if (chatId !== activeChatId) return false;
      var flags = getFlags() || {};
      if (flags.msg === false) return false;
      var state = current();
      var player = playerCurrent();
      var thread = playerThread(player);
      if (!thread) return false;
      // 唯一 await：玩家名解析（{{user}}），必须先于一切状态变更。
      var name = await resolvePlayerName();
      // await 期间可能已切换聊天/新轮次替换了状态对象：以当前对象为准，放弃陈旧快照，
      // 否则旧 state 的 save 会覆盖新数据。
      if (chatId !== activeChatId || state !== current() || player !== playerCurrent()) return false;
      var contact = characterContact(state);
      var changed = false;
      if (!contact) {
        contact = { id: CORE.PLAYER_CONTACT_ID, name: name, relation: I18N.dict().playerRelation, time: '', unread: 0, preview: '', messages: [] };
        state.chats.contacts.push(contact);
        changed = true;
      }
      var contactChanged = false;
      if (contact.name !== name || (contact.relation || '') !== I18N.dict().playerRelation) {
        contact.name = name;
        contact.relation = I18N.dict().playerRelation;
        contactChanged = true;
      }
      // known 集合必须覆盖全部既有消息：只扫头部 20 条会在线程超过 20 条后（尾部截断前的
      // 窗口内镜像批次）把旧 id 误判为未知而重复 push。推送后保尾截断，与角色域 normalize
      // 同策略——新消息永远在场，最旧淘汰。
      var known = {};
      safeArray(contact.messages, 100).forEach(function (message) { known[String(message && message.id)] = true; });
      safeArray(thread.messages, 100).forEach(function (message) {
        if (!message || message.side !== 'self') return;
        if (known[String(message.id)]) return;
        contact.messages.push({ id: cleanText(message.id, 160), side: 'other', time: cleanText(message.time, 80), text: cleanText(message.text, 3000) });
        known[String(message.id)] = true;
        contactChanged = true;
      });
      // 内容对账：全量轮模型可能改写/捏造已投递的玩家消息（pm-*）——以玩家域为源
      // 逐条还原 side/time/text；玩家域已不存在的 pm-N（序号超过玩家已发最大序号）
      // 是模型伪造（玩家从未发过），直接删除；被玩家线程保尾裁剪的合法历史保留。
      var maxPlayerSeq = 0;
      safeArray(thread.messages, 100).forEach(function (m) {
        var m2 = m && /^pm-(\d+)$/.exec(String(m.id) || '');
        if (m2 && m.side === 'self') maxPlayerSeq = Math.max(maxPlayerSeq, Number(m2[1]) || 0);
      });
      var forged = [];
      safeArray(contact.messages, 100).forEach(function (message, index) {
        var mm = /^pm-(\d+)$/.exec(String(message && message.id) || '');
        if (!mm) return;
        var source = null;
        safeArray(thread.messages, 100).forEach(function (m) {
          if (m && m.side === 'self' && String(m.id) === String(message.id)) source = m;
        });
        if (!source) {
          if ((Number(mm[1]) || 0) > maxPlayerSeq) forged.push(index);
          return;
        }
        if (message.side !== 'other' || message.text !== source.text || message.time !== source.time) {
          message.side = 'other';
          message.time = cleanText(source.time, 80);
          message.text = cleanText(source.text, 3000);
          contactChanged = true;
        }
      });
      forged.reverse().forEach(function (index) {
        contact.messages.splice(index, 1);
        contactChanged = true;
      });
      if (contactChanged) {
        if (contact.messages.length > 20) contact.messages = tail(contact.messages, 20);
        refreshPlayerContact(state, contact);
        changed = true;
      }
      // 角色 → 玩家：镜像角色回复（回复 = 角色域普通协议数据，玩家域只读展示）。
      var mirrorKnown = {};
      safeArray(thread.messages, 100).forEach(function (message) { mirrorKnown[String(message && message.id)] = true; });
      var mirrored = false;
      safeArray(contact.messages, 100).forEach(function (message) {
        if (!message || message.side !== 'self') return;
        if (mirrorKnown[String(message.id)]) return;
        thread.messages.push({ id: cleanText(message.id, 160), side: 'other', time: cleanText(message.time, 80), text: cleanText(message.text, 3000), reply: true });
        mirrorKnown[String(message.id)] = true;
        mirrored = true;
        // 角色新回复进线程即计未读：列表行与玩家域主页徽标据此亮角标（打开线程/发讯时清零）。
        thread.unread = nzero(thread.unread) + 1;
      });
      if (mirrored) {
        thread.name = characterThreadName(state);
        if (thread.messages.length > 20) {
          thread.messages = tail(thread.messages, 20);
          thread.archived = true;
        }
        if (thread.messages.length) {
          var lastMessage = thread.messages[thread.messages.length - 1];
          thread.preview = lastMessage.text || '';
          thread.time = lastMessage.time || '';
        }
        changed = true;
      }

      if (changed) {
        player.updatedAt = Date.now();
        save(chatId, state);
        savePlayer(chatId, player);
      }
      return changed;
    }

    // 已读游标推进：generation:prepare 注入基线后调用（注入即已读）。
    // 推进后重算 yz-player 未读数；游标只进不退。只计玩家侧消息（side=other），
    // 模型自回复的 pm-N（即便存在）不推进游标，避免吞掉玩家后续真未读。
    function markPlayerRead(chatId) {
      chatId = CORE.cleanText(chatId || activeChatId, 160);
      if (chatId !== activeChatId) return;
      var state = current();
      var contact = characterContact(state);
      var cursor = playerReadCursor(state);
      var latest = cursor;
      safeArray(contact && contact.messages, 100).forEach(function (message) {
        var n = /^pm-(\d+)$/.exec(String(message && message.id) || '');
        if (n && message && message.side === 'other') latest = Math.max(latest, Number(n[1]) || 0);
      });
      if (latest <= cursor) return;
      state.sync.playerReadCursor = latest;
      if (contact) refreshPlayerContact(state, contact);
      save(chatId, state);
    }

    // 玩家发讯：写入玩家域会话线程 + 立即投递角色域（异步落盘，不阻塞 UI）。
    // 返回 { id, seq } 摘要；消息 id 按 seq 幂等，重复调用不产生重复行（镜像按 id 去重）。
    function sendPlayerMessage(chatId, text) {
      text = cleanText(String(text == null ? '' : text), 3000);
      if (!hasText(text)) return null;
      chatId = CORE.cleanText(chatId || activeChatId, 160);
      if (chatId !== activeChatId) return null;
      var state = current();
      var player = playerCurrent();
      var thread = playerThread(player);
      if (!thread) {
        thread = { id: CORE.PLAYER_THREAD_ID, name: characterThreadName(state), relation: '', time: '', unread: 0, preview: '', messages: [] };
        player.chats.contacts.push(thread);
      }
      var seq = maxPlayerSeq(player) + 1;
      var message = { id: 'pm-' + seq, side: 'self', time: formatDateTime(Date.now()), text: text };
      thread.messages.push(message);
      if (thread.messages.length > 20) {
        thread.messages = tail(thread.messages, 20);
        // 超限截断要有痕迹：标记「更早传讯已归档」，UI 在会话顶部展示，否则旧消息悄悄消失。
        thread.archived = true;
      }
      thread.preview = text;
      thread.time = message.time;
      // 玩家自己发讯视为已读当前线程（回复未读清零）。
      thread.unread = 0;
      player.updatedAt = Date.now();
      savePlayer(chatId, player);
      syncPlayerChannel(chatId);
      return { id: message.id, seq: seq };
    }

    // 玩家群聊发言：源数据写入玩家域群组（id=pmg-<n> 确定性幂等），立即镜像进角色域
    // 群组（sender=玩家名，镜像为 side=other 的对方消息）。群聊是公开数据，玩家域渲染角色域群组——消息
    // 进场后玩家域群聊详情立即可见；模型在后续轮次以普通 gmsg 自然回复。
    function sendPlayerGroupMessage(chatId, groupId, text) {
      text = cleanText(String(text == null ? '' : text), 3000);
      if (!hasText(text)) return null;
      chatId = CORE.cleanText(chatId || activeChatId, 160);
      groupId = CORE.cleanText(groupId, 160);
      if (chatId !== activeChatId || !groupId) return null;
      var player = playerCurrent();
      var group = null;
      safeArray(player.chats && player.chats.groups, 6).forEach(function (g) { if (g && String(g.id) === groupId) group = g; });
      if (!group) {
        var groupName = '';
        safeArray(current().chats.groups, 6).forEach(function (g) { if (g && String(g.id) === groupId) groupName = CORE.cleanText(g.name, 120); });
        group = { id: groupId, name: groupName, time: '', unread: 0, preview: '', messages: [] };
        player.chats.groups = safeArray(player.chats.groups, 6).concat([group]);
      }
      var seq = 0;
      safeArray(player.chats.groups, 6).forEach(function (g) {
        safeArray(g && g.messages, 24).forEach(function (m) {
          var n = /^pmg-(\d+)$/.exec(String(m && m.id) || '');
          if (n) seq = Math.max(seq, Number(n[1]) || 0);
        });
      });
      var message = { id: 'pmg-' + (seq + 1), side: 'self', time: formatDateTime(Date.now()), text: text };
      group.messages = safeArray(group.messages, 24).concat([message]);
      if (group.messages.length > 24) {
        group.messages = tail(group.messages, 24);
        group.archived = true;
      }
      group.preview = text;
      group.time = message.time;
      player.updatedAt = Date.now();
      savePlayer(chatId, player);
      syncPlayerGroups(chatId);
      return { id: message.id, seq: seq + 1 };
    }

    // 玩家群聊消息镜像（玩家 → 角色）：按 id 幂等合并进角色域群组；玩家已发言的
    // 群组在角色域缺失时重建（保护玩家真实发言）。模型不得删改 pmg-* 行（diffChats
    // 门禁），回复用普通 gmsg 新 id——回复留在角色域群组，玩家域渲染即见。
    async function syncPlayerGroups(chatId) {
      chatId = CORE.cleanText(chatId || activeChatId, 160);
      if (chatId !== activeChatId) return false;
      var flags = getFlags() || {};
      if (flags.msg === false) return false;
      var state = current();
      var player = playerCurrent();
      var sources = safeArray(player.chats && player.chats.groups, 6).filter(function (g) {
        return g && g.id && safeArray(g.messages, 24).some(function (m) { return m && /^pmg-/.test(String(m.id) || ''); });
      });
      if (!sources.length) return false;
      var name = await resolvePlayerName();
      if (chatId !== activeChatId || state !== current() || player !== playerCurrent()) return false;
      var changed = false;
      sources.forEach(function (source) {
        var group = null;
        safeArray(state.chats.groups, 6).forEach(function (g) { if (g && String(g.id) === String(source.id)) group = g; });
        if (!group) {
          group = { id: CORE.cleanText(source.id, 160), name: CORE.cleanText(source.name, 120), members: 0, time: '', unread: 0, preview: '', messages: [] };
          state.chats.groups.push(group);
          changed = true;
        }
        var known = {};
        // 注意不能用 safeArray 截断到 24 遍历：数组超 24 时尾部消息会变成"未镜像"
        // 而触发重插（pmg 漂移成最新消息）。known 必须覆盖全部现有 id。
        group.messages.forEach(function (m) { known[String(m && m.id)] = true; });
        safeArray(source.messages, 24).forEach(function (m) {
          if (!m || m.side !== 'self' || !/^pmg-/.test(String(m.id) || '')) return;
          if (known[String(m.id)]) return;
          var mirror = { id: CORE.cleanText(m.id, 160), sender: name, side: 'other', time: CORE.cleanText(m.time, 80), text: CORE.cleanText(m.text, 3000) };
          // 插入位置：优先按 pmg 序号锚点（保持玩家发言的相对顺序）；角色域没有
          // 任何 pmg 锚点时才追加尾部（玩家首次发言/新群组，此时确实是最新消息）。
          // 不按尾追加是因为模型漏抄/重建后丢失的历史发言会因此被顶成"最新消息"。
          var seqNum = 0;
          var seqMatch = /^pmg-(\d+)$/.exec(String(m.id));
          if (seqMatch) seqNum = Number(seqMatch[1]) || 0;
          var lastLower = -1;
          var firstUpper = -1;
          group.messages.forEach(function (x, i) {
            var xm = /^pmg-(\d+)$/.exec(String(x && x.id) || '');
            if (!xm) return;
            var s = Number(xm[1]) || 0;
            if (s < seqNum) lastLower = i;
            else if (s > seqNum && firstUpper < 0) firstUpper = i;
          });
          if (lastLower >= 0) group.messages.splice(lastLower + 1, 0, mirror);
          else if (firstUpper >= 0) group.messages.splice(firstUpper, 0, mirror);
          else group.messages.push(mirror);
          known[String(m.id)] = true;
          changed = true;
        });
        if (group.messages.length > 24) {
          // 保尾 24，但玩家真实发言（pmg-*）豁免裁剪、保留原位：被裁掉的 pmg 会在
          // 下一轮镜像补回时变成"最新消息"（追加尾部），顺序永久错乱。
          var drop = group.messages.length - 24;
          var kept = [];
          var dropped = 0;
          group.messages.forEach(function (mm) {
            if (!/^pmg-/.test(String(mm && mm.id) || '')) {
              if (dropped < drop) { dropped += 1; return; }
            }
            kept.push(mm);
          });
          group.messages = kept.length > 24 ? tail(kept, 24) : kept;
        }
      });
      if (changed) {
        state.chats = CORE.normalizeChats(state.chats);
        state.updatedAt = Date.now();
        save(chatId, state);
      }
      return changed;
    }

    // 玩家论坛评论：源数据写入玩家域 myComments（id=pmc-<n> 确定性幂等），经
    // syncPlayerPosts 镜像进角色域帖子（公开数据）。模型在后续轮次以 +comment 自然
    // 回复；模型不得删改 pmc-* 评论（diffForum 门禁）。
    function sendPlayerComment(chatId, postId, text) {
      text = cleanText(String(text == null ? '' : text), 3000);
      if (!hasText(text)) return null;
      chatId = CORE.cleanText(chatId || activeChatId, 160);
      postId = CORE.cleanText(postId, 160);
      if (chatId !== activeChatId || !postId) return null;
      var player = playerCurrent();
      var seq = 0;
      safeArray(player.myComments, 40).forEach(function (c) {
        var n = /^pmc-(\d+)$/.exec(String(c && c.id) || '');
        if (n) seq = Math.max(seq, Number(n[1]) || 0);
      });
      var comment = { postId: postId, id: 'pmc-' + (seq + 1), time: formatDateTime(Date.now()), text: text };
      // 保尾截断：与角色域评论窗口一致，避免第 41 条恰好落在 syncPlayerPosts 的
      // 40 条截断之外不被镜像（重载后才消失）。
      player.myComments = tail(safeArray(player.myComments, 40).concat([comment]), 40);
      player.updatedAt = Date.now();
      savePlayer(chatId, player);
      syncPlayerPosts(chatId);
      return { id: comment.id, seq: seq + 1 };
    }

    // ---------- 玩家域 CRUD（folder/note/item/currency/order/post）：玩家直写，不经模型评估 ----------
    // kind ∈ folder/note/item/currency/order。写入前校验必填，落盘走后台队列。
    // 返回 { ok: true } 或 { ok: false, reason }（reason 供 UI 翻译为提示文案）。
    function playerSaveEntity(kind, raw, existingId) {
      kind = cleanText(kind, 20);
      raw = raw || {};
      existingId = String(existingId == null ? '' : existingId);
      var player = playerCurrent();
      var reason = '';
      function fail() { return { ok: false, reason: reason }; }

      if (kind === 'folder') {
        var name = cleanText(raw.name, 120);
        if (!hasText(name)) reason = 'name';
        if (reason) return fail();
        // 校验通过后才变更对象：失败路径不得留下已改坏/空必填的实体，
        // 否则下一次 normalize 会整行丢弃并级联其下数据。
        var folder = CORE.playerFindEntity(player, 'folder', existingId);
        if (folder) folder.name = name;
        // safeArray 返回副本：新建必须把拼接结果写回状态，否则 push 在副本上丢失。
        else player.notes.folders = safeArray(player.notes.folders, 10).concat([{ id: CORE.playerNextId(player.notes.folders, 'pf-'), name: name, count: 0 }]);
        player.notes = CORE.normalizeNotes(player.notes);
      } else if (kind === 'note') {
        var title = cleanText(raw.title, 200);
        var body = cleanText(raw.body, 3000);
        var folderId = cleanText(raw.folderId, 160);
        if (!hasText(title)) reason = 'title';
        var folderOk = safeArray(player.notes.folders, 10).some(function (f) { return String(f.id) === String(folderId); });
        if (!folderOk) reason = 'folder';
        if (reason) return fail();
        var note = CORE.playerFindEntity(player, 'note', existingId);
        if (note) {
          note.title = title;
          note.body = body;
          note.locked = !!raw.locked;
        } else {
          player.notes.notes = safeArray(player.notes.notes, 30).concat([{ id: CORE.playerNextId(player.notes.notes, 'pn-'), folderId: folderId, updated: formatDateTime(Date.now()), locked: !!raw.locked, title: title, body: body }]);
        }
        player.notes = CORE.normalizeNotes(player.notes);
      } else if (kind === 'item') {
        var iname = cleanText(raw.name, 120);
        if (!hasText(iname)) reason = 'name';
        if (reason) return fail();
        var item = CORE.playerFindEntity(player, 'item', existingId);
        if (item) {
          item.name = iname;
          item.qty = Math.max(0, Number(raw.qty) || 0);
          item.grade = cleanText(raw.grade, 60);
          item.desc = cleanText(raw.desc, 3000);
        } else player.space.items = safeArray(player.space.items, 30).concat([{ id: CORE.playerNextId(player.space.items, 'pi-'), name: iname, qty: Math.max(0, Number(raw.qty) || 0), grade: cleanText(raw.grade, 60), desc: cleanText(raw.desc, 3000) }]);
        player.space = CORE.normalizeSpace(player.space);
      } else if (kind === 'currency') {
        var ckind = cleanText(raw.kind, 60);
        if (!hasText(ckind)) reason = 'kind';
        // 重命名撞已有种类：目标种类已存在时拒绝（kind 是唯一键，否则出现重复行）。
        if (!reason) {
          var clash = safeArray(player.space.currencies, 10).some(function (c) { return String(c.kind) === ckind && String(c.kind) !== existingId; });
          if (clash) reason = 'kindClash';
        }
        if (reason) return fail();
        // 种类是唯一键：重命名 = 移除旧种类 + 写入新种类（upsert 语义）。
        player.space.currencies = safeArray(player.space.currencies, 10).filter(function (c) { return String(c.kind) !== existingId; }).concat([{ kind: ckind, amount: cleanText(raw.amount, 80) }]);
        player.space = CORE.normalizeSpace(player.space);
      } else if (kind === 'order') {
        var oname = cleanText(raw.name, 120);
        if (!hasText(oname)) reason = 'name';
        if (reason) return fail();
        var order = CORE.playerFindEntity(player, 'order', existingId);
        var side = /^(sell|卖|售)/i.test(String(raw.side)) ? 'sell' : 'buy';
        if (order) {
          order.name = oname;
          order.status = cleanText(raw.status, 40);
          order.price = cleanText(raw.price, 80);
          order.side = side;
        } else player.market.orders = safeArray(player.market.orders, 12).concat([{ id: CORE.playerNextId(player.market.orders, 'po-'), name: oname, status: cleanText(raw.status, 40), price: cleanText(raw.price, 80), time: formatDateTime(Date.now()), side: side }]);
        player.market = CORE.normalizeMarket(player.market);
      } else if (kind === 'post') {
        // 玩家发帖（三期）：owner=player 的论坛帖子，源数据在玩家域，经 syncPlayerPosts
        // 镜像进角色域（公开数据）。作者名由镜像异步解析 {{user}} 后回填。
        var ptitle = cleanText(raw.title, 200);
        if (!hasText(ptitle)) reason = 'title';
        if (reason) return fail();
        var post = CORE.playerFindEntity(player, 'post', existingId);
        if (post) {
          post.title = ptitle;
          post.section = cleanText(raw.section, 60);
          post.body = cleanText(raw.body, 3000);
          post.time = formatDateTime(Date.now());
        } else {
          player.forum.posts = safeArray(player.forum.posts, 20).concat([{ id: CORE.playerNextId(player.forum.posts, 'fp-'), owner: 'player', author: '', role: '', section: cleanText(raw.section, 60), time: formatDateTime(Date.now()), title: ptitle, body: cleanText(raw.body, 3000), resonance: 0, comments: [] }]);
        }
        player.forum = CORE.normalizeForum(player.forum);
      } else {
        return { ok: false, reason: 'kind' };
      }

      player.updatedAt = Date.now();
      savePlayer(activeChatId, player);
      // 帖子需镜像进角色域（公开数据）才能出现在合并视图：返回 Promise 由 UI await，
      // 镜像完成后再返回/重渲染，避免「保存成功但列表看不到新帖」的竞态。
      if (kind === 'post') {
        var mirrorPromise = null;
        try { mirrorPromise = syncPlayerPosts(activeChatId); } catch (_) {}
        if (mirrorPromise && typeof mirrorPromise.then === 'function') {
          return Promise.resolve(mirrorPromise).then(function () { return { ok: true }; }, function () { return { ok: true }; });
        }
      }
      return { ok: true };
    }

    // 玩家域实体删除：玉册夹删除级联其下备忘；货币按种类删除。找不到返回失败。
    function playerDeleteEntity(kind, id) {
      kind = cleanText(kind, 20);
      id = String(id == null ? '' : id);
      var player = playerCurrent();
      if (!CORE.playerFindEntity(player, kind, id)) return { ok: false, reason: 'missing' };
      if (kind === 'folder') {
        player.notes.folders = safeArray(player.notes.folders, 10).filter(function (f) { return String(f.id) !== id; });
        player.notes.notes = safeArray(player.notes.notes, 30).filter(function (n) { return String(n.folderId) !== id; });
        player.notes = CORE.normalizeNotes(player.notes);
      } else if (kind === 'note') {
        player.notes.notes = safeArray(player.notes.notes, 30).filter(function (n) { return String(n.id) !== id; });
        player.notes = CORE.normalizeNotes(player.notes);
      } else if (kind === 'item') {
        player.space.items = safeArray(player.space.items, 30).filter(function (i) { return String(i.id) !== id; });
      } else if (kind === 'currency') {
        player.space.currencies = safeArray(player.space.currencies, 10).filter(function (c) { return String(c.kind) !== id; });
      } else if (kind === 'order') {
        player.market.orders = safeArray(player.market.orders, 12).filter(function (o) { return String(o.id) !== id; });
      } else if (kind === 'post') {
        player.forum.posts = safeArray(player.forum.posts, 20).filter(function (p) { return String(p.id) !== id; });
      } else {
        return { ok: false, reason: 'kind' };
      }
      player.updatedAt = Date.now();
      savePlayer(activeChatId, player);
      if (kind === 'post') syncPlayerPosts(activeChatId);
      return { ok: true };
    }

    // 撤销删除：把删除前快照的实体插回玩家域（幂等：id 已存在则跳过）。
    // 玉册夹级联删掉其下备忘，快照一并带回（notes 参数）；帖子需重新镜像进角色域。
    function playerRestoreEntity(kind, snapshot) {
      kind = cleanText(kind, 20);
      snapshot = snapshot || {};
      var entity = snapshot.entity;
      if (!entity) return { ok: false, reason: 'missing' };
      var player = playerCurrent();
      // 唯一键：货币按种类（kind），其余按 id。不能对非货币实体做 kind 比对——
      // 两者都是 undefined 时会误判「已存在」而跳过恢复。
      function upsertInto(getter, setter) {
        var list = getter();
        var exists = list.some(function (x) {
          return kind === 'currency' ? String(x && x.kind) === String(entity.kind) : String(x && x.id) === String(entity.id);
        });
        if (!exists) setter(list.concat([entity]));
      }
      if (kind === 'folder') {
        upsertInto(function () { return safeArray(player.notes.folders, 10); }, function (v) { player.notes.folders = v; });
        var extraNotes = CORE.safeArray(snapshot.notes, 30);
        if (extraNotes.length) {
          var notes = safeArray(player.notes.notes, 30).filter(function (n) {
            return !extraNotes.some(function (x) { return String(x && x.id) === String(n && n.id); });
          }).concat(extraNotes);
          player.notes.notes = notes.slice(0, 30);
        }
        player.notes = CORE.normalizeNotes(player.notes);
      } else if (kind === 'note') {
        upsertInto(function () { return safeArray(player.notes.notes, 30); }, function (v) { player.notes.notes = v; });
        player.notes = CORE.normalizeNotes(player.notes);
      } else if (kind === 'item') {
        upsertInto(function () { return safeArray(player.space.items, 30); }, function (v) { player.space.items = v; });
      } else if (kind === 'currency') {
        upsertInto(function () { return safeArray(player.space.currencies, 10); }, function (v) { player.space.currencies = v; });
      } else if (kind === 'order') {
        upsertInto(function () { return safeArray(player.market.orders, 12); }, function (v) { player.market.orders = v; });
      } else if (kind === 'post') {
        upsertInto(function () { return safeArray(player.forum.posts, 20); }, function (v) { player.forum.posts = v; });
        player.forum = CORE.normalizeForum(player.forum);
      } else {
        return { ok: false, reason: 'kind' };
      }
      player.updatedAt = Date.now();
      savePlayer(activeChatId, player);
      if (kind === 'post') syncPlayerPosts(activeChatId);
      return { ok: true };
    }

    // 玩家发帖镜像：玩家域帖子（owner=player）幂等同步进角色域论坛（公开数据）并对账——
    // 玩家帖子的标题/正文/版块/作者以玩家域为准（模型全量轮改写或删除会被还原），
    // 角色侧对玩家帖子的评论保留；已删除的玩家帖子从角色域移除。
    // 仅在论坛功能启用时工作；作者名（{{user}}）异步解析后回填双方副本。
    async function syncPlayerPosts(chatId) {
      chatId = CORE.cleanText(chatId || activeChatId, 160);
      if (chatId !== activeChatId) return false;
      var flags = getFlags() || {};
      if (flags.forum === false) return false;
      var state = current();
      var player = playerCurrent();
      var mine = safeArray(player.forum && player.forum.posts, 20);
      var havePlayerRows = safeArray(state.forum && state.forum.posts, 20).some(function (p) { return String(p && p.owner) === 'player'; });
      var myComments = safeArray(player.myComments, 40);
      if (!mine.length && !havePlayerRows && !myComments.length) return false;
      var name = await resolvePlayerName();
      // await 期间可能已切换聊天/新轮次替换了状态对象：放弃陈旧快照，
      // 否则旧 state 的 save 会覆盖新数据（双通道并发已验证会丢帖子）。
      if (chatId !== activeChatId || state !== current() || player !== playerCurrent()) return false;
      var changed = false;
      var hadPlayerRows = false;
      var originals = safeArray(state.forum && state.forum.posts, 20);
      // 撞车防护：角色域已有同 id 的非玩家帖（模型可能复用基线里可见的 fp-* 前缀）——
      // 给玩家帖换一个两边都未占用的新 id（双方同步改名，对账锚点幂等）。
      mine.forEach(function (post) {
        if (!post || !post.id) return;
        var conflict = false;
        originals.forEach(function (p) {
          if (p && String(p.id) === String(post.id) && String(p.owner) !== 'player') conflict = true;
        });
        if (!conflict) return;
        var used = {};
        safeArray(player.forum && player.forum.posts, 20).forEach(function (p) { if (p && p.id) used[String(p.id)] = true; });
        originals.forEach(function (p) { if (p && p.id) used[String(p.id)] = true; });
        var n = 1;
        while (used['fp-' + n]) n += 1;
        post.id = 'fp-' + n;
        player.updatedAt = Date.now();
        changed = true;
      });
      var mineIds = {};
      mine.forEach(function (post) { if (post && post.id) mineIds[String(post.id)] = true; });
      var kept = [];
      originals.forEach(function (post) {
        if (!post) return;
        if (String(post.owner) === 'player') { hadPlayerRows = true; return; }
        // 模型改写剥落了 owner 标记的行也按 id 排除：以玩家域对账结果为准，
        // 避免同 id 两份副本（对账又推一份 = 重复帖）。
        if (mineIds[String(post.id)]) return;
        kept.push(post);
      });
      if (!mine.length && hadPlayerRows) {
        // 玩家已删光自己的帖子：角色域同步移除（玩家帖子行以玩家域为准）。
        state.forum.posts = kept;
        state.forum = CORE.normalizeForum(state.forum);
        state.updatedAt = Date.now();
        save(chatId, state);
        return true;
      }
      mine.forEach(function (post) {
        if (!post || !post.id) return;
        // existing 只认 owner=player 的行（撞车防护已保证玩家帖 id 不被角色帖占用）：
        // 命中即对账更新并保留角色侧评论；未命中（历史重建/清空后）按玩家域插入。
        var existing = null;
        originals.forEach(function (p) { if (p && String(p.id) === String(post.id) && String(p.owner) === 'player') existing = p; });
        if (!existing) {
          kept.push({ id: cleanText(post.id, 160), owner: 'player', author: name, role: cleanText(post.role, 120), section: cleanText(post.section, 60), time: cleanText(post.time, 80), title: cleanText(post.title, 200), body: cleanText(post.body, 3000), resonance: nzero(post.resonance), unread: nzero(post.unread), seen: nzero(post.seen), comments: [] });
          changed = true;
        } else {
          if (existing.owner !== 'player' || existing.title !== post.title || existing.body !== post.body || existing.section !== post.section || existing.author !== name) {
            // 对账：以玩家域为准还原被模型改写的内容（含被剥落的 owner 标记），角色侧评论保留。
            existing.owner = 'player';
            existing.title = cleanText(post.title, 200);
            existing.body = cleanText(post.body, 3000);
            existing.section = cleanText(post.section, 60);
            existing.author = name;
            changed = true;
          }
          kept.push(existing);
        }
        // 玩家侧作者名回填（创建时为空，表单不暴露作者字段）。
        if (post.author !== name) {
          post.author = name;
          player.updatedAt = Date.now();
          changed = true;
        }
      });
      // 我的帖子被评论的未读信号（客户端维护）：玩家帖的已见评论数 = seen，
      // 角色域侧非玩家评论（真实新回复）超过 seen 的部分计为新未读，镜像到角色行与玩家源。
      var unreadChanged = false;
      mine.forEach(function (post) {
        if (!post || !post.id) return;
        var counterpart = null;
        kept.forEach(function (p) { if (p && String(p.id) === String(post.id) && String(p.owner) === 'player') counterpart = p; });
        if (!counterpart) return;
        var replyCount = 0;
        safeArray(counterpart.comments, 20).forEach(function (c) {
          if (c && String(c.owner) !== 'player') replyCount += 1;
        });
        var seen = nzero(post.seen);
        var fresh = Math.max(0, replyCount - seen);
        if (fresh > 0 && nzero(post.unread) + fresh !== nzero(post.unread)) {
          post.unread = Math.min(99, nzero(post.unread) + fresh);
          post.seen = replyCount;
          counterpart.unread = post.unread;
          counterpart.seen = replyCount;
          player.updatedAt = Date.now();
          unreadChanged = true;
        }
      });
      if (unreadChanged) changed = true;
      // 玩家评论源 → 角色域帖子（pmc-* 评论，作者=玩家名）。帖子可能是角色帖子
      //（公开数据）：玩家评论任意可见帖子；幂等去重用双键——id 相同或内容键
      //（作者+时间+内容）相同都视为同一评论。全量轮模型照抄基线时 pmc-* 评论会被
      // parseForum 重编为 cm-N（丢失 owner 标记）：内容键识别这类副本并补回
      // owner=player（重新纳入 pmc-* 门禁保护），同时避免重复推送造成双份。
      var commentsChanged = false;
      myComments.forEach(function (comment) {
        if (!comment || !comment.postId || !comment.id) return;
        var target = null;
        safeArray(state.forum && state.forum.posts, 20).forEach(function (p) { if (p && String(p.id) === String(comment.postId)) target = p; });
        if (!target) return;
        safeArray(target.comments, 20).forEach(function (c) {
          if (c && !c.owner && c.author === name && c.time === comment.time && c.text === comment.text) {
            c.owner = 'player';
            commentsChanged = true;
          }
        });
        var exists = safeArray(target.comments, 20).some(function (c) {
          return c && (String(c.id) === String(comment.id) ||
            (c.author === name && c.time === comment.time && c.text === comment.text));
        });
        if (exists) return;
        target.comments = safeArray(target.comments, 20).concat([{ id: CORE.cleanText(comment.id, 160), owner: 'player', author: name, time: CORE.cleanText(comment.time, 80), text: CORE.cleanText(comment.text, 3000) }]);
        if (target.comments.length > 20) target.comments = tail(target.comments, 20);
        commentsChanged = true;
      });
      if (commentsChanged) {
        state.forum = CORE.normalizeForum(state.forum);
        state.updatedAt = Date.now();
        changed = true;
      }
      if (changed) {
        state.forum.posts = kept;
        state.forum = CORE.normalizeForum(state.forum);
        state.updatedAt = Date.now();
        save(chatId, state);
        savePlayer(chatId, player);
      }
      return changed;
    }

    async function applyText(text, chatId, source) {
      chatId = CORE.cleanText(chatId || activeChatId, 160);
      if (chatId !== activeChatId) return { changed: false, stale: true, applied: false };
      var state = current();
      var snapshots = PROTOCOL.extractSnapshots(text);
      if (!snapshots.length) {
        if (/<yz_[a-z0-9_]+\b/i.test(String(text || ''))) {
          state.sync = Object.assign({}, state.sync, { status: state.revision ? state.sync.status : 'invalid', lastError: 'parse-error', lastSource: source || '', updatedAt: Date.now() });
          state.updatedAt = Date.now();
          save(chatId, state);
        }
        return { changed: false, stale: false, applied: false, parseError: state.sync.lastError === 'parse-error' };
      }
      var applied = applySnapshotsToState(state, snapshots, source);
      chats[chatId] = applied.state;
      // 重复投递的轮次不重复落盘；解析失败标记需持久化，重开后仍可见。
      if (applied.changed || applied.state.sync.lastError === 'parse-error') save(chatId, applied.state);
      // 跨域通道：角色回复（self 消息）与玩家发帖落盘后分别镜像回玩家域/角色域。
      if (applied.changed) await syncPlayerChannel(chatId);
      if (applied.changed) await syncPlayerGroups(chatId);
      if (applied.changed) await syncPlayerPosts(chatId);
      return {
        changed: applied.changed,
        stale: false,
        oversized: applied.oversized === true,
        // 本轮是否为「达标的全量轮」：声明非 part/diff（mode 字段缺失时按 full 处理）
        // 且所有已启封分区评估达标；part/diff 轮与部分达标的全量轮不算——
        // 封印切换/版本更新后的重同步必须等真正达标的全量轮才清除强制标记。
        full: (function () { var a = applied.assessment; return !!a && !a.part && !a.diff && a.ok === true; })(),
        applied: CORE.safeArray(applied.state.sync.applied, 10).slice(),
        // 返回 sync 快照而非引用：调用方后续写入状态时不会改变已返回的 assessment。
        assessment: Object.assign({}, applied.state.sync)
      };
    }

    function eventChatId(event) {
      if (!event || typeof event !== 'object') return '';
      if (event.chatId != null && event.chatId !== '') return CORE.cleanText(event.chatId, 160);
      if (typeof event.chat === 'string' || typeof event.chat === 'number') return CORE.cleanText(event.chat, 160);
      if (event.chat && event.chat.id != null) return CORE.cleanText(event.chat.id, 160);
      return '';
    }

    async function resolveCurrentChatId(event) {
      var fromEvent = eventChatId(event);
      if (fromEvent) return fromEvent;
      try {
        var chat = tavoApi.chat && typeof tavoApi.chat.current === 'function' ? await Promise.resolve(tavoApi.chat.current()) : null;
        return CORE.cleanText(chat && chat.id != null ? chat.id : activeChatId, 160);
      } catch (_) { return activeChatId; }
    }

    // 管理页导入：与快照同一条容量红线；normalizeState 负责消毒与字段归一，任何对象都能归一，
    // 因此「无效」只可能是解析失败或超限。
    function importState(raw) {
      var text = String(raw == null ? '' : raw);
      if (text.length > MAX_SNAPSHOT_BYTES) return { ok: false, reason: 'oversized' };
      var parsed = parseStored(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'parse' };
      var state = CORE.normalizeState(parsed, activeChatId);
      if (state.pluginVersion !== PLUGIN_VERSION) {
        state.pluginVersion = PLUGIN_VERSION;
        state.pendingFull = true;
      }
      chats[activeChatId] = state;
      rememberChat(activeChatId);
      evictChats();
      return { ok: true, state: state, saved: save(activeChatId, state) };
    }

    // ---------- 世界书归档：token 预算的召回半边 ----------
    // 基线只注入最近窗口（最新数据），窗口之外的历史消息镜像到插件管理的世界书：
    // 每个联系人/群一个关键词条目，正文提及实体名时 Tavo 才注入其完整归档（相关联的数据）。
    // 基线窗口与世界书归档共用 RECENT_MSG_ROWS 切分，两条通道不重叠、不遗漏。
    var ARCHIVE_NAME_PREFIX = '玉兆档案·';
    var ARCHIVE_ENTRY_CHARS = 6000;
    var ARCHIVE_FOOTER = '\n（只读归档：仅供回忆参考，不要把这些消息重新写入 <yz_jade> 数据块。）';
    var archiveBusy = false;
    var archivePending = '';

    function archiveWindow(messages) {
      var rows = safeArray(messages, 100);
      return rows.length > RECENT_MSG_ROWS ? rows.slice(0, rows.length - RECENT_MSG_ROWS) : [];
    }

    function archiveLines(rows, isGroup) {
      var lines = [];
      rows.forEach(function (message) {
        if (!message || !hasText(message.text)) return;
        var who = message.side === 'self' ? '自己' : (isGroup ? cleanText(message.sender, 120) : '对方');
        lines.push('[' + cleanText(message.time, 80) + '｜' + who + '] ' + cleanText(message.text, 3000));
      });
      return lines;
    }

    // 全状态快照备份：角色域 + 玩家域整份状态分片写入世界书的禁用条目
    // （enabled:false 永不注入，probability 0）。世界书是用户数据、跨设备存续，
    // 是权威存储；本地镜像被清/换设备后由分片快照还原。
    // 分片包装 {v, ver, rev, updatedAt, kind, index, total, body}：body 为状态 JSON
    // 字符串切片，读取时按 index 拼接还原。单片超 SNAP_SHARD_CHARS、单域超过
    // MAX_SNAP_SHARDS 片时放弃快照（状态超出容量，仅诊断提示）。
    function buildSnapshotEntries(state, playerState) {
      var entries = [];
      function shard(kind, serialized, rev, updatedAt) {
        if (!serialized) return;
        var total = Math.ceil(serialized.length / SNAP_SHARD_CHARS);
        if (total < 1) total = 1;
        if (total > MAX_SNAP_SHARDS) { dbg('snapshot exceeds shard cap: ' + serialized.length); return; }
        for (var i = 0; i < total; i += 1) {
          entries.push({
            identifier: (kind === 'player' ? 'yz-psnap-' : 'yz-snap-') + (i + 1),
            name: kind === 'player' ? '玉兆玩家快照' : '玉兆快照',
            content: JSON.stringify({ v: 2, ver: PLUGIN_VERSION, rev: Number(rev) || 0, updatedAt: Number(updatedAt) || 0, kind: kind, index: i + 1, total: total, body: serialized.slice(i * SNAP_SHARD_CHARS, (i + 1) * SNAP_SHARD_CHARS) }),
            enabled: false,
            strategy: 'keyword',
            keywords: [],
            secondaryKeywords: [],
            secondaryKeywordStrategy: 'none',
            scanDepth: 0,
            caseSensitive: false,
            matchWholeWord: false,
            injectionPosition: 'atDepth',
            injectionDepth: 0,
            injectionRole: 'system',
            probability: 0,
            sticky: 0,
            cooldown: 0,
            delay: 0
          });
        }
      }
      if (state && Number(state.revision) >= 1) {
        var roleJson;
        try { roleJson = JSON.stringify(state); } catch (error) { roleJson = null; }
        shard('role', roleJson, state.revision, state.updatedAt);
      }
      var touched = !!playerState && ((Number(playerState.updatedAt) || 0) > 0 ||
        CORE.safeArray(playerState.chats && playerState.chats.contacts, 10).length > 0);
      if (touched) {
        var playerJson;
        try { playerJson = JSON.stringify(playerState); } catch (error) { playerJson = null; }
        shard('player', playerJson, 0, playerState.updatedAt);
      }
      return entries;
    }

    // 纯函数：由 state 构建世界书条目列表（封印交流讯息时不归档；封印舆图时地点名录不归档）。
    function buildArchiveEntries(state) {
      var flags = getFlags();
      var chatsData = safeObject(safeObject(state).chats);
      var entries = [];
      function pushEntry(identifier, title, keywords, header, lines) {
        if (!lines.length || !hasText(keywords[0])) return;
        // 条目内容上限：从最新往前保留，更旧的放弃（归档是召回上下文，不是完整备份）。
        var kept = [];
        var used = header.length;
        for (var i = lines.length - 1; i >= 0; i -= 1) {
          var cost = lines[i].length + 1;
          if (used + cost > ARCHIVE_ENTRY_CHARS) break;
          kept.unshift(lines[i]);
          used += cost;
        }
        if (!kept.length) return;
        entries.push({
          identifier: identifier,
          name: title,
          content: header + '\n' + kept.join('\n') + ARCHIVE_FOOTER,
          enabled: true,
          strategy: 'keyword',
          keywords: keywords,
          secondaryKeywords: [],
          secondaryKeywordStrategy: 'none',
          scanDepth: 4,
          caseSensitive: false,
          matchWholeWord: false,
          injectionPosition: 'atDepth',
          injectionDepth: 2,
          injectionRole: 'system',
          probability: 100,
          sticky: 0,
          cooldown: 0,
          delay: 0
        });
      }
      if (!flags || flags.msg !== false) {
        safeArray(chatsData.contacts, 10).forEach(function (contact) {
          if (!contact || !contact.id || !hasText(contact.name)) return;
          var rows = archiveWindow(contact.messages);
          if (!rows.length) return;
          pushEntry(
            'yz-c-' + cleanText(contact.id, 160),
            '讯息·' + cleanText(contact.name, 120),
            [cleanText(contact.name, 120)],
            '【玉兆·归档讯息】' + cleanText(contact.name, 120) + '（' + cleanText(contact.relation, 120) + '）｜共 ' + rows.length + ' 条早于最近窗口的归档消息（旧→新）：',
            archiveLines(rows, false)
          );
        });
        safeArray(chatsData.groups, 6).forEach(function (group) {
          if (!group || !group.id || !hasText(group.name)) return;
          var rows = archiveWindow(group.messages);
          if (!rows.length) return;
          pushEntry(
            'yz-g-' + cleanText(group.id, 160),
            '群聊·' + cleanText(group.name, 120),
            [cleanText(group.name, 120)],
            '【玉兆·归档群聊】' + cleanText(group.name, 120) + '（' + (Number(group.members) || 0) + ' 人）｜共 ' + rows.length + ' 条早于最近窗口的归档消息（旧→新）：',
            archiveLines(rows, true)
          );
        });
      }
      // 地点名录召回：窗口之外的地点进世界书关键词条目（正文提及地点名时注入完整名录，
      // 与基线窗口共用 RECENT_PLACE_ROWS 切分，两条通道不重叠、不遗漏）。
      if (!flags || flags.map !== false) {
        var mapData = safeObject(safeObject(state).map);
        var mapPlaces = safeArray(mapData.places, 20);
        var archivePlaces = mapPlaces.slice(0, Math.max(0, mapPlaces.length - RECENT_PLACE_ROWS));
        if (archivePlaces.length) {
          pushEntry(
            'yz-map-places',
            '玉兆·地点名录',
            archivePlaces.map(function (place) { return cleanText(place.name, 120); }),
            '【玉兆·地点名录】共 ' + archivePlaces.length + ' 处（旧→新）：',
            archivePlaces.map(function (place) {
              return '[' + cleanText(place.domain, 120) + '] ' + cleanText(place.name, 120) + ' — ' + cleanText(place.desc, 3000);
            })
          );
        }
      }
      return entries;
    }

    // 归档同步：条目全量替换写回插件管理的世界书，并确保挂接到当前聊天。
    // 挂接需读当前世界书列表后合并（chat.update 整体替换，不能覆盖用户自己的世界书）。
    // 全程容错：世界书能力缺失或 API 失败只降级不报错（基线窗口照常工作）。
    async function syncArchive(chatId) {
      chatId = CORE.cleanText(chatId || activeChatId, 160);
      var lore = tavoApi.lorebook;
      if (!lore || typeof lore.find !== 'function' || typeof lore.update !== 'function' || typeof lore.create !== 'function') return { ok: false, reason: 'unavailable' };
      if (!chatId || chatId !== activeChatId) return { ok: false, reason: 'inactive' };
      if (archiveBusy) { archivePending = chatId; return { ok: false, reason: 'busy' }; }
      archiveBusy = true;
      try {
        var state = chats[chatId];
        if (!state) return { ok: false, reason: 'missing' };
        var entries = buildArchiveEntries(state);
        // 快照分片：角色域（rev ≥ 1）+ 玩家域（有数据时），与归档条目同一本原子替换。
        buildSnapshotEntries(state, playerChats[chatId]).forEach(function (entry) { entries.push(entry); });
        // 无可写内容时不触碰已有书：空白/未加载状态不得用空 entries 覆盖权威快照。
        if (!entries.length) return { ok: true, entries: 0 };
        var name = ARCHIVE_NAME_PREFIX + chatId.slice(0, 40);
        var found = [];
        try { found = await Promise.resolve(lore.find(name, { match: 'exact' })); } catch (error) { dbg('lorebook find failed', error); }
        var book = Array.isArray(found) ? found[0] : null;
        var bookId = book ? book.id : null;
        if (bookId == null) {
          try {
            var created = await Promise.resolve(lore.create({ name: name, entries: [] }));
            // create 的返回形状随宿主实现而异（可能直接返回 id，也可能返回整本世界书）：
            // 统一归一为 id，避免把对象当 id 传给 update。
            bookId = created && typeof created === 'object' && created.id != null ? created.id : created;
          } catch (error) { dbg('lorebook create failed', error); }
          if (bookId == null) return { ok: false, reason: 'create-failed' };
        }
        try {
          await Promise.resolve(lore.update({ id: bookId, name: name, entries: entries }));
        } catch (error) {
          dbg('lorebook update failed', error);
          return { ok: false, reason: 'update-failed' };
        }
        var chatApi = tavoApi.chat;
        if (entries.length && chatApi && typeof chatApi.current === 'function' && typeof chatApi.update === 'function') {
          try {
            var chat = await Promise.resolve(chatApi.current());
            // chat.update 只作用于当前聊天：目标不是当前聊天时跳过挂接，下轮重试。
            if (chat && String(chat.id) === String(chatId)) {
              var ids = [];
              safeArray(chat.lorebooks, 50).forEach(function (item) {
                // lorebooks 元素可能是 {id,…} 对象也可能是裸 id 字符串，两种形状都接受。
                var itemId = item && typeof item === 'object' && item.id != null ? item.id : item;
                if (itemId != null) ids.push(itemId);
              });
              var attached = ids.some(function (id) { return String(id) === String(bookId); });
              if (!attached) {
                ids.push(bookId);
                await Promise.resolve(chatApi.update({ lorebooks: ids }));
              }
            }
          } catch (error) { dbg('chat attach failed', error); }
        }
        return { ok: true, entries: entries.length };
      } finally {
        archiveBusy = false;
        if (archivePending) {
          var next = archivePending;
          archivePending = '';
          syncArchive(next);
        }
      }
    }

    return {
      LOCAL_PREFIX: LOCAL_PREFIX,
      PLAYER_LOCAL_PREFIX: PLAYER_LOCAL_PREFIX,
      switchChat: switchChat,
      settle: settle,
      rebuildFromHistory: rebuildFromHistory,
      current: current,
      playerCurrent: playerCurrent,
      applyText: applyText,
      importState: importState,
      syncArchive: syncArchive,
      buildArchiveEntries: buildArchiveEntries,
      buildSnapshotEntries: buildSnapshotEntries,
      eventChatId: eventChatId,
      resolveCurrentChatId: resolveCurrentChatId,
      resolvePlayerName: resolvePlayerName,
      syncPlayerChannel: syncPlayerChannel,
      syncPlayerGroups: syncPlayerGroups,
      syncPlayerPosts: syncPlayerPosts,
      markPlayerRead: markPlayerRead,
      sendPlayerMessage: sendPlayerMessage,
      sendPlayerGroupMessage: sendPlayerGroupMessage,
      sendPlayerComment: sendPlayerComment,
      playerThread: playerThread,
      playerSaveEntity: playerSaveEntity,
      playerDeleteEntity: playerDeleteEntity,
      playerRestoreEntity: playerRestoreEntity,
      saveChat: function (chatId) { return save(chatId, current()); },
      savePlayerChat: function (chatId, player) { return savePlayer(chatId, player); },
      // 玩家帖「已读」：客户端未读游标推进（打开帖子详情时由 UI 调用）。
      // 角色域行 unread 清零由 UI 层直接落盘；此方法推进玩家源 seen 游标，
      // 下次 syncPlayerPosts 按新 seen 计算增量，已读的评论不再重复计未读。
      markPostRead: function (postId) {
        postId = CORE.cleanText(String(postId == null ? '' : postId), 160);
        if (!postId) return;
        var state = current();
        var player = playerCurrent();
        var replyCount = 0;
        CORE.safeArray(state.forum && state.forum.posts, 20).forEach(function (p) {
          if (p && String(p.id) === postId) {
            CORE.safeArray(p.comments, 20).forEach(function (c) { if (c && String(c.owner) !== 'player') replyCount += 1; });
          }
        });
        var post = null;
        CORE.safeArray(player.forum && player.forum.posts, 20).forEach(function (p) { if (p && String(p.id) === postId) post = p; });
        if (!post) return;
        if (post.unread > 0 || nzero(post.seen) !== replyCount) {
          post.unread = 0;
          post.seen = replyCount;
          player.updatedAt = Date.now();
          savePlayer(activeChatId, player);
        }
      },
      cachedChatIds: function () { return lru.slice(); },
      get activeChatId() { return activeChatId; }
    };
  }

  var RUNTIME = {
    createRuntime: createRuntime
  };

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

  // 当前数据基线：把 state 按协议行语法序列化进 yzc_ 容器（内部标签与行语法同输出格式，
  // 但 section() 只认 yz_ 前缀，基线被复读时不会污染 <yz_jade> 解析）。
  // 多轮对话中模型据此沿用既有 id 与未变化行——重新生成的内容才能与已同步数据关联。
  // 值内的竖线/换行会被清洗，保证行语法合法。封印功能不进基线。
  // 超出最近窗口的旧数据只以 archived 行出现（正文不注入），完整历史在世界书归档中按关键词召回。
  function buildCurrent(state, flags, rng) {
    function on(id) { return !flags || flags[id] !== false; }
    function v(value, cap) {
      return cleanText(value, cap || 3000).replace(/[｜|\t\n\r]/g, ' ');
    }
    // archived 行类型不在任何解析器的行白名单里：模型复读基线时它不会被当成数据行，
    // 也无法用 + 行原样重发——它只承载「还有更旧数据存在」这一事实。
    function archived(type, id, summary) {
      return 'archived｜' + type + '｜' + id + '｜' + summary;
    }
    var s = safeObject(state);
    // 条目级采样视图：联系人/群聊/帖子超过上限后每轮只注入采样子集（活跃度加权 +
    // 玩家交互强制包含），隐藏条目完全不出现；渲染/存储/评估/世界书归档不受影响。
    var sample = (on('msg') || on('forum')) ? sampleEntries(s.chats, s.forum, rng) : { contacts: [], groups: [], posts: [] };
    var sections = [];
    function sec(tag) {
      var item = { tag: tag, rows: [] };
      sections.push(item);
      return item;
    }
    if (on('tablet')) {
      var tab = sec('tablet');
      safeArray(safeObject(s.tablet).groups, 10).forEach(function (group) {
        safeArray(group && group.fields, 30).forEach(function (field) {
          var key = v(field && field.key, 60);
          if (!key) return;
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
        var isPlayerContact = String(contact.id) === CORE.PLAYER_CONTACT_ID;
        m.rows.push({ text: 'contact｜' + v(contact.id, 160) + '｜' + v(contact.name, 120) + '｜' + v(contact.relation, 120) + '｜' + v(contact.time, 80) + '｜' + (Number(contact.unread) || 0) + '｜' + v(contact.preview, 300), drop: false });
        var rows = safeArray(contact.messages, 20);
        if (isPlayerContact) {
          // 玩家传讯通道：未读行（seq > 已读游标）最多注入 MAX_PLAYER_UNREAD_ROWS 条全行，
          // 超出部分给一条摘要行；未读行带 last 标记——计入 9000 预算但保留优先级最高（仅极端超限让位）
          // （明细行 → tablet → 归档行 → 未读行，未读行只有前三级全丢仍超限时才让位）。
          var cursor = Number(state.sync && state.sync.playerReadCursor) || 0;
          var unreadRows = [];
          var readRows = [];
          rows.forEach(function (message) {
            if (!message || !message.id) return;
            var seqMatch = /^pm-(\d+)$/.exec(String(message.id));
            var row = { text: 'msg｜' + v(contact.id, 160) + '｜' + v(message.id, 160) + '｜' + v(message.side, 10) + '｜' + v(message.time, 80) + '｜' + v(message.text) };
            // 未读 = 玩家侧消息（side=other）且 seq > 游标；模型自回复（self）不算未读。
            if (seqMatch && message.side === 'other' && (Number(seqMatch[1]) || 0) > cursor) {
              row.last = true;
              unreadRows.push(row);
            } else {
              row.drop = true;
              readRows.push(row);
            }
          });
          var hiddenRead = readRows.length - RECENT_MSG_ROWS;
          if (hiddenRead > 0) m.rows.push({ text: archived('msg', v(contact.id, 160), hiddenRead + ' 条旧消息已归档'), drop: false });
          tail(readRows, RECENT_MSG_ROWS).forEach(function (row) { m.rows.push(row); });
          if (unreadRows.length > CORE.MAX_PLAYER_UNREAD_ROWS) {
            m.rows.push({ text: 'unread｜' + v(contact.id, 160) + '｜' + (unreadRows.length - CORE.MAX_PLAYER_UNREAD_ROWS) + ' 条未读传讯未展开', last: true });
          }
          unreadRows.slice(-CORE.MAX_PLAYER_UNREAD_ROWS).forEach(function (row) { m.rows.push(row); });
          return;
        }
        var hidden = rows.length - RECENT_MSG_ROWS;
        if (hidden > 0) m.rows.push({ text: archived('msg', v(contact.id, 160), hidden + ' 条旧消息已归档'), drop: false });
        tail(rows, RECENT_MSG_ROWS).forEach(function (message) {
          if (!message || !message.id) return;
          m.rows.push({ text: 'msg｜' + v(contact.id, 160) + '｜' + v(message.id, 160) + '｜' + v(message.side, 10) + '｜' + v(message.time, 80) + '｜' + v(message.text), drop: true });
        });
      });
      var groupList = safeArray(chats.groups, 6).filter(function (g) {
        return g && g.id && sample.groups.indexOf(String(g.id)) >= 0;
      });
      groupList.forEach(function (group) {
        if (!group || !hasText(group.name) || !group.id) return;
        m.rows.push({ text: 'group｜' + v(group.id, 160) + '｜' + v(group.name, 120) + '｜' + (Number(group.members) || 0) + '｜' + v(group.time, 80) + '｜' + (Number(group.unread) || 0) + '｜' + v(group.preview, 300), drop: false });
        var rows = safeArray(group.messages, 24);
        // 玩家群聊发言（pmg-*）是真实事件：与传讯未读行同级，恒注入（drop:false，
        // 最多 MAX_PLAYER_GROUP_ROWS 条，超出给归档摘要行）。模型 full 轮必须照抄
        // pmg 行，parse 后玩家消息原位保留——不会因窗口外归档而丢失、被镜像补回
        // 时追加成"最新消息"（顺序错乱）。
        var pmgRows = [];
        var gmRows = [];
        rows.forEach(function (message) {
          if (!message || !message.id) return;
          (/^pmg-/.test(String(message.id)) ? pmgRows : gmRows).push(message);
        });
        var hidden = gmRows.length - RECENT_MSG_ROWS;
        if (hidden > 0) m.rows.push({ text: archived('gmsg', v(group.id, 160), hidden + ' 条旧群消息已归档'), drop: false });
        tail(gmRows, RECENT_MSG_ROWS).forEach(function (message) {
          m.rows.push({ text: 'gmsg｜' + v(group.id, 160) + '｜' + v(message.id, 160) + '｜' + v(message.sender, 120) + '｜' + v(message.side, 10) + '｜' + v(message.time, 80) + '｜' + v(message.text), drop: true });
        });
        if (pmgRows.length > CORE.MAX_PLAYER_GROUP_ROWS) {
          m.rows.push({ text: archived('gmsg', v(group.id, 160), (pmgRows.length - CORE.MAX_PLAYER_GROUP_ROWS) + ' 条更早的玩家发言已归档'), drop: false });
        }
        tail(pmgRows, CORE.MAX_PLAYER_GROUP_ROWS).forEach(function (message) {
          m.rows.push({ text: 'gmsg｜' + v(group.id, 160) + '｜' + v(message.id, 160) + '｜' + v(message.sender, 120) + '｜' + v(message.side, 10) + '｜' + v(message.time, 80) + '｜' + v(message.text), drop: false });
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
        var isPlayerPost = String(post.owner || '') === 'player';
        if (isPlayerPost) {
          // 玩家帖子是真实事件（与传讯未读行同级）：永远全行注入、不归档
          // （drop:false，last 标记仅极端预算场景最后让位，见 buildCurrent 第四轮），
          // 行尾带 owner 字段供模型识别；角色对玩家帖子的评论同全行注入。
          // 行尾带 owner 字段供模型识别；unread = 新回复数（玩家帖恒 0，门禁保护不可改）。
          var rowText = 'post｜' + v(post.id, 160) + '｜' + v(post.author, 120) + '｜' + v(post.role, 120) + '｜' + v(post.section, 60) + '｜' + v(post.time, 80) + '｜' + v(post.title, 200) + '｜' + v(post.body) + '｜' + (Number(post.resonance) || 0) + '｜' + (Number(post.unread) || 0) + '｜player';
          f.rows.push({ text: rowText, drop: false, last: true });
          safeArray(post.comments, 20).forEach(function (comment) {
            if (!comment || !hasText(comment.text)) return;
            f.rows.push({ text: 'comment｜' + v(post.id, 160) + '｜' + v(comment.author, 120) + '｜' + v(comment.time, 80) + '｜' + v(comment.text), drop: false, last: true });
          });
          return;
        }
        // 采样选中的帖子全行注入（帖子级裁剪由采样完成，不再有帖子级 archived 行）；
        // 消息级窗口（评论）保留。
        f.rows.push({ text: 'post｜' + v(post.id, 160) + '｜' + v(post.author, 120) + '｜' + v(post.role, 120) + '｜' + v(post.section, 60) + '｜' + v(post.time, 80) + '｜' + v(post.title, 200) + '｜' + v(post.body) + '｜' + (Number(post.resonance) || 0) + '｜' + (Number(post.unread) || 0), drop: true });
        var comments = safeArray(post.comments, 20);
        var hidden = comments.length - RECENT_COMMENT_ROWS;
        if (hidden > 0) f.rows.push({ text: archived('comment', v(post.id, 160), hidden + ' 条旧评论已归档'), drop: false });
        tail(comments, RECENT_COMMENT_ROWS).forEach(function (comment) {
          if (!comment || !hasText(comment.text)) return;
          f.rows.push({ text: 'comment｜' + v(post.id, 160) + '｜' + v(comment.author, 120) + '｜' + v(comment.time, 80) + '｜' + v(comment.text), drop: true });
        });
      });
    }
    if (on('notes')) {
      var n = sec('notes');
      var notesData = safeObject(s.notes);
      safeArray(notesData.folders, 10).forEach(function (folder) {
        if (!folder || !hasText(folder.name)) return;
        n.rows.push({ text: 'folder｜' + v(folder.id, 160) + '｜' + v(folder.name, 120) + '｜' + (Number(folder.count) || 0), drop: false });
      });
      var noteRows = safeArray(notesData.notes, 30);
      noteRows.forEach(function (note, index) {
        if (!note || !note.id || !note.folderId) return;
        if (index < noteRows.length - RECENT_NOTE_ROWS) {
          n.rows.push({ text: archived('note', v(note.id, 160), v(note.title, 200)), drop: false });
          return;
        }
        n.rows.push({ text: 'note｜' + v(note.id, 160) + '｜' + v(note.folderId, 160) + '｜' + v(note.updated, 80) + '｜' + (note.locked ? 'true' : 'false') + '｜' + v(note.title, 200) + '｜' + v(note.body), drop: true });
      });
    }
    if (on('market')) {
      var k = sec('market');
      var market = safeObject(s.market);
      var listings = safeArray(market.listings, 20);
      listings.forEach(function (item, index) {
        if (!item || !hasText(item.name) || !item.id) return;
        if (index < listings.length - RECENT_LISTING_ROWS) {
          k.rows.push({ text: archived('listing', v(item.id, 160), v(item.name, 120)), drop: false });
          return;
        }
        k.rows.push({ text: 'listing｜' + v(item.id, 160) + '｜' + v(item.name, 120) + '｜' + v(item.grade, 60) + '｜' + v(item.desc) + '｜' + v(item.price, 80) + '｜' + v(item.seller, 120), drop: true });
      });
      var auctions = safeArray(market.auctions, 12);
      auctions.forEach(function (item, index) {
        if (!item || !hasText(item.name) || !item.id) return;
        if (index < auctions.length - RECENT_AUCTION_ROWS) {
          k.rows.push({ text: archived('auction', v(item.id, 160), v(item.name, 120)), drop: false });
          return;
        }
        k.rows.push({ text: 'auction｜' + v(item.id, 160) + '｜' + v(item.name, 120) + '｜' + v(item.grade, 60) + '｜' + v(item.desc) + '｜' + v(item.start, 80) + '｜' + v(item.current, 80) + '｜' + v(item.timeLeft, 80) + '｜' + (Number(item.bids) || 0), drop: true });
      });
      safeArray(market.orders, 12).forEach(function (item) {
        if (!item || !hasText(item.name) || !item.id) return;
        k.rows.push({ text: 'order｜' + v(item.id, 160) + '｜' + v(item.name, 120) + '｜' + v(item.status, 40) + '｜' + v(item.price, 80) + '｜' + v(item.time, 80) + '｜' + v(item.side, 20), drop: false });
      });
      // 求购区：与行情同构的买公告，窗口外给归档摘要行。
      var requests = safeArray(market.requests, 12);
      requests.forEach(function (item, index) {
        if (!item || !hasText(item.name) || !item.id) return;
        if (index < requests.length - RECENT_REQUEST_ROWS) {
          k.rows.push({ text: archived('request', v(item.id, 160), v(item.name, 120)), drop: false });
          return;
        }
        k.rows.push({ text: 'request｜' + v(item.id, 160) + '｜' + v(item.name, 120) + '｜' + v(item.grade, 60) + '｜' + v(item.desc) + '｜' + v(item.price, 80) + '｜' + v(item.author, 120), drop: true });
      });
    }
    if (on('space')) {
      var sp = sec('space');
      var space = safeObject(s.space);
      safeArray(space.currencies, 10).forEach(function (currency) {
        if (!currency || !hasText(currency.kind)) return;
        sp.rows.push({ text: 'currency｜' + v(currency.kind, 60) + '｜' + v(currency.amount, 80), drop: false });
      });
      var items = safeArray(space.items, 30);
      items.forEach(function (item, index) {
        if (!item || !hasText(item.name) || !item.id) return;
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
        mp.rows.push({ text: 'track｜' + v(track.id, 160) + '｜' + v(track.time, 80) + '｜' + v(track.place, 120) + '｜' + v(track.action, 300), drop: false });
      });
      // 地点名录：窗口外给归档摘要行（正文靠世界书关键词召回），窗口内全行注入。
      var places = safeArray(mapData.places, 20);
      places.forEach(function (place, index) {
        if (!place || !place.id || !hasText(place.name)) return;
        if (index < places.length - RECENT_PLACE_ROWS) {
          mp.rows.push({ text: archived('place', v(place.id, 160), v(place.name, 120)), drop: false });
          return;
        }
        mp.rows.push({ text: 'place｜' + v(place.id, 160) + '｜' + v(place.name, 120) + '｜' + v(place.domain, 120) + '｜' + v(place.desc), drop: true });
      });
    }
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
      // 第四轮：归档行也丢光仍超限时，最后丢 last 标记行（玩家传讯未读行、玩家帖子与
      // 其评论，真实事件，仅极端场景让位）。
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
      if (total > MAX_BASELINE_CHARS) {
        sections.forEach(function (item) {
          item.rows.forEach(function (r) {
            if (!r.last && r.text.length > ROW_HARD_CAP && total > MAX_BASELINE_CHARS) {
              total -= r.text.length;
              r.text = r.text.slice(0, ROW_HARD_CAP);
              total += r.text.length;
            }
          });
        });
      }
    }
    var out = [];
    sections.forEach(function (item) {
      var rows = [];
      item.rows.forEach(function (r) { if (r.text) rows.push(r.text); });
      if (!rows.length) return;
      out.push('<yzc_' + item.tag + '>');
      rows.forEach(function (text) { out.push(text); });
      out.push('</yzc_' + item.tag + '>');
    });
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
        ? (en ? '[Yu Zhao | FORCED FULL sync this turn — every enabled section in full, mandatory]' : '【修仙传讯法器·玉兆｜本轮强制全量同步，必须执行】')
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
    // 玩家传讯通道规则：yz-player 联系人是真实事件，只读维护，回复用 +msg 追加。
    // 基线是采样视图：联系人/群聊超过上限后每轮只注入活跃子集。
    if (on('msg')) {
      lines.push(en
        ? '- Player channel: the yz-player contact in the baseline is a real player messaging you from outside the world. Its rows and unread count are maintained by the artifact: never rewrite, delete, copy or recreate that contact, and never invent messages from it. To reply, append one +msg｜yz-player｜new-message-id｜self｜absolute date｜your reply. Group chat messages whose sender is the player (ids like pmg-1) are real statements by the player: never rewrite, delete, forge or recreate them; reply with a normal +gmsg row under your own identity. The baseline is a sampled view: when contacts or groups exceed the limit, only an active subset is injected each round. Entries that are absent from the baseline still exist: never recreate, delete or duplicate them, and never claim in the narrative that they vanished.'
        : '- 传讯通道：基线中 yz-player 联系人是持有玉兆的外界玩家与你的传讯。该联系人的消息与未读数是真实事件，由法器维护：不得改写、删除、复制或新建该联系人，也不得凭空编造其消息。要回复时用 +msg｜yz-player｜新消息id｜self｜绝对时间｜回复内容 追加一行即可。群聊中发送者为玩家（id 形如 pmg-1）的消息是玩家的真实发言：不得改写、删除、伪造或重建，用普通 +gmsg 行以你自己的身份回复即可。基线上未出现的联系人/群聊仍存在（基线是采样视图，每轮只注入活跃子集）：不得重建、删除或复制，也不得在叙事中宣称其消失。');
    }
    // 玩家发帖规则：owner=player 的论坛帖子是玩家的真实发帖，只读维护，可用 +comment 评论。
    // 基线是采样视图：帖子超过上限后每轮只注入活跃子集。
    if (on('forum')) {
      lines.push(en
        ? '- Player posts: forum rows whose owner is player (the trailing field of post rows in the baseline) are real posts by the player. Never rewrite, delete, copy or recreate them, and never invent posts from the player. You may comment on any post, including theirs, with +comment rows. Comments posted by the player (ids like pmc-1) are real statements: never rewrite or delete them; reply with your own +comment rows. The baseline is a sampled view: when posts exceed the limit, only an active subset is injected each round. Posts that are absent from the baseline still exist: never recreate, delete or duplicate them, and never claim in the narrative that they vanished.'
        : '- 玩家发帖：基线中 post 行尾 owner 为 player 的帖子是玩家的真实发帖。不得改写、删除、复制或重建这些帖子，也不得凭空编造玩家的帖子；可以用 +comment 行在任意帖子（包括玩家的）下评论。玩家发布的评论（id 形如 pmc-1）是玩家的真实发言：不得改写或删除，用你自己的 +comment 行回复即可。基线上未出现的帖子仍存在（基线是采样视图，每轮只注入活跃子集）：不得重建、删除或复制，也不得在叙事中宣称其消失。');
    }
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
      ? (en ? 'turn｜unique-turn-id｜character name｜what changed this turn｜full' : 'turn｜本轮唯一ID｜角色名｜本轮变化摘要｜full')
      : (en ? 'turn｜unique-turn-id｜character name｜what changed this turn｜diff' : 'turn｜本轮唯一ID｜角色名｜本轮变化摘要｜diff'));
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
      lines.push(en ? 'Baseline: <yz_current> below is the artifact\'s current data (yzc_ tags are containers only — your output still uses the <yz_jade> format above).' : '基线：<yz_current> 内是法器的当前数据（yzc_ 标签仅为容器，输出仍用上面的 <yz_jade> 格式）。');
      if (!forceFull) {
        lines.push(en ? '- Diff against this baseline: output only the + / - rows for what this turn\'s story changed; never restate unchanged rows;' : '- 对照基线出 diff：本轮剧情影响了哪些行就输出哪些 +/- 行，未变化的行一律不复述；');
        lines.push(en ? '- New ids must not collide with the baseline.' : '- 新增 id 不得与基线冲突。');
      } else {
        lines.push(en ? '- Carry baseline rows over with ids unchanged unless the story changed them; new ids must not collide.' : '- 未受剧情影响的基线行原样沿用、id 一律不变；新增 id 不得与基线冲突。');
        lines.push(en ? '- Forced full rewrite: rows whose time fields are still relative (今日/昨日/明天 etc.) must be rewritten to absolute dates (e.g. 丙午年五月十二 午时) this turn.' : '- 全量重写：基线中时间字段仍为相对表述（今日/昨日 等）的行，本轮一律改写为绝对日期（如 丙午年五月十二 午时）。');
      }
      lines.push(en ? '- Baseline data is established fact: neither the story nor <yz_jade> may contradict it.' : '- 基线数据视为既定事实，正文与 <yz_jade> 均不得与之矛盾。');
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

  var PROMPT = { buildPrompt: buildPrompt, buildCurrent: buildCurrent, mutatePrepareEvent: mutatePrepareEvent };

  var FEATURES = [
    { id: 'tablet', glyph: '☰', tone: 'gold', pos: [50, 5], toggleable: true },
    { id: 'msg', glyph: '☱', tone: 'silver', pos: [17, 20], toggleable: true },
    { id: 'notes', glyph: '☲', tone: 'vermilion', pos: [4, 50], toggleable: true },
    { id: 'market', glyph: '☳', tone: 'jade', pos: [17, 80], toggleable: true },
    { id: 'forum', glyph: '☴', tone: 'green', pos: [83, 20], toggleable: true },
    { id: 'space', glyph: '☵', tone: 'azure', pos: [96, 50], toggleable: true },
    { id: 'manage', glyph: '☶', tone: 'rock', pos: [83, 80] },
    { id: 'map', glyph: '☷', tone: 'ocre', pos: [50, 95], toggleable: true }
  ];

  // 悬浮玉佩图标：玉璧形（渐变玉质 + 刻纹环 + 璧孔 + 高光），FAB 与管理页复位行共用。
  var FAB_ICON = '<svg viewBox="0 0 44 44" aria-hidden="true"><defs><radialGradient id="yzJadeFace" cx="34%" cy="28%" r="85%"><stop offset="0%" stop-color="#d6ffe9"/><stop offset="42%" stop-color="#57c49a"/><stop offset="78%" stop-color="#17805d"/><stop offset="100%" stop-color="#0b4632"/></radialGradient></defs><circle cx="22" cy="22" r="20.4" fill="url(#yzJadeFace)" stroke="rgba(215,255,238,.6)" stroke-width="1.4"/><circle cx="22" cy="22" r="14" fill="none" stroke="rgba(238,255,247,.32)" stroke-width=".9" stroke-dasharray="3.2 2.8"/><circle cx="22" cy="22" r="8.2" fill="#06231a" stroke="rgba(190,255,225,.55)" stroke-width="1.3"/><circle cx="14.5" cy="12" r="4.2" fill="rgba(255,255,255,.22)"/></svg>';

  function grouped(tablet, id) {
    var found = null;
    CORE.safeArray(tablet && tablet.groups, 10).forEach(function (g) { if (g.id === id) found = g; });
    return found || null;
  }

  function fieldValue(tablet, groupId, canonicalKey) {
    var group = grouped(tablet, groupId);
    var rows = CORE.safeArray(group && group.fields, 30);
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      if (CORE.keyId(row.key) === canonicalKey) return row.value;
    }
    return '';
  }

  function groupName(id) {
    var t = I18N.dict();
    return t.groups[id] || id;
  }

  // 字段键显示层本地化：键先按 CANONICAL 别名归一到 canonical id，再查显示字典；
  // 未知键（模型自定义字段）回退原文，绝不显示半生不熟的英文键。
  function fieldName(key) {
    var t = I18N.dict();
    var id = keyId(key);
    return (id && t.fields[id]) || String(key == null ? '' : key);
  }

  function syncStatusOf(state) {
    var sync = (state && state.sync) || {};
    var t = I18N.dict();
    var text = t.status[sync.status] || t.status.empty;
    if (sync.lastError === 'parse-error' && state.revision) text = t.status.partial;
    return { status: sync.status || 'empty', text: text };
  }

  // 手工格式化 YYYY-MM-DD HH:mm：不用 toLocaleString——它随系统 locale 漂移，
  // 与界面语言不一致；取本地时区，避免 UTC 展示让非零时区用户看到「消息早 8 小时」。
  function formatDateTime(ms) {
    var n = Number(ms);
    if (!n || !Number.isFinite(n)) return '-';
    var d = new Date(n);
    function pad(x) { return (x < 10 ? '0' : '') + x; }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function snapshotUsage(state) {
    var bytes = 0;
    try { bytes = JSON.stringify(state || {}).length; } catch (_) { bytes = MAX_SNAPSHOT_BYTES; }
    return { bytes: bytes, limit: MAX_SNAPSHOT_BYTES, percent: Math.min(100, (bytes / MAX_SNAPSHOT_BYTES) * 100) };
  }

  function unreadTotal(state) {
    var chats = CORE.safeObject(state && state.chats);
    var sum = 0;
    CORE.safeArray(chats.contacts, 10).forEach(function (c) { sum += Number(c && c.unread) || 0; });
    CORE.safeArray(chats.groups, 6).forEach(function (g) { sum += Number(g && g.unread) || 0; });
    return sum;
  }

  // 卦位三态徽标，互斥优先级：警示 > 未读 > 新；封印态不显示任何徽标。
  function nodeBadge(feature, disabled, state) {
    if (!!feature.toggleable && disabled[feature.id] === false) return null;
    var sync = (state && state.sync) || {};
    var issues = CORE.safeArray(sync.issues, 20);
    for (var i = 0; i < issues.length; i += 1) {
      if (String((issues[i] && issues[i].path) || '').indexOf(feature.id + '.') === 0) return { kind: 'alert' };
    }
    if (feature.id === 'msg') {
      var total = unreadTotal(state);
      if (total > 0) return { kind: 'unread', label: total > 99 ? '99+' : String(total) };
    }
    var seen = CORE.safeArray(sync.appliedSeen, 20);
    if (CORE.safeArray(sync.applied, 10).indexOf(feature.id) >= 0 && seen.indexOf(feature.id) < 0) return { kind: 'new' };
    return null;
  }

  function renderNodes(disabled, state, locked) {
    var t = I18N.dict();
    disabled = disabled || {};
    locked = locked || {};
    return FEATURES.map(function (feature) {
      var name = t.features[feature.id];
      var off = !!feature.toggleable && disabled[feature.id] === false;
      // 玩家域锁定：管理页是角色域本地系统页，玩家域内视觉封印并拦截点击。
      var lockedNode = !!locked[feature.id];
      var cls = 'yz-node t-' + feature.tone + (off || lockedNode ? ' sealed' : '') + (lockedNode ? ' yz-node-locked' : '');
      var badge = (off || lockedNode) ? null : nodeBadge(feature, disabled, state);
      var badgeHtml = '';
      // 标点随语言（zh '，' / en ', '），避免 en 界面泄漏中文标点。
      var sep = tr('runtime.sep.badge');
      var aria = name;
      if (badge) {
        cls += ' b-' + badge.kind;
        if (badge.kind === 'alert') { badgeHtml = '<i class="yz-badge yz-badge-alert">!</i>'; aria = name + sep + t.badge.alert; }
        else if (badge.kind === 'unread') { badgeHtml = '<i class="yz-badge yz-badge-unread">' + CORE.escapeHtml(badge.label) + '</i>'; aria = name + sep + tr('runtime.badge.unread', { n: badge.label }); }
        // 新同步只保留 b-new 呼吸光效，不渲染文字角标，避免遮挡卦名。
        else { aria = name + sep + t.badge.new; }
      }
      // 玩家域锁定 vs 封印的视觉区分：封印 = 灰化「封」字（功能被禁用）；
      // 锁定（管理页仅角色域可用）= 专属金色「锁」徽标 + aria 说明，避免误读为被封印。
      var seal = '';
      if (off) { seal = '<i class="yz-seal">' + CORE.escapeHtml(t.sealGlyph) + '</i>'; }
      else if (lockedNode) { seal = '<i class="yz-seal yz-seal-locked">' + CORE.escapeHtml(t.lockGlyph) + '</i>'; aria = name + sep + t.manageLocked; }
      return '<button type="button" class="' + cls + '" data-action="open-feature" data-feature="' + feature.id + '" style="left:' + feature.pos[0] + '%;top:' + feature.pos[1] + '%" aria-label="' + CORE.escapeHtml(aria) + '"><span class="yz-glyph">' + feature.glyph + '</span><b>' + CORE.escapeHtml(name) + '</b><em>' + CORE.escapeHtml(t.gua[feature.id] || '') + '</em>' + seal + badgeHtml + '</button>';
    }).join('');
  }

  // 玩家域主界面信息：已送达/已回统计（玩家域只读会话的状态反馈）。
  function playerThreadCounts(thread) {
    var messages = CORE.safeArray(thread && thread.messages, 20);
    var delivered = 0;
    var replied = 0;
    messages.forEach(function (message, index) {
      if (!message || message.side !== 'self') return;
      delivered += 1;
      for (var i = index + 1; i < messages.length; i += 1) {
        if (messages[i] && messages[i].side === 'other') { replied += 1; break; }
      }
    });
    return { delivered: delivered, replied: replied };
  }

  function renderHome(state, flags, ui) {
    var t = I18N.dict();
    ui = ui || {};
    var isPlayer = ui.domain === 'player';
    var sync = state.sync || {};
    var st = syncStatusOf(state);
    var hero;
    var footer;
    if (isPlayer) {
      // 玩家域：主界面展示玩家身份与传讯状态（数据只存本机，不经模型）。
      var pname = ui.playerName || t.playerFallbackName;
      var thread = CORE.safeArray(ui.playerState && ui.playerState.chats && ui.playerState.chats.contacts, 10).filter(function (c) {
        return String(c && c.id) === CORE.PLAYER_THREAD_ID;
      })[0];
      var counts = playerThreadCounts(thread);
      // 角色新回复未读：玩家域主页同步行带未读角标（呼吸光效），"等角色回复"可感知。
      var unreadBadge = thread && Number(thread.unread) > 0 ? '<u class="yz-unread">' + CORE.escapeHtml(Number(thread.unread) > 99 ? '99+' : String(thread.unread)) + '</u>' : '';
      hero = '<div class="yz-hero-line"><b>' + CORE.escapeHtml(pname) + '</b><p>' + CORE.escapeHtml(t.playerHomeInfo) + '</p></div>';
      footer = '<div class="yz-sync complete' + (thread && Number(thread.unread) > 0 ? ' yz-unread-row' : '') + '"><i></i><span>' + CORE.escapeHtml(t.playerSentWord + ' ' + counts.delivered + ' · ' + t.playerRepliedWord + ' ' + counts.replied) + unreadBadge + '</span></div>';
    } else {
      hero = '<div class="yz-hero-line"><b>' + CORE.escapeHtml(CORE.hasText(sync.roleName) ? sync.roleName : t.appName) + '</b><p>' + CORE.escapeHtml(sync.summary || t.awaitingSync) + '</p>' +
        // 空数据（从未同步）时给新用户一句「接下来干什么」的行动指引，避免八格卦盘无从下手。
        (sync.status === 'empty' || !CORE.safeArray(state.processedTurns, 1).length
          ? '<em class="yz-home-empty">' + CORE.escapeHtml(t.homeEmpty) + '</em>'
          : '') +
        '</div>';
      footer = '<button type="button" class="yz-sync ' + CORE.escapeHtml(st.status) + '" data-action="sync-detail" data-sync><i></i><span>' + CORE.escapeHtml(st.text) + '</span></button>';
    }
    return '<div class="yz-home" data-home>' +
      '<div class="yz-disc">' +
      '<div class="yz-ring"></div>' +
      renderNodes(flags, state, isPlayer ? { manage: true } : null) +
      '<div class="yz-scroll-ring"></div>' +
      '<button type="button" class="yz-core" data-action="core" aria-label="' + CORE.escapeHtml(t.coreAria) + '"><span class="yz-taiji">☯</span></button>' +
      '</div>' +
      hero +
      footer +
      '</div>';
  }

  // 检索关键词：去空白、统一小写，匹配两端同规一化（中文不受影响）。
  function searchKw(search) {
    return String(search == null ? '' : search).trim().toLowerCase();
  }

  function contains(keyword, value) {
    if (!keyword) return true;
    return String(value == null ? '' : value).toLowerCase().indexOf(keyword) >= 0;
  }

  // 任一字段命中即匹配；keyword 为空时恒匹配。
  function filterMatch(keyword, values) {
    for (var i = 0; i < values.length; i += 1) if (contains(keyword, values[i])) return true;
    return false;
  }

  // 列表页顶部检索框：纯前端过滤，不改动数据。value 非空时渲染清除按钮。
  function searchBox(value) {
    var t = I18N.dict();
    return '<div class="yz-search"><input type="search" data-search-input value="' + CORE.escapeHtml(value || '') +
      '" placeholder="' + CORE.escapeHtml(t.searchPlaceholder) + '" aria-label="' + CORE.escapeHtml(t.searchPlaceholder) + '">' +
      '<button type="button" class="yz-search-clear' + (value ? '' : ' hidden') + '" data-action="clear-search" aria-label="' + CORE.escapeHtml(t.searchClear) + '">×</button></div>';
  }

  function renderTablet(state, search, emptyText) {
    var t = I18N.dict();
    var tablet = state.tablet || CORE.blankTablet();
    var kw = searchKw(search);
    var body = '';
    if (CORE.safeArray(tablet.groups, 10).length) {
      var name = tablet.name || fieldValue(tablet, 'basic', 'name');
      var realm = fieldValue(tablet, 'cult', 'realm');
      body = '<div class="yz-hero"><div class="yz-ava">' + CORE.escapeHtml(String(name || t.avaFallback).slice(0, 1)) + '</div><div><b>' + CORE.escapeHtml(name || t.features.tablet) + '</b><small>' + CORE.escapeHtml(realm || '') + '</small></div></div>';
      // 达标fail-state：六组中未达标的组以占位行呈现（页内看到「缺了什么」），并给部分同步提示。
      var present = {};
      var groupById = {};
      CORE.safeArray(tablet.groups, 10).forEach(function (g) { present[g.id] = true; groupById[g.id] = g; });
      // 与 assessTablet 同口径的缺组判定：基本四必要条件、仪容两项、修为四项、其余内容组至少一条。
      function groupFull(id) {
        var g = groupById[id];
        var fields = CORE.safeArray(g && g.fields, 30);
        var keys = {};
        fields.forEach(function (f) { if (f && f.key) keys[CORE.keyId(f.key) || String(f.key).toLowerCase()] = true; });
        if (id === 'basic') return ['name', 'gender', 'height', 'weight'].every(function (k) { return keys[k]; });
        if (id === 'look') return ['appearance', 'clothing'].every(function (k) { return keys[k]; });
        if (id === 'cult') return ['root', 'body', 'realm', 'status'].every(function (k) { return keys[k]; });
        return fields.length >= 1;
      }
      var pending = GROUP_ORDER.filter(function (id) { return present[id] !== true || !groupFull(id); });
      if (pending.length) body += '<div class="yz-empty yz-readonly-hint">' + CORE.escapeHtml(t.tabletPartial) + '</div>';
      // 缺失或缺内容的组给浅色占位行（待同步），与「检索过滤掉」区分。
      pending.forEach(function (id) {
        if (!kw) body += '<section class="yz-group yz-group-pending"><h3>' + CORE.escapeHtml(groupName(id)) + '</h3><div class="yz-field"><small>' + CORE.escapeHtml(t.tabletPendingGroup) + '</small><p class="yz-dim">—</p></div></section>';
      });
      var groups = GROUP_ORDER.map(function (id) {
        var g = groupById[id] || { id: id, fields: [] };
        return { id: id, fields: CORE.safeArray(g.fields, 30).filter(function (field) {
          // 检索同时命中原始键/显示标签/值：显示层本地化后，用户看到的标签也要可命中。
          return filterMatch(kw, [field.key, fieldName(field.key), field.value]);
        }) };
      });
      groups.forEach(function (group) {
        if (!group.fields.length) return;
        // 组折叠 + 计数：字段多的玉牌页可收起长组；默认展开（<details open>）。
        body += '<details class="yz-group" open><summary><h3>' + CORE.escapeHtml(groupName(group.id)) + '<i class="yz-group-count">' + String(group.fields.length) + '</i></h3></summary>' + group.fields.map(function (field) {
          return '<div class="yz-field"><small>' + CORE.escapeHtml(fieldName(field.key)) + '</small><p>' + CORE.escapeHtml(field.value) + '</p></div>';
        }).join('') + '</details>';
      });
      if (kw && !groups.some(function (g) { return g.fields.length; })) body += '<div class="yz-empty">' + CORE.escapeHtml(t.searchNoMatch) + '</div>';
    } else {
      body = '<div class="yz-empty">' + CORE.escapeHtml(emptyText || t.emptyTablet) + '</div>';
    }
    return '<main class="yz-page-inner" data-marker="tablet">' +
      yzHeader(t.features.tablet) + searchBox(search) + body + '</main>';
  }

  function ava(label, sizeClass) {
    return '<span class="yz-ava' + (sizeClass ? ' ' + sizeClass : '') + '">' + CORE.escapeHtml(String(label || '?').slice(0, 1)) + '</span>';
  }

  function chatRow(t, row, label, extra) {
    var hasUnread = Number(row.unread) > 0;
    var unreadLabel = hasUnread ? (Number(row.unread) > 99 ? '99+' : String(row.unread)) : '';
    var unread = hasUnread ? '<u class="yz-unread">' + CORE.escapeHtml(unreadLabel) + '</u>' : '';
    // 有新回复（未读）的条目：数字徽标 + 呼吸光效（yz-unread-row），并排在最上方。
    return button('navigate', ava(row.name) + '<span class="yz-row-copy"><b>' + CORE.escapeHtml(row.name) + '<i>' + CORE.escapeHtml(row.relation || extra || '') + '</i></b><em>' + CORE.escapeHtml(row.preview || t.awaitingSync) + '</em></span><time>' + CORE.escapeHtml(row.time || '') + unread + '</time>', { view: label, id: row.id }, 'yz-row' + (hasUnread ? ' yz-unread-row' : ''));
  }

  // 有新回复（unread > 0）的条目稳定置顶，其余保持原顺序（渲染层排序，不改数据）。
  function unreadFirst(rows) {
    return rows.sort(function (a, b) {
      return (Number(b.unread) > 0 ? 1 : 0) - (Number(a.unread) > 0 ? 1 : 0);
    });
  }

  function renderChatList(state, nav, search) {
    var t = I18N.dict();
    var chats = CORE.safeObject(state.chats);
    var kw = searchKw(search);
    var view = (nav.view && nav.view !== 'root') ? nav.view : 'chats';
    var body = '';
    var items;
    if (view === 'groups') {
      items = unreadFirst(CORE.safeArray(chats.groups, 6).filter(function (row) {
        return filterMatch(kw, [row.name, row.preview, row.time]);
      })).map(function (row) { return chatRow(t, row, 'gchat', t.labels.membersUnit); });
      if (!items.length) body = '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.groups) + '</div>';
      else body = '<div class="yz-page-list">' + items.join('') + '</div>';
      return '<main class="yz-page-inner" data-marker="msg-groups">' + yzHeader(t.features.msg, true) +
        yzTabs([['chats', t.tabs.contacts], ['groups', t.tabs.groups]], view) + searchBox(search) + body + '</main>';
    }
    items = unreadFirst(CORE.safeArray(chats.contacts, 10).filter(function (row) {
      return filterMatch(kw, [row.name, row.relation, row.preview, row.time]);
    })).map(function (row) { return chatRow(t, row, 'chat', ''); });
    if (!items.length) body = '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.contacts) + '</div>';
    else body = '<div class="yz-page-list">' + items.join('') + '</div>';
    return '<main class="yz-page-inner" data-marker="msg-chats">' + yzHeader(t.features.msg, true) +
      yzTabs([['chats', t.tabs.contacts], ['groups', t.tabs.groups]], view) + searchBox(search) + body + '</main>';
  }

  // 群聊是公开数据（双域同一份角色域数据）。气泡左右按「渲染视角」判定：
  // 角色域：自己发的（side=self 且非玩家消息）在右，其余（含玩家 pmg-* 消息）在左；
  // 玩家域：玩家消息（pmg-*，含镜像后的 side=other）在右，角色消息在左。
  function renderMsgDetail(state, nav, group, search, tag, composerGroupId, playerView, archivedFlag) {
    var t = I18N.dict();
    var chats = CORE.safeObject(state.chats);
    var kw = searchKw(search);
    var rows = group ? CORE.safeArray(chats.groups, 6) : CORE.safeArray(chats.contacts, 10);
    var rowItem = null;
    rows.forEach(function (item) { if (String(item.id) === String(nav.params && nav.params.id)) rowItem = item; });
    if (!rowItem) return '<main class="yz-page-inner" data-marker="' + (group ? 'msg-gchat' : 'msg-chat') + '">' + yzHeader(t.features.msg, false, tag) + '<div class="yz-empty">' + CORE.escapeHtml(group ? t.guards.gchat : t.guards.chat) + '</div></main>';
    var bubbles = CORE.safeArray(rowItem.messages, group ? 24 : 20).filter(function (message) {
      return filterMatch(kw, [message.text, message.sender, message.time]);
    }).map(function (message) {
      var isPlayerMsg = group && /^pmg-/.test(String(message.id || ''));
      var mine = message.side === 'self'
        ? (playerView ? isPlayerMsg : !isPlayerMsg)
        : (playerView && isPlayerMsg);
      var showSender = group && !mine;
      var sender = showSender ? '<b class="yz-sender">' + CORE.escapeHtml(message.sender || (message.side === 'self' ? t.labels.self : '')) + '</b>' : '';
      return '<div class="yz-bubble-row ' + (mine ? 'self' : 'other') + '">' +
        (!mine && group ? '<span class="yz-bubble-ava">' + ava(message.sender || '?') + '</span>' : '') +
        '<div class="yz-bubble-wrap">' + sender + '<div class="yz-bubble">' + CORE.escapeHtml(message.text) + '</div><time>' + CORE.escapeHtml(message.time || '') + '</time></div>' +
        '</div>';
    }).join('');
    if (!bubbles) bubbles = '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.awaitingSync) + '</div>';
    // 玩家侧消息窗口截断痕迹（玩家群聊发言最多保留 24 条，更早的已归档）。
    if (archivedFlag) {
      bubbles = '<div class="yz-archived-note">' + CORE.escapeHtml(tr('runtime.player.msgArchived', { n: 24 })) + '</div>' + bubbles;
    }
    var title = CORE.escapeHtml(rowItem.name) + (group && Number(rowItem.members) ? ' <small>(' + CORE.escapeHtml(rowItem.members + t.labels.membersUnit) + ')</small>' : '');
    // 玩家域群聊（公开数据）：底部群聊发言输入框（data-group-msg-input 由 App 层绑定）。
    var composer = composerGroupId
      ? '<div class="yz-composer"><input type="text" data-group-msg-input data-group-id="' + CORE.escapeHtml(composerGroupId) + '" placeholder="' + CORE.escapeHtml(t.playerGroupMsgPlaceholder) + '" aria-label="' + CORE.escapeHtml(t.playerGroupMsgPlaceholder) + '" maxlength="3000">' +
        '<button type="button" class="yz-send" data-action="send-group-msg" data-group-id="' + CORE.escapeHtml(composerGroupId) + '">' + CORE.escapeHtml(t.playerSend) + '</button></div>'
      : '';
    return '<main class="yz-page-inner yz-page-composer" data-marker="' + (group ? 'msg-gchat' : 'msg-chat') + '">' +
      yzHeader(title, false, tag) + searchBox(search) + '<div class="yz-bubbles">' + bubbles + '</div>' + composer + '</main>';
  }

  function renderMsg(state, nav, search) {
    nav = nav || { app: 'msg', view: 'chats', params: {} };
    if (nav.view === 'chat') return renderMsgDetail(state, nav, false, search);
    if (nav.view === 'gchat') return renderMsgDetail(state, nav, true, search);
    return renderChatList(state, nav, search);
  }
  // 玩家域交流讯息：固定「与角色传讯」会话（私讯跨域写入点）。
  // 玩家消息为右侧气泡，附 已送达/已读/已回 状态；角色回复经通道镜像为左侧气泡。
  // 已回 = 线程中该消息之后存在角色回复；已读 = seq ≤ 角色域已读游标（注入即已读）。
  // 群聊是公开数据（跨域一致）：玩家域的群组列表/群聊详情渲染角色域数据并带「公开」标识。
  function renderMsgPlayer(characterState, playerState, nav, search, tag, failedSet) {
    var t = I18N.dict();
    failedSet = failedSet || {};
    var kw = searchKw(search);
    nav = nav || { app: 'msg', view: 'chats', params: {} };
    var view = (nav.view && nav.view !== 'root') ? nav.view : 'chats';
    if (view === 'gchat') {
      // 群聊详情（公开）：复用角色域渲染（玩家视角），玩家域加「公开」标识与群聊发言输入框。
      // 玩家侧群消息窗口（24 条）截断过的标记一并传给详情页，展示「更早已归档」痕迹。
      var playerGroup = null;
      CORE.safeArray(playerState.chats && playerState.chats.groups, 6).forEach(function (g) {
        if (g && String(g.id) === String(nav.params && nav.params.id)) playerGroup = g;
      });
      return renderMsgDetail(characterState, nav, true, search, tag, String(nav.params && nav.params.id) || '', true, playerGroup && playerGroup.archived);
    }
    if (view === 'groups') {
      // 群组列表（公开）：渲染角色域群组，行内未读徽标与角色域一致；有新回复的置顶 + 光效。
      var gitems = unreadFirst(CORE.safeArray(characterState.chats && characterState.chats.groups, 6).filter(function (row) {
        return filterMatch(kw, [row.name, row.preview, row.time]);
      })).map(function (row) { return chatRow(t, row, 'gchat', t.labels.membersUnit); });
      var gbody = gitems.length ? '<div class="yz-page-list">' + gitems.join('') + '</div>' : '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.groups) + '</div>';
      return '<main class="yz-page-inner" data-marker="msg-groups">' + yzHeader(t.features.msg, true, tag) +
        yzTabs([['chats', t.tabs.contacts], ['groups', t.tabs.groups]], 'groups') + searchBox(search) + gbody + '</main>';
    }
    var thread = null;
    CORE.safeArray(playerState.chats && playerState.chats.contacts, 10).forEach(function (c) {
      if (String(c && c.id) === CORE.PLAYER_THREAD_ID) thread = c;
    });
    if (view === 'chat') {
      // 已送达集合：角色域 yz-player 联系人中已存在的玩家消息 id（投递确认）。
      var delivered = {};
      var characterContact = null;
      CORE.safeArray(characterState.chats && characterState.chats.contacts, 10).forEach(function (c) {
        if (String(c && c.id) === CORE.PLAYER_CONTACT_ID) characterContact = c;
      });
      CORE.safeArray(characterContact && characterContact.messages, 20).forEach(function (m) { delivered[String(m && m.id)] = true; });
      var cursor = Number(characterState.sync && characterState.sync.playerReadCursor) || 0;
      var bubbles = CORE.safeArray(thread && thread.messages, 20).filter(function (message) {
        return filterMatch(kw, [message.text, message.time]);
      }).map(function (message) {
        if (message.side === 'self') {
          var seqMatch = /^pm-(\d+)$/.exec(String(message.id) || '');
          var status = t.playerStatusSent;
          var failed = !!failedSet[String(message.id)];
          var replied = false;
          var idx = CORE.safeArray(thread.messages, 20).indexOf(message);
          for (var i = idx + 1; i < CORE.safeArray(thread.messages, 20).length; i += 1) {
            if (thread.messages[i] && thread.messages[i].side === 'other') { replied = true; break; }
          }
          // 投递失败优先于一切状态：显示「未送达」+ 重发按钮（点击重跑镜像）。
          if (failed) status = t.playerStatusUndelivered;
          else if (replied) status = t.playerStatusReplied;
          else if (seqMatch && (Number(seqMatch[1]) || 0) <= cursor && delivered[String(message.id)]) status = t.playerStatusRead;
          var retryBtn = failed
            ? '<button type="button" class="yz-retry-btn" data-action="retry-msg" data-id="' + CORE.escapeHtml(String(message.id)) + '">' + CORE.escapeHtml(t.playerRetry) + '</button>'
            : '';
          return '<div class="yz-bubble-row self">' +
            '<div class="yz-bubble-wrap"><div class="yz-bubble">' + CORE.escapeHtml(message.text) + '</div>' +
            '<time>' + CORE.escapeHtml(message.time || '') + '<i class="yz-msg-status' + (failed ? ' bad' : '') + '">' + CORE.escapeHtml(status) + '</i></time>' + retryBtn + '</div>' +
            '</div>';
        }
        return '<div class="yz-bubble-row other">' +
          '<span class="yz-bubble-ava">' + ava(thread && thread.name || '?') + '</span>' +
          '<div class="yz-bubble-wrap"><b class="yz-sender">' + CORE.escapeHtml(thread && thread.name || '') + '</b>' +
          '<div class="yz-bubble">' + CORE.escapeHtml(message.text) + '</div><time>' + CORE.escapeHtml(message.time || '') + '</time></div>' +
          '</div>';
      }).join('');
      if (!bubbles) bubbles = '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.playerThreadEmpty) + '</div>';
      // 超限截断痕迹：最近 20 条窗口外的更早消息已归档（thread.archived 在截断时置位），
      // 在会话顶部给出「更早已归档」说明，避免用户以为消息凭空消失。
      if (thread && thread.archived) {
        bubbles = '<div class="yz-archived-note">' + CORE.escapeHtml(tr('runtime.player.msgArchived', { n: 20 })) + '</div>' + bubbles;
      }
      var title = CORE.escapeHtml(thread ? thread.name : t.playerThreadFallback);
      // 会话输入框：私讯写入入口（data-msg-input 由 App 层委托绑定发送）。
      var composer = '<div class="yz-composer"><input type="text" data-msg-input placeholder="' + CORE.escapeHtml(t.playerMsgPlaceholder) + '" aria-label="' + CORE.escapeHtml(t.playerMsgPlaceholder) + '" maxlength="3000">' +
        '<button type="button" class="yz-send" data-action="send-msg">' + CORE.escapeHtml(t.playerSend) + '</button></div>';
      return '<main class="yz-page-inner yz-page-composer" data-marker="player-chat">' +
        yzHeader(title) + searchBox(search) + '<div class="yz-bubbles">' + bubbles + '</div>' + composer + '</main>';
    }
    // 会话列表：未建立线程时给首次传讯入口（固定会话形态，无需选联系人）。
    var items = [];
    if (thread && filterMatch(kw, [thread.name, thread.preview, thread.time])) {
      // 角色新回复未读：线程行带数字角标 + 呼吸光效（chatRow 的 unread 驱动）。
      items.push(chatRow(t, { id: CORE.PLAYER_THREAD_ID, name: thread.name, relation: t.playerThreadRelation, time: thread.time, preview: thread.preview, unread: thread.unread || 0 }, 'chat', ''));
    }
    var body;
    if (items.length) {
      // 全已读入口：有未读时一键清零（主页「讯息」角标同步熄灭，不必逐条点开）。
      var markAll = thread && Number(thread.unread) > 0
        ? '<button type="button" class="yz-mark-all" data-action="mark-thread-read">' + CORE.escapeHtml(t.playerMarkAllRead) + '</button>'
        : '';
      body = '<div class="yz-page-list">' + items.join('') + '</div>' + markAll;
    }
    else if (kw) body = '<div class="yz-empty">' + CORE.escapeHtml(t.searchNoMatch) + '</div>';
    else body = '<div class="yz-empty">' + CORE.escapeHtml(t.playerNoThread) + '</div>' +
      button('navigate', t.playerStartThread, { view: 'chat', id: CORE.PLAYER_THREAD_ID }, 'yz-start-thread');
    return '<main class="yz-page-inner" data-marker="player-chats">' + yzHeader(t.features.msg, true) +
      yzTabs([['chats', t.tabs.contacts], ['groups', t.tabs.groups]], view) + searchBox(search) + body + '</main>';
  }

  // ---------- 玩家域 CRUD：表单页与列表页操作控件 ----------
  // 玩家直写不经模型评估；列表行尾「编辑」按钮 + 列表底部「新建」CTA + 表单页保存/两击删除。

  function playerEntityWord(kind, t) {
    return t.playerWord[kind] || kind;
  }

  function playerFormTitle(kind, isEdit, t) {
    return (isEdit ? t.playerEditWord : t.playerNewWord) + playerEntityWord(kind, t);
  }

  // 行尾编辑按钮（复用管理页清空按钮的样式语义，操作是进入表单）。
  function playerEditBtn(kind, id) {
    return '<button type="button" class="yz-edit-btn" data-action="player-edit" data-kind="' + CORE.escapeHtml(kind) + '" data-id="' + CORE.escapeHtml(String(id)) + '" aria-label="' + CORE.escapeHtml(I18N.dict().playerEdit) + '">✎</button>';
  }

  // 可编辑列表行：主区（导航或静态展示）+ 行尾编辑按钮（button 嵌 button 非法，外层用 div）。
  function editableListRow(mainHtml, kind, id) {
    return '<div class="yz-row yz-static yz-manage-row">' + mainHtml + playerEditBtn(kind, id) + '</div>';
  }

  // 列表底部新建 CTA（note 需要携带父玉册夹 id）。
  function playerAddBtn(kind, folderId) {
    var t = I18N.dict();
    var extra = folderId ? ' data-folder="' + CORE.escapeHtml(String(folderId)) + '"' : '';
    return '<button type="button" class="yz-add-btn" data-action="player-new" data-kind="' + CORE.escapeHtml(kind) + '"' + extra + '>＋ ' + CORE.escapeHtml(t.playerNewWord + playerEntityWord(kind, t)) + '</button>';
  }

  // 表单字段描述：key 与 data-form-field 对应，保存时由 App 层统一读取。
  function playerFormFields(kind, entity, t) {
    function field(key, label, type, value, options, max) {
      return { key: key, label: label, type: type || 'text', value: value == null ? '' : value, options: options, max: max };
    }
    if (kind === 'folder') return [field('name', t.playerFieldName, 'text', entity && entity.name, null, 120)];
    if (kind === 'note') {
      return [
        field('title', t.playerFieldTitle, 'text', entity && entity.title, null, 200),
        field('body', t.playerFieldBody, 'textarea', entity && entity.body, null, 3000),
        field('locked', t.playerFieldLocked, 'checkbox', !!(entity && entity.locked))
      ];
    }
    if (kind === 'item') {
      return [
        field('name', t.playerFieldName, 'text', entity && entity.name, null, 120),
        field('qty', t.playerFieldQty, 'number', entity && entity.qty),
        field('grade', t.playerFieldGrade, 'text', entity && entity.grade, null, 60),
        field('desc', t.playerFieldDesc, 'textarea', entity && entity.desc, null, 3000)
      ];
    }
    if (kind === 'currency') {
      return [
        field('kind', t.playerFieldKind, 'text', entity && entity.kind, null, 60),
        field('amount', t.playerFieldAmount, 'text', entity && entity.amount, null, 80)
      ];
    }
    if (kind === 'order') {
      return [
        field('name', t.playerFieldItemName, 'text', entity && entity.name, null, 120),
        field('status', t.playerFieldStatus, 'text', entity && entity.status, null, 40),
        field('price', t.playerFieldPrice, 'text', entity && entity.price, null, 80),
        field('side', t.playerFieldSide, 'select', entity && entity.side || 'buy', [['buy', t.playerSideBuy], ['sell', t.playerSideSell]])
      ];
    }
    if (kind === 'post') {
      return [
        field('title', t.playerFieldTitle, 'text', entity && entity.title, null, 200),
        field('section', t.playerFieldSection, 'text', entity && entity.section, null, 60),
        field('body', t.playerFieldBody, 'textarea', entity && entity.body, null, 3000)
      ];
    }
    return [];
  }

  // 玩家域编辑/新建表单页：新建时 id 为空；编辑时预填现有实体。
  // 删除按钮走两击确认（ui.armed 复用管理页武装状态机）。
  function renderPlayerForm(pstate, nav, ui) {
    var t = I18N.dict();
    var params = nav.params || {};
    var kind = params.kind;
    var entity = CORE.playerFindEntity(pstate, kind, params.id);
    var isEdit = !!entity;
    var fields = playerFormFields(kind, entity, t);
    var title = playerFormTitle(kind, isEdit, t);
    var body = '<div class="yz-form">';
    if (kind === 'note') {
      var folderId = params.folderId || (entity && entity.folderId) || '';
      body += '<input type="hidden" data-form-field="folderId" value="' + CORE.escapeHtml(String(folderId)) + '">';
    }
    fields.forEach(function (field) {
      var label = '<label for="yz-form-' + field.key + '">' + CORE.escapeHtml(field.label) + '</label>';
      // 超长由 cleanText 静默截断（runtime 兜底），输入侧同步 maxlength 提示上限，避免「存少了一截」。
      var maxAttr = field.max ? ' maxlength="' + field.max + '"' : '';
      if (field.type === 'textarea') {
        body += label + '<textarea class="yz-form-input" id="yz-form-' + field.key + '" data-form-field="' + field.key + '" rows="4"' + maxAttr + '>' + CORE.escapeHtml(String(field.value)) + '</textarea>';
      } else if (field.type === 'checkbox') {
        body += '<label class="yz-form-check" for="yz-form-' + field.key + '"><input type="checkbox" id="yz-form-' + field.key + '" data-form-field="' + field.key + '"' + (field.value ? ' checked' : '') + '>' + CORE.escapeHtml(field.label) + '</label>';
      } else if (field.type === 'select') {
        body += label + '<select class="yz-form-input" id="yz-form-' + field.key + '" data-form-field="' + field.key + '">' + field.options.map(function (option) {
          return '<option value="' + CORE.escapeHtml(option[0]) + '"' + (String(field.value) === option[0] ? ' selected' : '') + '>' + CORE.escapeHtml(option[1]) + '</option>';
        }).join('') + '</select>';
      } else if (field.type === 'number') {
        // 数量字段带 −/+ 快捷步进（数量是纯数字，增减无需打开键盘输入）。
        body += label + '<div class="yz-stepper">' +
          '<button type="button" class="yz-step" data-action="qty-step" data-delta="-1" aria-label="' + CORE.escapeHtml(t.playerQtyStepDown) + '">−</button>' +
          '<input class="yz-form-input" id="yz-form-' + field.key + '" data-form-field="' + field.key + '" type="number" min="0" step="1" value="' + CORE.escapeHtml(String(field.value)) + '">' +
          '<button type="button" class="yz-step" data-action="qty-step" data-delta="1" aria-label="' + CORE.escapeHtml(t.playerQtyStepUp) + '">+</button></div>';
      } else {
        body += label + '<input class="yz-form-input" id="yz-form-' + field.key + '" data-form-field="' + field.key + '" type="' + (field.type === 'number' ? 'number' : 'text') + '" value="' + CORE.escapeHtml(String(field.value)) + '"' + maxAttr + '>';
      }
    });
    body += '</div>';
    var armed = !!(ui && ui.armed && ui.armed.id === kind + ':' + String(params.id));
    body += '<div class="yz-form-actions">' +
      '<button type="button" class="yz-send" data-action="player-save" data-kind="' + CORE.escapeHtml(kind) + '" data-id="' + CORE.escapeHtml(String(params.id || '')) + '">' + CORE.escapeHtml(t.playerSave) + '</button>' +
      (isEdit ? '<button type="button" class="yz-clear-btn' + (armed ? ' armed' : '') + '" data-action="player-delete" data-kind="' + CORE.escapeHtml(kind) + '" data-id="' + CORE.escapeHtml(String(params.id)) + '"' + (armed ? ' data-wipe-base="' + CORE.escapeHtml(t.playerDeleteConfirm) + '"' : '') + '>' + CORE.escapeHtml(armed ? t.playerDeleteConfirm : t.playerDelete) + '</button>' : '') +
      '</div>';
    return '<main class="yz-page-inner" data-marker="player-form">' +
      yzHeader(title) + body + '</main>';
  }


  function renderNotes(state, nav, search, player, ui) {
    var t = I18N.dict();
    var notes = CORE.safeObject(state.notes);
    var kw = searchKw(search);
    nav = nav || { app: 'notes', view: 'folders', params: {} };
    var view = (nav.view && nav.view !== 'root') ? nav.view : 'folders';
    if (player && view === 'form') return renderPlayerForm(state, nav, ui);
    if (view === 'note') {
      var rowNote = null;
      CORE.safeArray(notes.notes, 30).forEach(function (note) { if (String(note.id) === String(nav.params && nav.params.id)) rowNote = note; });
      if (!rowNote) return '<main class="yz-page-inner"><div class="yz-empty">' + CORE.escapeHtml(t.guards.note) + '</div></main>';
      var editBtn = player ? '<div class="yz-form-actions"><button type="button" class="yz-send" data-action="player-edit" data-kind="note" data-id="' + CORE.escapeHtml(rowNote.id) + '">' + CORE.escapeHtml(t.playerEdit) + '</button></div>' : '';
      return '<main class="yz-page-inner" data-marker="note-detail">' +
        yzHeader(t.features.notes) +
        '<div class="yz-note-paper"><small>' + (rowNote.locked ? CORE.escapeHtml(t.labels.locked) : '') + '</small><h2>' + CORE.escapeHtml(rowNote.title) + '</h2><time>' + CORE.escapeHtml(rowNote.updated || '') + '</time><p>' + CORE.escapeHtml(rowNote.body) + '</p></div>' +
        editBtn +
        '</main>';
    }
    if (view === 'folder') {
      var folder = null;
      CORE.safeArray(notes.folders, 10).forEach(function (f) { if (String(f.id) === String(nav.params && nav.params.id)) folder = f; });
      if (!folder) return '<main class="yz-page-inner"><div class="yz-empty">' + CORE.escapeHtml(t.guards.notes) + '</div></main>';
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
        yzHeader(CORE.escapeHtml(folder.name)) + searchBox(search) + '<div class="yz-page-list">' + list + '</div>' + cta + '</main>';
    }
    var folderCards = CORE.safeArray(notes.folders, 10).filter(function (f) {
      return filterMatch(kw, [f.name]);
    }).map(function (f) {
      var main = button('navigate', '<span class="yz-folder-glyph">📁</span><span class="yz-row-copy"><b>' + CORE.escapeHtml(f.name) + '</b><em>' + CORE.escapeHtml(String(f.count || 0) + ' ' + t.labels.notesWord) + '</em></span>', { view: 'folder', id: f.id }, 'yz-manage-main');
      return player ? editableListRow(main, 'folder', f.id) : button('navigate', '<span class="yz-folder-glyph">📁</span><span class="yz-row-copy"><b>' + CORE.escapeHtml(f.name) + '</b><em>' + CORE.escapeHtml(String(f.count || 0) + ' ' + t.labels.notesWord) + '</em></span>', { view: 'folder', id: f.id }, 'yz-row');
    });
    var body = folderCards.length ? '<div class="yz-page-list">' + folderCards.join('') + '</div>' : '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.folders) + '</div>';
    var cta = player ? playerAddBtn('folder', '') : '';
    return '<main class="yz-page-inner" data-marker="notes-folders">' + yzHeader(t.features.notes) + searchBox(search) + body + cta + '</main>';
  }

  function renderForum(state, nav, search, tag, player, ui) {
    var t = I18N.dict();
    var forum = CORE.safeObject(state.forum);
    var kw = searchKw(search);
    nav = nav || { app: 'forum', view: 'root', params: {} };
    var view = (nav.view && nav.view !== 'root') ? nav.view : 'root';
    if (player && view === 'form') return renderPlayerForm(state, nav, ui);
    if (view === 'post') {
      var post = null;
      CORE.safeArray(forum.posts, 20).forEach(function (item) { if (String(item.id) === String(nav.params && nav.params.id)) post = item; });
      if (!post) return '<main class="yz-page-inner"><div class="yz-empty">' + CORE.escapeHtml(t.guards.post) + '</div></main>';
      var comments = CORE.safeArray(post.comments, 20).filter(function (comment) {
        return filterMatch(kw, [comment.author, comment.text, comment.time]);
      }).map(function (comment) {
        return '<div class="yz-comment"><span class="yz-comment-ava">' + ava(comment.author || '?') + '</span><div class="yz-comment-copy"><b>' + CORE.escapeHtml(comment.author || '') + '</b><p>' + CORE.escapeHtml(comment.text) + '</p><time>' + CORE.escapeHtml(comment.time || '') + '</time></div></div>';
      }).join('');
      // 评论窗口超限痕迹：每帖最多 20 条，满额后更早评论不会消失但新评论会静默拒收——
      // 满额提示「已达上限」，避免用户以为评论没发出去是故障。
      var commentsFull = CORE.safeArray(post.comments, 20).length >= 20 && !kw;
      var isMine = String(post.owner || '') === 'player';
      var editBtn = (player && isMine) ? '<div class="yz-form-actions"><button type="button" class="yz-send" data-action="player-edit" data-kind="post" data-id="' + CORE.escapeHtml(post.id) + '">' + CORE.escapeHtml(t.playerEdit) + '</button></div>' : '';
      // 玩家域（公开数据）：底部评论输入框（data-comment-input 由 App 层绑定发送）。
      var commentBox = player
        ? '<div class="yz-composer"><input type="text" data-comment-input data-post-id="' + CORE.escapeHtml(post.id) + '" placeholder="' + CORE.escapeHtml(t.playerCommentPlaceholder) + '" aria-label="' + CORE.escapeHtml(t.playerCommentPlaceholder) + '" maxlength="3000">' +
          '<button type="button" class="yz-send" data-action="send-comment" data-post-id="' + CORE.escapeHtml(post.id) + '">' + CORE.escapeHtml(t.playerComment) + '</button></div>'
        : readOnlyHint(t.playerReadOnlyForum);
      return '<main class="yz-page-inner yz-page-composer" data-marker="forum-post">' +
        yzHeader(t.features.forum, false, tag) +
        '<article class="yz-post-paper"><div class="yz-post-meta"><span>' + CORE.escapeHtml(post.author || '') + (CORE.hasText(post.role) ? ' · ' + CORE.escapeHtml(post.role) : '') + (isMine ? ' <i class="yz-player-tag">' + CORE.escapeHtml(t.playerPostTag) + '</i>' : '') + '</span><time>' + CORE.escapeHtml(post.time || '') + '</time></div>' +
        '<h2>' + CORE.escapeHtml(post.title) + '</h2>' +
        (CORE.hasText(post.section) ? '<span class="yz-tag">' + CORE.escapeHtml(post.section) + '</span>' : '') +
        '<p>' + CORE.escapeHtml(post.body) + '</p>' +
        '<div class="yz-resonance">❋ ' + CORE.escapeHtml(String(post.resonance || 0)) + ' ' + CORE.escapeHtml(t.labels.resonance) + '</div></article>' +
        (comments.length || !kw
          ? '<section class="yz-comments"><h3>' + CORE.escapeHtml(String(comments.length)) + ' ' + CORE.escapeHtml(t.labels.commentsWord) + '</h3>' +
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
    var cta = player ? playerAddBtn('post', '') : '';
    // 角色域论坛只读：给出可读性边界说明，避免把「没有发帖/评论入口」误读为缺功能。
    var hint = player ? '' : readOnlyHint(t.playerReadOnlyForum);
    return '<main class="yz-page-inner" data-marker="forum-list">' + yzHeader(t.features.forum, false, tag) + searchBox(search) + '<div class="yz-page-list">' + list + '</div>' + cta + hint + '</main>';
  }

  function marketRow(avatarName, title, sub, meta, foot, asButton, editTarget) {
    var inner = ava(avatarName) + '<span class="yz-row-copy"><b>' + title + '<i>' + sub + '</i></b><em>' + meta + '</em></span><time>' + foot + '</time>';
    // asButton：玩家域可编辑列表的主区（yz-manage-main 是 flex 按钮，布局与行一致）。
    // 绑 player-edit 让整行可点进编辑表单，避免「可点无动作」的假 affordance。
    if (asButton) {
      var attrs = ' data-action="player-edit" data-kind="' + CORE.escapeHtml(editTarget && editTarget.kind || '') + '" data-id="' + CORE.escapeHtml(String(editTarget && editTarget.id || '')) + '"';
      return '<button type="button" class="yz-manage-main"' + attrs + '>' + inner + '</button>';
    }
    return '<div class="yz-row yz-static">' + inner + '</div>';
  }

  // 角色域只读边界提示条：私有数据页在角色域展示操作归属，避免用户误以为功能缺失。
  function readOnlyHint(text) {
    return '<div class="yz-empty yz-readonly-hint">' + CORE.escapeHtml(text) + '</div>';
  }

  function renderMarket(state, nav, search, tag, player, ui) {
    var t = I18N.dict();
    var market = CORE.safeObject(state.market);
    var kw = searchKw(search);
    nav = nav || { app: 'market', view: 'listings', params: {} };
    var view = (nav.view && nav.view !== 'root') ? nav.view : 'listings';
    if (player && view === 'form') return renderPlayerForm(state, nav, ui);
    var body;
    if (view === 'auctions') {
      var auctions = CORE.safeArray(market.auctions, 12).filter(function (auction) {
        return filterMatch(kw, [auction.name, auction.grade, auction.desc, auction.start, auction.current, auction.timeLeft]);
      });
      body = auctions.length ? '<div class="yz-page-list">' + auctions.map(function (auction) {
        return marketRow(auction.name,
          CORE.escapeHtml(auction.name), CORE.escapeHtml(auction.grade || ''),
          '<span class="yz-price">' + CORE.escapeHtml(t.labels.startPrice + ' ' + formatNum(auction.start)) + ' → ' + CORE.escapeHtml(formatNum(auction.current)) + '</span> · ' + CORE.escapeHtml(auction.desc || ''),
          CORE.escapeHtml(auction.timeLeft || '') + '<u class="yz-res">' + CORE.escapeHtml(String(auction.bids || 0)) + ' ' + CORE.escapeHtml(t.labels.bidsUnit) + '</u>');
      }).join('') + '</div>' : '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.auctions) + '</div>';
    } else if (view === 'orders') {
      // 方向显示做归一化（买入/卖出），检索也按显示文案匹配，否则搜「买入」命不中 raw buy/sell。
      var sideLabel = function (side) { return /^(buy|买|求购|购)/i.test(side) ? t.labels.buy : (/^(sell|卖|出售|售)/i.test(side) ? t.labels.sell : side); };
      var orders = CORE.safeArray(market.orders, 12).filter(function (order) {
        return filterMatch(kw, [order.name, order.status, order.price, order.time, order.side, sideLabel(order.side)]);
      });
      body = orders.length ? '<div class="yz-page-list">' + orders.map(function (order) {
        var side = sideLabel(order.side) || '';
        // 买/卖颜色区分：买（支出）蓝、卖（收入）金，与股票面板习惯对齐。
        var sideCls = /^(buy|买|求购|购)/i.test(order.side) ? 'yz-side buy' : 'yz-side sell';
        var row = marketRow(order.name,
          CORE.escapeHtml(order.name), '<span class="' + sideCls + '">' + CORE.escapeHtml(side) + '</span>',
          CORE.escapeHtml(order.status || ''),
          CORE.escapeHtml(order.time || '') + '<u class="yz-price-tag">' + CORE.escapeHtml(formatNum(order.price)) + '</u>', !!player, player && { kind: 'order', id: order.id });
        return player ? editableListRow(row, 'order', order.id) : row;
      }).join('') + '</div>' : '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.orders) + '</div>';
    } else if (view === 'requests') {
      // 求购区是公开数据（与行情/拍卖同源，跨域一致）：展示求购公告与出价。
      // 求购行脚下展示「买入 <价>」，检索字段补上该前缀与买入标签，避免搜「买入」命不中。
      var requests = CORE.safeArray(market.requests, 12).filter(function (request) {
        return filterMatch(kw, [request.name, request.grade, request.desc, request.price, request.author, t.labels.buy + ' ' + request.price]);
      });
      body = requests.length ? '<div class="yz-page-list">' + requests.map(function (request) {
        return marketRow(request.name,
          CORE.escapeHtml(request.name), CORE.escapeHtml(request.grade || ''),
          CORE.escapeHtml(request.desc || ''),
          CORE.escapeHtml(request.author || '') + '<u class="yz-price-tag">' + CORE.escapeHtml(t.labels.buy + ' ' + formatNum(request.price)) + '</u>');
      }).join('') + '</div>' : '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.requests) + '</div>';
    } else {
      var listings = CORE.safeArray(market.listings, 20).filter(function (listing) {
        return filterMatch(kw, [listing.name, listing.grade, listing.desc, listing.price, listing.seller]);
      });
      body = listings.length ? '<div class="yz-page-list">' + listings.map(function (listing) {
        return marketRow(listing.name,
          CORE.escapeHtml(listing.name), CORE.escapeHtml(listing.grade || ''),
          CORE.escapeHtml(listing.desc || ''),
          CORE.escapeHtml(listing.seller || '') + '<u class="yz-price-tag">' + CORE.escapeHtml(formatNum(listing.price)) + '</u>');
      }).join('') + '</div>' : '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.listings) + '</div>';
    }
    var cta = (player && view === 'orders') ? playerAddBtn('order', '') : '';
    // 角色域订单是私有数据的只读视图：给出可读性的边界说明，避免「没有新建入口」被误读为缺功能。
    var hint = (!player && view === 'orders') ? readOnlyHint(t.playerReadOnlyOrders) : '';
    return '<main class="yz-page-inner" data-marker="market-' + CORE.escapeHtml(view) + '">' + yzHeader(t.features.market, true, tag) +
      yzTabs([['listings', t.tabs.listings], ['requests', t.tabs.requests], ['auctions', t.tabs.auctions], ['orders', t.tabs.orders]], view) + searchBox(search) + body + cta + hint + '</main>';
  }

  // 纯数字串加千分位；非纯数字（含单位/文本）原样返回——金额字段是自由文本。
  function formatNum(value) {
    var s = String(value == null ? '' : value).trim();
    if (!/^-?\d+$/.test(s)) return s;
    var neg = s.charAt(0) === '-';
    var digits = neg ? s.slice(1) : s;
    var out = '';
    for (var i = digits.length; i > 0; i -= 3) {
      out = (i >= 3 ? digits.slice(Math.max(0, i - 3), i) : digits.slice(0, i)) + (out ? ',' + out : '');
    }
    return (neg ? '-' : '') + out;
  }

  function renderSpace(state, nav, search, player, ui) {
    var t = I18N.dict();
    var space = CORE.safeObject(state.space);
    var kw = searchKw(search);
    nav = nav || { app: 'space', view: 'items', params: {} };
    var view = (nav.view && nav.view !== 'root') ? nav.view : 'items';
    if (player && view === 'form') return renderPlayerForm(state, nav, ui);
    var body;
    if (view === 'currencies') {
      var currencies = CORE.safeArray(space.currencies, 10).filter(function (currency) {
        return filterMatch(kw, [currency.kind, currency.amount]);
      });
      body = currencies.length ? '<div class="yz-page-list">' + currencies.map(function (currency) {
        var inner = '<span class="yz-coin">◈</span><span class="yz-row-copy"><b>' + CORE.escapeHtml(currency.kind) + '</b></span><time class="yz-amount">' + CORE.escapeHtml(formatNum(currency.amount)) + '</time>';
        var row = player
          ? '<button type="button" class="yz-manage-main" data-action="player-edit" data-kind="currency" data-id="' + CORE.escapeHtml(String(currency.kind)) + '">' + inner + '</button>'
          : '<div class="yz-row yz-static">' + inner + '</div>';
        return player ? editableListRow(row, 'currency', currency.kind) : row;
      }).join('') + '</div>' : '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.currencies) + '</div>';
    } else {
      var items = CORE.safeArray(space.items, 30).filter(function (item) {
        return filterMatch(kw, [item.name, item.grade, item.desc]);
      });
      body = items.length ? '<div class="yz-page-list">' + items.map(function (item) {
        // qty=0 也要显示（0 是合法数量）：恒输出数字；qtyText（如「三枚」）优先。
        var qtyShown = item.qtyText || String(Number(item.qty) || 0);
        var row = marketRow(item.name,
          CORE.escapeHtml(item.name), CORE.escapeHtml(item.grade || ''),
          CORE.escapeHtml(item.desc || ''),
          CORE.escapeHtml(qtyShown), !!player, player && { kind: 'item', id: item.id });
        return player ? editableListRow(row, 'item', item.id) : row;
      }).join('') + '</div>' : '<div class="yz-empty">' + CORE.escapeHtml(kw ? t.searchNoMatch : t.guards.items) + '</div>';
    }
    var cta = player ? playerAddBtn(view === 'currencies' ? 'currency' : 'item', '') : '';
    // 角色域储物只读：给边界说明，避免把「没有管理入口」误读为功能缺失。
    var hint = !player ? readOnlyHint(t.playerReadOnlySpace) : '';
    return '<main class="yz-page-inner" data-marker="space-' + CORE.escapeHtml(view) + '">' + yzHeader(t.features.space, true) +
      yzTabs([['items', t.tabs.items], ['currencies', t.tabs.currencies]], view) + searchBox(search) + body + cta + hint + '</main>';
  }

  function renderMap(state, search, tag, player) {
    var t = I18N.dict();
    var map = CORE.safeObject(state.map);
    var kw = searchKw(search);
    var cur = CORE.safeObject(map.current);
    var tracks = CORE.safeArray(map.tracks, 20).filter(function (track) {
      return filterMatch(kw, [track.place, track.action, track.time]);
    });
    var places = CORE.safeArray(map.places, 20).filter(function (place) {
      return filterMatch(kw, [place.name, place.domain, place.desc]);
    });
    var hero = '';
    if (CORE.hasText(cur.place)) {
      hero = '<div class="yz-map-current"><h3>' + CORE.escapeHtml(t.mapTitles.current) + '</h3>' +
        '<div class="yz-hero"><span class="yz-map-pin">◈</span><div><b>' + CORE.escapeHtml(cur.place) + '</b>' + (CORE.hasText(cur.domain) ? '<small>' + CORE.escapeHtml(cur.domain) + '</small>' : '') + '</div></div>' +
        (CORE.hasText(cur.desc) ? '<p class="yz-map-desc">' + CORE.escapeHtml(cur.desc) + '</p>' : '') + '</div>';
    }
    // 行踪按时间逆序（最新在上，紧贴当前所在地）：数据按追加顺序存（旧→新），倒排展示。
    var timeline = tracks.length ? '<div class="yz-map-tracks"><h3>' + CORE.escapeHtml(t.mapTitles.tracks) + '</h3><div class="yz-timeline">' +
      tracks.slice().reverse().map(function (track) {
        return '<div class="yz-track"><time>' + CORE.escapeHtml(track.time || '') + '</time><div><b>' + CORE.escapeHtml(track.place) + '</b>' + (CORE.hasText(track.action) ? '<p>' + CORE.escapeHtml(track.action) + '</p>' : '') + '</div></div>';
      }).join('') + '</div></div>' : '';
    var roster = places.length ? '<div class="yz-map-places"><h3>' + CORE.escapeHtml(t.mapTitles.places) + '</h3><div class="yz-page-list">' +
      places.map(function (place) {
        return '<div class="yz-row yz-static"><span class="yz-map-pin">◈</span><span class="yz-row-copy"><b>' + CORE.escapeHtml(place.name) + '</b>' +
          (CORE.hasText(place.domain) ? '<i>' + CORE.escapeHtml(place.domain) + '</i>' : '') +
          (CORE.hasText(place.desc) ? '<em>' + CORE.escapeHtml(place.desc) + '</em>' : '') + '</span></div>';
      }).join('') + '</div></div>' : '';
    // 整页空态只出一处：全空（无当前地点/行踪/地点）时渲染总体空态；hero 不再单独判空，
    // 避免空态文案重复出现。玩家域（无写入途径）用专属文案，避免与角色域「暂无行踪」混淆。
    var empty = '';
    var hasData = CORE.hasText(cur.place) || CORE.safeArray(map.tracks, 20).length || CORE.safeArray(map.places, 20).length;
    if (kw) {
      var curMatch = filterMatch(kw, [cur.place, cur.domain, cur.desc]);
      if (!curMatch && !tracks.length && !places.length) empty = '<div class="yz-empty">' + CORE.escapeHtml(t.searchNoMatch) + '</div>';
    } else if (!hasData) {
      empty = '<div class="yz-empty">' + CORE.escapeHtml(player ? (t.playerMapEmpty || t.guards.tracks) : t.guards.tracks) + '</div>';
    }
    return '<main class="yz-page-inner" data-marker="map">' + yzHeader(t.features.map, false, tag) + searchBox(search) + hero + timeline + roster + empty + '</main>';
  }

  function diagRow(label, valueHtml) {
    return '<div class="yz-diag-row"><small>' + CORE.escapeHtml(label) + '</small><p>' + valueHtml + '</p></div>';
  }

  // 同步详情页正文：主界面同步行、太极核心与「玉兆管理」诊断区三个入口共用，不重复实现。
  function renderSyncDetail(state) {
    var t = I18N.dict();
    var sync = state.sync || {};
    var st = syncStatusOf(state);
    var body = '<div class="yz-diag-row"><small>' + CORE.escapeHtml(t.diag.statusLabel) + '</small><p><span class="yz-statusdot ' + CORE.escapeHtml(st.status) + '"></span>' + CORE.escapeHtml(st.text) + '</p></div>';
    // 失败/部分态给可行动的解释：自动补齐或「从快照恢复玉兆数据」恢复，不让用户干瞪眼。
    if (t.diag.action[st.status]) body += '<div class="yz-diag-action">' + CORE.escapeHtml(t.diag.action[st.status]) + '</div>';
    body += diagRow(t.diag.summary, CORE.escapeHtml(sync.summary || t.awaitingSync));
    var applied = CORE.safeArray(sync.applied, 10).map(function (id) { return t.features[id] || id; });
    body += diagRow(t.diag.applied, CORE.escapeHtml(applied.length ? applied.join(tr('runtime.sep.list')) : t.diag.none));
    var issues = CORE.safeArray(sync.issues, 20).map(function (issue) {
      return (issue && (t.issues[issue.code] || t.issues[issue.path])) || (issue && issue.path) || '';
    }).filter(Boolean);
    body += '<div class="yz-diag-row"><small>' + CORE.escapeHtml(t.diag.issuesLabel) + '</small>' +
      (issues.length
        ? '<ul class="yz-diag-issues">' + issues.map(function (line) { return '<li>' + CORE.escapeHtml(line) + '</li>'; }).join('') + '</ul>'
        : '<p>' + CORE.escapeHtml(t.diag.noIssues) + '</p>') +
      '</div>';
    // lastError 仅在非空时显示：错误码走翻译（parse-error/oversized-payload），未知码回退原文。
    if (CORE.hasText(sync.lastError)) {
      var errText = t.diag.err[sync.lastError] || sync.lastError;
      body += diagRow(t.diag.lastError, '<span class="yz-bad-text">' + CORE.escapeHtml(errText) + '</span>');
    }
    body += diagRow(t.diag.updated, CORE.escapeHtml(formatDateTime(sync.updatedAt)));
    var usage = snapshotUsage(state);
    var pct = Math.round(usage.percent);
    body += '<div class="yz-diag-row"><small>' + CORE.escapeHtml(t.diag.storage) + '</small>' +
      '<div class="yz-meter' + (usage.percent > 80 ? ' warn' : '') + '"><i style="width:' + pct + '%"></i></div>' +
      '<em>' + usage.bytes + ' / ' + usage.limit + ' · ' + pct + '%</em></div>';
    // 开发者信息（轮次/来源/累计轮次/聊天标识）折叠收纳：普通用户无需看到内部代号。
    body += '<details class="yz-diag-tech"><summary>' + CORE.escapeHtml(t.diag.tech) + '</summary>' +
      diagRow(t.diag.turn, CORE.escapeHtml(CORE.hasText(sync.turnId) ? sync.turnId : '-')) +
      diagRow(t.diag.source, CORE.escapeHtml(CORE.hasText(sync.lastSource) ? sync.lastSource : '-')) +
      // 累计轮次用单调计数（旧档无该字段时回退到环缓冲长度）。
      diagRow(t.diag.turns, String(sync.totalTurns || CORE.safeArray(state.processedTurns, 80).length)) +
      diagRow(t.diag.chatId, CORE.escapeHtml(state.chatId || '-')) +
      '</details>';
    return body;
  }

  // 单功能清空的两击确认状态机：首击武装，3 秒内再击确认，超时或换目标重新武装。
  var WIPE_CONFIRM_MS = 3000;
  function nextWipeState(armed, featureId, now) {
    if (armed && armed.id === featureId && now < armed.expiresAt) return null;
    return { id: featureId, expiresAt: now + WIPE_CONFIRM_MS };
  }

  function renderManage(state, flags, ui) {
    var t = I18N.dict();
    flags = flags || {};
    ui = ui || {};
    var st = syncStatusOf(state);
    // 顶部折叠诊断区：头部为状态徽标 + 摘要一行，点击展开与详情页共用的 renderSyncDetail 内容。
    var diag = '<section class="yz-diag">' +
      '<button type="button" class="yz-diag-head" data-action="toggle-diag" aria-expanded="' + (ui.diagOpen ? 'true' : 'false') + '">' +
      '<span class="yz-statusdot ' + CORE.escapeHtml(st.status) + '"></span><b>' + CORE.escapeHtml(st.text) + '</b>' +
      '<span class="yz-diag-sum">' + CORE.escapeHtml((state.sync || {}).summary || t.awaitingSync) + '</span>' +
      '</button>' +
      (ui.diagOpen ? '<div class="yz-diag-body">' + renderSyncDetail(state) + '</div>' : '') +
      '</section>';
    var rows = FEATURES.filter(function (feature) { return feature.toggleable; }).map(function (feature) {
      var onFlag = flags[feature.id] !== false;
      var armed = !!(ui.armed && ui.armed.id === feature.id);
      // 行内两个按钮：主区切换封印，行尾「清空」走两击确认；button 嵌 button 非法，故外层用 div。
      return '<div class="yz-row yz-static yz-manage-row">' +
        '<button type="button" class="yz-manage-main" data-action="toggle-feature" data-feature="' + feature.id + '">' +
        '<span class="yz-glyph-sm">' + feature.glyph + '</span><span class="yz-row-copy"><b>' + CORE.escapeHtml(t.features[feature.id]) + '<i>' + CORE.escapeHtml(t.gua[feature.id]) + '</i></b><em>' + CORE.escapeHtml(onFlag ? t.manage.on : t.manage.off) + '</em></span><span class="yz-switch' + (onFlag ? ' on' : '') + '"><i></i></span>' +
        '</button>' +
        '<button type="button" class="yz-clear-btn' + (armed ? ' armed' : '') + '" data-action="clear-feature" data-feature="' + feature.id + '"' + (armed ? ' data-wipe-base="' + CORE.escapeHtml(t.manage.clearConfirm) + '"' : '') + '>' + CORE.escapeHtml(armed ? t.manage.clearConfirm : t.manage.clear) + '</button>' +
        '</div>';
    }).join('');
    // 显式复位入口：长按 FAB 复位不可发现，且持久化数据异常或无法拖动时也需要恢复手段。
    var resetRow = '<div class="yz-row yz-static yz-manage-row">' +
      '<button type="button" class="yz-manage-main" data-action="reset-fab"><span class="yz-glyph-sm">' + FAB_ICON + '</span><span class="yz-row-copy"><b>' + CORE.escapeHtml(t.manage.resetFab) + '</b></span></button></div>';
    var dataRows = ['export', 'import'].map(function (kind) {
      var label = kind === 'export' ? t.manage.export : t.manage.import;
      return '<button type="button" class="yz-row yz-static yz-manage-row yz-manage-main" data-action="toggle-data-panel" data-panel="' + kind + '">' +
        '<span class="yz-glyph-sm">' + (kind === 'export' ? '↧' : '↥') + '</span><span class="yz-row-copy"><b>' + CORE.escapeHtml(label) + '</b></span></button>';
    }).join('');
    // 导出/导入共用一行一个面板：导出只读 + 全选复制；导入粘贴 JSON 后校验替换。
    // 导出内容不得超过导入容量红线（importState 拒绝超限），否则导出→导入 round-trip 断裂。
    var panel = '';
    if (ui.dataPanel === 'export') {
      // 容量检查用「用户实际复制的 pretty 文本」长度，与导入侧校验（text.length）同一把尺子：
      // 否则 compact 通过、pretty 超限的存档会出现「导出成功、原样粘贴导入被拒」的 round-trip 断裂。
      var exportPretty = '';
      try { exportPretty = JSON.stringify(state || {}, null, 2); } catch (_) {}
      if (exportPretty.length > MAX_SNAPSHOT_BYTES) {
        panel = '<div class="yz-empty">' + CORE.escapeHtml(t.manage.exportTooBig) + '</div>';
      } else {
        panel = '<div class="yz-io-warn">' + CORE.escapeHtml(t.manage.exportNote) + '</div>' +
          '<textarea class="yz-io" readonly data-export-output>' + CORE.escapeHtml(exportPretty) + '</textarea>' +
          '<div class="yz-io-actions"><button type="button" class="yz-tab" data-action="copy-export">' + CORE.escapeHtml(t.manage.copyAll) + '</button></div>';
      }
    } else if (ui.dataPanel === 'import') {
      panel = '<textarea class="yz-io" data-import-input placeholder="' + CORE.escapeHtml(t.manage.importPlaceholder) + '"></textarea>' +
        '<div class="yz-io-warn">' + CORE.escapeHtml(t.manage.importWarn) + '</div>' +
        '<div class="yz-io-actions"><button type="button" class="yz-tab" data-action="import-submit">' + CORE.escapeHtml(t.manage.importBtn) + '</button></div>';
    }
    return '<main class="yz-page-inner" data-marker="manage">' + yzHeader(t.features.manage) +
      '<p class="yz-manage-info">' + CORE.escapeHtml(t.manage.info) + '</p>' +
      diag +
      '<div class="yz-page-list">' + rows + resetRow + dataRows + '</div>' + panel + '</main>';
  }

  // 域切换与公开数据标识：
  // 私有数据（玉牌/讯息/玉册/坊市订单/储物/舆图）随域切换数据源；
  // 公开数据（天下论坛、坊市行情/拍卖、群聊）跨域一致，永远渲染角色域数据并带「公开」标识。
  function headerTagText(isPlayer, nav, t) {
    if (!isPlayer) return '';
    if (nav.app === 'forum') return t.playerPublicTag;
    if (nav.app === 'market') {
      var view = (nav.view && nav.view !== 'root') ? nav.view : 'listings';
      if (view !== 'orders') return t.playerPublicTag;
    }
    if (nav.app === 'msg') {
      var mview = (nav.view && nav.view !== 'root') ? nav.view : 'chats';
      if (mview === 'groups' || mview === 'gchat') return t.playerPublicTag;
    }
    return t.playerDomainShort;
  }

  function renderPage(state, nav, flags, ui, domain, playerState) {
    nav = nav || { app: 'home', view: 'root', params: {}, stack: [] };
    ui = ui || {};
    var search = ui.search || '';
    var isPlayer = domain === 'player';
    // 玩家域绝不回退渲染角色域数据（数据域隔离）：playerState 缺失/空白时渲染空态，
    // 不会把角色域私有数据泄漏到玩家域。
    var pstate = isPlayer ? (playerState || CORE.blankPlayerState(state && state.chatId)) : state;
    var t = I18N.dict();
    var tag = headerTagText(isPlayer, nav, t);
    if (nav.app === 'tablet') return isPlayer ? renderTablet(pstate, search, t.playerEmptyPrivate) : renderTablet(state, search);
    if (nav.app === 'msg') return isPlayer ? renderMsgPlayer(state, pstate, nav, search, tag, ui.sendFailed) : renderMsg(state, nav, search);
    if (nav.app === 'notes') return isPlayer ? renderNotes(pstate, nav, search, true, ui) : renderNotes(state, nav, search);
    if (nav.app === 'forum') {
      // 论坛是公开数据：列表/详情用角色域合并视图（含镜像进来的玩家帖子）；
      // 玩家域额外提供发帖 CTA、帖子编辑入口，表单视图走玩家域数据源。
      return renderForum(isPlayer ? (nav.view === 'form' ? pstate : state) : state, nav, search, tag, isPlayer, ui);
    }
    if (nav.app === 'market') {
      var view = (nav.view && nav.view !== 'root') ? nav.view : 'listings';
      // 坊市订单是私有数据（随域切换）；行情/拍卖是公开数据（跨域一致）；
      // 表单视图（玩家域 CRUD）同样只走玩家数据源。
      return (isPlayer && (view === 'orders' || view === 'form')) ? renderMarket(pstate, nav, search, tag, true, ui) : renderMarket(state, nav, search, tag);
    }
    if (nav.app === 'space') return isPlayer ? renderSpace(pstate, nav, search, true, ui) : renderSpace(state, nav, search);
    // 舆图是私有数据（双域独立数据源）：玩家域渲染玩家域数据，绝不回退角色域
    //（角色所在地/行踪/地点名录属角色私密信息，不得泄漏到玩家域）。
    if (nav.app === 'map') return renderMap(isPlayer ? pstate : state, search, isPlayer ? tag : '', isPlayer);
    if (nav.app === 'sync') return '<main class="yz-page-inner" data-marker="sync">' + yzHeader(I18N.dict().diag.title) + renderSyncDetail(state) + '</main>';
    if (nav.app === 'manage') return renderManage(state, flags, ui);
    return '';
  }

  function yzHeader(title, tabs, tag) {
    return '<header class="yz-app-header">' + yzBackButton() + '<b>' + (tabs ? title : String(title)) + '</b>' +
      (tag ? '<i class="yz-header-tag">' + CORE.escapeHtml(tag) + '</i>' : '') +
      '<span class="yz-spacer"></span></header>';
  }

  function yzTabs(items, active) {
    return '<nav class="yz-tabs">' + items.map(function (item) {
      return '<button type="button" class="yz-tab' + (active === item[0] ? ' active' : '') + '" data-action="switch-view" data-view="' + CORE.escapeHtml(item[0]) + '">' + CORE.escapeHtml(item[1]) + '</button>';
    }).join('') + '</nav>';
  }

  function button(action, label, attrs, cls) {
    attrs = attrs || {};
    var extra = Object.keys(attrs).map(function (key) { return ' data-' + key + '="' + CORE.escapeHtml(attrs[key]) + '"'; }).join('');
    return '<button type="button" class="' + CORE.escapeHtml(cls || '') + '" data-action="' + CORE.escapeHtml(action) + '"' + extra + '>' + label + '</button>';
  }

  function yzBackButton() {
    return '<button type="button" class="yz-btn yz-back" data-action="back" aria-label="' + CORE.escapeHtml(I18N.dict().back) + '">‹</button>';
  }

  function renderShell(state, flags) {
    var t = I18N.dict();
    return '<div id="yz1-overlay" aria-hidden="true"><div id="yz1-jade" role="dialog" tabindex="-1" aria-label="' + CORE.escapeHtml(t.appName) + '">' +
      '<div class="yz-topbar"><b>' + CORE.escapeHtml(t.brand.title) + '</b><span class="yz-sub">' + CORE.escapeHtml(t.brand.sub) + '</span>' +
      '<button type="button" class="yz-btn yz-domain-btn" data-action="toggle-domain" aria-label="' + CORE.escapeHtml(t.playerCharacterDomain) + '">' + CORE.escapeHtml(t.playerCharacterDomain) + '</button>' +
      '<button type="button" class="yz-btn" data-action="close" aria-label="' + CORE.escapeHtml(t.closePhone) + '">×</button></div>' +
      '<div class="yz-screen">' + renderHome(state, flags) + '<div class="yz-page" data-page hidden></div></div>' +
      '</div></div>';
  }

  var VIEWS = {
    FEATURES: FEATURES,
    renderShell: renderShell,
    renderHome: renderHome,
    renderTablet: renderTablet,
    renderMsg: renderMsg,
    renderMsgPlayer: renderMsgPlayer,
    renderNotes: renderNotes,
    renderForum: renderForum,
    renderMarket: renderMarket,
    renderSpace: renderSpace,
    renderMap: renderMap,
    renderManage: renderManage,
    renderPage: renderPage,
    renderSyncDetail: renderSyncDetail,
    renderNodes: renderNodes,
    syncStatusOf: syncStatusOf,
    formatDateTime: formatDateTime,
    snapshotUsage: snapshotUsage,
    unreadTotal: unreadTotal,
    nodeBadge: nodeBadge,
    nextWipeState: nextWipeState,
    WIPE_CONFIRM_MS: WIPE_CONFIRM_MS,
    fieldValue: fieldValue,
    groupName: groupName,
    fieldName: fieldName,
    searchKw: searchKw,
    searchBox: searchBox
  };

  var STYLE_ID = 'yz1-style';
  var OVERLAY_ID = 'yz1-overlay';
  var JADE_ID = 'yz1-jade';
  var FAB_ID = 'yz1-fab';
  var POS_KEY = 'yz_fab_position';
  var FEATURES_KEY = 'yz_features';

  // 悬浮入口默认贴边距离：CSS 初始位置与复位逻辑必须共用这两个常量，
  // 保证「复位」回到的位置就是初始位置，且远离宿主输入区（bottom 取值需真机复核）。
  var FAB_MARGIN_RIGHT = 16;
  var FAB_MARGIN_BOTTOM = 96;

  // 全屏模态与悬浮入口共用同一档顶层 z-index；刻意避开 2147483647 最大值，
  // 给宿主或其它插件的层级协调留一档余量。
  var Z_INDEX_TOP = 2147483646;

  var CSS_TEXT = [
    '#yz1-overlay,#yz1-overlay *{box-sizing:border-box}',
    '#yz1-overlay{position:fixed;inset:0;z-index:' + Z_INDEX_TOP + ';display:none;align-items:center;justify-content:center;padding:max(10px,env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) max(10px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left));background:radial-gradient(circle at 50% 32%,rgba(90,190,150,.14),transparent 62%),rgba(2,8,7,.86);backdrop-filter:blur(14px);font-family:"Songti SC","STZhongsong","Noto Serif SC","PingFang SC",serif;user-select:none;color:#e9f3ee;-webkit-tap-highlight-color:transparent}',
    '#yz1-overlay.open{display:flex}',
    '#yz1-overlay [hidden]{display:none!important}',
    '.yz-home.hidden{display:none!important}',
    '#yz1-overlay button{font-family:inherit;cursor:pointer}',
    '#yz1-jade{width:min(400px,calc(100vw - 20px));height:min(780px,calc(100vh - 20px));min-height:560px;display:flex;flex-direction:column;position:relative}',
    '.yz-topbar{display:flex;align-items:baseline;gap:10px;padding:4px 2px 10px;color:#bfe3d3;font-size:15px}',
    '.yz-topbar b{color:#fff;font-size:19px;letter-spacing:6px;text-shadow:0 0 12px rgba(140,255,210,.45)}',
    '.yz-topbar .yz-sub{flex:1;color:#6fa98f;font-size:11px;letter-spacing:3px}',
    '.yz-btn{border:1px solid rgba(160,235,205,.35);background:rgba(20,60,50,.55);color:#d8f5e8;min-width:30px;height:30px;border-radius:50%;padding:0;font-size:15px;line-height:1;display:grid;place-items:center}',
    '.yz-btn:hover{background:rgba(40,110,90,.7)}',
    '.yz-screen{flex:1;position:relative;overflow:hidden;border-radius:26px;background:linear-gradient(160deg,#0b2b26,#123d35 40%,#0a231f);box-shadow:inset 0 0 0 1px rgba(150,255,215,.16),inset 0 0 44px rgba(0,0,0,.55),0 18px 60px rgba(0,0,0,.55)}',
    '.yz-home{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:18px 18px 14px}',
    '.yz-disc{position:relative;width:max(min(300px,72vw,56vh - 120px),228px);aspect-ratio:1;margin-top:8px;border-radius:50%;background:radial-gradient(circle at 50% 42%,rgba(120,230,185,.14),rgba(20,70,55,.25) 55%,rgba(4,16,13,.9));box-shadow:inset 0 0 60px rgba(90,220,170,.10),0 0 34px rgba(90,220,170,.14);border:1px solid rgba(170,255,220,.18)}',
    '.yz-ring{position:absolute;inset:6%;border-radius:50%;border:1px dashed rgba(150,255,215,.22);pointer-events:none}',
    '.yz-scroll-ring{position:absolute;inset:14%;border-radius:50%;border:1px solid rgba(150,255,215,.10);pointer-events:none}',
    '.yz-node{position:absolute;transform:translate(-50%,-50%);width:23%;aspect-ratio:1;border:1px solid rgba(200,255,230,.24);border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;background:rgba(16,46,38,.62);cursor:pointer;padding:0;color:#dff7ec;font-family:inherit}',
    '.yz-node:hover{filter:brightness(1.3)}',
    '.yz-node .yz-glyph{font-size:clamp(16px,4.6vw,21px);line-height:1;display:block}',
    '.yz-node b{font-size:clamp(9px,2.6vw,11px);letter-spacing:.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:90%}',
    '.yz-node em{position:absolute;bottom:3px;right:9px;font-style:normal;font-size:8px;opacity:.8;color:#9fd8c0}',
    '.yz-node.sealed{filter:grayscale(1);opacity:.4;cursor:not-allowed;border-style:dotted}',
    '.yz-node .yz-seal{position:absolute;bottom:3px;left:9px;font-style:normal;font-size:8px;color:#ffd27a}',
    '.yz-node.yz-node-locked .yz-seal-locked{left:auto;right:9px;color:#ffd27a;border:1px solid rgba(255,210,122,.45);border-radius:7px;padding:0 5px;line-height:14px}',
    '.yz-node.yz-node-locked .yz-glyph,.yz-node.yz-node-locked b{opacity:.55}',
    '.yz-node:not(.sealed) .yz-glyph{animation:yzBreath 3s ease-in-out infinite}',
    '@keyframes yzBreath{0%,100%{opacity:.7}50%{opacity:1}}',
    '.t-gold{color:#ffe9a8;border-color:rgba(255,233,168,.5);text-shadow:0 0 10px rgba(255,233,168,.5)}',
    '.t-silver{color:#dbe7f2;border-color:rgba(219,231,242,.4);text-shadow:0 0 10px rgba(219,231,242,.4)}',
    '.t-vermilion{color:#ff9d8a;border-color:rgba(255,157,138,.4);text-shadow:0 0 10px rgba(255,157,138,.4)}',
    '.t-jade{color:#8ff0c4;border-color:rgba(143,240,196,.4);text-shadow:0 0 10px rgba(143,240,196,.4)}',
    '.t-green{color:#9fe08f;border-color:rgba(159,224,143,.4);text-shadow:0 0 10px rgba(159,224,143,.4)}',
    '.t-azure{color:#8fd0ff;border-color:rgba(143,208,255,.4);text-shadow:0 0 10px rgba(143,208,255,.4)}',
    '.t-rock{color:#c8b8a0;border-color:rgba(200,184,160,.4);text-shadow:0 0 10px rgba(200,184,160,.4)}',
    '.t-ocre{color:#e4c178;border-color:rgba(228,193,120,.4);text-shadow:0 0 10px rgba(228,193,120,.4)}',
    '.yz-core{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:26%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle at 50% 35%,#11392c,#071a15);border:1px solid rgba(200,255,230,.4);box-shadow:0 0 26px rgba(120,255,200,.25);display:grid;place-items:center;cursor:pointer;padding:0;font-family:inherit}',
    '.yz-core:hover{box-shadow:0 0 34px rgba(120,255,200,.45)}',
    '.yz-taiji{font-size:24px;color:#f4fffa;animation:yzSpin 12s linear infinite;line-height:1}',
    '@keyframes yzSpin{to{transform:rotate(360deg)}}',
    '.yz-hero-line{text-align:center;margin-top:6px}',
    '.yz-hero-line b{font-size:16px;letter-spacing:2px;display:block;text-shadow:0 0 12px rgba(140,255,210,.35)}',
    '.yz-hero-line p{margin:4px 0 0;font-size:11px;color:#a7d6c2;max-width:290px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.yz-home-empty{display:block;margin:8px auto 0;max-width:300px;font-style:normal;font-size:11px;line-height:1.6;color:#8fc4ac;white-space:normal}',
    '.yz-sync{display:flex;align-items:center;gap:7px;color:#a7d6c2;font-size:11px;letter-spacing:1px;margin-top:10px;background:none;border:none;padding:0;font-family:inherit;cursor:pointer}',
    '.yz-sync:hover span{text-decoration:underline}',
    '.yz-sync i{width:7px;height:7px;border-radius:50%;background:#5b8f7c;display:inline-block}',
    '.yz-sync.complete i{background:#67e6a8;box-shadow:0 0 8px #67e6a8}',
    '.yz-sync.partial i{background:#ffd27a;box-shadow:0 0 8px #ffd27a}',
    '.yz-sync.invalid i{background:#ff7a6b;box-shadow:0 0 8px #ff7a6b}',
    '.yz-page{position:absolute;inset:0;background:linear-gradient(170deg,#0c2f28,#0a2320);display:flex;flex-direction:column;padding:10px}',
    '.yz-page-inner{flex:1;overflow:auto;padding:0 12px 16px;scrollbar-width:thin;overscroll-behavior:contain}',
    '.yz-app-header{display:flex;align-items:center;gap:8px;padding:4px 0 10px;color:#dff7ec}',
    '.yz-app-header b{flex:1;font-size:15px;letter-spacing:2px;text-align:center}',
    '.yz-spacer{width:30px}',
    '.yz-hero{display:flex;align-items:center;gap:10px;padding:14px;border-radius:16px;background:linear-gradient(120deg,rgba(60,140,110,.28),rgba(30,80,64,.25));border:1px solid rgba(150,255,215,.16);margin-bottom:12px}',
    '.yz-hero .yz-ava{width:46px;height:46px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#b9ffdf,#1c5a45);color:#06251c;display:grid;place-items:center;font-size:20px;flex:none}',
    '.yz-hero b{display:block;font-size:17px;letter-spacing:2px}',
    '.yz-hero small{color:#a7d6c2;font-size:12px}',
    '.yz-group{margin-bottom:12px;border-radius:14px;background:rgba(14,44,36,.55);border:1px solid rgba(150,255,215,.12);overflow:hidden}',
    '.yz-group summary{cursor:pointer;list-style:none}.yz-group summary::-webkit-details-marker{display:none}.yz-group summary::after{content:"▾";float:right;color:#7fae9a;font-size:11px;padding-right:10px;line-height:30px}.yz-group:not([open]) summary::after{content:"▸"}',
    '.yz-group h3{font-size:12px;letter-spacing:3px;color:#c9f5e2;padding:9px 12px;background:rgba(255,255,255,.04);margin:0;font-weight:600}',
    '.yz-group-count{display:inline-block;font-style:normal;font-size:10px;letter-spacing:1px;color:#7fae9a;background:rgba(120,220,175,.1);border:1px solid rgba(150,255,215,.18);border-radius:9px;padding:0 7px;margin-left:8px;line-height:17px;vertical-align:1px}',
    '.yz-field{padding:8px 12px;border-top:1px solid rgba(150,255,215,.07);font-size:13px;line-height:1.6}',
    '.yz-field small{display:block;color:#8fc4ac;font-size:11px;letter-spacing:1px;margin-bottom:2px}',
    '.yz-field p{margin:0;color:#eef9f3;white-space:pre-wrap;word-break:break-word}',
    '.yz-group-pending .yz-field small{color:#7fae99}.yz-dim{color:#527a68;font-style:italic}',
    '.yz-field p{margin:0;color:#eef9f3;white-space:pre-wrap;word-break:break-word}',
    '.yz-empty{text-align:center;color:#a7d6c2;font-size:12px;padding:48px 10px;letter-spacing:1px}',
    '.yz-readonly-hint{position:sticky;top:4px;z-index:2;padding:10px 12px;margin:4px 0 10px;color:#bfe0d0;font-size:11px;letter-spacing:.5px;text-align:left;background:rgba(30,70,58,.72);border:1px dashed rgba(160,235,205,.4);border-radius:8px;backdrop-filter:blur(2px)}',
    '.yz-tabs{display:flex;gap:8px;padding:2px 0 12px}',
    '.yz-tab{flex:1;height:34px;border:1px solid rgba(160,235,205,.3);background:rgba(20,60,50,.5);color:#d8f5e8;border-radius:17px;padding:0;font-size:12px;letter-spacing:2px;font-family:inherit;cursor:pointer}',
    '.yz-tab.active{background:rgba(70,180,140,.35);border-color:rgba(170,255,225,.5);color:#f2fff9}',
    '.yz-page-list{padding-top:4px}',
    '.yz-row{display:flex;gap:10px;align-items:center;width:100%;background:rgba(16,46,38,.6);border:1px solid rgba(150,255,215,.12);border-radius:14px;padding:10px 12px;margin-bottom:8px;cursor:pointer;color:#eef9f3;font-family:inherit;text-align:left}',
    '.yz-row:hover{background:rgba(30,80,64,.7)}',
    '.yz-row .yz-ava{width:40px;height:40px;font-size:16px;flex:none}',
    '.yz-row-copy{flex:1;min-width:0}',
    '.yz-row-copy b{display:flex;justify-content:space-between;gap:6px;font-size:14px;letter-spacing:.5px;font-weight:600}',
    '.yz-row-copy b i{font-style:normal;font-size:11px;color:#8fc4ac;font-weight:400}',
    '.yz-row-copy em{display:block;font-style:normal;font-size:12px;color:#b7e0cd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}',
    '.yz-row time{font-size:10px;color:#7fae9a;flex:none;text-align:right;align-self:flex-start;display:flex;flex-direction:column;gap:4px;align-items:flex-end}',
    '.yz-unread{font-style:normal;background:#ffd27a;color:#241a05;border-radius:9px;min-width:17px;height:17px;line-height:17px;padding:0 5px;font-size:10px;display:inline-block;text-align:center}',
    '.yz-row.yz-unread-row{border-color:rgba(255,210,122,.55);animation:yzUnreadGlow 2.2s ease-in-out infinite}',
    '@keyframes yzUnreadGlow{0%,100%{box-shadow:0 0 0 0 rgba(255,210,122,0)}50%{box-shadow:0 0 16px 2px rgba(255,210,122,.35)}}',
    '.yz-bubbles{padding:10px 2px 4px;display:flex;flex-direction:column;gap:2px}',
    '.yz-bubble-row{display:flex;align-items:flex-end;gap:6px;margin:6px 0}',
    '.yz-bubble-row.self{justify-content:flex-end}',
    '.yz-bubble-ava .yz-ava{width:26px;height:26px;font-size:11px}',
    '.yz-bubble-wrap{max-width:78%}',
    '.yz-sender{display:block;font-size:10px;color:#9fd8c0;margin:0 0 2px 6px;font-weight:600;letter-spacing:.5px}',
    '.yz-bubble{display:inline-block;padding:8px 12px;border-radius:14px;background:rgba(50,110,90,.55);font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word}',
    '.yz-bubble-row.self .yz-bubble{background:rgba(80,150,120,.75)}',
    '.yz-bubble-wrap time{display:block;font-size:10px;color:#7fae9a;margin:3px 6px 0}',
    '.yz-bubble-row.self .yz-bubble-wrap time{text-align:right}',
    '.yz-note-paper{background:linear-gradient(150deg,rgba(40,60,48,.8),rgba(18,40,32,.85));border:1px solid rgba(170,255,225,.2);border-radius:16px;padding:18px 16px;box-shadow:inset 0 0 30px rgba(0,0,0,.3)}',
    '.yz-note-paper small{display:block;color:#8fc4ac;font-size:10px;letter-spacing:2px;margin-bottom:8px}',
    '.yz-note-paper h2{font-size:19px;letter-spacing:2px;margin:0 0 6px;color:#f2fff9;word-break:break-word}',
    '.yz-note-paper time{display:block;color:#7fae9a;font-size:11px;margin-bottom:12px}',
    '.yz-note-paper p{margin:0;color:#e2f3ea;font-size:14px;line-height:1.8;white-space:pre-wrap;word-break:break-word}',
    '.yz-note-row{display:block;width:100%;text-align:left;background:rgba(16,46,38,.6);border:1px solid rgba(150,255,215,.12);border-radius:14px;padding:11px 13px;margin-bottom:8px;cursor:pointer;color:#eef9f3;font-family:inherit}',
    '.yz-note-row b{display:block;font-size:14px;letter-spacing:.5px;margin-bottom:3px}',
    '.yz-note-row p{margin:0;font-size:12px;color:#b7e0cd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.yz-note-row time{display:block;font-size:10px;color:#7fae9a;margin-top:4px}',
    '.yz-folder-glyph{flex:none;font-size:18px;line-height:1}',
    '.yz-static{cursor:default}',
    '.yz-tag{display:inline-block;border:1px solid rgba(159,224,143,.45);color:#9fe08f;border-radius:10px;padding:1px 9px;font-size:10px;letter-spacing:1px;margin:4px 0 8px}',
    '.yz-post-paper{background:linear-gradient(150deg,rgba(40,60,48,.8),rgba(18,40,32,.85));border:1px solid rgba(170,255,225,.2);border-radius:16px;padding:16px 15px;margin-bottom:12px;box-shadow:inset 0 0 30px rgba(0,0,0,.3)}',
    '.yz-post-paper .yz-post-meta{display:flex;justify-content:space-between;gap:8px;color:#8fc4ac;font-size:11px;letter-spacing:1px}',
    '.yz-post-paper h2{font-size:18px;letter-spacing:1px;margin:8px 0 2px;color:#f2fff9;word-break:break-word}',
    '.yz-post-paper p{margin:6px 0 0;color:#e2f3ea;font-size:13px;line-height:1.8;white-space:pre-wrap;word-break:break-word}',
    '.yz-resonance{margin-top:10px;color:#ffd27a;font-size:11px;letter-spacing:1px}',
    '.yz-comments h3{font-size:12px;letter-spacing:2px;color:#c9f5e2;margin:0 0 4px}',
    '.yz-comment{display:flex;gap:8px;padding:9px 0;border-top:1px solid rgba(150,255,215,.08)}',
    '.yz-comment-ava .yz-ava{width:28px;height:28px;font-size:12px}',
    '.yz-comment-copy{flex:1;min-width:0}',
    '.yz-comment-copy b{font-size:12px;color:#9fd8c0;letter-spacing:.5px}',
    '.yz-comment-copy p{margin:3px 0;font-size:13px;color:#eef9f3;line-height:1.6;white-space:pre-wrap;word-break:break-word}',
    '.yz-comment-copy time{font-size:10px;color:#7fae9a}',
    '.yz-res{background:rgba(255,210,122,.16);color:#ffd27a}',
    '.yz-price{color:#ffd27a}',
    '.yz-price-tag{font-style:normal;background:rgba(255,210,122,.14);color:#ffd27a;border-radius:9px;padding:1px 7px;font-size:10px}',
    '.yz-side{color:#8fd0ff}',
    '.yz-side.buy{color:#8fd0ff}',
    '.yz-side.sell{color:#ffd27a}',
    '.yz-coin{flex:none;width:40px;height:40px;border-radius:50%;background:radial-gradient(circle at 32% 28%,#ffe9a8,#8a6d1f);color:#3a2c05;display:grid;place-items:center;font-size:16px}',
    '.yz-amount{align-self:center}',
    '.yz-map-current h3,.yz-map-tracks h3{font-size:12px;letter-spacing:3px;color:#c9f5e2;margin:0 0 8px;font-weight:600}',
    '.yz-map-current{margin-bottom:14px}',
    '.yz-map-pin{flex:none;width:46px;height:46px;border-radius:50%;background:radial-gradient(circle at 32% 28%,#8fd0ff,#123a52);border:1px solid rgba(143,208,255,.4);color:#eaf6ff;display:grid;place-items:center;font-size:20px}',
    '.yz-map-desc{margin:10px 2px 0;font-size:12px;color:#b7e0cd;line-height:1.7;white-space:pre-wrap;word-break:break-word}',
    '.yz-timeline{padding-top:2px}',
    '.yz-track{display:flex;gap:10px;padding:9px 2px;border-top:1px solid rgba(150,255,215,.08)}',
    '.yz-track:first-child{border-top:none}',
    '.yz-track time{flex:none;width:64px;font-size:10px;color:#7fae9a;padding-top:2px;text-align:right}',
    '.yz-track b{display:block;font-size:13px;color:#eef9f3;letter-spacing:.5px}',
    '.yz-track p{margin:2px 0 0;font-size:12px;color:#b7e0cd;line-height:1.6;white-space:pre-wrap;word-break:break-word}',
    // —— 检索框：列表页/详情页顶部的纯内存过滤输入 ——
    '.yz-search{position:relative;margin:2px 0 10px}',
    '.yz-search input{width:100%;height:34px;border:1px solid rgba(160,235,205,.3);background:rgba(14,44,36,.6);border-radius:17px;color:#eef9f3;padding:0 36px 0 14px;font-size:12px;font-family:inherit;letter-spacing:.5px}',
    '.yz-search input::placeholder{color:#7fae9a}',
    '.yz-search input:focus{outline:1px solid rgba(150,255,215,.45)}',
    '.yz-search .yz-search-clear{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:26px;height:26px;border:none;background:none;color:#a7d6c2;font-size:15px;line-height:1;border-radius:50%;display:grid;place-items:center;padding:0;font-family:inherit;cursor:pointer}',
    '.yz-search .yz-search-clear:hover{background:rgba(70,180,140,.25);color:#dff7ec}',
    '.yz-search .yz-search-clear.hidden{display:none!important}',
    // —— 双玉兆：顶栏域切换、页头域/公开标识 ——
    '.yz-domain-btn{min-width:58px;padding:0 10px;border-radius:15px;font-size:11px;letter-spacing:1px;white-space:nowrap}',
    '.yz-header-tag{font-style:normal;font-size:9px;letter-spacing:1px;color:#9fd8c0;border:1px solid rgba(159,224,143,.4);border-radius:9px;padding:1px 7px;flex:none;margin-left:4px}',
    // —— 玩家域传讯：输入框固定在页底，气泡区独立滚动 ——
    '.yz-page-composer{display:flex;flex-direction:column}',
    '.yz-page-composer .yz-bubbles{flex:1;overflow:auto}',
    '.yz-composer{display:flex;gap:8px;padding:10px 0 4px;border-top:1px solid rgba(150,255,215,.12)}',
    '.yz-composer input{flex:1;min-width:0;height:36px;border:1px solid rgba(160,235,205,.3);background:rgba(14,44,36,.6);border-radius:18px;color:#eef9f3;padding:0 14px;font-size:13px;font-family:inherit;letter-spacing:.5px}',
    '.yz-composer input:focus{outline:1px solid rgba(150,255,215,.45)}',
    '.yz-composer input::placeholder{color:#7fae9a}',
    '.yz-send{flex:none;height:36px;border:1px solid rgba(170,255,225,.5);background:rgba(70,180,140,.4);color:#f2fff9;border-radius:18px;padding:0 16px;font-size:12px;letter-spacing:2px;font-family:inherit;cursor:pointer}',
    '.yz-send:hover{background:rgba(90,210,165,.55)}',
    '.yz-msg-status{font-style:normal;color:#7fae9a;font-size:9px;letter-spacing:1px;margin-left:6px}',
    '.yz-msg-status.bad{color:#f2a59a}',
    '.yz-retry-btn{margin:3px 6px 0;padding:2px 10px;border:1px solid rgba(242,165,154,.5);background:rgba(90,30,24,.55);color:#f5c8c0;border-radius:10px;font-size:10px;font-family:inherit;cursor:pointer}',
    '.yz-start-thread{display:block;width:calc(100% - 24px);margin:0 auto;height:38px;border:1px solid rgba(170,255,225,.45);background:rgba(70,180,140,.3);color:#f2fff9;border-radius:19px;font-size:13px;letter-spacing:2px;font-family:inherit;cursor:pointer}',
    // —— 玩家域 CRUD：表单、行尾编辑、底部新建 ——
    '.yz-add-btn{display:block;width:calc(100% - 24px);margin:6px auto 4px;height:38px;border:1px solid rgba(170,255,225,.45);background:rgba(70,180,140,.3);color:#f2fff9;border-radius:19px;font-size:13px;letter-spacing:2px;font-family:inherit;cursor:pointer}',
    '.yz-edit-btn{flex:none;align-self:center;border:1px solid rgba(150,255,215,.2);background:none;color:#9fd8c0;border-radius:10px;height:26px;padding:0 9px;font-size:12px;line-height:1;font-family:inherit;cursor:pointer}',
    '.yz-player-tag{font-style:normal;font-size:9px;letter-spacing:1px;color:#ffe9a8;border:1px solid rgba(255,233,168,.45);border-radius:8px;padding:0 5px;margin-left:5px;vertical-align:1px}',
    '.yz-form{padding:4px 0 12px}',
    '.yz-form label{display:block;font-size:11px;letter-spacing:1px;color:#8fc4ac;margin:10px 2px 4px}',
    '.yz-form-input{width:100%;background:rgba(6,20,16,.85);border:1px solid rgba(150,255,215,.2);border-radius:10px;color:#eef9f3;padding:8px 10px;font-size:13px;font-family:inherit;line-height:1.5}',
    '.yz-form-input:focus{outline:1px solid rgba(150,255,215,.45)}',
    '.yz-form textarea.yz-form-input{resize:vertical;min-height:90px}',
    '.yz-form select.yz-form-input{height:38px}',
    '.yz-form-input.error{border-color:#ff8066;box-shadow:0 0 0 1px rgba(255,128,102,.5)}',
    '.yz-form-field-error{font-size:11px;color:#ff9a85;margin:4px 2px 0;line-height:1.4}',
    '.yz-stepper{display:flex;gap:6px;align-items:center}',
    '.yz-stepper .yz-form-input{flex:1;min-width:0}',
    '.yz-step{flex:0 0 42px;height:36px;border:1px solid rgba(150,255,215,.2);background:rgba(6,20,16,.85);color:#a8e6c8;border-radius:10px;font-size:17px;cursor:pointer;font-family:inherit}',
    '.yz-step:active{transform:scale(.94)}',
    '.yz-archived-note{font-size:11px;color:#7fae9a;text-align:center;padding:7px 0 2px;letter-spacing:.5px;border-bottom:1px dashed rgba(150,255,215,.12);margin-bottom:2px}',
    '.yz-mark-all{display:block;margin:10px auto 2px;background:rgba(120,255,200,.1);border:1px solid rgba(150,255,215,.3);color:#a8e6c8;border-radius:14px;padding:5px 16px;font-size:12px;cursor:pointer;font-family:inherit}',
    '.yz-form-check{display:flex!important;align-items:center;gap:8px;cursor:pointer}',
    '.yz-form-check input{accent-color:#67e6a8;width:16px;height:16px}',
    '.yz-form-actions{display:flex;gap:8px;padding:10px 0 4px;align-items:center}',
    '.yz-form-actions .yz-send{flex:1}',
    '.yz-manage-info{font-size:11px;color:#a7d6c2;line-height:1.7;margin:0 0 12px;padding:10px 12px;border-radius:12px;background:rgba(14,44,36,.5);border:1px solid rgba(150,255,215,.1)}',
    '.yz-manage-row .yz-glyph-sm{flex:none;width:34px;height:34px;border-radius:50%;border:1px solid rgba(200,255,230,.24);display:grid;place-items:center;font-size:16px;background:rgba(16,46,38,.62);line-height:1}',
    '.yz-glyph-sm svg{width:22px;height:22px}',
    '.yz-switch{flex:none;width:40px;height:22px;border-radius:11px;background:rgba(10,30,25,.8);border:1px solid rgba(150,255,215,.25);position:relative;transition:background .2s,border-color .2s}',
    '.yz-switch i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#7fae9a;transition:left .2s,background .2s}',
    '.yz-switch.on{background:rgba(70,180,140,.45);border-color:rgba(170,255,225,.55)}',
    '.yz-switch.on i{left:20px;background:#9fffd9;box-shadow:0 0 8px rgba(120,255,200,.6)}',
    // 全局 Toast 通道：宿主 body 级浮层（不在 overlay 内）——玉兆未打开时 overlay 是
    // display:none，toast 若在 overlay 内则完全不可见（长按 FAB 复位/侧边栏重建等场景）。
    '#yz1-toast{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:' + (Z_INDEX_TOP + 1) + ';pointer-events:none;max-width:88vw}',
    '.yz-toast{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);background:rgba(6,20,16,.94);border:1px solid rgba(150,255,215,.3);color:#eaf7f1;padding:8px 14px;border-radius:20px;font-size:12px;opacity:0;pointer-events:none;transition:opacity .25s;white-space:nowrap;max-width:88%;overflow:hidden;text-overflow:ellipsis}',
    // 带操作按钮的 toast（撤销/确认等）：文案可能较长（如清除确认），nowrap+overflow 会把
    // 按钮挤出可视区——改为允许换行、不裁剪，保证按钮始终可见。
    '.yz-toast.has-action{white-space:normal;max-width:92%;overflow:visible;text-overflow:clip;line-height:1.5}',
    '.yz-toast .yz-toast-action{pointer-events:auto;margin-left:10px;background:rgba(120,255,200,.12);border:1px solid rgba(150,255,215,.4);color:#a8e6c8;border-radius:12px;padding:2px 10px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap}',
    '.yz-toast.show{opacity:1}',
    '.yz-toast.bad{border-color:rgba(255,140,120,.5)}',
    '#yz1-fab{position:fixed;z-index:' + Z_INDEX_TOP + ';width:54px;height:54px;border-radius:50%;bottom:' + FAB_MARGIN_BOTTOM + 'px;right:' + FAB_MARGIN_RIGHT + 'px;border:1px solid rgba(180,255,225,.4);background:radial-gradient(circle at 32% 28%,#2f8f6e,#0b2e25 70%);cursor:pointer;box-shadow:0 8px 26px rgba(0,0,0,.5),0 0 18px rgba(120,255,205,.25);display:grid;place-items:center;padding:0;touch-action:none;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}',
    '#yz1-fab svg{width:100%;height:100%;display:block;pointer-events:none}',
    // 点击反馈与按钮同为圆形：方形触摸高亮已禁用，按压改为缩放 + 提亮。
    '#yz1-fab:active{transform:scale(.9);box-shadow:0 4px 14px rgba(0,0,0,.45),0 0 26px rgba(120,255,205,.5)}',
    '#yz1-fab:focus{outline:none}',
    '#yz1-fab:focus-visible{box-shadow:0 0 0 2px rgba(170,255,225,.7),0 8px 26px rgba(0,0,0,.5),0 0 18px rgba(120,255,205,.25)}',
    '#yz1-fab[hidden]{display:none!important}',
    '#yz1-fab:not(.ready){opacity:0;transition:none}',
    '#yz1-fab.ready{opacity:1;transition:left .2s,top .2s,opacity .3s,transform .12s ease,box-shadow .12s ease}',
    // 拖拽跟手：手势进行中必须关闭位置过渡，否则每次 pointermove 都变成 200ms 缓动，按钮滞后于指针。
    '#yz1-fab.dragging{transition:none}',
    // —— 卦位三态徽标（警示 > 未读 > 新）——
    '.yz-node .yz-badge{position:absolute;font-style:normal;pointer-events:none;z-index:1}',
    '.yz-badge-alert{left:4px;bottom:4px;width:14px;height:14px;border-radius:50%;background:#ff5340;color:#fff;font-size:9px;font-weight:700;display:grid;place-items:center;line-height:1}',
    '.yz-badge-unread{top:-3px;right:-3px;min-width:16px;height:16px;border-radius:8px;background:#ffd27a;color:#241a05;font-size:9px;font-weight:700;display:grid;place-items:center;padding:0 3px;line-height:1}',
    '.yz-node.b-new:not(.sealed){border-color:rgba(159,255,217,.65);box-shadow:0 0 18px rgba(120,255,200,.4)}',
    '.yz-node.b-new:not(.sealed) .yz-glyph{animation:yzBreathFast 1.6s ease-in-out infinite}',
    '@keyframes yzBreathFast{0%,100%{opacity:.55}50%{opacity:1}}',
    // —— 状态圆点（详情页/诊断头复用的四色语义）——
    '.yz-statusdot{width:7px;height:7px;border-radius:50%;background:#5b8f7c;display:inline-block;flex:none}',
    '.yz-statusdot.complete{background:#67e6a8;box-shadow:0 0 8px #67e6a8}',
    '.yz-statusdot.partial{background:#ffd27a;box-shadow:0 0 8px #ffd27a}',
    '.yz-statusdot.invalid{background:#ff7a6b;box-shadow:0 0 8px #ff7a6b}',
    // —— 同步详情页 / 管理页诊断区 ——
    '.yz-diag{margin:0 0 12px;border:1px solid rgba(150,255,215,.14);border-radius:14px;background:rgba(14,44,36,.5);overflow:hidden}',
    '.yz-diag-head{display:flex;width:100%;align-items:center;gap:8px;padding:10px 12px;background:none;border:none;color:#eef9f3;font-family:inherit;font-size:13px;text-align:left;cursor:pointer}',
    '.yz-diag-head b{flex:none;font-size:12px;letter-spacing:1px}',
    '.yz-diag-sum{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:#a7d6c2}',
    '.yz-diag-body{padding:2px 12px 10px;border-top:1px solid rgba(150,255,215,.08)}',
    '.yz-diag-row{padding:7px 0;border-top:1px solid rgba(150,255,215,.06)}',
    '.yz-diag-action{margin:8px 0 4px;padding:9px 10px;border-radius:8px;background:rgba(30,70,58,.6);border:1px dashed rgba(160,235,205,.4);color:#dff3e8;font-size:12px;line-height:1.5}',
    '.yz-diag-tech{margin-top:6px;border-top:1px solid rgba(150,255,215,.06)}.yz-diag-tech summary{cursor:pointer;color:#8fc4ac;font-size:12px;padding:8px 0 2px;letter-spacing:1px}',
    '.yz-diag-tech .yz-diag-row:last-of-type{border-bottom:0}',
    '.yz-diag-row:first-child{border-top:none}',
    '.yz-diag-row small{display:block;color:#8fc4ac;font-size:10px;letter-spacing:1px;margin-bottom:2px}',
    '.yz-diag-row p{margin:0;font-size:12px;color:#eef9f3;word-break:break-word;display:flex;align-items:center;gap:6px;line-height:1.5}',
    '.yz-diag-row em{font-style:normal;color:#7fae9a;font-size:10px;letter-spacing:.5px}',
    '.yz-diag-issues{margin:0;padding-left:16px;color:#ffd27a;font-size:11px;line-height:1.7;word-break:break-word}',
    '.yz-bad-text{color:#ff9d8a;word-break:break-all}',
    '.yz-meter{position:relative;height:6px;border-radius:3px;background:rgba(10,30,25,.9);border:1px solid rgba(150,255,215,.15);margin:4px 0 3px;overflow:hidden}',
    '.yz-meter i{position:absolute;left:0;top:0;bottom:0;background:#67e6a8;border-radius:3px}',
    '.yz-meter.warn i{background:#ff7a6b}',
    // —— 管理页行结构：主按钮 + 行尾清空次级按钮（button 嵌 button 非法，外层用 div）——
    '.yz-manage-main{flex:1;min-width:0;display:flex;align-items:center;gap:10px;background:none;border:none;color:inherit;font-family:inherit;font-size:inherit;text-align:left;cursor:pointer;padding:0}',
    'div.yz-manage-row{padding:6px 10px 6px 12px}',
    '.yz-clear-btn{flex:none;align-self:center;border:1px solid rgba(150,255,215,.2);background:none;color:#7fae9a;border-radius:10px;height:26px;padding:0 9px;font-size:10px;letter-spacing:1px;font-family:inherit;cursor:pointer}',
    '.yz-clear-btn.armed{border-color:rgba(255,122,107,.65);background:rgba(255,122,107,.14);color:#ffb0a3;font-weight:600}',
    // —— 导出 / 导入面板 ——
    '.yz-io{width:100%;height:120px;margin-top:8px;background:rgba(6,20,16,.85);border:1px solid rgba(150,255,215,.2);border-radius:12px;color:#dff7ec;padding:8px;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;line-height:1.5;resize:vertical}',
    '.yz-io:focus{outline:1px solid rgba(150,255,215,.45)}',
    '.yz-io-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:8px}',
    '.yz-io-warn{margin-top:6px;padding:6px 8px;border-radius:8px;background:rgba(120,60,20,.35);border:1px dashed rgba(230,180,120,.45);color:#f2d7b0;font-size:11px;letter-spacing:.5px}',
    // —— 全局确认对话框（危险操作二次确认）——
    // 独立于 overlay 与 toast 的 body 级居中 modal：小 toast 会被宿主侧边栏等布局遮挡，
    // 确认框固定居中 + 半透明遮罩 + 最高 z-index，任何布局下都可见。
    '#yz1-confirm{position:fixed;left:0;top:0;width:100%;height:100%;z-index:' + (Z_INDEX_TOP + 2) + ';display:none;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}',
    '#yz1-confirm.show{display:flex}',
    '#yz1-confirm .yz-confirm-backdrop{position:absolute;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,.55)}',
    '#yz1-confirm .yz-confirm-box{position:relative;max-width:340px;width:100%;background:rgba(8,24,20,.97);border:1px solid rgba(255,140,120,.55);border-radius:16px;padding:16px 16px 14px;box-shadow:0 10px 40px rgba(0,0,0,.6)}',
    '#yz1-confirm .yz-confirm-title{margin:0 0 8px;font-size:14px;font-weight:600;color:#ffb0a3;letter-spacing:1px;text-align:center}',
    '#yz1-confirm .yz-confirm-msg{margin:0 0 14px;font-size:12px;line-height:1.7;color:#eaf7f1;text-align:center;word-break:break-word}',
    '#yz1-confirm .yz-confirm-actions{display:flex;gap:10px}',
    '#yz1-confirm .yz-confirm-actions button{flex:1;height:34px;border-radius:10px;font-size:12px;font-family:inherit;cursor:pointer}',
    '#yz1-confirm .yz-confirm-cancel{background:rgba(20,60,50,.5);border:1px solid rgba(150,255,215,.3);color:#c9e6d6}',
    '#yz1-confirm .yz-confirm-ok{background:rgba(255,122,107,.18);border:1px solid rgba(255,140,120,.65);color:#ffb0a3;font-weight:600}'
  ].join('\n');

  function containsEnvelope(value) {
    return /<yz_[a-z0-9_]+\b/i.test(String(value == null ? '' : value));
  }

  function pickEnvelopePayload(event) {
    event = event || {};
    var text = String(event.text == null ? '' : event.text);
    var content = String(event.content == null ? '' : event.content);
    if (containsEnvelope(text)) return text;
    if (containsEnvelope(content)) return content;
    return text || content;
  }

  function stripEventFields(event) {
    if (!event || typeof event !== 'object') return event;
    var key = Object.prototype.hasOwnProperty.call(event, 'text') ? 'text' : (Object.prototype.hasOwnProperty.call(event, 'content') ? 'content' : '');
    if (!key || event[key] == null) return event;
    var raw = String(event[key]);
    var visible = PROTOCOL.stripBlocks(raw);
    if (!visible && containsEnvelope(raw)) visible = I18N.dict().stripFallback;
    event[key] = visible;
    return event;
  }

  function create(options) {
    options = options || {};
    var tavoApi = options.tavo;
    var localDocument = options.document;
    var localWindow = options.window;
    if (!tavoApi || !localDocument || !localWindow) throw new Error('yu zhao dependencies missing');

    var hostWindow, hostDocument;
    // 玉兆为全屏 overlay 型法器 UI，需覆盖整个视口而非局限于消息流内；
    // 宿主若把插件脚本放进 iframe，则挂载到顶层文档，失败时回退当前文档。
    try {
      hostWindow = localWindow.top && localWindow.top.document ? localWindow.top : localWindow;
      hostDocument = hostWindow.document;
    } catch (_) {
      hostWindow = localWindow;
      hostDocument = localDocument;
    }

    var runtime = RUNTIME.createRuntime(tavoApi, hostWindow && hostWindow.localStorage, function () { return featureFlags; });
    TRANSLATE = makeTranslator(tavoApi);
    var started = false;
    var toastTimer = 0;
    // toast 内嵌操作按钮的回调（撤销删除等）：showToast 注册，点击后执行一次并清空。
    var toastAction = null;
    var drag = null;
    var suppressClickUntil = 0;
    // 是否处于聊天会话中：chat:opened 置真、chat:closed 置假。
    // 宿主没有「当前路由是否为聊天页」的查询 API，这是控制 FAB 只在聊天内显示的唯一信号。
    var chatActive = false;
    var featureFlags = {};
    VIEWS.FEATURES.forEach(function (feature) { if (feature.toggleable) featureFlags[feature.id] = true; });
    var nav = { app: 'home', view: 'root', params: {}, stack: [] };
    // 封印切换后的内存强制全量标记：toggle 时置位，成功应用一轮 full 后清除。
    // 同语义的持久化标记在 state.pendingFull（重启不丢，见 toggleFeature）。
    var flagsDirty = false;
    // 管理页瞬态 UI 状态：诊断折叠区展开、导出/导入面板、两击清空确认（3 秒超时）。
    var diagOpen = false;
    var dataPanel = null;
    var armedWipe = null;
    var wipeTimer = 0;
    // 列表页/详情页检索关键词：纯内存过滤瞬态，任何导航（含关闭）都复位。
    var search = '';
    // 双玉兆域：character = 角色域（模型数据），player = 玩家域（本机数据）。
    // 域切换只换数据源不换 UI（评审结论）；公开数据（论坛/坊市行情拍卖）跨域一致。
    var domain = 'character';
    // 传讯投递失败集合（内存瞬态）：同步角色域失败时标记未送达消息 id，UI 显示「未送达」+ 重发。
    var sendFailed = {};
    // 关闭玉兆时记录离开位置（本会话内再打开恢复；chat:opened 换聊天后清空回主页）。
    var savedNav = null;
    var savedDomain = null;
    // {{user}}（宿主用户身份名）解析缓存：chat:opened 时刷新，渲染时兜底 catalog 文案。
    var playerNameCache = '';

    // 界面语言唯一真值源是宿主 locale（tavo.plugin.i18n）；
    // lang 设置仅决定注入提示词的语言（生成内容语言策略，见 settings.info）。
    function promptLang() {
      try {
        var value = tavoApi.plugin && tavoApi.plugin.config && tavoApi.plugin.config.get('lang');
        return String(value) === 'en' ? 'en' : 'zh';
      } catch (_) { return 'zh'; }
    }

    // 封印标志从全局存储/本地镜像恢复（FEATURES_KEY）；禁用的功能不注入提示词。
    async function loadFeatureFlags() {
      var raw = null;
      try { raw = await Promise.resolve(tavoApi.get(FEATURES_KEY, 'global')); } catch (_) {}
      var parsed = null;
      if (raw) { try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) {} }
      if (!parsed) {
        try { parsed = JSON.parse(hostWindow.localStorage.getItem('yz:features') || 'null'); } catch (_) {}
      }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        VIEWS.FEATURES.forEach(function (feature) {
          if (feature.toggleable) featureFlags[feature.id] = parsed[feature.id] !== false;
        });
      }
    }

    function persistFeatureFlags() {
      var raw = JSON.stringify(featureFlags);
      try { Promise.resolve(tavoApi.set(FEATURES_KEY, raw, 'global')).catch(function () {}); } catch (_) {}
      try { hostWindow.localStorage.setItem('yz:features', raw); } catch (_) {}
    }

    function toggleFeature(featureId) {
      var feature = null;
      VIEWS.FEATURES.forEach(function (item) { if (item.id === featureId) feature = item; });
      if (!feature || !feature.toggleable) return;
      featureFlags[featureId] = featureFlags[featureId] === false;
      flagsDirty = true;
      // 封印变化持久化为强制全量标记（重启丢失内存标记后下一轮仍全量刷新）。
      runtime.current().pendingFull = true;
      runtime.saveChat(runtime.activeChatId);
      persistFeatureFlags();
      render();
    }

    function enabled() {
      try {
        var value = tavoApi.plugin && tavoApi.plugin.config && tavoApi.plugin.config.get('enabled');
        return value !== false;
      } catch (_) { return true; }
    }

    // 是否仍有未封印的功能；全封印时跳过提示词注入。
    function anyFeatureEnabled() {
      return VIEWS.FEATURES.some(function (feature) { return feature.toggleable && featureFlags[feature.id] !== false; });
    }

    function autoStrip() {
      try {
        var value = tavoApi.plugin && tavoApi.plugin.config && tavoApi.plugin.config.get('auto_strip');
        return value !== false;
      } catch (_) { return true; }
    }

    function injectStyle() {
      var style = hostDocument.getElementById(STYLE_ID);
      if (!style) {
        style = hostDocument.createElement('style');
        style.id = STYLE_ID;
        (hostDocument.head || hostDocument.documentElement).appendChild(style);
      }
      if (style.textContent !== CSS_TEXT) style.textContent = CSS_TEXT;
    }

    // 全屏 overlay + FAB 由 entry 直接挂载，而非 contributes.htmlFragments：
    // 法器 UI 是覆盖整个视口的模态界面 + 全局悬浮入口，需要在 generation/message Hook
    // 期间独立于聊天页生命周期存在；/chat 挂载点定位是页面内轻量常驻块，承载不了全屏模态。
    // 代价（宿主不提供页面级生命周期）由以下措施缓解：
    // chatActive 门控 FAB 显隐、chat:closed 收起、禁用时收起并隐藏 FAB、visibilitychange 刷新。
    function ensureShell() {
      injectStyle();
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      if (!overlay) {
        var wrap = hostDocument.createElement('div');
        wrap.innerHTML = VIEWS.renderShell(runtime.current(), featureFlags);
        overlay = wrap.firstElementChild;
        hostDocument.body.appendChild(overlay);
        bindOverlay(overlay);
      }
      var fab = hostDocument.getElementById(FAB_ID);
      if (!fab) {
        fab = hostDocument.createElement('button');
        fab.type = 'button';
        fab.id = FAB_ID;
        fab.setAttribute('aria-label', I18N.dict().fabLabel);
        fab.innerHTML = FAB_ICON;
        hostDocument.body.appendChild(fab);
        bindFab(fab);
        restoreFabPosition(fab);
      }
      // 全局 Toast 宿主：独立于 overlay（overlay 关闭时 display:none 会把 toast 一起藏掉）。
      var toastHost = hostDocument.getElementById('yz1-toast');
      if (!toastHost) {
        toastHost = hostDocument.createElement('div');
        toastHost.id = 'yz1-toast';
        toastHost.className = 'yz-toast';
        toastHost.setAttribute('role', 'status');
        hostDocument.body.appendChild(toastHost);
        // 内嵌操作按钮（撤销等）：点击先收起 toast 再执行注册的 handler（放微任务，避开清空竞态）。
        toastHost.addEventListener('click', function (event) {
          var btn = event.target && event.target.closest ? event.target.closest('.yz-toast-action') : null;
          if (!btn || !toastAction) return;
          var fn = toastAction;
          toastAction = null;
          clearToast();
          setTimeout(fn, 0);
        });
      }
      // 全局确认对话框宿主：body 级居中 modal，独立于 overlay 与 toast——宿主侧边栏
      // 展开等布局变化不会遮挡它（小 toast 会被挤到看不见的位置）。
      var confirmHost = hostDocument.getElementById('yz1-confirm');
      if (!confirmHost) {
        confirmHost = hostDocument.createElement('div');
        confirmHost.id = 'yz1-confirm';
        confirmHost.setAttribute('role', 'alertdialog');
        confirmHost.setAttribute('aria-modal', 'true');
        confirmHost.innerHTML =
          '<div class="yz-confirm-backdrop"></div>' +
          '<div class="yz-confirm-box"><p class="yz-confirm-title"></p><p class="yz-confirm-msg"></p>' +
          '<div class="yz-confirm-actions"><button type="button" class="yz-confirm-cancel"></button>' +
          '<button type="button" class="yz-confirm-ok"></button></div></div>';
        hostDocument.body.appendChild(confirmHost);
        confirmHost.addEventListener('click', function (event) {
          var btn = event.target && event.target.closest ? event.target.closest('.yz-confirm-actions button') : null;
          if (!btn) return;
          if (btn.classList.contains('yz-confirm-ok') && confirmAction) {
            var fn = confirmAction;
            confirmAction = null;
            hideConfirm();
            // 放微任务：先收起确认框再执行清除（与 toast 操作按钮同一防竞态约定）。
            setTimeout(fn, 0);
          } else {
            confirmAction = null;
            hideConfirm();
          }
        });
      }
      return overlay;
    }

    // 危险操作二次确认：居中 modal（遮罩 + 标题 + 文案 + 取消/确认），
    // 比小 toast 醒目得多，宿主侧边栏展开时也不会被遮挡。无操作时保持显示，
    // 用户点「取消」或遮罩外关闭；只有点「确认」才执行 fn。
    var confirmAction = null;
    function showConfirm(title, message, okLabel, fn) {
      var host = hostDocument.getElementById('yz1-confirm');
      if (!host) return;
      confirmAction = fn || null;
      var titleNode = host.querySelector('.yz-confirm-title');
      var msgNode = host.querySelector('.yz-confirm-msg');
      var okBtn = host.querySelector('.yz-confirm-ok');
      var cancelBtn = host.querySelector('.yz-confirm-cancel');
      if (titleNode) titleNode.textContent = title;
      if (msgNode) msgNode.textContent = message;
      if (okBtn) okBtn.textContent = okLabel;
      if (cancelBtn) cancelBtn.textContent = I18N.dict().cancel;
      host.classList.add('show');
    }
    function hideConfirm() {
      var host = hostDocument.getElementById('yz1-confirm');
      if (host) host.classList.remove('show');
    }

    function clearToast() {
      clearTimeout(toastTimer);
      var toast = hostDocument.getElementById('yz1-toast');
      if (toast) { toast.classList.remove('show', 'bad', 'has-action'); toast.innerHTML = ''; }
    }

    // 可选内嵌操作按钮（撤销/确认等）：text 用文本节点（防注入），按钮走委托。
    // duration：默认 2.4s；确认类（如清除玉兆数据）需要更长的阅读/决策窗口。
    function showToast(text, bad, action, duration) {
      var toast = hostDocument.getElementById('yz1-toast');
      if (!toast) return;
      clearTimeout(toastTimer);
      toastAction = action && action.fn ? action.fn : null;
      toast.appendChild(hostDocument.createTextNode(text));
      if (action && action.label) {
        var btn = hostDocument.createElement('button');
        btn.type = 'button';
        btn.className = 'yz-toast-action';
        btn.textContent = action.label;
        toast.appendChild(btn);
      }
      toast.classList.toggle('bad', !!bad);
      toast.classList.toggle('has-action', !!(action && action.label));
      toast.classList.add('show');
      toastTimer = setTimeout(clearToast, duration || 2400);
    }

    // shell DOM 只在首次创建，语言切换不会重建：顶栏品牌与各 aria-label 属于静态节点，
    // 每次渲染时统一刷新，保证切换 App 语言后无上一语言的残留。
    function renderShellStatic(overlay) {
      var t = I18N.dict();
      var jade = overlay.querySelector('#' + JADE_ID);
      if (jade) jade.setAttribute('aria-label', t.appName);
      var brand = overlay.querySelector('.yz-topbar b');
      if (brand) brand.textContent = t.brand.title;
      var sub = overlay.querySelector('.yz-topbar .yz-sub');
      if (sub) sub.textContent = t.brand.sub;
      var closeBtn = overlay.querySelector('[data-action="close"]');
      if (closeBtn) closeBtn.setAttribute('aria-label', t.closePhone);
      // 域切换按钮：文案 = 当前域（一眼可辨数据归属），aria 说明点击后切换到目标域。
      var domainBtn = overlay.querySelector('[data-action="toggle-domain"]');
      if (domainBtn) {
        var current = domain === 'player' ? t.playerDomain : t.playerCharacterDomain;
        var target = domain === 'player' ? t.playerCharacterDomain : t.playerDomain;
        domainBtn.textContent = current;
        domainBtn.setAttribute('aria-label', tr('runtime.player.switchAria', { from: current, to: target }));
      }
    }

    // 域切换：只换数据源不换 UI——停留在当前页面，重渲染后即看到另一域的数据。
    // 公开数据（论坛/坊市行情拍卖）跨域一致不受影响。
    function toggleDomain() {
      domain = domain === 'player' ? 'character' : 'player';
      // 跨域消毒：私有详情子页（聊天详情/笔记/表单等）在另一域可能没有对应实体，
      // 回退到该 app 根视图，避免「找不到联系人/备忘」空页与错线程。
      if (domain === 'player' && (nav.app === 'manage' || nav.app === 'sync')) {
        // 管理页与同步诊断仅对角色域可用：切到玩家域直接回主页。
        nav = { app: 'home', view: 'root', params: {}, stack: [] };
      } else {
        var fallback = null;
        if (nav.app === 'msg') { if (nav.view === 'chat') fallback = 'chats'; }
        else if (nav.app === 'notes') { if (nav.view === 'note' || nav.view === 'folder' || nav.view === 'form') fallback = 'folders'; }
        else if (nav.app === 'market') { if (nav.view === 'form') fallback = 'listings'; }
        else if (nav.app === 'space') { if (nav.view === 'form') fallback = 'items'; }
        else if (nav.app === 'forum') { if (nav.view === 'form') fallback = 'root'; }
        if (fallback) { nav.view = fallback; nav.params = {}; nav.stack = []; }
      }
      resetSearch();
      clearToast();
      render();
    }

    // {{user}} 解析（chat.persona.name）：聊天切换时刷新缓存，供玩家域主界面展示。
    function refreshPlayerName() {
      runtime.resolvePlayerName().then(function (name) {
        playerNameCache = name;
        render();
      }).catch(function () {});
    }

    function render() {
      var overlay = ensureShell();
      renderShellStatic(overlay);
      var state = runtime.current();
      var playerState = runtime.playerCurrent();
      var fab = hostDocument.getElementById(FAB_ID);
      if (fab) {
        // 玉兆打开时隐藏 FAB：全屏面板之上不再飘一个可点的玉佩（点击会静默踢回主页）。
        fab.hidden = !enabled() || !chatActive || overlay.classList.contains('open');
        // aria-label 随语言切换刷新：FAB 只在首次创建，不重渲染。
        fab.setAttribute('aria-label', I18N.dict().fabLabel);
      }
      // 插件被禁用时收起已打开的 overlay。
      if (!enabled() && overlay.classList.contains('open')) close();
      var home = overlay.querySelector('[data-home]');
      var pageNode = overlay.querySelector('[data-page]');
      if (!home || !pageNode) return;
      if (nav.app === 'home') {
        home.classList.remove('hidden');
        pageNode.hidden = true;
        pageNode.innerHTML = '';
        var homeWrap = hostDocument.createElement('div');
        homeWrap.innerHTML = VIEWS.renderHome(state, featureFlags, { domain: domain, playerState: playerState, playerName: playerNameCache });
        if (homeWrap.firstElementChild) home.outerHTML = homeWrap.firstElementChild.outerHTML;
        var freshHome = overlay.querySelector('[data-home]');
        if (freshHome) {
          var syncNode = freshHome.querySelector('[data-sync]');
          if (syncNode && home !== freshHome) renderHomeSync(syncNode, state);
        }
      } else {
        if (home) home.classList.add('hidden');
        // 注意：shell 初始模板中 page 带 hidden 属性（CSS [hidden]{display:none!important}），
        // 必须用 .hidden property 移除属性本身；classList.remove('hidden') 只能移除同名 class。
        pageNode.hidden = false;
        pageNode.innerHTML = VIEWS.renderPage(state, nav, featureFlags, { diagOpen: diagOpen, dataPanel: dataPanel, armed: armedWipe, search: search, sendFailed: sendFailed }, domain, playerState);
        // 聊天详情（私讯/群聊/传讯）滚动到底部：每次重渲染后都贴最新消息，不把用户弹回最旧。
        if (nav.view === 'chat' || nav.view === 'gchat') {
          var bubbles = pageNode.querySelector('.yz-bubbles');
          if (bubbles) bubbles.scrollTop = bubbles.scrollHeight;
        }
        // 检索框每次按键都整体重渲染：焦点丢给新的输入框并恢复光标到末尾，
        // 否则输入一个字符后失去焦点、无法连续键入。
        var focused = hostDocument.activeElement;
        if (focused && focused.getAttribute && focused.getAttribute('data-search-input') !== null) {
          var freshInput = pageNode.querySelector('[data-search-input]');
          if (freshInput) {
            freshInput.focus();
            try { freshInput.setSelectionRange(search.length, search.length); } catch (_) {}
          }
        }
        // 玩家域输入框同理（传讯/群聊发言/论坛评论）：整体重渲染后恢复焦点，支持连续输入。
        if (focused && focused.getAttribute) {
          var boxType = focused.getAttribute('data-msg-input') !== null ? 'data-msg-input'
            : focused.getAttribute('data-group-msg-input') !== null ? 'data-group-msg-input'
            : focused.getAttribute('data-comment-input') !== null ? 'data-comment-input' : '';
          if (boxType) {
            var freshAny = pageNode.querySelector('[' + boxType + ']');
            if (freshAny) freshAny.focus();
          }
        }
      }
    }

    function renderHomeSync(node, state) {
      if (!node) return;
      var t = I18N.dict();
      var st = VIEWS.syncStatusOf(state);
      node.className = 'yz-sync ' + CORE.escapeHtml(st.status);
      node.innerHTML = '<i></i><span>' + CORE.escapeHtml(st.text) + '</span>';
      var sync = state.sync || {};
      var hero = node.parentElement && node.parentElement.querySelector('.yz-hero-line');
      if (hero) {
        var heroTitle = CORE.hasText(sync.roleName) ? sync.roleName : t.appName;
        hero.innerHTML = '<b>' + CORE.escapeHtml(heroTitle) + '</b><p>' + CORE.escapeHtml(sync.summary || t.awaitingSync) + '</p>';
      }
    }

    // 管理页瞬态状态在离开页面（回主页/开功能页/关 overlay）时复位，避免残留确认态或展开面板。
    function resetManagePanels() {
      diagOpen = false;
      dataPanel = null;
      armedWipe = null;
      clearTimeout(wipeTimer);
      wipeTimer = 0;
    }

    // 检索关键词只属于当前页面：任何导航（前进/后退/切换/回主界面/关闭）都清空，
    // 避免残留关键词把下一页的数据也过滤掉。
    function resetSearch() {
      search = '';
    }

    function markAppliedSeen(featureId) {
      var state = runtime.current();
      var seen = CORE.safeArray(state.sync && state.sync.appliedSeen, 20);
      if (seen.indexOf(featureId) >= 0) return;
      state.sync.appliedSeen = seen.concat([featureId]).slice(-20);
      runtime.saveChat(runtime.activeChatId);
    }

    function openFeature(featureId) {
      var t = I18N.dict();
      var feature = null;
      VIEWS.FEATURES.forEach(function (f) { if (f.id === featureId) feature = f; });
      if (!feature) return;
      if (feature.toggleable && featureFlags[featureId] === false) {
        showToast(tr('runtime.toast.sealed', { name: t.features[feature.id] || featureId }), true);
        return;
      }
      // 玉兆管理是角色域本地系统页：玩家域内封印卦位，点击仅提示不可用。
      if (featureId === 'manage' && domain === 'player') {
        showToast(t.playerManageLocked, true);
        return;
      }
      clearToast();
      resetManagePanels();
      // 查看过该卦位即并入 appliedSeen：下一轮快照再次应用时重新点亮「新」徽标。
      markAppliedSeen(featureId);
      nav = { app: featureId, view: 'root', params: {}, stack: [] };
      resetSearch();
      render();
    }

    // 同步详情页：入栈当前页面，返回键逐级回退到入口页。
    function openSyncDetail() {
      clearToast();
      nav.stack.push({ app: nav.app, view: nav.view, params: nav.params });
      nav.app = 'sync';
      nav.view = 'root';
      nav.params = {};
      resetSearch();
      render();
    }

    // 单功能清空：只重置该分区并落盘；绝不动 processedTurns——否则下一轮相同 turnId 会被去重误挡。
    // 玩家真实数据（传讯/发帖）以玩家域为源：清空角色域分区后立即补投镜像，避免
    // 空窗期导出/注入基线缺玩家数据。
    // 两击确认倒计时：武装后每秒刷新 armed 按钮文案（「(N)」），超时由 wipeTimer 复位。
    // 只在 armed 按钮存在时工作，不整页重渲染（避免打断输入/滚动）。
    var wipeTick = null;
    function startWipeCountdown() {
      stopWipeCountdown();
      wipeTick = setInterval(function () {
        if (!armedWipe) { stopWipeCountdown(); return; }
        var remain = Math.max(0, Math.ceil((armedWipe.expiresAt - Date.now()) / 1000));
        var nodes = hostDocument.querySelectorAll('#' + OVERLAY_ID + ' .armed');
        Array.prototype.forEach.call(nodes, function (node) {
          if (!node.dataset || !node.dataset.wipeBase) return;
          node.textContent = node.dataset.wipeBase + '（' + remain + '）';
        });
      }, 500);
    }
    function stopWipeCountdown() {
      if (wipeTick) { clearInterval(wipeTick); wipeTick = null; }
    }

    function clearFeatureData(featureId) {
      var blank = CORE.blankFeatureField(featureId);
      if (!blank) return;
      runtime.current()[CORE.FEATURE_FIELDS[featureId]] = blank;
      runtime.saveChat(runtime.activeChatId);
      if (featureId === 'forum') runtime.syncPlayerPosts(runtime.activeChatId);
      if (featureId === 'msg') runtime.syncPlayerChannel(runtime.activeChatId);
      // 清空后刷新世界书：消息归档条目与全状态快照都同步更新。
      runtime.syncArchive(runtime.activeChatId);
      armedWipe = null;
      showToast(tr('runtime.manage.cleared', { name: I18N.dict().features[featureId] || featureId }));
      render();
    }

    // 侧边栏「清除玉兆数据」：当前聊天的角色域与玩家域全部数据归零。
    // 调用前必须完成二次确认（首击只弹确认 toast，确认按钮才真正清除）。
    function clearAllData() {
      var chatId = runtime.activeChatId;
      var state = runtime.current();
      var player = runtime.playerCurrent();
      Object.keys(CORE.FEATURE_FIELDS).forEach(function (featureId) {
        var blank = CORE.blankFeatureField(featureId);
        if (!blank) return;
        state[CORE.FEATURE_FIELDS[featureId]] = blank;
        if (CORE.FEATURE_FIELDS[featureId] in player) player[CORE.FEATURE_FIELDS[featureId]] = blank;
      });
      // 玩家域评论源同样归零，避免残留回显。
      player.myComments = [];
      runtime.saveChat(chatId);
      runtime.savePlayerChat(chatId, player);
      runtime.syncPlayerPosts(chatId);
      runtime.syncPlayerChannel(chatId);
      runtime.syncArchive(chatId);
      armedWipe = null;
      render();
      showToast(I18N.dict().toast.cleared);
    }

    // 侧边栏清除入口：首击只弹居中确认对话框（防误触不可恢复操作）——
    // 小 toast 会被宿主侧边栏等布局遮挡，确认框固定居中 + 遮罩，任何布局下都可见。
    function armSidebarClear() {
      if (!enabled()) { showToast(I18N.dict().toast.disabled, true); return; }
      var dict = I18N.dict();
      showConfirm(dict.toast.clearTitle, dict.toast.clearConfirm, dict.toast.clearConfirmAction, clearAllData);
    }

    function armOrClearFeature(featureId) {
      var next = VIEWS.nextWipeState(armedWipe, featureId, Date.now());
      clearTimeout(wipeTimer);
      wipeTimer = 0;
      if (!next) {
        stopWipeCountdown();
        clearFeatureData(featureId);
        return;
      }
      armedWipe = next;
      wipeTimer = setTimeout(function () {
        armedWipe = null;
        wipeTimer = 0;
        stopWipeCountdown();
        render();
      }, VIEWS.WIPE_CONFIRM_MS + 50);
      startWipeCountdown();
      render();
    }

    // 全选复制导出的存档：execCommand 在 WebView 内可用性最好，clipboard API 作为补充。
    function copyExport() {
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      var box = overlay && overlay.querySelector('[data-export-output]');
      if (!box) return;
      var dict = I18N.dict();
      box.focus();
      try { box.select(); } catch (_) {}
      try { if (hostDocument.execCommand && hostDocument.execCommand('copy')) return showToast(dict.toast.exported); } catch (_) {}
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(box.value).then(function () { showToast(dict.toast.exported); }, function () { showToast(dict.toast.exportFailed, true); });
          return;
        }
      } catch (_) {}
      showToast(dict.toast.exportFailed, true);
    }

    function submitImport() {
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      var box = overlay && overlay.querySelector('[data-import-input]');
      if (!box) return;
      var result = runtime.importState(box.value);
      if (result.ok) {
        dataPanel = null;
        runtime.syncArchive(runtime.activeChatId);
        showToast(I18N.dict().manage.importDone);
        render();
      } else {
        // 按失败原因分发文案：超长 vs 解析失败，用户能判断是贴错还是太长。
        var dict = I18N.dict();
        showToast(result.reason === 'oversized' ? dict.manage.importOversized : dict.manage.importParse, true);
      }
    }

    function navigateView(view, params) {
      clearToast();
      nav.stack.push({ app: nav.app, view: nav.view, params: nav.params });
      nav.view = view;
      nav.params = params || {};
      if (view === 'chat' || view === 'gchat') clearUnread(view, params && params.id);
      // 打开帖子详情即视为已读：客户端清零 unread（落盘），角标与呼吸光效不再常驻。
      if (view === 'post') clearPostUnread(params && params.id);
      // 打开玩家域传讯线程即已读：线程未读清零（角色回复角标熄灭）。
      if (view === 'chat' && domain === 'player') clearPlayerThreadUnread();
      resetSearch();
      armedWipe = null;
      render();
    }

    function switchView(view) {
      clearToast();
      nav.view = view || 'root';
      nav.params = {};
      nav.stack = [];
      resetSearch();
      armedWipe = null;
      render();
    }

    // 删除成功后的回退：若栈顶指向「刚被删除实体的详情页」（note/post 详情），
    // 跳过它继续向上弹到列表，避免回到「找不到该备忘/帖子」的空页死胡同。
    function backNavSkippingDeleted(kind, id) {
      clearToast();
      while (nav.stack.length) {
        var top = nav.stack[nav.stack.length - 1];
        var isLostDetail = ((kind === 'note') && (top.app === 'notes') && (top.view === 'note') && String(top.params && top.params.id) === String(id)) ||
                           ((kind === 'post') && (top.app === 'forum') && (top.view === 'post') && String(top.params && top.params.id) === String(id));
        if (!isLostDetail) break;
        nav.stack.pop();
      }
      backNav();
    }

    function backNav() {
      clearToast();
      if (nav.stack.length) {
        var previous = nav.stack.pop();
        nav.app = previous.app;
        nav.view = previous.view;
        nav.params = previous.params || {};
      } else {
        goHome();
        return;
      }
      resetSearch();
      armedWipe = null;
      render();
    }

    function clearUnread(view, id) {
      var state = runtime.current();
      if (!id) return;
      if (view === 'chat') {
        CORE.safeArray(state.chats.contacts, 10).forEach(function (c) { if (String(c.id) === String(id)) c.unread = 0; });
      } else {
        CORE.safeArray(state.chats.groups, 6).forEach(function (g) { if (String(g.id) === String(id)) g.unread = 0; });
      }
      runtime.saveChat(runtime.activeChatId);
    }

    // 帖子未读点开即清零（与聊天/群聊同语义）：论坛是公开数据，角色域合并视图渲染，
    // 清零直接落盘角色域状态（diff 未显式带 unread 时模型保留原值，客户端清零为准）。
    function clearPostUnread(id) {
      if (!id) return;
      runtime.markPostRead(id);
      var state = runtime.current();
      CORE.safeArray(state.forum && state.forum.posts, 20).forEach(function (p) {
        if (String(p && p.id) === String(id)) p.unread = 0;
      });
      runtime.saveChat(runtime.activeChatId);
    }

    // 玩家域传讯线程未读清零：打开线程即已读（角色回复不再亮角标）。
    function clearPlayerThreadUnread() {
      var player = runtime.playerCurrent();
      var thread = null;
      CORE.safeArray(player && player.chats && player.chats.contacts, 10).forEach(function (c) {
        if (c && String(c.id) === CORE.PLAYER_THREAD_ID) thread = c;
      });
      if (!thread || !(thread.unread > 0)) return;
      thread.unread = 0;
      runtime.savePlayerChat(runtime.activeChatId, player);
    }

    // 「全部已读」：列表页一键清零线程未读（不进入会话详情）。
    function markThreadAllRead() {
      clearPlayerThreadUnread();
      showToast(I18N.dict().playerMarkAllRead);
      render();
    }

    function goHome() {
      clearToast();
      resetManagePanels();
      nav = { app: 'home', view: 'root', params: {}, stack: [] };
      resetSearch();
      render();
    }

    async function open() {
      if (!enabled()) return;
      ensureShell();
      var id = await runtime.resolveCurrentChatId();
      if (id !== runtime.activeChatId) await runtime.switchChat(id);
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      if (!overlay) return;
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      clearToast();
      resetManagePanels();
      // 回到上次位置：若本会话内曾关闭玉兆，恢复离开时的页面与域（翻一半回来不重头找）；
      // 首开/换聊天后回到主页（savedNav 在 close 时记录、chat:opened 时清空）。
      if (savedNav) {
        nav = savedNav;
        savedNav = null;
      } else {
        nav = { app: 'home', view: 'root', params: {}, stack: [] };
      }
      // 打开默认回到角色域（除非本会话内离开时在玩家域且仍属同一聊天）。
      if (!savedDomain) domain = 'character';
      else domain = savedDomain;
      savedDomain = null;
      resetSearch();
      render();
      // 打开时按当前视觉视口收敛玉兆高度（覆盖 iOS 底部工具栏等 vv < 100vh 的场景）。
      if (typeof overlay.__yzFit === 'function') overlay.__yzFit();
      // 打开时把焦点移入对话框。
      var dialog = overlay.querySelector('#' + JADE_ID) || overlay;
      if (typeof dialog.focus === 'function') dialog.focus();
    }

    function close() {
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      if (!overlay) return;
      clearToast();
      resetManagePanels();
      // 记录离开位置（同一聊天内再打开时恢复），管理页瞬态不保存。
      savedNav = { app: nav.app, view: nav.view, params: nav.params, stack: [] };
      savedDomain = domain;
      nav = { app: 'home', view: 'root', params: {}, stack: [] };
      resetSearch();
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
      var fab = hostDocument.getElementById(FAB_ID);
      if (fab && typeof fab.focus === 'function') fab.focus();
      // 关闭后立即恢复 FAB 显隐（打开时 render 把 fab.hidden 置 true 隐藏了悬浮球；
      // 这里不走 render，直接按同一门控刷新——否则 × 关闭后 FAB 一直消失，
      // 直到下一次 chat:opened/generation 才重新出现，重开玉兆变得繁琐）。
      if (fab) fab.hidden = !enabled() || !chatActive;
    }

    function bindOverlay(overlay) {
      if (overlay.__yzBound) return;
      overlay.__yzBound = true;
      overlay.addEventListener('click', function (event) {
        var target = event.target.closest ? event.target.closest('[data-action]') : null;
        if (target) {
          event.stopPropagation();
          var action = target.getAttribute('data-action');
          if (action === 'close') return close();
          if (action === 'back') return backNav();
          if (action === 'open-feature') return openFeature(target.getAttribute('data-feature'));
          if (action === 'switch-view') return switchView(target.getAttribute('data-view'));
          if (action === 'navigate') return navigateView(target.getAttribute('data-view'), { id: target.getAttribute('data-id') || '' });
          if (action === 'toggle-feature') return toggleFeature(target.getAttribute('data-feature'));
          if (action === 'reset-fab') return resetFabPosition();
          if (action === 'sync-detail') return openSyncDetail();
          // 太极中枢语义收敛：任何位置点击都回主界面（功能页回主页、主页本身无操作）。
          // 同步详情入口收敛到主页底部状态条与「玉兆管理」诊断区，消除同一控件双义。
          if (action === 'core') { if (nav.app !== 'home') return goHome(); return resetSearch(), render(); }
          if (action === 'toggle-diag') { diagOpen = !diagOpen; return render(); }
          if (action === 'clear-feature') return armOrClearFeature(target.getAttribute('data-feature'));
          if (action === 'toggle-data-panel') {
            var panel = target.getAttribute('data-panel');
            dataPanel = dataPanel === panel ? null : panel;
            return render();
          }
          if (action === 'copy-export') return copyExport();
          if (action === 'import-submit') return submitImport();
          if (action === 'clear-search') { resetSearch(); return render(); }
          if (action === 'toggle-domain') return toggleDomain();
          if (action === 'send-msg') return sendPlayerMessage();
          if (action === 'mark-thread-read') return markThreadAllRead();
          if (action === 'retry-msg') return retryPlayerMessage(target.getAttribute('data-id') || '');
          if (action === 'send-group-msg') return sendPlayerGroupMessage();
          if (action === 'send-comment') return sendPlayerComment();
          if (action === 'player-new') return openPlayerForm(target.getAttribute('data-kind'), '', target.getAttribute('data-folder') || '');
          if (action === 'player-edit') return openPlayerForm(target.getAttribute('data-kind'), target.getAttribute('data-id') || '', '');
          if (action === 'player-save') return savePlayerForm(target.getAttribute('data-kind'), target.getAttribute('data-id') || '');
          if (action === 'player-delete') return deletePlayerEntity(target.getAttribute('data-kind'), target.getAttribute('data-id') || '');
          // 数量步进：调整相邻数量输入框的值（不整页重渲染，保留焦点与编辑状态）。
          if (action === 'qty-step') {
            var stepper = target.parentNode;
            var qtyInput = stepper && stepper.querySelector ? stepper.querySelector('[data-form-field="qty"]') : null;
            if (qtyInput) {
              var next = Math.max(0, Math.floor(Number(qtyInput.value) || 0) + (Number(target.getAttribute('data-delta')) || 0));
              qtyInput.value = String(next);
              clearFormErrors();
              qtyInput.focus();
            }
            return;
          }
          return;
        }
        if (event.target === overlay) close();
      });
      // 检索框输入走 input 事件委托：每次键入只更新内存关键词并重渲染，
      // 纯前端过滤，不触碰任何持久化数据（交互基座第一层的只读约束）。
      overlay.addEventListener('input', function (event) {
        var box = event.target.closest ? event.target.closest('[data-search-input]') : null;
        if (!box) return;
        // IME 合成期间（拼音输入法）不触发整页重渲染：每个拼音键位都重建 DOM 会腰斩
        // 合成中的输入法候选；compositionend 后才同步一次。
        if (event.isComposing) return;
        search = String(box.value || '');
        render();
      });
      overlay.addEventListener('compositionend', function (event) {
        var box = event.target && event.target.closest ? event.target.closest('[data-search-input]') : null;
        if (!box) return;
        search = String(box.value || '');
        render();
      });
      // 模态焦点陷阱：Tab / Shift+Tab 在对话框内的可见按钮间循环，避免焦点移出到背后页面。
      overlay.addEventListener('keydown', function (event) {
        // 玩家域输入框（传讯/群聊发言/论坛评论）：回车直接发送（发送后清空输入并重渲染）。
        if (event.key === 'Enter' && event.target && event.target.getAttribute) {
          if (event.target.getAttribute('data-msg-input') !== null) { event.preventDefault(); sendPlayerMessage(); return; }
          if (event.target.getAttribute('data-group-msg-input') !== null) { event.preventDefault(); sendPlayerGroupMessage(); return; }
          if (event.target.getAttribute('data-comment-input') !== null) { event.preventDefault(); sendPlayerComment(); return; }
        }
        if (event.key !== 'Tab') return;
        var focusables = Array.prototype.filter.call(overlay.querySelectorAll('button'), function (el) {
          return !el.disabled && el.offsetParent !== null;
        });
        if (!focusables.length) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        var active = hostDocument.activeElement;
        if (event.shiftKey && (active === first || !overlay.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      });
      // 移动端键盘自适应：视觉视口随键盘抬起收缩（100vh 在 iOS WebView 不跟随），
      // 玉兆高度收敛到可视区，否则底部玩家域输入框（composer）被键盘遮挡。
      var vv = hostWindow.visualViewport;
      if (vv && typeof vv.addEventListener === 'function') {
        var fitViewport = function () {
          var jade = overlay.querySelector('#' + JADE_ID);
          if (!jade) return;
          var room = vv.height - 20;
          var normal = room >= 560;
          jade.style.minHeight = normal ? '' : '0px';
          jade.style.height = normal ? '' : Math.max(320, room) + 'px';
        };
        overlay.__yzFit = fitViewport;
        vv.addEventListener('resize', fitViewport);
      }
      // 输入框聚焦时把玉兆内的输入框滚动进可视区（Android WebView 键盘行为差异兜底）。
      overlay.addEventListener('focusin', function (event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        if (target.getAttribute('data-msg-input') === null && target.getAttribute('data-group-msg-input') === null &&
            target.getAttribute('data-comment-input') === null && target.getAttribute('data-search-input') === null) return;
        if (!hostWindow.visualViewport) return;
        setTimeout(function () {
          if (target.isConnected) target.scrollIntoView({ block: 'nearest' });
        }, 300);
      });
    }

    // 玩家发讯（私讯通道的 UI 侧）：读取输入框 → 写入玩家域 → 投递角色域。
    function sendPlayerMessage() {
      if (!enabled() || domain !== 'player') return;
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      var box = overlay && overlay.querySelector('[data-msg-input]');
      if (!box) return;
      var text = String(box.value || '');
      if (!CORE.hasText(text.trim())) { showToast(I18N.dict().playerEmptyInput, true); return; }
      box.value = '';
      var sent = runtime.sendPlayerMessage(runtime.activeChatId, text);
      if (!sent) return;
      showToast(I18N.dict().playerSentToast);
      // 投递到角色域是异步落盘：成功清失败标记并重渲染；失败标记「未送达」供重发。
      runtime.syncPlayerChannel(runtime.activeChatId).then(function () {
        delete sendFailed[sent.id];
        render();
      }).catch(function () {
        sendFailed[sent.id] = true;
        showToast(I18N.dict().playerSendFailed, true);
        render();
      });
      render();
    }

    // 重发未送达的传讯：重新执行镜像（幂等，id 去重不会产生重复行）。
    function retryPlayerMessage(messageId) {
      if (!enabled() || domain !== 'player') return;
      runtime.syncPlayerChannel(runtime.activeChatId).then(function () {
        delete sendFailed[String(messageId)];
        showToast(I18N.dict().playerSentToast);
        render();
      }).catch(function () {
        showToast(I18N.dict().playerSendFailed, true);
        render();
      });
    }

    // 玩家群聊发言（公开数据上的真实发言）：读输入框 → 写入玩家域源 → 镜像角色域群组。
    function sendPlayerGroupMessage() {
      if (!enabled() || domain !== 'player') return;
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      var box = overlay && overlay.querySelector('[data-group-msg-input]');
      if (!box) return;
      var groupId = box.getAttribute('data-group-id');
      var text = String(box.value || '');
      if (!CORE.hasText(text.trim())) { showToast(I18N.dict().playerEmptyInput, true); return; }
      box.value = '';
      var sent = runtime.sendPlayerGroupMessage(runtime.activeChatId, groupId, text);
      if (!sent) return;
      showToast(I18N.dict().playerGroupSentToast);
      // 群聊详情渲染的是角色域数据（公开数据）：镜像需先 await resolvePlayerName，
      // 镜像完成后必须再重渲染一次，否则发送的消息要等下次导航才出现。
      runtime.syncPlayerGroups(runtime.activeChatId).then(function () { render(); }).catch(function () { render(); });
      render();
    }

    // 玩家论坛评论（公开数据上的真实发言）：读输入框 → 写入玩家域源 → 镜像角色域帖子。
    function sendPlayerComment() {
      if (!enabled() || domain !== 'player') return;
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      var box = overlay && overlay.querySelector('[data-comment-input]');
      if (!box) return;
      var postId = box.getAttribute('data-post-id');
      var text = String(box.value || '');
      if (!CORE.hasText(text.trim())) { showToast(I18N.dict().playerEmptyInput, true); return; }
      box.value = '';
      var sent = runtime.sendPlayerComment(runtime.activeChatId, postId, text);
      if (!sent) return;
      showToast(I18N.dict().playerCommentSentToast);
      // 帖子详情渲染的是角色域数据（公开数据）：镜像完成后必须再重渲染一次，
      // 否则玩家评论要等下次导航才出现。
      runtime.syncPlayerPosts(runtime.activeChatId).then(function () { render(); }).catch(function () { render(); });
      render();
    }

    // ---------- 玩家域 CRUD UI 动作 ----------
    // 玩家直写不经模型评估；表单页通过 nav.view='form' + params 承载。
    function openPlayerForm(kind, id, folderId) {
      if (domain !== 'player') return;
      clearToast();
      nav.stack.push({ app: nav.app, view: nav.view, params: nav.params });
      nav.view = 'form';
      nav.params = { kind: kind, id: id || '', folderId: folderId || '' };
      resetSearch();
      armedWipe = null;
      render();
    }

    // 保存：读取表单全部 data-form-field（含隐藏 folderId、checkbox）→ 直写玩家域。
    // 保存失败定位化：reason → 具体字段 + 输入框高亮 focus + 行内错误提示。
    // 表单页不整页重渲染（渲染会用落盘值覆盖编辑中内容），这里直接操作 DOM。
    function clearFormErrors() {
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      if (!overlay) return;
      Array.prototype.forEach.call(overlay.querySelectorAll('.yz-form-input.error'), function (el) { el.classList.remove('error'); });
      Array.prototype.forEach.call(overlay.querySelectorAll('.yz-form-field-error'), function (el) { el.remove(); });
    }

    function flagFormError(fieldKey, message) {
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      if (!overlay) return;
      clearFormErrors();
      var box = overlay.querySelector('[data-form-field="' + fieldKey + '"]');
      if (!box) return;
      box.classList.add('error');
      var note = hostDocument.createElement('p');
      note.className = 'yz-form-field-error';
      note.textContent = message;
      box.parentNode.insertBefore(note, box.nextSibling);
      box.focus();
    }

    function savePlayerForm(kind, id) {
      if (domain !== 'player') return;
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      var scope = overlay && overlay.querySelector('[data-page]');
      if (!scope) return;
      var raw = {};
      var fields = scope.querySelectorAll('[data-form-field]');
      Array.prototype.forEach.call(fields, function (el) {
        var key = el.getAttribute('data-form-field');
        if (el.type === 'checkbox') raw[key] = el.checked;
        else raw[key] = el.value;
      });
      var dict = I18N.dict();
      // reason → 字段名（playerFormFields 的 key 与运行时校验点一致）。
      var REASON_FIELD = { name: 'name', title: 'title', kind: 'kind', kindClash: 'kind' };
      var result = runtime.playerSaveEntity(kind, raw, id);
      if (!result || !result.ok) {
        var reason = (result && result.reason) || '';
        if (reason === 'folder') {
          clearFormErrors();
          showToast(dict.playerFormNeedFolder, true);
          return;
        }
        if (reason === 'missing') { showToast(dict.playerFormMissing, true); return; }
        var fieldKey = REASON_FIELD[reason];
        if (fieldKey) {
          var label = '';
          playerFormFields(kind, null, dict).forEach(function (f) { if (f.key === fieldKey) label = f.label; });
          var message = reason === 'kindClash' ? dict.playerFormKindClash : tr('runtime.player.formFieldError', { field: label || dict.playerFieldName });
          flagFormError(fieldKey, message);
          showToast(message, true);
          return;
        }
        showToast(dict.playerFormRequired, true);
        return;
      }
      // 发帖保存要等镜像进角色域（公开数据）后再回列表，列表立即能看到新帖。
      var finish = function () { showToast(I18N.dict().playerSaved); backNav(); };
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).then(finish, function () { showToast(I18N.dict().playerFormRequired, true); });
        return;
      }
      finish();
    }

    // 删除：两击确认（复用管理页武装状态机，key = kind:id），确认后直写删除。
    // 删除成功给出「撤销」入口（会话内快照）：玉册夹级联删除其下备忘也一并还原。
    var undoSnap = null;

    function undoDelete() {
      if (!undoSnap) return;
      var snap = undoSnap;
      undoSnap = null;
      var result = runtime.playerRestoreEntity(snap.kind, snap);
      if (result && result.ok) {
        showToast(I18N.dict().playerRestored);
        render();
      } else {
        showToast(I18N.dict().playerFormMissing, true);
      }
    }

    function deletePlayerEntity(kind, id) {
      if (domain !== 'player') return;
      var key = kind + ':' + id;
      var next = VIEWS.nextWipeState(armedWipe, key, Date.now());
      clearTimeout(wipeTimer);
      wipeTimer = 0;
      if (!next) {
        // 删除前快照（供撤销）：玉册夹连同其下备忘一起带走。
        var snapshot = { kind: kind, id: String(id), entity: null, notes: [] };
        var player = runtime.playerCurrent();
        var entity = CORE.playerFindEntity(player, kind, id);
        if (entity) snapshot.entity = CORE.clone(entity);
        if (kind === 'folder' && CORE.safeArray(player.notes && player.notes.notes, 30)) {
          snapshot.notes = CORE.safeArray(player.notes.notes, 30).filter(function (n) { return String(n && n.folderId) === String(id); }).map(function (n) { return CORE.clone(n); });
        }
        var result = runtime.playerDeleteEntity(kind, id);
        armedWipe = null;
        if (result.ok) {
          undoSnap = snapshot.entity ? snapshot : null;
          if (undoSnap) showToast(I18N.dict().playerDeleted, false, { label: I18N.dict().playerUndo, fn: undoDelete });
          else showToast(I18N.dict().playerDeleted);
          backNavSkippingDeleted(kind, id);
          return;
        }
        showToast(result && result.reason === 'missing' ? I18N.dict().playerFormMissing : I18N.dict().playerFormRequired, true);
        return;
      }
      armedWipe = next;
      wipeTimer = setTimeout(function () {
        armedWipe = null;
        stopWipeCountdown();
        // 武装超时（未确认）：只复位按钮文案，不整页重渲染——表单里未保存的编辑不能被
        // 实体旧值覆盖（整页 render 会用落盘实体重建表单，丢失编辑中的输入）。
        var node = hostDocument.querySelector('#' + OVERLAY_ID + ' .yz-clear-btn.armed[data-wipe-base]');
        if (node) {
          node.classList.remove('armed');
          node.textContent = I18N.dict().playerDelete;
        } else {
          render();
        }
      }, VIEWS.WIPE_CONFIRM_MS + 50);
      startWipeCountdown();
      // 武装第一击：只更新按钮文案（局部 DOM），不整页重渲染——保留表单未保存的编辑。
      var btn = hostDocument.querySelector('#' + OVERLAY_ID + ' .yz-clear-btn[data-action="player-delete"][data-kind="' + CORE.escapeHtml(kind) + '"][data-id="' + CORE.escapeHtml(String(id)) + '"]');
      if (btn) {
        btn.classList.add('armed');
        btn.setAttribute('data-wipe-base', I18N.dict().playerDeleteConfirm);
        btn.textContent = I18N.dict().playerDeleteConfirm;
        return;
      }
      render();
    }

    function clampFab(fab, left, top) {
      var width = fab.offsetWidth || 54, height = fab.offsetHeight || 54;
      var maxX = Math.max(6, hostWindow.innerWidth - width - 6);
      var maxY = Math.max(6, hostWindow.innerHeight - height - 6);
      return { x: Math.max(6, Math.min(Number(left) || 6, maxX)), y: Math.max(6, Math.min(Number(top) || 6, maxY)) };
    }

    function placeFab(fab, position) {
      var next = clampFab(fab, position.x, position.y);
      fab.style.left = next.x + 'px';
      fab.style.top = next.y + 'px';
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
      return next;
    }

    async function restoreFabPosition(fab) {
      var value = null;
      try { value = await Promise.resolve(tavoApi.get(POS_KEY, 'global')); } catch (_) {}
      if (!value) {
        try { value = hostWindow.localStorage.getItem('yz:fab_position'); } catch (_) {}
      }
      if (value) {
        try { placeFab(fab, typeof value === 'string' ? JSON.parse(value) : value); } catch (_) {}
      }
      fab.classList.add('ready');
    }

    async function persistFab(position) {
      var raw = JSON.stringify(position);
      try { await Promise.resolve(tavoApi.set(POS_KEY, raw, 'global')); } catch (_) {}
      try { hostWindow.localStorage.setItem('yz:fab_position', raw); } catch (_) {}
    }

    function resetFabPosition() {
      var fab = hostDocument.getElementById(FAB_ID);
      if (!fab) return;
      var width = fab.offsetWidth || 54, height = fab.offsetHeight || 54;
      var x = Math.max(6, hostWindow.innerWidth - width - FAB_MARGIN_RIGHT);
      var y = Math.max(6, hostWindow.innerHeight - height - FAB_MARGIN_BOTTOM);
      placeFab(fab, { x: x, y: y });
      persistFab({ x: x, y: y });
      suppressClickUntil = Date.now() + 600;
      showToast(I18N.dict().toast.fabReset);
    }

    function bindFab(fab) {
      if (fab.__yzBound) return;
      fab.__yzBound = true;
      var holdTimer = 0;
      function cancelHold() { if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; } }
      fab.addEventListener('click', function (event) {
        if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation(); return; }
        open();
      });
      fab.addEventListener('pointerdown', function (event) {
        if (event.button != null && event.button !== 0) return;
        var rect = fab.getBoundingClientRect();
        drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false };
        try { fab.setPointerCapture(event.pointerId); } catch (_) {}
        cancelHold();
        holdTimer = setTimeout(function () {
          holdTimer = 0;
          if (!drag || drag.moved) return;
          drag = null;
          fab.classList.remove('dragging');
          resetFabPosition();
        }, 900);
      });
      hostDocument.addEventListener('pointermove', function (event) {
        if (!drag || (drag.pointerId != null && event.pointerId !== drag.pointerId)) return;
        var dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        cancelHold();
        drag.moved = true;
        fab.classList.add('dragging');
        placeFab(fab, { x: drag.left + dx, y: drag.top + dy });
      }, true);
      function finish(event) {
        if (!drag || (drag.pointerId != null && event.pointerId !== drag.pointerId)) return;
        cancelHold();
        var moved = drag.moved;
        drag = null;
        fab.classList.remove('dragging');
        if (moved) {
          suppressClickUntil = Date.now() + 500;
          var rect = fab.getBoundingClientRect();
          persistFab({ x: Math.round(rect.left), y: Math.round(rect.top) });
        }
      }
      hostDocument.addEventListener('pointerup', finish, true);
      hostDocument.addEventListener('pointercancel', finish, true);
      hostWindow.addEventListener('resize', function () {
        var rect = fab.getBoundingClientRect();
        placeFab(fab, { x: rect.left, y: rect.top });
      });
    }

    // —— 正文协议块剥离（DOM 层）——
    // 权威路径在 Hook 层：generation:success 同步剥离事件正文，message hook 应用快照；
    // DOM 扫描只是兜底，覆盖宿主自行重渲染消息文本的场景（如滚动时懒渲染旧楼层）。
    // 禁用插件或关闭 auto_strip 时必须停止一切 DOM 改写。
    function isOwnNode(node) {
      var el = node && node.nodeType === 1 ? node : node && node.parentElement;
      if (!el || typeof el.closest !== 'function') return false;
      return !!(el.closest('#' + OVERLAY_ID) || el.closest('#' + FAB_ID));
    }

    function looksLikeEnvelope(value) {
      return /(?:<|&lt;)y(?:z|$)/i.test(String(value == null ? '' : value));
    }

    function stripNodes(nodes) {
      Array.prototype.forEach.call(nodes, function (node) {
        if (isOwnNode(node)) return;
        if (!node.nodeValue || !looksLikeEnvelope(node.nodeValue)) return;
        var next = PROTOCOL.stripStreamTail(node.nodeValue);
        if (next !== node.nodeValue) node.nodeValue = next;
      });
    }

    function collectTextNodes(root, out) {
      if (!root || isOwnNode(root)) return;
      if (root.nodeType === 3) { out.push(root); return; }
      if (root.nodeType !== 1) return;
      try {
        var walker = hostDocument.createTreeWalker(root, hostWindow.NodeFilter.SHOW_TEXT);
        var node;
        while ((node = walker.nextNode())) out.push(node);
      } catch (_) {}
    }

    // 全量扫描：启动时与每条协议消息后执行（协议消息可能含旧协议残留）。
    function stripVisibleBlocks() {
      if (!enabled() || !autoStrip()) return;
      var nodes = [];
      collectTextNodes(hostDocument.body, nodes);
      stripNodes(nodes);
    }

    // 只处理本批变更实际触及的文本节点：
    // characterData 的 target 就是文本节点本身；childList 取新增节点内的文本。
    function stripFromMutations(mutations) {
      if (!enabled() || !autoStrip() || !mutations.length) return;
      var nodes = [];
      mutations.forEach(function (mutation) {
        if (mutation.type === 'characterData') {
          if (mutation.target && mutation.target.nodeType === 3) nodes.push(mutation.target);
          return;
        }
        if (mutation.addedNodes && mutation.addedNodes.length) {
          Array.prototype.forEach.call(mutation.addedNodes, function (added) { collectTextNodes(added, nodes); });
        }
      });
      stripNodes(nodes);
    }

    function bindHooks() {
      var plugin = tavoApi.plugin;
      if (!plugin) return;
      if (typeof plugin.onInputAction === 'function') plugin.onInputAction('open-jade', open);
      // 侧边栏动作：聊天级、低频、明确的工具入口；与管理页操作复用同一实现。
      if (typeof plugin.onSidebarAction === 'function') {
        plugin.onSidebarAction('open-jade', function () { return open(); });
        plugin.onSidebarAction('resync-history', async function () {
          // 禁用态与 open() 同语义：统一门控，不静默、不真实改数据。
          if (!enabled()) { showToast(I18N.dict().toast.disabled, true); return; }
          var result = null;
          try {
            result = await runtime.rebuildFromHistory(runtime.activeChatId);
          } catch (error) {
            dbg('snapshot restore failed', error);
            showToast(I18N.dict().toast.restoreFailed, true);
            return;
          }
          runtime.syncArchive(runtime.activeChatId);
          render();
          // stale：异步窗口内切了聊天（结果不属于当前会话），不误报「无快照」。
          if (result && result.stale) { showToast(I18N.dict().toast.stale, true); return; }
          showToast(result && result.restored ? I18N.dict().toast.rebuilt : I18N.dict().toast.noSnapshot);
        });
        plugin.onSidebarAction('clear-data', armSidebarClear);
      }
      if (typeof plugin.on !== 'function') return;

      plugin.on('chat:opened', async function (event) {
        chatActive = true;
        await runtime.switchChat(await runtime.resolveCurrentChatId(event));
        nav = { app: 'home', view: 'root', params: {}, stack: [] };
        // 换聊天后放弃上一聊天的离开位置：新会话从主页开始。
        savedNav = null;
        savedDomain = null;
        // 切换聊天后刷新 {{user}} 玩家名缓存（用户身份可能随聊天不同）。
        refreshPlayerName();
        render();
      });

      plugin.on('chat:updated', async function (event) {
        var hostId = await runtime.resolveCurrentChatId();
        var eventId = runtime.eventChatId(event);
        if (eventId && eventId !== hostId) return;
        if (hostId !== runtime.activeChatId) await runtime.switchChat(hostId);
        render();
      });

      plugin.on('chat:closed', function () {
        // 离开聊天（含切到宿主设置等非聊天页）时收起 overlay 并隐藏 FAB：
        // 避免继续显示上一个聊天的数据，也避免悬浮入口压在非聊天页面上。
        chatActive = false;
        close();
        render();
      });

      plugin.on('generation:prepare', async function (event) {
        if (!enabled()) return event;
        // 七个功能全部封印时提示词只剩空壳，模型也不会输出协议块：直接跳过注入省 token。
        if (!anyFeatureEnabled()) return event;
        // 重新生成/继续同样经过这里：注入基线前先确保目标聊天的持久化状态已加载完毕
        // （插件重载后 switchChat 的加载/水化是异步的，直接读内存会拿到空白态 → 空基线）。
        var chatId = await runtime.resolveCurrentChatId(event);
        if (chatId !== runtime.activeChatId) await runtime.switchChat(chatId);
        await runtime.settle();
        var state = runtime.current();
        var ctx = {
          // 强制全量轮：从未同步、封印切换/版本更新后的持久化标记，或本轮内存标记；其余轮次一律 diff 增量。
          forceFull: state.revision === 0 || flagsDirty || state.pendingFull === true,
          issues: CORE.safeArray(state.sync && state.sync.issues, 20),
          // 当前数据基线：全量轮与 diff 轮都注入，模型据此沿用既有 id 与未变化行（多轮连续性）。
          current: PROMPT.buildCurrent(state, featureFlags)
        };
        // 传讯通道已读游标：基线注入即已读（评审结论）。玩家消息随基线进入模型上下文，
        // 未读数随之清零；消息本体保留在角色域线程中，模型可继续回复。
        if (featureFlags.msg !== false) runtime.markPlayerRead(chatId);
        return PROMPT.mutatePrepareEvent(event, promptLang(), featureFlags, ctx);
      });

      plugin.on('generation:success', async function (event) {
        if (!enabled()) return event;
        var raw = pickEnvelopePayload(event);
        // 该 Hook 每个 handler 只有约 5 秒预算且超时整体丢弃：先同步完成纯字符串的正文剥离
        // （阻止协议块进入已保存消息的关键动作），快照应用走异步、持久化已在 runtime 后台化。
        if (autoStrip()) stripEventFields(event);
        if (containsEnvelope(raw)) {
          try {
            var chatId = await runtime.resolveCurrentChatId(event);
            var result = await runtime.applyText(raw, chatId, 'generation:success');
            if (result.parseError) showToast(I18N.dict().toast.parseError, true);
            if (result.oversized) showToast(I18N.dict().toast.oversized, true);
            // 成功落过一轮全量后清除强制全量标记（内存 + 持久化）。
            if (result.full && result.changed) {
              flagsDirty = false;
              var st = runtime.current();
              if (st && st.pendingFull) {
                st.pendingFull = false;
                runtime.saveChat(runtime.activeChatId);
              }
            }
            // 数据有变化时后台刷新世界书（消息归档条目 + 全状态快照；不占用本 Hook 的 5 秒预算等待）。
            if (result.changed) runtime.syncArchive(chatId);
          } catch (error) { dbg('generation:success apply failed', error); }
        }
        render();
        return event;
      });

      var rebuildTimer = 0;
      // 不带信封的 message:updated（编辑中间楼层等）不改变水化签名：去抖从世界书快照
      // 恢复一次，让法器数据与权威存储保持一致（数据源是世界书，编辑正文不影响它）。
      function scheduleRebuild() {
        if (rebuildTimer) return;
        rebuildTimer = setTimeout(async function () {
          rebuildTimer = 0;
          try {
            await runtime.rebuildFromHistory(runtime.activeChatId);
            runtime.syncArchive(runtime.activeChatId);
            render();
          } catch (error) { dbg('snapshot restore failed', error); }
        }, 600);
      }

      async function onMessage(event) {
        if (!enabled()) return;
        var message = event && event.message || {};
        if (message.role !== 'assistant') return;
        var payload = pickEnvelopePayload(message);
        if (!containsEnvelope(payload)) {
          if ((event.type || '') === 'message:updated') scheduleRebuild();
          return;
        }
        var chatId = await runtime.resolveCurrentChatId(event);
        var result = await runtime.applyText(payload, chatId, event.type || 'message');
        if (result.parseError) showToast(I18N.dict().toast.parseError, true);
        if (result.oversized) showToast(I18N.dict().toast.oversized, true);
        if (result.changed) runtime.syncArchive(chatId);
        render();
        setTimeout(stripVisibleBlocks, 0);
      }

      plugin.on('message:added', onMessage);
      plugin.on('message:updated', onMessage);

      plugin.on('message:deleted', async function (event) {
        var id = await runtime.resolveCurrentChatId(event);
        if (id !== runtime.activeChatId) return;
        await runtime.rebuildFromHistory(id);
        runtime.syncArchive(id);
        render();
      });

      plugin.on('generation:error', function () { if (enabled()) showToast(I18N.dict().toast.generationError, true); });
      plugin.on('generation:cancelled', function () { if (enabled()) showToast(I18N.dict().toast.cancelled, true); });
    }

    async function start() {
      if (started) return;
      started = true;
      bindHooks();
      try {
        var i18nApi = tavoApi.plugin && tavoApi.plugin.i18n;
        if (i18nApi && typeof i18nApi.onChange === 'function') i18nApi.onChange(function () { I18N.invalidate(); render(); });
      } catch (_) {}
      await loadFeatureFlags();
      ensureShell();
      var id = await runtime.resolveCurrentChatId();
      await runtime.switchChat(id);
      refreshPlayerName();
      // FAB chatActive 启动兜底：宿主可能已停在聊天页而不重发 chat:opened（插件重载等），
      // 此时 FAB 会永久隐藏。启动时主动探测一次：宿主 API 能返回当前聊天即视为在聊天中
      // （不能用 resolveCurrentChatId——它回退到 activeChatId，非聊天页也会得到非空值）。
      try {
        var startChat = tavoApi.chat && typeof tavoApi.chat.current === 'function' ? await Promise.resolve(tavoApi.chat.current()) : null;
        if (startChat && startChat.id != null && CORE.hasText(startChat.id)) chatActive = true;
      } catch (_) {}
      render();
      hostDocument.addEventListener('keydown', function (event) { if (event.key === 'Escape') close(); }, true);
      // 从设置页等返回聊天页时刷新 FAB 显隐与 overlay 状态（配置变化无 Hook 可订阅；
      // 部分环境返回时不翻转 visibilitychange，补充 window focus 兜底）。
      hostDocument.addEventListener('visibilitychange', function () { if (!hostDocument.hidden) render(); });
      hostWindow.addEventListener('focus', function () { render(); });
      // 增量剥离通道：变更记录排队 + 220ms 防抖，只扫描新增/变化的文本节点，
      // 避免流式生成期间的高频变更触发全文档扫描。队列设上限防内存膨胀。
      var stripTimer = 0;
      var pendingMutations = [];

      function scheduleStrip(batch) {
        pendingMutations = pendingMutations.concat(batch);
        if (pendingMutations.length > 2000) pendingMutations = pendingMutations.slice(-2000);
        if (stripTimer) return;
        stripTimer = setTimeout(function () {
          stripTimer = 0;
          var queued = pendingMutations;
          pendingMutations = [];
          var overlay = hostDocument.getElementById(OVERLAY_ID);
          // overlay 打开时用户在法器界面内，本轮后台剥离直接放弃。
          if (overlay && overlay.classList.contains('open')) return;
          stripFromMutations(queued);
        }, 220);
      }

      try {
        var observer = new hostWindow.MutationObserver(scheduleStrip);
        observer.observe(hostDocument.documentElement, { childList: true, subtree: true, characterData: true });
      } catch (error) { dbg('MutationObserver unavailable', error); }
      stripVisibleBlocks();
    }

    // 宿主只消费 start；open/close/render 均由闭包内的绑定函数直接引用。
    return { start: start };
  }

  var APP = { create: create, pickEnvelopePayload: pickEnvelopePayload, stripEventFields: stripEventFields };

  /* smoke-bootstrap */
  var app = APP.create({ tavo: tavo, document: document, window: window });
  var debug = { core: CORE, protocol: PROTOCOL, prompt: PROMPT, views: VIEWS, runtime: RUNTIME, i18n: I18N };
  try { if (DEBUG) window.__YU_ZHAO_V1__ = { app: app, modules: debug }; } catch (_) {}
  Promise.resolve(app.start()).catch(function (error) { try { console.error('[Yu Zhao] start failed', error); } catch (_) {} });
})();