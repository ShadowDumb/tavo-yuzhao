# 玉兆（Yu Zhao）

> 以玉通灵、见微知著 —— 修仙世界的"手机"。

玉兆是 Tavo 平台的对话插件：它是**游戏角色随身携带的法器**，在每轮生成中通过协议块与模型同步一份结构化的修仙档案——本命玉牌、交流讯息、天下论坛、记事玉册、交易坊市、芥子空间、天下舆图。玩家以"旁观者"视角偷窥角色的玉兆，数据以角色为主体，随剧情演进。

## 特性

- **八宫卦盘主界面**：先天八卦布局 + 五行配色 + 缓转太极中枢，可拖拽的玉佩悬浮入口
- **用户空间**：每份聊天支持多个独立同构空间（默认空间 = 角色本人 `{{char}}`，自定义空间上限 6 个）；顶栏切换，管理页集中配置
- **按空间配置 AI 权限**：各空间独立配置「发送给 AI」（提示词基线注入）与「允许 AI 修改」（协议回写权限）
- **直接收发与发言防护**：任意空间支持联系人新增与会话/群聊/论坛发言；用户内容带只读标记（`c-`/`pm`/`pmg`/`pmc`/`owner`），禁止模型修改、伪造或删除；新回复未读提示
- **全功能直写**：记事玉册、芥子空间、坊市订单、论坛帖子支持 CRUD（两击删除 + 6 秒撤销）
- **本命玉牌**：六组字段（基本/仪容/修为/功法/羁绊/隐秘），支持功法与羁绊条目
- **天下舆图**：当前位置、近期行踪与已知地点名录，超窗条目通过世界书按需召回
- **交易坊市**：行情、拍卖、求购与订单同源展示
- **检索筛选**：列表与讯息详情支持纯内存关键词检索
- **增量同步（diff 协议）**：模型按 diff 语法（`+`/`-`）仅输出增量，未提及数据原样保留
- **注入预算控制**：基线窗口化 + 9000 字符上限；条目级活跃采样（用户内容保底注入，多空间均摊）
- **世界书分片存储与召回**：权威数据保存在世界书分片快照（`yz-snap-N`），本地镜像仅作启动缓存；历史消息进世界书关键词召回
- **版本迁移容灾**：检测到版本变化或封印调整时自动触发全量重写
- **可观测层**：同步诊断详情、卦位三态徽标（警示/未读/新）、功能封印与存档导入导出
- **多语言**：界面跟随宿主语言（中/EN），提示词语言可单独指定

## 安装

从发布产物导入 `.tpg` 包（当前版本 `yu-zhao-v3.0.0.tpg`）：
1. 打开 Tavo 的插件管理
2. 导入 `yu-zhao-v3.0.0.tpg`
3. 在玉兆设置中确认 `启用玉兆` 开关已打开

## 快速开始

1. 首次对话：模型会在本轮正文末尾输出 `<yz_jade>` 协议块，玉兆解析、校验并渲染到卦盘
2. 常规对话：模型只输出相对基线（`<yz_current>`）的变化行（diff），玉兆合并、评估后落盘
3. 点开卦位查看各功能数据；顶栏空间按钮进入「空间管理」新建/切换空间、配置 AI 读写；长按玉佩复位悬浮入口位置；「玉兆管理」页可封印（禁用）不需要的功能——省 token 的核心手段

## 数据协议（概要）

每轮生成末尾携带一个 `<yz_jade>` 块：

```
<yz_meta>   turn｜轮次ID｜角色名｜摘要｜模式(full/diff)｜空间路由 token(可选，缺省=默认空间 {{char}})
<yz_tablet> field｜分组｜字段名｜值        （本命玉牌）
<yz_msg>    contact/msg/group/gmsg        （交流讯息）
<yz_forum>  post/comment，post 行尾可选 owner 字段（player=玩家真实发帖，缺省=角色发帖）（天下论坛）
<yz_notes>  folder/note                   （记事玉册）
<yz_market> listing/auction/request/order   （交易坊市：行情/求购/拍卖/订单）
<yz_space>  currency/item                 （芥子空间）
<yz_map>    current/track/place           （天下舆图：当前位置/行踪/地点名录）
```

- 行格式：一行一条、`｜` 分字段；diff 轮以 `+`（upsert）/ `-`（删除，只给定位字段）前缀输出
- 客户端按分区评估"完整同步"（仅默认空间），未达标保留旧数据并回显 issue 要求补齐
- 基线按空间分组注入（`<yzc_*>` 容器带 `space="路由 token"`，默认空间不带属性）；token 可逆还原空间名，回写某空间需在 turn 行第 6 字段填同一 token；非默认空间只接受 diff 轮
- 协议块经双通道剥离（Hook 同步剥离 + 增量 DOM 扫描），不进正文与历史

完整协议与设计细节见 [DESIGN.md](DESIGN.md)。

## 设置

| 设置项 | 说明 |
| --- | --- |
| `启用玉兆` | 总开关，关闭后不再注入提示词、不解析协议块 |
| `自动隐藏数据块` | 自动清理正文中的玉兆协议块（推荐开启） |
| `提示词语言` | 中 / EN，决定注入提示词与生成内容的语言 |

## 开发

```
玉兆/
├── src/             开发源码（按职责拆分）
│   ├── core.js      Core / 状态模型
│   ├── protocol.js  协议解析
│   ├── i18n.js      多语言
│   ├── runtime.js   运行时 / 持久化
│   ├── prompt.js    提示词构建
│   ├── entry-hooks.js Hook 入口与共享桥
│   └── ui/          UI 源码
│       ├── jade.template.html HTML 宿主模板与样式系统
│       ├── views/   8 大卦位功能视图与太极八卦盘
│       └── app/     UI 状态机、导航、表单、FAB、Hook 桥与 DOM 剥离
├── scripts/build.mjs 构建脚本（生成 entry.js 与 ui/jade.html）
├── entry.js        Hook 入口与共享桥（生成物勿手改）
├── ui/jade.html    一体化 UI Fragment（生成物勿手改）
├── manifest.json   插件清单
├── locales/        中/英 i18n 字典
├── tests/smoke.mjs 冒烟测试（无外部依赖）
├── DESIGN.md       设计文档
├── CHANGELOG.md    变更记录
└── TODO.md         开发待办
```

### 冒烟测试

```bash
node scripts/build.mjs
node --check entry.js && node tests/smoke.mjs
```

日常修改 `src/` 下对应功能文件，不直接编辑生成的 `entry.js` 与 `ui/jade.html`。构建脚本打包 Hook 入口与 UI Fragment。可用 `node scripts/build.mjs --check` 检查产物是否与源码一致。

基线 **729 项全绿**，覆盖数据层（协议解析、diff 合并、评估矩阵、预算窗口、世界书归档、版本迁移、用户空间持久化安全等）与 UI 层（太极八卦盘八等分空心圆环形扇面与 8 卦位视图渲染、传音符对话流、记事/坊市/论坛/空间/舆图/管理交互、表单与真实发帖/传音/撤销、Hook 生命周期桥接等）。

### 发布门禁

1. `node scripts/build.mjs --check && node --check entry.js && node tests/smoke.mjs` 729 项全绿
2. Tavo MCP 环境执行 `tavo_plugin_validate_manifest` → `tavo_plugin_audit` → `tavo_plugin_package`
3. 真机回归（世界书归档挂接、太极八卦盘布局、空间切换/新建与跨空间收发）
4. `V=$(node -p "require('./manifest.json').version") && rm -f "../yu-zhao-v$V.tpg" && zip -r "../yu-zhao-v$V.tpg" manifest.json entry.js ui/jade.html locales cover.png`（版本号取自 manifest，先删旧包再压，保证干净归档）

## 版本

- 当前：**3.0.0**（已发布）；其后续累积修复见 CHANGELOG「未发布」段
- 完整变更记录见 [CHANGELOG.md](CHANGELOG.md)（最新版本在最前）
- 完整架构与协议设计见 [DESIGN.md](DESIGN.md)
