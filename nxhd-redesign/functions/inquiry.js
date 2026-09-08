// ============================================================
//  Cloudflare Pages Function — 询盘转发到企业微信群机器人
//  路径: /inquiry  (POST)
// ============================================================

const WECOM_WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=7f4d0a40-7ea8-48ad-a6df-6c3f2c4a8352';

export async function onRequestPost(context) {
  const { request } = context;

  // 解析表单数据
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

  // 必填校验
  if (!data.name || !data.email || !data.message) {
    return json({ ok: false, error: 'Missing required fields (name / email / message)' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email))) {
    return json({ ok: false, error: 'Invalid email address' }, 400);
  }

  // 构造企业微信 Markdown 消息
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

  // 推送到企业微信
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

// GET 健康检查
export async function onRequestGet() {
  return new Response('NXHD inquiry endpoint is running.', { status: 200 });
}

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
