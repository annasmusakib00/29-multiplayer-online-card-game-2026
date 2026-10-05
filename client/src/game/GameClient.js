// The 29 Game – client engine.
// A faithful port of the legacy public/js/script.js socket logic, kept outside React
// so that delayed handlers (setTimeout pacing copied from the original game) always
// read the latest state. React subscribes to it through useSyncExternalStore.

import { io } from 'socket.io-client';
import {
  PLAYERS, playerFromNumber, numberFromPlayer, teamOf, nameOf, cardDetail, sortCards,
  parseDeal, teamWinner, timeDiff, validName, escapeHTML, safeLogHTML,
} from '../lib/cards';
import { sounds } from '../lib/sound';
import { VoiceMesh } from '../lib/voice';

const SESSION_KEY = 'g29.session';
const TURN_WARN_MS = 60000;

function initialBid() {
  return {
    open: false, log: [], cards: [], stage: 'bid', mode: null,
    min: 16, value: 16, current: 16, turn: null, bw: null, raiseOrMatch: '', kind: null,
  };
}
function initialTrump() {
  return { setter: null, mySuit: null, card: null, open: false, card7: '' };
}
function initialMy() {
  return { active: false, firstplay: false, allowed: [], canOpenTrump: false, waitingTrump: false };
}

function initialState() {
  return {
    connected: false,
    latency: null,
    phase: 'lobby',            // lobby | team | resuming | waiting | game
    rooms: [],
    roomsLoaded: false,
    room: null,                // { id, name, pass, mode }
    teamInfo: { tp: [], tg: [] },
    me: null,                  // { name, team, uid, id }
    isHost: false,
    adminPass: '',
    names: ['', '', '', ''],   // [green0, purple0, green1, purple1]
    hands: [[], [], [], []],
    dealt: false,
    table: {},                 // player -> card currently on the table
    tableOrder: [],
    trickWinner: null,
    points: [0, 0, 0, 0],
    rounds: [0, 0, 0, 0],
    bids: ['', '', '', ''],
    bidWinner: null,
    bid: initialBid(),
    trump: initialTrump(),
    turn: null,                // { player, since }
    my: initialMy(),
    selected: null,
    sortMode: 'sort',
    gameOver: null,
    startTime: null,
    matchRunning: false,
    sockMsgCount: 0,
    chat: [],
    unread: 0,
    chatOpen: false,
    chipCooldown: false,
    hue: 0,
    soundOn: true,
    toasts: [],
    history: { requested: false, tabs: {}, count: null, unavailable: false },
    voice: { active: false, micMuted: false, peers: {}, error: '' },
    ui: { createError: '', createBusy: false, loginError: null, deleteError: null, joinError: '', joinBusy: false },
  };
}

class GameClient {
  constructor() {
    this.state = initialState();
    this.version = 0;
    this.listeners = new Set();
    this.timers = new Set();
    this.turnWarn = null;
    this.toastId = 0;
    this.voice = null;
    this.subscribe = this.subscribe.bind(this);
    this.getVersion = this.getVersion.bind(this);
    this.restoreSession();
    this.connect();
  }

  /* ---------------- store plumbing ---------------- */
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  getVersion() { return this.version; }
  commit() { this.version++; this.listeners.forEach((fn) => fn()); }

  later(fn, ms, immediate) {
    if (immediate || !ms) { fn(); return; }
    const t = setTimeout(() => { this.timers.delete(t); fn(); this.commit(); }, ms);
    this.timers.add(t);
  }
  clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.stopTurnWarn();
  }

  toast(html, kind = 'info', ms = 2600) {
    const id = ++this.toastId;
    this.state.toasts = [...this.state.toasts.slice(-4), { id, html, kind }];
    setTimeout(() => {
      this.state.toasts = this.state.toasts.filter((t) => t.id !== id);
      this.commit();
    }, ms);
  }

  get meId() { return this.state.me ? this.state.me.id : ''; }
  get myNo() { return numberFromPlayer(this.meId); }
  get myHand() { return this.myNo >= 0 ? this.state.hands[this.myNo] : []; }
  emit(ev, data) { this.socket.emit(ev, data); }
  roomAuth() { return { id: this.state.room.id, passw: this.state.room.pass }; }
  tag(team, text) { return `<${team}>${text}</${team}>`; }

  /* ---------------- session (refresh / reconnect) ---------------- */
  saveSession() {
    const s = this.state;
    if (!s.room || !s.me) return;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        room: s.room, me: s.me, isHost: s.isHost, adminPass: s.adminPass, startTime: s.startTime,
      }));
    } catch { /* ignore */ }
  }
  clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }
  restoreSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (!d.room || !d.me) return;
      Object.assign(this.state, {
        room: d.room, me: d.me, isHost: !!d.isHost, adminPass: d.adminPass || '',
        startTime: d.startTime || null, phase: 'resuming',
      });
      this.pendingResume = true;
    } catch { /* ignore */ }
  }

  /* ---------------- socket ---------------- */
  connect() {
    const url = import.meta.env.VITE_SERVER_URL || undefined;
    const socket = io(url, { transports: ['websocket', 'polling'] });
    this.socket = socket;
    const on = (ev, fn) => socket.on(ev, (data) => { try { fn.call(this, data || {}); } catch (e) { console.error(ev, e); } this.commit(); });

    on('connect', this.onConnect);
    on('disconnect', () => { this.state.connected = false; });
    on('roomlist', this.onRoomList);
    on('addroom', this.onAddRoom);
    on('login', this.onLogin);
    on('addplayer', this.onAddPlayer);
    on('deleteroom', this.onDeleteRoom);
    on('roomclosed', this.onRoomClosed);
    on('prf', this.onProfile);
    on('cst', this.onDeal);
    on('bid', this.onBid);
    on('bidover', this.onBidOver);
    on('trump', this.onTrump);
    on('play', this.onPlay);
    on('marriage', this.onMarriage);
    on('chat', this.onChat);
    on('color', this.onColor);
    on('hst', this.onHistory);

    this.pingTimer = setInterval(() => this.ping(), 10000);
  }

  async ping() {
    const t = performance.now();
    try {
      const r = await fetch('/serverPingCheck', { cache: 'no-store' });
      if (r.ok) { this.state.latency = Math.round(performance.now() - t); this.commit(); }
    } catch { /* ignore */ }
  }

  onConnect() {
    const s = this.state;
    s.connected = true;
    this.emit('roomlist', '');
    this.ping();
    if (this.pendingResume) {
      // page was refreshed in the middle of a game: ask the server to replay everything
      this.pendingResume = false;
      s.sockMsgCount = 0;
      this.emit('recon', { ...this.roomAuth(), pl: s.me.name, LM: 0 });
      this.resumeTimer = setTimeout(() => {
        if (this.state.phase === 'resuming') {
          this.clearSession();
          this.resetToLobby();
          this.toast('Previous game is no longer available', 'error', 3500);
          this.commit();
        }
      }, 5000);
    } else if (s.matchRunning && s.room) {
      // legacy 'reconnect' handler: replay only the messages we missed
      this.emit('recon', { ...this.roomAuth(), pl: s.me.name, LM: s.sockMsgCount });
      if (this.voice) setTimeout(() => this.restartVoice(), 2500);
    }
  }

  /* ---------------- lobby ---------------- */
  onRoomList(data) {
    const s = this.state;
    s.rooms = Array.from({ length: data.number || 0 }, (_, i) => ({
      id: data.ids[i], name: data.names[i], ts: data.timestamps[i], users: data.users[i], mode: data.modes[i],
    }));
    s.roomsLoaded = true;
    if (s.phase === 'team' && s.room) {
      if (!s.rooms.find((r) => r.id === s.room.id)) {
        this.resetToLobby();
        this.toast('That room was closed', 'error');
      } else {
        this.emit('login', { id: s.room.id, passw: s.room.pass }); // refresh team members
      }
    }
  }

  onAddRoom(data) {
    const s = this.state;
    s.ui.createBusy = false;
    if (!data.success) { s.ui.createError = data.msg || 'Could not create room'; return; }
    s.ui.createError = '';
    s.isHost = true;
    this.toast('Room created', 'success');
    this.pendingLoginPass = this.createPass;
    this.emit('login', { id: data.id, passw: this.createPass });
  }

  onLogin(data) {
    const s = this.state;
    if (data.success) {
      const pass = s.phase === 'team' && s.room && s.room.id === data.roomID ? s.room.pass : this.pendingLoginPass;
      const listed = s.rooms.find((r) => r.id === data.roomID);
      s.room = { id: data.roomID, name: data.roomN, pass, mode: listed ? listed.mode : 0 };
      s.teamInfo = { tp: data.tp || [], tg: data.tg || [] };
      s.ui.loginError = null;
      if (s.phase === 'lobby') { s.phase = 'team'; s.ui.joinError = ''; }
    } else if (s.phase === 'team') {
      this.resetToLobby();
      this.toast('Room is no longer available', 'error');
    } else {
      s.ui.loginError = { id: this.pendingLoginId, msg: data.wrongpass ? 'Wrong password' : 'Room not found' };
    }
  }

  onDeleteRoom(data) {
    const s = this.state;
    if (s.phase !== 'lobby' && s.phase !== 'team') return; // in-game broadcast after game over
    if (data.success) { this.toast('Room deleted', 'success'); s.ui.deleteError = null; }
    else s.ui.deleteError = { id: this.pendingDeleteId, msg: data.admin ? 'Wrong master password' : 'Room may already be deleted' };
  }

  onRoomClosed(data) {
    const s = this.state;
    if (!s.room || s.room.id !== data.id || s.gameOver) return;
    this.clearSession();
    this.resetToLobby();
    this.toast('The host closed this room', 'error', 3500);
  }

  onAddPlayer(data) {
    const s = this.state;
    s.ui.joinBusy = false;
    if (!data.success) {
      s.ui.joinError = 'Could not join – that team may be full. Pick another team.';
      this.emit('login', { id: s.room.id, passw: s.room.pass });
      return;
    }
    const team = this.pendingTeam;
    s.me = { name: this.pendingName, team, uid: data.playerid, id: team + data.playerid };
    s.names = [data.teamgreen[0] || '', data.teampurple[0] || '', data.teamgreen[1] || '', data.teampurple[1] || ''];
    s.room.mode = parseInt(data.mode) || 0;
    s.phase = 'waiting';
    s.matchRunning = true;
    this.saveSession();
    document.title = `The 29 Game – [${s.me.name}]`;
    this.toast('Game joined', 'success');
    this.initVoice();
  }

  onProfile(data) {
    const s = this.state;
    s.names = [data.tg?.[0] || '', data.tp?.[0] || '', data.tg?.[1] || '', data.tp?.[1] || ''];
    if (s.phase === 'resuming') {
      clearTimeout(this.resumeTimer);
      s.phase = 'waiting';
      s.matchRunning = true;
      document.title = `The 29 Game – [${s.me.name}]`;
      this.initVoice();
    }
  }

  /* ---------------- dealing ---------------- */
  onDeal(data) {
    const s = this.state;
    s.sockMsgCount++;
    const hands = parseDeal(data);
    if (!s.startTime) { s.startTime = Date.now(); this.saveSession(); }
    s.phase = 'game';
    const apply = () => {
      s.hands = hands;
      s.dealt = true;
      s.trump.card = null; // legacy: trump box goes back to BLUE_BACK
      if (!data.recon) this.toast(`Cards distributed – ${hands[0].length}`, 'info', 2200);
    };
    this.later(apply, data.d ? 1500 : 0, data.recon);
  }

  /* ---------------- bidding ---------------- */
  resetRound() {
    const s = this.state;
    this.stopTurnWarn();
    sounds.turn.stop();
    s.turn = null;
    s.bid = { ...initialBid(), open: true };
    s.trump = initialTrump();
    s.my = initialMy();
    s.selected = null;
    s.bids = ['', '', '', ''];
    s.bidWinner = null;
  }

  onBid(data) {
    const s = this.state;
    s.sockMsgCount++;
    if (data.fb) {
      this.later(() => {
        if (s.gameOver) return;
        this.resetRound();
        s.bid.cards = sortCards(this.myHand);
        this.bidProcess(data);
      }, data.d ? 3500 : 2500, data.recon);
    } else this.bidProcess(data);
  }

  bidProcess(data) {
    const s = this.state, b = s.bid, me = this.meId;
    b.open = true;
    b.log = [...b.log, safeLogHTML(data.l)];
    b.mode = null;
    if (data.bd === 'ST') {
      b.stage = 'trump'; b.turn = data.bw; b.bw = data.bw;
      if (me === data.bw) b.mode = 'trump';
      return;
    }
    if (data.bd === 'D') {
      b.stage = 'double'; b.bw = data.bw; b.kind = 'D'; b.turn = null;
      if (s.me.team !== teamOf(data.bw)) b.mode = 'double';
      return;
    }
    if (data.bd === 'RD') {
      b.stage = 'redouble'; b.bw = data.bw; b.kind = 'R'; b.turn = null;
      if (s.me.team === teamOf(data.bw)) b.mode = 'redouble';
      return;
    }
    b.stage = 'bid';
    b.current = parseInt(data.cb);
    b.turn = data.pl;
    b.bw = data.bw;
    if (data.pl === me) {
      if (data.bw === me || data.bw === '-100') { b.min = b.current; b.raiseOrMatch = 'matched bid to&nbsp;'; }
      else { b.min = b.current + 1; b.raiseOrMatch = 'raised bid to&nbsp;'; }
      if (data.bw === '-100') b.raiseOrMatch = 'started bid at&nbsp;';
      b.value = b.min;
      b.mode = 'raise';
      if (!data.recon) sounds.play.play();
    }
  }

  setBidValue(v) { this.state.bid.value = Math.max(this.state.bid.min, Math.min(28, parseInt(v))); this.commit(); }

  placeBid() {
    const s = this.state, b = s.bid;
    if (b.mode !== 'raise') return;
    let rom = b.raiseOrMatch;
    if (rom === 'matched bid to&nbsp;' && b.min !== b.value) rom = 'raised bid to&nbsp;';
    b.mode = null;
    this.emit('bid', {
      ...this.roomAuth(), ps: false, am: String(b.value), pl: this.meId,
      l: `${this.tag(s.me.team, s.me.name)}&nbsp;${rom}<red>${b.value}</red>`, o: { iO: '' },
    });
    this.commit();
  }

  passBid() {
    const s = this.state, b = s.bid;
    if (b.mode !== 'raise') return;
    b.mode = null;
    this.emit('bid', {
      ...this.roomAuth(), ps: true, am: String(b.value), pl: this.meId,
      l: `${this.tag(s.me.team, s.me.name)}&nbsp;passed the bid`, o: { iO: '' },
    });
    this.commit();
  }

  chooseTrump(suit) {
    const s = this.state;
    if (s.bid.mode !== 'trump') return;
    s.bid.mode = null;
    this.emit('trump', {
      ...this.roomAuth(), pl: this.meId, op: 'set', s: suit,
      l: `${this.tag(s.me.team, s.me.name)}&nbsp;set the Trump`,
    });
    this.commit();
  }

  chooseDouble(m) {
    const s = this.state, b = s.bid;
    if (b.mode !== 'double' && b.mode !== 'redouble') return;
    const t = b.kind === 'D' ? 'double' : 'redouble';
    const text = m === 1 ? `did not ${t}` : (m === 2 ? 'doubled' : 'redoubled');
    b.mode = null;
    this.emit('bid', {
      ...this.roomAuth(), ps: '', am: '', pl: this.meId,
      l: `${this.tag(s.me.team, s.me.name)}&nbsp;${text}`, o: { iO: b.kind, m, t: s.me.team },
    });
    this.commit();
  }

  applyTargets(b, bd, bdt) {
    const d = parseInt(bd) === 1 ? '' : ` x${bd}`;
    this.state.bids = [0, 1, 2, 3].map((i) => `${b[i]}${playerFromNumber(i).team === bdt ? d : ''}`);
  }

  onBidOver(data) {
    const s = this.state;
    s.sockMsgCount++;
    s.bid.log = [...s.bid.log, safeLogHTML(data.l)];
    s.bid.mode = null;
    s.bid.stage = 'done';
    this.later(() => {
      s.bid.open = false;
      this.applyTargets(data.b, data.bd, data.bdt);
      const w = playerFromNumber(data.w);
      s.bidWinner = w.player;
      if (!data.recon) this.toast(`${escapeHTML(nameOf(w.player, s.names))} of Team ${this.tag(w.team, w.team.toUpperCase())} won the bid`, 'info', 3200);
    }, 2500, data.recon);
  }

  /* ---------------- trump ---------------- */
  onTrump(data) {
    const s = this.state, me = this.meId;
    s.sockMsgCount++;
    if (data.op === 'open') {
      const tSuit = cardDetail(data.c).suit;
      if (data.pl === me) {
        const hand = this.myHand;
        const trumps = hand.filter((c) => cardDetail(c).suit === tSuit);
        s.my = { ...s.my, active: true, waitingTrump: false, canOpenTrump: false, allowed: trumps.length ? trumps : hand.slice() };
        s.selected = null;
        if (!data.recon) this.toast('You opened the Trump', 'trump');
      } else if (!data.recon) {
        this.toast(`${escapeHTML(nameOf(data.pl, s.names))} opened the Trump`, 'trump');
      }
      s.trump.open = true;
      s.trump.card = data.c;
      s.my.canOpenTrump = false;
    } else if (data.op === 'set') {
      s.trump.setter = data.pl;
      if (data.pl === me) {
        s.trump.mySuit = cardDetail(data.c).suit;
        if (data.c7 && data.c7 !== 'f') {
          s.trump.card7 = data.c7;
          s.sortMode = 'orig';
        }
      }
    }
  }

  /* ---------------- playing ---------------- */
  onPlay(data) {
    const s = this.state;
    s.sockMsgCount++;
    this.stopTurnWarn();
    sounds.turn.stop();
    if (data.op.fp && data.lp === '' && !data.recon) {
      // absolute first play of a round: wait for the bid panel to close
      this.later(() => this.playProcess(data), data.op.re === 'nl' ? 3700 : 4000);
    } else this.playProcess(data);
  }

  playProcess(data) {
    const s = this.state, op = data.op, recon = !!data.recon;

    if (op.re === 'ro') {
      if (!recon) this.later(() => this.toast('New Round', 'info', 2000), 800);
      s.trump.card7 = '';
    } else if (op.re === 'go') {
      s.matchRunning = false;
      this.endTime = Date.now();
      sounds.countdown.stop();
      this.clearSession();
      if (!recon) this.toast('Game Over', 'info', 2000);
    }
    s.my.canOpenTrump = false;
    s.turn = null;
    if (data.pl !== this.meId) { s.my.active = false; s.selected = null; }

    // show the card that was just played (legacy cardPlayed)
    this.cardPlayed(data.lp, data.lpc, data.lpac, recon);

    if (op.fp) {
      if (data.lp && op.re === 'nl') s.trickWinner = data.pl;
      const firstPlayDo = () => {
        if (op.re === 'go') this.showGameOver(op);
        if (op.pt) s.points = op.pt.slice();
        if (op.rs) s.rounds = op.rs.slice();
        s.table = {};
        s.tableOrder = [];
        s.trickWinner = null;
        if (op.re === 'nl') this.activateTurn(data, recon);
        else s.turn = null;
      };
      (data.lp === '' || recon) ? firstPlayDo() : this.later(firstPlayDo, 2000);
    } else {
      this.activateTurn(data, recon);
    }
  }

  cardPlayed(player, card, deck, recon) {
    const s = this.state;
    if (!player || !card) return;
    s.table = { ...s.table, [player]: card };
    s.tableOrder = [...s.tableOrder.filter((p) => p !== player), player];
    const n = numberFromPlayer(player);
    if (n >= 0 && Array.isArray(deck)) {
      const hands = s.hands.slice();
      hands[n] = deck.slice();
      s.hands = hands;
    }
    if (player === this.meId) s.selected = null;
    if (!recon) sounds.play.play();
  }

  activateTurn(data, recon) {
    const s = this.state, me = this.meId;
    if (!data.pl) { s.turn = null; return; }
    s.turn = { player: data.pl, since: Date.now() };
    if (data.pl === me) {
      const { allowed, canOpenTrump } = this.computeAllowed(data);
      s.my = { active: true, firstplay: !!data.op.fp, allowed, canOpenTrump, waitingTrump: false };
      s.selected = null;
      if (!recon) {
        sounds.turn.play();
        if (data.op.re === 'nl') this.toast('Your turn', 'turn', 2000);
      }
    } else {
      s.my = { ...s.my, active: false };
    }
    this.startTurnWarn(data.pl);
  }

  // legacy rules from playProcess / hasSuit / onlycard7left / enableCards
  computeAllowed(data) {
    const s = this.state, hand = this.myHand;
    const c7 = s.trump.card7 && s.trump.card7 !== 'f' ? s.trump.card7 : '';
    let allowed = hand.slice(), canOpenTrump = false;
    if (!data.op.fp) {
      const lead = cardDetail(data.op.fc).suit;
      const skip7 = c7 && !s.trump.open;
      const hasLead = hand.some((c) => !(skip7 && c === c7) && cardDetail(c).suit === lead);
      if (hasLead) allowed = hand.filter((c) => cardDetail(c).suit === lead);
      else canOpenTrump = !s.trump.open;
    }
    const only7Left = hand.length === 1 && hand[0] === c7;
    if (c7 && !(only7Left || s.trump.open)) allowed = allowed.filter((c) => c !== c7);
    return { allowed, canOpenTrump };
  }

  startTurnWarn(player) {
    this.stopTurnWarn();
    const s = this.state;
    this.turnWarn = setInterval(() => {
      if (!s.turn || s.turn.player !== player) return this.stopTurnWarn();
      const html = player === this.meId ? 'Please play a card' : `${escapeHTML(nameOf(player, s.names))} has not played a card for a long time`;
      this.toast(html, 'error', 3000);
      this.commit();
    }, TURN_WARN_MS);
  }
  stopTurnWarn() { if (this.turnWarn) clearInterval(this.turnWarn); this.turnWarn = null; }

  showGameOver(op) {
    const s = this.state;
    const rs = op.rs || s.rounds;
    s.turn = null;
    s.my = initialMy();
    s.gameOver = {
      winner: teamWinner(rs),
      time: timeDiff((this.endTime || Date.now()) - (s.startTime || Date.now())),
      rows: PLAYERS.map((p, i) => ({
        player: p, team: teamOf(p), name: s.names[i],
        points: op.pw ? op.pw[i] : '-', hands: op.hw ? op.hw[i] : '-', rounds: rs[i],
      })),
    };
    this.stopVoice();
  }

  selectCard(card) {
    const s = this.state;
    if (!s.my.active || !s.my.allowed.includes(card)) return;
    if (s.selected === card) this.playCard(card);
    else { s.selected = card; this.commit(); }
  }

  playCard(card) {
    const s = this.state;
    card = card || s.selected;
    if (!card || !s.my.active || !s.my.allowed.includes(card)) return;
    s.my = { ...s.my, active: false, canOpenTrump: false };
    s.selected = card;
    this.emit('play', { ...this.roomAuth(), pl: this.meId, c: card, fp: s.my.firstplay });
    this.commit();
  }

  openTrump() {
    const s = this.state;
    if (!s.my.canOpenTrump || s.trump.open) return;
    s.my = { ...s.my, active: false, canOpenTrump: false, waitingTrump: true };
    s.selected = null;
    this.emit('trump', { ...this.roomAuth(), pl: this.meId, op: 'open', s: '', l: '' });
    this.commit();
  }

  onMarriage(data) {
    const s = this.state;
    s.sockMsgCount++;
    this.later(() => {
      const t = teamOf(data.pl);
      if (!data.recon) this.toast(`${escapeHTML(nameOf(data.pl, s.names))} of Team ${this.tag(t, t.toUpperCase())} has a marriage!`, 'trump', 2800);
      this.applyTargets(data.b, data.bd, data.bdt);
    }, data.d === 'play' ? 1400 : 600, data.recon);
  }

  /* ---------------- chat / color / history ---------------- */
  onChat(data) {
    const s = this.state;
    const html = safeLogHTML(data.msg);
    s.chat = [...s.chat.slice(-199), { id: Date.now() + Math.random(), html }];
    if (!s.chatOpen) { s.unread++; this.toast(html, 'chat', 4000); }
  }

  sendChat(text) {
    const s = this.state;
    const t = String(text || '').trim();
    if (!t || !s.room || !s.me) return;
    if (t === 'reconnectGame') setTimeout(() => this.emit('recon', { ...this.roomAuth(), pl: s.me.name, LM: s.sockMsgCount }), 2000);
    if (t === 'reconnectVoice') setTimeout(() => this.restartVoice(), 2000);
    const msg = `${this.tag(s.me.team, `${escapeHTML(s.me.name)}:&nbsp;`)}&nbsp;${escapeHTML(t)}`;
    this.emit('chat', { ...this.roomAuth(), msg });
  }

  sendChip(text) {
    const s = this.state;
    if (s.chipCooldown || !s.room || !s.me) return;
    const msg = `${this.tag(s.me.team, `${escapeHTML(s.me.name)}:&nbsp;`)}&nbsp;<red>${escapeHTML(text)}</red>`;
    this.emit('chat', { ...this.roomAuth(), msg });
    s.chipCooldown = true;
    setTimeout(() => { s.chipCooldown = false; this.commit(); }, 3000);
    this.commit();
  }

  setChatOpen(open) { this.state.chatOpen = open; if (open) this.state.unread = 0; this.commit(); }

  onColor(data) {
    if (data.pl !== this.meId) this.state.hue = parseInt(data.val) || 0;
  }
  setHue(val, broadcast) {
    const s = this.state;
    s.hue = parseInt(val) || 0;
    if (broadcast && s.room && s.me) this.emit('color', { ...this.roomAuth(), pl: this.meId, val: s.hue });
    this.commit();
  }

  loadHistory() {
    const s = this.state;
    s.history = { requested: true, tabs: {}, count: null, unavailable: false };
    [0, 1, 2, 3].forEach((idx) => this.emit('hst', { idx }));
    clearTimeout(this.histTimer);
    this.histTimer = setTimeout(() => {
      if (!Object.keys(this.state.history.tabs).length) { this.state.history.unavailable = true; this.commit(); }
    }, 4000);
    this.commit();
  }
  onHistory(data) {
    const h = this.state.history;
    h.tabs = { ...h.tabs, [data.idx]: data.data || [] };
    if (data.idx === 0 && data.c !== undefined) h.count = data.c;
  }

  /* ---------------- lobby actions ---------------- */
  refreshRooms() { this.emit('roomlist', ''); }

  createRoom({ name, pass, mode, admin }) {
    const s = this.state;
    name = (name || '').trim();
    if (!validName(name, 10)) { s.ui.createError = 'Room name: 1-10 letters/digits (space - _ allowed)'; return this.commit(); }
    if (!pass || !pass.trim()) { s.ui.createError = 'Set a room password'; return this.commit(); }
    if (!admin) { s.ui.createError = 'Master admin password is required'; return this.commit(); }
    s.ui.createError = '';
    s.ui.createBusy = true;
    this.createPass = pass;
    s.adminPass = admin;
    this.emit('addroom', { name, pass, timestamp: '123', mode: parseInt(mode) || 0, admin });
    this.commit();
  }

  loginRoom(id, pass) {
    if (!pass) return;
    this.pendingLoginId = id;
    this.pendingLoginPass = pass;
    this.state.isHost = false;
    this.state.ui.loginError = null;
    this.emit('login', { id, passw: pass });
    this.commit();
  }

  deleteRoom(id, admin) {
    if (!admin) return;
    this.pendingDeleteId = id;
    this.state.ui.deleteError = null;
    this.emit('deleteroom', { id, admin });
    this.commit();
  }

  joinTeam(name, team) {
    const s = this.state;
    name = (name || '').trim();
    if (!validName(name, 15)) { s.ui.joinError = 'Name: 1-15 letters/digits (space - _ allowed)'; return this.commit(); }
    if (team !== 'green' && team !== 'purple') { s.ui.joinError = 'Please select a team'; return this.commit(); }
    s.ui.joinError = '';
    s.ui.joinBusy = true;
    this.pendingName = name;
    this.pendingTeam = team;
    this.emit('addplayer', { ...this.roomAuth(), playername: name, team });
    this.commit();
  }

  backToLobby() { this.resetToLobby(); this.commit(); }

  hostDeleteCurrentRoom() {
    const s = this.state;
    if (!s.isHost || !s.room) return;
    this.emit('deleteroom', { id: s.room.id, admin: s.adminPass });
  }

  leaveTable() {
    this.clearSession();
    this.resetToLobby();
    this.commit();
  }

  resetToLobby() {
    this.clearTimers();
    this.stopVoice();
    sounds.turn.stop();
    sounds.countdown.stop();
    const keep = { connected: this.state.connected, latency: this.state.latency, rooms: this.state.rooms, roomsLoaded: this.state.roomsLoaded, soundOn: this.state.soundOn, toasts: this.state.toasts };
    this.state = { ...initialState(), ...keep };
    document.title = 'The 29 Game';
    // leave socket.io rooms cleanly by reconnecting
    if (this.socket && this.socket.connected) { this.socket.disconnect(); this.socket.connect(); }
  }

  toggleSort() { const s = this.state; s.sortMode = s.sortMode === 'sort' ? 'orig' : 'sort'; this.commit(); }
  toggleSound() { const s = this.state; s.soundOn = !s.soundOn; sounds.setMuted(!s.soundOn); this.commit(); }

  /* ---------------- voice ---------------- */
  initVoice() {
    const s = this.state;
    if (this.voice || !s.room || !s.me) return;
    if (!navigator.mediaDevices || !window.RTCPeerConnection) {
      s.voice.error = 'Voice is not supported in this browser (needs HTTPS or localhost)';
      return this.commit();
    }
    this.voice = new VoiceMesh(this.socket, {
      roomId: s.room.id, pass: s.room.pass, me: this.meId,
      onChange: (v) => { this.state.voice = { ...this.state.voice, ...v, error: '' }; this.commit(); },
    });
  }

  async toggleVoice() {
    const s = this.state;
    if (!this.voice) this.initVoice();
    if (!this.voice) {
      this.toast('Voice is not supported in this browser', 'error', 3500);
      return;
    }
    if (s.voice.active) {
      this.voice.stopCamera();
    } else {
      try {
        await this.voice.startCamera();
        this.toast('Video/Voice chat connected', 'success');
      } catch (e) {
        s.voice = { ...s.voice, active: false, error: 'Camera/Microphone permission denied' };
        this.toast('Camera/Microphone permission denied', 'error', 3500);
        console.warn(e);
      }
      this.commit();
    }
  }

  stopVoice() {
    if (this.voice) { this.voice.destroy(); this.voice = null; }
    this.state.voice = { active: false, micMuted: false, peers: {}, error: '' };
  }
  restartVoice() { this.stopVoice(); this.initVoice(); }
  toggleMic() { if (this.voice) this.voice.setMicMuted(!this.state.voice.micMuted); }
  togglePeerMute(player) {
    if (!this.voice) return;
    const p = this.state.voice.peers[player];
    if (p) this.voice.setPeerMuted(player, !p.muted);
  }
}

let instance = null;
export function getClient() {
  if (!instance) instance = new GameClient();
  return instance;
}
