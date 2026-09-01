# 玉兆 开发待办（TODO）

> 当前基线：v3.0.0（冒烟 892 项全绿，用户空间改版完成，见文末「v3.0.0 空间改版进度」）。
> 本文件只记录未完成工作。已完成的工作与全部变更记录见 CHANGELOG.md。

---

## 已否决 / 搁置

- 外观主题（纯装饰，无玩法增益）
- TTS 传音（无音频权限，宿主能力未验证，技术可行性存疑）
- 浏览器 history.pushState 集成（宿主 overlay 限制，无法拦截硬件返回键）

## 开发约束（每个候选必过）

所有新增数据形态必须逐项过「数据形态扩展审计」：
buildCurrent 窗口化、条目级注入采样（sampleEntries 强制集/活跃度加权/冷门保底/隐藏不提示，
多发送空间时按空间数均摊）、MAX_BASELINE_CHARS 预算、diff 合并、达标评估（仅默认空间）、
内容指纹去重（按空间隔离）、版本迁移、世界书快照（单链承载全部空间）、世界书归档关键词——
任何一项遗漏都会破坏现有测试基线语义。
空间内用户直写另需过：CRUD 校验与删除级联、真实发言门禁（c-/pm/pmg/pmc/owner=player 不可被
模型改写）、未读 seen 游标（recomputeThreadUnread）、空间路由（turn 行第 6 字段，
unknown/denied/full 三类拒写记 issue）、非默认空间 diff-only。

- 冒烟门禁：`node --check entry.js && node tests/smoke.mjs`（当前 892 项全绿）
- 发布门禁：MCP `tavo_plugin_validate` → `tavo_plugin_audit` → `tavo_plugin_package`，
  产物随版本号更新出包

---

## 评审待办（v2.2.1 多视角评审历史，2026-08-30）

> 本节为已完成的旧版历史记录，不作为 v3.0.0 修复依据。

### 必须修（严重）

- [x] **S1 发送按钮无防抖**：`sendPlayerMessage()` 同步执行 + `syncPlayerChannel()` 无并发锁，
      快速双击导致两次同步并发，角色回复可能被镜像两次。修法：加 `sending` 锁，
      发送中禁用按钮 + loading 态，微任务完成后恢复。
- [x] **S2 封印时发送按钮无视觉禁用**：封印状态下按钮仍可点击，用户连点 2-3 次才看到 toast。
      修法：封印时禁用输入框 + 发送按钮，显示"传讯已封印"横幅替代输入区域。
- [x] **S3 双标签页数据竞争**：两 tab 共享 localStorage + 世界书，`save()` / `syncArchive()`
      无跨 tab 乐观锁，最后写入者覆盖前者导致数据丢失。修法：用 `BroadcastChannel`
      同步 tab 间状态，或在世界书写入前校验 revision 未变。
- [x] **S4 生成中点清除数据复活**：`clearAllData` 清零 state，但进行中的 `generation:success`
      将旧 protocol block 写回空白 state→数据复活。修法：加 `clearPending` 标记，
      `generation:success` 时若标记存在则丢弃 protocol block。
- [x] **S5 open()/close() 异步竞态**：`open()` 异步 await `resolveCurrentChatId`，
      用户快速关闭后异步完成重新 `classList.add('open')`→overlay 意外重开。
      修法：加 epoch 计数器，close 时递增，async 完成后校验 epoch 未变。
- [x] **S6 localStorage 损坏静默丢数据**：`parseStored` 返回 null → `blankState` 替换，
      用户无感知地丢失所有数据。修法：`load()` 返回 blank 时若 `revision > 0`
      弹警告 toast 并尝试从世界书快照恢复。

### 建议尽快修（中等）

#### 聊天消息

- [x] **M1 状态标签太小且技术化**：已送达/已读/已回 为 9px 文字，三态语义用户难理解。
      修法：改用图标 ✓ / ✓✓ / ↩ 匹配 IM 惯例（绿/灰配色）。
- [x] **M2 "已送达"语义误导**：消息写入角色域数据但 AI 未实际读取，用户以为角色已收到。
      修法：改名为"已发出"或仅用单 ✓，去掉中间态。
- [x] **M3 归档 = 删除，措辞误导**：超过 20 条消息静默截断，"已归档"暗示可查看。
      修法：改为"已清理"或加"查看更早消息"展开功能。
- [x] **M4 "全部已读"按钮仅在列表页**：聊天详情内无标记已读入口，用户需返回列表再操作。
      修法：进入详情页自动 markPlayerRead（已有）或加详情页内"标记已读"按钮。
- [x] **M5 群聊气泡归属不明**：角色的群消息和玩家的群消息在同一气泡流中，
      用户难区分谁说了什么。修法：加小标签或不同头像颜色区分。
- [x] **M6 "公开"标签对用户无意义**：群聊头部"公开"是实现细节（双域共享数据），
      用户不理解含义。修法：改为"与角色共享"或删除。
- [x] **M7 输入框占位符"传讯"对新手不直观**：首次用户可能不认识"传讯"一词。
      修法：改为"输入消息…"或"说点什么…"，"传讯"仅用于正式标签。
- [x] **M8 消息 3000 字符上限无 UI 提示**：用户输入超长消息被静默截断。
      修法：输入框附近加字数计数器（如 1234/3000）。
- [x] **M9 线程名回退"角色"过于笼统**：多角色场景下用户看到"角色"无法区分。
      修法：回退为"与{cardName}传讯"。

#### 角色域 UI

- [x] **M10 msg-detail 检索框在"找不到"页面仍显示**：联系人不存在时搜索框无意义。
      修法：条件渲染，仅在 `rowItem` 存在时显示 `searchBox`。
- [x] **M11 两个空态提示堆叠**："找不到该联系人" + "已归档"两个连续空块像渲染错误。
      修法：合并为单个复合空态（主提示 + 副说明）。
- [x] **M12 群聊无管理 UI**：用户无法创建/退出群聊，无任何说明。
      修法：空态加"群聊由剧情生成"提示。

#### 玩家域 UI

- [x] **M13 玉册详情页删除无二次确认**：详情页 `data-action="player-delete"` 直接触发删除，
      表单页才有两击保护。修法：统一为两击保护。
- [x] **M14 订单状态是自由文本**：`input[type=text]` 用户可输入任意内容导致数据碎片化。
      修法：改为 select 下拉（open/completed/cancelled 对应中文标签）。
- [x] **M15 论坛帖子无删除功能**：玩家只能编辑自己的帖子，无法删除。
      修法：详情页补删除按钮（两击确认）。
- [x] **M16 备忘空态"找不到该备忘"措辞不当**：用户没创建过备忘时显示"找不到"像报错。
      修法：区分"暂无备忘"和"找不到该备忘"两种空态。

#### 设置/配置

- [x] **M17 settings.info 功能发现性差**：导出/导入/封印/清除等功能在管理页，
      设置页无入口引导。修法：设置页加"打开玉兆管理"按钮。
- [x] **M18 清除确认 3s 超时偏短**：用户读完警告再确认可能来不及。
      修法：延长至 5s 或改为执行后 6s 撤销 toast。
- [x] **M19 `autoStrip` "玉兆数据块"术语**：用户不理解"数据块"含义。
      修法：改为"自动隐藏正文中的法器同步数据（不影响剧情内容）"。
- [x] **M20 管理页"注入提示词"术语**：zh-CN manage.info 中"注入提示词"是技术词。
      修法：改为"被封印的功能不再参与剧情同步，以节省用量"。

#### UI 组件

- [x] **M21 toast 与确认框可能重叠**：confirm z-index 更高会遮住残留 toast。
      修法：`showConfirm` 时先 `clearToast()`。
- [x] **M22 FAB 长按复位无视觉提示**：用户不知道可以长按复位位置。
      修法：首次使用显示"长按复位位置"一次性提示。
- [x] **M23 顶栏返回按钮在首页仍显示**：首页无上级，返回 = 空操作。
      修法：首页隐藏返回按钮（`nav.stack.length === 0` 时不渲染）。
- [x] **M24 域切换按钮显示目标而非当前**："→ 角色域"可能被误解为"当前是角色域"。
      修法：显示当前域名 + 切换方向，或加活跃态圆点指示器。
- [x] **M25 toast.parseError 无操作引导**：只说"解析失败"，没告诉用户怎么办。
      修法：toast 加"打开同步诊断查看"操作按钮。
- [x] **M26 overlay / confirm 无过渡动画**：打开/关闭瞬间切换，感觉生硬。
      修法：加 `transition: opacity .2s` 平滑过渡。

#### 边界/错误处理

- [x] **M27 syncPlayerChannel 无并发锁**：快速发送两次导致两次同步并发。
      修法：加 per-chat `syncBusy` 锁（类似 `archiveBusy` 模式）。
- [x] **M28 localStorage 配额超限静默失败**：`localSet` catch 后仅 `dbg()`，
      内存状态已更新但持久化失败，数据不一致。修法：弹 toast "本地存储空间不足，部分数据仅保存在世界书"。
- [x] **M29 generation:success catch 后游标处理**：`applyText` 抛异常时 `cursorBeforePrepare`
      被清空但数据未应用，玩家消息被标已读却无回复。修法：catch 中恢复游标（同 error 路径）。
- [x] **M30 import 截断后语义不完整**：语法合法但缺关键字段的 JSON 被静默导入，
      normalizeState 填空值。修法：校验关键字段（chats/tablet）数量，偏差过大时警告。

### 可延后（轻微）

- [x] L1 1:1 聊天搜索框冗余（仅群聊或 >20 条时有意义）
- [x] L2 en.json "window" → "only the latest {n} are shown"（用户不懂 window）
- [x] L3 角色域首页节点小字 `clamp(9px, 2.6vw, 11px)` 过小，至少 10px
- [x] L4 `yz-readonly-hint` 类名语义混用（pending sync 不是 readonly）
- [x] L5 `yz-archived-hint` vs `yz-archived-note` 类名混淆（不同用途同名近似）
- [x] L6 论坛评论 20 条上限无 UI 计数器
- [x] L7 订单/备忘 textarea `rows="4"` 对 3000 字上限偏小
- [x] L8 玩家域节点图标（☰☱☲☳☴☵☷☶）非中文用户不直观，加 title 属性
- [x] L9 群聊头 `<small>(3人)</small>` 被 yzHeader 转义为字面 `&lt;small&gt;`
- [x] L10 备忘表单"禁制（锁定）"标签与 checkbox 文字重复
- [x] L11 物品数量 − 按钮在 0 时无视觉禁用态
- [x] L12 en 窄屏市场 4-tab 标签可能溢出（Goods/Wanted/Auction/Orders）
- [x] L13 `aria-live="polite"` 缺失于 toast 容器（屏幕阅读器不播报）
- [x] L14 长时间使用 `chats`/`playerChats` 内存缓存无 LRU 驱逐
- [x] L15 确认框 focus trap 未完全拦截（tab 可逃逸到浏览器）

### 未来功能（不在当前版本）

- [ ] 聊天详情"查看更早消息"展开功能（当前静默截断 20 条）
- [ ] FAB 首次使用提示 / 拖拽中复位图标
- [ ] 内容联想（长按输入框弹出上下文建议）
- [ ] 语音输入（ASR 集成）
- [ ] 自定义主题/背景（纯装饰）

---

## v3.0.0 空间改版进度（2026-08-31）

双域（角色域/玩家域）→ 用户空间重构。设计决策：所有空间同构全套 schema；
旧玩家域数据迁移为「我」空间；默认空间（{{char}}）可删除、数据到达时自动重建；
协议带空间参数（turn 行第 6 字段）。

### 已完成

- [x] **Core 数据层**：`blankUserSpace/normalizeUserSpace/normalizeState(v2)`、
      `findSpaceState`（id→名称→缺省默认）、`ensureDefaultSpace`、`stateRevision/stateDataUpdatedAt`、
      用户线程未读 `recomputeThreadUnread`（pm 尾随回复 − seen；用户帖非玩家评论 − seen）
- [x] **迁移**：v1 顶层分区读入即整体迁入默认空间（schemaVersion 2）；旧玩家域镜像/
      yz-psnap 世界书分片 → 「我」空间 + `migratedPlayer` 幂等标记 + 旧键删除；
      yz-player/yz-character 固定通道联系人归一为 c- 前缀（进门禁保护）
- [x] **AI 协议**：parseMeta 第 6 字段；applySnapshot 空间路由 + 三类拒写
      （space.unknown/space.denied/space.full）+ 非默认空间 diff-only + 用户空间豁免达标底线
- [x] **注入**：buildCurrent 按 sendToAI 空间分组（`<yzc_* space="名">`，默认无属性）、
      采样上限均摊、预算共池五级淘汰、用户真实行 last 保护；buildPrompt 空间协议 zh/en、
      turn 模板、基线分组说明、forceFull 限定默认空间
- [x] **门禁**：c- 联系人不可增删改；线程内消息不可覆盖/删除（可追加 self/other 新行）；
      pm-N/pmg-N/pmc-N 全局拒伪造；owner=player 帖不可触碰（原有语义保留至所有空间）
- [x] **Runtime**：空间 CRUD（create/rename/setSpaceFlag/delete/restore/setActiveSpace，
      上限 6、名称唯一、默认强制 AI 可写且不可改名）；实体 CRUD 统一
      （spaceSaveEntity/spaceDeleteEntity/spaceRestoreEntity + contact 种类 c- 前缀）；
      sendSpaceMessage/sendSpaceComment/markSpaceThreadSeen/markSpacePostSeen；
      跨域镜像通道（syncPlayerChannel/Groups/Posts、已读游标、投递重试、{{user}} 镜像）整体移除
- [x] **持久化**：单存储键/单快照链承载全部空间；syncArchive 整本替换自然退役 yz-psnap；
      importState 仅接受当前 v3 空间结构并在确认后提交；BroadcastChannel 单键归一
- [x] **UI 一套化**：删除玩家域渲染栈与域切换；讯息列表「新增联系人」CTA + 行内删除、
      会话/群聊/论坛评论输入框全空间可用、气泡右=pm*/pmg*（默认模型线程维持 self 在右）、
      玉册/论坛/坊市订单/储物全空间可编辑、舆图行删除；顶栏空间按钮 + 管理页 spaces 视图
      （进入/改名/两开关/两击删除+撤销/新建输入）；删除统一 deleteSpaceItem + 6s 撤销
- [x] **文案与视觉**：locale 新增 runtime.space.*（zh/en 双语齐全），清理 38+3 个死键，
      补 lockedHint；空间管理页 CSS；死 CSS（retry/status/start-thread/mark-all/locked 徽标）移除
- [x] **测试**：双域契约整体替换为用户空间契约（生命周期/路由/门禁/拒写 issue/迁移/
      未读生命周期/注入分组/提示词规则/当前 v3 导入/空间管理视图渲染）；微任务排干修复；
      `node --check entry.js && node tests/smoke.mjs` 892 项全绿
- [x] **文档**：CHANGELOG v3.0.0、DESIGN.md 第六节重写 + 持久化/重建段落更新、README 特性/协议/安装更新
- [x] **版本**：PLUGIN_VERSION/manifest = 3.0.0，releaseNotes.3_0_0 双语

### 待完成（发布前）

- [x] git commit `9f1d62c`（本地）；~~push origin main~~ 网络不可达，待恢复后 `git push origin main`
- [x] 打包 `../yu-zhao-v3.0.0.tpg`（manifest 3.0.0 / entry.js / locales×2 / cover.png）
- [ ] MCP 发布门禁：`tavo_plugin_validate_manifest` → `tavo_plugin_audit` → `tavo_plugin_package`
- [ ] 真机回归：空间切换/新建/删除+撤销、
      跨空间收发与 AI 回帖未读、只读/关发送开关生效、世界书快照恢复、触屏两击确认

---

## v3.0.0 用户视角评审待修（2026-09-01）

> 本节仅针对当前 v3.0.0 用户空间架构。修复时无需保留旧版兼容路径、回退逻辑或额外迁移层；
> 允许直接删除失效分支、调整当前 schema 和协议。问题来源为多 subagent 代码/UI/运行时评审，
> 文件行号以当前 `entry.js` 为准。

### P1：发布前必须修

- [x] **P1-01 默认空间 full 覆盖用户数据**：`entry.js` full 应用改为保留 `c-` 联系人、`pm-*`/`pmg-*` 消息、`pmc-*` 评论和 `owner=player` 帖子。
- [x] **P1-02 AI 可伪造用户帖子**：diff/full 均拒绝新增或改写为 `owner=player` 的帖子。
- [x] **P1-03 清除全部数据后旧快照复活**：清除强制写入 v3 空快照墓碑并覆盖历史水化截断点。
- [x] **P1-04 清除期间的生成结果仍可通过后续 Hook 复活**：清除期间剥离并记录协议，后续消息 Hook 丢弃旧生成结果。
- [x] **P1-05 单功能清空污染全部空间**：每个空间获得独立的空分区对象，避免共享引用。
- [x] **P1-06 玩家空间迁移丢失部分分区**：迁移覆盖 tablet/群聊/文件夹/坊市/储物/舆图等完整分区，并在成功后再删源。
- [x] **P1-07 删除默认空间后管理页崩溃**：管理诊断对缺失默认空间使用安全空状态。
- [x] **P1-08 空间删除二次确认不可见**：空间管理视图消费 `ui.armed` 并在重渲染后保持确认态。
- [x] **P1-09 联系人/群聊删除入口失效**：删除 inline `stopPropagation()`，统一交由事件委托处理。
- [x] **P1-10 列表搜索输入失焦**：DOM 替换前保存焦点类型，替换后恢复搜索/发言输入焦点。
- [x] **P1-11 持久化失败仍提示成功**：本地/世界书写入返回明确结果，用户操作等待持久化后再显示成功。
- [x] **P1-12 导入可误覆盖完整状态**：仅接受当前 v3 状态，解析为候选并经确认后提交。
- [x] **P1-13 损坏快照可能静默变成空数据**：严格校验 v3 分片和 schema，损坏时提示并保留可用来源。
- [x] **P1-14 快照超过分片上限会丢失最后恢复点**：分片生成失败时拒绝整本替换，保留旧快照。
- [x] **P1-15 跨 tab 并发写入丢数据**：增加 `storageRevision/storageWriter` 冲突拒写、storage 事件回退和 Runtime dispose。
- [x] **P1-16 generation prepare 存在跨聊天串线**：settle 后重新校验 event、宿主和 Runtime 的聊天身份。
- [x] **P1-17 编辑已有订单会静默改变状态**：订单表单将中英文显示值映射到 canonical 状态并保留未知值。
- [x] **P1-18 导出隐私说明与实际范围相反**：文案明确导出当前聊天全部用户空间及私密数据。
- [x] **P1-19 “仅存本机”隐私说明错误**：文案改为说明聊天快照和世界书跨设备恢复语义。
- [x] **P1-20 关闭加载中的玉兆后遮罩可能永久残留**：关闭时同时移除 `open` 与 `loading` 状态。

### P2：功能与体验修复

- [x] **P2-01 `sendToAI` 与 `allowAIWrite` 语义不一致**：提示词和运行时分别表达基线发送与 AI 写入权限，关闭发送但保留可写时仍按可写处理。
- [x] **P2-02 空间名与空间 ID 可冲突**：归一化、创建和重命名共同禁止名称占用任一空间 ID。
- [x] **P2-03 空间名清洗导致路由不稳定**：空间路由使用可逆 URI token，空格、竖线和引号不再破坏协议。
- [x] **P2-04 默认空间重建可突破 6 个空间上限**：容量不足时拒绝重建并保留全部自定义空间，归一化优先保留默认空间。
- [x] **P2-05 空白聊天的空间元数据不进权威存储**：元数据变更通过快照落入世界书，重载可恢复。
- [x] **P2-06 未知 diff ID 被静默当作成功**：未知实体和父实体行拒写并记录 `diff.unknown` issue。
- [x] **P2-07 隐藏在采样窗口外的条目仍可被 diff 修改**：prepare 保存本轮可见实体集，窗口外目标 fail-closed 并记录 issue。
- [x] **P2-08 消息/评论超出保留窗口后未读失真**：以持久累计回复数和已见游标计算窗口外未读。
- [x] **P2-09 论坛满 20 条评论仍可发送并丢弃旧评论**：评论满额拒写，不再保尾丢弃旧评论。
- [x] **P2-10 撤销删除未绑定聊天**：撤销快照绑定原聊天，切聊后拒绝恢复。
- [x] **P2-11 空间撤销遇到 ID 重用时假成功**：重用 ID 时撤销返回失败，不报告假成功。
- [x] **P2-12 实体撤销不检查容量或父实体**：恢复前预检父实体、重复 ID 和各列表容量。
- [x] **P2-13 基线预算不是最终硬上限**：最终序列化结果再次逐行收缩，严格封顶 `MAX_BASELINE_CHARS`。
- [x] **P2-14 meta-only/拒写状态不稳定落盘**：摘要、拒写和无实际数据轮次均标记持久化并写入权威快照。
- [x] **P2-15 同时存在 `text/content` 时协议可能残留正文**：两个事件字段统一剥离协议块。
- [x] **P2-16 确认框键盘焦点和 Esc 行为错误**：确认框独立处理 Tab 循环，Esc 优先取消确认，不再关闭底层玉兆。
- [x] **P2-17 地图删除按钮在触屏上不可发现**：删除按钮始终可见，具备明确的双语 `aria-label` 与触摸尺寸。
- [x] **P2-18 窄屏/键盘可能遮挡 composer**：使用 `dvh`/安全区、visualViewport 与 innerHeight fallback，并在聚焦时滚入视口。
- [x] **P2-19 页面滚动位置恢复错误**：重渲染前后保存和恢复实际 `.yz-page-inner` 滚动容器。
- [x] **P2-20 列表删除会错误退回首页**：只有删除详情实体时回退，列表删除保持当前列表。
- [x] **P2-21 stale 详情页没有返回入口**：消息、玉册和论坛 stale 页面统一保留返回头部。
- [x] **P2-22 错误诊断缺少用户可读文案**：补齐空间拒写、缓存损坏、stale、管理入口和删除确认双语文案。
- [x] **P2-23 清空功能的实际范围不明确**：按钮和确认文案明确说明会清空所有空间中的该功能数据。
- [x] **P2-24 loading 状态仍允许底层控件交互**：loading 时隐藏并 inert 底层控件，事件委托统一拦截。
- [x] **P2-25 功能开关跨 tab 不同步且写入可能乱序**：增加带 revision/writer 的串行写入与 BroadcastChannel/storage 同步。
- [x] **P2-26 自定义空间首页仍显示同步诊断入口**：自定义空间改为不可点击的同步状态展示。
- [x] **P2-27 管理行窄屏布局需要重排**：空间名称、操作组和改名组在窄屏纵向分行并允许换行。
- [x] **P2-28 高风险控件触摸尺寸偏小**：返回、删除、编辑、搜索清除、步进、发送和确认控件统一至少 44px。

### P3：细节与视觉优化

- [x] **P3-01 状态控件缺少无障碍语义**：管理开关使用 `aria-pressed`，页签使用 `role=tab`/`aria-selected`，封印卦位使用 `aria-disabled` 并在名称中说明状态。
- [x] **P3-02 新同步仅靠颜色和动画表达**：新同步增加可见文字徽标，保留屏幕阅读器状态名称。
- [x] **P3-03 缺少减少动态效果支持**：增加 `prefers-reduced-motion: reduce`，关闭动画、过渡和滚动动画。
- [x] **P3-04 管理页存在无效重复按钮**：移除管理页内无效的「打开玉兆管理」入口及对应死文案/动作。
- [x] **P3-05 首页空态文案重复**：空态将行动指引与同步等待合并为单条主页摘要。
- [x] **P3-06 玉牌折叠状态不保留**：重渲染前读取各组 `<details>` 状态并在 UI 层恢复，不写入业务数据。
- [x] **P3-07 论坛搜索后的评论总数显示错误**：标题使用帖子实际评论总数，搜索仅过滤展示内容。
- [x] **P3-08 长标题可能撑破窄屏布局**：帖子、玉册和列表标题增加 `overflow-wrap:anywhere` 断词规则。

### 验证与测试待办

- [ ] 增加真实 DOM 事件测试：联系人/群聊删除、搜索连续输入、二次确认、撤销、Esc、返回、表单提交/取消、焦点恢复（需真实浏览器 DOM 环境，保留）。
- [x] 增加数据安全测试：默认 full 保护用户行、清除后重载、清除期间生成、迁移缺分区、快照损坏/超分片、存储 API reject（现有回归覆盖）。
- [x] 增加空间边界测试：空间名与 ID 冲突、特殊字符名称、默认空间重建上限、开关组合、空聊天元数据持久化（现有回归覆盖）。
- [x] 增加并发测试：双 tab 同时写入、跨 tab 开关、跨聊天 generation prepare、归档 busy/pending（现有回归覆盖）。
- [x] 增加容量和撤销测试：消息/评论窗口、实体满额、父实体消失、空间 ID 重用、基线最终字符数（现有回归覆盖）。
- [ ] 增加浏览器回归：320/360/375px、iOS 安全区与键盘、Android WebView、触屏 hover、键盘 Tab/Esc、VoiceOver/TalkBack、减少动态效果。
- [x] 修正测试进程退出问题：`runtime.dispose()` 幂等关闭 runtime 创建的 `BroadcastChannel` 并移除 `storage` 监听。
- [x] 统一文档测试数量为实际 892 项，删除 README/TODO 中 814、815、841、842、872、880、890、891 等过时数字。
