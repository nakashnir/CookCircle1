import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Sigil, Eyebrow, Icon } from './ui';
import { api, type User } from '../lib/api';
import { dur, ease, variants } from '../lib/motion';

/**
 * Editorial auth — split layout with a magazine-grade left column and
 * a refined form on the right. (Replaced the legacy bouncing-emoji hero
 * in Sprint 2.)
 *
 * Left column (lg+): Sigil mark, "№ 01 — A FOOD COMMUNITY" eyebrow, a
 * Fraunces-display statement, three numbered claims separated by hairlines,
 * and a floating donation preview card that telegraphs the product.
 *
 * Right column: the form (login / register) and a polished demo-credentials
 * card that one-click fills the email field.
 *
 * Public API matches the legacy AuthScreen: `onLogin(user)` callback.
 */

const PILLARS: Array<{ title: string; copy: string }> = [
  {
    title: 'Real names, real neighbors',
    copy: 'Every donor and every recipient has a verified profile and a public review history.',
  },
  {
    title: 'Discreet by design',
    copy: 'Your full address is only revealed once a pickup is approved — never to passers-by.',
  },
  {
    title: 'Trust earned, not claimed',
    copy: 'Ratings come from completed pickups only. No anonymous five-stars, no review farming.',
  },
];

export function AuthScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await api.login(email, password);
      onLogin(user);
    } catch (err: any) {
      setError(err?.message ?? 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await api.register(name, email, password);
      onLogin(user);
    } catch (err: any) {
      setError(err?.message ?? 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  const presetEmails: Array<[string, string]> = [
    ['Yael — donor with active request', 'yael@example.co.il'],
    ['Maya — donor with two listings', 'maya@example.co.il'],
    ['David — community member', 'david@example.co.il'],
  ];

  return (
    <div className="cc-auth-shell">
      {/* ── Ambient mesh background (single decorative layer for both columns) ── */}
      <div className="cc-mesh" aria-hidden="true">
        <span className="cc-mesh-blob cc-mesh-blob--ember" />
        <span className="cc-mesh-blob cc-mesh-blob--forest" />
        <span className="cc-mesh-blob cc-mesh-blob--clay" />
        <span className="cc-mesh-grain" />
      </div>

      {/* ── Editorial left column (lg+) ── */}
      <aside className="cc-auth-editorial">
        <motion.header
          className="cc-auth-brand"
          variants={variants.staggerParent(0.1, 0.06)}
          initial="hidden"
          animate="visible"
        >
          <motion.span variants={variants.staggerChild} className="inline-flex items-center gap-3">
            <Sigil size={44} animated />
            <span className="cc-wordmark cc-wordmark--lg">CookCircle</span>
          </motion.span>
        </motion.header>

        <motion.div
          className="cc-auth-statement"
          variants={variants.staggerParent(0.18, 0.08)}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={variants.staggerChild}>
            <Eyebrow num={1} rule>
              A food community
            </Eyebrow>
          </motion.div>

          <motion.h1
            variants={variants.staggerChild}
            className="cc-auth-headline"
          >
            Cooked with love.
            <br />
            <em className="cc-italic">Shared</em> with neighbors.
          </motion.h1>

          <motion.p variants={variants.staggerChild} className="cc-auth-lede">
            CookCircle is a private network of cooks, gardeners, and households
            who share what they can't finish — to the people nearby who'd love
            to put it to use.
          </motion.p>

          <motion.ol
            variants={variants.staggerParent(0.45, 0.1)}
            initial="hidden"
            animate="visible"
            className="cc-auth-pillars"
          >
            {PILLARS.map((p, i) => (
              <motion.li
                key={p.title}
                variants={variants.staggerChild}
                className="cc-auth-pillar"
              >
                <span className="cc-auth-pillar-num">0{i + 1}</span>
                <div className="cc-auth-pillar-body">
                  <h3 className="cc-auth-pillar-title">{p.title}</h3>
                  <p className="cc-auth-pillar-copy">{p.copy}</p>
                </div>
              </motion.li>
            ))}
          </motion.ol>
        </motion.div>

        {/* Floating preview card (2.5D depth) — silently advertises the product */}
        <motion.figure
          className="cc-auth-preview"
          initial={{ opacity: 0, y: 28, rotate: -3 }}
          animate={{ opacity: 1, y: 0, rotate: -3 }}
          transition={{ duration: dur.slow, ease: ease.soft, delay: 0.8 }}
        >
          <div className="cc-auth-preview-meta">
            <span className="cc-auth-preview-num">№ 04</span>
            <span className="cc-auth-preview-dot" />
            <span>Tel Aviv · 1.2 km</span>
          </div>
          <h4 className="cc-auth-preview-title">Sourdough &amp; <em className="cc-italic">winter squash soup</em></h4>
          <p className="cc-auth-preview-sub">From Maya's kitchen — ready until 8:30 pm</p>
          <div className="cc-auth-preview-footer">
            <span className="cc-auth-preview-avatar" aria-hidden>MC</span>
            <span className="cc-auth-preview-rating">
              <Icon.Star size={13} /> 4.9 · 23 pickups
            </span>
            <span className="cc-auth-preview-status">
              <span className="cc-auth-preview-status-dot" /> Available now
            </span>
          </div>
        </motion.figure>

        <div className="cc-auth-foot" aria-hidden="true">
          <span>Made for a kinder pantry</span>
          <span className="cc-auth-foot-rule" />
          <span>Israel · 2026</span>
        </div>
      </aside>

      {/* ── Form column ── */}
      <section className="cc-auth-form-col" aria-labelledby="cc-auth-heading">
        {/* Compact brand for mobile (lg- hidden on desktop) */}
        <div className="cc-auth-brand-mobile">
          <Sigil size={36} />
          <span className="cc-wordmark">CookCircle</span>
        </div>

        <motion.div
          className="cc-auth-card"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: dur.slow, ease: ease.soft, delay: 0.1 }}
        >
          <div className="cc-auth-card-head">
            <Eyebrow size="sm">{tab === 'login' ? 'Welcome back' : 'Join the circle'}</Eyebrow>
            <h2 id="cc-auth-heading" className="cc-auth-card-title">
              {tab === 'login' ? (
                <>Sign in to <em className="cc-italic">your kitchen</em></>
              ) : (
                <>Create your <em className="cc-italic">profile</em></>
              )}
            </h2>
          </div>

          <div className="cc-auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'login'}
              className={`cc-auth-tab ${tab === 'login' ? 'is-active' : ''}`}
              onClick={() => { setTab('login'); setError(null); }}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'register'}
              className={`cc-auth-tab ${tab === 'register' ? 'is-active' : ''}`}
              onClick={() => { setTab('register'); setError(null); }}
            >
              Create account
            </button>
          </div>

          {tab === 'login' ? (
            <form onSubmit={handleLogin} className="cc-auth-form">
              <div>
                <label htmlFor="auth-email" className="cc-auth-label">Email</label>
                <input
                  id="auth-email"
                  type="email"
                  className="cc-auth-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.co.il"
                />
              </div>
              <div>
                <label htmlFor="auth-password" className="cc-auth-label">Password</label>
                <input
                  id="auth-password"
                  type="password"
                  className="cc-auth-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
              </div>
              {error && (
                <p role="alert" className="cc-auth-error">{error}</p>
              )}
              <motion.button
                type="submit"
                disabled={busy}
                className="cc-auth-submit"
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: dur.fast, ease: ease.glide }}
              >
                <span>{busy ? 'Signing in…' : 'Sign in'}</span>
                {!busy && <Icon.ArrowRight size={16} />}
              </motion.button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="cc-auth-form">
              <div>
                <label htmlFor="auth-name" className="cc-auth-label">Your name</label>
                <input
                  id="auth-name"
                  type="text"
                  className="cc-auth-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={2}
                  autoComplete="name"
                  placeholder="What should neighbors call you?"
                />
              </div>
              <div>
                <label htmlFor="auth-email-r" className="cc-auth-label">Email</label>
                <input
                  id="auth-email-r"
                  type="email"
                  className="cc-auth-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.co.il"
                />
              </div>
              <div>
                <label htmlFor="auth-password-r" className="cc-auth-label">
                  Password <span className="cc-auth-hint">min. 8 characters</span>
                </label>
                <input
                  id="auth-password-r"
                  type="password"
                  className="cc-auth-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
              </div>
              {error && (
                <p role="alert" className="cc-auth-error">{error}</p>
              )}
              <motion.button
                type="submit"
                disabled={busy}
                className="cc-auth-submit"
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: dur.fast, ease: ease.glide }}
              >
                <span>{busy ? 'Creating account…' : 'Create account'}</span>
                {!busy && <Icon.ArrowRight size={16} />}
              </motion.button>
            </form>
          )}

          {/* Demo creds */}
          <div className="cc-auth-demo">
            <Eyebrow size="sm">Quick demo access</Eyebrow>
            <ul className="cc-auth-demo-list">
              {presetEmails.map(([label, addr]) => (
                <li key={addr}>
                  <span className="cc-auth-demo-label">{label}</span>
                  <button
                    type="button"
                    className="cc-auth-demo-btn"
                    onClick={() => { setEmail(addr); setTab('login'); }}
                  >
                    {addr}
                  </button>
                </li>
              ))}
            </ul>
            <p className="cc-auth-demo-note">
              Password for all demo accounts:{' '}
              <code className="cc-auth-demo-code">CookCircle123!</code>
            </p>
          </div>
        </motion.div>
      </section>
    </div>
  );
}
