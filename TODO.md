# 玉兆 开发待办（TODO）

> 本文件只记录未完成工作。已完成工作见 CHANGELOG.md。

## 待办项

- [ ] 玉牌(乾)「暂无刻录」空态：确认默认空间是否需预置演示字段。
- [ ] 真实 DOM 与交互回归：验证联系人/群聊删除、搜索输入、二次确认、撤销、表单提交与焦点恢复。
- [ ] 移动端视口与无障碍回归：验证窄屏适配、软键盘遮挡、触屏手势与屏幕阅读器标签。
- [ ] 异常与边界场景模拟：验证存储配额超限、跨标签页并发冲突、重载后异步生成结果处理。

## 远期规划

- [ ] 天下论坛跨玩家社区功能。

## 开发门禁

- 冒烟门禁：`node scripts/build.mjs --check && node --check entry.js && node tests/smoke.mjs`
- 发布门禁：MCP `tavo_plugin_validate` → `tavo_plugin_audit` → `tavo_plugin_package`
