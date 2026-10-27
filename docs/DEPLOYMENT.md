# 第二阶段：验收与部署

本阶段沿用全部现有玩法与界面，新增交付工具、部署流程和验收证据。没有重写游戏模块。

## 源代码与合并

第一次检查 GitHub `main` 时，它仍指向 `fe5164b`（仅初始 README）。第一阶段完整源码保留在云工作区，本阶段将游戏、测试、文档和部署工具放在独立 `codex/playable-release` 分支。

推送成功后可使用 GitHub 比较入口：

https://github.com/GTIIT-RFS/GT-WuWa-Minesweeper/compare/main...codex/playable-release

登录仓库有权限的账号，点击 **Create pull request**，查看 CI 后合并。若按钮不可用，联系仓库管理员授权。也可使用 Git：

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git merge --no-ff origin/codex/playable-release
git push origin main
```

本环境通过平台 Git HTTPS 代理验证读写；GitHub API 返回 Forbidden，因此无法代为创建 PR、启用 Pages 或读取 Actions 状态。比较链接只是合并入口，不代表已经有 PR 或已经合并。

## 公开试玩：GitHub Pages

准备好的 `.github/workflows/pages.yml` 会在代码合并进 `main` 后运行，也可从 Actions 手动运行。它执行安装、测试、构建和 Pages 发布，不包含任何上传素材或本地排行榜。

仓库管理员需要完成的一次性操作：

1. 打开仓库 **Settings → Pages**。
2. 在 **Build and deployment → Source** 选择 **GitHub Actions**。
3. 合并 `codex/playable-release` 到 `main`；或合并后在 **Actions → Deploy game to GitHub Pages → Run workflow** 重新发布。
4. 等待工作流的 `deploy` 成功，使用该次运行的 `github-pages` 环境 URL 试玩。这才是实际发布地址。

默认项目站点地址通常为 `https://gtiit-rfs.github.io/GT-WuWa-Minesweeper/`，但这只是默认地址规则，未发布成功前不可当作已上线链接。仓库访问级别与组织策略可能限制 Pages，私有仓库是否可发布取决于 GitHub 计划和管理员设置。若 Pages 不可用，可将 `dist/` 的内容上传到支持静态文件的托管服务，保留目录结构。

游戏使用 Vite 相对资源路径，适配项目子路径。HTTPS 公开网站无需用户安装 Node.js。浏览器素材与成绩按域名、协议和端口独立保存；从本地切换到 Pages 后不会自动迁移。

本云环境没有对外端口转发或公开网页预览工具。即使 Vite 在 `0.0.0.0:4173` 运行，`localhost`、`127.0.0.1` 和容器私网 IP 都不是用户可访问的云试玩地址。内部浏览器可以执行验收，但不能据此宣称已公开上线。

## Windows：不用安装 Node.js 的离线程序

从交付 ZIP 获取对应架构：普通 Intel/AMD 电脑使用 **amd64**，Windows ARM 使用 **arm64**。

1. 解压 ZIP。
2. 双击 `Potato-Minesweeper.exe`。
3. 默认浏览器自动打开游戏；若未打开，手动输入 `http://127.0.0.1:4173/`。
4. 保持黑色窗口打开，关闭窗口或 Ctrl+C 退出。

EXE 内嵌全部静态产物，使用 Go 标准库在回环地址提供 HTTP 服务。无需 Node.js / Python / Go / 管理员权限，运行时无需联网。上传文件仍保存在浏览器内，不会上传服务器。运行包包含 SHA256 摘要，程序未做商业代码签名。

固定地址让浏览器保存的图片、配置和成绩可在下次启动复用。不要使用隐私窗口，也不要频繁换浏览器或端口。文件不是安装式 PWA；需运行 EXE 后再打开游戏。遇到端口占用请关闭之前的游戏窗口，不会自动杀死其他程序。

### 维护者重新打包

维护者需要 Node.js、Python 3 和 Go 1.24 或更新版本；玩家不需要这些工具。

```bash
npm ci
npm run package:windows
```

脚本执行生产构建、复制资源到生成目录、运行 Go 服务器测试，并交叉编译 amd64 与 arm64。输出位于 `release/GT-WuWa-Windows-*.zip`，生成资源及二进制不进入 Git。如果系统有同名的非 Go 语言程序，请用 `GO_BINARY` 指定真正的 Go 可执行文件。

在 GitHub Actions 手动运行 **Package Windows offline game**，也会构建 ZIP 并保存为可下载 artifact。本阶段不自动创建 GitHub Release。

### 验证边界

Windows EXE 可以在 Linux 上交叉编译，但当前机器没有 Windows 或 Wine，因此不能将交叉编译成功描述成已在 Windows 执行。服务器源代码及内嵌同一网页产物可在 Linux 实际运行，并通过同一套真实浏览器验收。仍需在现场 Windows 10/11 电脑双击运行，检查自动开浏览器、音效、全屏与退出。

## 公开试玩判定与建议

玩法达到邀请试玩候选条件，前提是部署成功、网址能从外部浏览器打开。当前云环境内部运行成功不等于公开部署完成。

下一阶段优先级：真实 Windows / iPad 现场验收 → 配置、图片、音频及成绩的完整备份恢复 → 数小时运行稳定性和大文件性能检查。更多动画、角色、主题和新玩法可排在这些验收工作之后。
