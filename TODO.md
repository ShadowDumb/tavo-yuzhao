# 玉兆 开发待办（TODO）

> 当前基线：v2.2.0（已发布，冒烟 857 项全绿）。
> 本文件只记录未完成工作。已完成的工作与全部变更记录见 CHANGELOG.md。

---

## 已否决 / 搁置

- 外观主题（纯装饰，无玩法增益）
- TTS 传音（无音频权限，宿主能力未验证，技术可行性存疑）

## 开发约束（每个候选必过）

所有新增数据形态必须逐项过「数据形态扩展审计」：
buildCurrent 窗口化、条目级注入采样（sampleEntries 强制集/活跃度加权/冷门保底/隐藏不提示）、
MAX_BASELINE_CHARS 预算、diff 合并、达标评估、内容指纹去重、
版本迁移、四层备份链、世界书归档关键词——任何一项遗漏都会破坏现有 857 项测试基线语义。
玩家域新增数据形态另需过：三层存储（不进世界书）、不经模型评估、跨域幂等、CRUD 校验与删除级联；
公开数据发布另需过：owner 维度、镜像对账（含评论保留与 id 撞车改名）、评估豁免、提示词保护、
跨域镜像并发复查（await 后状态同一性）。

- 冒烟门禁：`node --check entry.js && node tests/smoke.mjs`（基线 857 项全绿）
- 发布门禁：MCP `tavo_plugin_validate` → `tavo_plugin_audit` → `tavo_plugin_package`，
  产物随版本号更新出包

## 评审待办（v2.2.0 用户视角评审，2026-08-30）

### 必须修（严重）

- [x] **S1 玩家域表单种类冲突报错直出 "undefined"**：`dict.playerFormKindClash`
      被引用（entry.js:6338）但 buildDict 漏接线（~1927）；字典双语键已存在。
      补一行映射即可，冒烟补一条回归。
- [x] **S2 清除确认框跨聊天存活，可能误清"新"聊天数据**：`clearAllData` 执行时
      才取 `runtime.activeChatId`（5833），`showConfirm` 不锁 chatId（5561），
      且 `chat:closed`/`close()` 都不收确认框（6630/6054）。修法：showConfirm
      捕获 chatId，确认时校验 `chatId === runtime.activeChatId` 不符则关闭；
      并在切聊/关闭/打开时统一 `hideConfirm()`。
- [x] **S3 导入缺结构签名校验，误贴任意 JSON 也报「导入完成」并清空数据**：
      importState（3137）只校验「是对象」，`{"foo":1}` 直接覆盖 `chats[activeChatId]`（3144）。
      修法：须含玉兆特征字段（tablet / chats / schemaVersion / revision 任一），
      否则 reason:'parse'，复用现有 importParse 文案。
- [x] **S4 清除后同步状态残留「complete」假绿 + 旧摘要 + 无重建引导**：
      clearAllData（5832）不清 sync.status/summary/roleName/issues、不置 pendingFull；
      下一轮 meta-only diff 提前返回不改状态（1143）。修法：清除时置
      `state.pendingFull = true`、重置 sync 为 empty，保留 revision>0 与
      processedTurns（防历史水化复活数据）；clearFeatureData（5816）同理刷分区 status。

### 建议尽快修（中等）

- [x] **M1 showToast 不清空旧内容**：2.4s 内连续 toast 文字串接 + 残留「撤销」按钮
      会触发新动作（5588-5605）。修法：showToast 开头先 clearToast()。
- [x] **M2 open-jade 禁用态静默失败**（6022），与 resync/clear 的「已禁用」toast
      不一致。修法：open() 内禁用时复用 disabled toast。
- [x] **M3 resync-history 无确认、无防重入**：连点两次报误导性「聊天已切换」红 toast
      （6589-6605）。修法：加 in-flight 锁，或 stale 文案改「恢复进行中」。
- [x] **M4 确认框「点遮罩关闭」与文档/冒烟断言矛盾**：点遮罩实际无反应（5539-5541），
      Escape 只关玉兆不关确认框（6759）。修法：遮罩点击关闭 + Escape 关闭 + 打开时
      聚焦「取消」。
- [x] **M5 太极核心是死按钮**：主页点中心只重渲染（6090），但描述承诺「点击可查看
      同步诊断」（zh-CN.json:3）。修法：二选一——恢复打开同步详情，或改文案。
- [x] **M6 封印 msg/forum 后发讯/群聊/评论「假成功」**：syncPlayerChannel 静默
      return false（2441）但 UI 仍弹「传讯已发出」（6209）。修法：发送入口过
      featureFlags 门控，封印时 toast 说明无法送达。
- [x] **M7 论坛发评论后整页跳回顶部**：render 重建滚动容器，post 视图不 pin 底（6269）。
      修法：post/带底部输入框的详情页渲染后恢复 scrollTop。
- [x] **M8 编辑备忘/订单不刷新时间戳**：用户以为「没存上」（2770-2777、2809-2814）。
      修法：编辑分支统一刷新 updated/time。
- [x] **M9 FAB 拖拽阈值仅 4px**：触屏点按微抖被当拖拽、点了没反馈（6497）。
      修法：阈值提到 8-10px，拖拽开始时给视觉/震动反馈。
- [x] **M10 玩家域玉牌/舆图是死页**：无写入途径，空态只承诺「编辑功能后续开放」无引导
      （4962、4979）。修法：空态改为明确引导（切回角色域查看）。
- [x] **M11 域切换按钮显示「当前域」而非目标动作**：用户当状态标签、想不到可点
      （5011、5622）。修法：文案改「→ 玩家域」或两段式分段控件。
- [x] **M12 英文本地化质量**：Nebula Space 误译且与 "Pocket dimension" 冲突、
      NewFolder/NewNote 拼接无空格（4428）、jade data/artifact data 混用、
      Artifact Manage 病句、Shared vs Public。修法：en.json 统一术语。

### 可延后（轻微）

- [x] L1 英文卦名小屏截断（5084）；EN 顶栏窄屏溢出（无 @media）
- [x] L2 玩家域主页新手引导被 nowrap 截断（5106）
- [x] L3 订单/物品行「整行可编辑 + 行尾 ✎」双入口（4655 vs 4438）
- [x] L4 技术词泄漏：settings.info「快照/diff/注入/世界书」、releaseNotes「冒烟测试 701 项」
      （实为 857，数量已过时）
- [x] L5 撤销 toast 仅 2.4s 太短（6391）
- [x] L6 搜索/渲染后所有页面滚动位置归零（5694）
- [x] L7 聊天详情检索旧消息被强行拉回底部（5696-5699）
- [x] L8 管理页封印单击即切换无确认（5439）
- [x] L9 玩家自己刚发的消息计为角色域未读（2421）
- [x] L10 超窗联系人详情报「找不到」无归档说明（4277）
- [x] L11 角色域会话消息静默截断 20 条无归档提示（338、358）
- [x] L12 玉册详情页无删除入口，删除需经表单（4553）
- [x] L13 备忘「锁定」无任何约束效果，纯标记易误解（4570）
- [x] L14 清空倒计时括号硬编码中文「（N）」，EN 混排（5808）
- [x] L15 空列表/少条目仍渲染检索框占位（4167）
- [x] L16 导航重复压栈：同行连点两次返回要多按一次（5917-5930）
- [x] L17 两击武装后返回页面 wipeTimer 未清理（5872、5956）
- [x] L18 玩家域主页底部「已送达 N · 已回 M」视觉可点实为 div（4128）
- [x] L19 发帖「版块」自由文本，角色侧有预设、玩家可随意输入造成碎片化（4487）
- [x] L20 开玉兆 await 期间无 loading 态（6024-6026）
- [x] L21 玩家域玉牌文案「编辑功能后续开放」措辞笼统（zh-CN.json:119）
- [x] L22 角色域会话时间戳/消息顺序边界（超窗数据「找不到」）
- [x] L23 玩家刚发消息未读游标：generation:prepare 即推进，生成失败不回退（6657）
- [x] L24 伪造 pm-N 出窗残留对账漏洞（2492-2494）
- [x] L25 超长 id 第五轮标识行截断腰斩 id（3848）
- [x] L26 未知字段键回退显示裸英文键（4007-4013）
- [x] L27 结算/导出面板可检查性差（120px 只读 textarea，4912）
- [x] L28 双域公开数据重复只读提示（space 两 tab、forum 列表+详情）
- [x] L29 无障碍：确认框无初始焦点/焦点陷阱/aria 关联（5531-5537）
- [x] L30 侧边栏/输入动作非聊天页无 chatActive 守卫（6585-6606）
- [x] L31 语言切换后已开确认框文案不刷新（6744）
- [x] L32 启动瞬间 ensureShell 前点清除会因宿主不存在而静默失败（5562）
