# FileButler 前端

这里是 FileButler 的浏览器前端，使用 React、TypeScript、Vite、Tailwind CSS、Base UI 和 shadcn 风格组件构建。生产构建结果输出到 `web/dist`，由 Go 服务通过 `static_dir` 提供。

## 环境与安装

Docker 构建当前使用 Node.js 25。进入本目录后安装锁定依赖：

```bash
npm ci
```

## 常用命令

```bash
# 启动 Vite 开发服务器
npm run dev

# 运行单元和组件测试
npm test -- --run

# 监听模式运行测试
npm test

# ESLint 检查
npm run lint

# TypeScript 检查并生成生产资源
npm run build
```

当前 Vite 配置没有为 `/api` 设置开发代理，单独运行 `npm run dev` 只会启动前端资源服务器，无法完成登录和文件操作。完整联调时可自行配置同源 API 代理，或先执行生产构建，再由项目根目录的 Go 服务统一提供前端和 API。

## 版本号

前端从构建环境变量 `VITE_APP_VERSION` 读取版本号：

```bash
VITE_APP_VERSION=0.3.2 npm run build
```

未设置时界面显示 `dev`。Dockerfile 和发布工作流会自动注入镜像版本。

## 目录说明

| 路径 | 用途 |
| --- | --- |
| `src/components` | 工作区、文件窗、对话框、预览器、编辑器和基础 UI 组件。 |
| `src/api` | 前后端 API 类型和请求封装。 |
| `src/*.ts` | 选择、拖放、任务事件、窗口管理和 SuperRename 等领域逻辑。 |
| `src/test` | Vitest/JSDOM 测试环境。 |
| `e2e` | Playwright 浏览器端测试。 |
| `public` | 不经过 Vite 转换的静态资源。 |
| `dist` | 生产构建产物，不应手工修改。 |

## 浏览器端测试

Playwright 测试默认访问 `http://127.0.0.1:8080`。先启动一个使用测试目录和测试账号的 FileButler 服务，再运行：

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8080 \
FILEBUTLER_E2E_PASSWORD=long-password \
npx playwright test
```

`FILEBUTLER_E2E_PASSWORD` 仅在测试环境需要初始化管理员时使用，不要把生产密码写入命令历史或仓库文件。

完整的部署、配置和安全说明见项目根目录的 [`README.md`](../README.md)。
