# 匿名四轮竞速赛：中文版部署与现场操作说明

本说明对应 `codex/anonymous-rounds-rewards`，在第一阶段分支上继续开发。原本的本地游戏、素材、音效、爆炸和 Pages 工作流保留。**本次开发未修改生产数据库、未部署生产函数、未启用生产 Cron、未合并 main。以下生产操作需要项目负责人另行确认后执行。**

## 1. 本次交付是什么

- 玩家只输入 1–16 字昵称，首次参赛时创建真实 Supabase 匿名用户；刷新恢复原会话，不需要邮箱、手机、密码或 SMTP。
- 活动日期必须由管理员填写，默认不配置日期、不开放赛事。全部显示采用北京时间，数据库保存 UTC。
- 默认四轮：18:00–19:00、19:00–20:00、20:00–21:00、21:00–22:00；每轮 60 分钟，最后 3 分钟不再开新局。服务端采用左闭右开时间区间。
- 每局 8×8、10 雷、180 秒，服务器控制棋盘、计时和有效胜局。网络与暂停期间用时继续累计。本地自由游戏不会上传为正式成绩。
- 每次胜局写入历史，每轮各自保留最快成绩，上一轮更快不妨碍下一轮正常排名。
- 服务端按本轮最佳时间、完成时间、用户 UUID 排序，结算生成完整冻结排名，默认给前三名创建待核验奖品资格。
- 当前榜前十、个人排名、完整分页历史榜、整晚荣誉总榜；普通页面每 10 秒刷新，投影每 5 秒刷新，每屏 5 人并轮播。
- 结算后投影展示约 10 秒揭晓动画；下一轮由服务器时间独立开放，不等待动画结束。22:00 后默认显示整晚总榜和获奖名单。
- 私人领奖页显示当前会话自己的凭证及二维码；工作人员密码登录后核验、核销、标记未领／放弃／违规、顺延和导出 CSV。

匿名身份只能标识一个账号，无法证明一个自然人唯一。清除网站数据、退出匿名会话、换浏览器或换手机，可能无法再找回原身份及私人领奖凭证。**不同手机默认是不同匿名账号**，共享的是全场成绩与榜单，不是自动共享匿名身份。

## 2. 准备和权限边界

实际 Supabase 项目：`GT-WuWa-Leaderboard`，Project Ref：`baktoksfqdavmzyiortt`。项目负责人需要有 Dashboard、SQL Editor、Auth、Functions、Cron 和 GitHub 仓库设置权限。

先保留数据库备份或导出需要保留的数据。在测试项目验证升级后，再由负责人决定正式操作窗口。升级会替换第一阶段两个计分 RPC 的实现，但不删除原表和旧成绩，不导入旧成绩作为正式分轮成绩。原始迁移文件不能重放。

## 3. 先核对迁移历史，不要直接运行 db push

此前只读核对发现：

| 内容                     | 实际编号                                                 |
| ------------------------ | -------------------------------------------------------- |
| 线上安全修正迁移         | `20261027141909_restrict_rls_auto_enable_public_execute` |
| 线上第一阶段迁移         | `20261027141938_online_competition`                      |
| 仓库第一阶段文件         | `20261027130453_online_competition.sql`                  |
| **本次唯一新增升级迁移** | **`20261027164336_anonymous_event_rounds.sql`**          |

线上和本地的第一阶段版本号不同。**不要直接运行 `supabase db push`、不要执行旧初始化 SQL、不要删除旧迁移历史，也不要为了消除提示随意标记旧版本 reverted。** 本次使用下面的“只执行新增文件”路径，避免重建已有表。

1. Dashboard 打开正确项目 → SQL Editor → 新建查询。
2. 打开仓库 `supabase/ops/preflight_event_upgrade.sql`，复制内容执行。这个文件只读。
3. 确认三张 online 表存在，`upgrade_already_present` 为空，新增版本尚未记录。若 `event_stages` 已存在或新版本已记录，先检查是否已经升级，不要重复运行。
4. 打开且**仅打开** `supabase/migrations/20261027164336_anonymous_event_rounds.sql`，复制完整内容到一条新查询，确认后执行一次。文件包含事务，失败时整条回滚，不应通过手动删表来重试。
5. 成功后应出现 `event_stages`、`event_wins`、`event_bests`、`event_rankings`、`event_awards`、`event_credentials`、`event_claims`、`event_admins`、`event_audit` 九张新表，所有新表都开启 RLS；`online_rounds` 增加 stage_id。日期仍未设置，此时比赛不开赛。
6. 执行一次 Dashboard Security Advisor。公开浏览器只可读公开投影表，不能读隐藏棋盘、私人凭证、管理员表、领奖核销登记或审计表，也不能写分数／快照／领奖状态。

有 CLI 的工作人员可用以下等价路径，二选一，**不要两种路径各执行一次**。本次核对过 CLI 2.79.0 的参数；较新 CLI 先看 `--help`。

```bash
supabase login
supabase link --project-ref baktoksfqdavmzyiortt
supabase db query --linked --file supabase/ops/preflight_event_upgrade.sql
supabase db query --linked --file supabase/migrations/20261027164336_anonymous_event_rounds.sql
```

SQL Editor 或 `db query` 执行迁移不会自动登记 CLI 迁移历史。**确认升级 SQL 已成功执行后**，再登记且只登记本次新增版本：

```bash
supabase migration repair 20261027164336 --status applied --linked
supabase migration list
```

`repair --status applied` 只更新迁移历史，不重新执行建表语句。这里没有修改两条既有线上迁移。旧版本映射差异仍需后续单独整理后，才能恢复通用 `db push` 工作流；不要把这一步误读为允许重放仓库初始化文件。只使用 Dashboard 的负责人可请有 CLI 权限的维护者完成登记。

## 4. 开启匿名认证，取消玩家邮件依赖

Dashboard → Authentication → Sign In / Providers：开启 **Anonymous Sign-Ins**，允许创建新用户。玩家端不再调用邮件验证码接口，也不需要配置 SMTP。

匿名用户与普通用户一样使用 PostgreSQL `authenticated` 角色。新迁移同时限制 `anon`、`authenticated` 的私有数据和写权限；不要给这两个角色追加写入策略，也不要开放对计分及管理 RPC 的直接执行权。

工作人员仍需要预先创建的邮箱＋密码账号，因此不要为了取消玩家邮箱验证而关闭工作人员的 Email/password 登录方式。工作人员账号可以由管理端直接创建并确认，不需要给玩家发邮件。

## 5. 免费防机器人：Turnstile

Supabase 官方建议匿名登录启用 CAPTCHA。Cloudflare Turnstile 提供免费使用方案，免费方案的站点／widget、功能和使用条件以官方当期说明为准；不需要把网站迁入 Cloudflare，也不需要付费 SMTP。

1. 到 Cloudflare Turnstile 管理页创建 widget，允许真实 GitHub Pages 域名 `gtiit-rfs.github.io`，测试域名单独添加。
2. 取得 **site key** 和 **secret key**。
3. Dashboard → Auth 的 Bot and Abuse Protection / CAPTCHA 设置，选择 Turnstile，把 **secret key 只放在 Supabase 的服务器设置中**。
4. 把 **site key** 放入 GitHub Actions Variable `VITE_TURNSTILE_SITE_KEY`。它是公开参数。
5. 新版页面在首次匿名创建时显示验证组件，调用 `signInAnonymously({ options: { captchaToken } })`；已有会话恢复不会重复注册账号或要求新验证码。
6. 若 Supabase 已强制 CAPTCHA 而前端未配置 site key，匿名创建会失败。必须两端一起配置。测试项目未启用 CAPTCHA 时可以不填 site key。

Auth 匿名创建存在 IP 限流。官方文档说明默认可能是每 IP 每小时 30 次；活动前检查实际 Dashboard 设置，校园 Wi-Fi/NAT 会让多位玩家共用出口。不要仅用 IP 识别玩家，也不要直接关闭防护；在 CAPTCHA 开启后由负责人根据预计人数合理调整，并用两台共用 Wi-Fi 的手机实测。

参考：[Supabase 匿名登录](https://supabase.com/docs/guides/auth/auth-anonymous)、[Auth CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha)、[Turnstile 方案](https://developers.cloudflare.com/turnstile/plans/)。不在前端放 CAPTCHA secret、service_role、sb_secret 或数据库密码。

## 6. 部署唯一需要更新的 Edge Function

需要重新部署：**`competition`**。`_shared` 目录会随函数一同打包，不是需要单独部署的函数。

```bash
supabase functions deploy competition --project-ref baktoksfqdavmzyiortt --use-api
```

`supabase/config.toml` 保留 `verify_jwt = false`，因为函数内部通过 `auth.getUser(token)` 验证真正的用户 access token，支持公开 publishable key；关闭的是旧网关 JWT 检查，不是取消业务认证。

服务器允许合法匿名用户，拒绝缺失／伪造身份的操作；管理请求还要验证非匿名身份和私有管理员名单。不要删除内部鉴权。托管运行环境提供 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY`，它们只在 Edge 服务端读取，不能复制到 GitHub 前端变量。

## 7. 安全创建工作人员

1. Dashboard → Authentication → Users → Add/Create user，直接创建一个工作人员账号，填写工作人员邮箱和强密码，使用已确认／Auto confirm 方式。不要使用邀请邮件来代替创建密码账号。
2. 复制这个账号的 User UID。它必须不是匿名用户。
3. 打开 `supabase/ops/bootstrap_event_admin.sql`，将 `REPLACE_WITH_STAFF_AUTH_UUID` 替换为该 UID；不要把密码写进 SQL。
4. 由负责人确认后在 SQL Editor 执行这个单独脚本。它只给已经存在的非匿名用户授予赛事管理员资格。
5. 网站打开 `#event-admin` 或页面底部「赛事后台」，使用邮箱和密码登录。
6. 后台的“工作人员会话”使用独立存储键，不覆盖同一浏览器的参赛匿名身份。隐藏按钮、前端布尔值、公开口令均不能授权管理。
7. 需要移除管理员时，由负责人从 `event_admins` 删除相应 UID。每次管理请求都会重新检查数据库名单；不要只依赖旧 JWT 中的标志。

## 8. 配置活动日期与默认四轮

在赛事后台填写 **正式活动日期（北京时间）**，点击「保存日期并生成默认四轮」。系统不会替你猜测活动日期。

确认默认安排：

| 轮次 | 开放  | 停止新开局 | 截止／结算 |
| ---- | ----- | ---------- | ---------- |
| 1    | 18:00 | 18:57      | 19:00      |
| 2    | 19:00 | 19:57      | 20:00      |
| 3    | 20:00 | 20:57      | 21:00      |
| 4    | 21:00 | 21:57      | 22:00      |

数据库转换为 UTC，页面统一显示北京时间，不以手机日期决定有效性。每局的开始、结束确认及成绩归属都由数据库时间裁定。截止前点击但截止后才被数据库确认的通关不会入榜。

开始前可在有原因和审计的情况下调整未开始轮次，仍须每轮 60 分钟、顺序正确、不得重叠；默认正式安排严格如上。已经开始的轮次不能修改时间。每轮未结算前可调整 0–20 个奖品名额，默认 3 个；不足人数时只为实际有效选手生成资格，不虚构获奖者。

“紧急暂停”会停止开新局及推进操作，但不暂停计时，已经到截止的轮次仍可结算。恢复比赛不会复活过期对局或改变冻结排名。

## 9. 由负责人启用服务端 Cron

本任务不会自动启用生产 Cron。操作代码已准备在 `supabase/ops/enable_event_cron.sql`，它不放在自动迁移目录。

1. Dashboard → Integrations / Cron 或 Database / Extensions，启用 Supabase Cron / `pg_cron`。
2. 由负责人确认后，在 SQL Editor 执行该脚本。它创建或更新名为 `gt-wuwa-settle-rounds` 的任务，每分钟执行：

```sql
select public.event_settle_due();
```

3. Dashboard Cron 中确认任务 active，观察 run history。它直接在数据库运行，无需 HTTP、SMTP、外部服务器或定时服务密钥。
4. 整点任务扫描预先配置的截止时间，按已确认且落在 `[starts_at, ends_at)` 的胜局结算。任务稍晚执行不会接纳超时成绩；任务停了也不能让超时成绩入榜。
5. 每分钟扫描在整点触发结算，并为漏跑提供补偿。实际执行可受平台调度延迟影响；名次截止仍精确，名单在首次成功执行后可见。网页关闭不影响任务。
6. 重复执行幂等，数据库事务与同一赛事锁保护计分／结算／领奖一致性。已冻结轮次不会重算；下一轮开放不依赖上一轮结算或前端动画。
7. 需要补执行时，可用工作人员后台「补执行到期轮次结算」。它只能补尚未结算的到期轮次，不会提前结算或重写旧名单。
8. 临时关闭 Cron：

```sql
select cron.unschedule('gt-wuwa-settle-rounds');
```

免费条件以 Supabase 项目配额为准。普通页面 10 秒一次概览请求、投影 5 秒一次；100 人连续打开 4 小时约 144,000 次普通概览请求，另有操作、Auth、领奖和管理请求。活动前检查项目剩余函数调用、数据库和 Auth 额度；无需额外付费定时服务器并不意味着任意人数、无限调用都免费。

## 10. GitHub Pages 配置与发布

仓库 Settings → Secrets and variables → Actions → **Variables**：

| 变量                            | 填什么                                             |
| ------------------------------- | -------------------------------------------------- |
| `VITE_SUPABASE_URL`             | `https://baktoksfqdavmzyiortt.supabase.co`         |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 当前项目的 `sb_publishable_...`，或兼容旧 anon key |
| `VITE_TURNSTILE_SITE_KEY`       | 开启 CAPTCHA 时填公开 site key，未使用时留空       |

不要添加 `VITE_SUPABASE_SERVICE_ROLE_KEY`、数据库密码或工作人员密码。打包会拒绝 secret/service_role 类型的前端 key，错误不回显密钥。

Pages 的 Source 保持 GitHub Actions。本功能 PR 优先目标为 `codex/online-leaderboard-phase1`，等待检查后由维护者决定合入；**合入开发基础分支不会自动修改 main 或发布正式网站**。待产品与真实云端验收通过，再单独批准合并 main。main 的既有 Pages 自动部署流程保留，配置变量后需重新构建，不是运行时动态读取。

部署后的页面地址：

- 玩家：`https://gtiit-rfs.github.io/GT-WuWa-Minesweeper/#online`
- 投影：同地址 `#display`，浏览器全屏；二维码直接进入玩家页。
- 私人领奖：`#awards`，只显示当前会话自己的凭证。
- 工作人员：`#event-admin`。

## 11. 现场领奖与顺延流程

1. 每轮前三名是**待现场核验候选人**，不是自动证明其为三个不同自然人。
2. 获奖者保持原手机、原浏览器、原匿名会话，打开「我的领奖凭证」。页面显示轮次、真实名次、用时、领取状态和服务端生成的一次性凭证。
3. 工作人员可扫描玩家设备上的**私人领奖二维码**进入核验后台；也可选中对应记录并复制／输入凭证。私人二维码包含一次性凭证，不能公开分享、投影或当宣传二维码。
4. 私人链接把凭证放在 URL fragment 中，不发送为 HTTP query；进入后台会立即从地址栏移除。凭证仅临时用于表单，不保存到工作人员 localStorage，也不进入公开榜单、CSV 或审计内容。
5. 人工核验本人，以及其整晚是否已领取。建议统一发放带编号的贴纸／手环；在后台录入同一个非敏感编号并勾选已现场核验。不要录入学号、手机号或身份证。
6. 点击确认领奖。数据库校验凭证、资格、账号及现场编号记录；每个凭证只成功核销一次。网络失败用“重试同一管理请求”，不会二次发奖或新增重复审计。
7. 同账号已经领奖时，再次上榜仍保留真实排名；后台不能再给该账号核销第二份奖品。不同匿名账号是否属于同一自然人仍靠现场核验和一致的编号。
8. 不领奖时标记未领奖；明确放弃则标记放弃；违规则记录原因取消资格。已发礼品的违规处理必须在原因中记录实物处置。取消资格不会抹掉原始排名，也不会自动清除已领登记来再送一份。
9. 按事先公示规则先标记放弃／违规，再执行顺延。系统选择本轮下一位尚无奖品记录、且同账号未领取的合格名次；工作人员仍须核验自然人唯一。原候选记录保留，新记录关联前任，真实排名与礼品名额分开。
10. 后台 CSV 导出不包含凭证；显示轮次、真实名次、礼品名额、昵称、用时、领取状态、顺延及领取时间。昵称以公式开头时会做电子表格公式转义。
11. 管理员审计记录操作者、服务器时间、轮次、原状态、新状态及原因；快照和审计不可在普通流程中修改或删除。

## 12. 两台手机真实联机验收

此清单须在获准部署的新版本和真实有效赛程中执行。开发测试里的 2030 年日期只是隔离夹具，绝不能复制为正式日期。

1. A、B 两台手机扫描投影入口二维码，各填不同昵称。不得看到邮箱验证码要求。各自应创建不同匿名 UID。
2. A 刷新后重新开始应恢复原 UID 和尚未超时的同一对局，不能每次刷新新增匿名用户。
3. A 有效通关后，A 显示自己的排名；B 和无登录投影在刷新周期内能看到 A 的成绩。B 通关后两边看到一致排序。
4. A 同轮更慢胜局不替换最佳，更快胜局替换；失败／超时不入榜。下一轮 A 可用新的轮内成绩排名，不被上一轮最佳挡住。
5. 使用同一个校园 Wi-Fi 测试匿名注册和 CAPTCHA 限流；短暂切换网络后重试同一步，确认操作只执行一次。
6. 在每轮停止新局时间后，已有对局可继续，另一个账号不能新开局；截止后确认的成绩无效。
7. 19/20/21/22 点检查 Cron、冻结榜单、前三名候选、10 秒投影揭晓和下一轮独立开放；22 点后无新局，历史不丢失。
8. 获奖设备打开私有凭证，另一台手机不能凭改 userId 读取它。公开榜单和浏览器公开数据里没有凭证。
9. 工作人员扫描私码登录后台，核销一次；重复核销应拒绝或安全返回同请求已完成。另一普通／匿名账号不能进入管理控件或操作领奖。
10. 试一次放弃与顺延，确认历史真实排名没有被改写，后台审计出现原记录、新获奖者及原因。
11. 检查 Auth、Edge、Cron 日志与 Dashboard Advisor，核对函数调用配额和现场网络延迟。

## 13. 测试证据、维护与回退

执行命令、结果和未覆盖范围见 [赛事验证记录](EVENT-VALIDATION.md)。开发环境只跑本地／模拟网络：PGlite 执行真实 SQL 和实际业务函数，Auth 的用户及会话由夹具提供。没有声称真实 Supabase 的匿名注册、Turnstile、Cron、SMTP 无关的工作人员登录或多人网络已验收。

旧 `docs/ONLINE-LEADERBOARD.md` 是第一阶段邮箱方案存档，本文件覆盖它的部署路径。不要使用旧部署说明重放初始化 SQL。

紧急停止时优先后台暂停并保留数据，或由负责人停用 Cron。前端可保留本地模式。不要为回退删数据库、删 Auth 用户或禁用 RLS；胜局引用原对局以保留审计，盲目清理旧对局／匿名用户可能被历史外键阻止。后续数据保留和账号清理应另做经过审核的方案。

升级后的计分 RPC 执行四轮规则，不能简单把旧邮箱在线界面当成完整回退。原有本地自由游戏、素材和本机排行榜的存储键没有更改；没有在线配置时仍可使用它们。
