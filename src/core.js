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

  // Shared by Runtime writes and UI diagnostics; keep timestamps in local time without locale drift.
  function formatDateTime(ms) {
    var n = Number(ms);
    if (!n || !Number.isFinite(n)) return '-';
    var d = new Date(n);
    function pad(x) { return (x < 10 ? '0' : '') + x; }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
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
      clearEpoch: 0,
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

  // ---------- 用户空间 ----------
  // 双域设计（角色域/玩家域）已废除：每份聊天由「用户空间」承载数据，所有空间同构
  // （全套 tablet/chats/notes/forum/market/space/map 分区 + 各自的 revision/sync）。
  // 默认空间锚定 {{char}}（代指角色）：无空间参数的协议写入落它，空间管理页可删除它、
  // 数据到达时自动重建。sendToAI 决定该空间是否注入提示词基线；allowAIWrite 决定
  // AI 协议是否可写它（拒写记 issue）。每个空间的 id 稳定（sp0/sp1/…），name 唯一，
  // 默认空间 name 恒空（显示时跟随角色名）。
  var DEFAULT_SPACE_ID = 'sp0';
  var MAX_SPACES = 6;
  var CURRENT_SCHEMA_VERSION = 2;

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
  // 用户亲发内容（c- 前缀联系人、pm/pm-/pmg/pmc 玩家消息与评论、player 帖）必定注入
  // ——真实事件必须可见，与「有新回复」条目对称。
  function sampleEntries(chats, forum, rng, caps) {
    rng = rng || Math.random;
    caps = caps || {};
    var capContacts = caps.contacts || MAX_INJECT_CONTACTS;
    var capGroups = caps.groups || MAX_INJECT_GROUPS;
    var capPosts = caps.posts || MAX_INJECT_POSTS;
    var chatObj = safeObject(chats);
    var contacts = safeArray(chatObj.contacts, 20);
    var groups = safeArray(chatObj.groups, 6);
    var posts = safeArray(safeObject(forum).posts, 20);
    var out = { contacts: [], groups: [], posts: [] };
    if (contacts.length <= capContacts) {
      contacts.forEach(function (c) { if (c && c.id) out.contacts.push(String(c.id)); });
    } else {
      var forcedC = {};
      contacts.forEach(function (c) {
        if (!c || !c.id) return;
        var ownThread = /^c-/.test(String(c.id));
        if (ownThread || (Number(c.unread) || 0) > 0) forcedC[String(c.id)] = true;
      });
      out.contacts = sampleSet(contacts, capContacts, forcedC, rng);
    }
    if (groups.length <= capGroups) {
      groups.forEach(function (g) { if (g && g.id) out.groups.push(String(g.id)); });
    } else {
      var forcedG = {};
      groups.forEach(function (g) {
        if (!g || !g.id) return;
        var hasUser = safeArray(g.messages, 24).some(function (m) { return m && /^pmg-/.test(String(m.id) || ''); });
        // 有未读消息（有新回复）或含用户发言的群组必定注入——与联系人/帖子对称。
        if (hasUser || (Number(g.unread) || 0) > 0) forcedG[String(g.id)] = true;
      });
      out.groups = sampleSet(groups, capGroups, forcedG, rng);
    }
    if (posts.length <= capPosts) {
      posts.forEach(function (p) { if (p && p.id) out.posts.push(String(p.id)); });
    } else {
      var forcedP = {};
      posts.forEach(function (p) {
        if (!p || !p.id) return;
        var userPost = String(p.owner || '') === 'player';
        var userComment = safeArray(p.comments, 20).some(function (c) { return c && /^pmc-/.test(String(c.id) || ''); });
        // 有新回复（未读）的帖子与用户交互帖同属强制包含集（真实事件必须可见）。
        if (userPost || userComment || (Number(p.unread) || 0) > 0) forcedP[String(p.id)] = true;
      });
      out.posts = sampleSet(posts, capPosts, forcedP, rng);
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

  // 空间实体查找（纯函数，表单预填与运行时 CRUD 共用）：
  // folder/note/contact/group → chats/notes，item/currency → space（currency 以种类为键），
  // order → market，post → forum（用户帖子）。
  function playerFindEntity(pstate, kind, id) {
    id = String(id == null ? '' : id);
    if (kind === 'folder') return safeArray(pstate && pstate.notes && pstate.notes.folders, 10).filter(function (f) { return String(f.id) === id; })[0] || null;
    if (kind === 'note') return safeArray(pstate && pstate.notes && pstate.notes.notes, 30).filter(function (n) { return String(n.id) === id; })[0] || null;
    if (kind === 'item') return safeArray(pstate && pstate.space && pstate.space.items, 30).filter(function (i) { return String(i.id) === id; })[0] || null;
    if (kind === 'currency') return safeArray(pstate && pstate.space && pstate.space.currencies, 10).filter(function (c) { return String(c.kind) === id; })[0] || null;
    if (kind === 'order') return safeArray(pstate && pstate.market && pstate.market.orders, 12).filter(function (o) { return String(o.id) === id; })[0] || null;
    if (kind === 'post') return safeArray(pstate && pstate.forum && pstate.forum.posts, 20).filter(function (p) { return String(p.id) === id; })[0] || null;
    if (kind === 'contact') return safeArray(pstate && pstate.chats && pstate.chats.contacts, 10).filter(function (c) { return String(c.id) === id; })[0] || null;
    return null;
  }

  // 用户空间容器：与旧版 state 同构（分区 + revision/processedTurns/sync），外加空间
  // 元信息（id/name/flags）。默认空间 name 恒空（显示时解析为角色名），isDefault 唯一。
  function blankUserSpace(chatId, opts) {
    opts = opts || {};
    var base = blankState(chatId);
    base.id = cleanText(opts.id, 40) || DEFAULT_SPACE_ID;
    base.name = cleanText(opts.name, 120);
    base.isDefault = opts.isDefault === true;
    base.sendToAI = opts.sendToAI !== false;
    base.allowAIWrite = opts.allowAIWrite !== false;
    base.createdAt = Number(opts.createdAt) || 0;
    return base;
  }

  function normalizeSide(value) {
    return /^(self|me|自己|我)$/i.test(String(value || '')) ? 'self' : 'other';
  }

  function normalizeChats(raw) {
    raw = safeObject(raw);
    function inputRows(value, limit, protectedRow) {
      var rows = Array.isArray(value) ? value.slice(0, 100) : [];
      return rows.filter(protectedRow).concat(rows.filter(function (row) { return !protectedRow(row); })).slice(0, limit);
    }
    var contacts = inputRows(raw.contacts, 10, function (contact) {
      return /^c-/.test(String(contact && contact.id) || '') || safeArray(contact && contact.messages, 100).some(function (message) {
        return /^pm-/.test(String(message && message.id) || '');
      });
    }).map(function (contact) {
      contact = safeObject(contact);
      var rawMessages = safeArray(contact.messages, 100);
      var contactCounters = threadCounters(rawMessages, contact, /^pm-\d+$/);
      return {
        id: cleanText(contact.id, 160),
        name: cleanText(contact.name, 120),
        relation: cleanText(contact.relation, 120),
        time: cleanText(contact.time, 80),
        unread: nzero(contact.unread),
        preview: cleanText(contact.preview, 300),
        // 超窗截断留痕：与玩家域线程一致（archived=true 时详情页顶部显示归档说明），
        // 否则角色域旧消息悄悄消失，用户会以为被删了。
        archived: rawMessages.length > 20,
        // seen：用户已读到「自己最后一条发言之后第几条」——未读徽标 = 尾随回复数 − seen
        //（客户端维护，打开线程清零；模型不可见不可改）。
        seen: nzero(contact.seen),
        // replyCount/seenReplies 是跨保留窗口的累计游标：最近一条 pm 被截掉后，
        // 仍能计算未读，不把窗口淘汰误当成用户从未发言。
        anchorId: contactCounters.anchorId,
        replyCount: contactCounters.replyCount,
        seenReplies: contactCounters.seenReplies,
        messages: tail(rawMessages, 20).map(function (message) {
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
    var groups = inputRows(raw.groups, 6, function (group) {
      return safeArray(group && group.messages, 100).some(function (message) {
        return /^pmg-/.test(String(message && message.id) || '');
      });
    }).map(function (group) {
      group = safeObject(group);
      var rawGMessages = safeArray(group.messages, 100);
      var groupCounters = threadCounters(rawGMessages, group, /^pmg-\d+$/);
      return {
        id: cleanText(group.id, 160),
        name: cleanText(group.name, 120),
        members: nzero(group.members),
        time: cleanText(group.time, 80),
        unread: nzero(group.unread),
        preview: cleanText(group.preview, 300),
        archived: rawGMessages.length > 24,
        anchorId: groupCounters.anchorId,
        replyCount: groupCounters.replyCount,
        seenReplies: groupCounters.seenReplies,
        messages: tail(rawGMessages, 24).map(function (message) {
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

  // 计算用户线程的累计回复游标。rawMessages 在这里仍是截断前的数据，
  // 后续即使只保留最近 20/24 行，replyCount 也不会随窗口滚动倒退。
  function threadCounters(rawMessages, thread, userPattern) {
    var last = -1;
    var anchorId = cleanText(thread && thread.anchorId, 160);
    rawMessages.forEach(function (message, index) {
      if (message && userPattern.test(String(message.id) || '')) {
        last = index;
        anchorId = cleanText(message.id, 160);
      }
    });
    var current = last >= 0 ? rawMessages.length - 1 - last : 0;
    var previousAnchor = cleanText(thread && thread.anchorId, 160);
    var replyCount = nzero(thread && thread.replyCount);
    var seenReplies = Object.prototype.hasOwnProperty.call(thread || {}, 'seenReplies')
      ? nzero(thread.seenReplies) : nzero(thread && thread.seen);
    if (last >= 0 && anchorId !== previousAnchor) {
      replyCount = current;
      seenReplies = 0;
    } else {
      replyCount = Math.max(replyCount, current);
    }
    return { anchorId: anchorId, replyCount: replyCount, seenReplies: seenReplies };
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
      var rawComments = safeArray(post.comments, 100);
      var postReplyCount = rawComments.filter(function (comment) { return comment && String(comment.owner) !== 'player'; }).length;
      var savedReplyCount = nzero(post.replyCount);
      var savedSeenReplies = Object.prototype.hasOwnProperty.call(post, 'seenReplies') ? nzero(post.seenReplies) : nzero(post.seen);
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
        // 玩家帖的回复累计数独立于评论保留窗口，满 20 条后仍能计算未读。
        replyCount: Math.max(savedReplyCount, postReplyCount),
        seenReplies: savedSeenReplies,
        author: cleanText(post.author, 120),
        role: cleanText(post.role, 120),
        section: cleanText(post.section, 60),
        time: cleanText(post.time, 80),
        title: cleanText(post.title, 200),
        body: cleanText(post.body, 3000),
        resonance: nzero(post.resonance),
        comments: tail(rawComments, 20).map(function (comment) {
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

  // 单个用户空间归一：分区字段与旧版 state 同一套归一器；元信息（id/flags）白名单清洗。
  function normalizeUserSpace(raw, chatId) {
    raw = sanitize(safeObject(raw));
    var base = blankState(chatId || raw.chatId);
    base.id = cleanText(raw.id, 40);
    base.name = cleanText(raw.name, 120);
    base.isDefault = raw.isDefault === true || base.id === DEFAULT_SPACE_ID;
    if (base.isDefault) base.id = DEFAULT_SPACE_ID;
    base.sendToAI = raw.sendToAI !== false;
    // 默认空间必须允许 AI 写入（协议写入的落点）；自定义空间按声明。
    base.allowAIWrite = base.isDefault ? true : raw.allowAIWrite !== false;
    base.createdAt = Number(raw.createdAt) || 0;
    base.revision = Number(raw.revision) || 0;
    base.tablet = normalizeTablet(raw.tablet);
    base.chats = normalizeChats(raw.chats);
    // 旧双域固定通道联系人（yz-player/yz-character）归入用户线程（c- 前缀）：
    // 迁移后自动获得用户内容门禁保护（模型不可删/改/伪造该联系人）。
    base.chats.contacts.forEach(function (c) {
      if (c.id === 'yz-player' || c.id === 'yz-character') c.id = 'c-' + c.id;
    });
    base.notes = normalizeNotes(raw.notes);
    base.forum = normalizeForum(raw.forum);
    base.market = normalizeMarket(raw.market);
    base.space = normalizeSpace(raw.space);
    base.map = normalizeMap(raw.map);
    base.processedTurns = safeArray(raw.processedTurns, 80).map(function (x) { return cleanText(x, 160); }).filter(Boolean);
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

  // v1 顶层状态 → 默认空间：旧版把分区数据平铺在 state 上，整体搬进 spaces[0]。
  function migrateV1Space(raw, chatId) {
    var sp = normalizeUserSpace(Object.assign({}, raw, { id: DEFAULT_SPACE_ID, isDefault: true, sendToAI: true, allowAIWrite: true, name: '' }), chatId);
    return sp;
  }

  function normalizeState(raw, chatId) {
    // 存储路径与快照路径同源消毒：过滤危险键（__proto__ 等）并限额，防持久化数据注入。
    raw = sanitize(safeObject(raw));
      var out = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        chatId: cleanText(chatId || raw.chatId || 'unknown', 160),
        pluginVersion: cleanText(raw.pluginVersion, 40),
        storageRevision: Number(raw.storageRevision) || 0,
        storageWriter: cleanText(raw.storageWriter, 80),
        clearEpoch: Number(raw.clearEpoch) || 0,
        pendingFull: !!raw.pendingFull,
      activeSpaceId: cleanText(raw.activeSpaceId, 40),
      migratedPlayer: !!raw.migratedPlayer,
      hydration: null,
      spaces: [],
      updatedAt: Number(raw.updatedAt) || 0
    };
    var hydration = safeObject(raw.hydration);
    if (hydration.sig) out.hydration = { sig: cleanText(hydration.sig, 200), cutoff: cleanText(hydration.cutoff, 160) };
    // 不要按输入顺序先截断：默认空间可能排在末尾，必须优先保留它，避免
    // 归一化时把默认空间或其后的自定义空间静默挤掉。
    var list = safeArray(raw.spaces, 100);
    var legacyV1 = false;
    if (!list.length && (raw.tablet || raw.chats || raw.notes || raw.forum || raw.market || raw.space || raw.map || raw.sync || (Number(raw.revision) || 0) > 0)) {
      // v1→v2：顶层分区数据整体迁入默认空间（无迁移窗口，读到时即完成升级）。
      list = [raw];
      legacyV1 = true;
      out.pluginVersion = '';
    }
    var seenId = {};
    var hasDefault = false;
    var normalized = [];
    list.forEach(function (entry) {
      var sp = legacyV1 ? migrateV1Space(raw, out.chatId) : normalizeUserSpace(entry, out.chatId);
      if (sp.isDefault) {
        if (hasDefault) return; // 多个默认标记只保留第一个。
        hasDefault = true;
        sp.id = DEFAULT_SPACE_ID;
        sp.name = '';
      }
      // id 缺失/重复按序号重发；ID 比名称优先，名称绝不能占用任何 ID。
      var id = sp.id;
      if (!id || (!sp.isDefault && id.indexOf('sp') !== 0) || seenId[String(id).toLowerCase()] ||
          (!sp.isDefault && String(id).toLowerCase() === DEFAULT_SPACE_ID)) {
        var n = 1;
        do { id = 'sp' + n; n += 1; } while (seenId[id.toLowerCase()]);
        sp.id = id;
      }
      seenId[String(sp.id).toLowerCase()] = true;
      normalized.push(sp);
    });

    // 默认空间可被用户删除（数据到达时由 AI 写入自动重建）：归一时不自动补。
    // 但在容量边界内优先保留默认空间，其余自定义空间保持原顺序。
    if (normalized.length > MAX_SPACES) {
      var defaultEntry = normalized.filter(function (sp) { return sp.isDefault; })[0];
      var customEntries = normalized.filter(function (sp) { return !sp.isDefault; }).slice(0, defaultEntry ? MAX_SPACES - 1 : MAX_SPACES);
      normalized = defaultEntry ? [defaultEntry].concat(customEntries) : customEntries;
    }
    var seenName = {};
    normalized.forEach(function (sp) {
      if (sp.isDefault) { sp.name = ''; return; }
      var name = sp.name || tr('space.untitled');
      var suffix = 0;
      var candidate = name;
      while (seenName[candidate.toLowerCase()] || seenId[candidate.toLowerCase()] || candidate.toLowerCase() === DEFAULT_SPACE_ID) {
        suffix += 1;
        candidate = name + '-' + suffix;
      }
      sp.name = candidate;
      seenName[candidate.toLowerCase()] = true;
    });
    out.spaces = normalized;
    if (!out.spaces.length) {
      out.spaces.push(blankUserSpace(out.chatId, { id: DEFAULT_SPACE_ID, isDefault: true }));
    }
    if (!findSpaceState(out, out.activeSpaceId)) out.activeSpaceId = out.spaces[0].id;
    return out;
  }

  // 空间定位：id 精确 → 名称精确（忽略大小写/首尾空白）→ ''/sp0 → 默认空间。
  // 找不到返回 null（默认空间可能已被删除）。
  function findSpaceState(state, key) {
    var spaces = safeArray(state && state.spaces, MAX_SPACES);
    var k = String(key == null ? '' : key).trim();
    if (!k || k === DEFAULT_SPACE_ID) {
      for (var d = 0; d < spaces.length; d += 1) if (spaces[d].isDefault) return spaces[d];
      return null;
    }
    var i;
    for (i = 0; i < spaces.length; i += 1) if (spaces[i].id === k) return spaces[i];
    var lower = k.toLowerCase();
    for (i = 0; i < spaces.length; i += 1) {
      if (String(spaces[i].name || '').toLowerCase() === lower) return spaces[i];
    }
    return null;
  }

  function defaultSpaceState(state) {
    return findSpaceState(state, DEFAULT_SPACE_ID);
  }

  // 缺省默认空间时重建（AI 写入落点；用户在空间管理里也可手动重建）。
  function ensureDefaultSpace(state) {
    var sp = defaultSpaceState(state);
    if (sp) return sp;
    // MAX_SPACES 是硬上限。没有空位时宁可保留所有自定义空间并拒绝本次
    // 默认路由，也不能 unshift 出第 7 个空间后在重载时静默丢掉末尾数据。
    if (!state || !Array.isArray(state.spaces) || state.spaces.length >= MAX_SPACES) return null;
    sp = blankUserSpace(state.chatId, { id: DEFAULT_SPACE_ID, isDefault: true });
    state.spaces.unshift(sp);
    return sp;
  }

  // 空间显示名：默认空间跟随角色名（sync.roleName 由 AI 轮写入），自定义空间用自身 name。
  function spaceDisplayName(state, space, fallback) {
    if (!space) return fallback || '';
    if (!space.isDefault && hasText(space.name)) return space.name;
    return hasText(space.sync && space.sync.roleName) ? space.sync.roleName : (fallback || '');
  }

  // 顶层「有没有数据」判定：load 竞态裁决、touched 检查、世界书同步门共用。
  function stateRevision(state) {
    var max = 0;
    safeArray(state && state.spaces, MAX_SPACES).forEach(function (sp) { max = Math.max(max, Number(sp.revision) || 0); });
    return max;
  }

  function stateDataUpdatedAt(state) {
    var max = Number(state && state.updatedAt) || 0;
    safeArray(state && state.spaces, MAX_SPACES).forEach(function (sp) {
      max = Math.max(max, Number(sp.updatedAt) || 0, Number(sp.sync && sp.sync.updatedAt) || 0);
    });
    return max;
  }

  // 元数据也是状态：空白聊天新建/改名/切换空间或改开关时 revision 仍为 0，
  // 但这些变化必须进入权威快照，不能只留在本地缓存。
  function stateHasPersistableData(state) {
    if (!state) return false;
    if (Number(state.updatedAt) > 0 || Number(state.clearEpoch) > 0 || stateRevision(state) > 0 || stateDataUpdatedAt(state) > 0) return true;
    return safeArray(state.spaces, MAX_SPACES).some(function (sp) {
      return Number(sp && sp.createdAt) > 0 || Number(sp && sp.updatedAt) > 0;
    });
  }

  // 功能 id 与 state 字段的对应关系：msg 功能的数据存放在 state.chats。
  var FEATURE_FIELDS = { tablet: 'tablet', msg: 'chats', notes: 'notes', forum: 'forum', market: 'market', space: 'space', map: 'map' };

  // 用户线程未读（客户端语义）：用户最后一条发言（pm-N/pmg-N）之后追加的回复数 − 已见数。
  // 未参与过的线程（无用户发言）保留模型维护的 unread，不被触碰。
  function userTail(thread) {
    var msgs = safeArray(thread && thread.messages, 100);
    var last = -1;
    msgs.forEach(function (m, i) { if (m && /^(pm-\d+|pmg-\d+)$/.test(String(m.id) || '')) last = i; });
    return last < 0 ? -1 : msgs.length - 1 - last;
  }

  // 用户帖未读：owner=player 的帖子由客户端计数（非用户评论数 − seen 游标）；
  // 模型在用户帖下的 +comment 追加会被计入，打开详情 markSeen 清零。
  function postReplyCount(post) {
    return safeArray(post && post.comments, 20).filter(function (c) { return c && String(c.owner) !== 'player'; }).length;
  }

  function recomputeThreadUnread(space) {
    if (!space) return;
    [safeArray(space.chats && space.chats.contacts, 10), safeArray(space.chats && space.chats.groups, 6)].forEach(function (list) {
      list.forEach(function (thread) {
        if (thread && thread.anchorId) {
          thread.replyCount = Math.max(nzero(thread.replyCount), Math.max(0, userTail(thread)));
          thread.seenReplies = Math.min(thread.replyCount, nzero(thread.seenReplies != null ? thread.seenReplies : thread.seen));
          thread.unread = Math.max(0, thread.replyCount - thread.seenReplies);
          return;
        }
        var tail = userTail(thread);
        if (tail < 0) return;
        thread.unread = Math.max(0, tail - nzero(thread.seen));
      });
    });
    safeArray(space.forum && space.forum.posts, 20).forEach(function (post) {
      if (!post || String(post.owner) !== 'player') return;
      if (Object.prototype.hasOwnProperty.call(post, 'replyCount')) {
        post.replyCount = Math.max(nzero(post.replyCount), postReplyCount(post));
        post.seenReplies = Math.min(post.replyCount, nzero(post.seenReplies != null ? post.seenReplies : post.seen));
        post.unread = Math.max(0, post.replyCount - post.seenReplies);
      } else {
        post.unread = Math.max(0, postReplyCount(post) - nzero(post.seen));
      }
    });
  }

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
    // 用户创建的联系人（c- 前缀；含旧档残留 yz-player）是用户真实数据，不是剧情数据：
    // 不参与联系人数与每条消息数底线，避免用户发讯反而拉低空间达标度。
    // 群聊里的用户发言（pmg-*）同理不参与群聊消息数底线（用户发言不凑达标）。
    var contacts = safeArray(chats.contacts, 10).filter(function (c) { var id = String(c && c.id); return !/^c-/.test(id) && id !== 'yz-player'; });
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
        // 用户创建的联系人（c- 前缀）是用户真实数据，模型不得增删改（只读防护，
        // 与 diffForum 对用户帖的门禁同语义；提示词亦明令禁止）。
        if (/^c-/.test(id)) return;
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
        var mid = cleanText(op.values[1], 160);
        if (!mid) return;
        var mi = indexOfById(owner.messages, mid);
        if (/^pmg-/.test(mid)) {
          // 群聊用户发言（pmg-*）是用户真实发言：任何增删改一律拒绝
          //（覆盖、删除、伪造新 pmg-* 行都不允许），回复用普通新 id 以自己身份发言。
          return;
        }
        if (/^pm-\d+$/.test(mid)) {
          // 用户传讯消息（pm-N）只由本机按序生成：模型不得伪造新的 pm-N 行
          //（含改写/删除既有行），回复用普通新 id。
          return;
        }
        if (/^pmc-/.test(mid)) return;
        if (op.add) {
          // 用户线程（c- 前缀联系人）真实事件防护：模型只可追加新行，
          // 不得改写/覆盖既有行、不得删除（用户发言 pm-N 已由前缀门禁另行保护）。
          if (/^c-/.test(id) && mi >= 0) return;
          var text = cleanText(isGroup ? op.values[5] : op.values[4], 3000);
          if (!hasText(text)) return;
          var message = isGroup
            ? { id: mid, sender: cleanText(op.values[2], 120), side: normalizeSide(op.values[3]), time: cleanText(op.values[4], 80), text: text }
            : { id: mid, side: normalizeSide(op.values[2]), time: cleanText(op.values[3], 80), text: text };
          // 满员时也要收下新消息：先追加，末尾的 normalizeChats 保尾截断淘汰最旧。
          if (mi >= 0) owner.messages[mi] = message;
          else {
            owner.messages.push(message);
            if (owner.anchorId) owner.replyCount = nzero(owner.replyCount) + 1;
          }
        } else if (mi >= 0) {
          if (/^c-/.test(id)) return; // 用户线程消息不可删
          owner.messages.splice(mi, 1);
        }
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
          // AI cannot create a player-owned post or turn a character post into one.
          if (post.owner === 'player') return;
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
           if (ci < 0 && owner.comments.length < 20) {
             owner.comments.push({ id: 'cm-' + (cmMax + 1), author: author, time: time, text: text });
             if (owner.owner === 'player') owner.replyCount = nzero(owner.replyCount) + 1;
           }
        } else if (ci >= 0) {
          if (/^pmc-/.test(String(owner.comments[ci].id) || '')) return;
          owner.comments.splice(ci, 1);
        }
      }
    });
    return normalizeForum(out);
  }

  // Full snapshots describe model-owned data, but user-owned rows must survive the
  // replacement. Protected rows are taken from the current state, never from AI input.
  function mergeProtectedMessages(current, incoming, pattern, limit) {
    var protectedRows = safeArray(current, 100).filter(function (message) {
      return pattern.test(String(message && message.id) || '');
    }).map(clone);
    var normalRows = safeArray(incoming, 100).filter(function (message) {
      return !pattern.test(String(message && message.id) || '');
    });
    // 保护行（用户最新发言）必须位于模型回复之前；若把它们接到末尾，
    // 窗口归一化会误判“后面没有回复”，累计未读也无法继续增长。
    return protectedRows.concat(tail(normalRows, Math.max(0, limit - protectedRows.length)));
  }

  function mergeProtectedChats(current, incoming) {
    var oldChats = normalizeChats(current);
    var next = normalizeChats(incoming);
    var oldContacts = Object.create(null);
    var oldGroups = Object.create(null);
    oldChats.contacts.forEach(function (contact) { oldContacts[contact.id] = contact; });
    oldChats.groups.forEach(function (group) { oldGroups[group.id] = group; });

    var protectedContacts = [];
    var normalContacts = [];
    next.contacts.forEach(function (contact) {
      var previous = oldContacts[contact.id];
      if (/^c-/.test(contact.id)) return;
      contact.messages = mergeProtectedMessages(previous && previous.messages, contact.messages, /^pm-/, 20);
      if (previous && previous.anchorId) {
        contact.anchorId = previous.anchorId;
        contact.replyCount = previous.replyCount;
        contact.seenReplies = previous.seenReplies;
      }
      if (safeArray(contact.messages, 20).some(function (message) { return /^pm-/.test(String(message && message.id) || ''); })) protectedContacts.push(contact);
      else normalContacts.push(contact);
    });
    oldChats.contacts.forEach(function (contact) {
      if (/^c-/.test(contact.id)) protectedContacts.push(clone(contact));
      else if (!next.contacts.some(function (item) { return item.id === contact.id; })) {
        var messages = mergeProtectedMessages(contact.messages, [], /^pm-/, 20);
        if (messages.length) protectedContacts.push(Object.assign(clone(contact), { messages: messages }));
      }
    });

    var protectedGroups = [];
    var normalGroups = [];
    next.groups.forEach(function (group) {
      var previous = oldGroups[group.id];
      group.messages = mergeProtectedMessages(previous && previous.messages, group.messages, /^pmg-/, 24);
      if (previous && previous.anchorId) {
        group.anchorId = previous.anchorId;
        group.replyCount = previous.replyCount;
        group.seenReplies = previous.seenReplies;
      }
      if (safeArray(group.messages, 24).some(function (message) { return /^pmg-/.test(String(message && message.id) || ''); })) protectedGroups.push(group);
      else normalGroups.push(group);
    });
    oldChats.groups.forEach(function (group) {
      if (next.groups.some(function (item) { return item.id === group.id; })) return;
      var messages = mergeProtectedMessages(group.messages, [], /^pmg-/, 24);
      if (messages.length) protectedGroups.push(Object.assign(clone(group), { messages: messages }));
    });
    return normalizeChats({
      // Protected rows consume capacity first; only ordinary AI rows may be evicted.
      contacts: protectedContacts.concat(normalContacts.slice(0, Math.max(0, 10 - protectedContacts.length))),
      groups: protectedGroups.concat(normalGroups.slice(0, Math.max(0, 6 - protectedGroups.length)))
    });
  }

  function mergeProtectedForum(current, incoming) {
    var oldForum = normalizeForum(current);
    var next = normalizeForum(incoming);
    var oldById = Object.create(null);
    oldForum.posts.forEach(function (post) { oldById[post.id] = post; });
    var posts = [];
    next.posts.forEach(function (post) {
      var previous = oldById[post.id];
      if (post.owner === 'player' || (previous && previous.owner === 'player')) return;
      post.comments = mergeProtectedMessages(previous && previous.comments, post.comments, /^pmc-/, 20);
      posts.push(post);
    });
    oldForum.posts.forEach(function (post) {
      if (post.owner === 'player') {
        posts.push(clone(post));
        return;
      }
      var incoming = next.posts.filter(function (item) { return item.id === post.id; })[0];
      if (incoming && incoming.owner === 'player') {
        posts.push(clone(post));
        return;
      }
      if (incoming) return;
      var comments = mergeProtectedMessages(post.comments, [], /^pmc-/, 20);
      if (comments.length) posts.push(Object.assign(clone(post), { comments: comments }));
    });
    var userPosts = posts.filter(function (post) { return post.owner === 'player'; });
    var characterPosts = posts.filter(function (post) { return post.owner !== 'player'; });
    return normalizeForum({ posts: userPosts.concat(characterPosts.slice(0, Math.max(0, 20 - userPosts.length))) });
  }

  function mergeProtectedFullData(space, snapshot) {
    return {
      tablet: normalizeTablet(snapshot.tablet),
      chats: mergeProtectedChats(space.chats, snapshot.chats),
      notes: normalizeNotes(snapshot.notes),
      forum: mergeProtectedForum(space.forum, snapshot.forum),
      market: normalizeMarket(snapshot.market),
      space: normalizeSpace(snapshot.space),
      map: normalizeMap(snapshot.map)
    };
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

  function diffIssue(feature, op, detail, code) {
    var values = safeArray(op && op.values, 10);
    var id = values[0] || detail || op.type || 'unknown';
    return { path: feature + '.' + cleanText(id, 160), code: code || 'diff.unknown' };
  }

  function visibleEntity(set, id, allowAll) {
    if (allowAll) return true;
    return !!(set && set[String(id)] === true);
  }

  function visibleChild(set, parentId, id, allowAll) {
    if (allowAll) return true;
    return !!(set && set[String(parentId)] && set[String(parentId)][String(id)] === true);
  }

  // 先于具体 diff 应用器拒绝未知/不可见目标。+ 行仍可创建新顶层实体，
  // 但子实体必须有可见父实体；- 行和已有 id 的 + 行必须命中本轮基线。
  function validateDiffOps(space, feature, ops, visibility, realtime) {
    visibility = visibility || {};
    // Direct Core callers are the historical/explicit path. Runtime realtime
    // calls must provide the prepare visibility and can never use __all.
    var allowAll = !realtime && visibility.__all === true;
    var issues = [];
    var accepted = [];
    var chats = safeObject(space && space.chats);
    var notes = safeObject(space && space.notes);
    var forum = safeObject(space && space.forum);
    var market = safeObject(space && space.market);
    var pocket = safeObject(space && space.space);
    var map = safeObject(space && space.map);
    function reject(op, detail, code) {
      if (issues.length < 20) issues.push(diffIssue(feature, op, detail, code));
    }
    function entity(list, id) { return safeArray(list, 100).filter(function (item) { return String(item && item.id) === String(id); })[0] || null; }
    function currency(id) { return safeArray(pocket.currencies, 10).filter(function (item) { return String(item && item.kind) === String(id); })[0] || null; }
    function post(id) { return entity(forum.posts, id); }
    function comment(parentId, values) {
      var p = post(parentId);
      if (!p) return false;
      return safeArray(p.comments, 100).some(function (item) {
        return String(item.author) === String(values[1] || '') && String(item.time) === String(values[2] || '') && String(item.text) === String(values[3] || '');
      });
    }
    if (realtime && visibility.__realtime === true) {
      ops.forEach(function (op) { reject(op, safeArray(op && op.values, 10)[0] || 'unknown', 'diff.hidden'); });
      return { ops: accepted, issues: issues };
    }
    function top(op, list, visibleSet, detail) {
      var id = op.values[0];
      var existing = entity(list, id);
      if (!op.add || existing) {
        if (!existing) { reject(op, detail || id, 'diff.unknown'); return false; }
        if (!visibleEntity(visibleSet, id, allowAll)) { reject(op, detail || id, 'diff.hidden'); return false; }
      }
      return true;
    }
    ops.forEach(function (op) {
      var v = safeArray(op.values, 10);
      var ok = true;
      if (feature === 'tablet') {
        var gid = groupId(v[0]);
        ok = !!gid && (allowAll || !!(visibility.tablet && visibility.tablet.groups && visibility.tablet.groups[gid] === true));
        var group = safeArray(space && space.tablet && space.tablet.groups, 10).filter(function (item) { return item && item.id === gid; })[0];
        var field = group && safeArray(group.fields, 30).some(function (item) {
          return keyId(item.key) === keyId(v[1]) || item.key === cleanText(v[1], 60);
        });
        var visibleFields = visibility.tablet && visibility.tablet.fields && visibility.tablet.fields[gid];
        var fieldVisible = !field || allowAll || !!(visibleFields &&
          (visibleFields[String(v[1])] === true || (keyId(v[1]) && visibleFields[keyId(v[1])] === true)));
        if (field && !fieldVisible) ok = false;
        if (!op.add && (!group || !field)) ok = false;
        if (!ok) reject(op, v[0]);
      } else if (feature === 'msg') {
        var parent = v[0];
        var isGroup = op.type === 'gmsg';
        var thread = entity(isGroup ? chats.groups : chats.contacts, parent);
        var target = isGroup ? visibility.groups : visibility.contacts;
        if (op.type === 'contact') ok = top(op, chats.contacts, visibility.contacts);
        else if (op.type === 'group') ok = top(op, chats.groups, visibility.groups);
        else if (op.type === 'msg' || op.type === 'gmsg') {
          var msg = entity(thread && thread.messages, v[1]);
          var parentVisible = visibleEntity(target, parent, allowAll);
          var childVisible = visibleChild(visibility.messages, parent, v[1], allowAll);
          ok = !!thread && parentVisible && (!msg || childVisible);
          if (!op.add) ok = ok && !!msg && childVisible;
          if (!ok) reject(op, parent + '.' + v[1], thread && (!parentVisible || (msg && !childVisible)) ? 'diff.hidden' : 'diff.unknown');
        }
      } else if (feature === 'forum') {
        if (op.type === 'post') ok = top(op, forum.posts, visibility.posts);
        else if (op.type === 'comment') {
          var p = post(v[0]);
          var exists = comment(v[0], v);
          ok = !!p && visibleEntity(visibility.posts, v[0], allowAll) && (!exists || visibleChild(visibility.comments, v[0], v[1] + '|' + v[2] + '|' + v[3], allowAll));
          if (!op.add) ok = ok && exists && visibleChild(visibility.comments, v[0], v[1] + '|' + v[2] + '|' + v[3], allowAll);
          if (op.add && p && !exists && safeArray(p.comments, 100).length >= 20) { ok = false; reject(op, v[0], 'forum.comments.full'); }
          else if (!ok) reject(op, v[0], p && !visibleEntity(visibility.posts, v[0], allowAll) ? 'diff.hidden' : 'diff.unknown');
        }
      } else if (feature === 'notes') {
        if (op.type === 'folder') ok = top(op, notes.folders, visibility.folders);
        else if (op.type === 'note') {
          var folder = entity(notes.folders, v[1]);
          var note = entity(notes.notes, v[0]);
          ok = op.add ? !!folder && visibleEntity(visibility.folders, v[1], allowAll) && (!note || visibleEntity(visibility.notes, v[0], allowAll))
            : !!note && visibleEntity(visibility.notes, v[0], allowAll);
          if (!ok) reject(op, v[0]);
        }
      } else if (feature === 'market') {
        var marketLists = { listing: market.listings, auction: market.auctions, order: market.orders, request: market.requests };
        var list = marketLists[op.type];
        if (list) ok = top(op, list, visibility.entities);
      } else if (feature === 'space') {
        if (op.type === 'currency') {
          var coin = currency(v[0]);
          ok = (!coin && op.add) || (!!coin && visibleEntity(visibility.currencies, v[0], allowAll));
          if (!op.add) ok = ok && !!coin;
          if (!ok) reject(op, v[0]);
        } else if (op.type === 'item') ok = top(op, pocket.items, visibility.items);
      } else if (feature === 'map') {
        if (op.type === 'current') ok = op.add === true;
        else if (op.type === 'track') ok = top(op, map.tracks, visibility.tracks);
        else if (op.type === 'place') ok = top(op, map.places, visibility.places);
        if (!ok && op.type === 'current') reject(op, 'current');
      }
      if (ok) accepted.push(op);
    });
    return { ops: accepted, issues: issues };
  }

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

  // 快照写入路由：turn 行空间名 → 目标用户空间；缺省/默认名 → 默认空间（缺失自动重建）。
  // 拒写情形记入目标空间（或默认空间）的 sync.issues：
  //  space.unknown（声明了不存在的空间）、space.denied（空间不允许 AI 修改）、
  //  space.full（非默认空间只接受 diff 轮，防止全量轮抹掉用户私有数据）。
  function applySnapshot(rawState, rawSnapshot, flags, visibility, options) {
    options = options || {};
    var realtime = options.realtime === true;
    if (!visibility || (realtime && !Object.keys(visibility).length)) visibility = realtime ? { __realtime: true } : { __all: true };
    var state = normalizeState(rawState);
    // 封印的功能既不参与判定也不应用数据：提示词未请求，即使快照残留旧区块也忽略。
    function on(id) { return !flags || flags[id] !== false; }
    var snapshot = sanitize(rawSnapshot);
    var turn = safeObject(snapshot && snapshot.turn);
    var spaceKey = cleanText(turn.space, 120);
    var space = spaceKey ? findSpaceState(state, spaceKey) : defaultSpaceState(state);
    var rawSize = 0;
    try { rawSize = JSON.stringify(rawSnapshot).length; } catch (_) { rawSize = MAX_SNAPSHOT_BYTES + 1; }
    if (rawSize > MAX_SNAPSHOT_BYTES) {
      var oversized = { ok: false, tablet: { ok: false }, msg: { ok: false }, notes: { ok: false }, forum: { ok: false }, market: { ok: false }, space: { ok: false }, map: { ok: false }, issues: [{ path: 'payload', code: 'payload.oversized' }], oversized: true };
       var otarget = ensureDefaultSpace(state);
       if (!otarget) otarget = state.spaces[0];
       if (otarget) {
         otarget.sync = Object.assign({}, otarget.sync, { status: otarget.revision ? otarget.sync.status : 'invalid', lastError: 'oversized-payload', issues: oversized.issues, updatedAt: Date.now() });
         otarget.updatedAt = Date.now();
       }
      state.updatedAt = Date.now();
      return { state: state, duplicate: false, applied: [], assessment: oversized, oversized: true, persist: true };
    }
    function deny(issue) {
      var sp = space || defaultSpaceState(state) || state.spaces[0] || ensureDefaultSpace(state);
      if (sp) {
        sp.sync = Object.assign({}, sp.sync, { issues: safeArray(sp.sync.issues, 20).concat([issue]).slice(-20), updatedAt: Date.now() });
        sp.updatedAt = Date.now();
      }
      state.updatedAt = Date.now();
      return { state: state, duplicate: false, applied: [], assessment: { ok: false, part: false, apply: {}, issues: [issue] }, persist: true };
    }
    if (!space) {
      if (!spaceKey) space = ensureDefaultSpace(state);
      else return deny({ path: 'space', code: 'space.unknown' });
    }
    if (!space) return deny({ path: 'space', code: 'space.full' });
    var spaceVisibility = visibility && visibility[space.id] ? visibility[space.id] : visibility;
    if (space.allowAIWrite === false) return deny({ path: 'space', code: 'space.denied' });
    var turnId = cleanText(turn.id || ('turn-' + stableHash(snapshot)), 160);
    // 去重指纹 = 轮次 id + 快照内容哈希：同一消息经 generation:success 与 message 钩子
    // 双通道重复投递时内容一致、仍被去重；重新生成/续写常复用同一轮次 id 但内容已变，
    // 指纹含内容哈希保证按新快照应用。
    var fingerprint = (space.isDefault ? '' : space.id + ':') + turnId.slice(0, 140) + '@' + stableHash(JSON.stringify(snapshot));
    if (space.processedTurns.indexOf(fingerprint) >= 0) return { state: state, duplicate: true, applied: [], assessment: assess(snapshot, flags) };
    // diff 轮：把 +/- 操作行合并进当前分区（未提及的分区原样保留），评估在合并结果上进行。
    var diffOps = safeObject(snapshot.diff);
    var diffMode = turn.mode === 'diff' || Object.keys(diffOps).length > 0;
    var opCount = Object.keys(diffOps).reduce(function (count, id) { return count + safeArray(diffOps[id], 60).length; }, 0);
    // 非默认空间只接受 diff 轮：全量/part 会整块替换用户私有数据，拒写并记 issue。
    if (!space.isDefault && !diffMode) return deny({ path: 'space', code: 'space.full' });
    var merged = null;
    var fullMerged = null;
    var assessment;
    if (diffMode) {
      var diffResults = {};
      var diffPass = {};
      var diffApply = {};
      var diffIssues = [];
      merged = {};
      ASSESS_ORDER.forEach(function (id) {
        if (!on(id)) { diffPass[id] = false; diffApply[id] = false; return; }
        var rawOps = safeArray(diffOps[id], 60);
        var checked = validateDiffOps(space, id, rawOps, spaceVisibility, realtime);
        var ops = checked.ops;
        checked.issues.forEach(function (issue) { if (diffIssues.length < 20) diffIssues.push(issue); });
        var data = space[FEATURE_FIELDS[id]];
        if (ops.length) {
          data = DIFF_APPLIERS[id](space[FEATURE_FIELDS[id]], ops);
          merged[id] = data;
        }
        var res = ASSESSORS[id](data);
        // 用户空间的完整性底线不适用（数据是用户手记，不要求凑满剧情结构）：
        // 有操作行即应用，仅评估分区照常记账供判定展示。
        if (!space.isDefault) { diffApply[id] = ops.length > 0; diffPass[id] = checked.issues.length === 0; return; }
        diffResults[id] = res;
        diffPass[id] = res.ok && checked.issues.length === 0;
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
      fullMerged = mergeProtectedFullData(space, snapshot);
      assessment = assess(Object.assign({}, snapshot, fullMerged), flags, space);
    }
    var part = assessment.part === true;
    var presentList = safeArray(snapshot.present, 10);
    var skippedMap = part ? safeObject(snapshot.skipped) : {};
    // meta-only：part/diff 轮除 <yz_meta> 外没有任何分区与操作行。
    var metaOnly = (part || diffMode) && !presentList.length && !Object.keys(skippedMap).length && !opCount;
    if (metaOnly && space.revision > 0) {
      // 「本轮无变化」：状态保持原值，仅刷新摘要与轮次；不计 issue、不弹 Toast、不动 revision。
      space.processedTurns.push(fingerprint);
      space.processedTurns = space.processedTurns.slice(-80);
      space.sync = Object.assign({}, space.sync, { totalTurns: (space.sync && space.sync.totalTurns || 0) + 1 });
      state.updatedAt = Date.now();
       space.sync = Object.assign({}, space.sync, {
        turnId: turnId,
        roleName: space.isDefault ? cleanText(turn.roleName, 120) : space.sync.roleName,
        summary: cleanText(turn.summary, 500),
        applied: [],
         updatedAt: state.updatedAt
       });
       space.updatedAt = state.updatedAt;
       return { state: state, duplicate: false, applied: [], assessment: assessment, persist: true };
    }
    var applied = [];
    ASSESS_ORDER.forEach(function (id) {
      if (!on(id)) return;
      if (!assessment.apply[id]) return;
      // diff 轮的合并结果按功能 id 存放；full 轮先合并用户保护行再替换。
      var nextData = merged ? merged[id] : fullMerged[FEATURE_FIELDS[id]];
      space[FEATURE_FIELDS[id]] = NORMALIZERS[id](nextData);
      applied.push(id);
    });
    if (applied.length) space.revision += 1;
    // 持久化强制全量标记：默认空间成功应用一轮完整全量后清除；
    // diff/part 轮不清除——封印切换与版本更新后的重同步必须等真正的全量轮。
    if (space.isDefault && !part && !diffMode && assessment.ok) state.pendingFull = false;
    space.processedTurns.push(fingerprint);
    space.processedTurns = space.processedTurns.slice(-80);
    // 累计轮次单调计数（processedTurns 是 80 条环缓冲，会截断；总数必须独立持久化）。
    space.sync = Object.assign({}, space.sync, { totalTurns: (space.sync && space.sync.totalTurns || 0) + 1 });
    state.updatedAt = Date.now();
    space.updatedAt = Date.now();
    var previousSeen = safeArray(space.sync && space.sync.appliedSeen, 20);
    // 状态公式：full/part 沿用既有语义；diff 轮失败不动旧数据，已有数据时最差也只是 partial。
    var nextStatus;
    if (part) nextStatus = metaOnly ? 'invalid' : (assessment.ok ? 'complete' : 'partial');
    else if (assessment.ok) nextStatus = 'complete';
    else if (applied.length) nextStatus = 'partial';
    else if (diffMode && space.revision > 0) nextStatus = 'partial';
    else nextStatus = 'invalid';
    space.sync = {
      status: nextStatus,
      turnId: turnId,
      // 角色名只有默认空间跟随（自定义空间保持自己的 roleName 为空）。
      roleName: space.isDefault ? cleanText(turn.roleName, 120) : '',
      summary: cleanText(turn.summary, 500),
      applied: applied,
      // 本轮已应用的分区移出 seen：卦位重新点亮「新」徽标，用户查看（openFeature）后再次并入。
      appliedSeen: previousSeen.filter(function (seenId) { return applied.indexOf(seenId) < 0; }),
      issues: assessment.issues.slice(0, 20),
      updatedAt: Date.now()
    };
    return { state: state, duplicate: false, applied: applied, assessment: assessment, persist: true };
  }

  var CORE = {
    dbg: dbg,
    cleanText: cleanText,
    escapeHtml: escapeHtml,
    sanitize: sanitize,
    stableHash: stableHash,
    nzero: nzero,
    formatDateTime: formatDateTime,
    clone: clone,
    safeObject: safeObject,
    safeArray: safeArray,
    hasText: hasText,
    groupId: groupId,
    keyId: keyId,
    encodeSpaceRoute: encodeSpaceRoute,
    decodeSpaceRoute: decodeSpaceRoute,
    GROUP_ORDER: GROUP_ORDER,
    DEFAULT_SPACE_ID: DEFAULT_SPACE_ID,
    MAX_SPACES: MAX_SPACES,
    CURRENT_SCHEMA_VERSION: CURRENT_SCHEMA_VERSION,
    MAX_INJECT_CONTACTS: MAX_INJECT_CONTACTS,
    MAX_INJECT_GROUPS: MAX_INJECT_GROUPS,
    MAX_INJECT_POSTS: MAX_INJECT_POSTS,
    sampleEntries: sampleEntries,
    recomputeThreadUnread: recomputeThreadUnread,
    blankTablet: blankTablet,
    blankState: blankState,
    blankUserSpace: blankUserSpace,
    normalizeUserSpace: normalizeUserSpace,
    findSpaceState: findSpaceState,
    defaultSpaceState: defaultSpaceState,
    ensureDefaultSpace: ensureDefaultSpace,
    spaceDisplayName: spaceDisplayName,
    stateRevision: stateRevision,
    stateDataUpdatedAt: stateDataUpdatedAt,
    stateHasPersistableData: stateHasPersistableData,
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
