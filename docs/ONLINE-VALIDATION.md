# 在线排行榜验证记录

日期：2026-10-27。基线：`4ee2abe193a6d3c1c8864e8ee0740f0cbd781849`。开发分支：`codex/online-leaderboard-phase1`。

## 已执行并通过

| 检查                                                                 | 结果                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 原仓库确认                                                           | origin 为 GTIIT-RFS/GT-WuWa-Minesweeper，远端 HEAD 与基线一致，开始时工作区干净 |
| 基线 `npm ci`、`npm run build`、`npm test`                           | 成功，原有 10 项单元测试通过                                                    |
| 最终 lockfile `npm ci`                                               | 成功安装 122 个依赖                                                             |
| 最终 `npm test`                                                      | 5 个文件、22 项测试全部通过；包含原有引擎、HTTP、PostgreSQL 权限及计分集成测试  |
| 最终 `npm run build`                                                 | TypeScript 和 Vite 生产构建通过                                                 |
| 带模拟公开 Supabase 配置的生产构建                                   | 通过；与未配置时的本地模式构建均已验证                                          |
| `npm run format:check`、`git diff --check`                           | 通过                                                                            |
| Deno 2.9.6 `check --no-lock supabase/functions/competition/index.ts` | 真实 Edge 入口及 SDK 类型检查通过                                               |
| Playwright 桌面 + 手机触屏                                           | 26 项全部通过；原有 20 项与新增 6 项在线流程测试                                |
| 投影最终布局定向回归                                                 | 桌面与手机 2 项通过；桌面断言参赛地址位于屏幕内                                 |
| 实际浏览器投影尺寸检查                                               | 1920×1080 与 1366×900 均完整显示 5 名玩家与参赛地址                             |
| 前端 secret key 负向构建检查                                         | 使用固定假 secret 类型 key 时按预期拒绝打包，exit 1，错误不回显 key             |
| 原有扫雷引擎迁移到共享模块                                           | 与基线文件逐字比较一致；客户端继续从原 import 路径重新导出                      |

## 测试边界

- PGlite 执行的是迁移原始 SQL 和 PostgreSQL RLS / GRANT / PL/pgSQL，并非用内存对象模拟 SQL；Supabase 的 auth schema 和数据库角色由夹具创建。
- Playwright 的邮箱登录与网络 API 使用模拟响应；实际共享扫雷规则、HTTP 边界单元测试和数据库集成测试分别覆盖对应层。
- 版本冲突、重复请求和原子更新路径已验证；完整托管 Supabase 上多连接同时操作与锁等待尚未实测。
- 浏览器请求超时为 15 秒，保留可重试的同一请求 UUID；排行榜失败保留上次数据并继续轮询。

## 未完成的真实云端验证

Supabase 连接器返回可访问项目列表为空，未能访问 `GT-WuWa-Leaderboard`。没有运行真实远端迁移、Edge 部署、SMTP 验证、多人跨设备联调或项目 Security Advisor。Deno 类型检查与模拟浏览器测试不等于真实 Edge Runtime 已通过。

完整 Supabase Docker 栈未启动，CLI 的本地 migration list 未成功；本地迁移有效性以 PGlite 测试为证据。Supabase changelog HTTP 请求受网络策略限制，但当前 Auth OTP、Edge Auth 与 RLS 文档已通过官方文档工具核对。

下一步按 [部署与云端验收说明](ONLINE-LEADERBOARD.md) 配置项目、邮箱模板 / SMTP、GitHub 两项公开 Variables，合并后再完成真实云端验收。当前不声称线上功能已经上线。
