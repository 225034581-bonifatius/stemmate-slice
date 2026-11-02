// Shared test helpers: an in-memory stand-in for localStorage and a sample plan.
export function fakeStorage({ quota = Infinity } = {}) {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem(k, v) {
      const size = [...data].reduce((n, [key, val]) => n + (key === k ? 0 : val.length), 0) + v.length;
      if (size > quota) throw new Error("QuotaExceededError");
      data.set(k, String(v));
    },
    removeItem: (k) => data.delete(k),
    _data: data,
  };
}

export const completePlan = (over = {}) => ({
  title: "Bridge building",
  steps: "10 min intro, 30 min build, 10 min test",
  materials: "Cardboard, string, local reeds",
  safety: "Scissors used with supervision",
  inclusion: "Large print cards; pair work",
  ...over,
});

let n = 0;
export const seqId = () => `plan-${++n}`;
