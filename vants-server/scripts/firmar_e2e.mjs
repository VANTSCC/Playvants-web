/* VANTS · firmar_e2e.mjs — cliente firmado HMAC para probar el motor de
   logros en local (mismo contrato X-VANTS-TS/X-VANTS-Signature que VANTS-BUS).
   Uso: node firmar_e2e.mjs <secreto> <host> <tipo> <event_id> <json_payload>
   Acciones extra: --pump  → POST /api/achievements/pump firmado */
const [secreto, host, tipo, eventId, payloadJson] = process.argv.slice(2);
const pump = process.argv.includes("--pump");

const ENC = new TextEncoder();
async function firma(mensaje) {
  const clave = await crypto.subtle.importKey("raw", ENC.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", clave, ENC.encode(mensaje));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ts = String(Math.floor(Date.now() / 1000));
let ruta, cuerpo;
if (pump) {
  ruta = "/api/achievements/pump";
  cuerpo = JSON.stringify({ ts });
} else {
  ruta = "/api/achievements/ingest";
  cuerpo = JSON.stringify({ type: tipo, event_id: eventId, payload: JSON.parse(payloadJson || "{}") });
}
const sig = await firma(ts + "." + cuerpo);
const r = await fetch(host + ruta, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-VANTS-TS": ts, "X-VANTS-Signature": sig },
  body: cuerpo,
});
console.log(r.status, await r.text());
