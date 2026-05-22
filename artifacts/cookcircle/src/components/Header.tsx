import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Sigil, Icon } from './ui';
import { dur, ease } from '../lib/motion';
import type { User } from '../lib/api';

/**
 * Editorial header — Sigil mark + Fraunces wordmark + underline nav.
 *
 * Replaces the legacy pill-row navigation. Becomes lightly frosted once the
 * user scrolls past a small threshold so the masthead stays anchored to the
 * page rather than to the gradient background.
 *
 * Public API matches the legacy `Header` function exactly so swap is a no-op
 * for callers in App.tsx.
 */
export function Header({
  currentScreen,
  onNavigate,
  currentUser,
  onLogout,
  loggingOut = false,
}: {
  currentScreen: string;
  onNavigate: (screen: any) => void;
  currentUser: User;
  onLogout: () => void;
  loggingOut?: boolean;
}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navItems: Array<[string, string]> = [
    ['feed', 'Home'],
    ['my-donations', 'My donations'],
    ['requests', 'My requests'],
    ['profile', 'Profile'],
  ];

  const initials = currentUser.displayName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <header
      className={`cc-header ${scrolled ? 'is-scrolled' : ''}`}
      role="banner"
    >
      <div className="cc-header-inner">
        {/* Brand */}
        <button
          onClick={() => onNavigate('feed')}
          className="cc-brand"
          aria-label="CookCircle — go to feed"
        >
          <Sigil size={36} animated />
          <span className="cc-wordmark">CookCircle</span>
        </button>

        {/* Nav */}
        <nav className="cc-nav" aria-label="Primary">
          {navItems.map(([screen, label]) => {
            const active = currentScreen === screen;
            return (
              <button
                key={screen}
                onClick={() => onNavigate(screen)}
                className={`cc-nav-link ${active ? 'is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <span>{label}</span>
                {active && (
                  <motion.span
                    layoutId="cc-nav-underline"
                    className="cc-nav-underline"
                    transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Actions */}
        <div className="cc-header-actions">
          <button
            type="button"
            className="cc-header-user"
            onClick={() => onNavigate('profile')}
            aria-label={`Open profile for ${currentUser.displayName}`}
          >
            <span className="cc-avatar-mini" aria-hidden>{initials}</span>
            <span className="cc-header-user-name">{currentUser.displayName}</span>
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="cc-signout"
            aria-label="Sign out"
            disabled={loggingOut}
            aria-busy={loggingOut}
          >
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </button>
          <motion.button
            type="button"
            onClick={() => onNavigate('create')}
            className="cc-cta-primary"
            aria-label="Share food"
            initial={false}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={{ duration: dur.fast, ease: ease.glide }}
          >
            <Icon.Plus size={16} />
            <span>Share food</span>
          </motion.button>
        </div>
      </div>
    </header>
  );
}
