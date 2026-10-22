/* =========================================================================
   FX戦士くるみ — 交互层
   ========================================================================= */
(function () {
  'use strict';

  const E = window.FXEngine;
  const CFG = E.CFG, DEFS = E.DEFS, ORDER = E.ASSET_ORDER;
  const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

  const $ = function (s) { return document.querySelector(s); };

  /* ------------------------------ 状态 ------------------------------ */
  let st = null;
  let selected = 'audjpy';
  let lev = 10;
  let speed = 33 / 100;   // 默认 ⅓×：一天(120市场秒)约 6 分钟真实时间
  let paused = true;
  let acc = 0;
  let lastTs = 0;
  let cw = 0, ch = 0, dpr = 1;
  let cv = null, ctx = null;
  let soundOn = true;
  let lastLogId = 0;
  let lastNewsId = 0;
  let lastGoalState = false;
  let loanPop = false;
  let toastT = 0;
  let confettiRaf = 0;
  let endingShown = false;
  let warnDay = 0;
  let warned = false;

  const el = {};

  /* ------------------------------ 音效 ------------------------------ */
  const Sfx = {
    ac: null,
    ensure: function () {
      if (!this.ac) {
        try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ac = null; }
      }
      if (this.ac && this.ac.state === 'suspended') this.ac.resume();
    },
    tone: function (f, dur, type, g, f2, delay) {
      if (!soundOn) return;
      this.ensure();
      const ac = this.ac; if (!ac) return;
      const t0 = ac.currentTime + (delay || 0);
      const o = ac.createOscillator(), gn = ac.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f, t0);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
      gn.gain.setValueAtTime(0.0001, t0);
      gn.gain.linearRampToValueAtTime(g || 0.05, t0 + 0.012);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(gn); gn.connect(ac.destination);
      o.start(t0); o.stop(t0 + dur + 0.03);
    },
    click: function () { this.tone(520, 0.05, 'square', 0.025); },
    buy: function () { this.tone(660, 0.08, 'triangle', 0.05); this.tone(990, 0.1, 'triangle', 0.035, null, 0.06); },
    sell: function () { this.tone(440, 0.08, 'triangle', 0.05); this.tone(300, 0.1, 'triangle', 0.035, null, 0.06); },
    news: function () { this.tone(1200, 0.04, 'sine', 0.03); this.tone(1600, 0.05, 'sine', 0.02, null, 0.05); },
    boom: function () {
      this.tone(140, 0.5, 'sawtooth', 0.12, 40);
      this.tone(90, 0.7, 'square', 0.07, 30, 0.03);
    },
    bell: function () { this.tone(880, 0.18, 'sine', 0.05); this.tone(1320, 0.25, 'sine', 0.03, null, 0.1); },
    open: function () { this.tone(392, 0.12, 'sine', 0.05); this.tone(523, 0.18, 'sine', 0.04, null, 0.09); },
    win: function () {
      [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.07, null, i * 0.13));
    },
    fail: function () { this.tone(220, 0.3, 'sawtooth', 0.06, 110); },
    fall: function () {
      this.tone(300, 1.6, 'sawtooth', 0.08, 40);
      this.tone(150, 2.0, 'sine', 0.05, 25, 0.1);
    },
  };

  /* ------------------------------ 工具 ------------------------------ */
  function fmtPrice(v, digits) {
    return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function fmtY(n) { return E.fmtY(n); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function liqText(pos) {
    if (pos.leverage <= 1) return '—';
    const lq = E.liqPrice(pos);
    return fmtPrice(lq, DEFS[pos.assetId].digits);
  }
  function levList(d) {
    const base = [1, 2, 5, 10, 25, 50, 100, 250, 500, 999].filter(function (v) { return v <= d.maxLev; });
    if (base.indexOf(d.maxLev) < 0) base.push(d.maxLev);
    return base;
  }

  /* ------------------------------ 初始化 ------------------------------ */
  function init() {
    cv = $('#chart');
    ctx = cv.getContext('2d');

    el.net = $('#h-net'); el.cash = $('#h-cash'); el.debt = $('#h-debt');
    el.goalbar = $('#h-goalbar'); el.goalpct = $('#h-goalpct');
    el.day = $('#h-day'); el.phase = $('#h-phase'); el.timer = $('#h-timer');
    el.tabs = $('#tabs');
    el.qName = $('#q-name'); el.qTag = $('#q-tag'); el.qBlurb = $('#q-blurb');
    el.qPrice = $('#q-price'); el.qChg = $('#q-chg');
    el.trade = $('#trade'); el.posList = $('#pos-list'); el.posCount = $('#pos-count');
    el.finance = $('#finance'); el.actionbar = $('#actionbar');
    el.log = $('#log-scroll'); el.news = $('#nt-track');
    el.bubble = $('#bubble-text'); el.stamp = $('#stamp'); el.bhint = $('#bhint');
    el.pauseOverlay = $('#pause-overlay');
    el.toast = $('#toast'); el.overlay = $('#overlay'); el.intro = $('#intro');
    el.speeds = $('#speeds');

    buildTabs();
    bind();
    resizeChart();
    if (window.ResizeObserver) {
      new ResizeObserver(function () { resizeChart(); }).observe($('#chartwrap'));
    } else {
      window.addEventListener('resize', resizeChart);
    }
    requestAnimationFrame(loop);
    try {
      if (new URLSearchParams(location.search).has('start')) setTimeout(startGame, 120);
    } catch (e) { /* noop */ }
  }

  function buildTabs() {
    el.tabs.innerHTML = ORDER.map(function (id) {
      const d = DEFS[id];
      return '<button class="tab' + (id === selected ? ' on' : '') + '" data-asset="' + id + '">' +
        '<span class="dot" style="color:' + d.color + '"></span>' +
        '<span class="tname">' + d.short + '</span>' +
        '<span class="risk">' + d.tag + '</span>' +
        '<span class="tchg" data-chg="' + id + '">--</span></button>';
    }).join('');
  }

  function resizeChart() {
    const wrap = $('#chartwrap');
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    cw = Math.max(240, Math.round(r.width));
    ch = Math.max(160, Math.round(r.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(cw * dpr);
    cv.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ------------------------------ 事件绑定 ------------------------------ */
  function bind() {
    document.addEventListener('click', function (e) {
      const tab = e.target.closest('.tab');
      if (tab && tab.dataset.asset) { selectAsset(tab.dataset.asset); return; }

      const sp = e.target.closest('.speeds button');
      if (sp) { setSpeed(parseInt(sp.dataset.speed, 10)); return; }

      const t = e.target.closest('[data-action]');
      if (!t) return;
      const a = t.dataset.action;

      switch (a) {
        case 'start': startGame(); break;
        case 'restart': startGame(); break;
        case 'help': showHelp(); break;
        case 'closehelp': {
          const m = t.closest('.help'); if (m) m.remove();
          break;
        }
        case 'sound': {
          soundOn = !soundOn;
          t.classList.toggle('on', soundOn);
          t.title = soundOn ? '音效：开' : '音效：关';
          if (soundOn) Sfx.click();
          break;
        }
        case 'lev': setLev(parseInt(t.dataset.lev, 10)); break;
        case 'stake': setStakeFrac(parseFloat(t.dataset.frac)); break;
        case 'order': doOrder(parseInt(t.dataset.side, 10)); break;
        case 'close': doClose(parseInt(t.dataset.id, 10)); break;
        case 'endday': doEndDay(); break;
        case 'sleep': doSleep(); break;
        case 'cashout': doCashout(); break;
        case 'father': doBorrowFather(); break;
        case 'repay-father': doRepayFather(); break;
        case 'loan': loanPop = !loanPop; renderFinance(); Sfx.click(); break;
        case 'loan-amt': doBorrowLoan(parseFloat(t.dataset.amt)); break;
        case 'repay-loan': doRepayLoan(); break;
      }
    });

    el.trade.addEventListener('input', function (e) {
      if (e.target.id === 'inp-stake') updatePreview();
    });

    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT') return;
      if (!st) return;

      // 空格：暂停 / 继续
      if (e.code === 'Space') {
        e.preventDefault();
        togglePause();
        return;
      }

      // 回车：推进（白天 → 收盘；夜间 → 次日）
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        if (st.phase === 'day') doEndDay();
        else if (st.phase === 'night') doSleep();
        return;
      }

      // P：同样暂停
      if (e.code === 'KeyP') {
        e.preventDefault();
        togglePause();
        return;
      }

      const map = { Digit1: 'fund', Digit2: 'stock', Digit3: 'usdjpy', Digit4: 'audjpy' };
      if (map[e.code]) selectAsset(map[e.code]);
    });

    window.addEventListener('beforeunload', function (e) {
      if (st && st.phase !== 'ended' && st.day > 1) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /* ------------------------------ 主循环 ------------------------------ */
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!st) return;
    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
    lastTs = ts;

    if (st.phase === 'day' && !paused && !endingShown) {
      acc += dt * speed;
      let guard = 0;
      while (acc >= CFG.TICK_SECONDS && guard++ < 60) {
        acc -= CFG.TICK_SECONDS;
        const evs = E.tick(st, CFG.TICK_SECONDS);
        for (let i = 0; i < evs.length; i++) handleEvent(evs[i]);
        if (st.phase !== 'day' || st.dayClock >= CFG.DAY_SECONDS) break;
      }
      if (st.phase === 'day' && st.dayClock >= CFG.DAY_SECONDS) doEndDay();
    }

    updateLive();
    drawChart();
  }

  /* ------------------------------ 游戏流程 ------------------------------ */
  function startGame() {
    const seed = (Date.now() ^ ((Math.random() * 0xffffffff) >>> 0)) >>> 0;
    st = E.create(seed);
    E.startDay(st);
    selected = 'audjpy';
    lev = 10;
    paused = false;
    acc = 0; lastTs = 0;
    lastLogId = 0; lastNewsId = 0; lastGoalState = false;
    loanPop = false; endingShown = false;
    warnDay = 0; warned = false;
    el.overlay.innerHTML = '';
    el.overlay.classList.remove('active');
    el.intro.classList.add('hide');
    stopConfetti();
    hideStamp();
    renderAll();
    syncLog(true);
    el.news.innerHTML = '<div class="nt-item dim">等待第一条速報……</div>';
    say('三十天。五十万变两千万。……干就完了。');
    setTimeout(function () { Sfx.bell(); }, 60);
  }

  function doEndDay() {
    if (!st || st.phase !== 'day') return;
    paused = false;
    updatePauseUI();
    const sum = E.endDay(st);
    acc = 0;
    showStamp('收盘');
    Sfx.bell();
    renderAll();
    syncLog();
    say('收盘了。要持仓过夜吗？明天开盘可能直接跳空。');
    if (sum && Math.abs(sum.realized) > 0) {
      toast('今日已实现 ' + fmtY(sum.realized), sum.realized >= 0 ? 'good' : 'bad');
    }
  }

  function doSleep() {
    if (!st || st.phase !== 'night') return;
    paused = false;
    const res = E.nextDay(st);
    showStamp('DAY ' + st.day);
    Sfx.open();
    if (res) {
      for (let i = 0; i < res.events.length; i++) handleEvent(res.events[i]);
      const big = res.gaps.slice().sort(function (a, b) { return Math.abs(b.pct) - Math.abs(a.pct); })[0];
      if (big && Math.abs(big.pct) > 0.006) {
        const d = DEFS[big.id];
        toast('开盘跳空｜' + d.short + ' ' + E.fmtPct(big.pct, 2), big.pct >= 0 ? 'good' : 'bad');
      }
    }
    renderAll();
    syncLog();
    if (st.ending) { showEnding(st.ending); return; }
    say('DAY ' + st.day + '。今天也要活着回来。');
  }

  /* 空格：暂停 / 继续 */
  function togglePause() {
    if (!st || st.phase !== 'day' || st.ending) return;
    paused = !paused;
    Sfx.click();
    updatePauseUI();
    if (paused) {
      say('……先等一下。让我想想。');
      toast('已暂停 · 空格继续', '');
    } else {
      toast('继续', '');
    }
  }

  function updatePauseUI() {
    const on = !!(st && st.phase === 'day' && paused && !st.ending);
    if (el.pauseOverlay) el.pauseOverlay.classList.toggle('show', on);
    if (el.phase && st) {
      if (st.phase === 'day') {
        el.phase.textContent = on ? '已暂停' : '日间交易';
        el.phase.className = 'phasepill' + (on ? ' paused' : '');
      }
    }
  }

  function doCashout() {
    if (!st) return;
    const end = E.cashOut(st);
    if (end) showEnding(end);
  }

  function selectAsset(id) {
    if (id === selected || !DEFS[id]) return;
    selected = id;
    const d = DEFS[id];
    if (lev > d.maxLev) lev = d.maxLev;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('on', b.dataset.asset === id);
    });
    Sfx.click();
    renderQuote();
    renderTrade();
    renderPositions();
  }

  function setSpeed(pct) {
    speed = pct / 100;
    Array.prototype.forEach.call(el.speeds.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', parseInt(b.dataset.speed, 10) === pct);
    });
    Sfx.click();
    const btn = el.speeds.querySelector('button[data-speed="' + pct + '"]');
    const label = btn ? btn.textContent.trim() : (pct / 100) + '×';
    const secs = Math.round(CFG.DAY_SECONDS / speed);
    toast('速度 ' + label + ' · 一天约 ' + (secs >= 60 ? (secs / 60).toFixed(1) + ' 分钟' : secs + ' 秒'), '');
  }

  function setLev(v) {
    if (!st) { lev = v; return; }
    const d = DEFS[selected];
    lev = clamp(v, 1, d.maxLev);
    const box = document.querySelectorAll('#lev-chips .chip');
    Array.prototype.forEach.call(box, function (b) {
      b.classList.toggle('on', parseInt(b.dataset.lev, 10) === lev);
    });
    const lv = document.querySelector('#lev-val');
    if (lv) lv.textContent = lev + '×';
    updatePreview();
    Sfx.click();
  }

  function setStakeFrac(f) {
    if (!st) return;
    const inp = document.querySelector('#inp-stake');
    if (!inp) return;
    const v = Math.max(0, Math.floor(st.cash * f / 1000) * 1000);
    inp.value = v;
    updatePreview();
    Sfx.click();
  }

  function currentStake() {
    const inp = document.querySelector('#inp-stake');
    if (!inp) return 0;
    const v = Math.floor(Number(inp.value) || 0);
    return v > 0 ? v : 0;
  }

  function doOrder(side) {
    if (!st) return;
    const stake = currentStake();
    const res = E.open(st, { assetId: selected, side: side, stake: stake, leverage: lev });
    if (!res.ok) { toast(res.msg, 'bad'); Sfx.fail(); return; }
    if (st.phase === 'night') Sfx.sell(); else if (side > 0) Sfx.buy(); else Sfx.sell();
    renderAll();
    syncLog();
    const d = DEFS[selected];
    say(side > 0
      ? (d.short + ' 做多 ' + lev + '×。……拜托了，涨吧。')
      : (d.short + ' 做空 ' + lev + '×。这次，我要站在对面。'));
  }

  function doClose(id) {
    if (!st) return;
    const rec = E.close(st, id, 'manual');
    if (!rec) return;
    Sfx.click();
    if (rec.pnl >= 0) Sfx.buy(); else Sfx.fail();
    toast((rec.pnl >= 0 ? '平仓 +' : '平仓 ') + fmtY(rec.pnl), rec.pnl >= 0 ? 'good' : 'bad');
    renderAll();
    syncLog();
    if (rec.pnl >= 0) say('落袋为安。……这个感觉，会上瘾。');
    else say('止损。……手在抖。');
  }

  function doBorrowFather() {
    if (!st) return;
    const res = E.borrowFather(st);
    if (!res.ok) { toast(res.msg, 'bad'); return; }
    Sfx.open();
    toast('偷借了父亲的 300 万', 'gold');
    say('爸爸的存折……对不起。等我赢了就还回去。');
    renderAll();
    syncLog();
  }

  function doRepayFather() {
    if (!st) return;
    const res = E.repayFather(st);
    if (!res.ok) { toast(res.msg, 'bad'); Sfx.fail(); return; }
    Sfx.buy();
    toast('已还清父亲的 300 万', 'good');
    say('存折放回去了。……这样就不会被发现了吧。');
    renderAll();
    syncLog();
  }

  function doBorrowLoan(f) {
    if (!st) return;
    const room = E.loanRoom(st);
    const amt = f >= 1 ? Math.min(room, f) : Math.floor(room * f);
    const res = E.borrowLoan(st, amt);
    if (!res.ok) { toast(res.msg, 'bad'); Sfx.fail(); return; }
    loanPop = false;
    Sfx.open();
    toast('借入 ' + fmtY(res.amount) + '（日息 0.7%）', 'gold');
    say('利息每天都会长。……我知道。');
    renderAll();
    syncLog();
  }

  function doRepayLoan() {
    if (!st) return;
    const res = E.repayLoan(st, st.debt);
    if (!res.ok) { toast(res.msg, 'bad'); Sfx.fail(); return; }
    Sfx.buy();
    toast('已还款 ' + fmtY(res.amount), 'good');
    renderAll();
    syncLog();
  }

  /* ------------------------------ 事件 ------------------------------ */
  function handleEvent(ev) {
    if (!ev) return;
    if (ev.type === 'news') {
      syncNews();
      Sfx.news();
      return;
    }
    if (ev.type === 'liquidation') {
      const wrap = $('#chartwrap');
      wrap.classList.remove('shake');
      void wrap.offsetWidth;
      wrap.classList.add('shake');
      Sfx.boom();
      toast('强制平仓！' + DEFS[ev.assetId].short + ' 仓位已归零', 'bad');
      say('爆、爆了……！全部……都没了……');
      renderAll();
      syncLog();
      return;
    }
    if (ev.type === 'biggap') {
      return;
    }
    if (ev.type === 'father') {
      if (ev.stage === 'discovered') {
        Sfx.fail();
        toast('父亲发现了存折！' + CFG.FATHER_GRACE_DAYS + ' 天内必须还清', 'bad');
        say('爸爸……发现了。三天之内，必须还回去。');
        renderAll();
      }
      return;
    }
    if (ev.type === 'ending') {
      showEnding(ev.ending);
      return;
    }
  }

  /* ------------------------------ 渲染：整体 ------------------------------ */
  function renderAll() {
    if (!st) return;
    renderHUD();
    renderQuote();
    renderTrade();
    renderPositions();
    renderFinance();
    renderActionBar();
    updateTabs();
    syncLog();
    syncNews();
    updatePauseUI();
  }

  function renderHUD() {
    const nw = E.netWorth(st);
    el.net.textContent = fmtY(nw);
    el.net.classList.toggle('neg', nw < 0);
    el.cash.textContent = fmtY(st.cash);
    const debt = E.totalDebt(st);
    el.debt.textContent = fmtY(debt);
    el.debt.classList.toggle('zero', debt < 1);
    el.debt.classList.toggle('has', debt >= 1);
    const pct = clamp(nw / CFG.GOAL, 0, 1);
    el.goalbar.style.width = (pct * 100).toFixed(2) + '%';
    el.goalpct.textContent = (pct * 100).toFixed(1) + '%';
    el.day.textContent = st.day;

    const pausedNow = st.phase === 'day' && paused && !st.ending;
    const label = st.phase === 'day'
      ? (pausedNow ? '已暂停' : '日间交易')
      : st.phase === 'night' ? '夜间 · 可挂单' : '已结束';
    el.phase.textContent = label;
    el.phase.className = 'phasepill' + (pausedNow ? ' paused' : st.phase === 'night' ? ' night' : st.phase === 'ended' ? ' ended' : '');
    updatePauseUI();
  }

  function renderQuote() {
    const d = DEFS[selected], a = st.assetMap[selected];
    el.qName.textContent = d.name;
    el.qTag.textContent = d.tag;
    el.qTag.className = 'tag t' + d.rank;
    el.qBlurb.textContent = d.blurb;
    const chg = a.price / a.open - 1;
    el.qPrice.textContent = fmtPrice(a.price, d.digits);
    el.qChg.textContent = E.fmtPct(chg, 2);
  }

  function updateTabs() {
    ORDER.forEach(function (id) {
      const a = st.assetMap[id];
      const node = document.querySelector('[data-chg="' + id + '"]');
      if (!node) return;
      const chg = a.price / a.open - 1;
      node.textContent = E.fmtPct(chg, 2);
      node.style.color = chg >= 0 ? 'var(--up)' : 'var(--down)';
    });
  }

  function renderActionBar() {
    if (!st || st.phase === 'ended') { el.actionbar.innerHTML = ''; return; }
    let html = '';
    if (st.phase === 'day') {
      html = '<button class="act act-secondary" data-action="endday">提前收盘 <small id="endday-left">剩 120s</small></button>';
      if (st.reachedGoal) {
        html += '<button class="act act-gold" data-action="cashout">落袋为安</button>';
      }
    } else if (st.phase === 'night') {
      const last = st.day >= CFG.DAYS;
      html = '<button class="act act-primary" data-action="sleep">' +
        (last ? '结算 30 天' : '就寝 → DAY ' + (st.day + 1)) +
        '<small>' + (last ? '看看最后的结果' : '结果次日揭晓') + '</small></button>';
      if (st.reachedGoal) {
        html += '<button class="act act-gold" data-action="cashout">落袋为安</button>';
      }
    }
    el.actionbar.innerHTML = html;
  }

  /* ------------------------------ 渲染：下单 ------------------------------ */
  function renderTrade() {
    if (!st) { el.trade.innerHTML = ''; return; }
    const d = DEFS[selected];
    const pos = st.positions.find(function (p) { return p.assetId === selected; });

    if (pos) {
      const pnl = E.pnlOf(st, pos);
      const roi = pnl / pos.stake;
      const a = st.assetMap[selected];
      el.trade.innerHTML =
        '<div class="panel-h"><span>持仓中</span><span class="panel-hint">' +
          (pos.side > 0 ? 'LONG' : 'SHORT') + ' ' + pos.leverage + '×' + (pos.overnight ? ' · 隔夜' : '') +
        '</span></div>' +
        '<div class="body">' +
          '<div class="preview" style="margin-bottom:11px">' +
            '<div><span>入场价</span><b>' + fmtPrice(pos.entry, d.digits) + '</b></div>' +
            '<div><span>现价</span><b id="tp-cur">' + fmtPrice(a.price, d.digits) + '</b></div>' +
            '<div><span>保证金</span><b>' + fmtY(pos.stake) + '</b></div>' +
            '<div><span>浮动盈亏</span><b id="tp-pnl" class="' + (pnl >= 0 ? 'gold' : 'red') + '">' + fmtY(pnl) + '</b></div>' +
            '<div><span>收益率</span><b id="tp-roi" class="' + (roi >= 0 ? 'gold' : 'red') + '">' + E.fmtPct(roi, 1) + '</b></div>' +
            '<div><span>爆仓价</span><b class="red">' + liqText(pos) + '</b></div>' +
          '</div>' +
          '<button class="side-btn sell" style="width:100%" data-action="close" data-id="' + pos.id + '">平仓 CLOSE</button>' +
        '</div>';
      return;
    }

    const levs = levList(d);
    if (levs.indexOf(lev) < 0) lev = d.maxLev;
    const cash = st.cash;
    const defStake = Math.max(0, Math.min(cash, Math.floor(cash * 0.5 / 1000) * 1000));
    const night = st.phase === 'night';

    el.trade.innerHTML =
      '<div class="panel-h"><span>下单</span><span class="panel-hint">' + (night ? '夜間建玉' : '日间') + '</span></div>' +
      '<div class="body">' +
        (night ? '<div class="mode-note">夜間建玉：次日开盘按跳空价结算，可能直接爆仓。</div>' : '') +
        (d.kind === 'fund' ? '<div class="mode-note warn">基金无法达成目标，只能保住本金。</div>' : '') +
        '<div class="lev-head"><span class="lbl">杠杆</span><span class="val" id="lev-val">' + lev + '×</span></div>' +
        '<div class="lev-chips" id="lev-chips">' +
          levs.map(function (v) {
            return '<button class="chip' + (v === lev ? ' on' : '') + (v >= 100 ? ' hot' : '') +
              '" data-action="lev" data-lev="' + v + '">' + v + '×</button>';
          }).join('') +
        '</div>' +
        '<div class="stake-row"><label>保证金</label>' +
          '<input id="inp-stake" class="stake-in" type="number" min="1000" step="1000" value="' + defStake + '"></div>' +
        '<div class="quick">' +
          '<button class="qbtn" data-action="stake" data-frac="0.1">10%</button>' +
          '<button class="qbtn" data-action="stake" data-frac="0.25">25%</button>' +
          '<button class="qbtn" data-action="stake" data-frac="0.5">50%</button>' +
          '<button class="qbtn" data-action="stake" data-frac="1">ALL</button>' +
        '</div>' +
        '<div class="preview">' +
          '<div><span>名义金额</span><b id="prev-notional">--</b></div>' +
          '<div><span>爆仓价</span><b id="prev-liq">--</b></div>' +
          '<div><span>最大亏损</span><b id="prev-loss" class="red">--</b></div>' +
          '<div><span>爆仓距离</span><b id="prev-dist" class="red">--</b></div>' +
        '</div>' +
        '<div class="sides">' +
          '<button class="side-btn buy" data-action="order" data-side="1">做多<small>LONG</small></button>' +
          '<button class="side-btn sell" data-action="order" data-side="-1"' + (d.shortable ? '' : ' disabled') + '>做空<small>SHORT</small></button>' +
        '</div>' +
      '</div>';
    updatePreview();
  }

  function updatePreview() {
    if (!st) return;
    const d = DEFS[selected];
    const a = st.assetMap[selected];
    const stake = currentStake();
    const notional = stake * lev;
    const entry = a.price * (1 + d.spread);
    const lq = entry * (1 - 1 / lev);
    const n1 = document.querySelector('#prev-notional');
    const n2 = document.querySelector('#prev-liq');
    const n3 = document.querySelector('#prev-loss');
    const n4 = document.querySelector('#prev-dist');
    if (n1) n1.textContent = notional > 0 ? fmtY(notional) : '--';
    if (n2) n2.textContent = lev > 1 ? fmtPrice(lq, d.digits) : '—';
    if (n3) n3.textContent = stake > 0 ? '-' + fmtY(stake) : '--';
    if (n4) n4.textContent = lev > 1 ? E.fmtPct(-1 / lev, 2) : '—';
  }

  /* ------------------------------ 渲染：持仓 ------------------------------ */
  function renderPositions() {
    if (!st) return;
    el.posCount.textContent = st.positions.length;
    if (!st.positions.length) {
      el.posList.innerHTML = '<div class="empty">还没有持仓</div>';
      return;
    }
    el.posList.innerHTML = st.positions.map(function (p) {
      const d = DEFS[p.assetId], a = st.assetMap[p.assetId];
      const pnl = E.pnlOf(st, p);
      const eq = E.equityOf(st, p);
      const frac = clamp(eq / p.stake, 0, 1);
      return '<div class="posrow ' + (p.side > 0 ? 'long' : 'short') + '" data-pos="' + p.id + '">' +
        '<div class="pr-top"><b>' + d.short + '</b>' +
          '<span class="pr-side ' + (p.side > 0 ? 'long' : 'short') + '">' + (p.side > 0 ? '多' : '空') + '</span>' +
          '<span class="pr-lev">' + p.leverage + '×' + '</span>' +
          '<span class="pr-pnl ' + (pnl >= 0 ? 'up' : 'down') + '">' + fmtY(pnl) + '</span></div>' +
        '<div class="pr-mid"><span>保证金 ' + fmtY(p.stake) + '</span>' +
          '<span>入场 ' + fmtPrice(p.entry, d.digits) + '</span>' +
          '<span class="pr-cur">现价 ' + fmtPrice(a.price, d.digits) + '</span></div>' +
        '<div class="pr-bar"><i class="' + (frac < 0.4 ? 'low' : '') + '" style="width:' + (frac * 100).toFixed(0) + '%"></i></div>' +
        '<button class="pr-close" data-action="close" data-id="' + p.id + '">平仓</button>' +
      '</div>';
    }).join('');
  }

  /* ------------------------------ 渲染：资金 ------------------------------ */
  function renderFinance() {
    if (!st) return;
    const room = E.loanRoom(st);
    let fatherRow = '';
    if (st.fatherDebt > 0) {
      const known = st.fatherKnown;
      const sub = known
        ? '已被发现 · 期限 DAY ' + st.fatherDeadline
        : '已借 ¥3,000,000 · 爸爸还没发现';
      fatherRow =
        '<div class="finrow"><div class="fin-info"><b>父亲的存折</b><small>' + sub + '</small></div>' +
        '<button class="fin-btn danger" data-action="repay-father"' + (st.cash >= st.fatherDebt ? '' : ' disabled') + '>还 300万</button></div>' +
        (known && st.cash < st.fatherDebt ? '<div class="deadline">现金不足，还不上就完了</div>' : '');
    } else if (st.fatherUsed) {
      fatherRow =
        '<div class="finrow"><div class="fin-info"><b>父亲的存折</b><small>已还清 · 存折放回原处了</small></div></div>';
    } else {
      fatherRow =
        '<div class="finrow"><div class="fin-info"><b>父亲的存折</b><small>¥3,000,000 · 0% 利息 · 5%/晚 被发现</small></div>' +
        '<button class="fin-btn gold" data-action="father">偷借</button></div>';
    }

    let loanBtns = '';
    if (loanPop && room > 0) {
      loanBtns =
        '<div class="loan-pop">' +
          '<button data-action="loan-amt" data-amt="500000">50万</button>' +
          '<button data-action="loan-amt" data-amt="1000000">100万</button>' +
          '<button data-action="loan-amt" data-amt="3000000">300万</button>' +
          '<button data-action="loan-amt" data-amt="0.99999">全借</button>' +
        '</div>';
    }

    el.finance.innerHTML =
      '<div class="panel-h"><span>资金</span><span class="panel-hint">日息 0.7%</span></div>' +
      '<div class="fin-body">' +
        fatherRow +
        '<div class="finrow"><div class="fin-info"><b>消费者金融</b><small>已借 ' + fmtY(st.debt) +
          ' / 上限 ¥5,000,000</small></div>' +
          (st.debt > 0 ? '<button class="fin-btn" data-action="repay-loan">还款</button>' : '') +
          (room > 0 ? '<button class="fin-btn gold" data-action="loan">借款</button>' : '') +
        '</div>' +
        loanBtns +
      '</div>';
  }

  /* ------------------------------ 渲染：实时 ------------------------------ */
  function updateLive() {
    if (!st) return;
    const nw = E.netWorth(st);
    el.net.textContent = fmtY(nw);
    el.net.classList.toggle('neg', nw < 0);
    el.cash.textContent = fmtY(st.cash);
    const debt = E.totalDebt(st);
    el.debt.textContent = fmtY(debt);
    el.debt.classList.toggle('zero', debt < 1);
    el.debt.classList.toggle('has', debt >= 1);
    const pct = clamp(nw / CFG.GOAL, 0, 1);
    el.goalbar.style.width = (pct * 100).toFixed(2) + '%';
    el.goalpct.textContent = (pct * 100).toFixed(1) + '%';

    const left = Math.max(0, CFG.DAY_SECONDS - st.dayClock);
    const frac = st.phase === 'day' ? left / CFG.DAY_SECONDS : 0;
    el.timer.style.width = (frac * 100).toFixed(1) + '%';
    el.timer.className = frac < 0.12 ? 'danger' : frac < 0.3 ? 'warn' : '';
    const eLeft = document.querySelector('#endday-left');
    if (eLeft) eLeft.textContent = '剩 ' + Math.ceil(left) + 's';

    updatePauseUI();

    if (st.phase === 'night') {
      el.bhint.textContent = '夜间 · 挂单将在次日开盘跳空结算';
      el.bhint.classList.add('show');
    } else {
      el.bhint.classList.remove('show');
    }

    if (st.phase === 'day' && !paused) {
      if (warnDay !== st.day) { warnDay = st.day; warned = false; }
      if (!warned && left <= 10) {
        warned = true;
        toast('10 秒后收盘，日间持仓将被强制平仓', 'bad');
        Sfx.bell();
      }
    }

    const reach = nw >= CFG.GOAL;
    st.reachedGoal = reach;
    if (reach !== lastGoalState) {
      lastGoalState = reach;
      renderActionBar();
      if (reach) {
        toast('净值突破 ¥20,000,000 — 可以落袋为安了', 'gold');
        say('两千万……我做到了？不，还能更多……！');
        Sfx.win();
      } else {
        toast('净值跌回 ¥20,000,000 以下', 'bad');
        say('……又掉下去了。还没结束，还没结束……！');
      }
    }

    const d = DEFS[selected], a = st.assetMap[selected];
    const chg = a.price / a.open - 1;
    el.qPrice.textContent = fmtPrice(a.price, d.digits);
    el.qPrice.className = 'q-price ' + (chg >= 0 ? 'up' : 'down');
    el.qChg.textContent = E.fmtPct(chg, 2);
    el.qChg.className = 'q-chg ' + (chg >= 0 ? 'up' : 'down');
    updateTabs();

    // 持仓实时
    st.positions.forEach(function (p) {
      const row = document.querySelector('[data-pos="' + p.id + '"]');
      if (!row) return;
      const pnl = E.pnlOf(st, p);
      const eq = E.equityOf(st, p);
      const pnlEl = row.querySelector('.pr-pnl');
      if (pnlEl) {
        pnlEl.textContent = fmtY(pnl);
        pnlEl.className = 'pr-pnl ' + (pnl >= 0 ? 'up' : 'down');
      }
      const cur = row.querySelector('.pr-cur');
      if (cur) cur.textContent = '现价 ' + fmtPrice(st.assetMap[p.assetId].price, DEFS[p.assetId].digits);
      const bar = row.querySelector('.pr-bar i');
      if (bar) {
        const f = clamp(eq / p.stake, 0, 1);
        bar.style.width = (f * 100).toFixed(0) + '%';
        bar.className = f < 0.4 ? 'low' : '';
      }
    });

    // 持仓卡片实时刷新
    const held = st.positions.find(function (p) { return p.assetId === selected; });
    if (held) {
      const hpnl = E.pnlOf(st, held);
      const hroi = hpnl / held.stake;
      const tcur = document.querySelector('#tp-cur');
      const tpnl = document.querySelector('#tp-pnl');
      const troi = document.querySelector('#tp-roi');
      if (tcur) tcur.textContent = fmtPrice(st.assetMap[selected].price, DEFS[selected].digits);
      if (tpnl) { tpnl.textContent = fmtY(hpnl); tpnl.className = hpnl >= 0 ? 'gold' : 'red'; }
      if (troi) { troi.textContent = E.fmtPct(hroi, 1); troi.className = hroi >= 0 ? 'gold' : 'red'; }
    }

    updatePreview();
    syncLog();
    syncNews();
  }

  /* ------------------------------ 日志 / 新闻 ------------------------------ */
  function syncLog(force) {
    if (!st) return;
    if (force) { el.log.innerHTML = ''; lastLogId = 0; }
    const items = st.log.filter(function (l) { return l.id > lastLogId; });
    if (!items.length) return;
    const frag = document.createDocumentFragment();
    items.forEach(function (l) {
      const d = document.createElement('div');
      d.className = 'logline ' + (l.kind || '');
      d.innerHTML = '<span class="lt">D' + String(l.day).padStart(2, '0') + '</span>' +
        '<span>' + escapeHtml(l.text) + '</span>';
      frag.appendChild(d);
      lastLogId = l.id;
    });
    el.log.appendChild(frag);
    while (el.log.children.length > 60) el.log.removeChild(el.log.firstChild);
    el.log.scrollTop = el.log.scrollHeight;
  }

  function syncNews() {
    if (!st) return;
    const last = st.news[st.news.length - 1];
    if (!last || last.id === lastNewsId) return;
    lastNewsId = last.id;
    const items = st.news.slice(-3);
    el.news.innerHTML = items.map(function (n) {
      const d = DEFS[n.assetId];
      return '<div class="nt-item ' + (n.dir > 0 ? 'up' : 'down') + '">' +
        '<span class="ntx">' + d.short + '</span>' + escapeHtml(n.text) + '</div>';
    }).join('');
  }

  /* ------------------------------ 提示 / 对话 ------------------------------ */
  function toast(msg, kind) {
    el.toast.textContent = msg;
    el.toast.className = 'show ' + (kind || '');
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.toast.className = ''; }, 2400);
  }

  function say(text) {
    el.bubble.textContent = text;
  }

  function showStamp(text) {
    el.stamp.textContent = text;
    el.stamp.classList.remove('show');
    void el.stamp.offsetWidth;
    el.stamp.classList.add('show');
    setTimeout(function () { el.stamp.classList.remove('show'); }, 950);
  }
  function hideStamp() { el.stamp.classList.remove('show'); }

  /* ------------------------------ 图表 ------------------------------ */
  function drawChart() {
    if (!ctx || !st) return;
    const d = DEFS[selected], a = st.assetMap[selected];
    const W = cw, H = ch;
    if (W < 60 || H < 60) return;

    ctx.clearRect(0, 0, W, H);

    const padL = 12, padR = 78, padT = 16, padB = 30;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    if (plotW < 40 || plotH < 40) return;

    const series = a.series;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < series.length; i++) {
      const p = series[i].p;
      if (p < min) min = p;
      if (p > max) max = p;
    }
    // 用日内波动率兜底，避免前几秒的微小波动被放大成满屏尖刺
    const minSpan = a.price * DEFS[selected].volDay * 0.45;
    const pos = st.positions.find(function (p) { return p.assetId === selected; });
    let lq = null;
    if (pos) lq = E.liqPrice(pos);
    if (!isFinite(min) || !isFinite(max)) { min = a.price * 0.999; max = a.price * 1.001; }
    const mid = (min + max) / 2;
    if (max - min < minSpan) { min = mid - minSpan / 2; max = mid + minSpan / 2; }
    const raw = max - min;
    const sp = Math.max(raw, a.price * 0.0006);
    min -= sp * 0.12;
    max += sp * 0.12;
    const ySpan = max - min;

    // 时间轴随交易日推进自动缩放，保证曲线始终占据大部分画幅
    const xMax = clamp(st.dayClock * 1.25 + 4, 20, CFG.DAY_SECONDS);
    const X = function (x) { return padL + (x / xMax) * plotW; };
    const Y = function (p) { return padT + (1 - (p - min) / ySpan) * plotH; };

    // 网格
    ctx.save();
    ctx.lineWidth = 1;
    ctx.font = '10px ' + MONO;
    ctx.textBaseline = 'middle';
    const tagY = clamp(Y(a.price), padT + 9, padT + plotH - 9);
    for (let i = 0; i <= 4; i++) {
      const yy = padT + (plotH * i) / 4;
      const val = max - (ySpan * i) / 4;
      ctx.strokeStyle = 'rgba(255,255,255,.045)';
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
      if (Math.abs(yy - tagY) < 12) continue;
      ctx.fillStyle = '#46525f';
      ctx.textAlign = 'left';
      ctx.fillText(fmtPrice(val, d.digits), padL + plotW + 10, yy);
    }
    const stepT = xMax <= 25 ? 5 : xMax <= 50 ? 10 : xMax <= 80 ? 20 : 30;
    for (let t = 0; t <= CFG.DAY_SECONDS; t += stepT) {
      if (t > xMax + 0.001) break;
      const xx = X(t);
      ctx.strokeStyle = 'rgba(255,255,255,.03)';
      ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + plotH); ctx.stroke();
      ctx.fillStyle = '#39434f';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(t + 's', xx, padT + plotH + 9);
      ctx.textBaseline = 'middle';
    }
    ctx.restore();

    // 开盘点
    const openY = Y(a.open);
    ctx.save();
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.beginPath(); ctx.moveTo(padL, openY); ctx.lineTo(padL + plotW, openY); ctx.stroke();
    ctx.restore();

    // 现价水平线
    ctx.save();
    ctx.setLineDash([1, 4]);
    ctx.strokeStyle = a.price >= a.open ? 'rgba(47,224,138,.2)' : 'rgba(255,77,109,.2)';
    ctx.beginPath(); ctx.moveTo(padL, Y(a.price)); ctx.lineTo(padL + plotW, Y(a.price)); ctx.stroke();
    ctx.restore();

    if (series.length < 2) return;

    const up = a.price >= a.open;
    const col = up ? '#2fe08a' : '#ff4d6d';
    const fillTop = up ? 'rgba(47,224,138,.26)' : 'rgba(255,77,109,.26)';

    // 面积
    const g = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    g.addColorStop(0, fillTop);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.moveTo(X(series[0].x), Y(series[0].p));
    for (let i = 1; i < series.length; i++) ctx.lineTo(X(series[i].x), Y(series[i].p));
    ctx.lineTo(X(series[series.length - 1].x), padT + plotH);
    ctx.lineTo(X(series[0].x), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();

    // 线
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(X(series[0].x), Y(series[0].p));
    for (let i = 1; i < series.length; i++) ctx.lineTo(X(series[i].x), Y(series[i].p));
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.7;
    ctx.lineJoin = 'round';
    ctx.shadowColor = col;
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.restore();

    // 入场 / 爆仓线
    if (pos) {
      const drawLine = function (price, color, label) {
        const yy = Y(price);
        if (yy < padT || yy > padT + plotH) return;
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '9px ' + MONO;
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, padL + 4, yy - 2);
        ctx.restore();
      };
      drawLine(pos.entry, 'rgba(245,185,66,.75)', '入场 ' + fmtPrice(pos.entry, d.digits));
      if (lq && lq > 0) drawLine(lq, 'rgba(255,77,109,.8)', '爆仓 ' + fmtPrice(lq, d.digits));
    }

    // 最新价
    const lp = series[series.length - 1];
    const lx = X(lp.x), ly = Y(lp.p);
    ctx.save();
    ctx.beginPath();
    ctx.arc(lx, ly, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.restore();

    // 价格标签
    const label = fmtPrice(a.price, d.digits);
    ctx.save();
    ctx.font = 'bold 10px ' + MONO;
    const tw = ctx.measureText(label).width + 14;
    const tx = padL + plotW + 4;
    ctx.fillStyle = col;
    roundRect(ctx, tx, tagY - 9, Math.min(tw, padR - 12), 18, 4);
    ctx.fill();
    ctx.fillStyle = '#05070a';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, tx + 7, tagY + 0.5);
    ctx.restore();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /* ------------------------------ 结局 ------------------------------ */
  function showEnding(end) {
    if (!end || endingShown) return;
    endingShown = true;
    paused = true;
    renderActionBar();

    const nw = end.netWorth;
    const bigTrade = Math.abs(st.stats.best) >= Math.abs(st.stats.worst) ? st.stats.best : st.stats.worst;
    const statsHTML =
      '<div class="end-stats">' +
        '<div><span>最终净值</span><b>' + fmtY(nw) + '</b></div>' +
        '<div><span>交易次数</span><b>' + st.stats.trades + '</b></div>' +
        '<div><span>爆仓次数</span><b>' + st.stats.liquidations + '</b></div>' +
        '<div><span>最大单笔</span><b>' + (bigTrade === 0 ? '—' : fmtY(bigTrade)) + '</b></div>' +
      '</div>';

    let html = '';
    if (end.type === 'win') {
      const cashout = end.cause === 'cashout';
      html =
        '<div class="end end-win">' +
          '<canvas id="confetti"></canvas>' +
          '<div class="end-card">' +
            '<div class="end-kicker">ENDING 01 — 2000万円達成</div>' +
            '<h1 class="end-title">百万富翁</h1>' +
            '<div class="end-en">MILLIONAIRE</div>' +
            '<div class="end-body">' +
              '<p>三十天前，你的全部财产是五十万日元。</p>' +
              '<p>今天，账户里的数字停在 <b>' + fmtY(nw) + '</b>。</p>' +
              (cashout
                ? '<p>你在第 ' + end.day + ' 天就收了手。剩下的日子，你第一次睡了个整觉。</p>'
                : '<p>你把仓位一笔笔平掉，还清父亲的存折，还清消费者金融，然后在天亮之前，把存折放回原来的抽屉。</p>') +
              '<p>窗外，东京的天空是那种很淡的蓝色。<br>——至少今天，你不用再盯着澳元了。</p>' +
            '</div>' +
            statsHTML +
            '<div class="end-btns">' +
              '<button class="primary" data-action="restart"><span>再来 30 天</span></button>' +
            '</div>' +
          '</div>' +
        '</div>';
    } else if (end.type === 'nothing') {
      html =
        '<div class="end end-nothing">' +
          '<div class="end-card">' +
            '<div class="end-kicker">ENDING 02 — 30日間終了</div>' +
            '<h1 class="end-title">无事发生</h1>' +
            '<div class="end-en">NOTHING HAPPENED</div>' +
            '<div class="end-body">' +
              '<p>结算日。净值 <b>' + fmtY(nw) + '</b>。</p>' +
              '<p>没有暴富，也没有坠落。你关掉行情软件，第二天照常去便利店打工。</p>' +
              (end.debt > 0
                ? '<p>账户里还压着 <b>' + fmtY(end.debt) + '</b> 的债。你算了算，大概要打一年工。</p>'
                : '') +
              '<p>新闻里说，澳元又跌了。你端着便当，忽然想起三十天前的那个晚上。<br>如果当时再多按一次按钮，会不会不一样？</p>' +
            '</div>' +
            statsHTML +
            '<div class="end-btns">' +
              '<button class="primary" data-action="restart"><span>再来一次</span></button>' +
            '</div>' +
          '</div>' +
        '</div>';
    } else {
      let body = '';
      if (end.cause === 'family') {
        body = '<p>爸爸把存折摊在桌上，什么也没说。</p>' +
          '<p>那沉默比任何一句责骂都重。</p>';
      } else if (end.cause === 'debt') {
        body = '<p>利息在夜里一分一秒地长。</p>' +
          '<p>第三十天还没到，账户就已经还不起了。</p>';
      } else if (end.cause === 'final') {
        body = '<p>第三十天。余额没有撑到太阳升起。</p>';
      } else {
        body = '<p>最后那一根 K 线，连反应的时间都没有。</p>' +
          (nw < 0
            ? '<p>强制平仓的提示音响了三遍。账户清零，还倒欠 ' + fmtY(-nw) + '。</p>'
            : '<p>强制平仓的提示音响了三遍，账户里只剩下 ' + fmtY(nw) + '。</p>') +
          '<p>借来的钱、父亲存折里的钱、还有那些说好要还的钱，全都变成了屏幕上一串冷冰冰的数字。</p>';
      }
      html =
        '<div class="end end-fall">' +
          '<div class="speedlines"></div>' +
          '<svg class="faller" viewBox="0 0 40 80" aria-hidden="true">' +
            '<circle cx="20" cy="10" r="6.5"/>' +
            '<path d="M20 17 C15 20 13 27 13 34 L11 52 L15 52 L18 38 L22 38 L25 52 L29 52 L27 34 C27 27 25 20 20 17 Z"/>' +
            '<path d="M15 22 L4 10" />' +
            '<path d="M25 22 L36 10" />' +
            '<path d="M18 50 L13 74" />' +
            '<path d="M22 50 L27 74" />' +
          '</svg>' +
          '<div class="end-card">' +
            '<div class="end-kicker">ENDING 03 — 強制終了</div>' +
            '<h1 class="end-title">空中飞人</h1>' +
            '<div class="end-en">SKYDIVER</div>' +
            '<div class="end-body">' + body +
              '<p>风很大。楼下的人变成了一个很小的点。</p>' +
              '<p>三十天前，这里还站着另一个久留美。</p>' +
            '</div>' +
            statsHTML +
            '<div class="end-btns">' +
              '<button class="primary" data-action="restart"><span>重来一次</span></button>' +
            '</div>' +
          '</div>' +
          '<div class="end-note">这是一段虚构剧情。现实中，任何债务都有协商的余地，任何困境都有走出来的可能。心理援助热线：12356</div>' +
        '</div>';
    }

    el.overlay.innerHTML = html;
    el.overlay.classList.add('active');

    if (end.type === 'win') { Sfx.win(); runConfetti(); }
    else if (end.type === 'fall') { Sfx.fall(); }
    else { Sfx.bell(); }
  }

  function runConfetti() {
    const cvs = document.getElementById('confetti');
    if (!cvs) return;
    cvs.width = window.innerWidth;
    cvs.height = window.innerHeight;
    const c = cvs.getContext('2d');
    const colors = ['#f5b942', '#ffd479', '#fff3c4', '#ff9f43', '#ffb86b'];
    const parts = [];
    for (let i = 0; i < 170; i++) {
      parts.push({
        x: Math.random() * cvs.width,
        y: -Math.random() * cvs.height,
        w: 4 + Math.random() * 6,
        h: 6 + Math.random() * 10,
        vy: 1.2 + Math.random() * 3.2,
        vx: -1.2 + Math.random() * 2.4,
        rot: Math.random() * 6,
        vr: -0.12 + Math.random() * 0.24,
        col: colors[(Math.random() * colors.length) | 0],
      });
    }
    function frame() {
      c.clearRect(0, 0, cvs.width, cvs.height);
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        if (p.y > cvs.height + 20) { p.y = -20; p.x = Math.random() * cvs.width; }
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.globalAlpha = 0.85;
        c.fillStyle = p.col;
        c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        c.restore();
      }
      confettiRaf = requestAnimationFrame(frame);
    }
    frame();
  }
  function stopConfetti() {
    if (confettiRaf) { cancelAnimationFrame(confettiRaf); confettiRaf = 0; }
  }

  /* ------------------------------ 帮助 ------------------------------ */
  function showHelp() {
    const d = document.createElement('div');
    d.className = 'help';
    d.innerHTML =
      '<div class="help-card">' +
        '<div class="hk">HOW TO PLAY</div>' +
        '<h2>30 天，从 50 万到 2000 万</h2>' +
        '<p>每天白天有 <b>120 秒</b> 的实时行情，收盘时所有日间持仓会被强制平仓。夜里可以继续下单，但只能持有到<b>次日开盘</b>，按跳空价结算。</p>' +
        '<p>右上角可以切换播放速度：默认 <b>⅓×</b>（一天约 6 分钟），最快 <b>2×</b>（约 1 分钟）。</p>' +
        '<h3>四个标的，风险递增</h3>' +
        '<ul>' +
          '<li><b>基金</b>：低风险，日波动约 0.4%，无法达成目标。</li>' +
          '<li><b>股票</b>：中风险，最多 3 倍信用杠杆。</li>' +
          '<li><b>美元/日元</b>：高风险，日波动约 0.6%，可上 999 倍。</li>' +
          '<li><b>澳元/日元</b>：极高风险，日波动约 1.4%，最喜欢跳空。</li>' +
        '</ul>' +
        '<h3>杠杆的算法</h3>' +
        '<p>名义金额 = 保证金 × 杠杆。价格反向波动 <b>1/杠杆</b> 时，保证金全部亏光，仓位被强制平仓。999 倍只需要 <b>0.1%</b> 的反向波动。</p>' +
        '<h3>资金</h3>' +
        '<p>可以偷借父亲的 <b>300 万</b>（0 利息，但每晚有 5% 概率被发现，限期 3 天），也可以向消费者金融借款（上限 500 万，日息 0.7%）。<b>净值 = 现金 + 持仓权益 − 负债</b>。</p>' +
        '<h3>结局</h3>' +
        '<p>净值达到 <b>2000 万</b> → 百万富翁；撑过 30 天 → 无事发生；净值归零 / 资不抵债 → <b>空中飞人</b>。</p>' +
        '<p style="margin-top:14px;color:#6b7a8c">快捷键：<b>空格</b> 暂停 / 继续，<b>回车</b> 收盘 / 次日，<b>1·2·3·4</b> 切换标的。</p>' +
        '<button class="help-close" data-action="closehelp">知道了</button>' +
      '</div>';
    document.body.appendChild(d);
    Sfx.click();
  }

  /* ------------------------------ 启动 ------------------------------ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
