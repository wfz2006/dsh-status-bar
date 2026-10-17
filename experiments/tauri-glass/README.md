# Tauri 2 原生材质探针

用户拒绝 Electron 视觉效果后，按已采用的改进包进入 Gate B。此目录独立于生产入口，不访问 DSH、Bridge、凭据或用户对话。界面为当前 renderer 导出的四形态 **Mock 静态快照**；按钮没有业务行为，不是已迁移应用。

## 复现

在仓库根目录运行：

```powershell
pnpm build
node scripts/export-native-comparison.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File experiments/tauri-glass/build-local.ps1
node scripts/native-compositor-acceptance.mjs
```

构建锁定 Tauri 2.12.4，使用已有完整 MinGW，未改全局 Cargo 配置、PATH 或安装 SDK。Release 嵌入 UI 资源，不依赖开发服务器。现有默认 w64devkit 缺 libgcc_eh；本机 MSVC 编译器存在，但 Windows SDK 未就绪。GNU 路径在本机编译运行，不声称其等同于官方支持矩阵。

`GLASS_COMPARE_MATERIAL`：clear / acrylic / native-zero / native；`GLASS_COMPARE_MODE`：capsule / peek / expanded / approval。测试窗口固定尺寸，不支持移动到其他 DPI 后继续作为有效样本。参考测试环境：Windows 11 build 26300、150% DPI。创建窗口后将 HWND/scale 写入当前工作目录 `window.json`，测试分别使用临时目录。

`native.rs` 试图以 HostBackdropBrush 驱动 RGB 通道的独立二维变换，**不是完整 SDF 透镜**，也没有读取屏幕到 JS 或 CPU。系统实际以 HRESULT 0x80070057 拒绝：`Backdrop brushes cannot be transformed`。失败直接退出，不偷偷回退透明后声称成功。

透明、Acrylic 的截图成功仅表示采集完成。正式结论与下一条路线见 `../../reports/native-compositor/README.md`。
