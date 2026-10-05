// Legacy game sounds (served by the Node server from /public/img)
class Sound {
  constructor(src, loop = false) {
    this.audio = typeof Audio !== 'undefined' ? new Audio(src) : null;
    if (this.audio) {
      this.audio.loop = loop;
      this.audio.preload = 'auto';
    }
  }
  play() {
    if (!this.audio || Sound.muted) return;
    try {
      this.audio.currentTime = 0;
      const p = this.audio.play();
      if (p && p.catch) p.catch(() => { });
    } catch { /* ignore */ }
  }
  stop() {
    if (!this.audio) return;
    try { this.audio.pause(); } catch { /* ignore */ }
  }
}
Sound.muted = false;

export const sounds = {
  turn: new Sound('/img/ting.mp3', true),
  play: new Sound('/img/play.mp3'),
  countdown: new Sound('/img/cdown.mp3', true),
  setMuted(m) {
    Sound.muted = m;
    if (m) { this.turn.stop(); this.countdown.stop(); }
  },
};
