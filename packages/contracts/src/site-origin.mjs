/** Deployment URL shared by prerendering, metadata, SEO artifacts and publication. */
export function normalizeSiteOrigin(value = 'http://localhost:18088') {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    throw new Error('SITE_ORIGIN must be an http(s) origin without credentials, a path, a query or a fragment');
  }
}
