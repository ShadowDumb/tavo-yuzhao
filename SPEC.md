# 玉兆 · UI 设计标准（SPEC）

> **文档分工**：`DESIGN.md` 记录**设计方向**（概念、架构、协议、为什么这样设计）；本文件 `SPEC.md` 记录**落地与验收标准**（界面元素必须长成什么样、以什么口径判定通过）。二者互补：方向变了改 DESIGN.md，实现与验收口径变了改本文件。
> 本文件是**可判定的验收契约**——每条标准都应能被"看一眼/量一下/跑一遍"证实或证伪，而非风格倡议。
> 新增或修改任何可见 UI 前，先在此登记标准；实现只改 `src/ui/jade.template.html`（CSS 真源）与 `src/ui/views/*.js`（标记），随后 `node scripts/build.mjs` 重新生成 `ui/jade.html`。禁止直接编辑生成物 `ui/jade.html`。

## 〇、总则

- **一致性优先于个案美观**：同一语义的元素在全项目必须同形、同高、同圆角。禁止在单个视图就近取 `border-radius` / `height` 字面量。
- **令牌化**：所有圆角、控件高度、语义色一律走 CSS 自定义属性（见 §一）。新增值先入令牌表，再引用。
- **形状族收敛**：交互控件只允许 3 种形状——圆角矩形（控件）、胶囊（标签/开关轨道）、正圆（头像/图标/FAB/卦位）。杜绝第四种。
- **触控底线**：任何可点元素命中区 ≥ 44×44px（`--yz-h-control`）。
- **单一来源**：当前空间名只在顶栏 `.yz-space-btn` 出现一次；页头不再重复显示（已移除 `.yz-header-tag`）。

## 一、设计令牌（Design Tokens）

定义于 `#yz1-overlay, #yz1-toast, #yz1-confirm`（插件自有根，避免污染宿主）。

### 1.1 圆角

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--yz-r-control` | `12px` | **所有**按钮、输入框、`<select>`、步进器、textarea、确认按钮、toast 动作按钮 |
| `--yz-r-card` | `14px` | 卡片/列表行/分组/气泡/诊断区等信息容器 |
| `--yz-r-pill` | `999px` | 仅：真实标签页 `.yz-tabs .yz-tab`、开关轨道 `.yz-switch` |
| `--yz-r-badge` | `9px` | 计数徽标与文字标签（`.yz-unread`/`.yz-group-count`/`.yz-*-tag`） |
| 正圆 `50%` | — | 仅：头像 `.yz-ava`、图标 `.yz-coin`/`.yz-map-pin`/`.yz-glyph-sm`、FAB `#yz1-fab`、卦位节点 `.yz-node`/`.yz-core`、状态点 `.yz-statusdot`/`.yz-sync i`、开关滑块 `.yz-switch i`、警示徽标 `.yz-badge-alert` |

> 规则：**"×"图标按钮族**（顶栏关闭 `.yz-btn`、行删 `.yz-row-action`、气泡删 `.yz-bubble-del`、舆图删 `.yz-map-delete`、搜索清除 `.yz-search-clear`）统一为 `--yz-r-control` 圆角矩形，不再混用正圆。正圆只留给"非按钮"的装饰性图标/头像。

### 1.2 尺寸 / 高度

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--yz-h-control` | `44px` | 全部按钮、单行输入框/`select`/步进器/开关行、顶栏图标按钮命中区（触控标准） |
| `--yz-h-compact` | `38px` | 仅独立成行的筛选标签 `.yz-tabs .yz-tab`（页内导航，不与输入框同行，可略矮以贴合文字） |

- 内容区单行控件一律 44px。**废除**历史上出现的 `36px`（密集动作）、`38px`（select）、`~34px`（padding 撑高的表单输入）三档"意外值"。
- **与输入框同行的控件**（改名/复制/导入按钮、空间开关、清空、发送）保持 44px，确保同行等高；只有**独立成行的筛选标签**降到 `--yz-h-compact`。
- 多行 textarea（`.yz-io` 导出/导入、表单正文）保留自身高度（120/240/≥90px），但圆角走 `--yz-r-control`。
- 方形图标按钮 `width` 与 `height` 相等（44px）。

### 1.3 语义色（现状登记，后续收敛为令牌）

| 语义 | 现值 | 出现处 |
| --- | --- | --- |
| 主色·青玉 | `#67e6a8` / `rgba(70,180,140,*)` | 完成态、发送/主操作底、开关 on |
| 强调·金 | `#ffd27a` / `#ffe9a8` | 价格、未读、部分同步、玩家标签 |
| 危险·朱 | `#ff7a6b` / `#ff9d8a` / `rgba(180,60,60,*)` | 删除/清空/无效态 |
| 信息·青碧 | `#8fd0ff` | 买入方向、地图针 |
| 文本·主 | `#eef9f3` / `#f2fff9` | 正文 |
| 文本·次 | `#a7d6c2` / `#8fc4ac` / `#7fae9a` | 说明/时间/占位 |
| 卦位色调 | `.t-gold/.t-silver/.t-vermilion/.t-jade/.t-green/.t-azure/.t-rock/.t-ocre` | 八卦节点 |

> TODO（待登记）：将上表提升为 `--yz-c-*` 令牌，替换散落的 rgba 字面量。

## 二、组件 → 令牌映射（现状清单）

### 2.1 按钮

| 类 | 语义 | 圆角 | 高度 |
| --- | --- | --- | --- |
| `.yz-btn` | 通用/主操作按钮（圆角矩形） | `--yz-r-control` | 44 |
| `.yz-back` / `.yz-close` | 顶栏/页头图标按钮（返回 ‹ / 关闭 ×）：**幽灵态**——无可见边框与底色，仅 20px 字形，命中区仍 44×44 | `--yz-r-control` | 44 |
| `.yz-space-btn` | 顶栏空间切换胶囊：无边框、柔底填充、13px 文字（继承 `.yz-btn` 高度） | `--yz-r-control` | 44 |
| `.yz-send` | 主操作（发送/保存/编辑帖） | `--yz-r-control` | 44 |
| `.yz-add-btn` | 列表底部新建 CTA（通栏） | `--yz-r-control` | 44 |
| `.yz-clear-btn` | 次级/危险（删除/清空，两击确认） | `--yz-r-control` | 44 |
| `.yz-edit-btn` | 行尾编辑 ✎ | `--yz-r-control` | 44 |
| `.yz-step` | 数量步进 −/+ | `--yz-r-control` | 44 |
| `.yz-row-action` | 行删除 × | `--yz-r-control` | 44 |
| `.yz-bubble-del` | 气泡删除 × | `--yz-r-control` | 44 |
| `.yz-map-delete` | 舆图删除 × | `--yz-r-control` | 44 |
| `.yz-search-clear` | 搜索清除 × | `--yz-r-control` | 44 |
| `.yz-toast-action` | Toast 内动作（撤销等） | `--yz-r-control` | ≥44 |
| `#yz1-confirm .yz-confirm-actions button` | 确认框取消/确定 | `--yz-r-control` | 44 |
| `.yz-space-toggle` | 空间开关（sendToAI/allowAIWrite） | `--yz-r-control` | 44 |

### 2.2 标签页 / 开关（胶囊族）

| 类 | 语义 | 圆角 | 高度 |
| --- | --- | --- | --- |
| `.yz-tabs .yz-tab` | 视图切换标签（真 tab，独立成行） | `--yz-r-pill` | 38（`--yz-h-compact`） |
| `.yz-tab`（非 `.yz-tabs` 内） | 被复用为动作按钮（进入/重命名/新建/复制/导入） | `--yz-r-control` | 44 |
| `.yz-switch` | 开关轨道 | `--yz-r-pill` | 22（轨道） |

> 说明：`.yz-tab` 基础样式为圆角矩形控件；仅当处于 `.yz-tabs` 容器内时覆写为胶囊。这样"看起来像标签页"的胶囊只出现在真正的标签导航里，被借用作动作按钮时自动回落为矩形，与同行 `.yz-clear-btn`/`.yz-space-toggle` 对齐。

### 2.3 输入

| 类 | 语义 | 圆角 | 高度 |
| --- | --- | --- | --- |
| `.yz-form-input` | 表单文本/数字输入 | `--yz-r-control` | 44（`min-height`） |
| `.yz-form select.yz-form-input` | 表单下拉 | `--yz-r-control` | 44 |
| `.yz-form textarea.yz-form-input` | 表单多行正文 | `--yz-r-control` | ≥90 |
| `.yz-search input` | 列表检索框 | `--yz-r-control` | 44 |
| `.yz-composer input` | 消息/评论输入 | `--yz-r-control` | 44 |
| `.yz-space-rename input` | 空间重命名/新建输入 | `--yz-r-control` | 44 |
| `.yz-io` | 导出/导入 textarea | `--yz-r-control` | 120/240 |

### 2.4 容器 / 卡片（`--yz-r-card`）

`.yz-hero` `.yz-group` `.yz-row` `.yz-note-row` `.yz-note-paper` `.yz-post-paper` `.yz-bubble` `.yz-diag` `.yz-manage-info` `.yz-manage-help`。
外层屏幕 `.yz-screen`(26px)、模态 `.yz-confirm-box`(16px)、Toast 容器(20px) 属"界面级表面"，保留各自较大圆角，不并入卡片档。

### 2.5 徽标 / 标签（`--yz-r-badge`）

`.yz-group-count` `.yz-unread` `.yz-tag` `.yz-price-tag` `.yz-player-tag` `.yz-space-tag`。
卦位盘上的浮标 `.yz-badge-alert`(正圆) `.yz-badge-unread` `.yz-badge-new` 属装饰层，保留原形。

## 三、排版

- **字体栈**：`"Songti SC","STZhongsong","Noto Serif SC","PingFang SC",serif`（衬线，贴合"玉/篆"气质）。等宽仅用于 `.yz-io`（JSON 导入导出）。
- **字号阶**：标题/品牌 19px · 页面标题 15px · 控件文字 13–15px（新建 CTA 15 / 发送·确认 14 / 标签·清空·开关·空间胶囊 13）· 正文 13–14px · 说明/时间 11–12px · 徽标/标签 9–10px。
- **字距**：中文标题 `letter-spacing` 2–6px；**控件文字 ≤1px**（历史上按钮的 2px 字距会让小字显稀疏、框显大，已收敛）；徽标 1px。
- **框字比例**：控件文字须填满可见框——44px 框配 ≥13px 文字；独立筛选标签收高到 38px 贴合 13px 文字；顶栏图标按钮去框（幽灵态）避免"小字塞大框"。
- **可读性优先**：正文/输入保证可读，装饰性字距只用于标题与标签。

## 四、状态

| 状态 | 规则 |
| --- | --- |
| hover | 提亮背景（`filter:brightness` 或加深 rgba），不改形状/尺寸 |
| active（步进器等） | 可 `transform:scale(.94)` 微反馈 |
| focus | 单行输入/可聚焦标题用 `outline:1px solid rgba(150,255,215,.45)`；FAB 用 `:focus-visible` 光环 |
| disabled | `opacity:.45~.55;cursor:not-allowed`；封印态 `.sealed` 用 `grayscale(1)` |
| armed（两击确认） | 危险按钮展开为文案态：`height:auto;min-height:44px`，边框/底色转朱红，5 秒超时还原 |
| error | `.yz-form-input.error` 朱红描边 + 外发光 |

## 五、可访问性

- 触控命中 ≥ 44×44。
- 图标按钮必须有 `aria-label`；开关用 `aria-pressed`；标签页用 `role="tab"/"tablist"` + `aria-selected`。
- 模态 `role="dialog"/"alertdialog"` + `aria-modal`；实时区 `aria-live`（toast `status`、`#yz1-live`）。
- 尊重 `prefers-reduced-motion`：全局关闭动画/过渡（已实现）。

## 六、响应式与安全区

- 视口容器 `#yz1-jade`：`min(400px, 100vw-20px) × min(780px, 100dvh-20px)`。
- 窄屏 `@media (max-width:374px)`：收紧顶栏间距、隐藏副标题、缩小空间按钮。
- 底部/四周用 `env(safe-area-inset-*)` 避让刘海与手势条（composer、toast、overlay padding）。

## 七、动效

- 卦位呼吸 `yzBreath`(3s) / 新消息快呼吸 `yzBreathFast`(1.6s)；太极缓转 `yzSpin`(12s)；加载 `yzSpin`(1.2s)；未读行辉光 `yzUnreadGlow`(2.2s)。
- 过渡时长 0.12–0.3s，`ease`。
- 一律受 `prefers-reduced-motion` 关停。

## 八、变更流程

1. 需要新形状/尺寸/色 → 先在 §一 令牌表登记（含用途与例外）。
2. 改 `src/ui/jade.template.html`（令牌定义 + 组件规则）与相关 `src/ui/views/*.js`（类名/标记）。
3. `node scripts/build.mjs` 重新生成 `ui/jade.html`；`node scripts/build.mjs --check` 校验生成物同步。
4. 视觉回归：中英双语 × 窄屏 374px × 八视图（玉牌/讯息/玉册/论坛/坊市/芥子空间/舆图/管理）+ 表单页 + 确认框 + toast。
5. 在本文件对应条目更新"现状清单"，保持文档与 CSS 一致。

## 九、验收清单（Acceptance / DoD）

每次 UI 改动合入前，逐条核对；任一不过即视为未达标。判定口径以 §一 令牌为准。

**形状一致性（可判定）**
- [ ] 全局搜索 `border-radius`：交互控件（按钮/输入/select/textarea/步进器）只出现 `--yz-r-control`，无 `50%`/`22px`/`15px`/`9px`/`10px` 等字面量残留。
- [ ] 所有"×"图标按钮同形（圆角矩形），无圆/方混排。
- [ ] 正圆 `50%` 仅出现在头像/图标/FAB/卦位节点/状态点/开关滑块，不出现在任何按钮或输入框上。
- [ ] 胶囊 `--yz-r-pill` 仅出现在 `.yz-tabs .yz-tab` 与 `.yz-switch`。

**尺寸一致性（可判定）**
- [ ] 内容区单行控件高度 = 44px；独立筛选标签 = 38px（`--yz-h-compact`）；无 `36`/`~34` 等意外值残留。
- [ ] 同一行/同一组并排控件等高（重点：表单"保存+删除"、空间动作网格、composer"输入+发送"、搜索"输入+清除"、空间改名"输入+按钮"）。
- [ ] 方形图标按钮 `width == height`。
- [ ] 顶栏/页头图标按钮（返回/关闭）为幽灵态：无可见边框底色，命中区仍 44×44。
- [ ] 空间名只出现在顶栏胶囊，任何页头不重复显示。

**令牌化（可判定）**
- [ ] 圆角/控件高度经 `var(--yz-*)` 引用，`:root`/插件根有定义。
- [ ] 未在视图 JS 内联 `style` 里写死圆角或高度（`.yz-manage-main` 等既有内联除外，需登记）。

**双语 × 响应式（可判定）**
- [ ] 中文 / EN 两语言下无按钮文案溢出、无粘连（EN 动词+名词已补空格）。
- [ ] 374px 窄屏：顶栏、空间按钮、动作网格不破版、不横向溢出。
- [ ] `env(safe-area-inset-*)` 生效，composer/toast 不被手势条遮挡。

**状态与可访问性（可判定）**
- [ ] 每个图标按钮有 `aria-label`；开关有 `aria-pressed`；标签页有 `role`/`aria-selected`。
- [ ] hover/focus/disabled/armed/error 五态可见且不改形状尺寸（armed 允许高度自适应展开）。
- [ ] `prefers-reduced-motion` 下动画/过渡全停。

**构建（可判定）**
- [ ] `node scripts/build.mjs` 已运行；`node scripts/build.mjs --check` 退出码 0（生成物与源同步）。
- [ ] 生成物 `ui/jade.html` 未被手改（改动只在 `src/`）。

## 十、待办（Backlog）

- [ ] 语义色提升为 `--yz-c-*` 令牌，替换 rgba 字面量（§1.3）。
- [ ] 字号/字距/间距提升为 `--yz-fs-*` / `--yz-gap-*` 令牌。
- [ ] 评估把 `.yz-tab` 复用为动作按钮的用法拆出独立类（如 `.yz-chip-btn`），消除"标签页外观"歧义。
- [ ] 真机验证 FAB 默认/复位位置不遮挡 composer 发送按钮。
