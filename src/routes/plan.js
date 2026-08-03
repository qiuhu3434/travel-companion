/**
 * 智能行程规划路由 v2 — 三列表推荐 + 整合规划
 *
 * 两阶段设计：
 *   1. POST /api/plan/recommend — 拉取三类POI分类推荐列表（美食/户外/人文）
 *   2. POST /api/plan/generate  — 用户勾选后，整合为每日行程（餐厅=饭点，不=景点）
 *
 * 核心规则（纯确定性逻辑，无需AI/算法备案）：
 *   - 景点按地理聚类（3km内同天），少跑冤枉路
 *   - 餐厅固定 12:00 午餐 + 18:00 晚餐，就近匹配当天景点
 *   - 天气自适应：雨→室内优先、>35°C→午间避暑
 *   - 每半天 1-2 景，节奏自然
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
 *  常量
 * ================================================================ */

const POI_TYPES = {
  scenic:   '110000', // 风景名胜
  culture:  '140000', // 科教文化（仅用于子类筛选）
  food:     '050000', // 餐饮
  shopping: '060000', // 购物
  park:     '110100', // 公园广场
  museum:   '140100', // 博物馆
  gallery:  '141400', // 美术馆
  science:  '140900', // 科技馆/天文馆
  exhibit:  '140200', // 展览馆/会展中心
  memorial: '141300', // 纪念馆
  culture_palace: '141100', // 文化宫
  amusement: '080100', // 游乐场/主题乐园
  aquarium: '080600', // 水族馆/海洋馆
  zoo:      '080500', // 动物园
  theater:  '080200', // 剧院/音乐厅
  botanical: '080700', // 植物园
};

// 三列表搜索策略
const SEARCH_PLANS = {
  food: [
    { kw: '本地菜', type: POI_TYPES.food },
    { kw: '老字号', type: POI_TYPES.food },
    { kw: '网红餐厅', type: POI_TYPES.food },
    { kw: '小吃街', type: POI_TYPES.food },
  ],
  outdoor: [
    { kw: '公园', type: '' },
    { kw: '山', type: POI_TYPES.scenic },
    { kw: '湖', type: POI_TYPES.scenic },
    { kw: '自然风光', type: POI_TYPES.scenic },
  ],
  culture: [
    // 博物馆/展览类 — 精确子类，不会拉入学校/驾校
    { kw: '博物馆', type: POI_TYPES.museum },
    { kw: '展览馆', type: POI_TYPES.exhibit },
    { kw: '美术馆', type: POI_TYPES.gallery },
    { kw: '科技馆', type: POI_TYPES.science },
    { kw: '纪念馆', type: POI_TYPES.memorial },
    // 历史人文类 — 不限类型，仅靠关键词
    { kw: '寺庙', type: '' },
    { kw: '名人故居', type: '' },
    { kw: '古城', type: POI_TYPES.scenic },
    { kw: '大学校园', type: '' },
    // 娱乐/游乐类
    { kw: '游乐场', type: POI_TYPES.amusement },
    { kw: '主题乐园', type: POI_TYPES.amusement },
    { kw: '水族馆', type: POI_TYPES.aquarium },
    { kw: '动物园', type: POI_TYPES.zoo },
    { kw: '植物园', type: POI_TYPES.botanical },
    { kw: '剧院', type: POI_TYPES.theater },
  ],
};

// 餐厅人均价位标签
function costLabel(cost) {
  if (!cost) return '';
  const c = parseFloat(cost);
  if (c < 50) return '💰平价';
  if (c < 100) return '💰适中';
  if (c < 200) return '💰小资';
  return '💰高档';
}

/* ================================================================
 *  工具函数
 * ================================================================ */

function distanceKm(lng1, lat1, lng2, lat2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseLocation(locStr) {
  if (!locStr) return null;
  const parts = locStr.split(',');
  if (parts.length !== 2) return null;
  return { lng: parseFloat(parts[0]), lat: parseFloat(parts[1]) };
}

function weatherIcon(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('雨')) return '🌧️';
  if (t.includes('雪')) return '🌨️';
  if (t.includes('阴')) return '☁️';
  if (t.includes('多云')) return '⛅';
  if (t.includes('晴')) return '☀️';
  return '🌤️';
}

function isOutdoorFriendly(text) {
  const bad = ['雨', '雪', '沙', '尘', '霾', '暴', '雾'];
  return !bad.some(w => (text || '').includes(w));
}

function isHotDay(tempMax) {
  return parseInt(tempMax) >= 35;
}

function isIndoor(poi) {
  const indoorKeywords = ['博物馆', '展览', '图书馆', '商场', '购物',
    '室内', '电影', '剧院', '艺术馆', '纪念馆', '寺庙'];
  const name = (poi.name || '') + (poi.type || '');
  return indoorKeywords.some(k => name.includes(k));
}

/** 过滤非游客可访问的专业/机构场所（中小学、驾校、考试中心等） */
const NON_TOURIST_PATTERNS = [
  /小学|中学|初中|高中|幼儿园|特殊教育/,
  /驾校|驾驶员|考试中心|检测站|车管所/,
  /培训中心|培训机构|补习/,
  /政务中心|行政中心|服务中心|服务站/,
  /派出所|法院|检察院|公安局/,
  /卫生服务站|卫生院|医院|诊所/,
  /公墓|殡仪|陵园/,
  /戒毒|看守|监狱/,
];

function isValidTouristAttraction(poi) {
  const name = poi.name || '';
  const type = poi.type || '';
  // 白名单：明确可参观的类型优先通过
  const allowedTypes = [
    '博物馆', '展览馆', '美术馆', '科技馆', '天文馆', '纪念馆',
    '游乐场', '主题乐园', '水族馆', '海洋馆', '动物园', '植物园',
    '剧院', '音乐厅', '文化宫', '图书馆', '名人故居', '寺庙',
    '道观', '教堂', '清真寺', '古迹', '遗址', '古城',
    '公园', '风景名胜', '广场',
  ];
  if (allowedTypes.some(t => name.includes(t) || type.includes(t))) return true;

  // 大学/学院：允许（校园可参观），但排除职业学院/技术学院
  const exclCollege = /职业技术|技师|技工/;
  if (/大学/.test(name) && !exclCollege.test(name)) return true;
  if (/学院/.test(name) && !exclCollege.test(name) && !/行政/.test(name)) return true;

  // 黑名单：专业/机构场所
  if (NON_TOURIST_PATTERNS.some(p => p.test(name) || p.test(type))) return false;

  // 兜底：类型分类判断 — 明确不要的专业/机构子类
  // 高德返回的 type 格式为 "大��;中类;小类"，如 "科教文化服务;学校;中学"
  const excludedTypeCats = [
    '学校', '科研机构', '培训机构', '驾校', '档案馆',
    '政府机关', '社会团体', '交通服务',
    '诊所', '急救中心',
  ];
  const typeSegments = type.split(';');
  const hasExcludedType = typeSegments.some(seg =>
    excludedTypeCats.some(cat => seg.includes(cat))
  );
  if (hasExcludedType) {
    // 再检查一次白名单关键词，避免误杀（如"博物馆"也会落在科教文化大类）
    if (!allowedTypes.some(t => name.includes(t))) return false;
  }

  return true;
}

/* ================================================================
 *  高德 / 和风天气 内部调用
 * ================================================================ */

async function amapSearch(keywords, city, types) {
  if (!AMAP_KEY) return [];
  try {
    const resp = await axios.get('https://restapi.amap.com/v3/place/text', {
      params: { key: AMAP_KEY, keywords, city, citylimit: true, types: types || '', offset: 12, page: 1, extensions: 'all' },
      timeout: 4000,
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
      photos: p.photos ? p.photos.slice(0, 2) : [],
    }));
  } catch (e) {
    console.error('[Plan] 高德搜索失败:', e.message);
    return [];
  }
}

async function qweatherCity(cityName) {
  if (!QWEATHER_KEY) return null;
  try {
    const resp = await axios.get(`${QWEATHER_GEO}/v2/city/lookup`, {
      params: { location: cityName, key: QWEATHER_KEY }, timeout: 8000,
    });
    if (resp.data.code !== '200' || !resp.data.location || !resp.data.location.length) return null;
    const c = resp.data.location[0];
    return { id: c.id, name: c.name, lat: c.lat, lon: c.lon };
  } catch (e) { return null; }
}

async function qweatherForecast(locationId) {
  if (!QWEATHER_KEY) {
    return { forecast: [], error: 'QWEATHER_KEY_NOT_SET', hint: '和风天气Key未配置（QWEATHER_KEY为空）' };
  }
  try {
    const resp = await axios.get(`${QWEATHER_BASE}/v7/weather/7d`, {
      params: { location: locationId, key: QWEATHER_KEY }, timeout: 8000,
    });
    if (resp.data.code !== '200') {
      const isAuthError = ['401', '403'].includes(resp.data.code);
      return {
        forecast: [],
        error: isAuthError ? 'QWEATHER_AUTH_FAILED' : 'QWEATHER_API_ERROR',
        hint: isAuthError
          ? `和风天气返回 ${resp.data.code}：Key无效或API Host不匹配。2024年起和风要求使用专属API Host，请在控制台「设置」页查看形如 abc123def.re.qweatherapi.com 的专属域名，配置到环境变量 QWEATHER_HOST`
          : `和风天气返回错误码 ${resp.data.code}`
      };
    }
    const forecast = (resp.data.daily || []).map(d => ({
      date: d.fxDate, textDay: d.textDay, textNight: d.textNight,
      tempMax: d.tempMax, tempMin: d.tempMin,
      windDirDay: d.windDirDay, windScaleDay: d.windScaleDay,
      humidity: d.humidity, precip: d.precip,
    }));
    return { forecast, error: null, hint: null };
  } catch (e) {
    const is403 = e.response && e.response.status === 403;
    return {
      forecast: [],
      error: 'QWEATHER_REQUEST_FAILED',
      hint: is403
        ? '403错误：和风天气API Host不匹配。请在控制台「设置」页查看专属域名并配置 QWEATHER_HOST'
        : `和风天气请求失败：${e.message}`
    };
  }
}

/* ================================================================
 *  阶段一：POST /api/plan/recommend — 三列表推荐
 * ================================================================ */
router.post('/recommend', async (req, res) => {
  const { city } = req.body;
  if (!city) return res.status(400).json({ error: '请提供目的地城市' });

  try {
    // 并行搜索三类 POI
    const results = {};
    const seen = { food: new Set(), outdoor: new Set(), culture: new Set() };

    const recommendLimits = { food: 3, outdoor: 3, culture: 6 };
    for (const cat of ['food', 'outdoor', 'culture']) {
      results[cat] = [];
      const plans = SEARCH_PLANS[cat].slice(0, recommendLimits[cat]);
      const batchResults = await Promise.all(
        plans.map(p => amapSearch(p.kw, city, p.type))
      );
      batchResults.forEach(arr => {
        arr.forEach(p => {
          if (seen[cat].has(p.name)) return;
          seen[cat].add(p.name);

          const loc = parseLocation(p.location);
          const entry = {
            id: `${cat}_${results[cat].length}`,
            name: p.name,
            address: p.address,
            lng: loc ? loc.lng : null,
            lat: loc ? loc.lat : null,
            rating: p.rating,
            cost: p.cost,
            tel: p.tel,
            photos: p.photos,
            tags: [],
          };

          // 添加分类标签
          if (cat === 'food') {
            if (p.cost) entry.costLabel = costLabel(p.cost);
            const name2 = (p.name || '').toLowerCase();
            if (name2.includes('小吃') || name2.includes('面') || name2.includes('粉')) entry.tags.push('小吃');
            if (name2.includes('火锅')) entry.tags.push('火锅');
            if (name2.includes('老字号')) entry.tags.push('老字号');
            if (name2.includes('咖啡') || name2.includes('茶')) entry.tags.push('饮品');
            if (name2.includes('海鲜') || name2.includes('鱼')) entry.tags.push('海鲜');
          }
          if (cat === 'outdoor') {
            const name2 = (p.name || '').toLowerCase();
            if (name2.includes('山') || name2.includes('峰')) entry.tags.push('登山');
            if (name2.includes('湖') || name2.includes('水')) entry.tags.push('湖景');
            if (name2.includes('公园')) entry.tags.push('公园');
            if (name2.includes('湿地') || name2.includes('森林')) entry.tags.push('自然');
          }
          if (cat === 'culture') {
            const name2 = p.name || '';
            if (name2.includes('博物馆')) entry.tags.push('博物馆');
            if (name2.includes('美术馆')) entry.tags.push('美术馆');
            if (name2.includes('科技馆') || name2.includes('天文馆')) entry.tags.push('科技馆');
            if (name2.includes('展览馆') || name2.includes('会展')) entry.tags.push('展览馆');
            if (name2.includes('纪念馆')) entry.tags.push('纪念馆');
            if (name2.includes('寺') || name2.includes('庙') || name2.includes('道观') || name2.includes('教堂')) entry.tags.push('寺庙/宗教');
            if (name2.includes('故居')) entry.tags.push('故居');
            if (name2.includes('遗址') || name2.includes('古城')) entry.tags.push('遗址');
            if (name2.includes('游乐场') || name2.includes('主题乐园') || name2.includes('乐园')) entry.tags.push('游乐场');
            if (name2.includes('水族馆') || name2.includes('海洋馆')) entry.tags.push('水族馆');
            if (name2.includes('动物园')) entry.tags.push('动物园');
            if (name2.includes('植物园')) entry.tags.push('植物园');
            if (name2.includes('大学') || name2.includes('学院')) entry.tags.push('大学');
            if (name2.includes('剧院') || name2.includes('音乐厅')) entry.tags.push('剧院');
          }

          results[cat].push(entry);
        });
      });
    }

    // 人文类：过滤掉非游客可访问的专业/机构场所
    results.culture = results.culture.filter(isValidTouristAttraction);

    // 按评分排序
    for (const cat of ['food', 'outdoor', 'culture']) {
      results[cat].sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));
      results[cat] = results[cat].slice(0, 12); // 每类最多12条
    }

    res.json({
      city,
      food: results.food,
      outdoor: results.outdoor,
      culture: results.culture,
      totals: {
        food: results.food.length,
        outdoor: results.outdoor.length,
        culture: results.culture.length,
      },
    });
  } catch (err) {
    console.error('[Plan] 推荐获取失败:', err.message);
    res.status(500).json({ error: '获取推荐失败', detail: err.message });
  }
});

/* ================================================================
 *  阶段二：POST /api/plan/generate — 整合行程规划
 * ================================================================ */
router.post('/generate', async (req, res) => {
  const { city, days = 3, budget, selections } = req.body;
  // selections: { food: [names...], outdoor: [names...], culture: [names...] }

  if (!city) return res.status(400).json({ error: '请提供目的地城市' });
  if (days < 1 || days > 7) return res.status(400).json({ error: '天数需在 1-7 之间' });

  const selFood = (selections && selections.food) || [];
  const selOutdoor = (selections && selections.outdoor) || [];
  const selCulture = (selections && selections.culture) || [];

  try {
    // ---- 并行拉取数据 ----
    const [foodResults, outdoorResults, cultureResults, qCity] = await Promise.all([
      // 食物：用勾选的 + 额外拉一些作为备选
      (selFood.length > 0
        ? Promise.all(selFood.slice(0, 6).map(name => amapSearch(name, city, POI_TYPES.food)))
        : Promise.all(SEARCH_PLANS.food.slice(0, 2).map(p => amapSearch(p.kw, city, p.type)))
      ),
      // 户外景点
      (selOutdoor.length > 0
        ? Promise.all(selOutdoor.slice(0, 6).map(name => amapSearch(name, city, '')))
        : Promise.all(SEARCH_PLANS.outdoor.slice(0, 2).map(p => amapSearch(p.kw, city, p.type)))
      ),
      // 人文景点
      (selCulture.length > 0
        ? Promise.all(selCulture.slice(0, 6).map(name => amapSearch(name, city, '')))
        : Promise.all(SEARCH_PLANS.culture.slice(0, 2).map(p => amapSearch(p.kw, city, p.type)))
      ),
      qweatherCity(city),
    ]);

    // ---- 整理数据：分离餐厅和景点 ----
    const restaurants = [];
    const attractions = [];
    const seenNames = new Set();

    // 餐厅
    foodResults.forEach(arr => {
      arr.forEach(p => {
        if (seenNames.has(p.name)) return;
        seenNames.add(p.name);
        const loc = parseLocation(p.location);
        restaurants.push({
          name: p.name, address: p.address, lng: loc ? loc.lng : null,
          lat: loc ? loc.lat : null, rating: p.rating, cost: p.cost,
        });
      });
    });

    // 景点（户外+人文合并）
    // 先过滤掉人文类中非游客可访问的专业/机构场所
    const filteredCulture = cultureResults.map(arr =>
      arr.filter(isValidTouristAttraction)
    );
    const allAttrResults = [...outdoorResults, ...filteredCulture];
    allAttrResults.forEach(arr => {
      arr.forEach(p => {
        if (seenNames.has(p.name)) return;
        seenNames.add(p.name);
        const loc = parseLocation(p.location);
        attractions.push({
          name: p.name, address: p.address, lng: loc ? loc.lng : null,
          lat: loc ? loc.lat : null, rating: p.rating, type: p.type, indoor: isIndoor(p),
        });
      });
    });

    // 天气预报
    let forecastRes;
    if (!QWEATHER_KEY) {
      forecastRes = { forecast: [], error: 'QWEATHER_KEY_NOT_SET', hint: '和风天气Key未配置（QWEATHER_KEY为空），请在 https://dev.qweather.com/ 注册获取并配置专属API Host' };
    } else if (!qCity) {
      forecastRes = { forecast: [], error: 'QWEATHER_CITY_NOT_FOUND', hint: '未找到该城市的天气数据，请检查城市名称' };
    } else {
      forecastRes = await qweatherForecast(qCity.id);
    }
    const forecast = forecastRes.forecast || [];

    // ---- 景点地理聚类 ----
    const geoAttrs = attractions.filter(a => a.lng !== null && a.lat !== null);
    const clusters = clusterPois(geoAttrs, 3); // 3km 聚类

    // 餐厅按评分排序
    restaurants.sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));

    // ---- 生成每日行程 ----
    const dailyPlans = [];
    const usedAttractions = new Set();

    for (let d = 0; d < days; d++) {
      const dayWeather = forecast[d] || null;
      const canOutdoor = dayWeather ? isOutdoorFriendly(dayWeather.textDay) : true;
      const isHot = dayWeather ? isHotDay(dayWeather.tempMax) : false;

      // 拿一个簇的景点
      const cluster = clusters[d % clusters.length] || [];
      const dayAttractions = cluster.filter(a => !usedAttractions.has(a.name));
      dayAttractions.forEach(a => usedAttractions.add(a.name));

      // 天气筛选：雨→室内优先，晴→户外优先
      dayAttractions.sort((a, b) => {
        if (!canOutdoor) {
          // 雨：室内优先
          if (a.indoor && !b.indoor) return -1;
          if (!a.indoor && b.indoor) return 1;
        }
        return (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0);
      });

      // 上午景点 (取前2个)
      const morningSpots = dayAttractions.slice(0, 2);

      // 午餐：找离上午景点最近、当天还没用过的餐厅
      const morningCenter = calcCenter(morningSpots);
      const lunchSpot = findNearestRestaurant(restaurants, morningCenter, usedAttractions, 'lunch');
      if (lunchSpot) usedAttractions.add(lunchSpot.name);

      // 下午景点 (取接下来2个，跳过已用的)
      const restAttractions = dayAttractions.filter(a =>
        !morningSpots.includes(a)
      );
      // 如果不够，从其他簇补
      const afternoonSpots = restAttractions.slice(0, 2);

      // 晚餐
      const afternoonCenter = calcCenter(afternoonSpots.length ? afternoonSpots : morningSpots);
      const dinnerSpot = findNearestRestaurant(restaurants, afternoonCenter, usedAttractions, 'dinner');
      if (dinnerSpot) usedAttractions.add(dinnerSpot.name);

      // 晚间活动（剩余一个景点或自由探索）
      const remaining = dayAttractions.filter(a =>
        !morningSpots.includes(a) && !afternoonSpots.includes(a)
      );
      const eveningActivity = remaining.length > 0 ? remaining[0] : null;

      // 编排时间槽
      const slots = isHot ? HOT_SLOTS : NORMAL_SLOTS;
      const schedule = [];

      // 早餐
      schedule.push({
        slot: 'breakfast', time: '08:00-09:00', label: '早餐', icon: '🍳',
        poi: { name: '酒店早餐/当地早餐店', address: '', lng: null, lat: null },
      });

      // 上午景点
      morningSpots.forEach((s, i) => {
        schedule.push({
          slot: i === 0 ? 'morning1' : 'morning2',
          ...slots[i === 0 ? 'morning1' : 'morning2'],
          poi: { name: s.name, address: s.address, rating: s.rating, lng: s.lng, lat: s.lat },
          tip: !canOutdoor && !s.indoor ? '注意带伞' : (isHot && !s.indoor ? '注意防晒' : null),
          indoor: s.indoor,
        });
      });

      // 午餐（固定在 12:00）
      schedule.push({
        slot: 'lunch', ...slots.lunch,
        poi: lunchSpot
          ? { name: lunchSpot.name, address: lunchSpot.address, rating: lunchSpot.rating, cost: lunchSpot.cost, lng: lunchSpot.lng, lat: lunchSpot.lat }
          : { name: restaurants[d % restaurants.length]?.name || '当地特色餐厅', address: '', lng: null, lat: null },
        tip: lunchSpot && lunchSpot.cost ? costLabel(lunchSpot.cost) : null,
        isMeal: true,
      });

      // 下午景点
      afternoonSpots.forEach((s, i) => {
        schedule.push({
          slot: i === 0 ? 'afternoon1' : 'afternoon2',
          ...slots[i === 0 ? 'afternoon1' : 'afternoon2'],
          poi: { name: s.name, address: s.address, rating: s.rating, lng: s.lng, lat: s.lat },
          tip: isHot && !s.indoor ? '注意防晒补水' : null,
          indoor: s.indoor,
        });
      });

      // 晚餐（固定在 18:00）
      const dinnerIdx = (d * 2 + 1) % restaurants.length;
      schedule.push({
        slot: 'dinner', ...slots.dinner,
        poi: dinnerSpot
          ? { name: dinnerSpot.name, address: dinnerSpot.address, rating: dinnerSpot.rating, cost: dinnerSpot.cost, lng: dinnerSpot.lng, lat: dinnerSpot.lat }
          : { name: restaurants[dinnerIdx]?.name || '热门餐厅', address: '', lng: null, lat: null },
        tip: dinnerSpot && dinnerSpot.cost ? costLabel(dinnerSpot.cost) : null,
        isMeal: true,
      });

      // 晚间
      schedule.push({
        slot: 'evening', ...slots.evening,
        poi: eveningActivity
          ? { name: eveningActivity.name, address: eveningActivity.address, lng: eveningActivity.lng, lat: eveningActivity.lat }
          : { name: canOutdoor ? '散步/自由探索' : (isHot ? '夜风纳凉' : '室内休闲'), address: '', lng: null, lat: null },
        tip: canOutdoor ? '享受夜晚' : (isHot ? '凉爽好时光' : '注意保暖'),
      });

      // ---- 计算相邻节点之间的交通连接 ----
      const connections = await buildConnections(schedule, city);

      dailyPlans.push({
        day: d + 1,
        date: dayWeather ? dayWeather.date : `第${d + 1}天`,
        weather: dayWeather ? {
          text: dayWeather.textDay, icon: weatherIcon(dayWeather.textDay),
          tempMax: dayWeather.tempMax, tempMin: dayWeather.tempMin,
          wind: `${dayWeather.windDirDay}${dayWeather.windScaleDay}级`,
        } : null,
        schedule,
        connections,
      });
    }

    const budgetPerDay = budget ? Math.round(budget / days) : null;

    res.json({
      city, days, budget: budget || null, budgetPerDay,
      source: attractions.length >= days ? '实时数据' : '部分实时+模板',
      poisSource: `景点${attractions.length}个，餐厅${restaurants.length}个`,
      weatherAvailable: forecast.length > 0,
      weatherError: forecastRes.error,
      weatherHint: forecastRes.hint,
      selections: {
        food: selFood.slice(0, 6),
        outdoor: selOutdoor.slice(0, 6),
        culture: selCulture.slice(0, 6),
      },
      daily: dailyPlans,
    });
  } catch (err) {
    console.error('[Plan] 行程规划失败:', err.message);
    res.status(500).json({ error: '行程规划失败', detail: err.message });
  }
});

/* ================================================================
 *  聚类 & 匹配算法（纯工具函数，不依赖AI）
 * ================================================================ */

/** 贪心地理聚类：距离 maxDistKm 以内归入同一簇 */
function clusterPois(pois, maxDistKm = 3) {
  if (!pois.length) return [];
  const unvisited = [...pois];
  const clusters = [];
  while (unvisited.length) {
    const cluster = [unvisited.shift()];
    const center = { lng: cluster[0].lng, lat: cluster[0].lat };
    let i = unvisited.length - 1;
    while (i >= 0) {
      if (!unvisited[i].lng || !unvisited[i].lat) { i--; continue; }
      if (distanceKm(center.lng, center.lat, unvisited[i].lng, unvisited[i].lat) <= maxDistKm) {
        cluster.push(unvisited.splice(i, 1)[0]);
      }
      i--;
    }
    clusters.push(cluster);
  }
  return clusters.sort((a, b) => b.length - a.length);
}

/** 计算一组POI的中心点 */
function calcCenter(pois) {
  if (!pois.length) return null;
  const valid = pois.filter(p => p.lng !== null && p.lat !== null);
  if (!valid.length) return null;
  return {
    lng: valid.reduce((s, p) => s + p.lng, 0) / valid.length,
    lat: valid.reduce((s, p) => s + p.lat, 0) / valid.length,
  };
}

/** 为每日 schedule 生成相邻节点之间的交通连接 */
async function buildConnections(schedule, city) {
  const connections = [];
  for (let i = 0; i < schedule.length - 1; i++) {
    const from = schedule[i].poi;
    const to = schedule[i + 1].poi;
    if (!from || !to || from.lng == null || from.lat == null || to.lng == null || to.lat == null) {
      connections.push(null); // 节点坐标缺失时不显示交通连接
      continue;
    }
    const route = await amapTransitRoute(
      { lng: from.lng, lat: from.lat },
      { lng: to.lng, lat: to.lat },
      city
    );
    if (route) {
      connections.push(formatTransitRoute(route));
    } else {
      connections.push(fallbackTransitAdvice(from, to));
    }
  }
  return connections;
}

/** 调用高德公交路径规划（v3） */
async function amapTransitRoute(origin, destination, city) {
  if (!AMAP_KEY || !origin || !destination) return null;
  try {
    const resp = await axios.get('https://restapi.amap.com/v3/direction/transit/integrated', {
      params: {
        key: AMAP_KEY,
        origin: `${origin.lng},${origin.lat}`,
        destination: `${destination.lng},${destination.lat}`,
        city,
        cityd: city,
        strategy: 0, // 最快捷模式
        extensions: 'all',
      },
      timeout: 10000,
    });
    if (resp.data.status !== '1' || !resp.data.route || !resp.data.route.transits || !resp.data.route.transits.length) {
      return null;
    }
    const transit = resp.data.route.transits[0];
    return {
      duration: parseInt(transit.duration) || 0, // 秒
      distance: parseInt(transit.distance) || 0, // 米
      walkingDistance: parseInt(transit.walking_distance) || 0,
      segments: (transit.segments || []).map(seg => {
        const walking = seg.walking || {};
        const busLine = seg.bus && seg.bus.buslines && seg.bus.buslines[0];
        const railway = seg.railway || {};
        return {
          walkingDistance: parseInt(walking.distance) || 0,
          walkingDuration: parseInt(walking.duration) || 0,
          line: busLine ? busLine.name : (railway.name || null),
          lineType: busLine ? (busLine.type || '公交') : (railway.name ? '火车/地铁' : null),
          departure: busLine && busLine.departure_stop ? busLine.departure_stop.name : (railway.departure_stop || null),
          arrival: busLine && busLine.arrival_stop ? busLine.arrival_stop.name : (railway.arrival_stop || null),
          viaNum: busLine ? parseInt(busLine.via_num) || 0 : 0,
        };
      }).filter(s => s.line || s.walkingDistance > 0),
    };
  } catch (e) {
    console.error('[Plan] 公交路径规划失败:', e.message);
    return null;
  }
}

/** 把高德公交结果格式化成易读文本 */
function formatTransitRoute(route) {
  const durationMin = Math.max(1, Math.round(route.duration / 60));
  const distanceKm = (route.distance / 1000).toFixed(1);
  const segments = route.segments || [];

  // 判断主要交通方式
  let mode = 'bus';
  const hasSubway = segments.some(s => s.line && /地铁|轨道/.test(s.line));
  if (hasSubway) mode = 'subway';

  // 生成摘要：如 地铁1号线 → 步行300米
  const summaries = [];
  segments.forEach((s, idx) => {
    if (s.line) {
      summaries.push(`${s.line}（${s.viaNum || 0}站）`);
    } else if (s.walkingDistance > 0) {
      summaries.push(`步行${(s.walkingDistance).toFixed(0)}米`);
    }
  });

  // 生成详情：包含上下车站和出站指引
  let detail = '';
  const rideSegments = segments.filter(s => s.line);
  if (rideSegments.length > 0) {
    const first = rideSegments[0];
    detail = `从「${first.departure || '起点'}」乘${first.line}`;
    if (rideSegments.length > 1) {
      const last = rideSegments[rideSegments.length - 1];
      detail += `，到「${last.arrival || '终点'}」下车`;
    } else {
      detail += `，到「${first.arrival || '终点'}」下车`;
    }
    const walkSeg = segments.find(s => s.walkingDistance > 0 && s.line == null);
    if (walkSeg) {
      detail += `；下车后步行约${Math.max(1, Math.round(walkSeg.walkingDuration / 60))}分钟到达`;
    }
  } else if (route.walkingDistance > 0) {
    detail = `全程步行约${(route.walkingDistance).toFixed(0)}米`;
  }

  return {
    mode,
    text: `${mode === 'subway' ? '地铁' : '公交'}约 ${durationMin} 分钟 · ${distanceKm}公里`,
    distance: `${distanceKm}公里`,
    duration: `${durationMin}分钟`,
    detail: detail || '建议出站后跟随导航步行',
    summary: summaries.join(' → '),
  };
}

/** 公交规划失败时，根据直线距离给出回退建议 */
function fallbackTransitAdvice(from, to) {
  const dist = distanceKm(from.lng, from.lat, to.lng, to.lat);
  const walkMinutes = Math.max(5, Math.round(dist * 15)); // 步行约15分钟/公里
  if (dist < 1) {
    return {
      mode: 'walk',
      text: `步行约 ${walkMinutes} 分钟`,
      distance: `${(dist * 1000).toFixed(0)}米`,
      duration: `${walkMinutes}分钟`,
      detail: '距离较近，建议步行前往；也可骑共享单车',
      summary: '步行',
    };
  }
  if (dist < 4) {
    const busMin = Math.round(dist * 8 + 10); // 公交含等车
    return {
      mode: 'bus',
      text: `公交/地铁约 ${busMin} 分钟`,
      distance: `${dist.toFixed(1)}公里`,
      duration: `${busMin}分钟`,
      detail: '可查询附近公交/地铁线路，或打车更快',
      summary: '公交/地铁',
    };
  }
  const taxiMin = Math.round(dist * 4 + 5); // 打车约4分钟/公里+起步
  return {
    mode: 'taxi',
    text: `打车约 ${taxiMin} 分钟`,
    distance: `${dist.toFixed(1)}公里`,
    duration: `${taxiMin}分钟`,
    detail: '距离较远，建议打车或乘坐地铁',
    summary: '打车/地铁',
  };
}

/** 找离中心点最近且未被使用的餐厅 */
function findNearestRestaurant(restaurants, center, used, mealType) {
  if (!center) return null;
  const candidates = restaurants
    .filter(r => r.lng !== null && r.lat !== null && (!used || !used.has(r.name)))
    .map(r => ({ ...r, _dist: distanceKm(center.lng, center.lat, r.lng, r.lat) }))
    .sort((a, b) => a._dist - b._dist);
  return candidates[0] || null;
}

/* ================================================================
 *  时间槽模板
 * ================================================================ */
const NORMAL_SLOTS = {
  morning1:   { time: '09:00-10:30', label: '上午景点①', icon: '🏛️' },
  morning2:   { time: '10:30-12:00', label: '上午景点②', icon: '📍' },
  lunch:      { time: '12:00-13:30', label: '午餐', icon: '🍽️' },
  afternoon1: { time: '13:30-15:30', label: '下午景点①', icon: '🎯' },
  afternoon2: { time: '15:30-17:30', label: '下午景点②', icon: '📸' },
  dinner:     { time: '17:30-19:00', label: '晚餐', icon: '🥘' },
  evening:    { time: '19:00-21:00', label: '晚间活动', icon: '🌙' },
};

const HOT_SLOTS = {
  morning1:   { time: '07:30-10:00', label: '上午景点①', icon: '🏛️' },
  morning2:   { time: '10:00-12:00', label: '室内参观', icon: '🏢' },
  lunch:      { time: '12:00-13:30', label: '午餐', icon: '🍽️' },
  afternoon1: { time: '13:30-15:00', label: '午休/室内', icon: '😴' },
  afternoon2: { time: '15:30-17:30', label: '下午景点', icon: '📸' },
  dinner:     { time: '17:30-19:00', label: '晚餐', icon: '🥘' },
  evening:    { time: '19:00-21:00', label: '晚间活动', icon: '🌙' },
};

module.exports = router;
