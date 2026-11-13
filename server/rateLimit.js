const buckets = new Map();

module.exports = function rateLimit({ max, windowMs, keyFn }) {
  keyFn = keyFn || (req => req.ip);
  return (req, reply) => {
    const key = keyFn(req);
    const now = Date.now();
    const entry = buckets.get(key);
    if (!entry || now - entry.start > windowMs) {
      buckets.set(key, { count: 1, start: now });
      return true;
    }
    entry.count++;
    if (entry.count > max) {
      return reply.code(429).view('login', { error: 'Too many attempts. Try again later.' });
    }
    return true;
  };
};

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, entry] of buckets) {
    if (Date.now() - entry.start > cutoff) buckets.delete(key);
  }
}, 60_000);
