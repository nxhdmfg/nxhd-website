/* =========================================================================
 *  Ningxin Huida — form.js
 *  Functions:
 *   1. Inline validation (real-time, friendly messages)
 *   2. AJAX submit to Formspree (replace FORMSPREE_ENDPOINT below)
 *   3. Success toast + form reset
 *   4. Phone auto-format (loose)
 * ========================================================================= */

(function () {
  'use strict';

  // ============ CONFIG ============
  // 询盘转发到企业微信群机器人（Cloudflare Pages Function /inquiry）
  const FORMSPREE_ENDPOINT = '/inquiry';

  // ============ TOAST (success / error) ============
  function ensureToast() {
    let t = document.getElementById('nxhd-toast');
    if (t) return t;
    t = document.createElement('div');
    t.id = 'nxhd-toast';
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    t.style.cssText = [
      'position:fixed', 'top:24px', 'right:24px', 'z-index:9999',
      'max-width:380px', 'padding:16px 20px',
      'background:#0A2A5E', 'color:#fff', 'border-radius:12px',
      'box-shadow:0 20px 50px rgba(0,0,0,.35)',
      'border:1px solid rgba(0,194,255,.35)',
      'font-size:14px', 'line-height:1.5',
      'display:flex', 'align-items:flex-start', 'gap:10px',
      'opacity:0', 'transform:translateY(-12px)', 'pointer-events:none',
      'transition:opacity .3s ease, transform .3s ease'
    ].join(';');
    document.body.appendChild(t);
    return t;
  }

  function showToast(message, kind) {
    const t = ensureToast();
    const color = kind === 'error' ? '#FF6B6B' : (kind === 'warn' ? '#FFB547' : '#00C2FF');
    const icon  = kind === 'error' ? '!' : (kind === 'warn' ? '!' : '\u2713');
    t.innerHTML =
      '<span style="display:inline-grid;place-items:center;width:22px;height:22px;' +
      'border-radius:50%;background:' + color + ';color:#00163A;font-weight:800;' +
      'font-size:13px;flex:0 0 22px">' + icon + '</span>' +
      '<span style="flex:1">' + message + '</span>';
    requestAnimationFrame(function () {
      t.style.opacity = '1';
      t.style.transform = 'translateY(0)';
      t.style.pointerEvents = 'auto';
    });
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(function () {
      t.style.opacity = '0';
      t.style.transform = 'translateY(-12px)';
      t.style.pointerEvents = 'none';
    }, 5000);
  }

  // ============ INLINE ERROR (under each field) ============
  function setError(input, msg) {
    let err = input.parentNode.querySelector('.nxhd-err');
    if (!err) {
      err = document.createElement('div');
      err.className = 'nxhd-err';
      err.style.cssText = 'color:#FF7A7A;font-size:12px;margin-top:4px;line-height:1.4';
      input.parentNode.appendChild(err);
    }
    err.textContent = msg;
    input.style.borderColor = msg ? '#FF7A7A' : '';
  }

  function clearAllErrors(form) {
    form.querySelectorAll('.nxhd-err').forEach(function (e) { e.remove(); });
    form.querySelectorAll('input, textarea, select').forEach(function (el) {
      el.style.borderColor = '';
    });
  }

  // ============ VALIDATION ============
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // Country whitelist — top 60 import markets for fasteners (extend as needed)
  const COMMON_COUNTRIES = new Set([
    'united states','usa','u.s.a.','canada','mexico','brazil','argentina','chile',
    'united kingdom','uk','england','germany','france','italy','spain','netherlands',
    'belgium','poland','sweden','norway','finland','denmark','switzerland','austria',
    'ireland','portugal','czech republic','romania','hungary','greece','turkey',
    'russia','ukraine','kazakhstan','uzbekistan',
    'united arab emirates','uae','saudi arabia','qatar','kuwait','egypt','israel',
    'india','pakistan','bangladesh','sri lanka','indonesia','vietnam','thailand',
    'malaysia','philippines','singapore','japan','south korea','korea',
    'australia','new zealand','south africa','nigeria','kenya','ethiopia'
  ]);

  function validate(form) {
    let ok = true;
    const inputs = form.querySelectorAll('input, textarea, select');
    inputs.forEach(function (el) { setError(el, ''); });

    inputs.forEach(function (el) {
      const v = (el.value || '').trim();
      const required = el.hasAttribute('required');
      const type = (el.type || '').toLowerCase();
      const name = (el.name || el.id || '').toLowerCase();

      if (required && !v) {
        setError(el, 'This field is required.');
        ok = false; return;
      }
      if (type === 'email' && v && !EMAIL_RE.test(v)) {
        setError(el, 'Please enter a valid email (e.g. you@company.com).');
        ok = false; return;
      }
      // Soft check: country looks plausible
      if (name === 'country' && v) {
        const norm = v.toLowerCase().trim();
        // Allow any country, but warn if it contains numbers or single chars
        if (norm.length < 2 || /\d/.test(norm)) {
          setError(el, 'Please enter a valid country name.');
          ok = false; return;
        }
      }
      // Message min length
      if ((el.tagName === 'TEXTAREA') && v && v.length < 10 && required) {
        setError(el, 'Please describe your requirement in at least 10 characters.');
        ok = false;
      }
    });
    return ok;
  }

  // ============ SUBMIT ============
  async function handleSubmit(ev) {
    ev.preventDefault();
    const form = ev.currentTarget;
    if (!validate(form)) {
      showToast('Please fix the highlighted fields and try again.', 'warn');
      // Focus the first invalid field
      const firstErr = form.querySelector('input[style*="FF7A7A"], textarea[style*="FF7A7A"]');
      if (firstErr) firstErr.focus();
      return false;
    }

    const btn = form.querySelector('button[type="submit"]');
    const originalText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Sending...';
      btn.style.opacity = '0.7';
    }

    // Collect FormData
    const data = new FormData(form);
    // Add page context for easier triage in your inbox
    data.append('_subject', '[NXHD Inquiry] from ' + (document.title || 'website'));
    data.append('_page', location.pathname);
    data.append('_referrer', document.referrer || 'direct');
    data.append('_submitted_at', new Date().toISOString());

    // If the endpoint is not yet configured, fall back to a local simulated success
    if (FORMSPREE_ENDPOINT.indexOf('REPLACE_ME') !== -1) {
      console.warn('[NXHD form] Formspree endpoint not configured. Simulating success.');
      console.log('[NXHD form] Payload preview:', Object.fromEntries(data.entries()));
      await new Promise(function (r) { setTimeout(r, 600); });
      form.reset();
      clearAllErrors(form);
      showToast('\u2709 Thank you! Your inquiry has been received \u2014 we will reply within 24 hours.', 'ok');
      if (btn) { btn.disabled = false; btn.textContent = originalText; btn.style.opacity = ''; }
      return false;
    }

    try {
      const res = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        body: data,
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        form.reset();
        clearAllErrors(form);
        showToast('\u2709 Thank you! Your inquiry has been received \u2014 we will reply within 24 hours.', 'ok');
        // GA4 conversion event — track successful inquiry submissions
        if (typeof gtag === 'function') {
          gtag('event', 'generate_lead', {
            event_category: 'inquiry',
            page: location.pathname
          });
        }
      } else {
        const body = await res.json().catch(function () { return {}; });
        const detail = (body && body.errors) ? body.errors.map(function(e){return e.message;}).join('; ') : '';
        showToast('Submission failed. ' + (detail || 'Please email contact@nxhdmfg.com directly.'), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Network error. Please email contact@nxhdmfg.com directly.', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; btn.style.opacity = ''; }
    }
    return false;
  }

  // ============ BIND ============
  function bind() {
    document.querySelectorAll('form').forEach(function (form) {
      // Skip if already bound
      if (form.dataset.nxhdBound === '1') return;
      form.dataset.nxhdBound = '1';
      form.setAttribute('novalidate', 'novalidate'); // we do our own validation
      form.addEventListener('submit', handleSubmit);
      // Real-time: clear error on input
      form.addEventListener('input', function (e) {
        if (e.target.matches('input, textarea, select')) {
          setError(e.target, '');
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
