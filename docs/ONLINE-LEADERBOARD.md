# 在线排行榜：部署与验收

> 这是第一阶段邮箱方案存档。匿名四轮赛事请使用 [当前中文版部署说明](EVENT-DEPLOYMENT.md)，不要按本文件重新执行已经部署的初始迁移或继续要求玩家邮件验证。

本阶段在现有 React + TypeScript + Vite 项目上增加可选的 Supabase 在线比赛。原有离线玩法、本机排行榜、素材上传、音效、土豆爆炸和 Windows 打包继续保留。

## 赛制与玩家身份

- 比赛 ID：`club-night-v1`；固定 8×8、10 雷、180 秒，首格安全，允许重试。
- 所有人使用相同规则，每局由服务器独立随机布雷；不是所有人共用同一张雷图。
- 邮箱 OTP 验证后参与，同一 Supabase Auth 用户在不同设备上合并成绩。昵称不作为身份依据；不同账号仍可能属于同一自然人。
- 点击开始后，数据库创建对局即开始计时。网络往返、思考、断线都计入用时；不会采用浏览器的计时或声称的胜负。
- 只有服务器判定的未超时胜局入榜；每账号每场仅保留最低毫秒数。相同成绩不覆盖较早记录。排序为用时、达成时间、用户 UUID，显示前 100 人。
- 手机使用显式插旗按钮，电脑可右键插旗。在线操作逐步等待服务器确认；服务器不会把隐藏雷图或随机种子交给客户端。
- 每账号最多一个活动对局，重连时恢复；新局间隔至少 3 秒，每小时最多开始 120 局。离开页面不会暂停计时。当前阶段没有提前放弃按钮，未结束对局会恢复或在 180 秒后过期。
- 在线固定规则不受本机管理员的难度、倒计时或关闭本地记分设置影响。本地模式的计时仍从首次翻格开始。

## 结构与信任边界

| 文件                                                        | 用途                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| `supabase/migrations/20261027130453_online_competition.sql` | 比赛、私有对局、最佳成绩、索引、RLS、原子更新 RPC         |
| `supabase/functions/competition/index.ts`                   | 真实 Auth.getUser 验证、数据库适配、服务器加密随机数      |
| `supabase/functions/_shared/competition.ts`                 | 操作校验、身份归属、版本检查、隐藏信息过滤                |
| `supabase/functions/_shared/http.ts`                        | CORS、请求体上限、认证边界、错误处理                      |
| `supabase/functions/_shared/engine.ts`                      | 在线与本地共用原有扫雷规则；`src/game/engine.ts` 重新导出 |
| `src/online/client.ts`                                      | 公开客户端、邮箱登录所用客户端、成绩读取、Edge 请求       |
| `src/components/OnlineCompetition.tsx`                      | 手机 / 电脑参赛界面、断线重试                             |
| `src/components/OnlineLeaderboard.tsx`                      | 全场共享榜单、10 秒轮询、投影轮播                         |

浏览器只能向 Edge Function 提交 `start` 或带版本号与请求 UUID 的 `move`（reveal / flag / sync）。即使请求附加伪造棋盘、身份、用时或胜负，也不会采用。

Edge Function 每次通过 Auth 服务核验已确认邮箱的用户；不使用客户端 user_metadata 授权。数据库只允许服务端角色读取棋盘、运行写入 RPC。所有 public 表开启 RLS，普通角色只读比赛信息与最佳成绩，没有写入策略，也没有对局读取权限。RPC 为 SECURITY INVOKER，撤销 PUBLIC / anon / authenticated 执行权，只授权 service_role。

每步操作在数据库锁住对局行并检查版本；最后请求 UUID 防止丢失响应后的重试重复执行。胜局结算和最佳成绩替换在同一事务中完成；数据库时钟再次检查 180 秒截止时间，避免 Edge 时钟偏差或并发造成无效入榜。成绩页始终读同一张共享表，没有将本地记录上传入榜的接口。

这可以阻止伪造时间、直接写分、读取未揭示雷图、冒用他人对局和重复提交。它不保证识别机器人或多邮箱账号，也不消除不同网络延迟的差异；正式高价值赛事仍需现场管理。

## 在 Supabase 中配置

本次未连接到真实 `GT-WuWa-Leaderboard` 项目：连接器返回的可访问项目列表为空。没有执行远端迁移、部署函数或更改 Auth。不要向聊天或 GitHub 文件粘贴数据库密码及服务端密钥。

1. 在 Supabase Dashboard 找到 `GT-WuWa-Leaderboard`，从 Settings / General 取得实际 **Project Ref**。项目名称不是 ref。
2. 在开发者电脑或有权限的环境安装 Supabase CLI，运行下列命令。新版本请先看 `--help`；本次使用 CLI 2.79.0 创建迁移文件并核对参数。`link` 需要时在交互提示中输入数据库密码。

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push --dry-run
supabase db push
supabase migration list
supabase functions deploy competition --project-ref YOUR_PROJECT_REF --use-api
```

`supabase/config.toml` 设置 `verify_jwt = false`：网关不按旧式 JWT key 验证，函数内部仍强制调用 Auth.getUser 验证用户 access token。不要删除函数中的认证检查。托管 Edge Runtime 自带 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`，这些变量仅存在于服务器；不需把它们放到 GitHub Pages。

3. Auth / Providers 开启 Email，允许新用户注册。Auth / Email Templates 的 **Magic Link** 模板加入 `{{ .Token }}`，例如：

```html
<h2>GT WuWa 参赛验证码</h2>
<p>在游戏页面输入：{{ .Token }}</p>
```

若项目新用户走独立确认邮件模板，Confirm signup 模板也显示验证码。前端使用 `verifyOtp({ email, token, type: 'email' })`，不使用邮件里的 magic-link URL。

4. 在 Auth / URL Configuration 中把 Site URL 配置为实际 Pages 地址（例如 `https://gtiit-rfs.github.io/GT-WuWa-Minesweeper/`）。邮箱验证码登录不依赖 hash 回调。
5. 活动前配置自有 SMTP 并核对发信额度及 Auth 限流；默认测试邮件服务可能只允许发给组织成员，不能承载现场报名。保留验证码过期与发送频率限制。
6. 在 Data API 设置确认 `public` schema 对 REST 开放。迁移已显式 GRANT 公开表 SELECT 权限；**不要**给客户端授予对局或成绩写权限。
7. 运行 Dashboard Security Advisor；如使用支持的 CLI 可运行 `supabase db advisors`。本次离线验证不能替代真实项目的 Advisor。
8. Settings / API Keys 获取 **publishable key**（`sb_publishable_...`）和 Project URL。前端只需要这两个公开参数；旧 anon key 可兼容。不要使用 secret key、service_role JWT 或数据库密码。

本地配置时复制 `.env.example` 为 `.env.local`，填写两个公开参数，再启动 `npm run dev`。环境文件已被 gitignore 排除；Vite 还会在打包前拒绝 secret/service_role 类型的前端 key，错误不会回显 key。

## 在 GitHub 中配置与合并

1. 仓库 Settings → Secrets and variables → Actions → **Variables** 中增加：
   - `VITE_SUPABASE_URL`：实际 Supabase Project URL。
   - `VITE_SUPABASE_PUBLISHABLE_KEY`：publishable key。
2. Settings → Pages → Source 继续使用 **GitHub Actions**。不需要更改现有 main 自动部署触发条件。
3. 为本功能分支创建 PR，base 选择 `main`，等待 Validate game 的单元、数据库、Deno、桌面及移动测试通过后合并。未改动 main。
4. 合并后原有 Pages 工作流会带入以上公开 Variables 重新构建并部署。以后改 Variables 后也要重新运行 Pages workflow，静态前端不会自动读取运行时变量。
5. 玩家地址：`https://gtiit-rfs.github.io/GT-WuWa-Minesweeper/#online`。
6. 投影地址：`https://gtiit-rfs.github.io/GT-WuWa-Minesweeper/#display`。点击原有全屏按钮；每屏 5 人、每 15 秒轮播，数据每 10 秒刷新。

不要把 `SUPABASE_SERVICE_ROLE_KEY`、数据库密码、管理 access token 配到 `VITE_*`。本方案不需要把服务端密钥加入 GitHub Actions。未设置公开参数的构建仍可部署和玩本地模式，在线入口会显示未配置提示。

## 验证命令与证据范围

```bash
npm ci
npm test
npm run build
npm run format:check
deno check --no-lock supabase/functions/competition/index.ts
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

本地测试分为：

- 原有扫雷引擎、配置、上传、特效、桌面 / 手机回归。
- HTTP 单元测试：拒绝伪造或缺失身份、非法方法、过大请求和无效 JSON；忽略客户端身份 / 棋盘 / 时间；安全错误响应。
- PGlite 集成测试：在真正的嵌入式 PostgreSQL 上执行原始迁移，验证 GRANT/RLS/RPC 权限、只保留最佳成绩、幂等、版本冲突、数据库计时、超时及活动关闭。Supabase 的 auth.users 和角色由测试夹具提供，不是连接托管 Supabase。
- Playwright 在线流程：邮件 Auth 与网络接口是模拟的；操作校验及扫雷规则使用实际共享服务端代码。测试登录、胜局、榜单、投影、手机插旗、断线响应重试、失败爆炸。测试环境使用固定假的 Project URL，绝不会写真实项目。
- Deno 类型检查覆盖真实 Edge 入口及 Supabase SDK 的类型，不代表已部署到真实 Edge Runtime。

Supabase changelog 的 HTTP 获取被当前网络策略拒绝（403），已通过 Supabase 文档连接器核对 Auth OTP、RLS、Edge Auth 的当前接口。CLI migration list --local 未完成，因为本环境没有运行完整 Supabase Docker 数据库；迁移已通过 PGlite 执行测试。

## 真实云端验收（待配置后执行）

1. 两个真实邮箱分别在手机、电脑登录；同一邮箱跨设备应显示同一最佳成绩。
2. A 赢一局后 B 的排行榜和无登录投影页应在 10 秒内刷新；同账号第二次较慢胜局不新增行，较快胜局替换；失败、超时不入榜。
3. 直接通过 REST 尝试客户端插入 / 修改 online_best_scores 或读取 online_rounds，应被拒绝。未认证或伪造 Bearer 调用 competition，应返回 401。
4. 玩到一半切换设备 / 刷新后用同账号开始，应恢复同一未超时对局；短暂断网后重试操作应只执行一次。两台设备同时操作时只有匹配版本的操作被接受，另一台提示重新连接。
5. 留置未翻格或游戏中对局 180 秒后操作，服务器必须返回超时且不入榜。
6. 检查真实项目 Security Advisor、Edge/Auth 日志、邮件额度和函数延迟。活动前使用现场 Wi-Fi / 手机网络完成一次投影与多人联调。

这些步骤目前均**未完成**，不能将本地模拟通过写成真实云端通过。

## 活动关闭、保留与回退

在管理员 SQL Editor 运行：

```sql
update public.online_competitions set enabled = false where id = 'club-night-v1';
```

停止新局和后续操作入榜，已有排行榜保持可读。重新开启设为 true。再次活动若需要独立清榜 / 历史场次，应另写迁移和前后端赛事实例配置，不要直接混用旧赛季成绩。

活动后管理员可按保留策略清理过期对局状态：

```sql
delete from public.online_rounds
where started_at < now() - interval '7 days';
```

最佳成绩不依赖对局外键，清理不会删除排行榜。Auth 用户删除会级联删除其对局和成绩。公开昵称请避免使用邮箱等个人信息；素材仍只保存在玩家本机，不上传到 Supabase。

前端回退可撤销本次 PR 或移除两项公开构建变量后重新部署；原有本地模式和成绩存储键未更改。数据库表是新增的，可先禁用赛事保留数据，无需执行破坏性 DROP。没有自动执行远端部署或清理的工作流。
