// Pure helpers ported 1:1 from the legacy public/js/script.js

// Seat numbers used by the server: 0 -> green0, 1 -> purple0, 2 -> green1, 3 -> purple1
export const PLAYERS = ['green0', 'purple0', 'green1', 'purple1'];

export function playerFromNumber(number) {
  switch (parseInt(number)) {
    case 0: return { player: 'green0', id: 0, team: 'green' };
    case 1: return { player: 'purple0', id: 0, team: 'purple' };
    case 2: return { player: 'green1', id: 1, team: 'green' };
    case 3: return { player: 'purple1', id: 1, team: 'purple' };
    default: return null;
  }
}

export function numberFromPlayer(player) {
  return PLAYERS.indexOf(player);
}

export function teamOf(player) {
  return player && player.startsWith('purple') ? 'purple' : 'green';
}

// Same as the legacy `elemfromidteam` rotation: me -> bottom, next seat -> left, etc.
// Play goes anti-clockwise on the server (0 -> 3 -> 2 -> 1), i.e. bottom -> right -> top -> left.
export function seatOf(player, me) {
  const p = numberFromPlayer(player);
  const m = numberFromPlayer(me);
  if (p < 0 || m < 0) return null;
  return ['bottom', 'left', 'top', 'right'][(p - m + 4) % 4];
}

export function playerAtSeat(seat, me) {
  const m = numberFromPlayer(me);
  const off = ['bottom', 'left', 'top', 'right'].indexOf(seat);
  return PLAYERS[(m + off) % 4];
}

export function nameOf(player, names) {
  const n = numberFromPlayer(player);
  return n >= 0 ? names[n] || '' : '';
}

export function cardDetail(card) {
  const suit = card.slice(card.length - 1);
  const val = card.slice(0, card.length - 1);
  const point = val === 'J' ? 3 : val === '9' ? 2 : (val === 'A' || val === '10') ? 1 : 0;
  const rankMap = { '7': 1, '8': 2, Q: 3, K: 4, '10': 5, A: 6, '9': 7, J: 8 };
  return { card, val, suit, point, rank: rankMap[val] ?? -1 };
}

const SUIT_ORDER = { H: 500, S: 400, D: 300, C: 200 };
export function sortCards(cards) {
  return cards.slice().sort((a, b) => {
    const A = cardDetail(a), B = cardDetail(b);
    return (B.rank + SUIT_ORDER[B.suit]) - (A.rank + SUIT_ORDER[A.suit]);
  });
}

// 'cst' payload parsing — same algorithm as legacy (10 is the only 3-char card)
export function parseDeal(data) {
  const list = [];
  let i = 0;
  while (i < data.c.length) {
    if (data.c[i] === '1') { list.push(data.c.substring(i, i + 3)); i += 3; }
    else { list.push(data.c.substring(i, i + 2)); i += 2; }
  }
  const m = parseInt(data.m);
  const per = list.length / m;
  const hands = [];
  for (let p = 0; p < m; p++) hands.push(list.slice(p * per, p * per + per));
  return hands;
}

// legacy indexOfMax for 2-team comparison: 0 green, 1 purple, -2 draw
export function teamWinner(rs) {
  if (rs[0] > rs[1]) return 'green';
  if (rs[1] > rs[0]) return 'purple';
  return null;
}

export const SUITS = {
  H: { name: 'Hearts', icon: '♥', red: true },
  S: { name: 'Spades', icon: '♠', red: false },
  D: { name: 'Diamonds', icon: '♦', red: true },
  C: { name: 'Clubs', icon: '♣', red: false },
};

export const cardImg = (card) => `/img/cards/${card}.PNG`;
export const backImg = (team) => `/img/cards/${(team || 'blue').toUpperCase()}_BACK.PNG`;

export function zeroPad(num, len) {
  return String(num).padStart(len, '0');
}

export function timeDiff(diff) {
  const h = Math.floor(diff / 3600000);
  const m = Math.floor(diff / 60000) % 60;
  const s = Math.floor(diff / 1000) % 60;
  return `${zeroPad(h, 2)}:${zeroPad(m, 2)}:${zeroPad(s, 2)}`;
}

export function timeAbs(time) {
  const d = new Date(time);
  return `${zeroPad(d.getHours(), 2)}:${zeroPad(d.getMinutes(), 2)}  ${zeroPad(d.getDate(), 2)}/${zeroPad(d.getMonth() + 1, 2)}/${d.getFullYear()}`;
}

// legacy checkSpChars: names may only contain letters, digits, space, - and _
export function validName(t, max) {
  return !!t && t.length <= max && /^[a-zA-Z0-9][a-zA-Z0-9-_ ]*$/.test(t);
}

export function escapeHTML(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Server logs / chat arrive as small HTML snippets using <green>, <purple>, <red> tags.
// Keep only those tags, strip everything else (prevents XSS from other clients).
export function safeLogHTML(html) {
  return String(html)
    .replace(/<(\/?)(green|purple|red)>/g, '\u0001$1$2\u0002')
    .replace(/<[^>]*>/g, '')
    .replace(/\u0001(\/?)(green|purple|red)\u0002/g, '<$1$2>');
}
