# 文本编辑器实施计划

**目标：** 为已适配的常见文本和源代码文件增加 CodeMirror 6 编辑、语法高亮和安全保存能力；完整模式使用独立任务栏窗口，精简模式使用页面级弹窗，同时保护认证、编码、大小、外部修改和未保存内容。

**架构：** 后端新增独立 `textfile` 领域模块，负责白名单、编解码、大小、版本和原子保存，`internal/web` 只负责受认证 HTTP 契约。前端把文件识别、编辑会话、CodeMirror 视图和工作区协调拆开；编辑会话使用外部存储保留内容、选择与撤销状态，`FileWorkspace` 只连接文件双击、窗口管理器、任务栏和模式切换。

**技术栈：** Go 1.26、chi、`golang.org/x/text`、React 19、TypeScript 6、CodeMirror 6、Vitest、Testing Library、Base UI/shadcn、Tailwind CSS，以及现有 FileButler 窗口管理器与认证中间件。

**设计依据：** `docs/superpowers/specs/2026-08-24-text-editor-design.md`

---

### 任务 1：建立后端文本类型和编解码核心

**文件：**

- 新建：`internal/textfile/types.go`
- 新建：`internal/textfile/support.go`
- 新建：`internal/textfile/support_test.go`
- 新建：`internal/textfile/codec.go`
- 新建：`internal/textfile/codec_test.go`
- 修改：`go.mod`
- 修改：`go.sum`

- [ ] 先编写表驱动失败测试，完整覆盖设计文档中的普通后缀、语言后缀和特殊文件名，验证大小写不敏感、特殊文件名优先、未知文件和 `.svg` 被拒绝。
- [ ] 定义 `Encoding`、`LineEnding`、读取结果、保存输入以及领域错误；集中定义 2 MiB 高亮阈值和 10 MiB 文件上限。
- [ ] 实现后端 `IsSupported(path)`，只返回是否允许通过文本 API，语言 ID 仍由前端负责。
- [ ] 增加 `golang.org/x/text`，使用严格转换实现 GB18030 与 UTF-16 LE/BE 编解码。
- [ ] 先编写 UTF-8、UTF-8 BOM、UTF-16 LE/BE BOM 和 GB18030 的失败测试，覆盖中文、ASCII、空文件、BOM 保留和无法解码输入。
- [ ] 实现按 BOM、合法 UTF-8、GB18030 的固定顺序解码；不自动识别无 BOM UTF-16。
- [ ] 实现 NUL 和明显二进制控制字符检测，确保 UTF-16 的编码层 NUL 不会在解码前被误判。
- [ ] 实现 LF、CRLF、CR、mixed 和 none 检测；mixed 记录主导分隔符，次数相同选择 LF。
- [ ] 实现按原编码、BOM 和选定单一换行重新编码，并拒绝未知编码或换行参数。
- [ ] 在仓库根目录运行 `gofmt` 和 `go test ./internal/textfile`。
- [ ] 提交为 `feat: add text file codecs`。

### 任务 2：实现安全读取、版本检查和原子保存服务

**文件：**

- 新建：`internal/textfile/service.go`
- 新建：`internal/textfile/service_test.go`
- 新建：`internal/textfile/atomic.go`
- 新建：`internal/textfile/atomic_test.go`

- [ ] 先编写失败测试，覆盖普通文件读取、目录、不存在文件、未知后缀、根目录越界、根外符号链接和指向根内文件的符号链接。
- [ ] 使用 `roots.Resolver.ResolveForWrite` 获取并再次验证规范路径；读取只允许普通文件。
- [ ] 读取前检查元数据并使用有上限读取防止检查后的文件增长；超过 10 MiB 返回领域级 `ErrTooLarge`。
- [ ] 对原始字节计算带固定前缀的 SHA-256 revision，并返回内容、编码、换行、原始字节大小和版本。
- [ ] 先编写保存失败测试，覆盖 revision 相同成功、revision 不同无写入、`force` 覆盖、新内容超限、文件已删除和权限错误。
- [ ] 以规范目标路径为键实现带引用清理的每文件互斥，确保同一进程中的两个浏览器保存按“检查版本—写入”整体串行化，不让锁表无限增长。
- [ ] 在锁内重读当前原始字节并比较 revision；`force` 只跳过比较，不跳过其他验证。
- [ ] 实现同目录临时文件写入：复制原权限位、完整写入、`Sync`、关闭、原子替换和目录同步；保存规范目标而不是替换入口符号链接。
- [ ] 为原子写入助手提供最小故障注入点，测试写入、同步、关闭和替换失败均不截断原文件，并清理临时文件。
- [ ] 验证成功响应使用重新编码后的真实字节数和新 revision；明确不保留硬链接关系、扩展属性和 ACL。
- [ ] 运行 `gofmt`、`go test ./internal/textfile` 和 `go test -race ./internal/textfile`。
- [ ] 提交为 `feat: add safe text file storage`。

### 任务 3：暴露受保护的文本 HTTP API

**文件：**

- 新建：`internal/web/text.go`
- 新建：`internal/web/text_test.go`
- 修改：`internal/web/router.go`
- 修改：`internal/web/router_test.go`
- 修改：`web/src/api/types.ts`
- 修改：`web/src/api/client.ts`
- 新建：`web/src/api/client.test.ts`

- [ ] 先增加路由失败测试，证明未登录的 GET 和 PUT 都返回 `401`，并且不存在、越界和权限信息不会在认证前泄露。
- [ ] 在 `NewRouter` 内创建一个由 GET/PUT 共享的文本服务，并把 `/api/text` 注册到现有 `RequireAuth` 路由组。
- [ ] 实现 GET 查询参数解析和统一 JSON 数据响应，不流式暴露任意文件。
- [ ] 实现 PUT JSON 解析，使用 `http.MaxBytesReader` 把请求体限制为 32 MiB，并校验 `rootId`、`path`、`content`、`encoding`、`lineEnding`、`revision` 和 `force`。
- [ ] 将领域错误稳定映射到 `400 invalid_request`、`403 permission_denied`、`404 not_found`、`409 revision_conflict`、`413 file_too_large`、`415 unsupported_text` 和 `500 operation_failed`。
- [ ] 增加认证、成功读取、成功保存、冲突、强制覆盖、超限、二进制、未知后缀和符号链接越界的 HTTP 测试。
- [ ] 在前端 API 类型中增加 `TextEncoding`、`TextLineEnding`、`TextDocument`、`TextSaveRequest` 和 `TextSaveResult`。
- [ ] 增加 `api.textRead(rootId, path)` 和 `api.textSave(request)`；使用 fetch mock 测试 URL 编码、PUT 载荷和错误码保留。
- [ ] 运行 `gofmt`、`go test ./internal/web ./internal/textfile` 和 `npm test -- --run src/api/client.test.ts`。
- [ ] 提交为 `feat: expose protected text file API`。

### 任务 4：建立前端文件识别和语言映射

**文件：**

- 新建：`web/src/textFiles.ts`
- 新建：`web/src/textFiles.test.ts`
- 新建：`web/src/fileOpenKind.ts`
- 新建：`web/src/fileOpenKind.test.ts`

- [ ] 先编写表驱动失败测试，逐项覆盖设计文档确认的普通文本、配置、Web、编程语言和特殊文件名。
- [ ] 定义稳定的 `TextLanguage` 与 `TextFileDescriptor`，返回显示名称和后续 CodeMirror 加载所需的语言键，不直接静态导入语言包。
- [ ] 实现大小写不敏感匹配、特殊文件名优先、`.env.*`、`Dockerfile.*` 和 `*.cmake` 规则。
- [ ] 增加文件打开分发纯函数，优先级固定为目录、媒体、文本、未知；验证 `.svg` 始终返回媒体类型。
- [ ] 测试未知后缀、未知无后缀文件和目录不打开；带已支持文本文件名的符号链接进入文本分发并由后端决定目标是否位于根内；所有已支持媒体不发生回归。
- [ ] 运行 `npm test -- --run src/textFiles.test.ts src/fileOpenKind.test.ts src/mediaGallery.test.ts`。
- [ ] 提交为 `feat: recognize editable text files`。

### 任务 5：建立可跨挂载保留的文本编辑会话

**文件：**

- 新建：`web/src/textEditorSession.ts`
- 新建：`web/src/textEditorSession.test.ts`
- 新建：`web/src/textEditorManager.ts`
- 新建：`web/src/textEditorManager.test.ts`

- [ ] 先编写失败测试，覆盖 loading、ready、saving、conflict、error、clean 和 dirty 状态转换。
- [ ] 设计 `TextEditorSession` 外部存储，让高频编辑内容和 CodeMirror 状态不进入 `FileWorkspace` React 渲染链；只在 dirty、saving、error 等可见元数据变化时通知工作区。
- [ ] 会话保留根目录、路径、文件名、编码、换行、字节大小、revision、保存基线、语言、降级原因和可恢复的编辑器运行时状态。
- [ ] 定义不静态依赖 CodeMirror 的 `EditorDocumentAdapter` 边界，用不透明文档快照比较当前内容与保存基线；测试使用轻量假实现，任务 6 再用 CodeMirror `Text.eq` 落地，使撤销回已保存内容时能清除未保存标记。
- [ ] 实现会话管理器的 `rootId + relativePath` 唯一索引、实例创建、异步加载占位、查找复用、持有者登记和安全删除。
- [ ] 区分桌面窗口持有和精简视图借用：借用视图关闭不删除桌面会话；精简模式独占会话关闭后才释放。
- [ ] 汇总 dirty 会话数量和稳定快照，供任务栏标题与 `beforeunload` 使用，而不在每次按键时重建全部窗口元数据。
- [ ] 测试最小化/卸载视图后编辑状态、选择和撤销历史仍由会话持有；关闭最后持有者后清理订阅和运行时对象。
- [ ] 运行 `npm test -- --run src/textEditorSession.test.ts src/textEditorManager.test.ts`。
- [ ] 提交为 `feat: add text editor session model`。

### 任务 6：实现可复用的 CodeMirror 编辑内容和精简包装

**文件：**

- 修改：`web/package.json`
- 修改：`web/package-lock.json`
- 新建：`web/src/codeMirrorLoader.ts`
- 新建：`web/src/codeMirrorLoader.test.ts`
- 新建：`web/src/components/TextEditor.tsx`
- 新建：`web/src/components/TextEditor.test.tsx`
- 新建：`web/src/components/TextEditorDialog.tsx`
- 修改：`web/src/i18n.ts`
- 修改：`web/src/i18n.test.ts`
- 修改：`web/src/styles.css`
- 修改：`web/src/test/setup.ts`

- [ ] 安装最小 CodeMirror 6 依赖：state、view、commands、search、language 和 language-data；不要引入 Monaco、LSP 或完整 IDE 依赖。
- [ ] 先编写加载器失败测试，验证核心只加载一次、语言按需加载、同语言复用 Promise、加载失败返回纯文本降级而不是拒绝编辑。
- [ ] 通过动态 import 加载 CodeMirror 核心和 `language-data`；把任务 4 的语言键解析为对应 `LanguageDescription.load()`。
- [ ] 用 CodeMirror `EditorState`、`Text` 和 transaction 实现任务 5 的编辑文档适配器，视图卸载时保留状态，重新挂载时恢复选择与历史。
- [ ] 先编写组件失败测试，覆盖加载状态、保存按钮、行号容器、状态栏、错误提示、只触发一次的 `Ctrl/Cmd+S` 和可访问名称。
- [ ] 实现不依赖 Dialog 或 WindowFrame 的 `TextEditor` 内容组件，连接会话持有的 EditorState 与当前可见 EditorView。
- [ ] 配置行号、撤销重做、查找替换、选择绘制、括号匹配、缩进和基础快捷键；不启用自动补全、lint、格式化或语言服务器。
- [ ] 原始文件大于 2 MiB 时不加载语言；编辑文档越过安全阈值时重配置为纯文本并显示降级说明。
- [ ] 顶部只增加可见保存按钮；底部显示语言、编码、换行、光标行列、字节大小和保存状态。
- [ ] 实现 `TextEditorDialog` 页面级包装，保留同一内容组件；确认弹窗逻辑留给后续工作区协调任务。
- [ ] 使用 CSS 变量和等宽字体适配当前 FileButler 视觉，保证编辑区 `min-width/min-height: 0`、双轴滚动和窗口缩放。
- [ ] 在测试 setup 中增加 CodeMirror 所需的确定性 Range 几何和缺失观察器 polyfill；只补齐 jsdom 不提供的能力，不覆盖浏览器原生实现。
- [ ] 增加所有新增中文、英文文案和 i18n 完整性测试。
- [ ] 运行 `npm test -- --run src/codeMirrorLoader.test.ts src/components/TextEditor.test.tsx src/i18n.test.ts`、`npm run lint` 和 `npm run build`。
- [ ] 提交为 `feat: add CodeMirror text editor`。

### 任务 7：扩展窗口管理器和任务栏文本窗口类型

**文件：**

- 修改：`web/src/windowManager.ts`
- 修改：`web/src/windowManager.test.ts`
- 修改：`web/src/components/WorkspaceShell.tsx`
- 修改：`web/src/components/WorkspaceShell.test.tsx`
- 修改：`web/src/components/WindowFrame.tsx`
- 修改：`web/src/styles.css`

- [ ] 先增加窗口管理器失败测试，创建 file、powerRename、mediaPreview 和 textEditor 四类记录，验证类型引用、最小尺寸、聚焦、MRU、最小化、最大化和边界收敛。
- [ ] 新增 `TextEditorWindowRecord`、`openTextEditorWindow`、`isTextEditorWindow` 和文本编辑器最小尺寸，不把业务内容塞入几何记录。
- [ ] 扩展 `DesktopWindowRecord` 与 `windowMinimum`，确保所有现有类型测试继续通过。
- [ ] 扩展 `TaskbarWindow` 联合类型，使用文本/代码文件图标，并允许标题携带未保存标记。
- [ ] 测试文本任务栏按钮的活动态、最小化恢复和标题更新，不改变现有媒体和 PowerRename 图标。
- [ ] 确认 `WindowFrame` 可给文本窗口传入局部确认层和动态关闭请求，而不绕过统一移动/缩放手势。
- [ ] 运行 `npm test -- --run src/windowManager.test.ts src/components/WorkspaceShell.test.tsx`。
- [ ] 提交为 `feat: add text editor window records`。

### 任务 8：接入完整模式文本打开与多窗口生命周期

**文件：**

- 修改：`web/src/components/FileWorkspace.tsx`
- 新建：`web/src/components/TextEditorWorkspace.test.tsx`
- 修改：`web/src/components/FilePane.test.tsx`
- 修改：`web/src/styles.css`

- [ ] 先增加完整模式失败测试：双击支持文本后调用读取 API、显示文本窗口和任务栏按钮；双击 `.svg` 仍打开图片；未知文件不请求文本 API。
- [ ] 把现有 `onOpenFile` 从媒体专用入口改为任务 4 的统一分发，目录双击逻辑保持在 `FilePane` 内不变。
- [ ] 在 `FileWorkspace` 持有一个稳定文本会话管理器和文本实例到窗口 ID 的索引，不复制高频编辑正文到工作区状态。
- [ ] 打开新文本时先创建 loading 会话和聚焦窗口，再异步读取；失败在窗口内显示且可关闭。
- [ ] 同一 `rootId + path` 已打开时恢复并聚焦已有窗口，不发送重复读取请求；不同文件创建独立窗口。
- [ ] 在 `renderDesktopWindow` 中渲染文本编辑器内容，标题和任务栏读取会话快照，dirty 时显示未保存标记。
- [ ] 关闭来源文件窗口、来源导航或选择变化不得影响编辑会话；最小化和完整/精简模式往返保存 EditorState、选择和撤销历史。
- [ ] 文本窗口本身的关闭先实现 clean 直接释放；dirty 关闭由任务 10 接入确认。
- [ ] 完整模式切换到精简模式时保留文本窗口和会话，但完整模式任务栏项目按现有规则隐藏。
- [ ] 运行 `npm test -- --run src/components/TextEditorWorkspace.test.tsx src/components/FilePane.test.tsx src/windowManager.test.ts`。
- [ ] 提交为 `feat: open text editor desktop windows`。

### 任务 9：接入保存、目录刷新和版本冲突处理

**文件：**

- 修改：`web/src/textEditorSession.ts`
- 修改：`web/src/textEditorSession.test.ts`
- 新建：`web/src/textEditorController.ts`
- 新建：`web/src/textEditorController.test.ts`
- 新建：`web/src/components/TextEditorConfirm.tsx`
- 新建：`web/src/components/TextEditorConfirm.test.tsx`
- 修改：`web/src/components/FileWorkspace.tsx`
- 修改：`web/src/components/TextEditorWorkspace.test.tsx`
- 修改：`web/src/components/TextEditor.tsx`

- [ ] 先增加控制器失败测试，覆盖 save 去重、成功更新 revision/size/基线、失败保留正文、保存后内容超限和会话在请求期间卸载。
- [ ] 把保存协调放在会话控制器中：从会话读取当前内容和原始编码/换行，调用 PUT，并只把仍属于同一请求代次的响应提交回会话。
- [ ] 保存成功后清除 dirty、更新状态栏，并通过工作区现有刷新队列刷新所有正在显示目标父目录的浏览会话。
- [ ] 先增加冲突失败测试：`409` 打开所属文本窗口内确认框，不进入任务侧栏，也不清空本地内容。
- [ ] 实现“取消、重新载入、仍然覆盖”：取消只关框；重新载入重新 GET 并替换会话基线；覆盖用同一内容和 `force: true` 重试。
- [ ] `TextEditorConfirm` 提供可复用确认内容；完整模式通过 `WindowDialogLayer` 在所属窗口中央渲染，精简模式后续通过页面 Dialog 包装。
- [ ] 处理 `401`、`403`、`404`、`413`、`415` 和普通网络/服务器错误，全部保留正文与 dirty；高亮加载错误仍独立降级。
- [ ] 验证快速连续 `Ctrl/Cmd+S` 只产生一个请求，旧保存响应不能覆盖后来重新载入或关闭后的实例。
- [ ] 验证保存不会创建 Job、不会打开任务侧栏，也不会改变任务活动数。
- [ ] 运行 `npm test -- --run src/textEditorSession.test.ts src/textEditorController.test.ts src/components/TextEditorConfirm.test.tsx src/components/TextEditorWorkspace.test.tsx`。
- [ ] 提交为 `feat: save text editor documents`。

### 任务 10：完成精简模式和未保存关闭保护

**文件：**

- 修改：`web/src/components/FileWorkspace.tsx`
- 修改：`web/src/components/TextEditorWorkspace.test.tsx`
- 修改：`web/src/components/TextEditorDialog.tsx`
- 修改：`web/src/components/TextEditorConfirm.tsx`
- 修改：`web/src/i18n.ts`
- 修改：`web/src/i18n.test.ts`

- [ ] 先增加精简模式失败测试，验证双击文本打开页面级编辑弹窗、没有任务栏按钮、一次只显示一个文本视图。
- [ ] 精简模式打开新文件时创建独占会话；若同文件已有完整模式保留实例，则借用该实例而不重复 GET 或复制正文。
- [ ] 借用视图关闭只隐藏视图并保留桌面会话及 dirty；独占 clean 会话关闭时释放。
- [ ] 为独占 dirty 会话接入“保存、不保存、取消”：保存成功后继续原关闭/切换动作，保存失败保留弹窗，不保存释放会话，取消撤销待执行动作。
- [ ] 修改模式切换协调器，使精简 dirty 独占会话能够阻止切换；借用桌面会话切回完整模式时直接恢复原窗口，不弹关闭确认。
- [ ] 完整模式 dirty 文本窗口请求关闭时使用同样三选项局部确认；最小化不提示，模式切到精简继续保留。
- [ ] 基于管理器 dirty 总数注册一个 `beforeunload` 监听；全部会话 clean 或关闭后移除，测试不重复注册。
- [ ] 确认页面刷新/关闭只依赖浏览器原生警告，不写 localStorage、SQL 或后端草稿。
- [ ] 增加精简与完整模式往返、借用、独占、关闭失败、取消切换和多个 dirty 窗口的测试。
- [ ] 运行 `npm test -- --run src/components/TextEditorWorkspace.test.tsx src/i18n.test.ts`。
- [ ] 提交为 `feat: protect unsaved text editor sessions`。

### 任务 11：完整回归、性能检查与测试服务验收

**文件：**

- 验证：`internal/textfile/**`
- 验证：`internal/web/text.go`
- 验证：`web/src/textFiles.ts`
- 验证：`web/src/textEditorSession.ts`
- 验证：`web/src/textEditorManager.ts`
- 验证：`web/src/textEditorController.ts`
- 验证：`web/src/components/TextEditor*.tsx`
- 验证：`web/src/components/FileWorkspace.tsx`
- 验证：`web/src/windowManager.ts`
- 验证：`web/src/components/WorkspaceShell.tsx`
- 验证：`web/src/styles.css`

- [ ] 运行 `gofmt` 检查所有变更 Go 文件。
- [ ] 在仓库根目录运行 `go test ./...` 和 `go test -race ./internal/textfile ./internal/web`。
- [ ] 在 `web/` 运行 `npm test -- --run`。
- [ ] 在 `web/` 运行 `npm run lint`。
- [ ] 在 `web/` 运行 `npm run build`，检查 CodeMirror 核心和语言包位于按需 chunk，初始入口没有静态打入全部语言。
- [ ] 运行 `git diff --check`，检查每个功能提交只包含对应范围，没有生成文件、测试样本或无关修改。
- [ ] 在映射测试目录准备 UTF-8、UTF-8 BOM、UTF-16 LE/BE BOM、GB18030、LF、CRLF、CR、mixed、代表性语言、约 2 MiB、2–10 MiB 和超过 10 MiB 的临时样本。
- [ ] 启动监听 `0.0.0.0` 的当前测试服务，先验证未登录 GET/PUT 返回 `401`，再登录进行浏览器验收。
- [ ] 完整模式实测多文本窗口、重复文件聚焦、移动、缩放、最大化、最小化、任务栏恢复、来源窗口关闭和模式往返。
- [ ] 精简模式实测弹窗、同文件借用、保存、不保存、取消、阻止模式切换和无下载按钮的超限提示。
- [ ] 使用另一个浏览器或外部命令修改已打开文件，实测冲突取消、重新载入、强制覆盖，以及删除、权限和会话失效错误仍保留正文。
- [ ] 验证保存不出现在任务侧栏，媒体预览（尤其 `.svg`）、PowerRename、拖拽、文件窗口和任务栏无回归。
- [ ] 报告测试 URL、各项验证结果、最终提交列表和仍然明确存在的首版限制。
