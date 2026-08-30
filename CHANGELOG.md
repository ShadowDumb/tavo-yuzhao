# 变更记录（CHANGELOG）

> 玉兆（Yu Zhao）Tavo 平台对话插件的全部版本变更集中记录于此，最新版本在最前。
> 其他文档不再保留变更记录；设计细节见 DESIGN.md。

## v2.2.0（2026-08-30）

### 新增功能

- **交互基座第一层·检索筛选**：全部列表页与讯息详情页新增顶部检索框（`searchKw`/`contains`/`filterMatch`/`searchBox` 纯函数，8 页面接入），纯内存过滤不改数据；无命中专属空态；关键词随导航自动清空；输入框重渲染焦点/光标恢复支持连续键入；双语 catalog 新增 `runtime.search.*`
- **双玉兆一期·玩家域**：`playerState` 与角色域同构——forum 分区只承载玩家帖子、market 全量（求购为公开数据）、无模型域字段；三层存储（宿主 chat 键 `yz_jade_player_v1` + 本地镜像 + 全局备份，后改世界书快照），按 updatedAt 取新
- **双玉兆一期·传讯通道**（唯一跨域写入点）：玩家域固定「与角色传讯」会话，消息 `pm-<seq>` 幂等投递角色域 `yz-player` 联系人（并发安全），未读数客户端维护，`assessMsg` 豁免玩家联系人；prepare 注入基线即推进已读游标（`sync.playerReadCursor`，applySnapshot 保留防反弹）；模型以普通 `+msg` 回复并由通道镜像回玩家线程（已回标记）；封印 msg 后通道停止、双方保留数据；历史重建/清空后按玩家域补投角色域
- **公开数据上的玩家发言**：群聊发言（`pmg-<n>`，`syncPlayerGroups` 镜像为角色域群组消息，气泡左右按渲染视角翻转，群组被删时对账重建）；论坛评论（`pmc-<n>`，`syncPlayerPosts` 合并为角色域帖子评论，owner=player）；`pmg-*` 增删改一律拒绝、命中 `pmc-*` 的覆盖/删除拒绝（diff 门禁）；玩家发言不凑达标底线
- **帖子未读机制**：post 行第 10 字段 unread=新回复数（模型维护，启发式兼容旧格式 owner 位，diff 未显式带则保留）；玩家帖 unread 恒 0（门禁保护）；未读帖列表置顶 + 呼吸光效；采样强制集含 unread>0 帖
- **玩家域 CRUD（二期）**：记事玉册（玉册夹/备忘增删改、删除级联、禁制锁定）、芥子空间（物品/钱财增删改，货币种类为键重命名）、坊市订单（增删改，buy/sell 归一）；`playerNextId` 确定性 id（pf-/pn-/pi-/po-`<n>`）；表单页保存/两击删除（复用 `nextWipeState`，导航复位）；列表页新建 CTA + 行尾编辑；全部直写玩家域不经模型
- **玩家论坛发帖（owner 维度）**：post 行尾可选 owner=player；源数据在玩家域（`fp-<n>`），`syncPlayerPosts` 幂等镜像进角色域，作者名 = `{{user}}`；三层保护——diff 门禁（模型不可触碰 owner=player 行）、提示词明令（只可 `+comment` 评论）、镜像对账（full 轮篡改/漏写/删失后按玩家域还原，id 撞车双方同步改名）；玩家帖全行注入基线、不进窗口归档、不进世界书；删除玩家帖后角色域同步移除
- **角色域内容扩展·玉牌扩组**：玉牌新增功法/羁绊两组（六组：基本/仪容/修为/功法/羁绊/隐秘）；组名别名归一（功法/心法/法诀/绝学/术法、羁绊/缘分/牵挂 + 英文），canonical 键 diff 去重合并；达标底线功法/羁绊各 ≥1 条，缺组 issue `tablet.gong`/`tablet.bond` 双语回显；旧档经 issue 回声自动补齐；删除组内最后一行被达标门禁拦截
- **角色域内容扩展·舆图地点名录**：`map.places` 地点名录（`place｜id｜地点名｜所属域｜说明`，上限 20），达标底线至少 2 处；基线窗口之外只给 archived 摘要行；世界书新增「玉兆·地点名录」关键词条目召回；舆图页新增名录区块并参与检索；玩家域舆图同步展示
- **角色域内容扩展·坊市求购区**：`market.requests` 求购公告（上限 12），达标底线至少 1 条；基线窗口之外给 archived 摘要行；求购为公开数据（与行情/拍卖同源、跨域一致带「公开」标识）；坊市页新增「求购」tab
- **条目级注入采样**：联系人/群聊/帖子超过上限（3/2/5）后每轮只注入采样子集（`sampleEntries`，rng 可注入）——强制包含集（yz-player/未读联系人/含 pmg-* 群聊/玩家帖/含 pmc-* 评论帖）必定注入，其余按活跃度加权随机（`score=1+消息数` 钳制 20，`p∝score^γ` γ=2，`p≥β/n` β=0.5 冷门保底）；隐藏条目完全不出现；每轮独立采样不持久化
- **六期评审新增能力**：全局 Toast 通道（宿主迁移到 body 级全局浮层 `#yz1-toast`，玉兆未打开时提示也可见，支持内嵌操作按钮）；表单校验定位化（reason→字段高亮 + 行内错误 + focus，货币种类撞名 `kindClash` 专属文案，全部输入加 maxlength）；主页/会话列表「全部已读」一键清零；删除撤销（会话内快照 `playerRestoreEntity`，玉册夹级联备忘一并还原）；数量字段 −/+ 快捷步进；超限截断「更早已归档」痕迹（线程/群聊 `archived` 标记 + 会话顶部提示，论坛评论满额说明）；行内未读角标 99+ 封顶；纯数字金额/价格千分位 + 买卖分色（buy 蓝 / sell 金）；数据导出「仅含角色域数据」说明

### 修复

- **侧边栏「重建玉兆数据」文案歧义**：用户可能理解为清除玉兆数据——改为「从快照恢复玉兆数据」（en: Restore artifact data from snapshot），同步修正诊断页行动指引引用
- **玩家域舆图泄漏 `undefined` 占位**：无当前所在地但有行踪/地点时（玩家域无 current 写入路径），renderMap hero 未初始化被拼进页面——初始化为空串；角色域/玩家域各加回归测试
- **六期评审 P0 修复**：跨域切换 nav 不重置（私有子页回退根视图，manage/sync 玩家域强制回主页）；致命操作确认载明后果（永久清除 + 3 秒 armed 倒计时）；禁用态入口语义（`resync-history` 门控 + stale 分支）；FAB 遮挡（打开玉兆时隐藏）；FAB chatActive 启动兜底（主动探测 `tavoApi.chat.current()`，插件重载后不永久隐藏）；主页隐形圆环拦截点击（`pointer-events:none`）；角色回复未读闭环（镜像置 unread，列表/主页亮角标）；发送反馈闭环（镜像失败标「未送达」+ 重发）；管理页导出→导入 round-trip 断裂（按 pretty 文本长度校验）；导入覆盖提示；论坛未读清零（打开详情即 `clearPostUnread`，玩家帖 `seen` 游标）；发帖保存后列表不同步（await 镜像后 backNav）；芥子删除武装覆盖未保存编辑（局部更新）；IME 中文输入被每键重渲染打断（`isComposing` 跳过）；时间戳 UTC 与干支历混排（改本地时区）；打开聊天弹回最旧消息（渲染后滚动到底）；重建入口反馈
- **六期评审 P1 修复**：角色域只读边界提示条；行主体死区（整行可点进编辑）；诊断页术语 i18n + failure 行动指引 + 累计轮次 + 开发者信息折叠；主页徽标语义（alert 文案中性化、`b-new` 差异化呼吸、未读点开即清零）；玉牌字段键本地化（`runtime.field.*` 显示字典）；玉牌 fail-state 可视化（partial 状态条 + 缺组占位 + 组折叠）；舆图空态与方向（空态合并 + 行踪逆序）；检索可见文案命不中（订单按归一化方向标签检索）；论坛未读通知（`seen` 游标 + 角标置顶）；负面反馈与竞态（空输入 toast、新用户指引、记住离开位置）；论坛/笔记出入栈（删除后回退跳过已删详情）；管理卦位玩家域视觉区分（金色「锁」徽标）
- **五路评审修复（第一轮）**：并发安全（syncPlayerPosts/syncPlayerChannel await 后复查状态同一性；load 镜像/宿主 tie-break 改「revision 平局取 updatedAt 更新者」；hydrateHistory 写回前引用复查；doSwitchChat 读存储前排空落盘队列）；传讯通道（known 全量扫描 + 双向镜像保尾 20，diffChats 对 yz-player 只读防护）；发帖镜像（对账按 mine id 集排除剥落 owner 行，id 撞车双方改名）；数据卫生（playerSaveEntity 先验后改、货币重命名撞种类拒绝、数值非负钳制、评论 id 取现存最大值 +1）；预算（新增第五轮淘汰——超长标识行截断到 160，9000 硬上限不再可击穿）；边界（parse 空判定补 requests/places，管理页清空后补投镜像，导出超限拦截）；提示词群消息底线 10→2 与评估器对齐；catalog 补 forum.rows 翻译键；标点随语言
- **五路评审第二轮**：diffChats 拒绝伪造新 pm-N（含 side=self 自回复）+ 未读三处 side=other 过滤；syncPlayerChannel 内容对账（full 轮篡改的 pm-* 还原、超序号伪造删除）；syncPlayerPosts 评论双键去重 + 重编 cm-N 副本 owner 认领；normalizeForum 玩家帖 unread 恒 0 钳制；parseDiffOps 按行类型 join 尾部自由文本；玩家域舆图渲染数据源泄漏修复；EN 引导行/约束补 unread 字段；PLUGIN_VERSION 同步 + manifest 契约测试；search 清除按钮 CSS；playerReadCursor 负值钳制 + myComments 保尾；死代码清理（RUNTIME/APP 导出键、dict 死键、无用参数、savePlayer 辅助、stripOldProtocol、双重序列化）；注释修正；测试恒真断言修复
- **缺陷修复·群聊历史发言被顶成最新消息**：根因四条——基线窗口 pmg 出窗后全量轮无法照抄导致镜像重复追加；known 集合被 safeArray(24) 截断；tail 裁剪不豁免 pmg；重插总追加尾部。修复：pmg 恒注入基线（上限 12，超出给归档摘要行）、known 覆盖全部现有 id、裁剪豁免 pmg、重插按序号锚点
- **修复 `close()` 后 FAB 不恢复**：× 关闭玉兆只移除 overlay 的 open 类、不触发 render，`fab.hidden` 残留 true 导致悬浮球消失、重开繁琐——close() 内按同一门控直接刷新 FAB 显隐

### 架构与持久化

- **持久化改造（世界书为主存储）**：权威数据迁到世界书 `玉兆档案·<chatId>` 分片快照（角色域 yz-snap-N / 玩家域 yz-psnap-N，每片 ≤90KB、单域 ≤5 片，按 index 拼接还原；读取兼容旧版单条 yz-snap）；本地镜像降级为启动缓存；移除宿主 chat 键与全局备份（tavoApi.set 不再参与状态持久化，切聊复查竞态消失）；save 仅在「有实际数据」时排队同步、syncArchive 无可写内容时不触碰已有书；镜像/世界书按 revision 与 updatedAt tie-break，陈旧世界书由镜像治愈回写
- **六期评审语义收敛**：太极核心任何位置点击回主界面（同步详情入口收敛到状态条/管理页诊断区）；域切换按钮只换数据源不换 UI

### 测试

- 冒烟基线 **701 → 805 → 841 项全绿**：新增恶意载荷渲染契约（XSS 守卫）、data-action↔路由分支双向守卫、pickEnvelopePayload/fieldValue 命中路径、镜像 tie-break 回归、世界书分片 round-trip、旧单条快照兼容、玩家域快照、撤销还原、步进/全已读/归档痕迹/全局 toast 宿主等视图契约、close() 后 FAB 恢复回归保护

## v2.1.0

### 新增功能

- **diff 增量协议**（git diff 语义）：`+行` upsert / `-行` 删除（定位字段），客户端与基线合并，模型每轮只输出变化行（省 token）；未提及分区原样保留——根治 v2.0.3 提示词「只输出变化行」与 full 整块替换语义冲突导致的满屏红色感叹号与数据碎片化；识别 meta `diff` 或行形态（+/- 前缀）；issue 回声改「用 + 行补齐」
- **基线窗口化**：`buildCurrent` 每实体只注入最近窗口条消息（消息 6 / 笔记 3 / 帖子 3 / 挂单 6 / 物品 10 / 求购 6 / 地点 6），超窗条目以 `archived｜类型｜id｜摘要` 行概括（不在解析器白名单，复读不污染）
- **注入预算硬上限**：`MAX_BASELINE_CHARS=9000` 五级淘汰（明细 → tablet 字段 → 归档行 → last 真实事件行 → 超长标识行截断到 160），标识行永不整行淘汰，注入量封顶不再随数据滚雪球
- **世界书按需召回**：窗口外历史消息镜像到 `tavo.lorebook`（每联系人/群一个关键词条目，scanDepth=4/atDepth 注入/只读脚注），正文提及实体时按关键词召回完整归档；msg 落盘后后台同步（busy+pending 防重入），挂接聊天读既有列表合并不覆盖用户世界书，能力缺失静默降级
- **版本迁移容灾**：状态记 `pluginVersion`，版本变化/封印切换置持久化 `pendingFull` → 下一轮强制全量重写旧数据（防粘滞）；存储回退链 chat 键 → 本地镜像 → 全局备份键 → 世界书 `yz-snap` 快照条目（防卸载重装丢数据）
- 时间字段强制绝对日期（如 丙午年五月十二 午时），禁 今日/昨日 等相对表述（归档在剧情日期更晚时被召回）
- 提示词补归档规则（归档条目只可 `-` 行删除，不得 `+` 行整行替换）；删除 `sync_scope` 设置（diff 为唯一常规路径，part/skip 解析保留作历史水化兼容）

### 修复

- 群聊看不到最新消息：消息满员（联系人 20/群 24）时新消息被静默丢弃——改保尾截断（`tail()`），满员追加收下最新、淘汰最旧
- 记事玉册数量统计错误：文件夹 count 改按实际笔记派生（不再信任模型声明值）
- 重新生成/编辑消息后数据被清空：正文剥离通道移除了历史中的协议块，`rebuildFromHistory` 用空白覆盖内存态——历史无协议块时保留现有数据（空聊天保持空白）
- 跨聊天写入竞态：写前复查宿主当前聊天（读与写同微任务无窗口），宿主已切走时跳过宿主键；load 侧宿主键可能留旧，本地镜像带聊天标识、revision 更新时以镜像为准
- `applyText` 的 full 判定精确为「评估达标的全量轮」（非 part/diff 且所有已启封分区达标），部分达标的全量轮不再清除强制重写标记；diff 轮评估在合并结果上进行（触及不达标不落盘保旧数据 + issue，未触及分区重推导达标性可自愈）

## v2.0.4

- 修复重新生成/继续丢关联的三个根因：① prepare 竞态——handler 改异步，注入基线前 `resolveCurrentChatId` + `settle()` 等待 switchChat 加载/水化收尾；② 空白占位顶掉持久化状态——switchChat 的内存保留条件从「存在」改为「真正写入过」（revision/sync.updatedAt/processedTurns 任一非零）；③ 同 turnId 去重误杀 regen 轮——`processedTurns` 改存 `turnId@内容哈希` 指纹，内容有变即应用、同内容双通道投递仍去重
- 提示词补「重新生成/续写同样受基线约束」

## v2.0.3

- 修复多轮连续性：提示词注入 `<yz_current>` 当前数据基线（`buildCurrent`，`yzc_` 容器防解析冲突，行数上限对齐解析器），模型必须沿用既有 id 与未变化行
- smart 增量对照由 digest 改为完整基线，删除 `buildDigest`/`DIGEST_CAPS` 机制；剥离通道新增 `current` 标签

## v2.0.2

- FAB 图标由 `◈` 字符重绘为玉璧 SVG（渐变玉质 + 刻纹环 + 璧孔 + 高光，`FAB_ICON` 常量供 FAB 与管理页复位行共用）
- 修复点击方形高亮——FAB 在 overlay 之外不继承 `-webkit-tap-highlight-color`，现于自身声明禁用，按压反馈改为圆形缩放 + 提亮

## v2.0.1

- 真机反馈修复：FAB 拖拽跟手（`touch-action:none` 防触摸滚动劫持 + `.dragging` 态禁用位置过渡，消除 200ms 缓动滞后）
- 卦位「新同步」去掉文字角标只留呼吸光效（文字遮挡卦名）

## v2.0.0

### 新增功能

- **可观测层**：同步诊断详情页（三入口共用 renderSyncDetail）、管理页单功能两击清空/存档导出导入、侧边栏动作（open-jade/resync-history）、卦位三态徽标（警示>未读>新，appliedSeen 持久化）
- **增量同步（part/skip 协议）**：meta 第 5 字段 part/skip、buildDigest 确定性摘要注入、强制全量轮（flagsDirty）、issue 回声 ≤3 条、sync_scope 设置（默认 full）、剥离通道覆盖 digest 标签、part 轮失败最差只到 partial

## v1.6.0

- generation:success 重排为「先同步剥离、后应用快照」，持久化改后台串行队列并收紧重复轮次落盘
- host 读成功回写本地镜像；移除 role:'character' 兜底查询
- 编辑旧楼层删除协议块触发去抖重建；聊天缓存 LRU 上限 5
- 统一 dbg 调试日志（yz_debug=1）；z-index 收敛单档 `Z_INDEX_TOP` 常量
- 提示词补 msg/gmsg 方向取值硬约束；window focus 补充刷新 FAB

## v1.5.0

- FAB 复位与默认位置共用 `FAB_MARGIN_*` 常量（修复复位回到旧 64px 的不一致）
- 语言切换重渲染 shell 静态文案（顶栏品牌 + aria-label）；非聊天页隐藏 FAB（chatActive 门控）
- 正文剥离改定向增量扫描并加 `enabled()` 门控；管理页新增显式复位按钮
- 模态 Tab 焦点陷阱；`avaFallback` 入 catalog
- permissions 移除未使用的 `input`；移除失效的 wheel JS hack 改用 `overscroll-behavior:contain`

## v1.4.0

- `chat:closed` 收起/禁用收起/visibilitychange 刷新；全封印跳过注入
- manifest 补 `cover`；水化版本标记；switchChat load 竞态保护
- en 成员单位；issues `{path, code}` 入 catalog；oversized Toast
- FAB 默认位置上移 96px；焦点管理；持久化路径 sanitize

## v1.3.3

- 封印后 sync 恒 partial（assess/applySnapshot 按 flags 判定）
- seal 角标入 catalog；FAB aria-label 随语言刷新；翻译字典缓存 onChange 失效

## v1.3.2

- 太极图标精确居中、移除其下「玉兆」字样

## v1.3.1

- 真机修复：点击卦位整屏空白（page 容器 `hidden` 属性 vs class 切换）；FAB `[hidden]` 规则

## v1.3.0（P4）

- 天下舆图 + 玉兆管理封印机制 + i18n 迁移 `tavo.plugin.i18n`

## v1.2.0（P3）

- 天下论坛 + 交易坊市 + 芥子空间；修卦位键名错位

## v1.1.1（P2）

- 修复首轮反馈问题

## v1.1.0（P2）

- 交流讯息（`<yz_msg>`）+ 记事玉册（`<yz_notes>`）

## v1.0.0（P1）

- 协议（`<yz_jade>/<yz_meta>/<yz_tablet>`）+ Core + 太极八卦主界面 + 本命玉牌
