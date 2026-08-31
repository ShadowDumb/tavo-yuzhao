# 玉兆 开发待办（TODO）

> 当前基线：v3.0.0（冒烟 815 项全绿，用户空间改版完成，见文末「v3.0.0 空间改版进度」）。
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

- 冒烟门禁：`node --check entry.js && node tests/smoke.mjs`（基线 890 项全绿）
- 发布门禁：MCP `tavo_plugin_validate` → `tavo_plugin_audit` → `tavo_plugin_package`，
  产物随版本号更新出包

---

## 评审待办（v2.2.1 多视角评审，2026-08-30）

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
      importState v1/v2 双签名；BroadcastChannel 单键归一
- [x] **UI 一套化**：删除玩家域渲染栈与域切换；讯息列表「新增联系人」CTA + 行内删除、
      会话/群聊/论坛评论输入框全空间可用、气泡右=pm*/pmg*（默认模型线程维持 self 在右）、
      玉册/论坛/坊市订单/储物全空间可编辑、舆图行删除；顶栏空间按钮 + 管理页 spaces 视图
      （进入/改名/两开关/两击删除+撤销/新建输入）；删除统一 deleteSpaceItem + 6s 撤销
- [x] **文案与视觉**：locale 新增 runtime.space.*（zh/en 双语齐全），清理 38+3 个死键，
      补 lockedHint；空间管理页 CSS；死 CSS（retry/status/start-thread/mark-all/locked 徽标）移除
- [x] **测试**：双域契约整体替换为用户空间契约（生命周期/路由/门禁/拒写 issue/迁移/
      未读生命周期/注入分组/提示词规则/导入 v2/空间管理视图渲染）；微任务排干修复；
      `node --check entry.js && node tests/smoke.mjs` 815 项全绿
- [x] **文档**：CHANGELOG v3.0.0、DESIGN.md 第六节重写 + 持久化/重建段落更新、README 特性/协议/安装更新
- [x] **版本**：PLUGIN_VERSION/manifest = 3.0.0，releaseNotes.3_0_0 双语

### 待完成（发布前）

- [x] git commit `9f1d62c`（本地）；~~push origin main~~ 网络不可达，待恢复后 `git push origin main`
- [x] 打包 `../yu-zhao-v3.0.0.tpg`（154KB，manifest 3.0.0 / entry.js / locales×2 / cover.png）
- [ ] MCP 发布门禁：`tavo_plugin_validate_manifest` → `tavo_plugin_audit` → `tavo_plugin_package`
- [ ] 真机回归：旧档升级（v2.2.1 → v3.0.0 自动迁移「我」空间）、空间切换/新建/删除+撤销、
      跨空间收发与 AI 回帖未读、只读/关发送开关生效、世界书快照恢复、触屏两击确认
