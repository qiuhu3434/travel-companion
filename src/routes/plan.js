/**
 * 智能行程规划路由 — 纯规则引擎，不依赖 AI
 *
 * 输入：目的地 + 天数 + 偏好 + 预算
 * 输出：完整的每日行程（上午景点 → 午餐 → 下午景点 → 晚餐 → 晚间）
 *
 * 核心算法三步：
 *   1. 地理聚类 — 距离 3km 内的景点分到同一天，少跑冤枉路
 *   2. 天气匹配 — 下雨天排室内（博物馆/商场），晴天排户外（公园/山水）
 *   3. 节奏编排 — 上午 2 景 → 午餐 → 下午 2 景 → 晚餐 → 晚间
 *
 * 与 AI 生成的区别：这是确定性 if-else 逻辑，审核不触发算法备案。
 */
const express = require('express');
const axios = require('axios');

const router = express.Router();

const AMAP_KEY = process.env.AMAP_KEY;
const QWEATHER_KEY = process.env.QWEATHER_KEY;
const QWEATHER_BASE = process.env.QWEATHER_HOST
  ? `https://${process.env.QWEATHER_HOST}`
  : 'https://devapi.qweather.com';
const QWEATHER_GEO = process.env.QWEATHER_HOST
  ? `https://${process.env.QWEATHER_HOST}`
  : 'https://geoapi.qweather.com';

/* ================================================================
 *  常量定义
 * ================================================================ */

// 高德 POI 类型编码
const POI_TYPES = {
  scenic:    '110000', // 风景名胜
  culture:   '140000', // 科教文化（博物馆、图书馆等）
  food:      '050000', // 餐饮服务
  shopping:  '060000', // 购物服务
  hotel:     '100000', // 住宿服务（星级酒店）
  entertain: '160000', // 娱乐休闲（主题公园、游乐场等）
};

// 偏好 → 搜索关键词映射
const PREFERENCE_KEYWORDS = {
  foodie:   ['美食街', '特色小吃', '本地菜', '网红餐厅'],
  culture:  ['博物馆', '历史古迹', '老街', '寺庙', '名人故居'],
  outdoor:  ['自然风光', '登山', '公园', '湖景', '徒步'],
};

// 偏好 → 额外 POI 类型
const PREFERENCE_EXTRA_TYPES = {
  foodie:   [POI_TYPES.food, POI_TYPES.shopping],
  culture:  [POI_TYPES.culture],
  outdoor:  [POI_TYPES.scenic],
};

// 天气 → 室内/室外判断
function isOutdoorFriendly(text) {
  const bad = ['雨', '雪', '沙', '尘', '霾', '暴', '雾'];
  return !bad.some(w => (text || '').includes(w));
}

function isHotDay(tempMax) {
  return parseInt(tempMax) >= 35;
}

// 活动模板
const TIME_SLOTS = {
  breakfast:  { time: '08:00-09:00', label: '早餐', icon: '🍳' },
  morning1:   { time: '09:00-10:30', label: '上午景点①', icon: '🏛️' },
  morning2:   { time: '10:30-12:00', label: '上午景点②', icon: '📍' },
  lunch:      { time: '12:00-13:30', label: '午餐', icon: '🍽️' },
  afternoon1: { time: '13:30-15:30', label: '下午景点①', icon: '🎯' },
  afternoon2: { time: '15:30-17:30', label: '下午景点②', icon: '📸' },
  dinner:     { time: '17:30-19:00', label: '晚餐', icon: '🥘' },
  evening:    { time: '19:00-21:00', label: '晚间活动', icon: '🌙' },
};

// 炎热天气下午调整
const HOT_DAY_SLOTS = {
  morning1:   { time: '07:30-10:00', label: '上午景点①', icon: '🏛️' },
  morning2:   { time: '10:00-12:00', label: '室内参观', icon: '🏢', hint: '高温避暑' },
  lunch:      { time: '12:00-13:30', label: '午餐', icon: '🍽️' },
  afternoon1: { time: '13:30-15:00', label: '午休/室内', icon: '😴', hint: '高温时段' },
  afternoon2: { time: '15:30-17:30', label: '下午景点', icon: '📸' },
  dinner:     { time: '17:30-19:00', label: '晚餐', icon: '🥘' },
  evening:    { time: '19:00-21:00', label: '晚间活动', icon: '🌙' },
};

/* ================================================================
 *  工具函数
 * ================================================================ */

// 两点距离（单位 km，Haversine 公式）
function distanceKm(lng1, lat1, lng2, lat2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 将经纬度字符串 "lng,lat" 拆开
function parseLocation(locStr) {
  if (!locStr) return null;
  const parts = locStr.split(',');
  if (parts.length !== 2) return null;
  return { lng: parseFloat(parts[0]), lat: parseFloat(parts[1]) };
}

// 智能天气图标
function weatherIcon(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('雨')) return '🌧️';
  if (t.includes('雪')) return '🌨️';
  if (t.includes('阴')) return '☁️';
  if (t.includes('多云')) return '⛅';
  if (t.includes('晴')) return '☀️';
  return '🌤️';
}

// 按偏好给 POI 打分（用于排序）
function scorePoi(poi, preference) {
  const name = (poi.name || '').toLowerCase();
  const type = (poi.type || '').toLowerCase();
  let score = 0;

  switch (preference) {
    case 'foodie':
      if (type.includes('餐饮') || type.includes('美食')) score += 10;
      if (type.includes('购物') || type.includes('商业')) score += 5;
      if (name.includes('小吃') || name.includes('美食')) score += 8;
      break;
    case 'culture':
      if (type.includes('博物馆') || type.includes('文化') || type.includes('科教')) score += 10;
      if (name.includes('博物馆') || name.includes('寺') || name.includes('庙')) score += 8;
      if (name.includes('故居') || name.includes('遗址') || name.includes('古城')) score += 6;
      break;
    case 'outdoor':
      if (type.includes('风景') || type.includes('公园') || type.includes('自然')) score += 10;
      if (name.includes('山') || name.includes('湖') || name.includes('公园')) score += 8;
      if (name.includes('徒步') || name.includes('骑行')) score += 6;
      break;
  }

  // 有评分加权
  if (poi.rating) score += parseFloat(poi.rating) * 2;
  // 有电话 → 更可能是正规商户
  if (poi.tel) score += 2;

  return score;
}

// 判断景点是否偏室内
function isIndoor(poi) {
  const indoorKeywords = ['博物馆', '展览', '图书馆', '商场', '购物', '室内', '电影', '剧院', '艺术馆', '纪念馆'];
  const name = (poi.name || '') + (poi.type || '');
  return indoorKeywords.some(k => name.includes(k));
}

// 高德 POI → 统一格式
function normalizePoi(p) {
  const loc = parseLocation(p.location);
  return {
    name: p.name,
    address: p.address,
    lng: loc ? loc.lng : null,
    lat: loc ? loc.lat : null,
    type: p.type,
    tel: p.tel || null,
    rating: p.rating || null,
    cost: p.cost || null,
    indoor: isIndoor(p),
  };
}

/* ================================================================
 *  API 调用封装（内部直接调用，不走自身路由）
 * ================================================================ */

// 高德 POI 搜索
async function amapPoi(keywords, city, types) {
  if (!AMAP_KEY) return [];
  try {
    const resp = await axios.get('https://restapi.amap.com/v3/place/text', {
      params: {
        key: AMAP_KEY,
        keywords,
        city,
        citylimit: true,
        types: types || '',
        offset: 15,
        page: 1,
        extensions: 'all',
      },
      timeout: 8000,
    });
    if (resp.data.status !== '1') return [];
    return (resp.data.pois || []).map(p => ({
      name: p.name,
      address: p.address,
      location: p.location,
      type: p.type,
      tel: p.tel || null,
      rating: (p.bizext && p.bizext.rating) ? p.bizext.rating : null,
      cost: (p.bizext && p.bizext.cost) ? p.bizext.cost : null,
    }));
  } catch (e) {
    console.error('[Plan] 高德POI失败:', e.message);
    return [];
  }
}

// 和风天气城市查询
async function qweatherCity(cityName) {
  if (!QWEATHER_KEY) return null;
  try {
    const resp = await axios.get(`${QWEATHER_GEO}/v2/city/lookup`, {
      params: { location: cityName, key: QWEATHER_KEY },
      timeout: 8000,
    });
    if (resp.data.code !== '200' || !resp.data.location || !resp.data.location.length) return null;
    const c = resp.data.location[0];
    return { id: c.id, name: c.name, lat: c.lat, lon: c.lon };
  } catch (e) {
    console.error('[Plan] 城市查询失败:', e.message);
    return null;
  }
}

// 和风天气 7 天预报
async function qweatherForecast(locationId) {
  if (!QWEATHER_KEY) return [];
  try {
    const resp = await axios.get(`${QWEATHER_BASE}/v7/weather/7d`, {
      params: { location: locationId, key: QWEATHER_KEY },
      timeout: 8000,
    });
    if (resp.data.code !== '200') return [];
    return (resp.data.daily || []).map(d => ({
      date: d.fxDate,
      textDay: d.textDay,
      textNight: d.textNight,
      tempMax: d.tempMax,
      tempMin: d.tempMin,
      windDirDay: d.windDirDay,
      windScaleDay: d.windScaleDay,
      humidity: d.humidity,
      precip: d.precip,
    }));
  } catch (e) {
    console.error('[Plan] 天气预报失败:', e.message);
    return [];
  }
}

/* ================================================================
 *  核心算法
 * ================================================================ */

/**
 * 步骤 1 — 地理聚类
 * 用贪心算法把 POI 按距离 3km 分组
 */
function clusterPois(pois, maxDistKm = 3) {
  if (!pois.length) return [];

  const unvisited = [...pois];
  const clusters = [];

  while (unvisited.length) {
    const cluster = [unvisited.shift()];
    const center = { lng: cluster[0].lng, lat: cluster[0].lat };

    // 找所有距离当前中心 maxDistKm 以内的点
    let i = unvisited.length - 1;
    while (i >= 0) {
      if (!unvisited[i].lng || !unvisited[i].lat) { i--; continue; }
      const d = distanceKm(center.lng, center.lat, unvisited[i].lng, unvisited[i].lat);
      if (d <= maxDistKm) {
        cluster.push(unvisited.splice(i, 1)[0]);
      }
      i--;
    }
    clusters.push(cluster);
  }

  // 按簇大小排序（大簇优先分配）
  return clusters.sort((a, b) => b.length - a.length);
}

/**
 * 步骤 2 — 天气匹配
 * 根据每天天气决定：优先排室内还是室外
 */
function weatherMatch(cluster, dayWeather, preference) {
  const canOutdoor = dayWeather ? isOutdoorFriendly(dayWeather.textDay) : true;
  const isHot = dayWeather ? isHotDay(dayWeather.tempMax) : false;

  // 给每个 POI 打分
  const scored = cluster.map(p => ({
    ...p,
    score: scorePoi(p, preference),
    // 天气惩罚：雨天室内加分，炎热户外减分
    weatherBonus: !canOutdoor ? (p.indoor ? 5 : -5) : (isHot ? (p.indoor ? 3 : -2) : 0),
  }));

  // 总排序
  scored.sort((a, b) => (b.score + b.weatherBonus) - (a.score + a.weatherBonus));

  return { pois: scored, canOutdoor, isHot };
}

/**
 * 步骤 3 — 节奏编排
 * 将一天的景点按时间槽排布
 */
function scheduleDay(dayPois, restaurants, dayIndex, dayWeather, preference) {
  const { pois, canOutdoor, isHot } = weatherMatch(dayPois, dayWeather, preference);
  const slots = isHot ? HOT_DAY_SLOTS : TIME_SLOTS;

  const schedule = [];
  const usedSpots = [];

  // 上午景点 ×2
  const morningSpots = pois.filter(p => !p.indoor || canOutdoor).slice(0, 2);
  if (!morningSpots.length) {
    // 雨天全排室内
    const indoor = pois.filter(p => p.indoor).slice(0, 2);
    morningSpots.push(...indoor);
  }
  morningSpots.forEach((s, i) => {
    const key = i === 0 ? 'morning1' : 'morning2';
    schedule.push({
      slot: key,
      ...slots[key],
      poi: { name: s.name, address: s.address, lng: s.lng, lat: s.lat, rating: s.rating, indoor: s.indoor },
      tip: s.indoor ? '室内活动' : (canOutdoor ? null : '今日有雨，建议带伞'),
    });
    usedSpots.push(s.name);
  });

  // 午餐
  const lunchSpot = restaurants[dayIndex % restaurants.length] || { name: '当地特色餐厅', address: '' };
  schedule.push({
    slot: 'lunch',
    ...slots.lunch,
    poi: { name: lunchSpot.name, address: lunchSpot.address },
    tip: preference === 'foodie' ? '收藏打卡！' : null,
  });

  // 下午景点 ×2
  const remaining = pois.filter(p => !usedSpots.includes(p.name));
  const afternoonSpots = remaining.slice(0, 2);
  afternoonSpots.forEach((s, i) => {
    const key = i === 0 ? 'afternoon1' : 'afternoon2';
    schedule.push({
      slot: key,
      ...slots[key],
      poi: { name: s.name, address: s.address, lng: s.lng, lat: s.lat, rating: s.rating, indoor: s.indoor },
      tip: isHot && !s.indoor ? '注意防晒补水' : null,
    });
    usedSpots.push(s.name);
  });

  // 晚餐
  const dinnerSpot = restaurants[(dayIndex + 1) % restaurants.length] || { name: '热门餐厅', address: '' };
  schedule.push({
    slot: 'dinner',
    ...slots.dinner,
    poi: { name: dinnerSpot.name, address: dinnerSpot.address },
    tip: preference === 'foodie' ? '本地人推荐！' : null,
  });

  // 晚间活动
  const eveningSpots = pois.filter(p => !usedSpots.includes(p.name));
  const eveningSpot = eveningSpots.length
    ? eveningSpots[0]
    : { name: '自由探索', address: '' };
  schedule.push({
    slot: 'evening',
    ...slots.evening,
    poi: { name: eveningSpot.name, address: eveningSpot.address, lng: eveningSpot.lng, lat: eveningSpot.lat },
    tip: canOutdoor ? '散步好时光' : (isHot ? '夜风凉爽' : '注意保暖'),
  });

  return schedule;
}

/**
 * 生成通用行程（API 不可用时的降级方案）
 */
function generateFallbackPlan(city, days, preference) {
  const templates = {
    foodie: {
      morning:  ['{city}老街', '{city}特色早市', '{city}小吃一条街'],
      afternoon: ['{city}美食博物馆', '{city}网红打卡街'],
      evening:   ['{city}夜市', '{city}酒吧街'],
      restaurants: ['{city}地道菜馆', '{city}老字号餐厅', '{city}热门火锅店'],
    },
    culture: {
      morning:  ['{city}博物馆', '{city}历史街区', '{city}古城墙'],
      afternoon: ['{city}名人故居', '{city}艺术馆', '{city}图书馆'],
      evening:   ['{city}剧院', '{city}老街夜景'],
      restaurants: ['{city}文化餐厅', '{city}主题餐吧', '{city}茶馆'],
    },
    outdoor: {
      morning:  ['{city}国家公园', '{city}登山步道', '{city}湖畔'],
      afternoon: ['{city}植物园', '{city}湿地公园', '{city}观景台'],
      evening:   ['{city}日落观景点', '{city}滨江步道'],
      restaurants: ['{city}农家乐', '{city}户外烧烤', '{city}湖边餐厅'],
    },
  };

  const t = templates[preference] || templates.outdoor;
  const daily = [];

  for (let d = 0; d < days; d++) {
    const hi = 'morning1';
    // 轮转模板
    const spots = [
      { slot: 'morning1', time: '09:00-10:30', label: '上午景点①', icon: '🏛️',
        poi: { name: t.morning[d % t.morning.length].replace('{city}', city), indoor: false } },
      { slot: 'morning2', time: '10:30-12:00', label: '上午景点②', icon: '📍',
        poi: { name: t.afternoon[d % t.afternoon.length].replace('{city}', city), indoor: false } },
      { slot: 'lunch', time: '12:00-13:30', label: '午餐', icon: '🍽️',
        poi: { name: t.restaurants[d % t.restaurants.length].replace('{city}', city) } },
      { slot: 'afternoon1', time: '13:30-15:30', label: '下午景点①', icon: '🎯',
        poi: { name: t.afternoon[(d + 1) % t.afternoon.length].replace('{city}', city), indoor: false } },
      { slot: 'afternoon2', time: '15:30-17:30', label: '下午景点②', icon: '📸',
        poi: { name: t.morning[(d + 1) % t.morning.length].replace('{city}', city), indoor: false } },
      { slot: 'dinner', time: '17:30-19:00', label: '晚餐', icon: '🥘',
        poi: { name: t.restaurants[(d + 1) % t.restaurants.length].replace('{city}', city) } },
      { slot: 'evening', time: '19:00-21:00', label: '晚间活动', icon: '🌙',
        poi: { name: t.evening[d % t.evening.length].replace('{city}', city) } },
    ];
    daily.push({ day: d + 1, schedule: spots });
  }

  return daily;
}

/* ================================================================
 *  POST /api/plan/generate — 主入口
 * ================================================================ */
router.post('/generate', async (req, res) => {
  const { city, days = 3, preference = 'outdoor', budget } = req.body;

  if (!city) {
    return res.status(400).json({ error: '请提供目的地城市' });
  }
  if (days < 1 || days > 7) {
    return res.status(400).json({ error: '天数需在 1-7 之间' });
  }
  const pref = ['foodie', 'culture', 'outdoor'].includes(preference) ? preference : 'outdoor';

  const prefLabels = { foodie: '逛吃之旅', culture: '人文之旅', outdoor: '户外之旅' };

  try {
    // ---- 并行获取数据 ----
    const prefKeywords = PREFERENCE_KEYWORDS[pref];

    const [scenicResults, cultureResults, foodResults, qCity] = await Promise.all([
      Promise.all(prefKeywords.map(kw => amapPoi(kw, city, POI_TYPES.scenic))),
      amapPoi(pref === 'culture' ? '博物馆 历史' : '景点', city, POI_TYPES.culture),
      amapPoi('美食 餐厅', city, POI_TYPES.food),
      qweatherCity(city),
    ]);

    // 合并景点
    const allScenic = [];
    scenicResults.forEach(arr => allScenic.push(...arr));
    const culturePois = cultureResults;
    const foodPois = foodResults;

    // 去重
    const seen = new Set();
    const allPois = [];
    const addPois = (arr) => {
      arr.forEach(p => {
        if (!seen.has(p.name)) { seen.add(p.name); allPois.push(normalizePoi(p)); }
      });
    };
    addPois(allScenic);
    addPois(culturePois);
    foodPois.forEach(p => {
      if (!seen.has(p.name)) { seen.add(p.name); allPois.push(normalizePoi(p)); }
    });

    // 天气预报
    let forecast = [];
    if (qCity) {
      forecast = await qweatherForecast(qCity.id);
    }

    // 筛选出有坐标的 POI 用于聚类
    const geoPois = allPois.filter(p => p.lng !== null && p.lat !== null);

    // ---- 执行规则引擎 ----
    let dailyPlans;
    let sourceLabel = '';
    let poisSource = '';

    if (geoPois.length >= days) {
      // 足够数据：走完整规则引擎
      const clusters = clusterPois(geoPois, 3);

      // 按天分配簇
      const daySchedules = [];
      for (let d = 0; d < days; d++) {
        const cluster = clusters[d % clusters.length] || [];
        const dayWeather = forecast[d] || null;
        const schedule = scheduleDay(cluster, foodPois.map(normalizePoi), d, dayWeather, pref);
        daySchedules.push({
          day: d + 1,
          date: dayWeather ? dayWeather.date : `第${d + 1}天`,
          weather: dayWeather ? {
            text: dayWeather.textDay,
            icon: weatherIcon(dayWeather.textDay),
            tempMax: dayWeather.tempMax,
            tempMin: dayWeather.tempMin,
            wind: `${dayWeather.windDirDay}${dayWeather.windScaleDay}级`,
          } : null,
          schedule,
        });
      }

      dailyPlans = daySchedules;
      sourceLabel = '实时数据';
      poisSource = `高德返回 ${allPois.length} 个地点，${geoPois.length} 个可定位`;
    } else {
      // 数据不足：降级到通用模板
      dailyPlans = generateFallbackPlan(city, days, pref);
      sourceLabel = '通用模板';
      poisSource = `高德返回 ${allPois.length} 个地点（不足以精准规划）`;
    }

    // ---- 预算估算 ----
    const budgetPerDay = budget
      ? Math.round(budget / days)
      : null;

    // ---- 返回结果 ----
    res.json({
      city,
      days,
      preference: pref,
      preferenceLabel: prefLabels[pref],
      budget: budget || null,
      budgetPerDay,
      source: sourceLabel,
      poisSource,
      weatherAvailable: forecast.length > 0,
      daily: dailyPlans,
    });
  } catch (err) {
    console.error('[Plan] 行程规划失败:', err.message);

    // 兜底：纯模板
    const fallback = generateFallbackPlan(city, days, pref);
    res.json({
      city,
      days,
      preference: pref,
      preferenceLabel: prefLabels[pref],
      source: '离线模板（API 异常）',
      daily: fallback,
    });
  }
});

module.exports = router;
