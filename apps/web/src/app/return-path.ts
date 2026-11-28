function isRootRelative(path: string) {
  return path.startsWith("/") && !/^\/(?:[\/\\]|%2f|%5c)/iu.test(path);
}

export function safeReturnPath(value: string | null, origin: string): string | null {
  if (value === null || !isRootRelative(value) || /[\\\x00-\x20\x7f]/u.test(value)) return null;
  const url = new URL(value, origin);
  const path = url.pathname + url.search + url.hash;
  return url.origin === origin && isRootRelative(path) ? path : null;
}
