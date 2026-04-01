import React, { useState, useEffect, useRef, useCallback } from 'react'
import ReactDOM from 'react-dom/client'

// ─── API CLIENT ──────────────────────────────────────────────────────────────

const API = {
  _token: () => localStorage.getItem('dhithra_token'),
  _headers: () => ({
    'Content-Type': 'application/json',
    ...(API._token() ? { Authorization: `Bearer ${API._token()}` } : {}),
  }),
  _req: async (path, opts = {}) => {
    const r = await fetch(path, { headers: API._headers(), ...opts })
    if (!r.ok) {
      const e = await r.json().catch(() => ({ detail: 'Request failed' }))
      throw new Error(e.detail || 'Request failed')
    }
    return r.json()
  },
  login:      (name, email) => API._req('/api/auth/login', { method: 'POST', body: JSON.stringify({ name, email }) }),
  me:         ()             => API._req('/api/auth/me'),
  docs:       ()             => API._req('/api/documents'),
  getDoc:     (id)           => API._req(`/api/documents/${id}`),
  createDoc:  (title)        => API._req('/api/documents', { method: 'POST', body: JSON.stringify({ title }) }),
  updateDoc:  (id, d)        => API._req(`/api/documents/${id}`, { method: 'PATCH', body: JSON.stringify(d) }),
  deleteDoc:  (id)           => API._req(`/api/documents/${id}`, { method: 'DELETE' }),
  addBlock:   (docId, d)     => API._req(`/api/documents/${docId}/blocks`, { method: 'POST', body: JSON.stringify(d) }),
  updateBlock:(id, d)        => API._req(`/api/blocks/${id}`, { method: 'PATCH', body: JSON.stringify(d) }),
  deleteBlock:(id)           => API._req(`/api/blocks/${id}`, { method: 'DELETE' }),
  runAgent:   (d)            => API._req('/api/agents/run', { method: 'POST', body: JSON.stringify(d) }),
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const BLOCK_META = {
  abstract:         { label: 'Abstract',          color: '#7c3aed' },
  introduction:     { label: 'Introduction',       color: '#2563eb' },
  literature_review:{ label: 'Literature Review',  color: '#6d28d9' },
  methodology:      { label: 'Methodology',        color: '#059669' },
  results:          { label: 'Results',            color: '#d97706' },
  discussion:       { label: 'Discussion',         color: '#dc2626' },
  conclusion:       { label: 'Conclusion',         color: '#7c3aed' },
  references:       { label: 'References',         color: '#475569' },
  custom:           { label: 'Section',            color: '#64748b' },
}

const AGENTS = [
  { id: 'generate',  icon: '✦', label: 'Generate',  ph: 'Describe your research topic...' },
  { id: 'think',     icon: '◉', label: 'Think',     ph: 'Paste content to analyze...' },
  { id: 'structure', icon: '⊞', label: 'Structure', ph: 'Paste raw content to organize...' },
  { id: 'research',  icon: '⌕', label: 'Research',  ph: 'Enter a topic or concept to research...' },
]

// ─── STYLES ──────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;1,500&family=Lato:wght@300;400;700&display=swap');

  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html,body,#root{height:100%}
  body{font-family:'Lato',sans-serif;background:#f0eeea;color:#1a1917;-webkit-font-smoothing:antialiased}
  button{cursor:pointer;border:none;background:none;font-family:inherit}
  textarea,input{font-family:inherit}
  ::-webkit-scrollbar{width:5px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:#d4cfc8;border-radius:3px}

  /* LOGIN */
  .login{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#12100e;position:relative;overflow:hidden}
  .login-noise{position:absolute;inset:0;opacity:.04;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");background-size:256px}
  .login-lines{position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 79px,rgba(255,255,255,.03) 80px),repeating-linear-gradient(90deg,transparent,transparent 79px,rgba(255,255,255,.03) 80px)}
  .login-glow{position:absolute;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(139,90,43,.15),transparent 70%);top:-100px;left:-100px;pointer-events:none}
  .login-glow2{position:absolute;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(45,55,120,.12),transparent 70%);bottom:-100px;right:-50px;pointer-events:none}
  .login-box{position:relative;z-index:1;width:100%;max-width:420px;padding:20px}
  .login-header{margin-bottom:40px;text-align:center}
  .login-mark{display:inline-flex;align-items:center;gap:10px;margin-bottom:16px}
  .login-mark svg{flex-shrink:0}
  .login-wordmark{font-family:'Playfair Display',serif;font-size:28px;color:#f5f0e8;letter-spacing:-.5px}
  .login-tagline{font-size:12px;color:#6b6560;text-transform:uppercase;letter-spacing:.12em}
  .login-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:36px;backdrop-filter:blur(20px)}
  .login-title{font-family:'Playfair Display',serif;font-size:22px;color:#f5f0e8;margin-bottom:6px}
  .login-sub{font-size:13px;color:#6b6560;margin-bottom:28px}
  .login-err{background:rgba(220,38,38,.12);border:1px solid rgba(220,38,38,.25);color:#fca5a5;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:16px}
  .fgrp{margin-bottom:16px}
  .flabel{display:block;font-size:11px;font-weight:700;color:#7a7570;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px}
  .finput{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:11px 14px;color:#f5f0e8;font-size:15px;outline:none;transition:border-color .15s}
  .finput::placeholder{color:#4a4540}
  .finput:focus{border-color:rgba(139,90,43,.6);background:rgba(139,90,43,.08)}
  .login-btn{width:100%;background:#8b5a2b;color:#fdf8f0;padding:13px;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:.02em;margin-top:8px;transition:background .15s,transform .1s}
  .login-btn:hover:not(:disabled){background:#a06832;transform:translateY(-1px)}
  .login-btn:disabled{opacity:.5;cursor:not-allowed}
  .login-note{font-size:12px;color:#4a4540;text-align:center;margin-top:14px}
  .login-badges{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:24px}
  .login-badge{font-size:11px;padding:4px 12px;border-radius:20px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);color:#7a7570}

  /* WORKSPACE */
  .ws{display:flex;height:100vh;overflow:hidden}

  /* SIDEBAR */
  .sidebar{width:256px;min-width:256px;background:#1a1917;display:flex;flex-direction:column;transition:width .2s,min-width .2s;overflow:hidden}
  .sidebar.collapsed{width:0;min-width:0}
  .sb-inner{width:256px;height:100%;display:flex;flex-direction:column}
  .sb-head{padding:16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.06)}
  .sb-brand{display:flex;align-items:center;gap:8px;font-family:'Playfair Display',serif;font-size:17px;color:#f5f0e8}
  .sb-new{color:#6b6560;padding:6px;border-radius:6px;transition:background .1s,color .1s;font-size:18px;line-height:1}
  .sb-new:hover{background:rgba(255,255,255,.07);color:#f5f0e8}
  .sb-lbl{padding:12px 16px 4px;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#4a4540;font-weight:700}
  .sb-docs{flex:1;overflow-y:auto;padding:4px 8px}
  .sb-empty{padding:16px;font-size:13px;color:#4a4540;text-align:center}
  .sb-doc{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;transition:background .1s;margin-bottom:2px;group:true}
  .sb-doc:hover{background:rgba(255,255,255,.06)}
  .sb-doc.active{background:rgba(139,90,43,.18)}
  .sb-doc-icon{color:#4a4540;flex-shrink:0;font-size:13px}
  .sb-doc.active .sb-doc-icon{color:#c4965a}
  .sb-doc-info{flex:1;min-width:0}
  .sb-doc-title{font-size:13px;color:#a09890;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:400}
  .sb-doc.active .sb-doc-title{color:#e8d5b8}
  .sb-doc-meta{font-size:11px;color:#4a4540;margin-top:1px}
  .sb-del{color:#3a3530;font-size:16px;padding:2px 6px;border-radius:4px;opacity:0;transition:opacity .1s,color .1s}
  .sb-doc:hover .sb-del{opacity:1}
  .sb-del:hover{color:#ef4444}
  .sb-foot{border-top:1px solid rgba(255,255,255,.06);padding:12px}
  .sb-user{display:flex;align-items:center;gap:10px}
  .sb-av{width:30px;height:30px;background:#8b5a2b;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fdf8f0;flex-shrink:0}
  .sb-uinfo{flex:1;min-width:0}
  .sb-uname{font-size:13px;color:#a09890}
  .sb-uemail{font-size:11px;color:#4a4540;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sb-logout{color:#4a4540;padding:4px;border-radius:4px;font-size:13px}
  .sb-logout:hover{color:#ef4444}

  /* MAIN */
  .ws-main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}

  /* TOPBAR */
  .topbar{background:#fff;border-bottom:1px solid #e8e4de;padding:12px 20px;display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;box-shadow:0 1px 4px rgba(0,0,0,.06)}
  .tb-left{display:flex;align-items:center;gap:10px}
  .tb-right{display:flex;align-items:center;gap:8px;margin-left:auto}
  .tb-icon{color:#8a847c;padding:7px;border-radius:7px;transition:background .1s,color .1s;display:flex;align-items:center;gap:6px;font-size:13px;font-weight:400}
  .tb-icon:hover,.tb-icon.on{background:#f0eeea;color:#8b5a2b}
  .doc-title{font-family:'Playfair Display',serif;font-size:18px;color:#1a1917;cursor:text;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px}
  .doc-title-edit{font-family:'Playfair Display',serif;font-size:18px;border:1px solid #8b5a2b;border-radius:6px;padding:2px 8px;outline:none;color:#1a1917;max-width:260px}
  .tb-center{flex:1;display:flex;flex-direction:column;gap:8px}
  .agent-tabs{display:flex;gap:4px}
  .agent-tab{display:flex;align-items:center;gap:5px;padding:5px 12px;border-radius:6px;font-size:13px;color:#8a847c;transition:background .1s,color .1s;font-weight:400}
  .agent-tab:hover{background:#f0eeea}
  .agent-tab.on{background:#fdf5eb;color:#8b5a2b;border:1px solid rgba(139,90,43,.2)}
  .prompt-row{display:flex;gap:8px}
  .prompt-in{flex:1;border:1.5px solid #e0dbd3;border-radius:8px;padding:9px 14px;font-size:14px;color:#1a1917;outline:none;background:#fafaf8;transition:border-color .15s}
  .prompt-in:focus{border-color:#8b5a2b;background:#fff}
  .prompt-in::placeholder{color:#b0a898}
  .run-btn{background:#8b5a2b;color:#fdf8f0;padding:9px 18px;border-radius:8px;font-size:14px;font-weight:700;white-space:nowrap;transition:background .15s;display:flex;align-items:center;gap:6px}
  .run-btn:hover:not(:disabled){background:#a06832}
  .run-btn:disabled{opacity:.45;cursor:not-allowed}

  /* AGENT BANNER */
  .agent-banner{background:linear-gradient(90deg,#8b5a2b,#a06832);color:#fdf8f0;padding:9px 20px;display:flex;align-items:center;gap:10px;font-size:13px;font-weight:400;letter-spacing:.01em}

  /* CONTENT */
  .ws-content{flex:1;overflow-y:auto;padding:32px 20px;background:#f0eeea}
  .ws-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;height:300px;color:#8a847c;font-size:14px}
  .empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;height:400px;text-align:center;max-width:380px;margin:0 auto}
  .empty h2{font-family:'Playfair Display',serif;font-size:22px;color:#3a3530}
  .empty p{font-size:14px;color:#8a847c;line-height:1.6}
  .empty-btn{background:#8b5a2b;color:#fdf8f0;padding:11px 22px;border-radius:8px;font-size:14px;font-weight:700}
  .empty-btn:hover{background:#a06832}

  /* BLOCK EDITOR */
  .be{max-width:800px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
  .bc{background:#fff;border:1.5px solid #e8e4de;border-radius:10px;padding:18px 20px;transition:border-color .15s,box-shadow .15s;box-shadow:0 1px 3px rgba(0,0,0,.05)}
  .bc:hover{box-shadow:0 3px 12px rgba(0,0,0,.08)}
  .bc.focused{border-color:#c4965a;box-shadow:0 0 0 3px rgba(139,90,43,.08),0 3px 12px rgba(0,0,0,.08)}
  .bc-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
  .bc-pill{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:4px 10px;border-radius:20px}
  .bc-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
  .bc-acts{display:flex;align-items:center;gap:4px}
  .bc-act{font-size:12px;padding:4px 10px;border-radius:6px;color:#8a847c;background:#f0eeea;font-weight:400;transition:background .1s,color .1s;white-space:nowrap}
  .bc-act:hover{background:#fdf5eb;color:#8b5a2b}
  .bc-act.del:hover{background:#fef2f2;color:#ef4444}
  .ai-panel{display:flex;align-items:center;gap:8px;background:#fdf5eb;border-radius:8px;padding:10px 12px;margin-bottom:12px;border:1px solid rgba(139,90,43,.15)}
  .ai-in{flex:1;background:#fff;border:1.5px solid #e0dbd3;border-radius:6px;padding:7px 12px;font-size:13px;outline:none;color:#1a1917}
  .ai-in:focus{border-color:#c4965a}
  .ai-run{background:#8b5a2b;color:#fdf8f0;padding:7px 14px;border-radius:6px;font-size:13px;font-weight:700;display:flex;align-items:center;gap:6px;white-space:nowrap}
  .ai-run:hover:not(:disabled){background:#a06832}
  .ai-run:disabled{opacity:.5}
  .ai-cancel{font-size:13px;color:#8a847c;padding:7px 10px;border-radius:6px}
  .ai-cancel:hover{background:#f0eeea}
  .bc-txt{width:100%;border:none;outline:none;resize:vertical;font-size:15px;line-height:1.75;color:#1a1917;background:transparent;min-height:90px}
  .bc-txt::placeholder{color:#c4bdb5}
  .add-bc{display:flex;align-items:center;justify-content:center;gap:8px;color:#b0a898;font-size:13px;padding:12px;border-radius:8px;border:1.5px dashed #ddd8d0;width:100%;margin-top:4px;transition:all .15s}
  .add-bc:hover{border-color:#c4965a;color:#8b5a2b;background:#fdf5eb}

  /* RESEARCH PANEL */
  .rp{width:320px;min-width:320px;background:#fff;border-left:1px solid #e8e4de;overflow-y:auto;display:flex;flex-direction:column}
  .rp-head{padding:18px;border-bottom:1px solid #e8e4de;display:flex;align-items:center;justify-content:space-between}
  .rp-title{font-family:'Playfair Display',serif;font-size:16px;color:#1a1917}
  .rp-close{color:#b0a898;font-size:20px;padding:4px 8px;border-radius:6px;line-height:1}
  .rp-close:hover{background:#f0eeea;color:#8a847c}
  .rp-body{padding:16px;flex:1;display:flex;flex-direction:column;gap:12px}
  .rp-textarea{width:100%;border:1.5px solid #e0dbd3;border-radius:8px;padding:10px 14px;font-size:14px;resize:vertical;outline:none;color:#1a1917;line-height:1.5;background:#fafaf8}
  .rp-textarea:focus{border-color:#c4965a}
  .rp-btn{width:100%;background:#8b5a2b;color:#fdf8f0;padding:10px;border-radius:8px;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px}
  .rp-btn:hover:not(:disabled){background:#a06832}
  .rp-btn:disabled{opacity:.5;cursor:not-allowed}
  .rp-tabs{display:flex;border-bottom:1.5px solid #e8e4de}
  .rp-tab{flex:1;padding:8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#b0a898;border-bottom:2px solid transparent;margin-bottom:-1.5px;transition:color .1s,border-color .1s}
  .rp-tab.on{color:#8b5a2b;border-bottom-color:#8b5a2b}
  .rp-section{font-size:14px}
  .rp-context{color:#3a3530;line-height:1.7;margin-bottom:14px}
  .rp-h4{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8a847c;margin-bottom:8px;margin-top:14px}
  .rp-section ul{padding-left:18px;color:#5a5550}
  .rp-section li{margin-bottom:5px;line-height:1.5}
  .tags{display:flex;flex-wrap:wrap;gap:6px}
  .tag{background:#f0eeea;color:#5a5550;font-size:12px;padding:4px 10px;border-radius:20px;border:1px solid #e0dbd3}
  .tag.q{background:#fdf5eb;color:#8b5a2b;border-color:rgba(139,90,43,.2)}
  .cit-card{background:#f0eeea;border-radius:8px;padding:12px;margin-bottom:10px}
  .cit-apa{font-size:13px;line-height:1.6;color:#3a3530;font-style:italic}
  .cit-meta{font-size:11px;color:#8a847c;margin-top:6px;display:flex;gap:6px}
  .rp-ph{text-align:center;padding:40px 20px;color:#b0a898}
  .rp-ph-icon{font-size:32px;margin-bottom:12px}
  .rp-ph p{font-size:13px;line-height:1.6}

  /* SPINNER */
  .spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:sp .6s linear infinite}
  .spin.dark{border-color:rgba(139,90,43,.2);border-top-color:#8b5a2b}
  .spin.lg{width:32px;height:32px;border-width:3px}
  @keyframes sp{to{transform:rotate(360deg)}}

  /* TOAST */
  .toast-wrap{position:fixed;bottom:20px;right:20px;z-index:999;display:flex;flex-direction:column;gap:8px}
  .toast{background:#1a1917;color:#f5f0e8;padding:10px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.3);animation:tin .2s ease;max-width:300px}
  .toast.err{background:#7f1d1d;color:#fecaca}
  @keyframes tin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
`

// ─── TOAST ────────────────────────────────────────────────────────────────────

function Toast({ toasts }) {
  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast${t.err ? ' err' : ''}`}>{t.msg}</div>
      ))}
    </div>
  )
}

function useToasts() {
  const [toasts, setToasts] = useState([])
  const add = useCallback((msg, err = false) => {
    const id = Date.now()
    setToasts(ts => [...ts, { id, msg, err }])
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 3500)
  }, [])
  return { toasts, toast: add }
}

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────

function LoginPage({ onLogin }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!name.trim() || !email.trim()) return setErr('Name and email are required')
    setLoading(true); setErr('')
    try {
      const data = await API.login(name.trim(), email.trim())
      localStorage.setItem('dhithra_token', data.access_token)
      onLogin(data.user)
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login">
      <div className="login-noise" />
      <div className="login-lines" />
      <div className="login-glow" />
      <div className="login-glow2" />
      <div className="login-box">
        <div className="login-header">
          <div className="login-mark">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="#8b5a2b"/>
              <path d="M7 25L16 7L25 25M10 19H22" stroke="#fdf8f0" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            <span className="login-wordmark">Dhithra</span>
          </div>
          <div className="login-tagline">AI Research Intelligence</div>
        </div>
        <div className="login-card">
          <div className="login-title">Begin your research</div>
          <div className="login-sub">Enter your details to access the workspace</div>
          {err && <div className="login-err">{err}</div>}
          <form onSubmit={submit}>
            <div className="fgrp">
              <label className="flabel">Full Name</label>
              <input className="finput" type="text" placeholder="Dr. Ada Lovelace"
                value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="fgrp">
              <label className="flabel">Email Address</label>
              <input className="finput" type="email" placeholder="ada@university.edu"
                value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <button className="login-btn" type="submit" disabled={loading}>
              {loading ? <><span className="spin" />&nbsp;Entering...</> : 'Enter Workspace →'}
            </button>
          </form>
          <div className="login-note">No password required · Account auto-created</div>
        </div>
        <div className="login-badges">
          {['6 AI Agents', 'Free OpenRouter API', 'APA Citations', 'Block Editor'].map(b => (
            <span key={b} className="login-badge">{b}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────

function Sidebar({ docs, activeId, onNew, onDelete, onSelect, user, onLogout, collapsed }) {
  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sb-inner">
        <div className="sb-head">
          <div className="sb-brand">
            <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="#8b5a2b"/>
              <path d="M7 25L16 7L25 25M10 19H22" stroke="#fdf8f0" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            Dhithra
          </div>
          <button className="sb-new" onClick={onNew} title="New document">+</button>
        </div>
        <div className="sb-lbl">Documents</div>
        <div className="sb-docs">
          {docs.length === 0
            ? <div className="sb-empty">No documents yet</div>
            : docs.map(doc => (
              <div key={doc.id}
                className={`sb-doc${doc.id === activeId ? ' active' : ''}`}
                onClick={() => onSelect(doc.id)}>
                <span className="sb-doc-icon">◻</span>
                <div className="sb-doc-info">
                  <div className="sb-doc-title">{doc.title || 'Untitled'}</div>
                  <div className="sb-doc-meta">{doc.block_count} blocks · {doc.status}</div>
                </div>
                <button className="sb-del"
                  onClick={e => { e.stopPropagation(); onDelete(doc.id) }}>×</button>
              </div>
            ))}
        </div>
        <div className="sb-foot">
          <div className="sb-user">
            <div className="sb-av">{user?.name?.[0]?.toUpperCase() || '?'}</div>
            <div className="sb-uinfo">
              <div className="sb-uname">{user?.name}</div>
              <div className="sb-uemail">{user?.email}</div>
            </div>
            <button className="sb-logout" onClick={onLogout} title="Sign out">⎋</button>
          </div>
        </div>
      </div>
    </aside>
  )
}

// ─── TOP BAR ──────────────────────────────────────────────────────────────────

function TopBar({ doc, sidebarOpen, onToggleSidebar, researchOpen, onToggleResearch, onAgentRun, agentRunning }) {
  const [agent, setAgent] = useState('generate')
  const [prompt, setPrompt] = useState('')
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')

  useEffect(() => {
    if (doc) setTitle(doc.title)
  }, [doc?.title])

  async function saveTitle() {
    setEditing(false)
    if (doc && title !== doc.title) {
      try { await API.updateDoc(doc.id, { title }) } catch {}
    }
  }

  function run() {
    if (!prompt.trim() || !doc) return
    onAgentRun(agent, prompt)
    setPrompt('')
  }

  const ph = AGENTS.find(a => a.id === agent)?.ph || 'Enter prompt...'

  return (
    <div className="topbar">
      <div className="tb-left">
        <button className="tb-icon" onClick={onToggleSidebar}>☰</button>
        {doc && (editing
          ? <input className="doc-title-edit" value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => e.key === 'Enter' && saveTitle()}
              autoFocus />
          : <span className="doc-title" onClick={() => setEditing(true)}>{doc.title || 'Untitled'}</span>
        )}
      </div>
      <div className="tb-center">
        <div className="agent-tabs">
          {AGENTS.map(a => (
            <button key={a.id}
              className={`agent-tab${agent === a.id ? ' on' : ''}`}
              onClick={() => setAgent(a.id)}>
              <span>{a.icon}</span> {a.label}
            </button>
          ))}
        </div>
        <div className="prompt-row">
          <input className="prompt-in" placeholder={ph}
            value={prompt} onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && run()} />
          <button className="run-btn" onClick={run}
            disabled={!prompt.trim() || !doc || agentRunning}>
            {agentRunning ? <><span className="spin" /> Running</> : `${AGENTS.find(a=>a.id===agent)?.icon} Run`}
          </button>
        </div>
      </div>
      <div className="tb-right">
        <button className={`tb-icon${researchOpen ? ' on' : ''}`} onClick={onToggleResearch}>
          ⌕ Research
        </button>
      </div>
    </div>
  )
}

// ─── BLOCK CARD ───────────────────────────────────────────────────────────────

function BlockCard({ block, docId, onUpdate, onDelete, onReload, toast }) {
  const [content, setContent] = useState(block.content)
  const [focused, setFocused] = useState(false)
  const [hover, setHover] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [citeOpen, setCiteOpen] = useState(false)
  const [aiInstr, setAiInstr] = useState('')
  const [citeSrc, setCiteSrc] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const timer = useRef(null)

  useEffect(() => { setContent(block.content) }, [block.content])

  function handleChange(val) {
    setContent(val)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      API.updateBlock(block.id, { content: val }).then(() => onUpdate(block.id, val)).catch(() => {})
    }, 800)
  }

  async function runAI() {
    if (!aiInstr.trim()) return
    setAiLoading(true)
    try {
      const res = await API.runAgent({ agent: 'reason', prompt: aiInstr, document_id: docId, block_id: block.id })
      const newContent = res.result?.content || content
      setContent(newContent)
      onUpdate(block.id, newContent)
      setAiOpen(false); setAiInstr('')
      toast('Block updated by AI')
    } catch (e) { toast(e.message, true) }
    finally { setAiLoading(false) }
  }

  async function runCite() {
    if (!citeSrc.trim()) return
    setAiLoading(true)
    try {
      await API.runAgent({ agent: 'cite', prompt: citeSrc, document_id: docId })
      setCiteOpen(false); setCiteSrc('')
      onReload()
      toast('Citation added to References')
    } catch (e) { toast(e.message, true) }
    finally { setAiLoading(false) }
  }

  async function del() {
    if (!confirm('Delete this block?')) return
    try { await API.deleteBlock(block.id); onDelete(block.id) } catch {}
  }

  const meta = BLOCK_META[block.type] || BLOCK_META.custom
  const bgColor = meta.color + '14'

  return (
    <div className={`bc${focused ? ' focused' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      <div className="bc-head">
        <div className="bc-pill" style={{ background: bgColor, color: meta.color }}>
          <span className="bc-dot" style={{ background: meta.color }} />
          {meta.label}
        </div>
        {hover && (
          <div className="bc-acts">
            <button className="bc-act" onClick={() => { setAiOpen(s => !s); setCiteOpen(false) }}>✦ Edit with AI</button>
            <button className="bc-act" onClick={() => { setCiteOpen(s => !s); setAiOpen(false) }}>❝ Cite</button>
            <button className="bc-act del" onClick={del}>×</button>
          </div>
        )}
      </div>
      {aiOpen && (
        <div className="ai-panel">
          <input className="ai-in" placeholder="expand, formalize, shorten, improve flow..."
            value={aiInstr} onChange={e => setAiInstr(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runAI()} autoFocus />
          <button className="ai-run" onClick={runAI} disabled={aiLoading}>
            {aiLoading ? <span className="spin" /> : '✦ Apply'}
          </button>
          <button className="ai-cancel" onClick={() => setAiOpen(false)}>Cancel</button>
        </div>
      )}
      {citeOpen && (
        <div className="ai-panel">
          <input className="ai-in" placeholder="URL, DOI, or citation metadata..."
            value={citeSrc} onChange={e => setCiteSrc(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runCite()} autoFocus />
          <button className="ai-run" onClick={runCite} disabled={aiLoading}>
            {aiLoading ? <span className="spin" /> : '❝ Generate'}
          </button>
          <button className="ai-cancel" onClick={() => setCiteOpen(false)}>Cancel</button>
        </div>
      )}
      <textarea className="bc-txt"
        value={content}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={`Write ${meta.label.toLowerCase()} here...`}
        rows={block.type === 'references' ? 6 : 4}
      />
    </div>
  )
}

// ─── BLOCK EDITOR ─────────────────────────────────────────────────────────────

function BlockEditor({ doc, onReload, toast }) {
  const [blocks, setBlocks] = useState(doc?.blocks || [])

  useEffect(() => {
    setBlocks(doc?.blocks || [])
  }, [doc?.id, doc?.blocks?.length])

  async function addBlock() {
    const maxOrder = blocks.reduce((m, b) => Math.max(m, b.order_index), -1)
    try {
      const b = await API.addBlock(doc.id, { type: 'custom', content: '', order_index: maxOrder + 1 })
      setBlocks(bs => [...bs, b])
    } catch (e) { toast(e.message, true) }
  }

  const refs = blocks.filter(b => b.type === 'references')
  const rest = blocks.filter(b => b.type !== 'references').sort((a, b) => a.order_index - b.order_index)
  const ordered = [...rest, ...refs]

  return (
    <div className="be">
      {ordered.map(block => (
        <BlockCard key={block.id} block={block} docId={doc.id}
          onUpdate={(id, content) => setBlocks(bs => bs.map(b => b.id === id ? { ...b, content } : b))}
          onDelete={id => setBlocks(bs => bs.filter(b => b.id !== id))}
          onReload={onReload}
          toast={toast} />
      ))}
      <button className="add-bc" onClick={addBlock}>+ Add Block</button>
    </div>
  )
}

// ─── RESEARCH PANEL ───────────────────────────────────────────────────────────

function ResearchPanel({ onClose, toast }) {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [tab, setTab] = useState('context')

  async function run() {
    if (!q.trim()) return
    setLoading(true); setResult(null)
    try {
      const res = await API.runAgent({ agent: 'research', prompt: q })
      setResult(res.result)
    } catch (e) { toast(e.message, true) }
    finally { setLoading(false) }
  }

  return (
    <div className="rp">
      <div className="rp-head">
        <div className="rp-title">Research Agent</div>
        <button className="rp-close" onClick={onClose}>×</button>
      </div>
      <div className="rp-body">
        <textarea className="rp-textarea" placeholder="Enter a topic or paste highlighted text..."
          value={q} onChange={e => setQ(e.target.value)} rows={3} />
        <button className="rp-btn" onClick={run} disabled={loading || !q.trim()}>
          {loading ? <><span className="spin" /> Researching...</> : '⌕ Research'}
        </button>
        {result && (
          <>
            <div className="rp-tabs">
              {['context', 'concepts', 'citations'].map(t => (
                <button key={t} className={`rp-tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            {tab === 'context' && (
              <div className="rp-section">
                <p className="rp-context">{result.context}</p>
                {result.perspectives?.length > 0 && <>
                  <div className="rp-h4">Perspectives</div>
                  <ul>{result.perspectives.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </>}
              </div>
            )}
            {tab === 'concepts' && (
              <div className="rp-section">
                {result.related_concepts?.length > 0 && <>
                  <div className="rp-h4">Related Concepts</div>
                  <div className="tags">{result.related_concepts.map((c, i) => <span key={i} className="tag">{c}</span>)}</div>
                </>}
                {result.search_terms?.length > 0 && <>
                  <div className="rp-h4">Search Terms</div>
                  <div className="tags">{result.search_terms.map((t, i) => <span key={i} className="tag q">{t}</span>)}</div>
                </>}
              </div>
            )}
            {tab === 'citations' && (
              <div className="rp-section">
                {(result.suggested_citations || []).map((c, i) => (
                  <div key={i} className="cit-card">
                    <p className="cit-apa">{c.apa}</p>
                    <div className="cit-meta">
                      {c.journal && <span>{c.journal}</span>}
                      {c.year && <span>· {c.year}</span>}
                    </div>
                  </div>
                ))}
                {!result.suggested_citations?.length && <div className="rp-ph"><p>No citations generated.</p></div>}
              </div>
            )}
          </>
        )}
        {!result && !loading && (
          <div className="rp-ph">
            <div className="rp-ph-icon">⌕</div>
            <p>Research any topic to get academic context, related concepts, and citation suggestions.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── WORKSPACE ────────────────────────────────────────────────────────────────

function Workspace({ user, onLogout }) {
  const [docs, setDocs] = useState([])
  const [activeDoc, setActiveDoc] = useState(null)
  const [loading, setLoading] = useState(false)
  const [agentRunning, setAgentRunning] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [researchOpen, setResearchOpen] = useState(false)
  const { toasts, toast } = useToasts()

  useEffect(() => { loadDocs() }, [])

  async function loadDocs() {
    try { setDocs(await API.docs()) } catch {}
  }

  async function selectDoc(id) {
    setLoading(true)
    try { setActiveDoc(await API.getDoc(id)) } catch { toast('Failed to load document', true) }
    finally { setLoading(false) }
  }

  async function newDoc() {
    try {
      const doc = await API.createDoc('Untitled Research')
      await loadDocs()
      setActiveDoc(await API.getDoc(doc.id))
    } catch (e) { toast(e.message, true) }
  }

  async function deleteDoc(id) {
    if (!confirm('Delete this document?')) return
    try {
      await API.deleteDoc(id)
      await loadDocs()
      if (activeDoc?.id === id) setActiveDoc(null)
    } catch (e) { toast(e.message, true) }
  }

  async function handleAgentRun(agent, prompt) {
    if (!activeDoc) return
    setAgentRunning(true)
    try {
      await API.runAgent({ agent, prompt, document_id: activeDoc.id })
      // Reload document to get fresh blocks
      const fresh = await API.getDoc(activeDoc.id)
      setActiveDoc(fresh)
      await loadDocs()
      toast(`${agent.charAt(0).toUpperCase() + agent.slice(1)} agent completed`)
    } catch (e) { toast(e.message, true) }
    finally { setAgentRunning(false) }
  }

  async function reloadDoc() {
    if (!activeDoc) return
    try {
      const fresh = await API.getDoc(activeDoc.id)
      setActiveDoc(fresh)
    } catch {}
  }

  return (
    <div className="ws">
      <Sidebar docs={docs} activeId={activeDoc?.id}
        onNew={newDoc} onDelete={deleteDoc} onSelect={selectDoc}
        user={user} onLogout={onLogout} collapsed={!sidebarOpen} />
      <div className="ws-main">
        <TopBar doc={activeDoc}
          sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen(s => !s)}
          researchOpen={researchOpen} onToggleResearch={() => setResearchOpen(s => !s)}
          onAgentRun={handleAgentRun} agentRunning={agentRunning} />
        {agentRunning && (
          <div className="agent-banner">
            <span className="spin" style={{ borderTopColor: '#fdf8f0', borderColor: 'rgba(253,248,240,.25)' }} />
            Agent is working on your document…
          </div>
        )}
        <div className="ws-content">
          {loading ? (
            <div className="ws-loading"><span className="spin dark lg" /><p>Loading…</p></div>
          ) : activeDoc ? (
            <BlockEditor doc={activeDoc} onReload={reloadDoc} toast={toast} />
          ) : (
            <div className="empty">
              <div style={{ fontSize: 48, opacity: .3 }}>◻</div>
              <h2>No document open</h2>
              <p>Create a new research document to start writing with AI assistance.</p>
              <button className="empty-btn" onClick={newDoc}>+ New Research Document</button>
            </div>
          )}
        </div>
      </div>
      {researchOpen && <ResearchPanel onClose={() => setResearchOpen(false)} toast={toast} />}
      <Toast toasts={toasts} />
    </div>
  )
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────

function App() {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('dhithra_token')
    if (!token) { setChecking(false); return }
    API.me().then(u => { setUser(u); setChecking(false) })
         .catch(() => { localStorage.removeItem('dhithra_token'); setChecking(false) })
  }, [])

  if (checking) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#12100e' }}>
      <span className="spin" style={{ width: 36, height: 36, borderWidth: 3, borderTopColor: '#8b5a2b', borderColor: 'rgba(139,90,43,.2)' }} />
    </div>
  )

  return user
    ? <Workspace user={user} onLogout={() => { localStorage.removeItem('dhithra_token'); setUser(null) }} />
    : <LoginPage onLogin={setUser} />
}

// ─── MOUNT ────────────────────────────────────────────────────────────────────

const style = document.createElement('style')
style.textContent = CSS
document.head.appendChild(style)

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
