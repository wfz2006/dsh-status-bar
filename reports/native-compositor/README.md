# 用户拒绝后的修正与原生对照

日期：2026-10-17。**旧材质Gate A失败，Gate B未证明Tauri更优。** 下文保留公开原生backdrop路线的失败证据。用户随后明确授权限定区域取样；此路线已实现并验证真实背景偏折与RGB分离，最新结果见 `../desktop-optics/README.md`，没有迁移正式技术栈。

## 已修正

- 删除整面蓝灰色 tint、渐变及覆盖伪元素。只保留中性细边缘；没有加壁纸或伪造窗后内容。
- 删除所有文字浅色阴影、描边，使用不透明中性文字，标题/胶囊加实到600字重。实色降级也改为中性灰。
- 保留紧凑四形态、固定审批操作区、原有权限和状态路由。未改官方DSH安装/Profile。

构建、lint、typecheck、31项单元测试通过；去染色/实字样式的实际Electron测试经历先失败后通过。完整Electron交互回归和250/320/340 DIP审批固定footer回归通过。没有把这些检查当作折射验收。

## 已执行的原生实验

独立 `experiments/tauri-glass`（该实验目录未入库），Tauri 2.12.4 Release；UI/CSS直接从当前Electron Mock渲染器导出，340×168 DIP、150%系统DPI。背景是测试拥有的独立原生窗口，黑白竖线用于排除壁纸色彩和观察偏折；没有采集其他应用。截图使用实际HWND物理矩形与遮挡检查。

| 对照 | 实机结果 | 能力结论 |
| --- | --- | --- |
| Tauri clear | `clear.png` | 线条直穿，没有折射/色散 |
| Tauri Acrylic | `acrylic.png` | 明显散射/灰色系统底，不能满足清透透镜目标 |
| HostBackdrop零位移RGB图 | `results.json` | API拒绝包含变换的backdrop输入 |
| HostBackdrop RGB不同位移图 | `results.json` | 同样被拒绝；没有有效光学截图 |

`comparison.png` 为旧Electron/去染色白边/Electron对应UI的Tauri透明对照，截图来自真实原生窗口。Mock进度的采样时点不同；Electron/Tauri请求相同340 DIP宽度，但本机原生取整分别为512/510物理px，保留原图、不拉伸对齐，不据此做布局/性能评分。

原生API错误为 HRESULT `0x80070057`：`Invalid argument to parameter value. Backdrop brushes cannot be transformed.` 先排除了效果名称重复与变换源共享问题后，仍得到此错误。失败图没有伪造成透明降级成功。

这证明**当前公开HostBackdrop变换路线不可用**，不代表已经穷尽所有Windows GPU技术。更换Tauri壳层没有自动得到液态玻璃，暂不迁移业务。

## 随后方案：用户已明确授权限定区域取样

真正的位移/色散着色器需要一份可取样的背景纹理。参考新标签页有自身壁纸纹理；桌面浮窗没有。下一候选方案：用户主动开启的本地限定区域取样 → GPU位移图与RGB采样 → 轻微散射 → 独立实色文字层。

具体约束：默认关闭；仅当前悬浮框覆盖区域及受限折射边距；排除悬浮框自身以避免递归；不保存图像、不上传、不写日志中的像素；关闭即停止；移动/缩放/DPI变化时重算范围；采样失效立即停用并明确回退。先验证受控测试窗口上的偏折、RGB分离、无递归、无越界与开销，再向真实桌面启用。受保护内容可能无法取样，需明确降级。

仓库 `AGENTS.md` 第1节第9条禁止“全局任意窗口抓取”。提出上述具体范围后，用户明确回复“允许限定区域取样，继续实现折射和色散”。随后才实现和运行受限后端；没有扩展到全屏采样、自动开启、保存或上传。实现与测试见 `../desktop-optics/README.md`。

参考：[Microsoft HostBackdrop API](https://learn.microsoft.com/en-us/uwp/api/windows.ui.composition.compositor.createhostbackdropbrush)、[Tauri配置](https://v2.tauri.app/reference/config/)。实际系统错误优先于从文档推测可行。
