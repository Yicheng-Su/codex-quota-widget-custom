# ChatGPT Quota Custom

一个面向 Windows Codex 桌面端的额度悬浮窗。此版本基于 [1nuYasha-cck/codex-quota-widget](https://github.com/1nuYasha-cck/codex-quota-widget) `v1.4.1` 修改，在保留本地额度读取的基础上，增加动态水面、可拖动悬浮球和安全的两段式“批准”输入。

## 主要功能

- 显示 5 小时与 7 天额度、重置时间、计划和今日 Token；Token 自动使用“万/亿”单位。
- 水桶与 52 px 悬浮球均带持续水面波动；拖动水面可产生波浪和水花，并触发一次额度刷新。
- 点击刷新按钮时，水面会同步产生一次波动。
- 隐藏后变成可拖动的桌面悬浮球，显示百分比和“5小时剩余/7天剩余”。
- “更多”菜单提供透明度、刷新间隔、批准等待时间和快捷键开关。
- 两段式批准操作：第一次输入固定文字“批准”，第二次发送；支持 `Ctrl+Alt+A`。
- 可通过配套入口同时启动 Codex 与挂件，并在 Codex 退出后关闭挂件。

## 下载与使用

从 [Releases](https://github.com/Yicheng-Su/codex-quota-widget-custom/releases) 下载 Windows x64 便携版 EXE，直接运行即可。

当前发布包未进行代码签名，Windows 可能显示未知发布者提示。请在确认下载来源与 SHA-256 后再运行。

### “批准”按钮的安全边界

该按钮不是系统权限窗口的直接批准接口。它只会在官方 Codex 桌面端处于前台、且焦点位于可编辑的提示词栏或批注框时输入固定文字“批准”。第二次操作只在同一目标和等待时间内发送；无有效焦点或目标变化时会拒绝执行。它不会读取或替换剪贴板内容。

## 开发与测试

```powershell
npm install
npm test
```

常规 Electron 便携包可运行：

```powershell
npm run build
```

本项目还包含 `scripts/build-custom-portable.ps1`，用于把修改后的应用打包进已提取的官方 `v1.4.1` Windows 运行时。该脚本需要 Windows、.NET Framework C# 编译器，以及本地可用的官方运行时目录：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-custom-portable.ps1 `
  -RuntimeSource "<official-runtime-directory>" `
  -Output "<output.exe>"
```

## 来源与许可证

本项目是 [原项目](https://github.com/1nuYasha-cck/codex-quota-widget) 的修改版本，并保留其 MIT 许可证及版权声明。详见 [LICENSE](LICENSE)。

本项目与 OpenAI 没有隶属或官方背书关系；“ChatGPT”“Codex”等名称归其各自权利人所有。
