// Networking transport for Public lobbies — PeerJS over its free public broker.
// No account, no billing. Star topology: the host is authoritative and relays to
// every client. This module is pure transport; game logic lives in state.js.

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error("PeerJS CDN failed to load (offline?)"));
    document.head.appendChild(s);
  });
}

export async function loadPeer() {
  if (window.Peer) return window.Peer;
  await loadScript("https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js");
  if (!window.Peer) throw new Error("PeerJS missing after load");
  return window.Peer;
}

// Host claims `code` as its peer id so clients can connect by typing the code.
// Rejects with {type:'unavailable-id'} if the code is taken (caller retries).
export async function host(code, { onJoin, onLeave, onMessage, onError } = {}) {
  const Peer = await loadPeer();
  return await new Promise((resolve, reject) => {
    const peer = new Peer(code);
    const conns = new Map();
    let open = false;

    peer.on("open", (id) => {
      open = true;
      resolve({
        id,
        peer,
        conns,
        send: (pid, m) => { const c = conns.get(pid); if (c && c.open) c.send(m); },
        broadcast: (m) => { for (const c of conns.values()) if (c.open) c.send(m); },
        destroy: () => peer.destroy(),
      });
    });

    peer.on("connection", (conn) => {
      conn.on("open", () => { conns.set(conn.peer, conn); onJoin && onJoin(conn.peer); });
      conn.on("data", (d) => onMessage && onMessage(conn.peer, d));
      conn.on("close", () => { conns.delete(conn.peer); onLeave && onLeave(conn.peer); });
    });

    peer.on("error", (e) => {
      if (!open) reject(Object.assign(new Error(e.message || "host error"), { type: e.type }));
      else onError && onError(e);
    });
  });
}

// Client connects to a host by code. Resolves once the data channel is open.
export async function join(code, { onData, onClose, onError } = {}) {
  const Peer = await loadPeer();
  return await new Promise((resolve, reject) => {
    const peer = new Peer();
    let settled = false;

    peer.on("open", () => {
      const conn = peer.connect(code, { reliable: true });
      conn.on("open", () => {
        settled = true;
        resolve({ peer, conn, send: (m) => { if (conn.open) conn.send(m); }, destroy: () => peer.destroy() });
      });
      conn.on("data", (d) => onData && onData(d));
      conn.on("close", () => onClose && onClose());
      conn.on("error", (e) => { if (!settled) { settled = true; reject(e); } else onError && onError(e); });
    });

    peer.on("error", (e) => {
      if (!settled) { settled = true; reject(Object.assign(new Error(e.message || "join error"), { type: e.type })); }
      else onError && onError(e);
    });

    setTimeout(() => { if (!settled) { settled = true; reject(new Error("Join timed out — check the code or the host may be offline")); } }, 12000);
  });
}
