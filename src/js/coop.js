// Co-op (fortress only) over the existing Cloudflare room relay (k5a-rooms, same as 같이 외우기 / 단어 바).
//   host:   wss://…/room/ABCD?role=host&key=…     sends {to?, d}   receives {k:"join"|"leave"|"msg", id|from, d}
//   player: wss://…/room/ABCD?role=player&id=…    sends any JSON (max 15/s, 16 kB)   receives d
// The relay only allows the pages at davichi55.github.io and localhost:8322 (Origin check).
const RELAY = "wss://k5a-rooms.sparkheavenapp.workers.dev/room/";
const rid = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");

export class Net {
  constructor(){ this.ws = null; this.role = null; this.code = null; this.key = null; this.id = null; this.partner = null;
    this.onMsg = () => {}; this.onStatus = () => {}; this.closed = false; }
  host(){
    this.role = "host"; this.key = rid(24);
    this.code = Array.from(crypto.getRandomValues(new Uint8Array(4)), b => "ABCDEFGHJKLMNPQRSTUVWXYZ"[b % 24]).join("");
    this.open(`${RELAY}${this.code}?role=host&key=${this.key}`);
    return this.code;
  }
  join(code){ this.role = "client"; this.code = code.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4); this.id = rid(10);
    this.open(`${RELAY}${this.code}?role=player&id=${this.id}`); }
  open(url){
    this.closed = false;
    const ws = this.ws = new WebSocket(url);
    ws.onopen = () => this.onStatus("open");
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (this.role === "host") {
        if (m.k === "join") { this.partner = m.id; this.onStatus("partner-join", m.id); }
        else if (m.k === "leave") { if (m.id === this.partner) this.partner = null; this.onStatus("partner-leave", m.id); }
        else if (m.k === "msg" && m.from === this.partner) this.onMsg(m.d);
        else if (m.k === "msg" && !this.partner) { this.partner = m.from; this.onStatus("partner-join", m.from); this.onMsg(m.d); }
      } else this.onMsg(m);
    };
    ws.onclose = e => { if (this.ws !== ws) return; this.onStatus("closed", e.code);
      // the host keeps its room: try to come back (the relay gives it 20 s)
      if (this.role === "host" && !this.closed && e.code !== 4009) setTimeout(() => { if (!this.closed) this.open(`${RELAY}${this.code}?role=host&key=${this.key}`); }, 1500); };
    ws.onerror = () => {};
  }
  send(d){ if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify(this.role === "host" ? { d } : d)); }
  close(){ this.closed = true; try { this.ws && this.ws.close(1000, "bye"); } catch (e) {} this.ws = null; }
}
