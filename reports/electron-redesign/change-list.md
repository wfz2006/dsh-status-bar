# 本轮修改清单（E2–E4）

- renderer/style.css：清掉正常标题/速览/任务行的填充卡片；单薄透主表面，光学边缘与随字形对比保护。只保留条件出现的审批提示浅胶囊。
- renderer/task-views.tsx：胶囊始终保留任务标题，有请求才附数量；离线仍显示异常，不用Mock状态冒充真实任务。
- renderer/approval-card.tsx：固定header、请求选择、独立滚动body、固定footer。每次只处理一个稳定 Session/request 身份；多请求保持在队列内，切换时重置详情滚动。复制反馈也绑定原请求。决策始终禁用。
- renderer/main.tsx：收起期间保留上一形态用于退场，根玻璃/原生窗口持续存在；设置控件立即反馈，IPC失败时读取实际状态回退。
- main/presentation.ts：替换动画时 stop(false) 不发布错误idle中间态；收起先80ms内容退场，再260ms原生bounds变化；减少动画立即切换。
- main/window-controller、shared/view-model、renderer/settings：推荐薄透默认值，显式Acrylic对照/实色，不修改Bridge及协议。保留手动尺寸与菜单/托盘入口。
- mock adapter/API/main：长命令只读夹具，用于真实窗口滚动验证；不会运行命令。
- scripts：原生基线/材质矩阵、固定footer、应用缩放矩阵、原生录屏、长时资源采样。

保留了 `packages/protocol`、Bridge 鉴权、请求语义和 DSH Profile。没有添加审批提交/自动允许通道。settings/activities 内的辅助背景不作为常规任务卡片使用。
