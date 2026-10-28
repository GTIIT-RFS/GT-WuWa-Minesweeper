import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  adminRequest,
  readAdmin,
  staffSupabase,
  testAdminSettle,
  testAdminAction,
} from '../online/client';
import type { AdminData } from '../../supabase/functions/_shared/event-types';
import { awardLabels, beijing, csvCell } from '../online/presentation';
function localInput(value: string): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function formValues(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
}
export function EventAdmin() {
  const [claimPrefill] = useState(() => {
    const query = new URLSearchParams(location.hash.split('?')[1]);
    return {
      awardId: query.get('award') ?? '',
      credential: query.get('credential') ?? '',
      testMode: query.get('test') === '1',
    };
  });
  useEffect(() => {
    if (location.hash.startsWith('#event-admin?'))
      history.replaceState(null, '', `${location.pathname}${location.search}#event-admin`);
  }, []);
  const [session, setSession] = useState<Session | null>(null);
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const requestEpoch = useRef(0);
  const [page, setPage] = useState(0);
  const [pending, setPending] = useState<{
    operation: string;
    payload: Record<string, unknown>;
    requestId: string;
  } | null>(null);
  useEffect(() => {
    if (!staffSupabase) return;
    const {
      data: { subscription },
    } = staffSupabase.auth.onAuthStateChange((_event, next) => {
      requestEpoch.current++;
      setSession(next);
      setData(null);
    });
    return () => subscription.unsubscribe();
  }, []);
  const refresh = useCallback(async () => {
    const epoch = ++requestEpoch.current;
    try {
      const next = await readAdmin(page);
      if (epoch !== requestEpoch.current) return;
      setData(next);
      setError('');
    } catch (e) {
      if (epoch !== requestEpoch.current) return;
      setData(null);
      setError((e as Error).message);
    }
  }, [page]);
  useEffect(() => {
    if (!session) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => window.clearInterval(timer);
  }, [session?.access_token, refresh]);
  async function login(form: HTMLFormElement) {
    if (!staffSupabase || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const fields = formValues(form);
    try {
      const { error } = await staffSupabase.auth.signInWithPassword({
        email: fields.email,
        password: fields.password,
      });
      if (error) throw new Error('工作人员登录失败，请检查账号与密码。');
      form.reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function send(task: NonNullable<typeof pending>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setPending(task);
    setError('');
    setMessage('');
    try {
      const result =
        task.operation === 'test_settle'
          ? await testAdminSettle(task.requestId)
          : task.operation.startsWith('test:')
            ? await testAdminAction(task.operation.slice(5), task.payload, task.requestId)
            : await adminRequest(task.operation, task.payload, task.requestId);
      setPending(null);
      setMessage(
        result.replayed ? '已确认上次操作结果，未重复执行。' : '操作已由服务器确认并记入审计。',
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function action(operation: string, payload: Record<string, unknown>) {
    if (pending || lock.current) return;
    void send({ operation, payload, requestId: crypto.randomUUID() });
  }
  function exportCsv() {
    if (!data) return;
    const lines = [
      [
        '轮次',
        '真实排名',
        '礼品名额',
        '昵称',
        '通关毫秒',
        '领取状态',
        '是否顺延',
        '领取时间（北京时间）',
      ],
      ...data.overview.awards.map((a) => [
        a.round_no,
        a.rank,
        a.prize_slot,
        a.display_name,
        a.elapsed_ms,
        awardLabels[a.status],
        a.predecessor_id ? '是' : '否',
        a.claimed_at ? beijing(a.claimed_at, true) : '',
      ]),
    ];
    const blob = new Blob(
      ['\uFEFF' + lines.map((row) => row.map(csvCell).join(',')).join('\r\n')],
      { type: 'text/csv;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `GT-WuWa-${data.overview.event.event_date ?? 'event'}-获奖记录.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const disabled = busy || !!pending;
  return (
    <section className="panel event-admin">
      <span className="eyebrow">EVENT CONTROL / 工作人员后台</span>
      <h1>赛事与领奖管理</h1>
      <p>
        工作人员使用预先创建的非匿名账号登录；每次操作都由服务器检查管理员名单。此会话与参赛匿名身份分开保存，无需邮件验证码或
        SMTP。
      </p>
      {!staffSupabase ? (
        <p role="status">在线服务尚未配置。</p>
      ) : !session ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void login(e.currentTarget);
          }}
          className="admin-login"
        >
          <label>
            工作人员邮箱
            <input type="email" name="email" autoComplete="username" required />
          </label>
          <label>
            工作人员密码
            <input type="password" name="password" autoComplete="current-password" required />
          </label>
          <button className="primary" disabled={busy}>
            登录工作人员后台
          </button>
        </form>
      ) : (
        <>
          <div className="online-toolbar">
            <span>工作人员会话 · {session.user.email ?? session.user.id}</span>
            <button disabled={busy} onClick={() => void staffSupabase!.auth.signOut()}>
              退出工作人员账号
            </button>
            <button onClick={() => void refresh()}>刷新管理数据</button>
            <a href="#display" target="_blank" rel="noreferrer">
              查看完整冻结排名与投影
            </a>
          </div>
          {!data && !error && <p role="status">正在核验管理员权限…</p>}
          {data && (
            <>
              <div className="admin-status">
                <strong>
                  {!data.overview.event.enabled || data.overview.event.paused
                    ? '比赛已暂停'
                    : '比赛未暂停'}
                </strong>
                <span>服务器北京时间 {beijing(data.overview.serverNow, true)}</span>
                <span>当前轮次：{data.overview.currentStage?.round_no ?? '无开放轮次'}</span>
              </div>
              <div className="admin-grid">
                <section>
                  <h2>活动日期与运行状态</h2>
                  <form
                    key={data.overview.event.event_date ?? 'unset'}
                    onSubmit={(e) => {
                      e.preventDefault();
                      action('configure', { date: formValues(e.currentTarget).date });
                    }}
                  >
                    <label>
                      正式活动日期（北京时间）
                      <input
                        type="date"
                        name="date"
                        defaultValue={data.overview.event.event_date ?? ''}
                        required
                      />
                    </label>
                    <button disabled={disabled}>保存日期并生成默认四轮</button>
                  </form>
                  <p className="muted">默认 18:00–22:00，每轮 60 分钟；已开始的赛事不能改日期。</p>
                  <button
                    disabled={disabled}
                    onClick={() =>
                      action('pause', {
                        paused: !(!data.overview.event.enabled || data.overview.event.paused),
                      })
                    }
                  >
                    {!data.overview.event.enabled || data.overview.event.paused
                      ? '恢复比赛'
                      : '紧急暂停比赛'}
                  </button>
                  <p className="muted">暂停期间不能开新局或推进操作，计时不会停止。</p>
                  <button disabled={disabled} onClick={() => action('settle', {})}>
                    补执行到期轮次结算
                  </button>
                  <p>只处理已到截止时间且未结算的正式轮次；冻结结果不会重算。</p>
                  <div className="test-mode-admin">
                    <h3>独立在线测试场</h3>
                    <p>
                      测试场长期开放。此操作只结算测试轮次、生成测试排名与测试凭证，并立即开启新测试轮次；不会修改正式赛程或正式领奖记录。
                    </p>
                    <button disabled={disabled} onClick={() => action('test_settle', {})}>
                      立即结算测试轮次并开启新一轮
                    </button>
                  </div>
                </section>
                <section>
                  <h2>四轮赛程与名额</h2>
                  {data.overview.stages.map((s) => (
                    <article key={s.id} className="stage-editor">
                      <h3>
                        第 {s.round_no} 轮 {s.settled_at ? '· 已冻结' : ''}
                      </h3>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = formValues(e.currentTarget);
                          action('schedule', {
                            stageId: s.id,
                            startsAt: `${f.start}:00+08:00`,
                            endsAt: `${f.end}:00+08:00`,
                            reason: f.reason,
                          });
                        }}
                      >
                        <label>
                          开始（北京时间）
                          <input
                            type="datetime-local"
                            name="start"
                            defaultValue={localInput(s.starts_at)}
                            required
                          />
                        </label>
                        <label>
                          结束（北京时间）
                          <input
                            type="datetime-local"
                            name="end"
                            defaultValue={localInput(s.ends_at)}
                            required
                          />
                        </label>
                        <label>
                          调整原因
                          <input name="reason" minLength={2} maxLength={200} required />
                        </label>
                        <button
                          disabled={
                            disabled ||
                            Date.parse(s.starts_at) <= Date.parse(data.overview.serverNow)
                          }
                        >
                          保存未开始轮次安排
                        </button>
                      </form>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          action('prizes', {
                            stageId: s.id,
                            count: Number(formValues(e.currentTarget).count),
                          });
                        }}
                      >
                        <label>
                          礼品名额
                          <input
                            type="number"
                            name="count"
                            min={0}
                            max={20}
                            defaultValue={s.prize_count}
                            required
                          />
                        </label>
                        <button
                          disabled={
                            disabled ||
                            !!s.settled_at ||
                            Date.parse(s.ends_at) <= Date.parse(data.overview.serverNow)
                          }
                        >
                          保存礼品名额
                        </button>
                      </form>
                    </article>
                  ))}
                </section>
              </div>
              <h2>本轮实时前十名</h2>
              <ol className="admin-ranking">
                {data.overview.live.entries.map((s) => (
                  <li key={s.player_id}>
                    #{s.rank} {s.display_name} · {(s.elapsed_ms / 1000).toFixed(3)} 秒
                  </li>
                ))}
              </ol>
              <div className="online-toolbar">
                <h2>冻结名次与实际领奖</h2>
                <button onClick={exportCsv}>导出 CSV 获奖记录</button>
              </div>
              <p>
                请现场核验同一真实参与者整晚只领一次。使用统一的手环／贴纸编号；不要录入身份证、学号或手机号。相同昵称不能证明是同一人。
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>轮次</th>
                      <th>真实排名</th>
                      <th>礼品名额</th>
                      <th>昵称</th>
                      <th>通关</th>
                      <th>状态</th>
                      <th>记录编号</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.overview.awards.map((a) => (
                      <tr key={a.id}>
                        <td>{a.round_no}</td>
                        <td>#{a.rank}</td>
                        <td>
                          {a.prize_slot}
                          {a.predecessor_id ? '（顺延）' : ''}
                        </td>
                        <td>{a.display_name}</td>
                        <td>{(a.elapsed_ms / 1000).toFixed(3)} 秒</td>
                        <td>{awardLabels[a.status]}</td>
                        <td>
                          <code>{a.id}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {claimPrefill.testMode && (
                <section className="panel test-claim-panel">
                  <h2>测试领奖核验（不发放实物）</h2>
                  <p className="test-mode-notice">
                    只用于测试凭证核验与防重复领取逻辑。请勿录入真实姓名、学号、手机号或其他个人敏感信息。
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = formValues(e.currentTarget);
                      action('test:claim', {
                        awardId: f.awardId,
                        credential: f.credential,
                        participantRef: f.participantRef,
                        verifiedInPerson: f.verified === 'yes',
                      });
                    }}
                  >
                    <label>
                      测试获奖记录
                      <input name="awardId" defaultValue={claimPrefill.awardId} required />
                    </label>
                    <label>
                      一次性测试凭证
                      <input
                        name="credential"
                        defaultValue={claimPrefill.credential}
                        autoComplete="off"
                        maxLength={100}
                        required
                      />
                    </label>
                    <label>
                      测试参与编号
                      <input name="participantRef" autoComplete="off" maxLength={64} required />
                    </label>
                    <label className="checkbox-label">
                      <input type="checkbox" name="verified" value="yes" required />
                      已确认这是测试记录，不代表真实现场核验
                    </label>
                    <button className="primary" disabled={disabled}>
                      确认测试领取
                    </button>
                  </form>
                </section>
              )}
              <div className="admin-grid" hidden={claimPrefill.testMode}>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = formValues(e.currentTarget);
                    action('claim', {
                      awardId: f.awardId,
                      credential: f.credential,
                      participantRef: f.participantRef,
                      verifiedInPerson: f.verified === 'yes',
                    });
                  }}
                >
                  <h3>现场核验并发放奖品</h3>
                  <label>
                    获奖记录
                    <select name="awardId" defaultValue={claimPrefill.awardId} required>
                      <option value="">请选择</option>
                      {data.overview.awards
                        .filter((a) => ['pending', 'unclaimed'].includes(a.status))
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            第{a.round_no}轮 · 礼品{a.prize_slot} · {a.display_name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    玩家设备上的一次性凭证
                    <input
                      name="credential"
                      defaultValue={claimPrefill.credential}
                      autoComplete="off"
                      maxLength={100}
                      required
                    />
                  </label>
                  <label>
                    现场手环／贴纸编号
                    <input name="participantRef" autoComplete="off" maxLength={64} required />
                  </label>
                  <label className="checkbox-label">
                    <input type="checkbox" name="verified" value="yes" required />
                    已现场核验本人，并确认整晚未领取过奖品
                  </label>
                  <button className="primary" disabled={disabled}>
                    确认领奖
                  </button>
                </form>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = formValues(e.currentTarget);
                    action(f.operation, { awardId: f.awardId, status: f.status, reason: f.reason });
                  }}
                >
                  <h3>未领取、放弃、违规及顺延</h3>
                  <label>
                    获奖记录
                    <select name="awardId" required>
                      <option value="">请选择</option>
                      {data.overview.awards.map((a) => (
                        <option key={a.id} value={a.id}>
                          第{a.round_no}轮 · 礼品{a.prize_slot} · {a.display_name} ·{' '}
                          {awardLabels[a.status]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    操作
                    <select name="operation">
                      <option value="status">更改领奖资格／状态</option>
                      <option value="rollover">已放弃／取消资格后顺延下一人</option>
                    </select>
                  </label>
                  <label>
                    目标状态
                    <select name="status">
                      <option value="unclaimed">标记未领奖</option>
                      <option value="waived">放弃领奖</option>
                      <option value="disqualified">取消违规资格</option>
                    </select>
                  </label>
                  <label>
                    原因与现场处理记录
                    <input name="reason" minLength={2} maxLength={200} required />
                  </label>
                  <button disabled={disabled}>提交有审计记录的处理</button>
                  <p className="muted">
                    先标记放弃或取消资格，再顺延。已发出礼品的违规处理需记录实物处置；原始排名不会被覆盖。
                  </p>
                </form>
              </div>
              <h2>全部有效通关历史（每页 100 条）</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>昵称</th>
                      <th>轮次编号</th>
                      <th>用时</th>
                      <th>服务器完成时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.wins.map((w) => (
                      <tr key={w.id}>
                        <td>{w.display_name}</td>
                        <td>{data.overview.stages.find((s) => s.id === w.stage_id)?.round_no}</td>
                        <td>{(w.elapsed_ms / 1000).toFixed(3)} 秒</td>
                        <td>{beijing(w.achieved_at, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h2>管理员操作审计（每页 100 条）</h2>
              {data.audit.map((a) => (
                <details key={a.id}>
                  <summary>
                    #{a.id} · {beijing(a.created_at, true)} · {a.action} ·{' '}
                    {a.actor_id ?? '服务端定时任务'} · {a.reason ?? ''}
                  </summary>
                  <pre>{JSON.stringify({ before: a.old_state, after: a.new_state }, null, 2)}</pre>
                </details>
              ))}
              <div className="online-toolbar">
                <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
                  上一页管理记录
                </button>
                <span>第 {page + 1} 页</span>
                <button
                  disabled={data.wins.length < 100 && data.audit.length < 100}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页管理记录
                </button>
              </div>
            </>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {pending && !busy && (
        <div className="online-toolbar">
          <button onClick={() => void send(pending)}>重试同一管理请求</button>
          <button
            onClick={() => {
              setPending(null);
              void refresh();
            }}
          >
            放弃重试并刷新状态
          </button>
        </div>
      )}
      <a href={claimPrefill.testMode ? '#online-test' : '#online'}>
        {claimPrefill.testMode ? '返回在线测试场' : '返回参赛与榜单'}
      </a>
    </section>
  );
}
