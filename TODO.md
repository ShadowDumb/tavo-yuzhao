# 玉兆 开发待办（TODO）

> 当前基线：v3.0.0（冒烟 900 项全绿，用户空间改版完成，见文末「v3.0.0 空间改版进度」）。
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

- 冒烟门禁：`node scripts/build.mjs --check && node --check entry.js && node tests/smoke.mjs`（当前 900 项全绿）
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
- [ ] **天下论坛（跨玩家互动社区）**：搭建一个面向全体玉兆玩家的公共论坛，
      让不同玩家之间能够互动。路线二选一：
      ① 自研专用于玉兆的完整论坛（发帖/回帖/玩家身份绑定/角色卡分享）；
      ② 使用现成论坛源码（如 Discourse / Flarum / NodeBB）搭建部署。
      待定项：部署目标与域名、玩家身份与插件账号的关联、内容审核与反滥用机制、
      与插件内单机论坛（玩家域）的关系定位。

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
      `node scripts/build.mjs --check && node --check entry.js && node tests/smoke.mjs` 900 项全绿
- [x] **文档**：CHANGELOG v3.0.0、DESIGN.md 第六节重写 + 持久化/重建段落更新、README 特性/协议/安装更新
- [x] **版本**：PLUGIN_VERSION/manifest = 3.0.0，releaseNotes.3_0_0 双语

### 待完成（发布前）

- [x] git commit `9f1d62c`（本地）；~~push origin main~~ 网络不可达，待恢复后 `git push origin main`
- [x] 打包 `../yu-zhao-v3.0.0.tpg`（manifest 3.0.0 / entry.js / locales×2 / ui/jade.html / cover.png）
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
- [x] 统一文档测试数量为实际 900 项，删除 README/TODO 中 814、815、841、842、872、880、890、891、892、895、898 等过时数字。

### v3.0.0 用户视角复审新增问题（2026-09-01）

> 本节来自多 subagent 的源码/UI/运行时交叉评审。已合并重复报告，仅记录当前源码可定位的问题；
> P0/P1 需在下一次发布前处理。900 项 smoke 主要覆盖纯函数、渲染字符串和运行时数据，不能证明真实 DOM、
> Tavo fragment 生命周期、浏览器触控或屏幕阅读器行为正常。

#### P0：启动阻断

- [ ] **R0-01 UI 启动调用未定义函数**：`src/ui/app/hooks.js:247-252` 的 `start()` 直接调用
      `setupSyncChannel()`，但该函数只存在于 `src/runtime.js:81-89` 的 `createRuntime` 私有作用域，
      未注入 UI 闭包。进入聊天后 `start()` 在加载数据和绑定入口前抛 `ReferenceError`，玉兆功能入口全部失效。
- [ ] **R0-02 构建脚本把 Runtime 工厂当实例传入**：`scripts/build.mjs:131` 将 `RUNTIME` 传给
      `APP.create()`，而 `src/ui/app/entry.js:59` 期待的是有 `current/switchChat/dispose` 等方法的实例；
      即使修复 R0-01，启动仍会因 `runtime` 方法不存在而失败。应传 `RUNTIME.createRuntime(...)` 的结果，
      或删除该覆盖参数让 App 自行创建实例。

#### P1：数据完整性与高风险操作

- [ ] **R1-01 清除数据后的生成结果仍可能复活**：`src/ui/app/data-actions.js:12-20,40-48` 使用内存中的
      `clearPending/preClearGenerationKeys/postClearGenerationKeys`；`src/ui/app/hooks.js:150-176` 在
      清除后新生成先成功时会清空旧请求保护，旧请求晚到即可再次应用协议。无 generation ID 或插件重载后，
      清除保护也无法可靠跨越异步窗口。应持久化按聊天/空间划分的清除 epoch，并按请求开始 epoch 丢弃旧结果。
- [ ] **R1-02 多个 `<yz_jade>` 信封只应用第一块**：`src/protocol.js:405-444,506-515` 的 `parse()`
      对整段文本成功后立即返回单个结果，`extractSnapshots()` 不会继续拆分后续信封；模型同轮输出多个空间时，
      后续空间更新会静默丢失。
- [ ] **R1-03 full 同步可能截掉受保护的用户联系人/群聊**：`src/core.js:1126-1164` 先合并用户行，
      再对结果执行 `contacts.slice(0, 10)` 和 `groups.slice(0, 6)`；容量达到上限时，用户 `c-` 联系人或
      用户消息所属群聊可能被截掉并持久化。保护行应优先保留，普通 AI 行应拒绝或让位。
- [ ] **R1-04 发送、评论、保存、新建缺少防重复提交**：`src/ui/app/messaging.js:1-40`、
      `src/ui/app/forms.js:44-85,160-175` 在 await 持久化期间没有 busy/idempotency 锁，也未立即禁用控件；
      快速双击或连续按 Enter 可生成重复消息、评论、实体或空间。
- [ ] **R1-05 持久化失败不回滚内存状态**：`src/runtime.js:560-582,649-755,759-820` 先修改实体/消息，
      再异步保存；失败时 `src/ui/app/messaging.js:14-18`、`forms.js:81-85,119-126` 只提示错误，
      内存仍保留失败修改，后续操作可能把它再次写入，重载前后用户看到的内容不一致。
- [ ] **R1-06 fragment 重挂载后旧实例监听器泄漏**：`src/ui/app/entry.js:70-76` 的 `dispose()` 只清理
      Runtime、待挂载 observer 和 pagehide；`hooks.js:270-309`、`entry.js:173-193`、`fab.js:70-99`
      注册的 document/window listener、MutationObserver、BroadcastChannel/storage 和 viewport 监听未完整移除。
      宿主重挂载后会出现旧实例幽灵事件、重复渲染和监听器累积。
- [ ] **R1-07 跨 tab CAS 冲突后可通过重试绕过**：`src/runtime.js:105-140` 在冲突比较前先递增内存
      `storageRevision`；第一次拒绝后不回滚 revision 或强制刷新，第二次保存可因本地 revision 与远端相等而覆盖
      另一 tab 的新数据。冲突后应回滚/重载并锁定重试。
- [ ] **R1-08 保存队列没有等待世界书归档完成**：`src/runtime.js:119-153,353-356,390-396` 的
      `saveQueue` 只等待本地镜像任务，`syncArchive()` 走另一条 `archiveQueue`；切聊、重建或刷新可能在世界书
      仍写入旧快照时读取/覆盖，导致最新用户输入消失。
- [ ] **R1-09 缺失 prepare 基线时 diff 默认放行全部数据**：`src/core.js:1366-1369` 和
      `src/ui/app/hooks.js:61-62,183-184` 在没有匹配 visibility 时使用全量可见语义；插件重载、宿主漏发
      `generation:prepare` 或 request ID 不匹配时，模型可修改采样窗口外的旧数据。实时路径应 fail-closed。
- [ ] **R1-10 满容量新建会提示成功但实体被截掉**：`src/runtime.js:677-750` 多个新建分支直接 concat 后依赖
      normalize 的容量截断，未像联系人一样先返回 `full`；达到文件夹、备忘、物品、钱财、订单或帖子上限时，
      表单保存可能显示成功但新实体不见。应在变更前返回容量错误并保留输入。
- [ ] **R1-11 打开失败可能永久保留 loading 遮罩**：`src/ui/app/navigation.js:89-107` await
      `resolveCurrentChatId/switchChat` 没有 `try/catch/finally`；异常时不会移除 `loading/aria-busy/inert`，
      用户无法操作底层 UI，也没有可见恢复提示。

#### P2：功能流程与明显可用性问题

- [ ] **R2-01 表单删除后落在“新建表单”**：`src/ui/app/navigation.js:29-36` 的
      `backNavSkippingDeleted()` 不识别 `form/contact-form`，而 `src/ui/app/forms.js:109-126` 从编辑表单删除后
      仍按当前路由渲染；实体消失后 `src/ui/views/forms.js:103-109` 将其当作新建表单，而不是回到列表。
- [ ] **R2-02 删除单条消息错误退出会话且线程摘要陈旧**：`src/ui/app/navigation.js:34-35` 将 message 删除
      当作详情回退；`src/runtime.js:772-779` 只过滤消息，不重算 `preview/time/anchorId/replyCount/seenReplies`。
      用户会被带回列表，列表还可能显示已删除消息和错误未读数。
- [ ] **R2-03 空间切换未等待持久化结果**：`src/ui/app/shell.js:227-238` 忽略 `runtime.setActiveSpace()` 返回的
      `saved` Promise；写入失败仍立即显示新空间，刷新后可能回到旧空间且没有失败反馈。
- [ ] **R2-04 单功能清空后主页仍显示旧同步信息**：`src/ui/app/data-actions.js:2-20` 只清空功能分区并设置
      `pendingFull`，未清理 `sync.summary/roleName/status/issues`；`src/ui/views/shared.js:129-135` 会继续显示
      旧角色名、摘要或绿色“已同步”状态，直到下一轮生成。
- [ ] **R2-05 空间删除的二次确认会被重渲染抹掉**：`src/ui/views/manage.js:13,27-30` 计算了 `armed` 但未用于
      删除按钮的 class/文案；`src/ui/app/forms.js:209-223` 首击局部设置确认态后立即 `render()`，用户看不到确认状态，
      第二次普通删除点击即可执行危险操作。
- [ ] **R2-06 联系人、消息、地图删除确认不可见且文案会溢出**：`src/ui/views/messages.js:14,48`、
      `src/ui/views/map.js:21,26` 的固定尺寸按钮没有统一 `.armed` 样式；`src/ui/app/forms.js:146-153` 将长确认文案
      写入 `.yz-row-action/.yz-bubble-del` 等紧凑按钮，可能遮挡内容，用户也无法知道第一次点击发生了什么。
- [ ] **R2-07 表单关闭/返回静默丢弃未保存输入**：`src/ui/app/overlay.js:73-74`、
      `src/ui/app/navigation.js:131-153` 关闭/返回不检查 dirty 状态；编辑备忘、订单、帖子或导入文本后点击关闭、遮罩、
      Esc 或顶栏操作会直接丢失草稿。
- [ ] **R2-08 未读状态保存失败无反馈**：`src/ui/app/navigation.js:60-72`、`src/ui/app/state.js:15-21` 调用
      `markSpaceThreadSeen/markSpacePostSeen/saveChat` 后不等待或检查保存结果；存储失败时本次看似已读，重载后角标复现。
- [ ] **R2-09 空间管理开关复用危险确认样式**：`src/ui/views/manage.js:22-23` 给开启的 `sendToAI/allowAIWrite`
      按钮使用 `armed`，而模板 CSS 的 `.yz-clear-btn.armed` 是红色危险态；默认空间的 AI 可写还不可关闭，却表现为可操作按钮，
      点击只得到错误 Toast。
- [ ] **R2-10 物品、钱财、订单编辑行缺少统一卡片布局**：`src/ui/views/market.js:1-9`、`space.js:13-19,25-34`
      直接输出 `.yz-manage-main`，没有 `.yz-row` 的背景、边框、内边距和明确编辑入口；与其他列表视觉不一致，用户难以发现整行可点。
- [ ] **R2-11 列表存在嵌套卡片**：`src/ui/views/messages.js:14-16`、`notes.js:39-40`、`forum.js:56-59` 将已有行容器
      与内部导航按钮再次套用 `.yz-row/yz-note-row`，造成双层边框、重复背景和窄屏内容空间浪费。
- [ ] **R2-12 地图搜索不筛选当前所在地**：`src/ui/views/map.js:12-16,35-41` 对 tracks/places 应用关键词，却无条件渲染
      current 卡片；搜索其他地点时当前所在地仍显示，用户无法判断它是否属于结果。
- [ ] **R2-13 空玉册文件夹仍显示全局搜索框**：`src/ui/views/notes.js:32-44` 列表按当前 folder 过滤，但
      `searchBoxIf()` 使用全部 notes 数量；当前文件夹为空而其他文件夹有内容时会出现无意义搜索框。
- [ ] **R2-14 联系人没有可见编辑入口**：`src/ui/views/messages.js:9-16` 仅输出联系人/群聊删除按钮，运行时和表单虽支持
      contact 编辑，用户却只能删除后重新创建，无法修改名称或关系。
- [ ] **R2-15 重新渲染会丢失普通表单焦点和草稿保护**：`src/ui/app/shell.js:294-328` 用 `innerHTML` 整体替换页面，
      只恢复搜索框和消息/评论输入框；生成结果、跨 tab 更新或状态变化期间编辑表单/导入文本可能被旧落盘状态覆盖，焦点也会跳失。
- [ ] **R2-16 Overlay 焦点陷阱只收集 button**：`src/ui/app/overlay.js:94-119` 不包含 input/select/textarea/summary 等可聚焦元素，
      表单和搜索页用 Tab 时会跳过控件或逃出 overlay。
- [ ] **R2-17 确认框 ARIA 属性挂错元素**：`src/ui/app/shell.js:116-143` 将 `aria-labelledby/aria-describedby` 设置到内部 box，
      但 `role=alertdialog` 在外层 host；屏幕阅读器可能读不到确认标题、后果和按钮关联。
- [ ] **R2-18 页面整体重绘不恢复焦点/不宣布页面变化**：`src/ui/app/shell.js:294-328` 销毁当前控件，
      `src/ui/views/page.js:23-26` 使用非标题元素作为页面标题；辅助技术用户无法稳定定位新页面，也没有统一 live announcement。
- [ ] **R2-19 移动端低视口高度与键盘存在遮挡风险**：`src/ui/app/overlay.js:121-146` 强制 `Math.max(320, room)`，
      但窄屏键盘打开时可用高度可能小于 320，外层又限制 overflow；composer/确认按钮可能落在键盘后方。
- [ ] **R2-20 多个触屏入口小于推荐尺寸**：模板中的主页同步入口和 Toast/FAB 使用小文本或固定 bottom 值，缺少统一 44px 触摸区及
      safe-area 适配；手机上同步入口难点按，Toast/FAB 可能被底部安全区遮挡。

#### P3：文案、入口完整性与细节

- [ ] **R3-01 论坛详情没有评论搜索入口**：`src/ui/views/forum.js:12-17,31-45` 有按 `search` 过滤评论的代码，
      但详情页未渲染 `searchBox()`，用户无法设置关键词，属于不可达功能路径。
- [ ] **R3-02 英文界面新建帖子仍保存中文 section**：`src/ui/views/forms.js:81-95` 的 option value 硬编码中文，
      `locales/en.json:125-130` 只翻译显示 label；英文用户发帖后列表/详情可能出现中文版块名。
- [ ] **R3-03 订单列表可能直接显示内部状态值**：`src/ui/views/market.js:46-55` 直接输出 `order.status`，导入或 AI 数据为
      `pending/open/completed` 时普通用户会看到技术值；列表应与表单共用本地化状态映射。
- [ ] **R3-04 高风险确认文案与实际撤销/级联行为不一致**：`locales/*:137-142` 的“不可撤销”与删除后 6 秒 Undo 冲突，
      文件夹删除还会级联删除备忘但未说明；应展示对象、影响范围以及可撤销窗口。
- [ ] **R3-05 删除按钮和编辑按钮缺少对象上下文**：`src/ui/views/messages.js:14,48` 只输出 `×`，通用编辑/清空按钮也缺少
      对象名称；屏幕阅读器和多条列表用户无法判断操作目标。
- [ ] **R3-06 错误 Toast 容易被截断且缺少下一步**：模板 `src/ui/jade.template.html:210-215` 默认单行省略，
      `src/ui/app/shell.js:174-193` 普通错误约 2.4 秒消失；存储/解析错误的原因和处理动作可能不可读。
- [ ] **R3-07 长文本输入没有可见长度反馈**：`src/ui/views/messages.js:63-64`、`forum.js:27-28` 和表单设置 maxlength，
      但用户接近上限或粘贴超长内容时没有计数器/截断提示。
- [ ] **R3-08 管理说明仍含技术术语且首屏过长**：`manifest.json:34`、`locales/*:7,265` 直接展示“提示词、世界书、协议写入”等词汇，
      手机上会把真正操作控件推到下方；建议首屏给结论，技术解释放入帮助区。

### 复审后需人工验证的宿主/浏览器风险

- [ ] 验证真实 Tavo 中 `htmlFragments` 脚本执行顺序、顶层 document/iframe 选择、fragment 重挂载与卸载，特别是 R0-01/R0-02 修复后
      的 Hook、侧边栏动作和 FAB 是否真正可用。
- [ ] 模拟 localStorage 不可用、配额超限、世界书 find/create/update 失败、跨 tab 冲突、清除时生成在飞、插件重载后旧 generation 到达，
      观察数据是否复活、回退、覆盖或出现假成功。
- [ ] 在 320/360/375px、iOS 安全区与键盘、Android WebView、触屏双击/长按、系统返回键下验证布局、composer、Toast、FAB 和确认流程。
- [ ] 使用键盘、VoiceOver/TalkBack 检查 focus trap、页面标题、Tab、确认框和删除/编辑按钮的实际朗读。
- [ ] 逐项执行入口清单：侧边栏打开/恢复/清除、FAB、主页八卦与同步、空间切换/新建/改名/删除/撤销、玉牌、讯息、玉册、论坛、坊市、
      芥子空间、舆图、管理、导入导出、发送/评论/搜索/表单 CRUD；当前测试未模拟真实 DOM 点击链。
