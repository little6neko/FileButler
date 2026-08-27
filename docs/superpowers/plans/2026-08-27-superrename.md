# SuperRename 实施计划

**目标：** 在当前真实目录上提供 SuperRename 自动媒体整理功能：按一级子文件夹分别给直属图片和视频自然排序、动态补零重命名，把视频移入“视频”目录，并通过可取消勾选的树形预览、安全的组内事务执行及现有任务事件机制完成操作。

**架构：** 后端新增独立 `internal/superrename` 领域包，扫描器只产生可信文件系统清单，纯规划器根据勾选路径计算目标与冲突，执行器以一级子文件夹为事务边界完成暂存、提交和尽力回滚，自定义任务运行器接入现有 `jobs.Store` 与 SSE。前端新增与 Go 规则共享夹具的纯投影器，在勾选变化时只重算同组同媒体类型；精简模式以大弹窗承载，完整模式以新的多实例桌面窗口承载。创建任务时只提交源路径，服务端重新扫描和规划，不信任浏览器计算出的目标。

**技术栈：** Go、chi、React 19、TypeScript 6、Vitest、Testing Library、现有 Base UI/shadcn/Tailwind 组件、FileButler 窗口管理器、后台任务存储与 SSE。

**设计依据：** `docs/superpowers/specs/2026-08-27-superrename-design.md`

---

### 任务 1：建立领域类型、分类规则和跨端规划夹具

**文件：**

- 新建：`internal/superrename/types.go`
- 新建：`internal/superrename/media.go`
- 新建：`internal/superrename/media_test.go`
- 新建：`testdata/superrename/planner.json`
- 新建：`internal/superrename/fixtures_test.go`
- 新建：`web/src/superRename.ts`
- 新建：`web/src/superRename.test.ts`

- [ ] 先定义稳定的清单、候选项、未匹配项、视频目录状态、规划项、规划组和冲突类型；路径统一使用相对根目录的斜杠形式。
- [ ] 编写表驱动失败测试，确认图片后缀 `avif/bmp/gif/jpeg/jpg/png/svg/webp`、视频后缀 `m4v/mkv/mov/mp4/ogg/ogv/webm` 大小写不敏感，原后缀文本与大小写保留，未知后缀不匹配。
- [ ] 建立语言无关 JSON 夹具，覆盖自然排序、图片/视频独立编号、0/1/9/10/99/100/999/1000/9999/10000 项宽度、扩展名保留、局部取消和目标占用。
- [ ] 在 Go 与 TypeScript 中分别读取同一夹具，先让投影结果测试失败，再实现最小纯规则函数。
- [ ] 确认宽度固定为 `max(2, digits(selectedCount))`，图片名称为数字序列，视频名称为 `V` 加数字序列，未勾选项不占号。
- [ ] 运行 `gofmt`、`go test ./internal/superrename` 和 `npm test -- --run src/superRename.test.ts`。
- [ ] 提交为 `feat: define SuperRename planning rules`。

### 任务 2：实现非递归文件系统扫描器

**文件：**

- 新建：`internal/superrename/scanner.go`
- 新建：`internal/superrename/scanner_test.go`
- 修改：`internal/superrename/types.go`

- [ ] 先编写临时目录失败测试：当前目录直属文件被忽略；每个真实一级子目录形成一组；只扫描组内直属条目；更深目录作为不可展开未匹配叶子。
- [ ] 使用 `roots.Resolver.ResolveForWrite` 和 `Lstat` 验证当前目录与组目录，拒绝越界路径，且不跟随一级符号链接、组内符号链接或特殊文件。
- [ ] 对普通文件做媒体分类，并使用 `internal/natsort` 按原文件名稳定排序；同时记录组目录和已有“视频”目录中的所有直属名称作为占用集合。
- [ ] 区分“视频”路径不存在、为真实目录、为文件/符号链接/特殊条目三种状态；存在目录时不扫描其内容为候选，只收集冲突名称。
- [ ] 检测 `.filebutler-superrename-*` 暂存残留并把该组标记为阻塞，向预览暴露可人工恢复的信息。
- [ ] 覆盖空目录、无匹配组、大小写后缀、Unicode/括号文件名、权限错误和扫描期间条目消失。
- [ ] 运行 `gofmt`、`go test ./internal/superrename` 和 `go test -race ./internal/superrename`。
- [ ] 提交为 `feat: scan SuperRename media groups`。

### 任务 3：实现服务端权威规划与冲突检查

**文件：**

- 新建：`internal/superrename/planner.go`
- 新建：`internal/superrename/planner_test.go`
- 修改：`internal/superrename/types.go`
- 修改：`testdata/superrename/planner.json`
- 修改：`internal/superrename/fixtures_test.go`
- 修改：`web/src/superRename.ts`
- 修改：`web/src/superRename.test.ts`

- [ ] 先增加失败测试，验证默认全选、显式勾选集合、重复路径、非候选路径、跨根/跨组路径和空选择。
- [ ] 按“一级子文件夹 + 媒体类型”独立保留扫描器自然顺序，按该分区的勾选数量重算宽度和连续编号。
- [ ] 规划图片留在组目录，规划视频进入 `视频/`；相同源目标标记为无需移动但仍计入任务项和编号。
- [ ] 先生成同组全部目标，再判定占用：目标不存在或等于自身可用；由另一个已勾选且将迁出的源占用可用；未勾选源、未匹配条目、既有视频内容和阻塞“视频”路径均冲突。
- [ ] 检测目标之间的重复、大小写敏感文件系统下的精确冲突和暂存残留；只要一个已勾选项冲突，该次提交不可执行。
- [ ] 让 Go 权威规划器与 TypeScript 本地投影器继续通过同一夹具，并增加“取消一项只改变同组同类型”的 TypeScript 单元测试。
- [ ] 运行 `gofmt`、`go test ./internal/superrename` 和 `npm test -- --run src/superRename.test.ts`。
- [ ] 提交为 `feat: plan SuperRename operations`。

### 任务 4：实现组内暂存、提交与回滚执行器

**文件：**

- 新建：`internal/superrename/executor.go`
- 新建：`internal/superrename/executor_test.go`
- 新建：`internal/superrename/manifest.go`
- 修改：`internal/superrename/types.go`

- [ ] 为文件操作定义最小可注入边界，先编写真实临时目录集成测试和故障注入测试，不把通用 `ops` 的扁平执行器强行用于组事务。
- [ ] 执行前逐项复核源和目标状态；在组目录内创建唯一 `.filebutler-superrename-<job>-*` 暂存目录，并原子写入含源、暂存、目标和阶段的 JSON 清单。
- [ ] 将本组所有需要变化的源先移入暂存目录，再按需创建“视频”目录，最后逐项移到目标；同一文件系统内使用重命名保证换名环和互换安全。
- [ ] 已有“视频”目录只复用；本次新建目录仅在回滚后为空时删除；任何情况下都不删除既有目录及其内容。
- [ ] 成功后删除清单与暂存目录；测试纯重命名、图片/视频混合、换名环、已有视频目录、无需变化项和 300+ 文件。
- [ ] 在暂存、建目录和逐项提交的每个故障点测试尽力回滚：先把已提交目标退回各自暂存位，再把所有暂存源恢复原路径，避免恢复顺序制造二次覆盖。
- [ ] 回滚不完整时保留清单和暂存目录并返回明确恢复错误；后续扫描必须把该组标红并阻止再次执行。
- [ ] 运行 `gofmt`、`go test ./internal/superrename` 和 `go test -race ./internal/superrename`。
- [ ] 提交为 `feat: execute transactional SuperRename groups`。

### 任务 5：接入后台任务、受保护 API 与服务装配

**文件：**

- 新建：`internal/superrename/runner.go`
- 新建：`internal/superrename/runner_test.go`
- 新建：`internal/superrename/handlers.go`
- 新建：`internal/superrename/handlers_test.go`
- 修改：`internal/jobs/types.go`
- 修改：`internal/web/router.go`
- 修改：`internal/web/router_test.go`
- 修改：`cmd/filebutler/main.go`

- [ ] 先增加自定义运行器失败测试：创建一个 `super_rename` 任务，任务总数等于已勾选文件数，组成功逐项累计，组失败将该组项标为失败后继续其他组。
- [ ] 只在组与组之间检查取消请求；当前组开始后完成提交或回滚，再把任务置为 `cancelled`、`completed` 或 `completed_with_errors`。
- [ ] 实现 `POST /api/super-rename/preview`，只接收 `rootId` 与 `directoryPath`，返回扫描清单；认证、JSON 限制和错误结构沿用现有 API。
- [ ] 实现 `POST /api/super-rename/jobs`，只接收根、目录和 `selectedPaths`；服务端重新扫描和规划，绝不接受前端目标名称。
- [ ] 将扫描变化、非法勾选和目标冲突稳定映射为 `409`，且不创建任务；成功时先写入 Store 再异步运行，返回任务快照。
- [ ] 增加未认证、虚拟根、越界、目录不存在、预览成功、任务成功、冲突、过期和任务事件终态的 HTTP 测试。
- [ ] 在路由依赖和 `main.go` 中装配共享扫描器、规划器、执行器与运行器，不影响现有 ops/rename runner。
- [ ] 运行 `gofmt`、`go test ./internal/superrename ./internal/web ./internal/jobs ./cmd/filebutler` 和 `go test ./...`。
- [ ] 提交为 `feat: expose SuperRename jobs API`。

### 任务 6：接入前端 API、预览状态和局部投影模型

**文件：**

- 修改：`web/src/api/types.ts`
- 修改：`web/src/api/client.ts`
- 修改：`web/src/api/client.test.ts`
- 修改：`web/src/superRename.ts`
- 修改：`web/src/superRename.test.ts`
- 新建：`web/src/superRenameManager.ts`
- 新建：`web/src/superRenameManager.test.ts`

- [ ] 定义与后端 JSON 契约一致的清单、候选、未匹配、冲突、视频目录和任务创建类型；增加预览与创建任务客户端方法。
- [ ] 测试请求方法、路径编码、请求体只含允许字段、认证错误和 `409` 错误码保留。
- [ ] 完成本地树投影：全选默认值、文件夹三态、单项/整组勾选、未匹配禁用、无匹配组折叠、目标与状态文本。
- [ ] 让一次勾选变化只重新投影目标组的目标媒体分区；未勾选行保留、目标显示为空、状态显示取消，其他分区引用和值保持稳定。
- [ ] 建立可跨挂载保留的实例管理器，持有固定 `rootId + directoryPath`、清单、选择、展开状态、加载/刷新/提交状态和错误；高频局部选择不进入 `FileWorkspace` 的全局状态。
- [ ] 刷新成功时保留仍存在路径的勾选与展开状态，新出现媒体默认勾选，消失项删除；刷新失败保留旧预览；旧异步响应不能覆盖新请求。
- [ ] 提交时由管理器从当前选择生成 `selectedPaths`；`409` 时保留窗口、自动刷新清单并要求再次确认，不自动重试执行。
- [ ] 运行 `npm test -- --run src/api/client.test.ts src/superRename.test.ts src/superRenameManager.test.ts`。
- [ ] 提交为 `feat: add SuperRename preview model`。

### 任务 7：实现树形预览内容与精简模式弹窗

**文件：**

- 新建：`web/src/components/SuperRenameTree.tsx`
- 新建：`web/src/components/SuperRenameTree.test.tsx`
- 新建：`web/src/components/SuperRenameContent.tsx`
- 新建：`web/src/components/SuperRenameContent.test.tsx`
- 新建：`web/src/components/SuperRenameDialog.tsx`
- 新建：`web/src/components/SuperRenameDialog.test.tsx`
- 修改：`web/src/i18n.ts`
- 修改：`web/src/i18n.test.ts`
- 修改：`web/src/styles.css`

- [ ] 先编写组件失败测试，渲染统一树表 A：`当前项目 / 计划结果 / 状态` 三列、一级组行、图片/视频项、合成“视频（将创建）”行和不可展开的深层目录叶子。
- [ ] 实现文件夹三态复选框、单项复选框和展开/折叠；组有匹配默认展开，无匹配默认折叠，未匹配项禁用且不进入选择数。
- [ ] 验证取消一个图片后只重排该组图片，视频与其他组 DOM 结果不变；取消组后整组匹配项变灰，再次勾选恢复连续编号。
- [ ] 用蓝/绿表示正常规划、橙色表示不匹配、红色表示冲突或残留、灰色表示取消；颜色之外同时提供文字和图标语义。
- [ ] 实现顶部统计、刷新、错误提示和执行按钮；无选择或有已选择冲突时禁用执行；加载、刷新和提交状态具有可访问名称。
- [ ] 将内容做成不依赖 Dialog/WindowFrame 的受控复用组件；精简模式只增加大尺寸模态包装，关闭时释放其独占实例。
- [ ] 增加中文、英文文案和 i18n 完整性测试；窗口缩小时树表双向滚动且标题、统计和按钮保持可见。
- [ ] 运行 `npm test -- --run src/components/SuperRenameTree.test.tsx src/components/SuperRenameContent.test.tsx src/components/SuperRenameDialog.test.tsx src/i18n.test.ts`、`npm run lint` 和 `npm run build`。
- [ ] 提交为 `feat: add SuperRename preview interface`。

### 任务 8：增加操作入口和独立桌面窗口

**文件：**

- 修改：`web/src/components/fileActions.ts`
- 修改：`web/src/components/fileActions.test.ts`
- 修改：`web/src/components/ActionToolbar.tsx`
- 修改：`web/src/components/ActionToolbar.test.tsx`
- 修改：`web/src/components/PaneContextMenu.tsx`
- 修改：`web/src/components/PaneContextMenu.test.tsx`
- 修改：`web/src/windowManager.ts`
- 修改：`web/src/windowManager.test.ts`
- 修改：`web/src/components/WorkspaceShell.tsx`
- 修改：`web/src/components/WorkspaceShell.test.tsx`
- 修改：`web/src/components/WindowFrame.tsx`
- 修改：`web/src/styles.css`

- [ ] 新增 `superRename` 操作，工具栏顺序紧跟 PowerRename；真实目录无论是否选中文件都启用，虚拟“所有位置”禁用。
- [ ] 完整模式上下文菜单显示同一入口，但始终捕获当前窗口目录，不把右键文件或目录作为扫描范围；精简模式调用页面级弹窗。
- [ ] 扩展桌面窗口判别联合类型和最小尺寸，增加 `openSuperRenameWindow`；业务预览状态仍由实例管理器持有，不塞入几何记录。
- [ ] 测试 file、powerRename、mediaPreview、textEditor、superRename 五类窗口的打开、聚焦、MRU、移动、缩放、最大化、最小化和恢复。
- [ ] 任务栏为每个 SuperRename 实例显示独立项目和固定目录标题；允许同目录打开多个实例，彼此选择、展开和请求代次隔离。
- [ ] 保证 SuperRename 窗口有独立层级、任务栏项和关闭按钮，且移动/缩放行为沿用 `WindowFrame`。
- [ ] 运行相关 fileActions、ActionToolbar、PaneContextMenu、windowManager 和 WorkspaceShell 测试。
- [ ] 提交为 `feat: add SuperRename launch and windows`。

### 任务 9：接入工作区生命周期、任务事件和终态刷新

**文件：**

- 修改：`web/src/components/FileWorkspace.tsx`
- 修改：`web/src/components/FileWorkspace.test.tsx`
- 新建：`web/src/components/SuperRenameWorkspace.test.tsx`
- 修改：`web/src/components/WorkspaceShell.tsx`
- 修改：`web/src/styles.css`

- [ ] 在工作区增加最薄的 SuperRename 实例注册表和窗口映射；打开时捕获来源窗口当时的 `rootId + directoryPath`，后续导航、选择或关闭来源窗口都不改变它。
- [ ] 精简模式打开模态，完整模式原子创建实例与聚焦窗口；模式切换隐藏但不销毁完整模式窗口，返回后恢复几何、预览、勾选和展开状态。
- [ ] 活动 SuperRename 窗口不产生 active file session，不接收复制、剪切、粘贴、拖放或文件快捷键；后台文件窗口状态不得被误用。
- [ ] 提交锁位于实例管理器，最小化、切换模式或内容暂时卸载期间不能重复创建任务；成功后只关闭对应实例并登记返回任务 ID。
- [ ] 通过现有 SSE 观察 `super_rename` 任务；任务进行中不刷新文件栏，终态到达后立即刷新所有正在显示受影响目录的文件会话。
- [ ] 后端部分组失败时任务面板显示 `completed_with_errors` 与项目错误，窗口提交成功后不重复弹出；SSE 断线重连行为沿用现有事件存储。
- [ ] 测试来源快照隔离、多实例、提交期间最小化、模式往返、无活动文件会话、任务终态刷新和重复事件去重。
- [ ] 运行 `npm test -- --run src/components/SuperRenameWorkspace.test.tsx src/components/FileWorkspace.test.tsx src/components/WorkspaceShell.test.tsx src/components/JobEventsProvider.test.tsx`。
- [ ] 提交为 `feat: integrate SuperRename workspace lifecycle`。

### 任务 10：全量验证与 300 项真实服务验收

**文件：**

- 验证：`internal/superrename/*`
- 验证：`internal/web/*`
- 验证：`internal/jobs/*`
- 验证：`web/src/superRename*`
- 验证：`web/src/components/SuperRename*`
- 验证：`web/src/components/FileWorkspace.tsx`
- 验证：`web/src/windowManager.ts`

- [ ] 运行 `gofmt` 覆盖所有新增和修改 Go 文件，再运行 `go test ./...` 与 `go test -race ./internal/superrename ./internal/web ./internal/jobs`。
- [ ] 从 `web/` 运行 `npm test -- --run`、`npm run lint` 和 `npm run build`。
- [ ] 运行 `git diff --check`，检查新增 API 没有接受客户端目标路径，扫描没有递归或跟随符号链接，执行没有复用不适合的扁平 runner。
- [ ] 创建至少 300 个混合测试条目，覆盖多个一级子文件夹、两位/三位/四位补零、图片与视频混合、已有视频目录、未知文件、深层目录、Unicode/括号名称、取消项和可迁出目标占用。
- [ ] 启动监听 `0.0.0.0` 的临时服务，在精简弹窗和多个完整模式窗口中检查预览、局部重排、移动/缩放/最小化/恢复、提交锁和任务面板。
- [ ] 实际执行测试任务，确认进行中不刷新、终态立即刷新、所有选中项命名正确、未选中及未匹配项不变、既有视频内容不变。
- [ ] 人为制造冲突、扫描过期和组内故障，确认 `409` 刷新后需再次确认、其他组继续、失败组恢复且不丢文件；模拟回滚失败时确认残留清单阻止再次执行。
- [ ] 关闭临时服务并删除测试目录，确认没有测试进程、构建产物或临时媒体进入提交。
- [ ] 检查提交历史和工作区，只保留 SuperRename 相关变更并向用户报告验证结果；除非用户另行要求，不推送远端。
