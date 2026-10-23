import { useEffect } from 'react';

// The browser tab shows the venue's own logo when it has one; otherwise the Tanbeeh mark each app's index.html
// links (public/favicon.svg, or the customer app's PNG icon) stays in place.

/** Points the tab icon at `logoUrl` while mounted, and puts the app's Tanbeeh icon back when there is none. */
export function useVenueFavicon(logoUrl: string | null | undefined) {
  useEffect(() => {
    const link = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link || !logoUrl) return;
    const original = { href: link.getAttribute('href'), type: link.getAttribute('type') };
    link.setAttribute('href', logoUrl);
    link.removeAttribute('type');
    return () => {
      if (original.href) link.setAttribute('href', original.href);
      if (original.type) link.setAttribute('type', original.type);
    };
  }, [logoUrl]);
}
