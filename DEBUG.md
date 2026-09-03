# 真机调试（DEBUG）

> 真机为 Tavo 宿主安卓应用，通过 adb 与 Tavo MCP 双通道联调。本文只记录当前有效的调用方式与验证命令。

## 设备与通道

- **设备序列**：`900af430`
- **宿主包名**：`app.bitbear.tav`
- **插件 ID**：`com.shadowdumb.yu-zhao`
- **发布产物**：`../yu-zhao-v<VERSION>.tpg`（版本号取自 `manifest.json`，先删旧包再压）

### adb

```bash
adb devices
# 重启 Tavo（先强制停止，再经启动器拉起）
adb shell am force-stop app.bitbear.tav
adb shell monkey -p app.bitbear.tav -c android.intent.category.LAUNCHER 1
# 确认是否到前台（真实入口为 AudioServiceActivity，非 MainActivity）
adb shell dumpsys activity activities | grep -i "topResumedActivity"
# 推包安装（手动导入用）
adb push ../yu-zhao-v3.0.0.tpg /sdcard/Download/
```

### Tavo MCP

- 端点：`http://192.168.0.194:7347/mcp`
- 认证：`Authorization: Bearer yh9h6h`
- 协议：Streamable HTTP（JSON-RPC），仅接受 `POST`，需带 `Content-Type: application/json` 与 `Accept: application/json, text/event-stream`

```bash
# 初始化会话
curl -s -X POST http://192.168.0.194:7347/mcp \
  -H "Authorization: Bearer yh9h6h" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"opencode","version":"1.0.0"}}}'
```

## 调试流程

### 1. 构建与自检

```bash
node scripts/build.mjs
node scripts/build.mjs --check && node --check entry.js && node tests/smoke.mjs
```

日常只改 `src/` 下源码，绝不直接手改生成物 `entry.js` 与 `ui/jade.html`。构建脚本负责把 `src/ui/views/`、`src/ui/app/` 等装配进这两个产物。

### 2. 打包发布产物

```bash
V=$(node -p "require('./manifest.json').version")
rm -f "../yu-zhao-v$V.tpg"
zip -r "../yu-zhao-v$V.tpg" manifest.json entry.js ui/jade.html locales cover.png
```

### 3. 经 MCP 更新插件（推荐）

用 `tavo_plugin_install` 内联 `zipBase64` 推送整个 zip，无需手动导入。

- 先确认插件已存在：`tavo_plugin_search`（`query:"yu-zhao"`）
- 再推送安装：`tavo_plugin_install`（`arguments:{ zipBase64 }`）

为避免 shell 转义与体积问题，用 Python 构造请求：

```python
import json, base64, urllib.request
url = "http://192.168.0.194:7347/mcp"
token = "yh9h6h"
with open("/tmp/opencode/yu-zhao-install.zip", "rb") as f:
    zipb64 = base64.b64encode(f.read()).decode()
payload = {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
    "name":"tavo_plugin_install","arguments":{"zipBase64":zipb64}}}
req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={
    "Authorization":"Bearer "+token,
    "Content-Type":"application/json",
    "Accept":"application/json, text/event-stream"}, method="POST")
with urllib.request.urlopen(req, timeout=60) as resp:
    print(resp.read().decode())
```

成功返回 `ok: true`、`pluginId`、`version`、`enabled` 与 `installPath`。

### 4. 重启宿主生效

```bash
adb shell am force-stop app.bitbear.tav
adb shell monkey -p app.bitbear.tav -c android.intent.category.LAUNCHER 1
```

### 5. 验收

- 打开聊天页，确认玉兆卦盘悬浮入口可见；长按可复位、拖拽可移动
- 进入「玉兆管理」→ 同步诊断，核对协议解析与版本
- 验证本轮 UI 改动（例如卦位「新同步」呼吸高亮、悬浮窗水波纹按需显现）
- 关注正文末尾 `<yz_jade>` 协议块是否被剥离、数据是否按时落盘

## 常用 MCP 工具

- 查询：`tavo_current_chat_get`、`tavo_chat_get`、`tavo_message_find`
- 世界书：`tavo_lorebook_search` / `tavo_lorebook_get` / `tavo_lorebook_entry_upsert`
- 变量：`tavo_variable_list` / `tavo_variable_get`（玉兆存档持久化依赖）
- 插件：`tavo_plugin_search` / `tavo_plugin_get` / `tavo_plugin_install` / `tavo_plugin_get_runtime_contributions`
- 校验：`tavo_plugin_validate_manifest` / `tavo_plugin_audit` / `tavo_plugin_package`

完整能力见 `tavo_plugin_get_runtime_contributions` 与 MCP `tools/list`。
