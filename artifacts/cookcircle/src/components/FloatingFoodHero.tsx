import { motion } from 'motion/react';

const FLOATERS = [
  { emoji: '🥗', size: 76, top: '9%',  left: '6%',   duration: 5.6, delay: 0.0, rotDir: 1  },
  { emoji: '🍲', size: 60, top: '64%', left: '4%',   duration: 6.3, delay: 0.9, rotDir: -1 },
  { emoji: '🥐', size: 68, top: '22%', right: '5%',  duration: 5.9, delay: 0.4, rotDir: 1  },
  { emoji: '🧀', size: 54, top: '70%', right: '8%',  duration: 7.1, delay: 1.3, rotDir: -1 },
  { emoji: '🥕', size: 46, top: '46%', left: '2%',   duration: 6.6, delay: 0.7, rotDir: 1  },
  { emoji: '🍓', size: 50, top: '15%', right: '16%', duration: 5.3, delay: 1.1, rotDir: -1 },
] as const;

const FEATURES = [
  { icon: '🥗', title: 'Share surplus food',       desc: 'Post meals, produce & pantry items in seconds' },
  { icon: '🤝', title: 'Discreet, private pickup', desc: 'Exact address revealed only to approved recipients' },
  { icon: '⭐', title: 'Build community trust',    desc: 'Ratings and reviews after every successful pickup' },
];

const CHIPS = ['🔒 Privacy-first', '📍 Israel-wide', '♻️ Reduce food waste'];

export function FloatingFoodHero() {
  return (
    <div className="ffc-hero">
      {/* Decorative background blobs */}
      <div className="ffc-bg-blob" style={{ width: 320, height: 320, top: '6%', right: '-60px', background: 'radial-gradient(circle, rgba(238,156,90,0.20) 0%, transparent 70%)' }} />
      <div className="ffc-bg-blob" style={{ width: 260, height: 260, bottom: '10%', left: '-40px', background: 'radial-gradient(circle, rgba(143,176,145,0.20) 0%, transparent 70%)' }} />

      {/* Floating food bubbles — reduced-motion handled via CSS */}
      {FLOATERS.map((f, i) => (
        <motion.div
          key={i}
          className="ffc-floater"
          style={{
            width: f.size,
            height: f.size,
            fontSize: Math.round(f.size * 0.52),
            top: f.top,
            ...('left' in f ? { left: f.left } : { right: f.right }),
          }}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{
            opacity: [0, 0.85, 0.85],
            scale: [0.5, 1, 1],
            y: [0, -16, 0],
            rotate: [0, f.rotDir * 7, 0],
          }}
          transition={{
            opacity:  { duration: 0.5, delay: f.delay },
            scale:    { duration: 0.5, delay: f.delay },
            y:        { duration: f.duration, repeat: Infinity, ease: 'easeInOut', delay: f.delay },
            rotate:   { duration: f.duration * 1.15, repeat: Infinity, ease: 'easeInOut', delay: f.delay },
          }}
        >
          {f.emoji}
        </motion.div>
      ))}

      {/* Brand */}
      <motion.div
        className="flex items-center gap-3 mb-10 ffc-content"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <span className="brand-logo" style={{ width: 44, height: 44, fontSize: 22 }}>🌿</span>
        <span className="brand-wordmark" style={{ fontSize: 26 }}>CookCircle</span>
      </motion.div>

      {/* Eyebrow */}
      <motion.div
        className="eyebrow mb-3 ffc-content"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        Community food sharing
      </motion.div>

      {/* Headline */}
      <motion.h1
        className="page-title ffc-content"
        style={{ fontSize: 42, lineHeight: 1.08, marginBottom: 16 }}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.18 }}
      >
        Fresh food,<br />shared with dignity.
      </motion.h1>

      {/* Subtitle */}
      <motion.p
        className="page-subtitle ffc-content"
        style={{ maxWidth: 360, marginBottom: 36 }}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.28 }}
      >
        CookCircle connects neighbors who have surplus food with people nearby —
        with respectful pickup, privacy-aware locations, and community trust.
      </motion.p>

      {/* Feature pills */}
      <motion.div
        className="flex flex-col gap-3 ffc-content"
        style={{ maxWidth: 380, marginBottom: 32 }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.38 }}
      >
        {FEATURES.map((feat, i) => (
          <div key={i} className="auth-feature-pill">
            <span className="auth-feature-icon">{feat.icon}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#152818' }}>{feat.title}</div>
              <div style={{ fontSize: 12, color: '#6b7d6e', marginTop: 1 }}>{feat.desc}</div>
            </div>
          </div>
        ))}
      </motion.div>

      {/* Trust chips */}
      <motion.div
        className="flex flex-wrap gap-2 ffc-content"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.5 }}
      >
        {CHIPS.map((c, i) => (
          <span key={i} className="trust-chip">{c}</span>
        ))}
        <span className="trust-chip" style={{ opacity: 0.75 }}>🏠 Exact pickup address revealed only after approval</span>
      </motion.div>
    </div>
  );
}
