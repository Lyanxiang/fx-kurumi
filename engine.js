/* =========================================================================
 * FX戦士くるみ — 30日間2000万円チャレンジ
 * 模拟引擎（纯逻辑，不依赖 DOM，可在 Node 中直接跑压力测试）
 * ========================================================================= */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FXEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------ 全局配置 ------------------------------ */
  const CFG = {
    START_CASH: 500000,          // 初始资金 50 万
    GOAL: 20000000,              // 目标 2000 万
    DAYS: 30,                    // 30 天
    DAY_SECONDS: 120,            // 白天 120 秒（市场时间）
    TICK_SECONDS: 0.1,           // 行情心跳（市场时间），越细慢放越顺滑
    FATHER_AMOUNT: 3000000,      // 父亲的存折
    FATHER_DISCOVERY_FROM_DAY: 4,
    FATHER_DISCOVERY_RATE: 0.05, // 每晚被发现概率
    FATHER_GRACE_DAYS: 3,        // 被发现后的还款期限
    LOAN_MAX: 5000000,           // 消费者金融上限
    LOAN_DAILY_RATE: 0.007,      // 日息 0.7%
    MIN_STAKE: 1000,
  };

  /* ------------------------------ 标的定义 ------------------------------ */
  // 从低风险到高风险排列
  const DEFS = {
    fund: {
      id: 'fund', name: '全球平衡基金', short: '基金', tag: '低风险', rank: 0,
      kind: 'fund', unit: '口', price: 10000, digits: 0,
      volDay: 0.0040, driftBias: 0.0028, maxLev: 1, shortable: false,
      spread: 0, jumpPerDay: 0.15, jumpUpBias: 0.72, gapVol: 0.28, bigGapChance: 0.03,
      color: '#8bd450',
      blurb: '全球股债平衡型基金。每天涨一点点，偶尔回撤。无法靠它达成目标。',
    },
    stock: {
      id: 'stock', name: '未来電機', short: '股票', tag: '中风险', rank: 1,
      kind: 'stock', unit: '株', price: 2450, digits: 0,
      volDay: 0.0220, driftBias: 0.0010, maxLev: 3, shortable: true,
      spread: 0.0008, jumpPerDay: 0.8, jumpUpBias: 0.5, gapVol: 0.50, bigGapChance: 0.15,
      color: '#58a6ff',
      blurb: 'AI 概念股。财报、传闻、外资进出，一天 5% 很平常。最多 3 倍信用杠杆。',
    },
    usdjpy: {
      id: 'usdjpy', name: '美元/日元', short: 'USD/JPY', tag: '高风险', rank: 2,
      kind: 'fx', unit: 'USD', price: 152.30, digits: 3,
      volDay: 0.0060, driftBias: 0, maxLev: 999, shortable: true,
      spread: 0.00002, jumpPerDay: 0.9, jumpUpBias: 0.5, gapVol: 0.50, bigGapChance: 0.10,
      color: '#d2a8ff',
      blurb: '被美日利差牵着走的主流货币对。波动相对温和——但在 999 倍面前依然致命。',
    },
    audjpy: {
      id: 'audjpy', name: '澳元/日元', short: 'AUD/JPY', tag: '极高风险', rank: 3,
      kind: 'fx', unit: 'AUD', price: 95.20, digits: 3,
      volDay: 0.0140, driftBias: 0, maxLev: 999, shortable: true,
      spread: 0.00003, jumpPerDay: 1.35, jumpUpBias: 0.5, gapVol: 0.62, bigGapChance: 0.14,
      color: '#ff9f43',
      blurb: '原作的宿命之 pair。资源国货币，一天波动 1 円是家常便饭，跳空更是常客。',
    },
  };

  const ASSET_ORDER = ['fund', 'stock', 'usdjpy', 'audjpy'];

  /* ------------------------------ 新闻库 ------------------------------ */
  const NEWS = {
    fund: {
      up: ['全球债券收益率回落，基金净值走高', '美股创新高，平衡基金受益', '基金经理调仓成功，净值上涨'],
      down: ['全球债市调整，基金净值小幅回撤', '风险资产走弱，平衡基金承压'],
    },
    stock: {
      up: ['未来電機 上调全年业绩预期，股价跳涨', '外资单日净买入创纪录', '公司宣布新一代 AI 芯片量产', '券商上调目标价至 3,500 円'],
      down: ['未来電機 财报不及预期，遭抛售', '被曝会计处理违规，股价跳水', '大股东减持公告', 'AI 泡沫论升温，科技股集体回落'],
    },
    usdjpy: {
      up: ['美国 CPI 高于预期，美元走强', '美债收益率飙升，美元买盘涌入', '日银维持宽松，日元承压'],
      down: ['美国非农爆冷，美元跳水', '日银总裁暗示政策正常化', '避险情绪升温，日元全线走强'],
    },
    audjpy: {
      up: ['RBA 意外加息 25bp，澳元瞬间拉升', '中国制造业 PMI 超预期，铁矿石暴涨', '风险偏好回升，套息交易重回澳元', '澳洲就业数据爆表，市场押注继续加息', '铁矿石谈判破裂，供给担忧推高澳元'],
      down: ['中国 GDP 不及预期，澳元遭抛售', '全球股市急跌，避险资金涌入日元', 'RBA 释放鸽派信号，澳元跳水', '铁矿石期货跌停，澳元多头踩踏', '澳洲零售数据暴跌，降息预期升温'],
    },
  };

  const BIG_NEWS = {
    up: ['【突发】澳洲央行紧急加息，澳元/日元暴涨', '【突发】中国推出大规模刺激，澳元直线拉升', '【突发】全球风险资产狂欢，澳元一柱擎天'],
    down: ['【突发】中国数据崩塌，澳元/日元闪崩', '【突发】全球股灾，避险买盘踏平澳元多头', '【突发】RBA 紧急降息，澳元断崖式下跌'],
  };

  /* ------------------------------ 工具函数 ------------------------------ */
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randn(st) {
    if (st._spare !== undefined) { const v = st._spare; st._spare = undefined; return v; }
    let u = 0, v = 0;
    while (u === 0) u = st.rng();
    while (v === 0) v = st.rng();
    const r = Math.sqrt(-2 * Math.log(u));
    const th = 2 * Math.PI * v;
    st._spare = r * Math.sin(th);
    return r * Math.cos(th);
  }

  function pick(st, arr) {
    if (!arr || !arr.length) return '市场出现异常波动';
    return arr[Math.floor(st.rng() * arr.length) % arr.length];
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function fmtY(n) {
    const neg = n < 0;
    const s = Math.round(Math.abs(n)).toLocaleString('en-US');
    return (neg ? '-¥' : '¥') + s;
  }

  function fmtPct(v, d) { return (v >= 0 ? '+' : '') + (v * 100).toFixed(d == null ? 2 : d) + '%'; }

  /* ------------------------------ 状态构造 ------------------------------ */
  function create(seed) {
    const s = (seed == null ? Date.now() : seed) >>> 0;
    const st = {
      seed: s,
      rng: mulberry32(s),
      _spare: undefined,
      day: 1,
      phase: 'intro',          // intro | day | night | ended
      dayClock: 0,
      cash: CFG.START_CASH,
      debt: 0,                 // 消费者金融（含利息）
      loanPrincipal: 0,        // 已借本金
      fatherDebt: 0,
      fatherKnown: false,
      fatherUsed: false,
      fatherDeadline: 0,
      positions: [],
      nextId: 1,
      assets: [],
      assetMap: {},
      news: [],
      newsSeq: 0,
      log: [],
      logSeq: 0,
      dayRealized: 0,
      dayStartNetWorth: CFG.START_CASH,
      maxNetWorth: CFG.START_CASH,
      reachedGoal: false,
      interestPaid: 0,
      stats: { wins: 0, losses: 0, best: 0, worst: 0, trades: 0, liquidations: 0 },
      ending: null,
      daySummary: null,
      gaps: [],
      startedAt: Date.now(),
    };
    ASSET_ORDER.forEach(function (id) {
      const d = DEFS[id];
      const a = {
        id: id,
        price: d.price,
        open: d.price,
        prevClose: d.price,
        drift: 0,
        series: [{ x: 0, p: d.price }],
      };
      st.assets.push(a);
      st.assetMap[id] = a;
    });
    return st;
  }

  /* ------------------------------ 估值 ------------------------------ */
  function pnlOf(st, p) {
    const a = st.assetMap[p.assetId];
    return p.stake * p.leverage * p.side * (a.price / p.entry - 1);
  }

  function equityOf(st, p) {
    return Math.max(0, p.stake + pnlOf(st, p));
  }

  function netWorth(st) {
    let v = st.cash;
    for (let i = 0; i < st.positions.length; i++) v += equityOf(st, st.positions[i]);
    return v - st.debt - st.fatherDebt;
  }

  function liqPrice(p) {
    if (!(p.leverage > 0)) return 0;
    return p.side > 0
      ? p.entry * (1 - 1 / p.leverage)
      : p.entry * (1 + 1 / p.leverage);
  }

  function totalDebt(st) { return st.debt + st.fatherDebt; }

  function refreshGoal(st) {
    if (netWorth(st) >= CFG.GOAL) st.reachedGoal = true;
    return st.reachedGoal;
  }

  /* ------------------------------ 日志 ------------------------------ */
  function pushLog(st, text, kind) {
    st.log.push({ id: ++st.logSeq, day: st.day, phase: st.phase, text: text, kind: kind || 'info' });
    if (st.log.length > 120) st.log.shift();
  }

  /* ------------------------------ 新闻 ------------------------------ */
  function makeNews(st, a, dir, mag, forcedText) {
    const pool = NEWS[a.id] || { up: ['市场波动'], down: ['市场波动'] };
    const text = forcedText || pick(st, dir > 0 ? pool.up : pool.down);
    const item = {
      id: ++st.newsSeq,
      x: st.dayClock,
      assetId: a.id,
      dir: dir,
      text: text,
      mag: mag || 0,
      day: st.day,
    };
    st.news.push(item);
    if (st.news.length > 40) st.news.shift();
    pushLog(st, DEFS[a.id].short + '｜' + text, dir > 0 ? 'up' : 'down');
    return { type: 'news', item: item };
  }

  /* ------------------------------ 开盘 ------------------------------ */
  function startDay(st) {
    st.phase = 'day';
    st.dayClock = 0;
    st.dayRealized = 0;
    st.daySummary = null;
    st.gaps = [];
    for (let i = 0; i < st.assets.length; i++) {
      const a = st.assets[i];
      const d = DEFS[a.id];
      a.open = a.price;
      a.drift = randn(st) * d.volDay * 0.35;
      if (d.kind === 'fund') a.drift = Math.abs(a.drift) * 0.25 + d.driftBias;
      a.series = [{ x: 0, p: a.price }];
    }
    st.dayStartNetWorth = netWorth(st);
    pushLog(st, 'DAY ' + st.day + ' 开盘。', 'day');
    return st;
  }

  /* ------------------------------ 行情心跳 ------------------------------ */
  function tick(st, dtSec) {
    const evs = [];
    if (st.phase !== 'day') return evs;
    const dt = clamp(dtSec, 0, 1.5);
    if (dt <= 0) return evs;
    st.dayClock = Math.min(CFG.DAY_SECONDS, st.dayClock + dt);

    for (let i = 0; i < st.assets.length; i++) {
      const a = st.assets[i];
      const d = DEFS[a.id];
      const step = dt / CFG.DAY_SECONDS;
      const sig = d.volDay * Math.sqrt(step);
      let z = randn(st);
      if (st.rng() < 0.025) z *= 2.8;          // 肥尾
      let ret = a.drift * step + sig * z;

      if (st.rng() < d.jumpPerDay * step) {
        let dir = st.rng() < d.jumpUpBias ? 1 : -1;
        if (a.drift > 0 && st.rng() < 0.28) dir = 1;
        if (a.drift < 0 && st.rng() < 0.28) dir = -1;
        const mag = d.volDay * (0.35 + 0.85 * Math.abs(randn(st)));
        ret += dir * mag;
        evs.push(makeNews(st, a, dir, mag));
      }

      a.price = Math.max(0.01, a.price * Math.exp(ret));
      a.series.push({ x: st.dayClock, p: a.price });
      if (a.series.length > 1200) a.series.splice(0, a.series.length - 1200);
    }

    // 爆仓检查
    for (let i = st.positions.length - 1; i >= 0; i--) {
      const p = st.positions[i];
      if (equityOf(st, p) <= 0) {
        const a = st.assetMap[p.assetId];
        st.positions.splice(i, 1);
        st.stats.liquidations++;
        st.stats.losses++;
        st.stats.worst = Math.min(st.stats.worst, -p.stake);
        st.dayRealized -= p.stake;
        pushLog(st, '【强制平仓】' + DEFS[p.assetId].short + ' ' + p.leverage + 'x ' +
          (p.side > 0 ? '多' : '空') + ' 爆仓，' + fmtY(p.stake) + ' 灰飞烟灭。', 'bad');
        evs.push({ type: 'liquidation', pos: p, assetId: p.assetId, price: a.price });
      }
    }

    refreshGoal(st);
    const ru = checkRuin(st, 'margin');
    if (ru) evs.push({ type: 'ending', ending: ru });
    return evs;
  }

  /* ------------------------------ 爆仓/破产 ------------------------------ */
  function checkRuin(st, cause) {
    if (st.ending || st.phase === 'ended') return null;
    const nw = netWorth(st);
    const broke = st.cash < CFG.MIN_STAKE && st.positions.length === 0 && nw < CFG.MIN_STAKE;
    if (nw < 0 || broke) {
      // 资不抵债：所有持仓被强制清算
      while (st.positions.length) {
        close(st, st.positions[0].id, 'ruin');
        st.stats.liquidations++;
      }
      st.ending = {
        type: 'fall', cause: cause || 'margin', day: st.day,
        netWorth: netWorth(st), clock: st.dayClock, debt: totalDebt(st), seed: st.seed,
      };
      st.phase = 'ended';
      return st.ending;
    }
    return null;
  }

  function finalize(st) {
    if (st.ending) return st.ending;
    const nw = netWorth(st);
    let type = 'nothing';
    if (nw >= CFG.GOAL) type = 'win';
    else if (nw < CFG.MIN_STAKE) type = 'fall';
    st.ending = {
      type: type, cause: 'final', day: CFG.DAYS,
      netWorth: nw, debt: totalDebt(st), seed: st.seed,
    };
    st.phase = 'ended';
    return st.ending;
  }

  /* ------------------------------ 收盘 ------------------------------ */
  function endDay(st) {
    if (st.phase !== 'day') return null;
    const closed = [];
    for (let i = st.positions.length - 1; i >= 0; i--) {
      const p = st.positions[i];
      if (!p.overnight) {
        const rec = close(st, p.id, 'dayend');
        if (rec) closed.push(rec);
      }
    }
    const changes = st.assets.map(function (a) {
      return { id: a.id, pct: a.price / a.open - 1, price: a.price };
    });
    st.daySummary = {
      day: st.day,
      realized: st.dayRealized,
      netWorth: netWorth(st),
      changes: changes,
      closed: closed,
    };
    st.phase = 'night';
    pushLog(st, '收盘。今日已实现 ' + fmtY(st.dayRealized) + '。', 'day');
    return st.daySummary;
  }

  /* ------------------------------ 下单 ------------------------------ */
  function open(st, opts) {
    if (!opts) return { ok: false, msg: '参数错误' };
    const d = DEFS[opts.assetId];
    if (!d) return { ok: false, msg: '未知标的' };
    if (st.phase !== 'day' && st.phase !== 'night') return { ok: false, msg: '现在无法交易' };
    if (st.ending) return { ok: false, msg: '游戏已结束' };
    if (st.positions.some(function (p) { return p.assetId === opts.assetId; })) {
      return { ok: false, msg: '该标的已有持仓，请先平仓' };
    }
    const side = opts.side === -1 ? -1 : 1;
    if (side === -1 && !d.shortable) return { ok: false, msg: '该标的不能做空' };
    const lev = clamp(Math.floor(opts.leverage || 1), 1, d.maxLev);
    const stake = Math.floor(opts.stake || 0);
    if (!(stake >= CFG.MIN_STAKE)) return { ok: false, msg: '保证金至少 ' + fmtY(CFG.MIN_STAKE) };
    if (stake > st.cash) return { ok: false, msg: '现金不足' };

    const a = st.assetMap[opts.assetId];
    const entry = a.price * (1 + side * d.spread);
    const notional = stake * lev;
    const p = {
      id: st.nextId++,
      assetId: opts.assetId,
      side: side,
      stake: stake,
      leverage: lev,
      entry: entry,
      units: notional / entry,
      notional: notional,
      overnight: st.phase === 'night',
      openDay: st.day,
      openAt: st.dayClock,
      openPrice: a.price,
    };
    st.cash -= stake;
    st.positions.push(p);
    st.stats.trades++;
    pushLog(st,
      (p.overnight ? '【隔夜】' : '') + '开仓 ' + d.short + ' ' + (side > 0 ? '做多' : '做空') +
      ' ' + lev + 'x，保证金 ' + fmtY(stake) + '，名义 ' + fmtY(notional) + '。',
      side > 0 ? 'up' : 'down');
    return { ok: true, pos: p };
  }

  /* ------------------------------ 平仓 ------------------------------ */
  function close(st, id, reason) {
    const idx = st.positions.findIndex(function (p) { return p.id === id; });
    if (idx < 0) return null;
    const p = st.positions[idx];
    st.positions.splice(idx, 1);
    const a = st.assetMap[p.assetId];
    const raw = equityOf(st, p);
    const eq = Math.max(0, raw);
    st.cash += eq;
    const pnl = eq - p.stake;
    st.dayRealized += pnl;
    if (pnl >= 0) { st.stats.wins++; } else { st.stats.losses++; }
    if (pnl > st.stats.best) st.stats.best = pnl;
    if (pnl < st.stats.worst) st.stats.worst = pnl;

    const tag = reason === 'dayend' ? '收盘平仓'
      : reason === 'overnight' ? (eq <= 0.5 ? '【跳空爆仓】' : '隔夜结算')
      : reason === 'ruin' ? '【强制清算】'
      : '平仓';
    pushLog(st, tag + ' ' + DEFS[p.assetId].short + ' ' + (p.side > 0 ? '多' : '空') +
      ' → ' + fmtY(pnl) + '（' + fmtPct(pnl / p.stake, 1) + '）',
      pnl >= 0 ? 'up' : 'down');

    return { pos: p, pnl: pnl, reason: reason, price: a.price, wiped: eq <= 0.5 };
  }

  /* ------------------------------ 夜晚 → 次日 ------------------------------ */
  function nextDay(st) {
    if (st.phase !== 'night') return null;
    const out = { gaps: [], resolved: [], events: [], ending: null };

    // 1) 跳空
    for (let i = 0; i < st.assets.length; i++) {
      const a = st.assets[i];
      const d = DEFS[a.id];
      let g = randn(st) * d.volDay * (d.gapVol || 0.55);
      if (st.rng() < (d.bigGapChance || 0.1)) {
        const dir = st.rng() < 0.45 ? -1 : 1;
        g += dir * d.volDay * (1.3 + 2.0 * st.rng());
        const txt = pick(st, dir > 0 ? BIG_NEWS.up : BIG_NEWS.down);
        st.news.push({
          id: ++st.newsSeq, x: 0, assetId: a.id, dir: dir,
          text: txt + '（跳空 ' + fmtPct(g, 1) + '）', mag: g, day: st.day + 1, gap: true,
        });
        if (st.news.length > 40) st.news.shift();
        pushLog(st, '【跳空】' + d.short + ' 开盘 ' + fmtPct(g, 2), dir > 0 ? 'up' : 'down');
        out.events.push({ type: 'biggap', assetId: a.id, pct: g });
      }
      g = clamp(g, -0.22, 0.22);
      const before = a.price;
      a.price = before * (1 + g);
      a.prevClose = before;
      out.gaps.push({ id: a.id, pct: g });
      st.gaps.push({ id: a.id, pct: g });
    }

    // 2) 隔夜持仓按开盘价结算
    for (let i = st.positions.length - 1; i >= 0; i--) {
      const p = st.positions[i];
      if (p.overnight) {
        const rec = close(st, p.id, 'overnight');
        if (rec) {
          out.resolved.push(rec);
          if (rec.wiped) {
            st.stats.liquidations++;
            out.events.push({
              type: 'liquidation', assetId: p.assetId,
              price: st.assetMap[p.assetId].price, pos: p, gap: true,
            });
          }
        }
      }
    }

    // 3) 利息
    if (st.debt > 0) {
      const interest = st.debt * CFG.LOAN_DAILY_RATE;
      st.debt += interest;
      st.interestPaid += interest;
    }

    let end = checkRuin(st, 'debt');
    if (end) { out.ending = end; out.events.push({ type: 'ending', ending: end }); return out; }

    refreshGoal(st);

    // 4) 父亲的存折
    fatherNightEvent(st, out.events);
    if (st.ending) { out.ending = st.ending; return out; }

    // 5) 推进日期
    st.day++;
    if (st.day > CFG.DAYS) {
      st.day = CFG.DAYS;
      const fin = finalize(st);
      out.ending = fin;
      out.events.push({ type: 'ending', ending: fin });
      return out;
    }
    startDay(st);
    return out;
  }

  function fatherNightEvent(st, events) {
    if (st.fatherDebt <= 0) return;
    if (!st.fatherKnown) {
      if (st.day >= CFG.FATHER_DISCOVERY_FROM_DAY && st.rng() < CFG.FATHER_DISCOVERY_RATE) {
        st.fatherKnown = true;
        st.fatherDeadline = st.day + CFG.FATHER_GRACE_DAYS;
        pushLog(st, '【父亲的存折】爸爸发现存折不见了。他说：' + CFG.FATHER_GRACE_DAYS + ' 天内还回来。', 'bad');
        events.push({ type: 'father', stage: 'discovered', deadline: st.fatherDeadline });
      }
    } else if (st.day > st.fatherDeadline) {
      pushLog(st, '【父亲的存折】期限已过。爸爸把电话打到了你打工的地方。', 'bad');
      st.ending = {
        type: 'fall', cause: 'family', day: st.day,
        netWorth: netWorth(st), debt: totalDebt(st), seed: st.seed,
      };
      st.phase = 'ended';
      events.push({ type: 'father', stage: 'expired' });
      events.push({ type: 'ending', ending: st.ending });
    }
  }

  /* ------------------------------ 资金操作 ------------------------------ */
  function borrowFather(st) {
    if (st.ending) return { ok: false, msg: '游戏已结束' };
    if (st.fatherDebt > 0) return { ok: false, msg: '已经借过了' };
    if (st.fatherUsed) return { ok: false, msg: '存折已经放回去了，不能再拿' };
    st.fatherUsed = true;
    st.fatherDebt = CFG.FATHER_AMOUNT;
    st.cash += CFG.FATHER_AMOUNT;
    pushLog(st, '偷偷拿走父亲的存折，取出 ' + fmtY(CFG.FATHER_AMOUNT) + '。', 'warn');
    return { ok: true, amount: CFG.FATHER_AMOUNT };
  }

  function repayFather(st) {
    if (st.fatherDebt <= 0) return { ok: false, msg: '没有欠款' };
    if (st.cash < st.fatherDebt) return { ok: false, msg: '现金不足以还清' };
    const amt = st.fatherDebt;
    st.cash -= amt;
    st.fatherDebt = 0;
    st.fatherDeadline = 0;
    pushLog(st, '把 ' + fmtY(amt) + ' 放回了父亲的存折。', 'good');
    return { ok: true, amount: amt };
  }

  function loanRoom(st) { return Math.max(0, CFG.LOAN_MAX - st.debt); }

  function borrowLoan(st, amount) {
    if (st.ending) return { ok: false, msg: '游戏已结束' };
    amount = Math.floor(amount || 0);
    if (!(amount > 0)) return { ok: false, msg: '金额无效' };
    const room = loanRoom(st);
    if (room < CFG.MIN_STAKE) return { ok: false, msg: '已达借款上限' };
    const real = Math.min(amount, room);
    st.loanPrincipal += real;
    st.debt += real;
    st.cash += real;
    pushLog(st, '向消费者金融借入 ' + fmtY(real) + '（日息 0.7%）。', 'warn');
    return { ok: true, amount: real };
  }

  function repayLoan(st, amount) {
    if (st.debt <= 0) return { ok: false, msg: '没有欠款' };
    amount = Math.floor(amount || 0);
    if (!(amount > 0)) return { ok: false, msg: '金额无效' };
    const real = Math.min(amount, st.cash, st.debt);
    if (!(real > 0)) return { ok: false, msg: '现金不足' };
    st.cash -= real;
    st.debt -= real;
    st.loanPrincipal = Math.max(0, st.loanPrincipal - real);
    pushLog(st, '还款 ' + fmtY(real) + '，剩余债务 ' + fmtY(st.debt) + '。', 'good');
    return { ok: true, amount: real };
  }

  function cashOut(st) {
    if (st.ending) return null;
    const nw = netWorth(st);
    if (nw < CFG.GOAL) { st.reachedGoal = false; return null; }
    st.ending = { type: 'win', cause: 'cashout', day: st.day, netWorth: nw, debt: totalDebt(st), seed: st.seed };
    st.phase = 'ended';
    return st.ending;
  }

  return {
    CFG: CFG,
    DEFS: DEFS,
    ASSET_ORDER: ASSET_ORDER,
    NEWS: NEWS,
    create: create,
    startDay: startDay,
    tick: tick,
    endDay: endDay,
    nextDay: nextDay,
    open: open,
    close: close,
    netWorth: netWorth,
    equityOf: equityOf,
    pnlOf: pnlOf,
    liqPrice: liqPrice,
    totalDebt: totalDebt,
    borrowFather: borrowFather,
    repayFather: repayFather,
    borrowLoan: borrowLoan,
    repayLoan: repayLoan,
    loanRoom: loanRoom,
    cashOut: cashOut,
    finalize: finalize,
    checkRuin: checkRuin,
    fmtY: fmtY,
    fmtPct: fmtPct,
  };
});
