# GT WuWa · 扫雷，但是爆的是土豆

为 GTIIT 社团之夜制作的本地网页游戏。React + TypeScript + Vite，真实扫雷逻辑，浏览器本机保存，无账号、无后端、无运行时联网依赖。

## 直接试玩与 Windows 离线版

已有游戏保持不变，本阶段新增 [部署与合并说明](docs/DEPLOYMENT.md)、GitHub Pages 工作流和 Windows 单文件运行包的可复现构建工具。Windows 玩家解压交付 ZIP 后双击 `Potato-Minesweeper.exe` 即可，不需要 Node.js。详见 [Windows 快速说明](docs/WINDOWS-QUICKSTART.txt)。公开试玩地址必须以 Pages 实际部署成功后的环境 URL 为准。

## 快速运行

先安装 **Node.js 24 LTS**（最低 22.12），在项目目录打开终端，依次执行：

```bash
npm ci
npm run dev
```

打开终端显示的地址。保持终端运行，结束时按 `Ctrl+C`。手机和平板可在同一局域网使用电脑的局域网 IP 加端口 5173 访问（需允许防火墙；云环境是否对外提供访问取决于平台）。浏览器不同或网站地址、端口不同，保存的数据也独立。

### 打包和离线活动

```bash
npm run build
npm run preview -- --port 4173
```

`dist/` 是完整静态产物，可部署到普通静态托管服务或通过本地 HTTP 服务器使用。不要双击 HTML。预先安装依赖后，启动本地服务器与游戏不需要联网。没有 Service Worker，关闭本地服务器后不能保证重新打开页面；这不是可安装的离线 PWA。

## 已实现（第一阶段 v0.1）

- 路人体验 5×5 / 3 雷、普通 8×8 / 10 雷、挑战 10×10 / 15 雷、自定义 3–20 行列。
- 首次翻格安全、随机不重复布雷、八邻域数字、迭代空白展开、插旗保护、准确胜负、失败显示全部土豆、完整重开。
- 左键或点击翻格、右键插旗；触屏使用显式插旗模式。键盘 Tab 选格，Enter / Space 操作。
- 首次翻格后开始计时、活动限时（默认 90 秒）、超时结算、再来一局。
- 科幻共鸣风格界面、响应式棋盘、全屏入口、进度、状态与计时显示；大棋盘在手机内部横向滚动，不压缩成难点的小格。
- 独立土豆爆炸模块：预警圈、土豆放大旋转、粒子、冲击波、震动和结算；四种预设、实时预览、系统及手动减少动态效果。
- 10 类图片上传、预览、替换、恢复默认、大小 / 横纵位置 / 透明度调整。PNG/JPG/WebP/GIF，保持比例，单张最多 5 MB / 2500 万像素。
- 7 类自定义音效（MP3/WAV/OGG，单个 10 MB）、合成默认音、静音、音量和试听。
- 本机最近 500 局记录：昵称、棋盘、胜负、耗时与日期；同棋盘且同计时规则的胜利单独按时间排序，清空需确认。
- 配置 JSON 导入导出与校验；LocalStorage 保存轻量配置和成绩，IndexedDB 保存图片音频，刷新后恢复。
- 核心规则单元测试、配置校验测试、桌面及触屏 Chromium 端到端测试、类型检查、生产构建和 CI 工作流。

## 使用你发的图片

1. 将聊天中的图片保存到电脑或手机。
2. 在页面底部打开 **管理员设置 → 素材管理**。
3. 找到 **土豆地雷**，点击上传，选择图片；再在 **爆炸主图** 上传同一张图（或另一张表情）。未单独上传爆炸图时会复用土豆图。
4. 图片立即生效。可调整大小、位置和透明度，无需修改代码。
5. 去 **特效编辑器** 选择预设或调参数，点 **测试爆炸特效** 检查效果。

默认已内置根据新上传参考图处理的透明底高清形象 `public/mascot.png`（1254×1254 RGBA）。原图很小，此素材经过图片编辑工具去背景与高清重绘，并非原图的无损裁切。默认显示保持比例、居中适配，`public/potato.svg` 保留为加载失败的备用图。

已有浏览器上传的图片继续优先生效，不会被更新覆盖。要切回新默认形象，请在「土豆地雷」和「爆炸主图」分别点 **恢复默认**。已有特效配置也会保留，选择预设可应用新版推荐参数。

## 活动设置与数据

- 管理员设置是独立的操作界面，**没有密码或身份验证**。现场需要由工作人员看管设备。
- 常规设置可开启限时、调整秒数、关闭成绩记录。计时规则在**下一局**生效。
- 离开正在玩的棋盘需要确认；确认后放弃这局，不写成绩。刷新同样不会恢复未完成棋盘。
- 用户没填昵称时记为“匿名共鸣者”，昵称最多 16 字。
- 文件始终留在当前浏览器，不上传服务器。清除网站数据、使用隐私模式、换浏览器或地址可能导致记录消失。
- 配置导出只包含参数和素材布局，**不包含素材二进制及排行榜**，请自行备份原始素材。总容量由浏览器决定，存储失败会提示；大尺寸动态 GIF 可能增加设备负担。
- 音频只在用户操作后播放。个别设备、编码或浏览器限制可能阻止播放，但不会阻止游戏。

## 开发与测试

```bash
npm test                 # 单元测试
npm run typecheck        # TypeScript 类型检查
npm run build            # 类型检查 + 静态打包
npx playwright install chromium
npm run test:e2e         # 自动启动服务器，桌面及移动触屏交互
npm run format:check
npm run format           # 统一源代码格式
```

本云环境已有 Chromium，可直接执行：

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

其他环境需要下载浏览器时，可把缓存放在可写目录（网络策略需允许 Playwright 官方下载站点）：

```bash
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright npm run test:e2e
```

依赖有 `package-lock.json`，请用 `npm ci` 安装一致版本。CI 的定义在 `.github/workflows/ci.yml`。实际本次执行结果见 `docs/VALIDATION.md`。

## 目录与扩展

```text
src/
  game/engine.ts              纯函数扫雷规则，与 React 无关
  game/engine.test.ts         规则测试
  components/Board.tsx        棋盘与输入
  components/Explosion.tsx    可替换的独立爆炸模块
  components/AssetImage.tsx   图片适配与布局
  components/AdminPanel.tsx   常规、素材、特效、音效面板
  components/Leaderboard.tsx  同规则排名与对局记录
  audio/controller.ts        默认合成音及自定义音频控制
  storage/assets.ts          IndexedDB 与素材校验
  storage/settings.ts        配置、成绩、版本与持久化校验
  App.tsx                    对局生命周期、计时、视图整合
  styles.css                 响应式主题与动画
public/mascot.png             新默认透明底形象
public/potato.svg             备用土豆素材
tests/game.spec.ts           浏览器交互回归（桌面和移动）
docs/                        架构、验证与后续规划
```

## 爆炸动画与重新发布

经典爆炸约 1.6 秒、超级土豆爆炸约 2.1 秒、土豆雨约 2.2 秒；仍保留极简模式。预警是一次短促暖色脉冲，主图迅速放大回弹，双层冲击波与粒子扩散，页面内容轻震 0.36 秒。管理员可用滑块或数值框调整总时长、粒子数、扩散范围、主图大小和震动幅度；点击 **测试爆炸特效** 可随时重播。修改期间不会延长正在播放的动画，下一次预览使用新参数。系统和手动减少动态效果选项继续有效。

本次改动的验收和文件清单见 [更新记录](docs/VISUAL-UPDATE.md)。本地重新打包：`npm run build`。GitHub Pages：将更新分支合并到 `main`，已有 Pages 工作流会自动构建发布；若需重试，在 Actions 中运行 **Deploy game to GitHub Pages**。部署方式仍见 [部署说明](docs/DEPLOYMENT.md)。

## 第一阶段边界与后续方向

此版本优先实现可玩的核心和可替换素材。独立的旋转速度 / 弹跳曲线 / 冲击波尺寸编辑、常规动画编辑器、背景粒子数量编辑、多主题、完整素材包和成绩的导入导出、长按插旗、双击快速展开、排行榜跨设备同步、未完成对局恢复、安装式 PWA 尚未实现。当前“放大倍率 / 粒子速度 / 数量 / 颜色 / 持续时间 / 震动”可调，四种预设可用。

需在实际活动设备上做最终触屏、音量、全屏和长时间运行验收；自动化多局测试不等于数小时的压力测试。默认角色为用户提供参考图的透明底处理版，通用土豆 SVG 作为备用素材。请确保部署和活动使用的图片具有相应使用权限；科幻界面仍为本项目独立设计。
