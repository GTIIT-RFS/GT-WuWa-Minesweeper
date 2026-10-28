import { useEffect, useState } from 'react';
import { readAwards, supabase } from '../online/client';
import type { Award } from '../../supabase/functions/_shared/event-types';
import { awardLabels } from '../online/presentation';
import QRCode from 'qrcode';
function PrivateClaimQr({ award }: { award: Award }) {
  const [image, setImage] = useState('');
  const url = `${location.origin}${location.pathname}#event-admin?award=${encodeURIComponent(award.id)}&credential=${encodeURIComponent(award.token!)}`;
  useEffect(() => {
    let stopped = false;
    void QRCode.toDataURL(url, { width: 220, margin: 2 })
      .then((value) => {
        if (!stopped) setImage(value);
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [url]);
  return image ? (
    <img
      className="private-claim-qr"
      src={image}
      alt="仅供工作人员扫描的私人领奖二维码"
      width="220"
      height="220"
    />
  ) : null;
}
export function AwardWallet() {
  const [awards, setAwards] = useState<Award[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!supabase) return;
    let stopped = false;
    let timer: number;
    async function poll() {
      try {
        const rows = await readAwards();
        if (!stopped) {
          setAwards(rows);
          setError('');
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
      if (!stopped) timer = window.setTimeout(() => void poll(), 5000);
    }
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);
  return (
    <section className="panel award-wallet">
      <span className="eyebrow">MY REWARDS / 私人领奖页</span>
      <h1>我的领奖凭证</h1>
      <p>
        请在现场向工作人员出示本页及一次性凭证。同一真实参与者整晚原则上最多领取一次；工作人员将现场核验，昵称不作为唯一身份。
      </p>
      <p className="muted">
        请保留当前浏览器，不要退出匿名会话或清除浏览器数据。私人凭证不会显示在公开排行榜。
      </p>
      {error && <p role="alert">{error}</p>}
      {!awards.length && !error && (
        <p role="status">暂无获奖记录。若轮次刚结束，请等待服务端结算后自动刷新。</p>
      )}
      {awards.map((a) => (
        <article className="award-card" key={a.id}>
          <h2>
            第 {a.round_no} 轮 · {a.display_name}
          </h2>
          <p>
            真实排名 #{a.rank} · 奖品名额 {a.prize_slot} · {(a.elapsed_ms / 1000).toFixed(3)} 秒
          </p>
          <strong>{awardLabels[a.status]}</strong>
          {a.token && (
            <>
              <p>现场核验凭证（仅向工作人员出示）</p>
              <code className="claim-token">{a.token}</code>
              <PrivateClaimQr award={a} />
              <p className="muted">
                工作人员可用手机扫描此私人二维码进入核验后台。请勿分享或公开投影。
              </p>
            </>
          )}
        </article>
      ))}
      <a href="#online">返回参赛页面</a>
    </section>
  );
}
