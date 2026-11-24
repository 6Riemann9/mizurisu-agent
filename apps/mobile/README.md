# Mizurisu Agent Mobile（Android / iOS）

移动端壳基于 **Capacitor 8**，直接打包 `packages/app/dist`，并默认启用 `CapacitorHttp` 以免跨域直连 Mizurisu / New-API 中转站。

## 首次生成原生工程与同步构建

```bash
# 1. 在仓库根目录构建前端并同步资源
pnpm sync:mobile

# 2. 首次添加 Android / iOS 原生目录（在 apps/mobile 下执行）
pnpm --filter @mizurisu-agent/mobile add:android
# macOS 可选：
pnpm --filter @mizurisu-agent/mobile add:ios

# 3. 打开 Android Studio / Xcode 编译打包 APK / IPA
pnpm --filter @mizurisu-agent/mobile open:android
```

## 注意事项
- 如修改了 `packages/app` 界面或 Office 引擎代码，重新执行根目录 `pnpm sync:mobile` 即可更新移动端资源。
- 导出 Word / Excel / PPT / PDF 时会自动调用系统原生分享面板（可一键发送至微信、WPS 或系统文件管理器）。
