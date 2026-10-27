# 默认形象与爆炸视觉更新

日期：2026-10-27。基于已合并的 `main` 继续修改，没有重建项目。

## 默认图片

`public/mascot.png` 是根据用户本次上传的角色参考图制作的透明底高清处理版，1254×1254 RGBA，alpha 包含 0 与 255。聊天中的图片没有作为可直接读取的原始附件文件提供，因此使用图片编辑工具进行去背景与高清重绘，非原图的逐像素无损裁切。处理后的图片已实际检查，并统一用于默认地雷、爆炸主图、装饰、结算与 favicon。

图片保留比例并居中，不增加白色或紫色矩形底。原 `potato.svg` 保留为默认图片加载失败时的备用图。浏览器已上传的素材仍优先使用，要看到新默认素材，需在对应槽位点击“恢复默认”，不会自动删除用户图片。

## 动画与配置

- 命中格单次暖色预警脉冲与警示圈，避免频繁闪屏。
- 主图迅速放大并回弹，双层冲击波加短促局部光晕。
- 经典爆炸、超级土豆爆炸、土豆雨三种预设，同时保留极简模式。
- 土豆雨使用向下飘落的独立轨迹，不再仅把放射粒子换成图片。
- 真实页面内容使用 transform 轻震 0.36 秒，不使用 margin 驱动逐帧布局；不再使用全屏 backdrop blur。
- 默认总时长 1.6 / 2.1 / 2.2 秒，粒子最多 80 个，单次动画所有粒子在总时长内结束。图片由浏览器共享解码，粒子动画使用 transform / opacity。
- 参数说明、单位、推荐值、数值输入和滑块均可用；预览时修改参数不会反复延长本次动画，下次点击测试使用新参数。
- 保留“测试爆炸特效”、系统减少动态效果及手动开关。已有配置、素材、成绩不作迁移或清空，老参数继续有效，选择预设可切换新版推荐值。

## 文件清单

| 文件                                           | 改动                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `public/mascot.png`                            | 新增默认透明底角色                                               |
| `src/storage/defaultAssets.ts`                 | 集中管理默认和备用图片路径，使用相对 URL 支持 Pages 子目录       |
| `index.html`                                   | favicon 使用新默认形象                                           |
| `src/components/AssetImage.tsx`                | 默认形象样式、异步解码及一次性备用图                             |
| `src/components/Board.tsx`                     | 仅替换默认图片引用                                               |
| `src/App.tsx`                                  | 默认图片引用和页面震动状态样式，扫雷及对局状态逻辑不变           |
| `src/components/Explosion.tsx`                 | 动画分层、粒子轨迹、双冲击波、预览参数快照与清理                 |
| `src/components/AdminPanel.tsx`                | 单位、说明、推荐范围和数值输入；保留上传及测试按钮               |
| `src/storage/settings.ts`                      | 调整预设默认时长、粒子数和震动；配置格式及允许范围不变           |
| `src/styles.css`                               | 预警、主图、粒子、冲击波和页面轻震样式，设置面板适配             |
| `tests/effects.spec.ts`                        | 新图片、三预设、减少动态效果、参数快照与持久化、Pages 子路径验收 |
| `tests/game.spec.ts`                           | 恢复默认图片的断言更新为新路径，其余游戏回归保留                 |
| `README.md`、本文与 `docs/screenshots/` 新截图 | 素材来源、使用及重新发布说明                                     |

`src/game/engine.ts` 和原规则测试没有修改；Windows 打包和 Pages 发布工作流继续沿用现有实现。

## 验证与重新发布

执行 `npm test`、`npm run build`、`npm run format:check` 和桌面 / 手机 Chromium 的端到端测试。新增测试会将生产 `dist/` 挂载到 `/GT-WuWa-Minesweeper/` 验证新图片、JS 和 CSS 的子目录路径。短动画生命周期通过可控时钟验证，避免测试因机器负载错过动画窗口。

更新分支为 `codex/mascot-explosion`，合并入口：

https://github.com/GTIIT-RFS/GT-WuWa-Minesweeper/compare/main...codex/mascot-explosion

1. 创建 PR，将分支合并到 `main`。
2. 已有 `Deploy game to GitHub Pages` 工作流会自动重新构建并发布；若需要重试，在 Actions 手动运行该工作流。
3. 等待 deploy 成功，打开该次 github-pages 环境 URL，必要时强制刷新页面。
4. 若仍显示旧的自定义图片，在素材管理中点对应槽位的恢复默认；不必清空网站数据，以免误删成绩和上传素材。

本地打包仍使用 `npm run build`。若需要同步更新 Windows EXE，维护者运行 `npm run package:windows` 或现有 Windows 打包工作流；先前已经下载的 EXE 不会自动更新。本次不宣称已完成 GitHub Pages 的线上发布，实际状态以远端工作流为准。

## 本次实际验证结果

- `npm test`：10 项通过；规则代码与规则测试相对本次基线均未修改。
- `npm run build` 与 `npm run typecheck`：通过。
- 桌面和手机 Chromium 交互：20 项全部通过，覆盖三预设、参数快照、默认素材、上传 / 恢复、胜负、排行榜与 Pages 子路径。
- `npm run format:check` 与 `git diff --check`：通过。
- 已在实际生产预览中检查新形象和超级爆炸截图，无页面运行错误；截图位于本文同目录的 `screenshots/`。
- 未在现场手机做帧率测试，也未代替 GitHub 执行线上发布；没有声称已达到固定 FPS 或新版本已上线。
