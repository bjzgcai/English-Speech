function percentile(values, fraction) {
  if (!values.length) return null;
  return values[Math.max(0, Math.ceil(values.length * fraction) - 1)];
}

function stageMetrics(rows) {
  const groups = new Map();
  for (const row of rows) {
    const [category, pipeline = "legacy"] = row.category.split("@");
    const key = `${row.stage}:${category}:${pipeline}`;
    if (!groups.has(key)) groups.set(key, { stage: row.stage, category, pipeline, values: [], newestAt: 0 });
    const group = groups.get(key);
    group.values.push(row.duration);
    group.newestAt = Math.max(group.newestAt, row.created);
  }
  return [...groups.values()].map(({ values, ...group }) => {
    values.sort((a, b) => a - b);
    return { ...group, averageMs: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length), samples: values.length, p50Ms: percentile(values, 0.5), p90Ms: percentile(values, 0.9) };
  });
}

module.exports = { percentile, stageMetrics };
