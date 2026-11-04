/** Only same-site relative paths are allowed as post-login destinations (no open redirects). */
export function safeReturn(v: string | null | undefined): string {
  if (!v || !/^\/(?!\/)[\w\-./?=&%]*$/.test(v) || v.includes('\\') || /^\/auth\//.test(v))
    return '/portal';
  return v;
}
