// Small text and date helpers shared by the built-in bots.

export const DAY = 86_400_000;
export const daysSince = (iso, now) => Math.floor((now.getTime() - Date.parse(iso)) / DAY);

const STOP = new Set(
  ('a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up us very was we were what when where which while who whom why will with would you your ' +
    'get got use using used want like need one also try trying still see seems way make made work works working please thanks thank hi hello issue bug problem error').split(' '),
);

export function tokens(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/[^a-z0-9_+#.-]+/)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
}

/** A tiny TF-IDF index, so similar-issue search needs no service and no key. */
export function buildIndex(docs) {
  const df = new Map();
  const vectors = docs.map((doc) => {
    const tf = new Map();
    for (const t of tokens(doc.title)) tf.set(t, (tf.get(t) ?? 0) + 3);
    for (const t of tokens(String(doc.body ?? '').slice(0, 2000))) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return tf;
  });
  const weigh = (tf) => {
    const v = new Map();
    let norm = 0;
    for (const [t, n] of tf) {
      const w = (1 + Math.log(n)) * Math.log(1 + docs.length / (1 + (df.get(t) ?? 0)));
      v.set(t, w);
      norm += w * w;
    }
    return { v, norm: Math.sqrt(norm) || 1 };
  };
  const weighted = vectors.map(weigh);
  return {
    /** @returns {{ doc: any, score: number }[]} best first */
    similar(query, { limit = 5, exclude } = {}) {
      const tf = new Map();
      for (const t of tokens(query.title)) tf.set(t, (tf.get(t) ?? 0) + 3);
      for (const t of tokens(String(query.body ?? '').slice(0, 2000))) tf.set(t, (tf.get(t) ?? 0) + 1);
      const q = weigh(tf);
      const scored = [];
      weighted.forEach((d, i) => {
        if (exclude !== undefined && docs[i].number === exclude) return;
        let dot = 0;
        for (const [t, w] of q.v) dot += w * (d.v.get(t) ?? 0);
        const score = dot / (q.norm * d.norm);
        if (score > 0) scored.push({ doc: docs[i], score });
      });
      return scored.sort((a, b) => b.score - a.score).slice(0, limit);
    },
  };
}

export const first = (text, n) => String(text ?? '').slice(0, n);
