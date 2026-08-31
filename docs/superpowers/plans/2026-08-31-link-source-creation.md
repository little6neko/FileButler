# 连接源与链接创建实施计划

**目标：** 为 FileButler 增加“选择源连接点，再在目标位置创建为硬链接或软链接”的完整工作流；普通文件使用真实硬链接，文件夹使用逐顶层原子提交的硬链接克隆，软链接采用相对路径优先，并让映射根内的文件/文件夹软链接可以安全打开。

**架构：** 先把根路径解析拆成“跟随目标、操作目录项本身、创建新目录项、反向映射绝对路径”四种明确语义，并让浏览接口返回安全的软链接解析结果。后端新增独立 `internal/links` 领域包，负责权威扫描、文件身份、稳定 preview revision、链接规划、组内暂存执行和专用任务运行；前端增加页面级 `LinkSource`、可访问二级右键菜单及独立链接预览。现有紧凑模式快捷按钮最后迁移到同一 API，通用 `internal/ops` 再移除旧链接分支。

**技术栈：** Go 1.26、chi、`os.Link`、`os.Symlink`、平台文件身份辅助、React 19、TypeScript 6、Base UI Context Menu、Vitest、Testing Library、现有内存任务中心与 SSE。

**设计依据：** `docs/superpowers/specs/2026-08-31-link-source-creation-design.md`

---

### 任务 1：建立映射根安全路径解析语义

**文件：**

- 修改：`internal/roots/roots.go`
- 修改：`internal/roots/roots_test.go`
- 新建：`internal/roots/mapped.go`
- 新建：`internal/roots/mapped_test.go`

- [ ] 先编写失败测试，固定四个入口的职责：`ResolveFollow` 跟随完整路径并返回实际映射根；`ResolveEntry` 只跟随父目录、不跟随最终目录项；`ResolveCreate` 要求目标父目录真实存在且最终项可新建；`MapPath` 把绝对/规范路径映射到包含关系最具体的根。
- [ ] 为返回值分别记录用户请求的根/相对路径与实际映射的根/相对路径；调用者不能再把词法路径误当成已经验证的规范路径。
- [ ] 实现逐段软链接解析，而不是对不受信路径直接调用一次完整 `EvalSymlinks`；每次展开相对或绝对链接后，必须先确认下一段仍属于某个映射根，再继续访问文件系统。
- [ ] 为软链接链设置确定的最大展开次数并返回可判别的 `ErrSymlinkLoop`；区分 `ErrOutsideRoot`、不存在、权限错误和循环，供浏览接口生成三态元数据。
- [ ] 对配置根本身求规范路径；多个词法根映射到重叠规范目录时，以规范路径最长者为目标根，长度相同再按根 ID 稳定排序。
- [ ] 覆盖根内相对链接、跨已映射根链接、绝对链接、链式链接、损坏链接、循环、词法规范化后仍在映射根内的 `..`、未存在目标、目标父目录为链接和 Unicode/括号路径。
- [ ] 增加测试钩子或受控临时目录，证明解析一旦离开全部映射根就停止，不探测根外目标是否存在。
- [ ] 保留现有 `Resolve` 作为纯词法规范化辅助；暂时保留 `ResolveForWrite` 供下一任务迁移，但新增代码不得再调用它。
- [ ] 运行 `gofmt`、`go test ./internal/roots` 和 `go test -race ./internal/roots`。
- [ ] 提交为 `feat: add mapped symlink path resolution`。

### 任务 2：迁移现有文件操作并返回软链接解析元数据

**文件：**

- 修改：`internal/browser/browser.go`
- 修改：`internal/browser/browser_test.go`
- 修改：`internal/ops/planner.go`
- 修改：`internal/ops/planner_test.go`
- 修改：`internal/ops/executor.go`
- 修改：`internal/ops/executor_test.go`
- 修改：`internal/rename/handlers.go`
- 修改：`internal/rename/handlers_test.go`
- 修改：`internal/superrename/scanner.go`
- 修改：`internal/superrename/scanner_test.go`
- 修改：`internal/superrename/executor.go`
- 修改：`internal/superrename/executor_test.go`
- 修改：`internal/textfile/service.go`
- 修改：`internal/textfile/service_test.go`
- 修改：`internal/web/media.go`
- 新建：`internal/web/media_test.go`
- 修改：`internal/roots/roots.go`

- [ ] 在 `browser.Entry` 增加可选 `SymlinkResolution`，JSON 固定为 `state: mapped | unmapped | broken`；只有 `mapped` 同时返回 `targetKind`、`targetRootId` 和 `targetPath`，不返回服务器绝对路径。
- [ ] 浏览真实目录时使用 `ResolveFollow`；对每个软链接读取原始目标文本并安全解析：目标离开映射根为 `unmapped`，映射根内不存在/循环为 `broken`，成功则按实际文件类型返回 `mapped`。
- [ ] 先增加回归测试，确认外部未映射软链接即使目标存在也不泄露类型或路径，重叠根选择最具体根，目录和文件目标均能正确分类。
- [ ] 将复制、移动、删除、PowerRename、普通重命名的来源改用 `ResolveEntry`，确保操作的是软链接目录项本身；将 mkdir、复制/移动目标和重命名目标改用 `ResolveCreate`。
- [ ] 将媒体读取、文本读取/保存改用 `ResolveFollow` 的实际映射路径；保存仍需在加锁前后复核同一目标，不能因链接在保存期间被替换而写错文件。
- [ ] SuperRename 的组目录、候选源和目标改用新解析入口，但继续要求组目录与媒体来源是真实目录/普通文件，不能借软链接扩大扫描范围。
- [ ] 增加集成测试：未映射软链接本身可重命名、移动和删除；通过它读取媒体/文本或浏览根外内容仍被拒绝；映射根内链接读取保持可用。
- [ ] 所有调用者迁移后删除 `ResolveForWrite`，使用 `rg "ResolveForWrite"` 确认生产代码和测试均无残留。
- [ ] 运行 `gofmt`、`go test ./internal/roots ./internal/browser ./internal/ops ./internal/rename ./internal/superrename ./internal/textfile ./internal/web`，再运行 `go test ./...`。
- [ ] 提交为 `feat: expose safe symlink target metadata`。

### 任务 3：实现链接领域类型、文件身份与权威规划器

**文件：**

- 新建：`internal/links/types.go`
- 新建：`internal/links/identity.go`
- 新建：`internal/links/identity_unix.go`
- 新建：`internal/links/identity_windows.go`
- 新建：`internal/links/identity_other.go`
- 新建：`internal/links/identity_test.go`
- 新建：`internal/links/path_mapper.go`
- 新建：`internal/links/path_mapper_test.go`
- 新建：`internal/links/revision.go`
- 新建：`internal/links/revision_test.go`
- 新建：`internal/links/planner.go`
- 新建：`internal/links/planner_test.go`
- 修改：`go.mod`
- 修改：`go.sum`

- [ ] 定义 `LinkType`、预览请求、任务请求、顶层摘要、计数、内部计划组、目录/硬链接/软链接步骤和设计文档中的稳定错误码；外部 JSON 路径一律使用根内斜杠相对路径。
- [ ] 用平台文件分别实现文件对象身份与文件系统/卷身份：Unix 记录 device + inode，Windows 记录 volume serial + file index；不支持的平台返回明确能力错误，不以路径字符串冒充身份。
- [ ] 先写平台无关及当前平台测试，覆盖同一对象、同卷不同对象、跨卷、路径被替换和内容在同一 inode 上修改；增加 Windows 交叉编译检查所需的最小实现。
- [ ] 实现 `PathMapper`：当前顶层树内部链接映射到该组最终克隆路径；指向另一个顶层源或外部位置的链接先还原词法绝对目标，再从新链接父目录计算相对目标，跨卷无法相对表示时回退绝对路径。
- [ ] 覆盖内部相对/绝对链接、外部相对链接、另一个顶层源、损坏链接、Unicode/括号名称和 Windows 跨卷路径；扫描和映射始终使用 `Lstat`，不得递归跟随链接。
- [ ] 实现普通文件硬链接规划：来源必须为普通文件，目标 basename 固定，目标必须不存在，来源和目标父目录必须同卷，并记录执行期复核身份。
- [ ] 实现文件夹硬链接克隆规划：稳定扫描空目录、普通文件和已有软链接；目录数包含顶层克隆目录；检测特殊条目、跨卷文件、目标位于来源内部及任意目标占用。
- [ ] 实现普通软链接规划：每个顶层普通文件或真实目录只生成一个链接步骤，目标文本相对优先；顶层软链接和特殊文件作为 `unsupported_source` 冲突。
- [ ] 按请求顺序保留顶层组，组内按稳定相对路径排序；拒绝空来源、根目录本身、重复来源及父目录不同的来源。任一顶层冲突只产生摘要，不向客户端暴露递归步骤或服务器绝对路径。
- [ ] 实现 `previewRevision`，格式固定为 `sha256:<64 位小写十六进制>`；摘要输入包括规范请求、来源身份、递归条目、目录权限/mtime、软链接原始目标及映射、目标占用和文件系统身份，不包括绝对路径、扫描时间或错误文本。
- [ ] 测试相同计划 revision 稳定，来源新增/删除/改型/替换、目录权限/mtime、链接目标/映射、目标占用和卷身份变化都会改变 revision；同一 inode 内容变化不使硬链接计划过期。
- [ ] 运行 `gofmt`、`go test ./internal/links`、`go test -race ./internal/links` 和 Windows 构建检查。
- [ ] 提交为 `feat: plan hardlink clones and symlinks`。

### 任务 4：实现顶层组暂存、原子提交与清理

**文件：**

- 新建：`internal/links/staging.go`
- 新建：`internal/links/staging_test.go`
- 新建：`internal/links/executor.go`
- 新建：`internal/links/executor_test.go`
- 修改：`internal/links/types.go`

- [ ] 为文件系统操作定义可故障注入的最小接口；先写真实临时目录集成测试与逐故障点测试，不复用通用 `ops.Executor` 的扁平执行模型。
- [ ] 在最终目标父目录创建 `0700` 的随机 `.filebutler-link-*` 容器，写入版本、运行实例 ID、任务 ID、随机 token、目标 basename 和 revision；容器只允许标记文件及单个 payload 顶层项。
- [ ] 标记文件使用原子写入；只有名称、标记版本、运行实例、任务、token、最终名称和容器结构全部匹配时才视为有效 FileButler 暂存项。标记之外允许零个或一个固定名称的 payload：零个覆盖提交后尚未来得及删容器的崩溃窗口；相似名称、缺失/损坏标记或其他额外顶层内容不得隐藏或删除。
- [ ] 普通文件硬链接和普通软链接先在 payload 位置创建，再原子改名到最终名称；文件夹克隆完整构建 payload 树后才提交顶层目录。
- [ ] 克隆目录先使用可写权限创建；普通文件使用 `os.Link`，已有软链接使用规划后的目标文本；按子目录优先顺序恢复权限位和 mtime，顶层目录元数据留到最终提交前完成。
- [ ] 每个实际目录、硬链接文件和重建软链接对应一个进度步骤；标记、暂存容器和清理不计入总数。顶层目录步骤延迟到最终原子改名成功后报告，保证提交失败一定有可记录的失败步骤。
- [ ] 每个步骤前调用取消钩子，每个步骤后报告成功/失败；取消或首个错误立即停止当前组并递归清理 payload、标记与容器。
- [ ] 当前组开始前重新扫描来源并比对计划；每次实际使用来源条目前再次核对身份；最终提交前第二次重扫整个组并再次确认目标不存在。
- [ ] 普通顶层软链接的目标文本按最终链接位置计算；提交前从最终父目录解析该文本并核对规范目标等于计划来源，不能通过跟随暂存位置中的相对链接验证。硬链接克隆中的内部、外部、损坏和循环软链接一律不跟随，只核对写入目标文本与计划一致。
- [ ] 测试空目录、深层目录、普通文件、内部/外部/损坏链接、目录权限/mtime、300+ 条目、并发目标占用、来源替换、取消和每个系统调用失败点。
- [ ] 验证当前组失败/取消不留下可见最终项；先前已成功提交组不回滚；清理失败返回包含安全暂存位置标识但不泄露未映射绝对路径的错误。
- [ ] 运行 `gofmt`、`go test ./internal/links` 和 `go test -race ./internal/links`。
- [ ] 提交为 `feat: execute staged link groups`。

### 任务 5：接入专用任务、API、SSE 与暂存目录维护

**文件：**

- 新建：`internal/jobs/id.go`
- 新建：`internal/jobs/id_test.go`
- 修改：`internal/jobs/store.go`
- 修改：`internal/jobs/store_test.go`
- 新建：`internal/links/runner.go`
- 新建：`internal/links/runner_test.go`
- 新建：`internal/links/handlers.go`
- 新建：`internal/links/handlers_test.go`
- 修改：`internal/links/staging.go`
- 修改：`internal/links/staging_test.go`
- 修改：`internal/browser/browser.go`
- 修改：`internal/browser/browser_test.go`
- 修改：`internal/ops/handlers.go`
- 修改：`internal/ops/handlers_test.go`
- 修改：`internal/rename/handlers.go`
- 修改：`internal/superrename/handlers.go`
- 修改：`internal/web/router.go`
- 修改：`internal/web/router_test.go`
- 修改：`cmd/filebutler/main.go`

- [ ] 把通用任务 ID 生成移到 `jobs.NewID`，迁移 ops、rename 和 SuperRename 调用者，避免新 `links` 包反向依赖 `ops`；为 `jobs.Store` 增加只读运行实例 ID 与活动任务查询能力。
- [ ] 实现链接专用 Runner：按顶层组顺序执行，逐步骤写入 `jobs.Store`；组错误后把该组未执行步骤记为失败/跳过并继续后续组，使 `completed_with_errors` 的 `progressDone == progressTotal`。
- [ ] 用户取消时让 Executor 清理当前暂存组，Runner 以 `canceled` 终止且允许 `progressDone < progressTotal`；此前提交组保留，后续组不启动。
- [ ] 先写 Runner 测试，覆盖全部成功、组内中途失败后继续、提交失败、首组失败/次组成功、取消、Store 错误和最终 SSE 终态只发一次。
- [ ] 实现受认证 `POST /api/links/preview`：严格 JSON、请求大小限制、服务端权威规划，成功以 `{ data: LinkPreview }` 返回；冲突预览仍为 `200` 且 `hasConflict: true`。
- [ ] 实现 `POST /api/links/jobs`：必须携带 `previewRevision`，服务端重新规划；revision 不同返回 `409 stale_preview`，revision 相同但有冲突返回 `409 plan_conflict`，两者都在同一响应中返回最新 `data` 预览。
- [ ] 任务创建成功后把内部计划快照交给 Runner，返回 `201 { data: { id } }`；不接受客户端目标 basename、递归步骤、计数或文件身份。
- [ ] 将错误稳定映射为设计文档中的错误码，外部错误文本不得含服务器绝对路径；覆盖未认证、未知根、非法路径、请求字段、冲突、过期、Store 失败和成功任务事件。
- [ ] 暂存管理器通过运行实例 ID 和活动任务查询判断当前有效容器；浏览目标父目录时隐藏活动容器，旧运行实例或已无活动任务的有效容器惰性清理。
- [ ] 为 `browser.Service` 增加窄的目录维护接口，避免浏览包反向依赖整个 links 领域；规划目标目录前也执行同一惰性清理。清理失败必须保守地隐藏有效暂存项并返回可诊断错误，绝不删除普通用户目录。
- [ ] 在路由依赖与 `main.go` 中装配共享 Planner、Executor、StagingManager 和 Runner；本任务暂时保留旧 `/api/ops` 链接类型，等前端快捷入口迁移完成后再移除。
- [ ] 运行 `gofmt`、`go test ./internal/jobs ./internal/links ./internal/browser ./internal/web ./cmd/filebutler`、`go test -race ./internal/jobs ./internal/links ./internal/browser` 和 `go test ./...`。
- [ ] 提交为 `feat: expose staged link jobs API`。

### 任务 6：建立前端链接 API 与页面级来源模型

**文件：**

- 修改：`web/src/api/types.ts`
- 修改：`web/src/api/client.ts`
- 修改：`web/src/api/client.test.ts`
- 新建：`web/src/linkSource.ts`
- 新建：`web/src/linkSource.test.ts`

- [ ] 定义与后端一致的 `LinkType`、`LinkRequest`、`LinkJobRequest`、`LinkPreview`、顶层计数、来源类型和稳定错误码；给 `Entry` 增加可选 `symlinkResolution` 三态结构。
- [ ] 为客户端增加 `linkPreview` 和 `linkCreateJob`；请求体只发送来源根/路径、目标根/目录、类型和任务确认时的 revision。
- [ ] 将 `APIError` 扩展为携带可选 `data: unknown`，保留现有 code/status/message；为 `LinkPreview` 增加运行时类型守卫，测试普通错误不变、合法 `409` 可取回最新预览、畸形 `data` 只按普通错误处理。
- [ ] 新增 `LinkSource` 快照：来源根、来源父目录、顺序路径、条目副本和创建时间；实现创建、替换、判定当前行标记、构造预览请求及目标类型。
- [ ] 快照只接受同一面板的一次非空选择，保持文件栏可见顺序；与 `AppClipboard` 使用独立类型和构造函数，不共享字段对象或状态。
- [ ] 为上下文目标定义纯函数：空白/普通文件/软链接/特殊项落到当前目录，真实目录落到目录内部，虚拟根卡片落到根目录。
- [ ] 测试 Unicode/括号路径、跨根目标、目录目标、来源条目刷新后标记判定、快照不可被后续 Entry 修改以及工具栏请求不需要 `LinkSource`。
- [ ] 运行 `npm test -- --run src/api/client.test.ts src/linkSource.test.ts` 和 `npm run lint`。
- [ ] 提交为 `feat: add link source client model`。

### 任务 7：让右键菜单支持可访问的二级动作

**文件：**

- 修改：`web/src/components/ui/context-menu.tsx`
- 修改：`web/src/components/fileActions.ts`
- 修改：`web/src/components/fileActions.test.ts`
- 修改：`web/src/components/PaneContextMenu.tsx`
- 修改：`web/src/components/PaneContextMenu.test.tsx`
- 修改：`web/src/components/ActionToolbar.tsx`
- 修改：`web/src/components/ActionToolbar.test.tsx`
- 修改：`web/src/styles.css`

- [ ] 保持工具栏 `FileAction` 为扁平命令，另定义 `FileContextAction = command | submenu` 判别联合；子菜单只允许命令叶子，避免把递归菜单复杂度扩散到工具栏。
- [ ] 从 Base UI 包装并导出 `ContextMenuSubmenuRoot` 与 `ContextMenuSubmenuTrigger`，子菜单复用现有 Portal、Positioner、Popup、Item 和 Separator 样式。
- [ ] 重构 `PaneContextMenu` 按联合类型渲染；触发项显示右箭头，叶子保持 action ID、禁用、destructive、图标、分隔线和阻止点击冒泡语义。
- [ ] 先写失败测试，验证鼠标悬停打开、点击叶子、右方向键进入、左方向键返回、Enter 执行、Escape 关闭、禁用触发项以及正确的 `menu/menuitem` 可访问角色。
- [ ] 确认现有全部扁平菜单与工具栏测试无需改变用户行为；工具栏收到子菜单时在类型层直接拒绝，而不是运行时静默忽略。
- [ ] 运行 `npm test -- --run src/components/fileActions.test.ts src/components/PaneContextMenu.test.tsx src/components/ActionToolbar.test.tsx`、`npm run lint` 和 `npm run build`。
- [ ] 提交为 `feat: support file action submenus`。

### 任务 8：实现独立链接预览界面

**文件：**

- 新建：`web/src/components/LinkPreview.tsx`
- 新建：`web/src/components/LinkPreview.test.tsx`
- 修改：`web/src/i18n.ts`
- 修改：`web/src/i18n.test.ts`
- 修改：`web/src/styles.css`

- [ ] 实现不依赖页面 Dialog 或 WindowFrame 的 `LinkPreviewContent`，再提供精简模式 `LinkPreviewDialog` 包装；复用操作预览的表格、骨架、错误条、底栏和 Enter 确认约定。
- [ ] 预览每个顶层源一行：显示来源、目标、来源类型，文件夹硬链接克隆显示目录/硬链接文件/重建软链接计数，普通软链接显示一个链接步骤。
- [ ] 使用请求代次或 AbortController，保证旧目标/旧链接类型响应不能覆盖新预览；加载失败保留弹窗并允许关闭，不自动创建任务。
- [ ] 确认时把当前 `previewRevision` 原样带给 `linkCreateJob`；重复点击只发一个请求，任务成功回调 ID 并由外层决定是否消费页面连接源。
- [ ] 捕获带 `data` 的 `409 stale_preview/plan_conflict`，用服务端最新摘要和 revision 替换旧预览并保持打开；有冲突时禁用确认，无冲突时也必须由用户再次点击确认。
- [ ] 错误码优先使用本地化文案，未知错误才显示安全的后备详情；增加中文/英文菜单、计数、状态、冲突、过期和按钮文案及完整性测试。
- [ ] 测试普通文件、文件夹摘要、冲突、预览失败、旧响应、成功、创建失败、`409` 替换、再次确认和关闭时不消费来源。
- [ ] 运行 `npm test -- --run src/components/LinkPreview.test.tsx src/i18n.test.ts`、`npm run lint` 和 `npm run build`。
- [ ] 提交为 `feat: add link creation preview`。

### 任务 9：接入连接源、上下文目标与窗口局部预览

**文件：**

- 修改：`web/src/windowDialogs.ts`
- 修改：`web/src/windowDialogs.test.ts`
- 修改：`web/src/components/fileActions.ts`
- 修改：`web/src/components/fileActions.test.ts`
- 修改：`web/src/components/FileRow.tsx`
- 修改：`web/src/components/FilePane.tsx`
- 修改：`web/src/components/FilePane.test.tsx`
- 修改：`web/src/components/VirtualRootView.tsx`
- 修改：`web/src/components/VirtualRootView.test.tsx`
- 修改：`web/src/components/FileWorkspace.tsx`
- 修改：`web/src/components/FileWorkspace.test.tsx`
- 修改：`web/src/styles.css`

- [ ] 在 `FileWorkspace` 增加页面级 `LinkSource` state/ref；刷新、导航、窗口切换和模式切换不清除，页面卸载自然释放，再次选择直接替换。
- [ ] 增加“选择源连接点”“取消选定的连接（N 项）”和“创建为…”动作；没有来源时完全不渲染后两项，二级菜单固定包含“硬链接”“软链接”。
- [ ] 沿用现有右键选择规则：右键已选行保留多选，右键未选行替换选择；选择来源使用该次有序 Entry 快照，并显示成功数量提示。
- [ ] 重新组织上下文菜单但不改工具栏：应用剪贴板复制/剪切/粘贴之后插入连接组；精简模式右键移除旧直接软/硬链接项，但保留原复制到另一栏、移动、重命名等动作。
- [ ] 空白处和非目录行以当前目录为目标，真实目录行以内层目录为目标；虚拟根卡片只增加“取消选定的连接”和“创建为…”（永远不显示“选择源连接点”），并以 `rootId + .` 为目标。没有来源时根卡片保持现有粘贴菜单。
- [ ] 完整模式在目标文件窗口的 `WindowDialogLayer` 中渲染 `LinkPreviewContent`；精简模式使用页面级 `LinkPreviewDialog`。打开时冻结当次来源和目标，菜单关闭后的选择/导航不能修改请求。
- [ ] 预览关闭、加载失败、冲突、过期和创建失败均保留来源；只有连接源工作流创建任务成功时先清空来源，再登记任务 ID。紧凑工具栏直接入口尚不消费来源。
- [ ] 文件行增加蓝色链条来源标记和 `data-link-source`，不改变复选框颜色、选中状态或剪切灰化；同一来源在其他窗口显示时也按 rootId + relativePath 标记。
- [ ] 测试精简双栏、完整跨窗口、跨根、空白/文件/目录/根卡片目标、来源替换/取消、菜单顺序、模式往返、来源窗口关闭、成功一次性消费和失败保留。
- [ ] 运行 `npm test -- --run src/windowDialogs.test.ts src/components/fileActions.test.ts src/components/FilePane.test.tsx src/components/VirtualRootView.test.tsx src/components/FileWorkspace.test.tsx`、`npm run lint` 和 `npm run build`。
- [ ] 提交为 `feat: add link source context workflow`。

### 任务 10：接通软链接导航、迁移快捷按钮并移除旧链接分支

**文件：**

- 修改：`web/src/fileOpenKind.ts`
- 修改：`web/src/fileOpenKind.test.ts`
- 修改：`web/src/mediaGallery.ts`
- 修改：`web/src/mediaGallery.test.ts`
- 修改：`web/src/components/FilePane.tsx`
- 修改：`web/src/components/FilePane.test.tsx`
- 修改：`web/src/components/FileWorkspace.tsx`
- 修改：`web/src/components/FileWorkspace.test.tsx`
- 修改：`web/src/components/TextEditorWorkspace.test.tsx`
- 修改：`web/src/components/fileActions.ts`
- 修改：`web/src/components/fileActions.test.ts`
- 修改：`web/src/components/OperationPreview.tsx`
- 修改：`web/src/components/OperationPreview.test.tsx`
- 修改：`web/src/api/types.ts`
- 修改：`web/src/i18n.ts`
- 修改：`web/src/i18n.test.ts`
- 修改：`internal/ops/types.go`
- 修改：`internal/ops/planner.go`
- 修改：`internal/ops/planner_test.go`
- 修改：`internal/ops/executor.go`
- 修改：`internal/ops/executor_test.go`
- 修改：`internal/ops/handlers_test.go`

- [ ] 双击 `mapped + directory` 软链接时，直接把当前文件会话切换到返回的目标 root/path，并通过现有 `recordBrowserVisit` 写入一次正常历史；返回、前进和上移随后按目标位置工作。
- [ ] 双击 `mapped + file` 时，用目标 root/path 读取真实内容：媒体建立只含该目标、以链接显示名为标题的安全快照，避免把来源目录其他条目错误映射到目标根；文本编辑器使用真实目标作为读写身份并以点击的链接名作为新入口标题。
- [ ] `unmapped` 和 `broken` 软链接双击不发 browse/media/text 请求；仍保留普通选择、重命名、移动和删除能力。普通未知文件行为不变。
- [ ] 为文件打开分发增加纯函数测试，覆盖目录、媒体、文本、未知文件、映射目标扩展名、损坏/未映射链接；增加历史与跨根导航工作区测试。
- [ ] 将紧凑模式工具栏软/硬链接按钮改为调用同一 `LinkPreview`：来源是当前栏选择，目标是另一栏当前目录，`consumeLinkSource = false`，不读取、替换或清除页面来源。
- [ ] 将 `FileActionCommands` 拆成通用 ops 与链接回调，使复制/移动/删除继续走 `/api/ops`，工具栏软/硬链接只走 `/api/links`。
- [ ] 前端 `OpsRequest` 删除 `symlink | hardlink`；后端 `internal/ops` 删除对应常量、规划与执行分支，确认生产代码中只有 `internal/links` 直接调用 `os.Link/os.Symlink`。
- [ ] 更新旧操作预览和动作测试，证明复制、移动、删除、mkdir、拖放和剪贴板不受影响；链接任务仍使用 `hardlink/symlink` 类型显示在任务中心。
- [ ] 测试工具栏预览取消/失败不影响页面来源，成功只清除普通文件选择并登记任务；上下文来源工作流成功仍会消费来源。
- [ ] 运行 `gofmt`、`go test ./internal/ops ./internal/links ./...`，并在 `web/` 运行相关聚焦测试、`npm test -- --run`、`npm run lint` 和 `npm run build`。
- [ ] 提交为 `feat: unify link creation and navigation`。

### 任务 11：全量回归与真实文件系统验收

**文件：**

- 验证：`internal/roots/**`
- 验证：`internal/browser/**`
- 验证：`internal/links/**`
- 验证：`internal/jobs/**`
- 验证：`internal/ops/**`
- 验证：`internal/rename/**`
- 验证：`internal/superrename/**`
- 验证：`internal/textfile/**`
- 验证：`internal/web/**`
- 验证：`web/src/linkSource*`
- 验证：`web/src/components/LinkPreview*`
- 验证：`web/src/components/PaneContextMenu*`
- 验证：`web/src/components/FileWorkspace*`

- [ ] 对全部新增/修改 Go 文件运行 `gofmt`，再运行 `go test ./...` 和 `go test -race ./internal/roots ./internal/browser ./internal/links ./internal/jobs ./internal/ops ./internal/rename ./internal/superrename ./internal/textfile ./internal/web`。
- [ ] 运行 Linux 当前平台测试，并用 `GOOS=windows GOARCH=amd64 go test -c -o /tmp/filebutler-links-windows.test.exe ./internal/links` 执行 Windows 目标编译检查，随后删除该临时文件；确认平台 syscall 类型不泄漏到公共文件。
- [ ] 在 `web/` 运行 `npm test -- --run`、`npm run lint` 和带版本注入的 `npm run build`。
- [ ] 使用 `rg` 确认没有 `ResolveForWrite`、通用 ops 链接类型、旧右键直接链接命令、周期任务轮询或除 `internal/links` 外的新增 `os.Link/os.Symlink` 调用。
- [ ] 创建临时映射根样例：普通文件、空目录、多层目录、300+ 文件、Unicode/括号名称、内部相对/绝对链接、外部映射链接、未映射链接、损坏链接、循环链接和特殊文件。
- [ ] 启动只用于验收且监听 `0.0.0.0` 的临时服务，在精简与完整模式实测选择/替换/取消来源、跨栏/跨窗口/跨根目标、文件夹行和根卡片目标、二级菜单鼠标与键盘操作。
- [ ] 实际创建普通文件硬链接、文件夹硬链接克隆、文件软链接和文件夹软链接；使用文件身份与 `readlink` 验证结果，确认相对目标优先、视频/文本/媒体内容未被复制或修改。
- [ ] 实测映射目录链接导航、映射文件链接打开、历史返回/前进/上移、未映射/损坏链接不跟随但可重命名删除，以及重叠根选择最具体目标。
- [ ] 制造目标占用、跨文件系统、预览后来源替换、预览后新增文件、权限失败、任务取消、执行中目标抢占和进程异常遗留暂存；确认最新预览、终态进度、清理和惰性恢复符合设计。
- [ ] 观察 SSE：进行中不刷新文件栏，终态立即刷新且保持滚动位置；断线重连沿用现有快照恢复，不新增轮询。
- [ ] 关闭临时服务并删除全部测试根、暂存目录和构建测试产物；运行 `git diff --check`、检查工作区和提交历史，确保没有配置、认证数据或样例文件进入提交。
- [ ] 若验收只发现测试/样式小修，使用聚焦提交；除非用户另行要求，不推送远端、不发布版本。
