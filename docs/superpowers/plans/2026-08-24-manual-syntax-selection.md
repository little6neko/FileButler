# 文本编辑器手动语法选择实施计划

**目标：** 在文本编辑器工具栏右侧增加会话级语法高亮下拉框，支持自动识别、纯文本和 FileButler 当前全部高亮语法，并通过 CodeMirror `Compartment` 热切换而不丢失编辑状态。

**架构：** `textFiles.ts` 成为语言标识、显示名和 CodeMirror 描述名的单一目录；`TextEditorSession` 保存自动/手动选择、实际语言、加载代次和大文件锁定；`TextEditor` 协调按需加载并只对当前 `EditorView` 派发 `Compartment.reconfigure`；独立的选择组件只负责可访问界面。选择不进入保存数据流，完整与精简模式通过现有共享会话自然同步。

**技术栈：** React 19、TypeScript 6、CodeMirror 6、Base UI Select、Vitest、Testing Library、现有文本会话管理器与 FileButler 窗口系统。

**设计依据：** `docs/superpowers/specs/2026-08-24-manual-syntax-selection-design.md`

---

### 任务 1：集中语言目录并统一加载名称

**文件：**

- 修改：`web/src/textFiles.ts`
- 修改：`web/src/textFiles.test.ts`
- 修改：`web/src/codeMirrorLoader.ts`
- 修改：`web/src/codeMirrorLoader.test.ts`

- [ ] 先增加失败测试，断言语言目录恰好包含 47 个唯一标识、纯文本恰好一次、每个非纯文本项都有显示名和 CodeMirror 描述名。
- [ ] 把当前私有 `languageDisplayNames` 改为可枚举的只读语言目录，并继续导出稳定的 `TextLanguage`、`TextFileDescriptor` 和文件自动识别接口。
- [ ] 提供按语言标识读取定义和生成排序选项的纯函数；文件后缀、特殊文件名和显示名称不再在组件或加载器中重复声明。
- [ ] 把 `codeMirrorLoader.ts` 的 `languageDescriptionNames` 合并进语言目录，加载器只消费统一定义。
- [ ] 明确加载入口区分自动与手动：自动 `.mm` 请求 Objective-C++，手动 Objective-C 始终请求 Objective-C。
- [ ] 保持动态 import 和按语言 Promise 缓存；纯文本不得导入 `language-data`。
- [ ] 运行 `npm test -- --run src/textFiles.test.ts src/codeMirrorLoader.test.ts` 和 `npm run lint`。
- [ ] 提交为 `refactor: centralize text language catalog`。

### 任务 2：扩展文本会话的语法选择状态

**文件：**

- 修改：`web/src/textEditorSession.ts`
- 修改：`web/src/textEditorSession.test.ts`
- 修改：`web/src/textEditorManager.test.ts`

- [ ] 先增加失败测试，覆盖首次自动识别、手动选择、切回自动、纯文本、加载中、成功应用、失败降级和请求代次。
- [ ] 在会话快照中增加 `languageSelection`、请求语言、实际语言、加载状态、语言请求代次和大文件锁定；初始选择固定为 `auto`。
- [ ] 提供会话方法启动选择请求，并只接受当前代次的成功或失败结果；旧异步结果不得改变实际语言或提示。
- [ ] 证明切换语法不会改变正文、保存基线、dirty、revision、编码、换行和当前保存操作。
- [ ] 初次读取按文件识别和 2 MiB 阈值初始化；纯文本与大文件无需语言加载。
- [ ] 冲突重新载入时保留当前选择，并按新文档大小解除或设置锁定后重新请求对应语法。
- [ ] 编辑内容首次越过 2 MiB 时锁定纯文本；同一文档随后缩小也不自动解锁。
- [ ] 验证管理器借用同一实例时看到相同选择，释放最后持有者后新会话恢复 `auto`。
- [ ] 运行 `npm test -- --run src/textEditorSession.test.ts src/textEditorManager.test.ts`。
- [ ] 提交为 `feat: track text editor syntax selection`。

### 任务 3：通过 Compartment 热切换 CodeMirror 语法

**文件：**

- 修改：`web/src/components/TextEditor.tsx`
- 修改：`web/src/components/TextEditor.test.tsx`
- 修改：`web/src/codeMirrorLoader.ts`

- [ ] 先增加组件失败测试，以可控 Promise 模拟语言加载，验证纯文本立即应用、成功语言热切换、失败降级和旧请求被忽略。
- [ ] 调整初次挂载流程，使其根据会话当前请求语言创建语言 `Compartment`，而不是固定读取文件初始 descriptor。
- [ ] 在运行时桥接中保留当前 `Compartment`、实际语言和可见 `EditorView`，用 `reconfigure` 替换语言扩展。
- [ ] 切换期间保留旧语言与可编辑正文；成功后更新运行时 `EditorState` 和会话实际语言，不创建新的编辑器运行时。
- [ ] 语言加载失败时重配置为空扩展、实际语言设为纯文本并发布现有降级提示；后续成功切换清除该提示。
- [ ] 视图卸载期间完成的请求不得向旧视图派发；重新挂载后根据会话选择和缓存结果补齐语言。
- [ ] 文档越过阈值时让当前请求失效、卸载语言扩展并锁定纯文本。
- [ ] 通过真实 CodeMirror 测试证明切换前后的正文、光标、选区、撤销历史和 dirty 状态均保留。
- [ ] 运行 `npm test -- --run src/components/TextEditor.test.tsx src/textEditorSession.test.ts src/codeMirrorLoader.test.ts`。
- [ ] 提交为 `feat: switch text editor syntax at runtime`。

### 任务 4：增加右侧语法下拉框和本地化界面

**文件：**

- 新建：`web/src/components/TextEditorLanguageSelect.tsx`
- 新建：`web/src/components/TextEditorLanguageSelect.test.tsx`
- 修改：`web/src/components/TextEditor.tsx`
- 修改：`web/src/i18n.ts`
- 修改：`web/src/i18n.test.ts`
- 修改：`web/src/styles.css`

- [ ] 先增加界面失败测试，断言工具栏右侧存在“语法高亮”选择器，顺序为自动、纯文本和按显示名排序的其余 46 种语法。
- [ ] 实现只负责呈现的选择组件，使用现有 Base UI Select；触发器和滚动列表在完整窗口与精简弹窗中复用。
- [ ] 自动状态显示“自动（识别结果）”，手动状态显示所选语法；状态栏首项显示实际应用语言而非请求语言。
- [ ] 加载期间设置 `aria-busy` 并禁用触发器，正文与保存按钮继续可用。
- [ ] 大文件显示“纯文本（大文件）”、禁用触发器并保留现有降级提示。
- [ ] 新增中英文语法控件、自动结果、加载中和大文件文案；语言技术名称保持统一目录中的标准名称。
- [ ] 调整工具栏布局：保存按钮和保存状态在左侧，固定合理宽度的选择器通过 `margin-left: auto` 靠右，并在最小文本窗口和精简弹窗内不溢出。
- [ ] 测试手动选择不触发 `onSave`、不显示未保存状态，也不创建任务相关 UI。
- [ ] 运行 `npm test -- --run src/components/TextEditorLanguageSelect.test.tsx src/components/TextEditor.test.tsx src/i18n.test.ts`、`npm run lint` 和 `VITE_APP_VERSION=0.2.0 npm run build`。
- [ ] 提交为 `feat: add text editor syntax selector`。

### 任务 5：验证跨模式共享、回归并更新测试服务

**文件：**

- 修改：`web/src/components/TextEditorWorkspace.test.tsx`
- 验证：`web/src/components/FileWorkspace.tsx`
- 验证：`web/src/components/TextEditorDialog.tsx`
- 验证：`web/src/components/WorkspaceShell.tsx`
- 验证：`web/src/styles.css`

- [ ] 增加工作区失败测试：完整模式手动选择后切到精简模式并借用同文件，选择与实际语言保持；精简模式修改后直接切回完整模式仍保持。
- [ ] 验证最小化、任务栏恢复、窗口移动/缩放以及关闭来源文件窗口不会重置选择。
- [ ] 验证选择语言不增加 dirty 计数、不注册 `beforeunload`、不打开关闭确认、不刷新目录、不调用文本保存 API且任务数保持不变。
- [ ] 验证关闭最后持有者并重新打开同文件后恢复自动识别。
- [ ] 验证 2 MiB 文件仍可手动切换，2 MiB+1 字节文件显示禁用的大文件纯文本状态。
- [ ] 运行 `npm test -- --run`、`npm run lint`、`VITE_APP_VERSION=0.2.0 npm run build`、`go test ./...` 和 `go test -race ./internal/textfile ./internal/web`。
- [ ] 运行 `git diff --check`，确认工作区只包含本功能文件且各提交范围清晰。
- [ ] 使用当前“测试目录 A/文本编辑测试”样本，在真实 Chromium 中验证自动、Go→Python→纯文本→自动、模式借用、关闭重开和大文件禁用；确认没有非预期控制台错误。
- [ ] 重建当前二进制和前端，继续监听 `0.0.0.0:8082`，验证 `/api/health` 为 `200` 并报告测试地址。
