// ============================================================
//  Cloudflare Pages Functions
//   • /inquiry            — forwards form data to WeCom robot
//   • /api/auth           — initiates Decap CMS GitHub OAuth
//   • /api/callback       — handles GitHub OAuth return, posts token back
//   • everything else     — falls through to static asset server
// ============================================================

const WECOM_WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=7f4d0a40-7ea8-48ad-a6df-6c3f2c4a8352';
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1) Inquiry form
    if (url.pathname === '/inquiry') {
      if (request.method === 'GET') {
        return new Response('NXHD inquiry endpoint is running.', { status: 200 });
      }
      if (request.method === 'POST' || request.method === 'OPTIONS') {
        return handleInquiry(request);
      }
      return json({ ok: false, error: 'Method not allowed' }, 405);
    }

    // 2) Decap CMS OAuth proxy — initiate
    if (url.pathname === '/api/auth' && request.method === 'GET') {
      return handleOAuthStart(request, env);
    }

    // 3) Decap CMS OAuth proxy — callback
    if (url.pathname === '/api/callback' && request.method === 'GET') {
      return handleOAuthCallback(request, env);
    }

    // 4) Static assets
    return env.ASSETS.fetch(request);
  }
};

// ----------------------------------------------------------------
//  WeCom webhook — inquiry forwarding
// ----------------------------------------------------------------
async function handleInquiry(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  let data = {};
  try {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      data = await request.json();
    } else {
      const fd = await request.formData();
      data = Object.fromEntries(fd.entries());
    }
  } catch (e) {
    return json({ ok: false, error: 'Invalid payload' }, 400);
  }

  if (!data.name || !data.email || !data.message) {
    return json({ ok: false, error: 'Missing required fields (name / email / message)' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email))) {
    return json({ ok: false, error: 'Invalid email address' }, 400);
  }

  const md = [
    '📩 **New Inquiry — www.nxhdmfg.com**',
    '',
    '**Name:** ' + esc(data.name),
    '**Company:** ' + esc(data.company || '-'),
    '**Email:** ' + esc(data.email),
    '**Phone:** ' + esc(data.phone || '-'),
    '**Country:** ' + esc(data.country || '-'),
    '**Product:** ' + esc(data.product || '-'),
    '',
    '**Requirement:**',
    esc(data.message),
    '',
    '---',
    '**Page:** ' + esc(data._page || '-') + '   |   **Time:** ' + esc(new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })),
  ].join('\n');

  try {
    const resp = await fetch(WECOM_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content: md } }),
    });
    const text = await resp.text();
    if (resp.ok) {
      return json({ ok: true, status: 'sent' }, 200);
    }
    return json({ ok: false, error: 'WeCom error', detail: text.slice(0, 200) }, 502);
  } catch (e) {
    return json({ ok: false, error: 'WeCom request failed', detail: String(e).slice(0, 200) }, 502);
  }
}

// ----------------------------------------------------------------
//  Decap CMS / GitHub OAuth proxy
//  Required env vars (set in Cloudflare Pages → Settings → Variables):
//    GITHUB_CLIENT_ID      — public
//    GITHUB_CLIENT_SECRET  — secret
// ----------------------------------------------------------------
async function handleOAuthStart(request, env) {
  const CLIENT_ID = env.GITHUB_CLIENT_ID;
  if (!CLIENT_ID) {
    return new Response(
      'GITHUB_CLIENT_ID is not configured. Open Cloudflare Pages → Settings → Environment variables and add GITHUB_CLIENT_ID.',
      { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || cryptoRand();
  const redirectUri = `${url.origin}/api/callback`;
  const ghUrl = `${GITHUB_AUTHORIZE_URL}?client_id=${encodeURIComponent(CLIENT_ID)}` +
                `&redirect_uri=${encodeURIComponent(redirectUri)}` +
                `&scope=${encodeURIComponent('repo,user')}` +
                `&state=${encodeURIComponent(state)}` +
                `&allow_signup=false`;
  // Decap opens this URL in a popup — so respond with a tiny HTML page that redirects the popup
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Authorizing…</title></head>` +
    `<body><script>window.location.replace(${JSON.stringify(ghUrl)});</script></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

async function handleOAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const errorDesc = url.searchParams.get('error_description');

  if (error) {
    return popupPostMessage(`authorization:github:error:${JSON.stringify({ message: errorDesc || error })}`);
  }
  if (!code) {
    return new Response('Missing code parameter', { status: 400 });
  }

  const CLIENT_ID = env.GITHUB_CLIENT_ID;
  const CLIENT_SECRET = env.GITHUB_CLIENT_SECRET;
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return new Response(
      'OAuth credentials not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in Cloudflare Pages env vars.',
      { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  try {
    const tokenResp = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'nxhd-decap-oauth' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
        redirect_uri: `${url.origin}/api/callback`
      })
    });
    const tokenData = await tokenResp.json();
    if (tokenData.error) {
      return popupPostMessage(`authorization:github:error:${JSON.stringify({ message: tokenData.error_description || tokenData.error })}`);
    }
    const token = tokenData.access_token;
    if (!token) {
      return popupPostMessage(`authorization:github:error:${JSON.stringify({ message: 'No access_token in response' })}`);
    }
    return popupPostMessage(token, 'github');
  } catch (e) {
    return popupPostMessage(null, 'github', 'Token exchange failed: ' + String(e));
  }
}

function popupPostMessage(token, provider, error) {
  // Matches Decap CMS' GitHub OAuth contract:
  //   - Decap opens /api/auth in a popup
  //   - popup eventually POSTS this exact message via window.opener.postMessage()
  //   - message format: authorization:<provider>:(success|error):<JSON>
  // See: https://decapcms.org/docs/external-oauth-clients/
  //
  // Fallback: when the browser opens the auth window as a new tab without
  // window.opener (e.g. with noopener), store the token in localStorage and
  // redirect back to /admin/. The admin page listens for storage events and
  // dispatches the same message Decap is waiting for.
  const payload = error
    ? `authorization:${provider}:error:${JSON.stringify({ message: error })}`
    : `authorization:${provider}:success:${JSON.stringify({ token, provider })}`;
  const safePayload = JSON.stringify(payload);
  const safeToken = JSON.stringify(token || '');
  const safeProvider = JSON.stringify(provider);
  const safeError = JSON.stringify(error || '');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Authorizing…</title>
<style>body{font-family:system-ui;background:#0B1628;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:14px}h3{margin:0;font-size:18px;font-weight:600}p{opacity:.6;font-size:14px}</style></head>
<body>
<div style="text-align:center"><h3>NXHD content manager</h3><p id="status">Authorizing — you can close this window if it doesn't close automatically.</p></div>
<script>
(function () {
  try {
    var msg = ${safePayload};
    var token = ${safeToken};
    var provider = ${safeProvider};
    var error = ${safeError};
    if (error) {
      document.getElementById('status').textContent = 'Authorization failed: ' + error;
      return;
    }
    if (window.opener && window.opener !== window) {
      window.opener.postMessage(msg, '*');
      // Belt-and-suspenders: also persist the token in localStorage so the
      // admin page can pick it up via a `storage` event and replay the same
      // message Decap is waiting for. This handles cases where the browser
      // strips window.opener references or Decap's listener isn't ready in time.
      try {
        localStorage.setItem('decap-cms-oauth-token', token);
        localStorage.setItem('decap-cms-oauth-provider', provider);
      } catch (e) {}
      document.getElementById('status').textContent = 'Authorized — closing window…';
      setTimeout(function(){ window.close(); }, 800);
    } else {
      // No opener: browser opened auth as a new tab. Use localStorage fallback.
      try {
        localStorage.setItem('decap-cms-oauth-token', token);
        localStorage.setItem('decap-cms-oauth-provider', provider);
      } catch (e) {}
      document.getElementById('status').textContent = 'Redirecting back to admin…';
      window.location.replace('/admin/#oauth-callback');
    }
  } catch (e) {
    document.body.innerHTML = '<pre style="color:#f55">OAuth callback error: ' + (e && e.message) + '</pre>';
  }
})();
</script>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

function cryptoRand() {
  // 16-byte hex; works in Workers runtime which has crypto.getRandomValues
  const a = new Uint8Array(16);
  (globalThis.crypto || crypto).getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

// ----------------------------------------------------------------
//  Helpers
// ----------------------------------------------------------------
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
