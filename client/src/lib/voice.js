// Voice chat between the 4 players of a room.
// Replaces the legacy PeerJS implementation (which depended on an external server)
// with a plain WebRTC mesh; signalling is relayed by server.js through the 'rtc' event.

const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];
const SEAT_NO = { green0: 0, purple0: 1, green1: 2, purple1: 3 };

export class VoiceMesh {
  constructor(socket, { roomId, pass, me, onChange }) {
    this.socket = socket;
    this.roomId = roomId;
    this.pass = pass;
    this.me = me;
    this.onChange = onChange || (() => { });
    this.peers = {};     // player -> { pc, audio, muted }
    this.stream = null;
    this.micMuted = false;
    this.handler = (msg) => this.onSignal(msg);
    
    // Start listening and join mesh immediately (receive-only initially)
    this.socket.on('rtc', this.handler);
    this.send('join', '*');
  }

  send(type, to, data) {
    this.socket.emit('rtc', { id: this.roomId, passw: this.pass, from: this.me, to, type, data });
  }

  async startCamera() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true,
          autoGainControl: true,
          googEchoCancellation: true,
          googAutoGainControl: true,
          googNoiseSuppression: true,
          googHighpassFilter: true
        }, 
        video: { width: 320, height: 240, frameRate: 15 } 
      });
      // Reconnect to all peers to send the new stream
      Object.keys(this.peers).forEach((p) => this.closePeer(p, true));
      this.send('join', '*');
      this.emitChange();
    } catch (err) {
      console.error('Camera/Mic permission error:', err);
      alert('Camera/Microphone access denied! Please allow permissions in your browser settings.');
    }
  }

  stopCamera() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    // Reconnect to all peers to drop the stream
    Object.keys(this.peers).forEach((p) => this.closePeer(p, true));
    this.send('join', '*');
    this.emitChange();
  }
  
  destroy() {
    try { this.send('leave', '*'); } catch { /* ignore */ }
    this.socket.off('rtc', this.handler);
    Object.keys(this.peers).forEach((p) => this.closePeer(p, true));
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  emitChange() {
    const peers = {};
    Object.entries(this.peers).forEach(([p, v]) => { peers[p] = { state: v.state, muted: v.muted, stream: v.stream }; });
    this.onChange({ active: !!this.stream, micMuted: this.micMuted, peers, localStream: this.stream });
  }

  setMicMuted(m) {
    this.micMuted = m;
    if (this.stream) this.stream.getAudioTracks().forEach((t) => { t.enabled = !m; });
    this.emitChange();
  }

  setPeerMuted(player, m) {
    const p = this.peers[player];
    if (!p) return;
    p.muted = m;
    if (p.audio) p.audio.muted = m;
    this.emitChange();
  }

  createPeer(player) {
    if (this.peers[player]) return this.peers[player];
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const entry = { pc, audio: null, muted: false, state: 'connecting' };
    this.peers[player] = entry;
    if (this.stream) this.stream.getTracks().forEach((t) => pc.addTrack(t, this.stream));
    pc.onicecandidate = (e) => { if (e.candidate) this.send('ice', player, e.candidate); };
    pc.ontrack = (e) => {
      if (!entry.audio) {
        entry.audio = new Audio();
        entry.audio.autoplay = true;
        entry.audio.muted = entry.muted;
      }
      entry.audio.srcObject = e.streams[0];
      entry.stream = e.streams[0];
      const p = entry.audio.play();
      if (p && p.catch) p.catch(() => { });
      this.emitChange();
    };
    pc.onconnectionstatechange = () => {
      entry.state = pc.connectionState;
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.closePeer(player, true);
      this.emitChange();
    };
    this.emitChange();
    return entry;
  }

  closePeer(player, silent) {
    const p = this.peers[player];
    if (!p) return;
    try { p.pc.close(); } catch { /* ignore */ }
    if (p.audio) { p.audio.pause(); p.audio.srcObject = null; }
    delete this.peers[player];
    if (!silent) this.emitChange();
  }

  async makeOffer(player) {
    if (this.peers[player]) return;
    const { pc } = this.createPeer(player);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send('offer', player, pc.localDescription);
  }

  onSignal(msg) {
    // process strictly in order (ICE must not be added before the remote description)
    this.queue = (this.queue || Promise.resolve()).then(() => this.processSignal(msg));
    return this.queue;
  }

  async processSignal(msg) {
    if (!msg || msg.from === this.me) return;
    if (msg.to !== '*' && msg.to !== this.me) return;
    const from = msg.from;
    try {
      switch (msg.type) {
        case 'join':
          // Peer restarted their mesh (camera added/removed). Reset connection.
          if (this.peers[from]) this.closePeer(from, true);
          // the lower seat number always creates the offer (avoids offer glare)
          if (SEAT_NO[this.me] < SEAT_NO[from]) await this.makeOffer(from);
          else this.send('hello', from);
          break;
        case 'hello':
          if (SEAT_NO[this.me] < SEAT_NO[from]) await this.makeOffer(from);
          break;
        case 'offer': {
          if (this.peers[from]) this.closePeer(from, true);
          const { pc } = this.createPeer(from);
          await pc.setRemoteDescription(msg.data);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.send('answer', from, pc.localDescription);
          break;
        }
        case 'answer':
          if (this.peers[from]) await this.peers[from].pc.setRemoteDescription(msg.data);
          break;
        case 'ice':
          if (this.peers[from]) await this.peers[from].pc.addIceCandidate(msg.data);
          break;
        case 'leave':
          this.closePeer(from);
          break;
        default:
      }
    } catch (e) {
      console.warn('Voice signalling error', e);
    }
  }
}
