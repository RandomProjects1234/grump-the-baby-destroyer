// Peer-to-peer co-op over PeerJS. The host runs the simulation -- phase clock,
// generator, Bob, Grump, toddlers, loot rolls -- and mirrors it to everyone
// else. Clients own only their own position, which keeps movement responsive
// on a home connection.
//
// Nothing here needs a server of our own, which is why the game can live on
// GitHub Pages.

const PREFIX = 'grump-school-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode(n = 5) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[(Math.random() * ALPHABET.length) | 0];
  return s;
}

export class Net {
  constructor(game) {
    this.game = game;
    this.peer = null;
    this.conns = new Map();       // host: peerId -> connection
    this.hostConn = null;         // client: connection to the host
    this.isHost = false;
    this.online = false;
    this.code = null;
    this.myId = 'solo';
  }

  get playerCount() { return this.online ? (this.isHost ? this.conns.size + 1 : 1 + this.game.remotePlayers.size) : 1; }

  host(onReady, onError) {
    if (typeof Peer === 'undefined') { onError('PeerJS did not load. Check your connection.'); return; }
    const attempt = n => {
      const code = makeCode();
      const peer = new Peer(PREFIX + code, { debug: 0 });
      let settled = false;
      peer.on('open', () => {
        settled = true;
        this.peer = peer; this.isHost = true; this.online = true;
        this.code = code; this.myId = 'host';
        peer.on('connection', c => this.accept(c));
        onReady(code);
      });
      peer.on('error', err => {
        if (settled) { this.game.ui.chat(`<i>network: ${err.type}</i>`); return; }
        peer.destroy();
        if (err.type === 'unavailable-id' && n < 4) attempt(n + 1);
        else onError('Could not open a room (' + err.type + ')');
      });
    };
    attempt(0);
  }

  accept(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      conn.on('data', d => this.game.onNetMessage(d, conn.peer));
      const bye = () => { this.conns.delete(conn.peer); this.game.onPeerLeave(conn.peer); };
      conn.on('close', bye);
      conn.on('error', bye);
      this.game.onPeerJoin(conn.peer);
    });
  }

  join(code, onReady, onError) {
    if (typeof Peer === 'undefined') { onError('PeerJS did not load. Check your connection.'); return; }
    const peer = new Peer({ debug: 0 });
    this.peer = peer;
    let opened = false;
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
      const timer = setTimeout(() => { if (!opened) onError('No answer from that room code.'); }, 12000);
      conn.on('open', () => {
        opened = true;
        clearTimeout(timer);
        this.hostConn = conn; this.isHost = false; this.online = true;
        this.code = code.toUpperCase(); this.myId = peer.id;
        conn.on('data', d => this.game.onNetMessage(d, 'host'));
        conn.on('close', () => this.game.onHostGone());
        onReady();
      });
      conn.on('error', () => { clearTimeout(timer); onError('Could not reach that room.'); });
    });
    peer.on('error', err => {
      if (!opened) onError(err.type === 'peer-unavailable' ? 'That room code is not open.' : 'Network error: ' + err.type);
    });
  }

  send(msg) {
    if (!this.online) return;
    if (this.isHost) this.broadcast(msg);
    else if (this.hostConn && this.hostConn.open) this.hostConn.send(msg);
  }

  broadcast(msg, except) {
    if (!this.online || !this.isHost) return;
    for (const [id, c] of this.conns) if (id !== except && c.open) c.send(msg);
  }

  sendTo(id, msg) {
    const c = this.conns.get(id);
    if (c && c.open) c.send(msg);
  }

  close() {
    try { for (const c of this.conns.values()) c.close(); } catch (e) { /* going away anyway */ }
    try { if (this.hostConn) this.hostConn.close(); } catch (e) { /* going away anyway */ }
    try { if (this.peer) this.peer.destroy(); } catch (e) { /* going away anyway */ }
    this.conns.clear();
    this.peer = null; this.hostConn = null;
    this.online = false; this.isHost = false; this.code = null;
  }
}
