# 完整模式文件窗口内子弹窗实施计划

**目标：** 将完整模式的新建文件夹、普通重命名、复制、移动和删除确认改为所属文件窗口内的局部子弹窗，同时保留精简模式现有页面级弹窗。

**架构：** 使用独立纯状态模块按 `windowId` 保存至多一个带唯一 `dialogId` 的子弹窗快照；把三个现有页面级弹窗拆为可复用业务内容和容器；完整模式由 `WindowFrame` 内的局部弹窗层渲染，精简模式继续由 Base UI `Dialog` 渲染。粘贴和拖放显式携带目标窗口 ID，提交回调按 `dialogId` 防止旧响应影响新实例。

**技术栈：** React 19、TypeScript 6、Vitest、Testing Library、Base UI/shadcn、Tailwind CSS、dnd-kit，以及现有 FileButler 任务事件存储。

**设计依据：** `docs/superpowers/specs/2026-08-23-window-local-file-dialogs-design.md`

---

### 任务 1：建立局部子弹窗纯状态模型

**文件：**

- 新建：`web/src/windowDialogs.ts`
- 新建：`web/src/windowDialogs.test.ts`

- [ ] 先编写失败测试，覆盖 mkdir、singleRename、operation 三种快照记录。
- [ ] 测试同一 `windowId` 已有弹窗时，第二次打开保持原记录而不是替换。
- [ ] 测试按 `windowId + dialogId` 关闭：旧 ID 不能删除后来打开的新记录。
- [ ] 测试按窗口清理与全部清理保持其他窗口记录不变。
- [ ] 实现带判别类型的 `WindowDialogState`、`WindowDialogs` 及打开、匹配关闭、窗口清理、全部清理纯函数。
- [ ] 保持该模块不依赖 React、DOM 或窗口管理器，业务快照只引用现有 API/条目类型。
- [ ] 在 `web/` 运行 `npm test -- --run src/windowDialogs.test.ts`。
- [ ] 提交为 `feat: add window dialog state model`。

### 任务 2：提取可复用的普通弹窗内容

**文件：**

- 修改：`web/src/components/MkdirDialog.tsx`
- 修改：`web/src/components/MkdirDialog.test.tsx`
- 修改：`web/src/components/SingleRenameDialog.tsx`
- 修改：`web/src/components/SingleRenameDialog.test.tsx`
- 修改：`web/src/components/OperationPreview.tsx`
- 修改：`web/src/components/OperationPreview.test.tsx`

- [ ] 先增加失败测试，证明三种内容组件无需 Base UI Portal 也能渲染和提交。
- [ ] 将新建文件夹拆成中性的 `MkdirContent` 与保留原公开 API 的 `MkdirDialog` 页面包装。
- [ ] 将普通重命名拆成 `SingleRenameContent` 与 `SingleRenameDialog`；内容层通过异步 `onSubmit(newName)` 回调提交，页面包装继续调用现有 API 并上报任务 ID。
- [ ] 将操作预览拆成 `OperationPreviewContent` 与 `OperationPreview`；内容层继续维护 dry-run、操作类型切换、冲突和提交错误，通过异步 `onSubmit(activeRequest)` 回调创建任务。
- [ ] 使用中性 HTML 标题、说明和操作区，避免可复用内容依赖 Base UI Dialog 上下文；页面包装仍提供正确的 Dialog 标题关联。
- [ ] 保留现有自动聚焦、文件扩展名选择、Enter 确认、忙碌锁、冲突禁用、乱序预览保护和本地化行为。
- [ ] 把操作预览表格调整为单一、可识别的滚动视口，为后续父窗口宽高约束提供稳定 DOM 边界。
- [ ] 运行 `npm test -- --run src/components/MkdirDialog.test.tsx src/components/SingleRenameDialog.test.tsx src/components/OperationPreview.test.tsx`。
- [ ] 提交为 `refactor: extract reusable file dialog content`。

### 任务 3：新增 WindowFrame 局部弹窗层

**文件：**

- 新建：`web/src/components/WindowDialogLayer.tsx`
- 新建：`web/src/components/WindowDialogLayer.test.tsx`
- 修改：`web/src/components/WindowFrame.tsx`
- 修改：`web/src/styles.css`

- [ ] 先编写失败测试，验证局部层具有命名的 `role="dialog"`、不声明全局 `aria-modal="true"`、打开时获得焦点，并支持 Escape 关闭。
- [ ] 测试点击遮罩关闭、点击面板不关闭，以及 Tab/Shift+Tab 只在当前面板可聚焦元素之间循环。
- [ ] 实现 `WindowDialogLayer`，由内容区尺寸约束、遮罩和居中面板组成，不使用页面级 Portal 或全局 inert。
- [ ] 给 `WindowFrame` 增加可选局部弹窗节点，并把它渲染在 `.desktop-window-content` 内、普通内容之上。
- [ ] 调整层级：遮罩不覆盖标题栏，八方向缩放手柄高于遮罩；父窗口 `onPointerDown` 仍能正常聚焦。
- [ ] 添加简单输入面板与文件操作预览面板的局部尺寸变体；宽高不得超过父内容区，并保留最小边距。
- [ ] 为操作预览主体设置 `min-width: 0`、`min-height: 0` 和双轴 `overflow: auto`；路径单元格保持单行，内部表格可以大于视口。
- [ ] 在 `web/` 运行 `npm test -- --run src/components/WindowDialogLayer.test.tsx`。
- [ ] 提交为 `feat: add window-local dialog layer`。

### 任务 4：接入来源窗口的新建、重命名和删除弹窗

**文件：**

- 修改：`web/src/components/FileWorkspace.tsx`
- 修改：`web/src/components/FileWorkspace.test.tsx`

- [ ] 先增加完整模式失败测试：两个文件窗口可同时打开各自普通重命名，同一窗口不能叠加，且任务栏按钮数量不增加。
- [ ] 增加测试验证新建文件夹、重命名和删除记录归属命令来源 `windowId`，并保存打开时的路径、名称、类型和有序选择快照。
- [ ] 在 `FileWorkspace` 增加 `windowDialogs` 状态、同步 ref、唯一 ID 计数器及纯状态提交入口。
- [ ] 让完整模式文件工具栏和右键操作同时携带 `windowId`、`sessionId`；精简模式继续使用原有页面级状态。
- [ ] 在每个文件 `WindowFrame` 中按记录类型渲染 `MkdirContent`、`SingleRenameContent` 或 `OperationPreviewContent`。
- [ ] 抽取按 `windowId + dialogId` 提交的异步协调器：成功时只关闭匹配记录并注册任务；记录仍存在的失败向内容层抛回；记录已消失的失败改用全局 toast。
- [ ] 保留任务创建后的现有选择清理、任务事件注册和目录刷新行为。
- [ ] 运行 `npm test -- --run src/components/FileWorkspace.test.tsx` 以及任务 2 的三个弹窗测试文件。
- [ ] 提交为 `feat: add local file action dialogs`。

### 任务 5：接入目标窗口的粘贴和拖放预览

**文件：**

- 修改：`web/src/fileDrag.ts`
- 修改：`web/src/fileDrag.test.ts`
- 修改：`web/src/components/FilePane.tsx`
- 修改：`web/src/components/FileRow.tsx`
- 修改：`web/src/components/VirtualRootView.tsx`
- 修改：`web/src/components/FilePane.test.tsx`
- 修改：`web/src/components/VirtualRootView.test.tsx`
- 修改：`web/src/components/FileWorkspace.tsx`
- 修改：`web/src/components/FileWorkspace.test.tsx`

- [ ] 先增加失败测试，验证完整模式键盘粘贴与右键粘贴在目标窗口打开固定复制或移动预览。
- [ ] 增加跨窗口拖放测试，验证预览归属释放鼠标时的目标窗口，并保留移动/复制切换按钮。
- [ ] 给 `FileDropData` 增加可选 `windowId`，由完整模式 `FilePane`、目录行和 `VirtualRootView` 根卡片写入；精简模式不写入。
- [ ] 让 `pasteClipboard` 显式接收可选目标窗口 ID：完整模式写入局部记录，精简模式继续写入页面级 `previewState`。
- [ ] 让拖放结束根据目标 `windowId` 分派局部或页面级预览，不改变现有请求构造、默认操作和无效目标提示。
- [ ] 给 `FilePane`、`FileRow` 和 `VirtualRootView` 增加局部弹窗存在时的 drop-disabled 输入，禁用内容区、目录行和根卡片 droppable，防止碰撞检测穿透遮罩。
- [ ] 验证剪切板仅在移动任务创建成功后清空；取消、预览失败或任务创建失败都保留剪切板。
- [ ] 运行 `npm test -- --run src/fileDrag.test.ts src/components/FilePane.test.tsx src/components/VirtualRootView.test.tsx src/components/FileWorkspace.test.tsx`。
- [ ] 提交为 `feat: localize clipboard and drag previews`。

### 任务 6：收口生命周期、快捷键与陈旧响应

**文件：**

- 修改：`web/src/components/FileWorkspace.tsx`
- 修改：`web/src/components/FileWorkspace.test.tsx`
- 修改：`web/src/components/WindowDialogLayer.test.tsx`

- [ ] 先增加失败测试，验证聚焦其他窗口保留子弹窗，而父窗口最小化、通过任务栏最小化、关闭或切换精简模式会清除相应记录。
- [ ] 测试父窗口最大化、恢复、移动和缩放不清除记录。
- [ ] 用统一的 `minimizeDesktopWindow`、`closeDesktopWindow` 和模式切换入口执行局部弹窗清理，避免标题栏与任务栏路径行为不一致。
- [ ] 将页面级快捷键阻止条件从“页面中存在任意 role=dialog”改为“存在页面级 Dialog，或当前活动文件窗口拥有局部子弹窗”。
- [ ] 测试非活动窗口拥有子弹窗时，当前活动无弹窗窗口仍可复制/剪切/粘贴；输入框原生快捷键保持不变。
- [ ] 增加受控 Promise 测试：旧弹窗提交后关闭并打开新弹窗，旧成功响应注册任务但不关闭新弹窗，旧失败响应只显示全局错误。
- [ ] 验证 Escape 和遮罩关闭提交中的界面后，请求仍只结算一次且不会更新新实例。
- [ ] 运行 `npm test -- --run src/components/FileWorkspace.test.tsx src/components/WindowDialogLayer.test.tsx`。
- [ ] 提交为 `fix: isolate window dialog lifecycle`。

### 任务 7：完整验证与浏览器验收

**文件：**

- 验证：`web/src/windowDialogs.ts`
- 验证：`web/src/components/WindowDialogLayer.tsx`
- 验证：`web/src/components/WindowFrame.tsx`
- 验证：`web/src/components/MkdirDialog.tsx`
- 验证：`web/src/components/SingleRenameDialog.tsx`
- 验证：`web/src/components/OperationPreview.tsx`
- 验证：`web/src/components/FileWorkspace.tsx`
- 验证：`web/src/components/FilePane.tsx`
- 验证：`web/src/components/FileRow.tsx`
- 验证：`web/src/components/VirtualRootView.tsx`
- 验证：`web/src/styles.css`

- [ ] 在 `web/` 运行 `npm test -- --run`。
- [ ] 在 `web/` 运行 `npm run lint`。
- [ ] 在 `web/` 运行 `npm run build`，更新当前测试服务使用的 `web/dist`。
- [ ] 在仓库根目录运行 `go test ./...`。
- [ ] 运行 `git diff --check`，确认工作树没有无关改动。
- [ ] 在真实浏览器打开当前 `0.0.0.0` 测试服务，验证两个文件窗口可同时显示重命名弹窗且没有新增任务栏按钮。
- [ ] 移动、八方向缩放、最大化父窗口，确认弹窗始终在内容区居中，标题栏控制不被遮挡。
- [ ] 把父窗口缩到允许的最小尺寸，并用超长来源/目标目录检查面板不越界、表格可横向和纵向滚动、标题与底部按钮保持可见。
- [ ] 实测 Ctrl/Cmd+V、右键粘贴、根卡片粘贴和跨窗口拖放都在目标窗口显示确认框。
- [ ] 实测最小化、父窗口关闭、完整/精简模式切换、提交后立即关闭界面及任务侧栏更新。
- [ ] 报告测试 URL、验证结果、最终提交列表和任何剩余限制。
