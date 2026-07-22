export function emptyBucket() {
  return {
    searches: 0,
    buy_now: 0,
    views: 0,
    search_users: [],
    buy_now_users: [],
    view_users: [],
    skintones: {},
    undertones: {},
    shades: {},
    retailers: {},
  };
}

function mergeCountMap(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b || {})) out[k] = (out[k] || 0) + b[k];
  return out;
}

function mergeShades(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b || {})) {
    const prev = out[k] || { selected: 0, buy_now: 0, views: 0 };
    const cur = b[k];
    out[k] = {
      selected: prev.selected + (cur.selected || 0),
      buy_now: prev.buy_now + (cur.buy_now || 0),
      views: prev.views + (cur.views || 0),
    };
  }
  return out;
}

function mergeUsers(a, b) {
  return Array.from(new Set([...(a || []), ...(b || [])]));
}

export function mergeBucket(a, b) {
  if (!b) return a;
  return {
    searches: a.searches + b.searches,
    buy_now: a.buy_now + b.buy_now,
    views: a.views + b.views,
    search_users: mergeUsers(a.search_users, b.search_users),
    buy_now_users: mergeUsers(a.buy_now_users, b.buy_now_users),
    view_users: mergeUsers(a.view_users, b.view_users),
    skintones: mergeCountMap(a.skintones, b.skintones),
    undertones: mergeCountMap(a.undertones, b.undertones),
    shades: mergeShades(a.shades, b.shades),
    retailers: mergeCountMap(a.retailers, b.retailers),
  };
}

function pickSources(section, source, into) {
  let total = into;
  if (source === 'all' || source === 'user_search') total = mergeBucket(total, section.user_search);
  if (source === 'all' || source === 'discovery') total = mergeBucket(total, section.discovery);
  return total;
}

export function aggregateProduct(product, source, dateRange) {
  let total = emptyBucket();
  for (const [dayKey, day] of Object.entries(product.days || {})) {
    if (!isDayInRange(dayKey, dateRange)) continue;
    for (const section of Object.values(day)) {
      total = pickSources(section, source, total);
    }
  }
  return total;
}

function isDayInRange(dayKey, dateRange) {
  if (!dateRange || (!dateRange.start && !dateRange.end)) return true;
  if (dateRange.start && dayKey < dateRange.start) return false;
  if (dateRange.end && dayKey > dateRange.end) return false;
  return true;
}
export function aggregateBrand(data, source, dateRange) {
  const perProduct = {};
  let brandTotal = emptyBucket();
  for (const [productName, productData] of Object.entries(data.products || {})) {
    const agg = aggregateProduct(productData, source, dateRange);
    perProduct[productName] = agg;
    brandTotal = mergeBucket(brandTotal, agg);
  }
  return { brandTotal, perProduct };
}

export function aggregateBySection(data, source, productName, dateRange) {
  const sections = {
    morning: emptyBucket(),
    afternoon: emptyBucket(),
    evening: emptyBucket(),
    night: emptyBucket(),
  };
  const products = productName ? { [productName]: data.products[productName] } : data.products;
  for (const productData of Object.values(products || {})) {
    if (!productData) continue;
    for (const [dayKey, day] of Object.entries(productData.days || {})) {
      if (!isDayInRange(dayKey, dateRange)) continue;
      for (const [sectionName, sectionData] of Object.entries(day)) {
        if (!sections[sectionName]) sections[sectionName] = emptyBucket();
        sections[sectionName] = pickSources(sectionData, source, sections[sectionName]);
      }
    }
  }
  return sections;
}

export function aggregateByDay(data, source, productName, dateRange) {
  const productData = data.products[productName];
  const byDay = {};
  if (!productData) return byDay;
  for (const [day, sectionsObj] of Object.entries(productData.days || {})) {
    if (!isDayInRange(day, dateRange)) continue;
    let bucket = emptyBucket();
    for (const sectionData of Object.values(sectionsObj)) {
      bucket = pickSources(sectionData, source, bucket);
    }
    byDay[day] = bucket;
  }
  return byDay;
}