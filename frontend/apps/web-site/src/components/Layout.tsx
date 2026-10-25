import { useTranslation } from '@dop/i18n';
import { BrandMark } from '@dop/ui';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useHidden, useSiteInfo } from '../landing/lib';
import { LanguageToggle } from './LanguageToggle';

// Ink carries weight (the active page); ember stays for the page's own main action, so the header trial link is
// an ink pill rather than a second orange button.
const navCls = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-11 shrink-0 items-center rounded-full px-4 font-medium whitespace-nowrap ${isActive ? 'bg-ink text-white' : 'text-ink-2 hover:bg-canvas'}`;
const anchorCls = 'inline-flex min-h-11 shrink-0 items-center rounded-full px-4 font-medium whitespace-nowrap text-ink-2 hover:bg-canvas';
/** The same links stacked in the phone menu, with full-width tap targets. */
const menuCls = ({ isActive }: { isActive: boolean }) => `flex min-h-12 items-center rounded-2xl px-4 font-medium ${isActive ? 'bg-ink text-white' : 'text-ink-2 hover:bg-canvas'}`;

/** `/#how` style links: scroll to the section after navigation (the router does not do it). */
function useScrollToHash() {
  const { hash, pathname } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (el)
      el.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
  }, [hash, pathname]);
}

export function Layout() {
  const { t } = useTranslation();
  useScrollToHash();
  const site = useSiteInfo();
  const contact = site.data?.contact;
  const hidden = useHidden();
  const year = new Date().getFullYear();
  // Inner pages sit on the canvas tone from the top, so their white cards lift off it; the landing stays white.
  const location = useLocation();
  const inner = location.pathname !== '/';
  const [menuOpen, setMenuOpen] = useState(false);
  // Following a link (or the back button) closes the phone menu.
  useEffect(() => setMenuOpen(false), [location.pathname, location.hash]);
  const links = (cls: typeof navCls, anchor: string) => (
    <>
      {!hidden('steps') && (
        <Link to="/#how" className={anchor}>
          {t('nav.how')}
        </Link>
      )}
      <NavLink to="/pricing" className={cls}>
        {t('nav.pricing')}
      </NavLink>
      {!hidden('faq') && (
        <Link to="/#faq" className={anchor}>
          {t('nav.faq')}
        </Link>
      )}
      <NavLink to="/sign-in" className={cls}>
        {t('common:signIn')}
      </NavLink>
    </>
  );
  return (
    <div className={`flex min-h-dvh flex-col ${inner ? 'bg-canvas' : 'bg-surface'}`}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-3">
        {t('nav.skip')}
      </a>
      {/* A floating pill on wide screens; below lg the page links fold into a menu under the brand row. */}
      <header className="z-40 px-3 pt-3 sm:px-6 md:sticky md:top-0" onKeyDown={(e) => e.key === 'Escape' && setMenuOpen(false)}>
        <div className="mx-auto max-w-[74rem] rounded-[1.75rem] border border-line bg-surface/85 px-3 py-2 shadow-[var(--shadow-card)] backdrop-blur lg:rounded-full">
          <div className="flex items-center justify-between gap-2">
            <Link to="/" className="inline-flex min-h-11 min-w-0 items-center gap-2 ps-1 font-display text-xl font-bold text-ink">
              <BrandMark className="size-8 shrink-0" />
              <span className="truncate">{t('common:appName')}</span>
            </Link>
            <nav aria-label={t('nav.main')} className="hidden items-center gap-0.5 lg:flex">
              {links(navCls, anchorCls)}
            </nav>
            <div className="flex shrink-0 items-center gap-1">
              <LanguageToggle />
              <Link to="/contact" className="hidden min-h-11 items-center rounded-full bg-ink px-5 font-semibold whitespace-nowrap text-white hover:bg-ink-2 sm:inline-flex">
                {t('nav.getStarted')}
              </Link>
              <button
                type="button"
                aria-label={t('nav.main')}
                aria-expanded={menuOpen}
                aria-controls="site-menu"
                onClick={() => setMenuOpen((x) => !x)}
                className="inline-flex size-12 items-center justify-center rounded-full text-ink hover:bg-canvas lg:hidden"
              >
                <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
                  <path d={menuOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} />
                </svg>
              </button>
            </div>
          </div>
          {menuOpen && (
            <nav
              id="site-menu"
              aria-label={t('nav.main')}
              onClick={(e) => (e.target as HTMLElement).closest('a') && setMenuOpen(false)}
              className="mt-2 flex flex-col gap-1 border-t border-line pt-2 pb-1 lg:hidden"
            >
              {links(menuCls, menuCls({ isActive: false }))}
              <Link to="/contact" className="mt-1 inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-5 font-semibold text-white hover:bg-ink-2 sm:hidden">
                {t('nav.getStarted')}
              </Link>
            </nav>
          )}
        </div>
      </header>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <footer className="bg-ink text-white/75">
        <div className="mx-auto max-w-7xl flex flex-col gap-10 px-4 sm:px-8 lg:px-12 py-14">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-8">
            <Link to="/" className="inline-flex min-h-12 items-center gap-3 font-display text-2xl font-bold text-white">
              <BrandMark className="size-9" />
              {t('common:appName')}
            </Link>
            <p className="text-white/60">{t('landing.footer.tagline')}</p>
          </div>
          <div className="grid gap-10 sm:grid-cols-3">
            <nav aria-label={t('landing.footer.product')} className="flex flex-col gap-2">
              <p className="mb-1 font-semibold text-white">{t('landing.footer.product')}</p>
              {!hidden('steps') && (
                <Link to="/#how" className="w-fit hover:text-white">
                  {t('nav.how')}
                </Link>
              )}
              <Link to="/pricing" className="w-fit hover:text-white">
                {t('nav.pricing')}
              </Link>
              {!hidden('faq') && (
                <Link to="/#faq" className="w-fit hover:text-white">
                  {t('nav.faq')}
                </Link>
              )}
            </nav>
            <nav aria-label={t('footer.legal')} className="flex flex-col gap-2">
              <p className="mb-1 font-semibold text-white">{t('footer.legal')}</p>
              <Link to="/legal/terms" className="w-fit hover:text-white">
                {t('legal.kinds.terms')}
              </Link>
              <Link to="/legal/privacy" className="w-fit hover:text-white">
                {t('legal.kinds.privacy')}
              </Link>
              <Link to="/legal/dpa" className="w-fit hover:text-white">
                {t('legal.kinds.dpa')}
              </Link>
              <Link to="/legal/customer_privacy" className="w-fit hover:text-white">
                {t('legal.kinds.customer_privacy')}
              </Link>
            </nav>
            <div className="flex flex-col gap-2">
              <p className="mb-1 font-semibold text-white">{t('landing.footer.contact')}</p>
              {contact?.email && (
                <a href={`mailto:${contact.email}`} dir="ltr" className="w-fit break-all hover:text-white">
                  {contact.email}
                </a>
              )}
              {contact?.whatsappUrl && (
                <a href={contact.whatsappUrl} target="_blank" rel="noopener noreferrer" className="w-fit hover:text-white">
                  {t('landing.footer.whatsapp')} <span dir="ltr">{contact.whatsapp}</span>
                </a>
              )}
              <Link to="/contact" className="w-fit hover:text-white">
                {t('nav.contact')}
              </Link>
              <p className="mt-2 text-sm text-white/55">{t('landing.footer.payments')}</p>
            </div>
          </div>
          <p className="border-t border-white/10 pt-6 text-sm text-white/55">{t('footer.copyright', { year })}</p>
        </div>
      </footer>
    </div>
  );
}
