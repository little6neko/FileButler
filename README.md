# FileButler

FileButler 是一个面向 Linux、NAS 和 Docker 环境的自托管 Web 文件管理器。它通过浏览器管理预先映射的目录，提供双栏文件操作、桌面式多窗口、批量重命名、媒体预览、文本编辑和后台任务等功能。

> [!IMPORTANT]
> README 描述的是当前 `main` 分支。`ghcr.io/little6neko/filebutler:latest` 指向最近一次正式发布，可能暂时落后于主分支中的新功能。

## 主要功能

- 两种工作区：适合传统文件管理的双栏精简模式，以及支持独立文件窗口、任务栏和多应用窗口的完整模式。
- 文件浏览：多映射根目录、面包屑路径、名称/类型/大小/修改时间排序和可调整列宽。
- Windows 风格选择：单选、多选、范围选择、框选、`Ctrl/Cmd + A` 全选以及右键菜单。
- 文件操作：复制、移动、删除、新建文件夹、符号链接、硬链接、剪切/复制/粘贴和拖放。
- 重命名：单文件重命名、PowerRename 批量搜索替换，以及面向媒体目录的 SuperRename。
- 预览与编辑：图片/视频预览，以及带编码、换行符、语法高亮和冲突检测的文本编辑器。
- 后台任务：操作前预览、冲突提示、并发执行、取消任务，并通过 SSE 实时推送任务状态。
- 传输进度：本地复制及115上传/下载显示字节进度、阶段速度和阶段剩余时间；进度弹窗可后台隐藏，成功后自动关闭。
- 115网盘：独立桌面窗口、扫码登录、基本文件管理、校验秒传、在线解压（可输入密码），以及与本地窗口之间的多选拖放上传/下载。
- 界面：简体中文和英文，可在运行时切换。
- 访问边界：浏览和写入仅限配置中声明的映射根目录。

### SuperRename

SuperRename 用于整理一个目录下的多个媒体子文件夹：

- 只扫描所选目录的一级子文件夹，不递归处理更深层目录。
- 每个子文件夹中的图片独立编号为 `01.jpg`、`02.jpg`……。
- 视频独立编号为 `V01.mp4`、`V02.mp4`……，并移动到该子文件夹下的“视频”目录。
- 编号宽度至少为 2 位，并根据当前勾选数量自动扩展到 3 位、4 位或更多位。
- 保留原扩展名及其大小写；不匹配的文件、符号链接和更深层目录会在预览中标出但不会处理。
- 可以取消整个子文件夹或单个文件；取消后仅对剩余勾选项目重新连续编号。
- 执行前检查目标占用、重复目标、目录变化和未完成的恢复数据。

### 115 网盘

完整桌面模式中，左侧纵向排列“文件管理器”和“115网盘”。打开115窗口获取二维码，用115客户端扫码确认，再点击“我已扫码，检查登录”。首次版本支持一个115账号，云端文件操作在账号内串行执行。

本地文件拖入115窗口即上传，反向拖放即下载；保留源文件。跨存储拖放仅限 FileButler 内窗口，不支持从操作系统资源管理器拖入网页。支持普通目录递归传输，拒绝符号链接及特殊文件，默认不覆盖同名目标。

上传先显示摘要校验进度，未命中秒传时继续普通上传。云端在线解压在当前目录下创建以压缩包命名的新目录，接受可选密码；格式、大小、分卷及账号权限仍受115限制。云端解压不可中止阶段会禁用取消按钮，后台服务查询其完成状态后通过 SSE 通知浏览器。

进度弹窗的“后台运行”或关闭按钮只隐藏界面，不取消任务；关闭浏览器也不影响后端执行。成功后弹窗自动关闭，失败或部分失败保留原因。服务进程重启后的任务恢复、断点续传不在本版范围。没有实际字节传输的原子移动或云端操作不显示虚构的传输速度。

Docker源码构建会包含Python环境及锁定的依赖。非容器部署启用115功能时，需要Python 3.12或更新的兼容版本；本地传输需要Linux/macOS，Windows可使用Docker。先安装独立虚拟环境：

```bash
python3.12 -m venv .venv115
.venv115/bin/pip install -r cloud115/requirements.txt
```

在服务配置中指定绝对路径：

```yaml
cloud115:
  python: "/path/to/FileButler/.venv115/bin/python"
  worker: "/path/to/FileButler/cloud115/worker.py"
  credentials: "./data/115-cookies.txt"
```

`credentials` 相对路径以配置文件目录为基准；默认保存在 `auth_file` 同目录。`worker` 默认从进程工作目录寻找 `cloud115/worker.py`，建议显式配置绝对路径。凭证等同账号访问权限，请保护数据目录，不要分享或提交。退出115登录会删除FileButler保存的凭证，不影响现有本地功能；115依赖不可用也不会阻止本地文件管理启动。

## 快速开始

### 使用 Docker Compose

克隆项目并准备持久化目录：

```bash
git clone https://github.com/little6neko/FileButler.git
cd FileButler
mkdir -p data downloads media
```

根据实际目录修改 [`configs/filebutler.docker.yaml`](configs/filebutler.docker.yaml) 和 [`compose.yaml`](compose.yaml)，然后构建并启动：

```bash
docker compose up -d --build
```

默认访问地址为 `http://127.0.0.1:8080`。

当前 Compose 文件会从本地源码构建镜像。若要使用已发布镜像，可按下一节直接运行容器。

### 使用已发布镜像

GitHub Container Registry 提供 `linux/amd64` 和 `linux/arm64` 镜像：

```bash
docker pull ghcr.io/little6neko/filebutler:latest
```

运行容器：

```bash
docker run -d \
  --name filebutler \
  --restart unless-stopped \
  -p 8080:8080 \
  -v "$PWD/configs/filebutler.docker.yaml:/app/filebutler.yaml:ro" \
  -v "$PWD/data:/app/data" \
  -v "$PWD/downloads:/data/downloads" \
  -v "$PWD/media:/data/media" \
  ghcr.io/little6neko/filebutler:${FILEBUTLER_TAG:-latest}
```

如需固定版本，可在运行前设置镜像标签，例如：

```bash
export FILEBUTLER_TAG=v0.2.3
```

版本标签是不可变发布，`latest` 会随最新正式版本更新。如果镜像包不可见或拉取被拒绝，请使用具有 `read:packages` 权限的 GitHub Token 登录 GHCR：

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u little6neko --password-stdin
```

### 首次登录

首次打开 FileButler 时需要创建管理员：

1. 输入管理员用户名和至少 10 个字符的密码。
2. 创建成功后，初始化入口会永久关闭。
3. 管理员凭据保存到 `auth_file` 指定的 JSON 文件；Docker 配置默认为 `/app/data/auth.json`。

当前版本仅支持一个管理员账号，请妥善备份并保护 `auth.json`。

## 从源码构建

当前项目使用 Go 1.26.1，并在 Docker 构建中使用 Node.js 25。建议本地环境使用相同版本或兼容的新版本。

构建前端和后端：

```bash
npm --prefix web ci
npm --prefix web run build
mkdir -p bin data
go build -o bin/filebutler ./cmd/filebutler
```

复制本地配置，根据访问范围调整 `listen`，并把 `roots[].path` 改成主机上已存在、且当前用户有权访问的目录：

```bash
cp configs/filebutler.example.yaml filebutler.yaml
```

然后启动服务：

```bash
./bin/filebutler -config ./filebutler.yaml
```

将示例配置复制到项目根目录很重要：相对的 `auth_file` 和 `static_dir` 会以配置文件所在目录为基准解析。前端未注入 `VITE_APP_VERSION` 时，界面版本显示为 `dev`；正式镜像会在构建时自动注入发布版本。

## 配置

基础配置示例：

```yaml
listen: "127.0.0.1:8080"
auth_file: "./data/auth.json"
static_dir: "./web/dist"
job_concurrency: 2
log_level: "info"

session:
  cookie_name: "filebutler_session"
  secure: false

roots:
  - id: "downloads"
    name: "下载"
    path: "/data/downloads"
  - id: "media"
    name: "媒体"
    path: "/data/media"
```

| 配置项 | 说明 |
| --- | --- |
| `listen` | HTTP 监听地址。直接在主机运行时默认是 `127.0.0.1:8080`；容器内通常使用 `0.0.0.0:8080`。 |
| `auth_file` | 管理员密码哈希和会话签名密钥的持久化文件。 |
| `static_dir` | `npm run build` 生成的前端静态资源目录。 |
| `job_concurrency` | 单个普通后台任务同时处理的项目数，最小值为 1。 |
| `log_level` | 预留的日志级别字段，默认值为 `info`；当前日志仍输出到标准输出。 |
| `session.cookie_name` | 登录会话 Cookie 名称。 |
| `session.secure` | 是否为会话 Cookie 添加 `Secure`。仅在 HTTPS 入口下设为 `true`。 |
| `roots[].id` | 映射根目录的唯一标识，不可重复。 |
| `roots[].name` | 显示在界面中的名称；留空时使用 `id`。 |
| `roots[].path` | 服务进程实际访问的目录。目录必须在启动前存在。 |

注意：

- 所有相对路径均相对于配置文件所在目录解析。
- 至少需要配置一个根目录，否则服务拒绝启动。
- FileButler 进程必须对需要修改的映射目录具有相应的读写权限。
- Docker 中的 `roots[].path` 是容器内路径，必须与卷挂载目标一致。
- 修改配置后需要重启服务，目前不支持热加载。

## 数据与任务状态

- 管理员凭据持久化在 `auth_file` 中，当前不使用 SQLite。
- 后台任务和事件记录仅保存在内存中；服务重启后任务面板状态会清空，运行中的任务也不会自动恢复。
- FileButler 当前不提供审计日志、文件版本历史或回收站。
- 删除和重命名会直接修改映射目录中的真实文件，请先为重要数据建立独立备份。

## 反向代理与 SSE

任务面板通过 `/api/jobs/events` 建立 SSE 长连接。服务每 15 秒发送一次心跳，连接断开后浏览器会自动重连。反向代理需要：

- 关闭响应缓冲和缓存，及时向客户端刷新事件。
- 允许长时间保持 HTTP 连接，读取超时应明显大于 15 秒。
- 保留登录 Cookie，并把 `/api/jobs/events` 当作 `text/event-stream` 转发。
- 不要压缩或合并 SSE 响应。

Nginx 参考配置：

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}
```

部分 WAF 会把 URL 编码后的中文文件名、括号或路径片段误判为 SQL 注入。遇到正常目录无法浏览时，应先检查反向代理/WAF 日志，再为受信任的 FileButler 路由设置尽可能小范围的规则例外；不建议在公网入口无条件关闭全部防护。

## 开发与验证

后端测试：

```bash
go test ./...
```

前端测试、静态检查和生产构建：

```bash
npm --prefix web test -- --run
npm --prefix web run lint
npm --prefix web run build
```

前端的独立开发说明见 [`web/README.md`](web/README.md)。

## 当前限制

- 主要面向 Linux 文件系统和 Docker 部署。
- 仅支持单管理员，不包含用户、角色和权限管理。
- 任务状态不持久化，服务重启不会续跑任务。
- SuperRename 初版只处理一级子文件夹中的直属媒体文件。
- 符号链接、硬链接和跨文件系统移动受底层文件系统能力及权限限制。
- 没有回收站；删除操作不可由 FileButler 恢复。

## 安全建议

- 优先部署在内网、VPN 或其他受信网络中，不要把 FileButler 直接暴露到公网。
- 对外访问时使用 HTTPS 反向代理，并将 `session.secure` 设置为 `true`。
- 使用最小权限运行服务，只挂载确实需要管理的目录。
- 限制 `auth.json` 的读取权限，因为其中包含密码哈希和会话签名密钥。
- 定期备份重要数据，并在执行大批量移动、删除或重命名前检查预览结果。
