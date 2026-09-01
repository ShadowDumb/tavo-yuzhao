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
  var PLUGIN_VERSION = '3.0.0';

  function createRuntime() {
    var tavoApi = arguments[0] || {};
    var local = arguments[1] || null;
    var getFlags = typeof arguments[2] === 'function' ? arguments[2] : function () { return null; };
    var runtimeOptions = arguments[3] || {};
    var runtimeWindow = runtimeOptions.window || null;
    var notice = typeof runtimeOptions.notice === 'function' ? runtimeOptions.notice : function () {};
    var notify = notice;
    var writerId = 'writer-' + stableHash(String(Date.now()) + ':' + String(Math.random()));

    // 内存态只保留最近使用的少量聊天；淘汰无损——每次写入都会落盘（镜像缓存 + 世界书），
    // 重新进入被淘汰的聊天时从镜像缓存/世界书重新加载。
    var MAX_ACTIVE_CHATS = 5;
    var chats = Object.create(null);
    var lru = [];
    var activeChatId = 'unknown';
    var epoch = 0;
    var saveQueue = Promise.resolve();
    // A CAS conflict is a write lock until this runtime has loaded shared state again.
    var casBlocked = Object.create(null);
    var committedStates = Object.create(null);
    var clearEpochs = Object.create(null);
    var clearGates = Object.create(null);

    function rememberChat(chatId) {
      var i = lru.indexOf(chatId);
      if (i >= 0) lru.splice(i, 1);
      lru.push(chatId);
    }

    function evictChats() {
      while (lru.length > MAX_ACTIVE_CHATS && lru[0] !== activeChatId) {
        var evicted = lru.shift();
        delete chats[evicted];
      }
    }

    function localGet(key) {
      try { return local && typeof local.getItem === 'function' ? local.getItem(key) : null; } catch (error) { dbg('local get failed: ' + key, error); return null; }
    }

    function localSet(key, value) {
      try {
        if (local && typeof local.setItem === 'function') local.setItem(key, value);
        return true;
      } catch (error) { dbg('local set failed: ' + key, error); return false; }
    }

    function localRemove(key) {
      try {
        if (local && typeof local.removeItem === 'function') local.removeItem(key);
        return true;
      } catch (error) { dbg('local remove failed: ' + key, error); return false; }
    }

    // 跨标签页同步：消息只触发重读，真正写入仍由 revision/writer CAS 检查保护。
    var syncChannel = null;
    var disposed = false;
    try { if (runtimeWindow && typeof BroadcastChannel !== 'undefined') syncChannel = new BroadcastChannel('yz-sync'); } catch (_) {}
    var syncChannelReady = false;
    function refreshFromStorage(key, expectedRevision) {
      if (!key || key.indexOf(LOCAL_PREFIX) !== 0) return;
      var chatId = key.slice(LOCAL_PREFIX.length);
      if (!chatId || chatId !== activeChatId) return;
      var fresh = parseStored(localGet(key));
      if (!fresh || (expectedRevision != null && (Number(fresh.storageRevision) || 0) < (Number(expectedRevision) || 0))) return;
      var currentState = chats[chatId];
      if (currentState && (Number(fresh.storageRevision) || 0) <= (Number(currentState.storageRevision) || 0)) return;
      chats[chatId] = CORE.normalizeState(fresh, chatId);
      committedStates[chatId] = clone(chats[chatId]);
      clearEpochs[chatId] = Math.max(Number(clearEpochs[chatId]) || 0, Number(chats[chatId].clearEpoch) || 0);
      delete casBlocked[chatId];
      notice('stateChanged', chatId);
    }
    function setupSyncChannel() {
      if (!syncChannel || syncChannelReady) return;
      syncChannelReady = true;
      syncChannel.onmessage = function (event) {
        var msg = event && event.data;
        if (!msg || msg.type !== 'yz-storage-changed') return;
        refreshFromStorage(msg.key, msg.revision);
      };
    }
    setupSyncChannel();

    function onStorage(event) {
      refreshFromStorage(event && event.key, null);
    }
    if (runtimeWindow && typeof runtimeWindow.addEventListener === 'function') runtimeWindow.addEventListener('storage', onStorage);

    function parseStored(raw) {
      if (raw == null) return null;
      if (typeof raw === 'object') return raw;
      try { return JSON.parse(String(raw)); } catch (_) { return null; }
    }

    function recordClearEpoch(chatId, state) {
      var currentEpoch = Number(state && state.clearEpoch) || 0;
      var knownEpoch = Number(clearEpochs[chatId]) || 0;
      var gate = clearGates[chatId];
      if (!gate || gate.epoch !== currentEpoch) {
        currentEpoch = Math.max(currentEpoch, knownEpoch) + 1;
        if (state) state.clearEpoch = currentEpoch;
        clearEpochs[chatId] = currentEpoch;
        clearGates[chatId] = { epoch: currentEpoch };
      }
      return currentEpoch;
    }

    // UI clear flows may call this before mutating the state. The epoch is
    // persisted by the next save; capture generationToken() at prepare and
    // pass it as applyText(..., { generationToken: token }) at success.
    function beginClear(chatId) {
      chatId = CORE.cleanText(chatId || activeChatId, 160);
      if (chatId !== activeChatId) return { ok: false, reason: 'stale' };
      var state = chats[chatId] || current();
      var currentEpoch = Math.max(Number(state.clearEpoch) || 0, Number(clearEpochs[chatId]) || 0) + 1;
      state.clearEpoch = currentEpoch;
      clearEpochs[chatId] = currentEpoch;
      clearGates[chatId] = { epoch: currentEpoch };
      return { ok: true, epoch: currentEpoch };
    }

    function generationToken(chatId) {
      chatId = CORE.cleanText(chatId || activeChatId, 160);
      var state = chats[chatId];
      var currentEpoch = Math.max(Number(state && state.clearEpoch) || 0, Number(clearEpochs[chatId]) || 0);
      return { chatId: chatId, clearEpoch: currentEpoch };
    }

    function optionClearEpoch(options) {
      options = options || {};
      var token = options.generationToken;
      var value = options.clearEpoch != null ? options.clearEpoch : options.generationEpoch;
      if (value == null && token && typeof token === 'object') value = token.clearEpoch;
      if (value == null || value === '') return null;
      var number = Number(value);
      return Number.isFinite(number) ? number : null;
    }

    function rememberCommitted(chatId, state) {
      if (state) committedStates[chatId] = clone(state);
    }

    // Only roll back when no later mutation replaced the candidate. This keeps a
    // failed older save from overwriting a newer in-memory operation.
    function rollbackFailedCommit(chatId, state, serialized, key, localWritten) {
      if (chats[chatId] !== state) return;
      var currentSerialized;
      try { currentSerialized = JSON.stringify(state); } catch (_) { return; }
      if (currentSerialized !== serialized) return;
      var committed = committedStates[chatId];
      if (!committed) return;
      var restored = clone(committed);
      chats[chatId] = restored;
      if (localWritten) {
        var restoredRaw;
        try { restoredRaw = JSON.stringify(restored); } catch (_) { restoredRaw = null; }
        if (restoredRaw != null && !localSet(key, restoredRaw)) notify('persistenceFailed', { reason: 'local' });
      }
    }

    // Local mirror and lorebook commits share one queue. A save promise therefore
    // means both stores have settled, not merely that the cache was written.
    function save(chatId, state, options) {
      options = options || {};
      chatId = CORE.cleanText(chatId || activeChatId, 160);
      if (casBlocked[chatId]) {
        if (state && chats[chatId] === state && committedStates[chatId]) chats[chatId] = clone(committedStates[chatId]);
        notify('syncConflict', { chatId: chatId });
        return Promise.resolve({ ok: false, localOk: false, worldOk: false, reason: 'conflict' });
      }
      if (options.forceSnapshot) recordClearEpoch(chatId, state);
      var previousRevision = Number(state && state.storageRevision) || 0;
      var previousWriter = String(state && state.storageWriter || '');
      state.storageRevision = previousRevision + 1;
      state.storageWriter = writerId;
      var proposedRevision = state.storageRevision;
      var serialized;
      try { serialized = JSON.stringify(state); } catch (error) {
        dbg('state serialize failed', error);
        notify('persistenceFailed', { reason: 'serialize' });
        if (state.storageRevision === proposedRevision && state.storageWriter === writerId) {
          state.storageRevision = previousRevision;
          state.storageWriter = previousWriter;
        }
        return Promise.resolve({ ok: false, localOk: false, worldOk: false, reason: 'serialize' });
      }
      var stateSnapshot = clone(state);
      if (serialized.length > MAX_SNAPSHOT_BYTES) dbg('serialized state exceeds snapshot limit: ' + serialized.length);
      var key = LOCAL_PREFIX + chatId;
      function restoreRevision() {
        if (state.storageRevision !== proposedRevision || state.storageWriter !== writerId) return;
        state.storageRevision = previousRevision;
        state.storageWriter = previousWriter;
      }
      function conflict() {
        casBlocked[chatId] = true;
        rollbackFailedCommit(chatId, state, serialized, key, false);
        restoreRevision();
        notify('syncConflict', { chatId: chatId });
        return { ok: false, localOk: false, worldOk: false, reason: 'conflict' };
      }
      var localTask = saveQueue.then(function () {
        if (casBlocked[chatId]) return conflict();
        var latest = parseStored(localGet(key));
        var latestRevision = Number(latest && latest.storageRevision) || 0;
        var latestWriter = String(latest && latest.storageWriter || '');
        if (latest && (latestRevision > previousRevision ||
            (latestRevision === previousRevision && latestWriter !== previousWriter))) return conflict();
        if (!localSet(key, serialized)) {
          notify('persistenceFailed', { reason: 'local' });
          return { ok: false, localOk: false, worldOk: false, reason: 'local' };
        }
        if (syncChannel) {
          try { syncChannel.postMessage({ type: 'yz-storage-changed', key: key, revision: proposedRevision, writer: writerId }); } catch (_) {}
        }
        return { ok: true, localOk: true, worldOk: true };
      }).catch(function (error) {
        dbg('save failed: ' + chatId, error);
        notify('persistenceFailed', { reason: 'local' });
        return { ok: false, localOk: false, worldOk: false, reason: 'local' };
      });
      var commitTask = localTask.then(function (localResult) {
        // 本地镜像只是缓存；本地写失败时仍尝试写权威世界书，但整体结果保持失败，
        // 让 UI 不会把“只保存到世界书”的降级状态误报为完整成功。
        if (!localResult.ok && localResult.reason !== 'local') return localResult;
        var touched = CORE.stateHasPersistableData(stateSnapshot);
        if (!touched && !options.forceSnapshot) {
          if (localResult.ok) rememberCommitted(chatId, stateSnapshot);
          else rollbackFailedCommit(chatId, state, serialized, key, false);
          return localResult;
        }
        return writeArchive(chatId, { forceSnapshot: !!options.forceSnapshot, stateSnapshot: stateSnapshot }).then(function (worldResult) {
          if (!worldResult || !worldResult.ok) {
            notify('persistenceFailed', { reason: worldResult && worldResult.reason || 'world' });
            rollbackFailedCommit(chatId, state, serialized, key, localResult.localOk === true);
            return { ok: false, localOk: localResult.localOk, worldOk: false, reason: worldResult && worldResult.reason || 'world' };
          }
          rememberCommitted(chatId, stateSnapshot);
          return { ok: localResult.localOk === true, localOk: localResult.localOk, worldOk: true, reason: localResult.localOk ? '' : 'local' };
        }).catch(function (error) {
          dbg('world save failed: ' + chatId, error);
          notify('persistenceFailed', { reason: 'world' });
          rollbackFailedCommit(chatId, state, serialized, key, localResult.localOk === true);
          return { ok: false, localOk: localResult.localOk, worldOk: false, reason: 'world' };
        });
      });
      saveQueue = commitTask.then(function () {}, function () {});
      return commitTask;
    }

    function attachSaved(result, promise) {
      Object.defineProperty(result, 'saved', { value: promise || Promise.resolve({ ok: true }), enumerable: false });
      return result;
    }

    // 世界书快照读取：玉兆档案·<chatId> 书里的分片快照条目（yz-snap-N / yz-psnap-N，
    // enabled:false 永不注入）按 index 拼接还原整份 v3 状态。片序缺失、包装损坏或
    // body 不是当前 schema 时返回 corrupt，不能把损坏快照误判为空白。
    async function lorebookSnapshotState(chatId, kind) {
      kind = kind === 'player' ? 'player' : 'role';
      var lore = tavoApi.lorebook;
      if (!lore || typeof lore.find !== 'function') return { state: null, status: 'unavailable' };
      try {
        var found = await Promise.resolve(lore.find(ARCHIVE_NAME_PREFIX + chatId.slice(0, 40), { match: 'exact' }));
        var book = Array.isArray(found) && found[0] && Array.isArray(found[0].entries) ? found[0] : null;
        if (!book) return { state: null, status: 'missing' };
        var entries = safeArray(book.entries, 200);
        var shards = [];
        entries.forEach(function (entry) {
          var m = /^(yz-snap|yz-psnap)-(\d+)$/.exec(String(entry && entry.identifier) || '');
          if (entry && (entry.identifier === 'yz-snap' || entry.identifier === 'yz-psnap')) shards.push({ n: 0, content: null, malformed: true });
          if (!m) return;
          if ((m[1] === 'yz-psnap') !== (kind === 'player')) return;
          shards.push({ n: Number(m[2]) || 0, content: entry.content });
        });
        if (shards.length) {
          if (shards.length > MAX_SNAP_SHARDS) return { state: null, status: 'corrupt' };
          shards.sort(function (a, b) { return a.n - b.n; });
          var bodies = [];
          var valid = true;
          for (var i = 0; i < shards.length; i += 1) {
            var shard = parseStored(shards[i].content);
            if (shards[i].malformed || !shard || shard.v !== 2 || shard.kind !== kind || shard.index !== i + 1 || shard.total !== shards.length) { valid = false; break; }
            bodies.push(String(shard.body == null ? '' : shard.body));
          }
          if (valid) {
            var parsed = parseStored(bodies.join(''));
            if (parsed && parsed.schemaVersion === CURRENT_SCHEMA_VERSION && Array.isArray(parsed.spaces) && parsed.spaces.length <= MAX_SPACES) {
              return { state: parsed, status: 'ok' };
            }
          }
          return { state: null, status: 'corrupt' };
        }
        return { state: null, status: 'missing' };
      } catch (error) {
        dbg('lorebook snapshot restore failed', error);
        return { state: null, status: 'unavailable' };
      }
    }

    // 存储恢复链：世界书（权威）→ 本地镜像（缓存）→ 空白。
    // 镜像与世界书同源同内容时取最新：save 先写镜像后排队写世界书（还可能被 busy 合并），
    // 所以镜像的 updatedAt 恒不早于世界书；revision 严格更高或平局时更新者胜。
    // 任何非世界书来源读到的数据都回写世界书（首次使用自动迁移）；世界书读到则回写镜像。
    async function load(chatId) {
      var worldResult = await lorebookSnapshotState(chatId);
      var world = worldResult.state;
      var fromWorld = worldResult.status === 'ok';
      var rawMirror = localGet(LOCAL_PREFIX + chatId);
      var mirrored = parseStored(rawMirror);
      var mirrorRev = CORE.stateRevision(mirrored);
      var worldRev = CORE.stateRevision(world);
      var mirrorTime = Number(mirrored && mirrored.updatedAt) || 0;
      var worldTime = Number(world && world.updatedAt) || 0;
      // 数据损坏检测：localStorage 有值但 JSON 解析失败（corrupted），
      // 或曾经有数据（rev > 0）但现在 sources 全空——静默丢数据给用户造成困惑。
      var mirrorCorrupted = rawMirror != null && !mirrored;
      var parsed = null;
      if (mirrored && (!world || mirrorRev > worldRev || (mirrorRev === worldRev && mirrorTime >= worldTime))) {
        parsed = mirrored;
      } else if (world) {
        parsed = world;
      }
      if (parsed) {
        if (worldResult.status === 'corrupt') notify('snapshotCorrupted', { chatId: chatId });
      } else if (mirrorCorrupted || worldResult.status === 'corrupt' || ((mirrorRev > 0 || worldRev > 0) && !parsed)) {
        // 数据损坏：明确提示，不能把损坏来源当成“没有数据”。
         notify(worldResult.status === 'corrupt' ? 'snapshotCorrupted' : 'storageCorrupted', { chatId: chatId });
      }
      if (parsed && !fromWorld && chatId === activeChatId) await syncArchive(chatId, { stateSnapshot: parsed });
      if (parsed && !localSet(LOCAL_PREFIX + chatId, JSON.stringify(parsed))) notify('persistenceFailed', { reason: 'local' });
      var normalized = CORE.normalizeState(parsed, chatId);
      clearEpochs[chatId] = Math.max(Number(clearEpochs[chatId]) || 0, Number(normalized.clearEpoch) || 0);
      try { Object.defineProperty(normalized, '__loadedSource', { value: parsed ? (fromWorld ? 'world' : 'mirror') : 'none', enumerable: false }); } catch (_) {}
      return normalized;
    }

    async function findAssistantMessages() {
      try {
        if (!tavoApi.message || typeof tavoApi.message.find !== 'function') return [];
        var rows = await Promise.resolve(tavoApi.message.find(null, { role: 'assistant' }));
        return Array.isArray(rows) ? rows : [];
      } catch (error) { dbg('message find failed', error); return null; }
    }

    function applySnapshotsToState(state, snapshots, source, visibility, coreOptions) {
      var changed = false;
      var persist = false;
      var oversized = false;
      var assessment = null;
      var appliedIds = [];
      snapshots.forEach(function (snapshot) {
        var before = CORE.stateRevision(state);
        var targetVisibility = visibility && visibility[CORE.decodeSpaceRoute(snapshot.turn && snapshot.turn.space) || CORE.DEFAULT_SPACE_ID];
        var result = CORE.applySnapshot(state, snapshot, getFlags(), targetVisibility || visibility, coreOptions);
        state = result.state;
        assessment = result.assessment;
        if (result.persist) persist = true;
        if (result.oversized) oversized = true;
        if (CORE.stateRevision(state) !== before || result.applied.length) changed = true;
        result.applied.forEach(function (id) { if (appliedIds.indexOf(id) < 0) appliedIds.push(id); });
      });
      // 各空间未读徽标随新写入重算（用户线程 = 尾随回复数 − seen）。
      state.spaces.forEach(function (sp) { CORE.recomputeThreadUnread(sp); });
      var dsp = CORE.defaultSpaceState(state);
      if (dsp) dsp.sync.lastSource = source || '';
      return { state: state, changed: changed, persist: persist, oversized: oversized, assessment: assessment, appliedIds: appliedIds };
    }

    function historySignature(rows) {
      var last = rows.length ? rows[rows.length - 1] : null;
      var lastId = historyRowId(last);
      return rows.length + ':' + (lastId == null ? '' : String(lastId));
    }

    function historyRowId(row) {
      return row && (row.id != null ? row.id : row.messageId);
    }

    // 签名一致说明历史未变化且已按该版本水化过。
    function snapshotsPending(state, sig) {
      return !(state && state.hydration && state.hydration.sig === sig);
    }

    async function hydrateHistory(chatId, token, state) {
      var rows = await findAssistantMessages();
      if (!Array.isArray(rows)) return { stale: false, state: state, changed: false };
      if (token !== epoch || chatId !== activeChatId) return { stale: true, state: state, changed: false };
      // 水化版本标记：消息条数与末条 id 未变化时复用已持久化状态，避免长聊天每次开聊全量重扫。
      // 已知盲区：编辑中间楼层不会改变签名，由 App 层对无信封 message:updated 的去抖重建兜底。
      var sig = historySignature(rows);
      if (!snapshotsPending(state, sig)) return { stale: false, state: state, changed: false };
      var scanRows = rows;
      var cutoff = state.hydration && state.hydration.cutoff;
      if (cutoff) {
        var cutoffIndex = -1;
        rows.forEach(function (row, index) { if (String(historyRowId(row)) === String(cutoff)) cutoffIndex = index; });
        if (cutoffIndex >= 0) scanRows = rows.slice(cutoffIndex + 1);
      }
      var snapshots = [];
      scanRows.forEach(function (message) {
        PROTOCOL.extractSnapshots(message && (message.content != null ? message.content : message.text) || '').forEach(function (snapshot) { snapshots.push(snapshot); });
      });
      if (!snapshots.length) {
        // 历史中从未出现协议块：也记下签名，之后开聊直接复用，不再全文扫描。
        state.hydration = { sig: sig, cutoff: cutoff || '' };
        return { stale: false, state: state, changed: false, marked: true };
      }
      var applied = applySnapshotsToState(state, snapshots, 'history');
      applied.state.hydration = { sig: sig, cutoff: cutoff || '' };
      return { stale: false, state: applied.state, changed: true };
    }

    async function markHistoryCutoff(chatId) {
      chatId = CORE.cleanText(chatId || activeChatId, 160);
      var rows = await findAssistantMessages();
      if (!Array.isArray(rows)) return { ok: false, stale: false, reason: 'history-unavailable' };
      if (chatId !== activeChatId) return { ok: false, stale: true, reason: 'inactive' };
      var state = chats[chatId] || current();
      var lastId = rows.length ? historyRowId(rows[rows.length - 1]) : '';
      state.hydration = { sig: historySignature(rows), cutoff: cleanText(lastId, 160) };
      return save(chatId, state, { forceSnapshot: true });
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
      // 读存储前等本地镜像与世界书提交队列排空，避免读取陈旧/空白数据。
      await saveQueue;
      var loaded = await load(chatId);
      if (token !== epoch || chatId !== activeChatId) return current();
      // load 的 await 期间若有事件真正写入内存（应用过快照、更新过 sync），保留内存版本，
      // 避免被刚读出的旧持久化状态整体覆盖；但仅被 current() 读过的空白占位不算数——
      // 否则持久化状态会被空白态顶掉，随后水化标记签名还会把空白态回写覆盖存储（丢数据）。
      var existing = chats[chatId];
      var touched = !!existing && (CORE.stateRevision(existing) > 0 || CORE.stateDataUpdatedAt(existing) > 0);
      if (casBlocked[chatId] && loaded.__loadedSource !== 'none') {
        chats[chatId] = loaded;
        rememberCommitted(chatId, loaded);
        delete casBlocked[chatId];
      } else if (!touched) {
        chats[chatId] = loaded;
        rememberCommitted(chatId, loaded);
      } else if (!committedStates[chatId]) {
        rememberCommitted(chatId, loaded);
      }
      var state = chats[chatId];
      // 版本变化（插件更新/卸载重装恢复）→ 持久化强制全量标记：下一轮生成按新提示词
      // 全量重写数据（旧格式行全部刷新，不再粘滞）；重启不丢标记。
      if (state.pluginVersion !== PLUGIN_VERSION) {
        state.pluginVersion = PLUGIN_VERSION;
        state.pendingFull = true;
        await save(chatId, state);
      }
      // 旧玩家域数据 →「我」空间（双域时代遗产一次性迁移；读完即删旧键）。
      if (await migratePlayerToSpace(state)) await save(chatId, state);
      var hydrated = await hydrateHistory(chatId, token, state);
      if (hydrated.stale || token !== epoch || chatId !== activeChatId) return current();
      // 水化 await 期间可能有一轮新生成落地（chats[chatId] 已被替换为新对象）：
      // 引用一致才写回，避免用进入时捕获的旧 state 覆盖新轮次（静默回滚）。
      if (chats[chatId] === state) {
        chats[chatId] = hydrated.state;
        if (hydrated.changed || hydrated.marked) await save(chatId, hydrated.state);
      }
      return current();
    }

    async function rebuildFromHistory(chatId) {
      chatId = CORE.cleanText(chatId || activeChatId, 160);
      if (chatId !== activeChatId) return { stale: true, restored: false };
      epoch += 1;
      var token = epoch;
      // 读存储前等本地镜像与世界书提交队列排空，避免读取陈旧/空白数据。
      await saveQueue;
      // 重建 = 从权威存储恢复：世界书快照（yz-snap/yz-psnap 分片）→ 本地镜像。
      // 历史消息正文经正文剥离后不含协议块，旧「从历史重建」数据源已随持久化改造
      // 移除；世界书快照才是当前唯一权威来源。
      var loaded = await load(chatId);
      if (token !== epoch || chatId !== activeChatId) return { stale: true, restored: false };
      if (casBlocked[chatId] && loaded.__loadedSource !== 'none') {
        chats[chatId] = loaded;
        rememberCommitted(chatId, loaded);
        delete casBlocked[chatId];
      }
      var restoredData = CORE.stateHasPersistableData(loaded);
      if (!restoredData) {
        // 权威存储中没有玉兆数据（从未同步或已清空）：保留现有数据，不用空白覆盖。
        return { stale: false, restored: false };
      }
      // 版本变化（插件更新/卸载重装恢复）→ 强制全量标记：下一轮生成按新提示词全量重写。
      if (loaded.pluginVersion !== PLUGIN_VERSION) {
        loaded.pluginVersion = PLUGIN_VERSION;
        loaded.pendingFull = true;
      }
      chats[chatId] = loaded;
      if (await migratePlayerToSpace(loaded)) { /* 迁移结果随下方落盘 */ }
      // 恢复结果落盘：镜像 + 世界书快照幂等对齐。
      await save(chatId, chats[chatId] || loaded);
      return { stale: false, restored: true };
    }

    function current() {
      if (!chats[activeChatId]) {
        // normalizeState(null) → v2 空白（spaces 里只有一个默认空间）。
        chats[activeChatId] = CORE.normalizeState(null, activeChatId);
        rememberCommitted(activeChatId, chats[activeChatId]);
        rememberChat(activeChatId);
        evictChats();
      }
      return chats[activeChatId];
    }

    // ---------- 用户空间运行时 ----------
    // 所有读写都落在「当前空间」上：AI 协议按 turn 行空间名路由（缺省=默认空间），
    // 用户 CRUD 显式带 spaceId。空间数据变更统一走 saveSpace（刷 updatedAt + 未读重算 + 落盘）。
    function activeSpace() {
      var state = current();
      return CORE.findSpaceState(state, state.activeSpaceId) || state.spaces[0];
    }

    function saveSpace(space) {
      if (!space) return saveQueue;
      space.updatedAt = Date.now();
      CORE.recomputeThreadUnread(space);
      var state = current();
      state.updatedAt = Date.now();
      return save(activeChatId, state);
    }

    function nextSpaceId(state) {
      var n = 1;
      while (state.spaces.some(function (s) { return s.id === 'sp' + n; })) n += 1;
      return 'sp' + n;
    }

    function spaceNameTaken(state, name, exceptId) {
      var lower = String(name || '').trim().toLowerCase();
      return state.spaces.some(function (s) {
        return String(s.id).toLowerCase() === lower || (s.id !== exceptId && String(s.name || '').toLowerCase() === lower);
      });
    }

    function createSpace(rawName) {
      var name = cleanText(rawName, 120).trim();
      if (!hasText(name)) return { ok: false, reason: 'name' };
      var state = current();
      // 缺默认空间时预留一个槽位给后续自动重建，避免先建满 6 个自定义空间
      // 后再也无法恢复默认路由。
      if (state.spaces.length >= MAX_SPACES || (!defaultSpaceState(state) && state.spaces.length >= MAX_SPACES - 1)) return { ok: false, reason: 'full' };
      if (spaceNameTaken(state, name) || name.toLowerCase() === DEFAULT_SPACE_ID) return { ok: false, reason: 'clash' };
      var sp = CORE.blankUserSpace(state.chatId, { id: nextSpaceId(state), name: name, createdAt: Date.now() });
      state.spaces.push(sp);
      state.updatedAt = Date.now();
      return attachSaved({ ok: true, id: sp.id }, save(activeChatId, state));
    }

    // 默认空间名恒空（显示跟随角色名），不可重命名。
    function renameSpace(id, rawName) {
      var name = cleanText(rawName, 120).trim();
      if (!hasText(name)) return { ok: false, reason: 'name' };
      var state = current();
      var sp = CORE.findSpaceState(state, id);
      if (!sp) return { ok: false, reason: 'missing' };
      if (sp.isDefault) return { ok: false, reason: 'default' };
      if (spaceNameTaken(state, name, sp.id) || name.toLowerCase() === DEFAULT_SPACE_ID) return { ok: false, reason: 'clash' };
      sp.name = name;
      state.updatedAt = Date.now();
      return attachSaved({ ok: true }, save(activeChatId, state));
    }

    function setSpaceFlag(id, key, value) {
      if (key !== 'sendToAI' && key !== 'allowAIWrite') return { ok: false, reason: 'key' };
      var state = current();
      var sp = CORE.findSpaceState(state, id);
      if (!sp) return { ok: false, reason: 'missing' };
      // 默认空间必须允许 AI 写入（协议缺省落点）；sendToAI 可关（纯本地角色档案）。
      if (sp.isDefault && key === 'allowAIWrite' && value === false) return { ok: false, reason: 'default' };
      sp[key] = !!value;
      state.updatedAt = Date.now();
      return attachSaved({ ok: true }, save(activeChatId, state));
    }

    // 删除空间（含默认空间——数据到达时会自动重建）；快照返回供撤销。
    function deleteSpace(id) {
      var state = current();
      var index = -1;
      state.spaces.forEach(function (s, i) { if (s.id === id) index = i; });
      if (index < 0) return { ok: false, reason: 'missing' };
      var removed = state.spaces.splice(index, 1)[0];
      if (state.activeSpaceId === id) state.activeSpaceId = state.spaces.length ? state.spaces[0].id : '';
      state.updatedAt = Date.now();
      return attachSaved({ ok: true, snapshot: removed }, save(activeChatId, state));
    }

    function restoreSpace(snapshot) {
      var sp = snapshot && snapshot.id && snapshot.name !== undefined && (snapshot.tablet || snapshot.chats) ? CORE.normalizeUserSpace(snapshot, activeChatId) : null;
      if (!sp) return { ok: false, reason: 'bad' };
      var state = current();
      if (state.spaces.length >= MAX_SPACES || (!sp.isDefault && !defaultSpaceState(state) && state.spaces.length >= MAX_SPACES - 1)) return { ok: false, reason: 'full' };
      // 删除后新建空间可能复用了同一个 id；旧撤销快照此时不能假装成功，
      // 否则用户以为旧数据已恢复，实际仍是新空间的数据。
      if (state.spaces.some(function (s) { return s.id === sp.id; })) return { ok: false, reason: 'id-reused' };
      if (!sp.isDefault && (String(sp.id).toLowerCase() === DEFAULT_SPACE_ID || String(sp.name).toLowerCase() === DEFAULT_SPACE_ID)) return { ok: false, reason: 'name' };
      if (!sp.isDefault && String(sp.name).toLowerCase() === String(sp.id).toLowerCase()) return { ok: false, reason: 'name' };
      if (sp.isDefault && defaultSpaceState(state)) return { ok: false, reason: 'id-reused' };
      if (!sp.isDefault && spaceNameTaken(state, sp.name)) return { ok: false, reason: 'name' };
      state.spaces.push(sp);
      state.updatedAt = Date.now();
      return attachSaved({ ok: true }, save(activeChatId, state));
    }

    function setActiveSpace(id) {
      var state = current();
      var sp = CORE.findSpaceState(state, id);
      if (!sp) return { ok: false, reason: 'missing' };
      state.activeSpaceId = sp.id;
      state.updatedAt = Date.now();
      return attachSaved({ ok: true }, save(activeChatId, state));
    }

    // ---------- 空间内消息与实体（本机直写，不经模型） ----------
    function spaceThread(space, threadId) {
      if (!space) return null;
      var found = null;
      safeArray(space.chats && space.chats.contacts, 10).forEach(function (c) { if (c && String(c.id) === String(threadId)) found = c; });
      if (found) return found;
      safeArray(space.chats && space.chats.groups, 6).forEach(function (g) { if (g && String(g.id) === String(threadId)) found = g; });
      return found;
    }

    function isGroupThread(space, threadId) {
      var group = null;
      safeArray(space.chats && space.chats.groups, 6).forEach(function (g) { if (g && String(g.id) === String(threadId)) group = g; });
      return !!group;
    }

    // 用户发言 id：pm-<seq>（私讯）/ pmg-<seq>（群聊），线程内按现有最大值 +1。
    // 这些 id 是门禁保护行——模型不得伪造、改写、删除（见 diffChats）。
    function nextUserSeq(messages, pattern) {
      var max = 0;
      safeArray(messages, 100).forEach(function (m) {
        var n = pattern.exec(String(m && m.id) || '');
        if (n) max = Math.max(max, Number(n[1]) || 0);
      });
      return max + 1;
    }

    function sendSpaceMessage(spaceId, threadId, text) {
      text = cleanText(String(text == null ? '' : text), 3000);
      if (!hasText(text)) return null;
      var space = CORE.findSpaceState(current(), spaceId);
      var thread = spaceThread(space, threadId);
      if (!thread) return null;
      var group = isGroupThread(space, threadId);
      var message = group
        ? { id: 'pmg-' + nextUserSeq(thread.messages, /^pmg-(\d+)$/), sender: cleanText(spaceOwnerName(space), 120), side: 'self', time: formatDateTime(Date.now()), text: text }
        : { id: 'pm-' + nextUserSeq(thread.messages, /^pm-(\d+)$/), side: 'self', time: formatDateTime(Date.now()), text: text };
      thread.messages = safeArray(thread.messages, 100).concat([message]);
      var cap = group ? 24 : 20;
      if (thread.messages.length > cap) {
        thread.messages = tail(thread.messages, cap);
        thread.archived = true;
      }
      thread.preview = text;
      thread.time = message.time;
      thread.seen = 0;
      thread.anchorId = message.id;
      thread.replyCount = 0;
      thread.seenReplies = 0;
      return attachSaved({ id: message.id }, saveSpace(space));
    }

    // 空间发言署名：默认空间用户发言署「我」语境名——统一取 {{user}}…
    // 宿主用户身份名异步解析（chat.persona.name），缓存供同步签名使用；缺省回退空间名。
    var ownerNameCache = '';
    function spaceOwnerName(space) {
      return ownerNameCache || (space && space.isDefault ? '' : cleanText(space && space.name, 120)) || '我';
    }

    async function resolveOwnerName() {
      try {
        if (tavoApi.chat && typeof tavoApi.chat.current === 'function') {
          var chat = await Promise.resolve(tavoApi.chat.current());
          var name = chat && chat.persona && chat.persona.name;
          if (hasText(name)) { ownerNameCache = cleanText(name, 120); return ownerNameCache; }
        }
      } catch (error) { dbg('owner name resolve failed', error); }
      return ownerNameCache;
    }

    // 论坛评论（用户侧真实发言）：pmc-<n> id，作者=用户身份名；模型不得触碰。
    function sendSpaceComment(spaceId, postId, text) {
      text = cleanText(String(text == null ? '' : text), 3000);
      if (!hasText(text)) return null;
      var space = CORE.findSpaceState(current(), spaceId);
      if (!space) return null;
      var post = null;
      safeArray(space.forum && space.forum.posts, 20).forEach(function (p) { if (p && String(p.id) === String(postId)) post = p; });
      if (!post) return null;
      if (safeArray(post.comments, 100).length >= 20) return { ok: false, reason: 'full' };
      var comment = { id: 'pmc-' + nextUserSeq(post.comments, /^pmc-(\d+)$/), owner: 'player', author: cleanText(spaceOwnerName(space), 120), time: formatDateTime(Date.now()), text: text };
      post.comments = safeArray(post.comments, 20).concat([comment]);
      post.replyCount = nzero(post.replyCount);
      return attachSaved({ ok: true, id: comment.id }, saveSpace(space));
    }

    // 打开线程/帖子 = 已读：线程 seen 游标对齐尾随回复数；帖子 unread 清零。
    function markSpaceThreadSeen(spaceId, threadId) {
      var space = CORE.findSpaceState(current(), spaceId);
      var thread = spaceThread(space, threadId);
      if (!thread) return false;
      thread.seen = Math.max(0, userTail(thread));
      if (thread.anchorId) thread.seenReplies = nzero(thread.replyCount);
      thread.unread = 0;
      saveSpace(space);
      return true;
    }

    function markSpacePostSeen(spaceId, postId) {
      var space = CORE.findSpaceState(current(), spaceId);
      if (!space) return false;
      var touched = false;
      safeArray(space.forum && space.forum.posts, 20).forEach(function (p) {
        if (!p || String(p.id) !== String(postId)) return;
       if (String(p.owner) === 'player') {
         p.seenReplies = nzero(p.replyCount);
         p.seen = postReplyCount(p);
       }
        if (nzero(p.unread) > 0) { p.unread = 0; touched = true; }
      });
      if (touched) saveSpace(space);
      return touched;
    }

    // ---------- 空间实体 CRUD（folder/note/item/currency/order/post/contact，用户直写） ----------
    // 写入前校验必填；返回 { ok } 或 { ok:false, reason }（UI 翻译为提示文案）。
    function spaceSaveEntity(spaceId, kind, raw, existingId) {
      kind = cleanText(kind, 20);
      raw = raw || {};
      existingId = String(existingId == null ? '' : existingId);
      var space = CORE.findSpaceState(current(), spaceId);
      if (!space) return { ok: false, reason: 'space' };
      var reason = '';
      function fail() { return { ok: false, reason: reason }; }

      if (kind === 'contact') {
        var cname = cleanText(raw.name, 120);
        if (!hasText(cname)) reason = 'name';
        if (reason) return fail();
        var contact = CORE.playerFindEntity(space, 'contact', existingId);
        if (!contact && safeArray(space.chats.contacts, 10).length >= 10) return { ok: false, reason: 'full' };
        if (contact) {
          contact.name = cname;
          contact.relation = cleanText(raw.relation, 120);
        } else {
          space.chats.contacts = safeArray(space.chats.contacts, 10).concat([{ id: CORE.playerNextId(space.chats.contacts, 'c-'), name: cname, relation: cleanText(raw.relation, 120), time: '', unread: 0, preview: '', archived: false, seen: 0, messages: [] }]);
        }
        space.chats = CORE.normalizeChats(space.chats);
      } else if (kind === 'folder') {
        var name = cleanText(raw.name, 120);
        if (!hasText(name)) reason = 'name';
        if (reason) return fail();
        // 校验通过后才变更对象：失败路径不得留下已改坏/空必填的实体，
        // 否则下一次 normalize 会整行丢弃并级联其下数据。
        var folder = CORE.playerFindEntity(space, 'folder', existingId);
        if (!folder && safeArray(space.notes.folders, 10).length >= 10) return { ok: false, reason: 'full' };
        if (folder) folder.name = name;
        // safeArray 返回副本：新建必须把拼接结果写回状态，否则 push 在副本上丢失。
        else space.notes.folders = safeArray(space.notes.folders, 10).concat([{ id: CORE.playerNextId(space.notes.folders, 'pf-'), name: name, count: 0 }]);
        space.notes = CORE.normalizeNotes(space.notes);
      } else if (kind === 'note') {
        var title = cleanText(raw.title, 200);
        var body = cleanText(raw.body, 3000);
        var folderId = cleanText(raw.folderId, 160);
        if (!hasText(title)) reason = 'title';
        var folderOk = safeArray(space.notes.folders, 10).some(function (f) { return String(f.id) === String(folderId); });
        if (!folderOk) reason = 'folder';
        if (reason) return fail();
        var note = CORE.playerFindEntity(space, 'note', existingId);
        if (!note && safeArray(space.notes.notes, 30).length >= 30) return { ok: false, reason: 'full' };
        if (note) {
          note.title = title;
          note.body = body;
          note.locked = !!raw.locked;
          note.updated = formatDateTime(Date.now());
        } else {
          space.notes.notes = safeArray(space.notes.notes, 30).concat([{ id: CORE.playerNextId(space.notes.notes, 'pn-'), folderId: folderId, updated: formatDateTime(Date.now()), locked: !!raw.locked, title: title, body: body }]);
        }
        space.notes = CORE.normalizeNotes(space.notes);
      } else if (kind === 'item') {
        var iname = cleanText(raw.name, 120);
        if (!hasText(iname)) reason = 'name';
        if (reason) return fail();
        var item = CORE.playerFindEntity(space, 'item', existingId);
        if (!item && safeArray(space.space.items, 30).length >= 30) return { ok: false, reason: 'full' };
        if (item) {
          item.name = iname;
          item.qty = Math.max(0, Number(raw.qty) || 0);
          item.grade = cleanText(raw.grade, 60);
          item.desc = cleanText(raw.desc, 3000);
        } else space.space.items = safeArray(space.space.items, 30).concat([{ id: CORE.playerNextId(space.space.items, 'pi-'), name: iname, qty: Math.max(0, Number(raw.qty) || 0), grade: cleanText(raw.grade, 60), desc: cleanText(raw.desc, 3000) }]);
        space.space = CORE.normalizeSpace(space.space);
      } else if (kind === 'currency') {
        var ckind = cleanText(raw.kind, 60);
        if (!hasText(ckind)) reason = 'kind';
        if (!reason) {
          var clash = safeArray(space.space.currencies, 10).some(function (c) { return String(c.kind) === ckind && String(c.kind) !== existingId; });
          if (clash) reason = 'kindClash';
        }
        if (reason) return fail();
        var currency = CORE.playerFindEntity(space, 'currency', existingId);
        if (!currency && safeArray(space.space.currencies, 10).length >= 10) return { ok: false, reason: 'full' };
        space.space.currencies = safeArray(space.space.currencies, 10).filter(function (c) { return !currency || String(c.kind) !== existingId; }).concat([{ kind: ckind, amount: cleanText(raw.amount, 80) }]);
        space.space = CORE.normalizeSpace(space.space);
      } else if (kind === 'order') {
        var oname = cleanText(raw.name, 120);
        if (!hasText(oname)) reason = 'name';
        if (reason) return fail();
        var order = CORE.playerFindEntity(space, 'order', existingId);
        if (!order && safeArray(space.market.orders, 12).length >= 12) return { ok: false, reason: 'full' };
        var side = /^(sell|卖|售)/i.test(String(raw.side)) ? 'sell' : 'buy';
        if (order) {
          order.name = oname;
          order.status = cleanText(raw.status, 40);
          order.price = cleanText(raw.price, 80);
          order.side = side;
          order.time = formatDateTime(Date.now());
        } else space.market.orders = safeArray(space.market.orders, 12).concat([{ id: CORE.playerNextId(space.market.orders, 'po-'), name: oname, status: cleanText(raw.status, 40), price: cleanText(raw.price, 80), time: formatDateTime(Date.now()), side: side }]);
        space.market = CORE.normalizeMarket(space.market);
      } else if (kind === 'post') {
        // 用户发帖（owner=player 标记，diff 门禁保护）：空间内私有论坛数据。
        var ptitle = cleanText(raw.title, 200);
        if (!hasText(ptitle)) reason = 'title';
        if (reason) return fail();
        var post = CORE.playerFindEntity(space, 'post', existingId);
        if (!post && safeArray(space.forum.posts, 20).length >= 20) return { ok: false, reason: 'full' };
        if (post) {
          post.title = ptitle;
          post.section = cleanText(raw.section, 60);
          post.body = cleanText(raw.body, 3000);
          post.time = formatDateTime(Date.now());
        } else {
          space.forum.posts = safeArray(space.forum.posts, 20).concat([{ id: CORE.playerNextId(space.forum.posts, 'fp-'), owner: 'player', author: cleanText(spaceOwnerName(space), 120), role: '', section: cleanText(raw.section, 60), time: formatDateTime(Date.now()), title: ptitle, body: cleanText(raw.body, 3000), resonance: 0, unread: 0, seen: 0, comments: [] }]);
        }
        space.forum = CORE.normalizeForum(space.forum);
      } else {
        return { ok: false, reason: 'kind' };
      }

      return attachSaved({ ok: true }, saveSpace(space));
    }

    // 实体删除（含联系人/群聊/单条消息/行踪/地点）；返回删除前快照供撤销。
    function spaceDeleteEntity(spaceId, kind, id, extraId) {
      kind = cleanText(kind, 20);
      id = String(id == null ? '' : id);
      extraId = String(extraId == null ? '' : extraId);
      var space = CORE.findSpaceState(current(), spaceId);
      if (!space) return { ok: false, reason: 'space' };
      var snapshot = { chatId: activeChatId, spaceId: space.id, kind: kind, entity: null, parentId: extraId };
      if (kind === 'contact' || kind === 'group') {
        var list = kind === 'contact' ? safeArray(space.chats.contacts, 10) : safeArray(space.chats.groups, 6);
        snapshot.entity = list.filter(function (x) { return String(x.id) === id; })[0] || null;
        if (!snapshot.entity) return { ok: false, reason: 'missing' };
        var rest = list.filter(function (x) { return String(x.id) !== id; });
        if (kind === 'contact') space.chats.contacts = rest; else space.chats.groups = rest;
      } else if (kind === 'message') {
        var target = spaceThread(space, extraId);
        if (!target) return { ok: false, reason: 'missing' };
        snapshot.entity = safeArray(target.messages, 100).filter(function (m) { return String(m.id) === id; })[0] || null;
        if (!snapshot.entity) return { ok: false, reason: 'missing' };
        target.messages = safeArray(target.messages, 100).filter(function (m) { return String(m.id) !== id; });
      } else if (kind === 'track') {
        snapshot.entity = safeArray(space.map.tracks, 20).filter(function (t) { return String(t.id) === id; })[0] || null;
        if (!snapshot.entity) return { ok: false, reason: 'missing' };
        space.map.tracks = safeArray(space.map.tracks, 20).filter(function (t) { return String(t.id) !== id; });
      } else if (kind === 'place') {
        snapshot.entity = safeArray(space.map.places, 20).filter(function (p) { return String(p.id) === id; })[0] || null;
        if (!snapshot.entity) return { ok: false, reason: 'missing' };
        space.map.places = safeArray(space.map.places, 20).filter(function (p) { return String(p.id) !== id; });
      } else if (kind === 'folder') {
        snapshot.entity = safeArray(space.notes.folders, 10).filter(function (f) { return String(f.id) === id; })[0] || null;
        if (!snapshot.entity) return { ok: false, reason: 'missing' };
        // 玉册夹级联其下备忘：快照一并带回供撤销。
        snapshot.notes = safeArray(space.notes.notes, 30).filter(function (n) { return String(n.folderId) === id; });
        space.notes.folders = safeArray(space.notes.folders, 10).filter(function (f) { return String(f.id) !== id; });
        space.notes.notes = safeArray(space.notes.notes, 30).filter(function (n) { return String(n.folderId) !== id; });
        space.notes = CORE.normalizeNotes(space.notes);
      } else if (kind === 'note') {
        snapshot.entity = safeArray(space.notes.notes, 30).filter(function (n) { return String(n.id) === id; })[0] || null;
        if (!snapshot.entity) return { ok: false, reason: 'missing' };
        space.notes.notes = safeArray(space.notes.notes, 30).filter(function (n) { return String(n.id) !== id; });
        space.notes = CORE.normalizeNotes(space.notes);
      } else if (kind === 'item') {
        snapshot.entity = safeArray(space.space.items, 30).filter(function (i) { return String(i.id) === id; })[0] || null;
        if (!snapshot.entity) return { ok: false, reason: 'missing' };
        space.space.items = safeArray(space.space.items, 30).filter(function (i) { return String(i.id) !== id; });
      } else if (kind === 'currency') {
        snapshot.entity = safeArray(space.space.currencies, 10).filter(function (c) { return String(c.kind) === id; })[0] || null;
        if (!snapshot.entity) return { ok: false, reason: 'missing' };
        space.space.currencies = safeArray(space.space.currencies, 10).filter(function (c) { return String(c.kind) !== id; });
      } else if (kind === 'order') {
        snapshot.entity = safeArray(space.market.orders, 12).filter(function (o) { return String(o.id) === id; })[0] || null;
        if (!snapshot.entity) return { ok: false, reason: 'missing' };
        space.market.orders = safeArray(space.market.orders, 12).filter(function (o) { return String(o.id) !== id; });
      } else if (kind === 'post') {
        snapshot.entity = safeArray(space.forum.posts, 20).filter(function (p) { return String(p.id) === id; })[0] || null;
        if (!snapshot.entity) return { ok: false, reason: 'missing' };
        space.forum.posts = safeArray(space.forum.posts, 20).filter(function (p) { return String(p.id) !== id; });
        space.forum = CORE.normalizeForum(space.forum);
      } else {
        return { ok: false, reason: 'kind' };
      }
      return attachSaved({ ok: true, snapshot: snapshot }, saveSpace(space));
    }

    // 撤销删除：快照实体插回原空间（幂等：唯一键已存在则跳过）。
    function spaceRestoreEntity(snap) {
      if (!snap || !snap.kind || !snap.entity) return { ok: false, reason: 'bad' };
      if (snap.chatId && String(snap.chatId) !== String(activeChatId)) return { ok: false, reason: 'chat' };
      var space = CORE.findSpaceState(current(), snap.spaceId);
      if (!space) return { ok: false, reason: 'space' };
      var kind = snap.kind;
      var entity = snap.entity;
      var limits = { contact: 10, group: 6, message: 20, track: 20, place: 20, folder: 10, note: 30, item: 30, currency: 10, order: 12, post: 20 };
      function keyOf(item) { return kind === 'currency' ? String(item && item.kind) : String(item && item.id); }
      function canInsert(list, value, limit) {
        if (list.some(function (x) { return keyOf(x) === keyOf(value); })) return 'exists';
        return list.length >= limit ? 'full' : '';
      }
      function fail(reason) { return { ok: false, reason: reason }; }
      var target = null;
      var stateList = null;
      if (kind === 'contact') stateList = safeArray(space.chats.contacts, 10);
      else if (kind === 'group') stateList = safeArray(space.chats.groups, 6);
      else if (kind === 'track') stateList = safeArray(space.map.tracks, 20);
      else if (kind === 'place') stateList = safeArray(space.map.places, 20);
      else if (kind === 'folder') stateList = safeArray(space.notes.folders, 10);
      else if (kind === 'note') stateList = safeArray(space.notes.notes, 30);
      else if (kind === 'item') stateList = safeArray(space.space.items, 30);
      else if (kind === 'currency') stateList = safeArray(space.space.currencies, 10);
      else if (kind === 'order') stateList = safeArray(space.market.orders, 12);
      else if (kind === 'post') stateList = safeArray(space.forum.posts, 20);
      else if (kind === 'message') {
        target = spaceThread(space, snap.parentId);
        if (!target) return fail('missing');
        stateList = safeArray(target.messages, isGroupThread(space, snap.parentId) ? 24 : 20);
      } else return fail('kind');
      var check = canInsert(stateList, entity, kind === 'message' ? (isGroupThread(space, snap.parentId) ? 24 : 20) : limits[kind]);
      if (check) return fail(check);
      if (kind === 'note' && !safeArray(space.notes.folders, 10).some(function (f) { return String(f.id) === String(entity.folderId); })) return fail('missing');
      if (kind === 'folder') {
        var extraNotes = safeArray(snap.notes, 30);
        var missingNotes = extraNotes.filter(function (note) {
          return !safeArray(space.notes.notes, 30).some(function (n) { return String(n && n.id) === String(note && note.id); });
        });
        if (space.notes.notes.length + missingNotes.length > 30) return fail('full');
        if (missingNotes.some(function (note) { return String(note.folderId) !== String(entity.id); })) return fail('missing');
      }
      if (kind === 'contact') space.chats.contacts = stateList.concat([entity]);
      else if (kind === 'group') space.chats.groups = stateList.concat([entity]);
      else if (kind === 'message') target.messages = stateList.concat([entity]);
      else if (kind === 'track') space.map.tracks = stateList.concat([entity]);
      else if (kind === 'place') space.map.places = stateList.concat([entity]);
      else if (kind === 'folder') {
        space.notes.folders = stateList.concat([entity]);
        var extraNotes = safeArray(snap.notes, 30);
        if (extraNotes.length) {
          space.notes.notes = safeArray(space.notes.notes, 30).filter(function (n) {
            return !extraNotes.some(function (x) { return String(x && x.id) === String(n && n.id); });
          }).concat(extraNotes).slice(0, 30);
        }
        space.notes = CORE.normalizeNotes(space.notes);
      } else if (kind === 'note') space.notes.notes = stateList.concat([entity]);
      else if (kind === 'item') space.space.items = stateList.concat([entity]);
      else if (kind === 'currency') space.space.currencies = stateList.concat([entity]);
      else if (kind === 'order') space.market.orders = stateList.concat([entity]);
      else if (kind === 'post') space.forum.posts = stateList.concat([entity]);
      return attachSaved({ ok: true }, saveSpace(space));
    }

    // ---------- 旧玩家域数据迁移（双域时代 → 用户空间） ----------
    // 镜像键与世界书 yz-psnap 分片读到的旧玩家状态 → 名为「我」的自定义空间；
    // 迁移完成即删旧镜像键，世界书 yz-psnap 条目随下一次整本替换自然消失。
    async function migratePlayerToSpace(state) {
      if (state.migratedPlayer) return false;
      var chatId = state.chatId;
      var mirrorRaw = localGet(PLAYER_LOCAL_PREFIX + chatId);
      var legacy = parseStored(mirrorRaw);
      var sawSource = mirrorRaw != null;
      if (!legacy) {
        try {
          var playerSnapshot = await lorebookSnapshotState(chatId, 'player');
          legacy = playerSnapshot.state;
          sawSource = sawSource || playerSnapshot.status === 'ok' || playerSnapshot.status === 'corrupt';
        } catch (_) { legacy = null; }
      }
      // 两个来源都没读到（世界书 API 异常时）不标记完成——下次进入本聊天重试。
      if (!sawSource) return false;
      if (!legacy || typeof legacy !== 'object') return false;
      var touched = (Number(legacy.updatedAt) || 0) > 0 ||
        safeArray(legacy.tablet && legacy.tablet.groups, 10).length > 0 ||
        safeArray(legacy.chats && legacy.chats.contacts, 10).length > 0 ||
        safeArray(legacy.chats && legacy.chats.groups, 6).length > 0 ||
        safeArray(legacy.notes && legacy.notes.folders, 10).length > 0 ||
        safeArray(legacy.notes && legacy.notes.notes, 30).length > 0 ||
        safeArray(legacy.forum && legacy.forum.posts, 20).length > 0 ||
        safeArray(legacy.market && legacy.market.listings, 20).length > 0 ||
        safeArray(legacy.market && legacy.market.auctions, 12).length > 0 ||
        safeArray(legacy.market && legacy.market.orders, 12).length > 0 ||
        safeArray(legacy.market && legacy.market.requests, 12).length > 0 ||
        safeArray(legacy.space && legacy.space.currencies, 10).length > 0 ||
        safeArray(legacy.space && legacy.space.items, 30).length > 0 ||
        !!(legacy.map && (hasText(legacy.map.current && legacy.map.current.place) || hasText(legacy.map.current && legacy.map.current.domain) || hasText(legacy.map.current && legacy.map.current.desc) || safeArray(legacy.map.tracks, 20).length || safeArray(legacy.map.places, 20).length));
      state.migratedPlayer = true;
      if (!touched) {
        localRemove(PLAYER_LOCAL_PREFIX + chatId);
        return true;
      }
      var meName = I18N.dict().space.meSpaceName || '我';
      if (spaceNameTaken(state, meName)) meName = meName + '·1';
      var sp = CORE.normalizeUserSpace({
        id: 'sp1',
        name: meName,
        sendToAI: true,
        allowAIWrite: true,
        createdAt: Number(legacy.updatedAt) || Date.now(),
        tablet: legacy.tablet,
        chats: legacy.chats,
        notes: legacy.notes,
        forum: legacy.forum,
        market: legacy.market,
        space: legacy.space,
        map: legacy.map,
        updatedAt: legacy.updatedAt
      }, chatId);
      // id 避让（罕见：sp1 已被占用）。
      if (state.spaces.some(function (s) { return s.id === sp.id; })) sp.id = nextSpaceId(state);
      state.spaces.push(sp);
      localRemove(PLAYER_LOCAL_PREFIX + chatId);
      return true;
    }

    async function applyText(text, chatId, source, options) {
      chatId = CORE.cleanText(chatId || activeChatId, 160);
      if (chatId !== activeChatId) return { changed: false, stale: true, applied: false };
      var state = current();
      var generation = options && options.generationToken;
      if (generation && typeof generation === 'object' && generation.chatId != null &&
          CORE.cleanText(generation.chatId, 160) !== chatId) {
        return { changed: false, stale: true, discarded: true, reason: 'generation-chat', applied: false };
      }
      var tokenEpoch = optionClearEpoch(options);
      var stateEpoch = Math.max(Number(state.clearEpoch) || 0, Number(clearEpochs[chatId]) || 0);
      if (tokenEpoch != null && tokenEpoch !== stateEpoch) {
        return { changed: false, stale: false, discarded: true, reason: 'clear-epoch', clearEpoch: stateEpoch, applied: false };
      }
      var snapshots = PROTOCOL.extractSnapshots(text);
      if (!snapshots.length) {
        if (/<yz_[a-z0-9_]+\b/i.test(String(text || ''))) {
           var dsp = ensureDefaultSpaceState(state);
           if (dsp) dsp.sync = Object.assign({}, dsp.sync, { status: dsp.revision ? dsp.sync.status : 'invalid', lastError: 'parse-error', lastSource: source || '', updatedAt: Date.now() });
           state.updatedAt = Date.now();
           save(chatId, state);
        }
        var perr = (function () { var d = CORE.defaultSpaceState(state); return !!d && d.sync.lastError === 'parse-error'; })();
        return { changed: false, stale: false, applied: false, parseError: perr };
      }
      var realtime = !!(options && options.realtime) || /^(generation(?::|$)|message(?::|$))/.test(String(source || ''));
      var applied = applySnapshotsToState(state, snapshots, source, options && options.visibility, { realtime: realtime });
      chats[chatId] = applied.state;
      if (tokenEpoch != null && clearGates[chatId] && tokenEpoch === clearGates[chatId].epoch) delete clearGates[chatId];
      // 重复投递的轮次不重复落盘；解析失败标记需持久化，重开后仍可见。
      var dflt = CORE.defaultSpaceState(applied.state);
      if (applied.changed || applied.persist || (dflt && dflt.sync.lastError === 'parse-error')) save(chatId, applied.state);
      return {
        changed: applied.changed,
        stale: false,
        oversized: applied.oversized === true,
        // 本轮是否为「达标的全量轮」：声明非 part/diff（mode 字段缺失时按 full 处理）
        // 且所有已启封分区评估达标；part/diff 轮与部分达标的全量轮不算——
        // 封印切换/版本更新后的重同步必须等真正达标的全量轮才清除强制标记。
        full: (function () { var a = applied.assessment; return !!a && !a.part && !a.diff && a.ok === true; })(),
        applied: applied.appliedIds.slice(),
        // 返回 sync 快照而非引用：调用方后续写入状态时不会改变已返回的 assessment。
        assessment: Object.assign({}, dflt ? dflt.sync : {})
      };
    }

    function ensureDefaultSpaceState(state) {
      return CORE.ensureDefaultSpace(state);
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

    // 管理页导入只接受当前 v3 用户空间状态；候选状态在确认前不得替换当前状态。
    function importState(raw) {
      var text = String(raw == null ? '' : raw);
      if (text.length > MAX_SNAPSHOT_BYTES) return { ok: false, reason: 'oversized' };
      var parsed = parseStored(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'parse' };
      if (parsed.schemaVersion !== CURRENT_SCHEMA_VERSION || !Array.isArray(parsed.spaces) || parsed.spaces.length > MAX_SPACES) return { ok: false, reason: 'parse' };
      if (!parsed.spaces.every(function (space) { return space && typeof space === 'object' && hasText(space.id) && typeof space.isDefault === 'boolean'; })) return { ok: false, reason: 'parse' };
      var state = CORE.normalizeState(parsed, activeChatId);
      state.pluginVersion = PLUGIN_VERSION;
      state.pendingFull = true;
      return { ok: true, state: state };
    }

    function commitImport(state) {
      if (!state || state.schemaVersion !== CURRENT_SCHEMA_VERSION) return { ok: false, reason: 'parse' };
      state = CORE.normalizeState(state, activeChatId);
      chats[activeChatId] = state;
      rememberChat(activeChatId);
      evictChats();
      return attachSaved({ ok: true }, save(activeChatId, state, { forceSnapshot: true }));
    }

    // ---------- 世界书归档：token 预算的召回半边 ----------
    // 基线只注入最近窗口（最新数据），窗口之外的历史消息镜像到插件管理的世界书：
    // 每个联系人/群一个关键词条目，正文提及实体名时 Tavo 才注入其完整归档（相关联的数据）。
    // 基线窗口与世界书归档共用 RECENT_MSG_ROWS 切分，两条通道不重叠、不遗漏。
    var ARCHIVE_NAME_PREFIX = '玉兆档案·';
    var ARCHIVE_ENTRY_CHARS = 6000;
    var ARCHIVE_FOOTER = '\n（只读归档：仅供回忆参考，不要把这些消息重新写入 <yz_jade> 数据块。）';

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
    function buildSnapshotEntries(state, options) {
      options = options || {};
      var entries = [];
      entries.failed = false;
      function shard(kind, serialized, rev, updatedAt) {
        if (!serialized) return;
        var total = Math.ceil(serialized.length / SNAP_SHARD_CHARS);
        if (total < 1) total = 1;
        if (total > MAX_SNAP_SHARDS) { dbg('snapshot exceeds shard cap: ' + serialized.length); entries.failed = true; return; }
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
       var hasData = CORE.stateHasPersistableData(state);
      if (hasData || options.force) {
        var roleJson;
        try { roleJson = JSON.stringify(state); } catch (error) { roleJson = null; }
        if (!roleJson) entries.failed = true;
        shard('role', roleJson, CORE.stateRevision(state), state.updatedAt);
      }
      return entries;
    }

    // 纯函数：由 state 构建世界书条目列表（封印交流讯息时不归档；封印舆图时地点名录不归档）。
    // 默认空间可被删除：缺失时用空白数据（条目自然为空）。
    function buildArchiveEntries(state) {
      var flags = getFlags();
      if (state && state.spaces) state = CORE.defaultSpaceState(state) || CORE.blankUserSpace(state.chatId, { isDefault: true });
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
    function syncArchive(chatId, options) {
      options = options || {};
      var task = saveQueue.then(function () { return writeArchive(chatId, options); }, function () { return writeArchive(chatId, options); });
      saveQueue = task.then(function () {}, function () {});
      return task;
    }

    async function writeArchive(chatId, options) {
      chatId = CORE.cleanText(chatId || activeChatId, 160);
      var lore = tavoApi.lorebook;
      if (!lore || typeof lore.find !== 'function' || typeof lore.update !== 'function' || typeof lore.create !== 'function') return { ok: false, reason: 'unavailable' };
      if (!chatId) return { ok: false, reason: 'missing-chat' };
      var state = options.stateSnapshot || chats[chatId];
      if (!state) return { ok: false, reason: 'missing' };
      var entries = buildArchiveEntries(state);
      var snapshots = buildSnapshotEntries(state, { force: options.forceSnapshot === true });
      if (snapshots.failed) return { ok: false, reason: 'snapshot-too-large' };
      snapshots.forEach(function (entry) { entries.push(entry); });
      // 无可写内容时不触碰已有书：空白/未加载状态不得用空 entries 覆盖权威快照。
      if (!entries.length) return { ok: true, entries: 0 };
      var name = ARCHIVE_NAME_PREFIX + chatId.slice(0, 40);
      var found;
      try { found = await Promise.resolve(lore.find(name, { match: 'exact' })); }
      catch (error) { dbg('lorebook find failed', error); return { ok: false, reason: 'find-failed' }; }
      var book = Array.isArray(found) ? found[0] : null;
      var bookId = book ? book.id : null;
      if (bookId == null) {
        try {
          var created = await Promise.resolve(lore.create({ name: name, entries: [] }));
          // create 的返回形状随宿主实现而异（可能直接返回 id，也可能返回整本世界书）。
          bookId = created && typeof created === 'object' && created.id != null ? created.id : created;
        } catch (error) { dbg('lorebook create failed', error); }
        if (bookId == null) return { ok: false, reason: 'create-failed' };
      }
      try {
        var updated = await Promise.resolve(lore.update({ id: bookId, name: name, entries: entries }));
        if (updated === false || updated == null) return { ok: false, reason: 'update-failed' };
      } catch (error) {
        dbg('lorebook update failed', error);
        return { ok: false, reason: 'update-failed' };
      }
      var chatApi = tavoApi.chat;
      if (entries.length && chatApi && typeof chatApi.current === 'function' && typeof chatApi.update === 'function') {
        try {
          var chat = await Promise.resolve(chatApi.current());
          // chat.update 只作用于当前聊天；目标不是当前聊天时数据已写入，跳过挂接。
          if (chat && String(chat.id) === String(chatId)) {
            var ids = [];
            safeArray(chat.lorebooks, 50).forEach(function (item) {
              var itemId = item && typeof item === 'object' && item.id != null ? item.id : item;
              if (itemId != null) ids.push(itemId);
            });
            var attached = ids.some(function (id) { return String(id) === String(bookId); });
            if (!attached) {
              ids.push(bookId);
              await Promise.resolve(chatApi.update({ lorebooks: ids }));
            }
          }
        } catch (error) {
          dbg('chat attach failed', error);
          return { ok: false, reason: 'attach-failed' };
        }
      }
      return { ok: true, entries: entries.length };
    }

    return {
      LOCAL_PREFIX: LOCAL_PREFIX,
      switchChat: switchChat,
      settle: settle,
      beginClear: beginClear,
      generationToken: generationToken,
      rebuildFromHistory: rebuildFromHistory,
      markHistoryCutoff: markHistoryCutoff,
      current: current,
      activeSpace: activeSpace,
      applyText: applyText,
      importState: importState,
      commitImport: commitImport,
      syncArchive: syncArchive,
      buildArchiveEntries: buildArchiveEntries,
      buildSnapshotEntries: buildSnapshotEntries,
      eventChatId: eventChatId,
      resolveCurrentChatId: resolveCurrentChatId,
      resolveOwnerName: resolveOwnerName,
      sendSpaceMessage: sendSpaceMessage,
      sendSpaceComment: sendSpaceComment,
      markSpaceThreadSeen: markSpaceThreadSeen,
      markSpacePostSeen: markSpacePostSeen,
      spaceSaveEntity: spaceSaveEntity,
      spaceDeleteEntity: spaceDeleteEntity,
      spaceRestoreEntity: spaceRestoreEntity,
      createSpace: createSpace,
      renameSpace: renameSpace,
      setSpaceFlag: setSpaceFlag,
      deleteSpace: deleteSpace,
      restoreSpace: restoreSpace,
      setActiveSpace: setActiveSpace,
      saveChat: function (chatId, options) { return save(chatId, current(), options); },
      dispose: function () {
        if (disposed) return;
        disposed = true;
        if (syncChannel) { try { syncChannel.close(); } catch (_) {} syncChannel = null; }
        if (runtimeWindow && typeof runtimeWindow.removeEventListener === 'function') runtimeWindow.removeEventListener('storage', onStorage);
      },
      cachedChatIds: function () { return lru.slice(); },
      get activeChatId() { return activeChatId; }
    };
  }

  var RUNTIME = {
    createRuntime: createRuntime
  };
