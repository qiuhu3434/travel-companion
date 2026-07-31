/**
 * 高德地图 API 路由
 *
 * 高德是本项目最核心的数据源，提供：
 * - POI搜索（酒店、餐厅、景点、游乐场所等）
 * - 路线规划（公交、驾车、步行、骑行）
 * - 天气查询（实时+预报）
 * - 地理编码（地址转经纬度）
 *
 * 文档: https://lbs.amap.com/api/webservice/guide/api/weather
 * 注册: https://lbs.amap.com/  (个人开发者免费，每日5000次配额)
 */
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

const router = express.Router();
const cache = new NodeCache({ stdTTL: 600 }); // 缓存10分钟
const AMAP_KEY = process.env.AMAP_KEY;

/**
 * GET /api/amap/poi
 * POI搜索 - 搜索酒店/餐厅/景点等地点信息
 *
 * 参数:
 *   keywords - 搜索关键词，如 "西湖" "全季酒店"
 *   city     - 城市名称或编码，如 "杭州" 或 "330100"
 *   types    - POI类型（可选），如 "050000" 为住宿服务
 */
router.get('/poi', async (req, res) => {
  const { keywords, city, types } = req.query;
  if (!keywords) return res.status(400).json({ error: '缺少 keywords 参数' });

  if (!AMAP_KEY) {
    return res.json({ total: 0, data: [], mock: true, message: '高德Key未配置，返回空数据' });
  }

  const cacheKey = `poi_${keywords}_${city}_${types || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const resp = await axios.get('https://restapi.amap.com/v3/place/text', {
      params: {
        key: AMAP_KEY,
        keywords,
        city,
        citylimit: true,
        types: types || '',
        offset: 20,
        page: 1,
        extensions: 'all'
      },
      timeout: 8000
    });

    if (resp.data.status !== '1') {
      const detail = resp.data.info || '';
      const isPlatMismatch = detail.includes('USERKEY_PLAT_NOMATCH');
      return res.status(502).json({
        error: '高德API返回错误',
        detail,
        hint: isPlatMismatch
          ? '你的Key类型与调用的API不匹配。本服务调用的是「Web服务」API（restapi.amap.com），请到高德控制台创建一个类型为「Web服务」的Key，而不是「Web端(JS API)」'
          : undefined
      });
    }

    const pois = (resp.data.pois || []).map(p => ({
      name: p.name,
      address: p.address,
      location: p.location,
      type: p.type,
      tel: p.tel,
      rating: p.bizext && p.bizext.rating ? p.bizext.rating : null,
      cost: p.bizext && p.bizext.cost ? p.bizext.cost : null,
      photos: p.photos ? p.photos.slice(0, 3) : []
    }));

    cache.set(cacheKey, pois);
    res.json({ total: pois.length, data: pois });
  } catch (err) {
    console.error('[高德] POI搜索失败:', err.message);
    res.status(500).json({ error: '高德POI搜索失败', detail: err.message });
  }
});

/**
 * GET /api/amap/route
 * 路线规划 - 公交/驾车/步行/骑行
 *
 * 参数:
 *   origin      - 起点经纬度 "经度,纬度" 如 "120.15,30.27"
 *   destination - 终点经纬度
 *   city        - 城市（公交模式必填）
 *   mode        - transit(公交) | driving(驾车) | walking(步行) | riding(骑行)
 */
router.get('/route', async (req, res) => {
  const { origin, destination, city, mode = 'transit' } = req.query;
  if (!origin || !destination) {
    return res.status(400).json({ error: '缺少 origin 或 destination 参数' });
  }
  if (!AMAP_KEY) {
    return res.json({ mock: true, message: '高德Key未配置' });
  }

  const urlMap = {
    transit: 'https://restapi.amap.com/v3/direction/transit/integrated',
    driving: 'https://restapi.amap.com/v3/direction/driving',
    walking: 'https://restapi.amap.com/v3/direction/walking',
    riding: 'https://restapi.amap.com/v4/direction/bicycling'
  };

  const url = urlMap[mode];
  if (!url) return res.status(400).json({ error: '不支持的出行方式: ' + mode });

  try {
    const params = { key: AMAP_KEY, origin, destination };
    if (mode === 'transit') params.city = city;

    const resp = await axios.get(url, { params, timeout: 8000 });
    if (resp.data.status !== '1') {
      return res.status(502).json({ error: '路线规划失败', detail: resp.data.info });
    }
    res.json(resp.data);
  } catch (err) {
    console.error('[高德] 路线规划失败:', err.message);
    res.status(500).json({ error: '路线规划请求失败', detail: err.message });
  }
});

/**
 * GET /api/amap/weather
 * 天气查询 - 通过高德获取实时天气和预报
 *
 * 参数:
 *   city - 城市编码，如 "330100" 为杭州
 */
router.get('/weather', async (req, res) => {
  const { city } = req.query;
  if (!city) return res.status(400).json({ error: '缺少 city 参数' });
  if (!AMAP_KEY) {
    return res.json({ mock: true, message: '高德Key未配置' });
  }

  const cacheKey = `amap_weather_${city}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const resp = await axios.get('https://restapi.amap.com/v3/weather/weatherInfo', {
      params: { key: AMAP_KEY, city, extensions: 'all' },
      timeout: 8000
    });

    if (resp.data.status !== '1') {
      return res.status(502).json({ error: '天气查询失败', detail: resp.data.info });
    }

    const result = {
      city: resp.data.forecasts && resp.data.forecasts[0] ? resp.data.forecasts[0].city : city,
      casts: resp.data.forecasts && resp.data.forecasts[0] ? resp.data.forecasts[0].casts : []
    };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('[高德] 天气查询失败:', err.message);
    res.status(500).json({ error: '天气查询请求失败', detail: err.message });
  }
});

/**
 * GET /api/amap/geocode
 * 地理编码 - 地址转经纬度
 *
 * 参数:
 *   address - 地址文本，如 "杭州市西湖区灵隐寺"
 *   city    - 指定城市（可选）
 */
router.get('/geocode', async (req, res) => {
  const { address, city } = req.query;
  if (!address) return res.status(400).json({ error: '缺少 address 参数' });
  if (!AMAP_KEY) {
    return res.json({ mock: true, message: '高德Key未配置' });
  }

  try {
    const resp = await axios.get('https://restapi.amap.com/v3/geocode/geo', {
      params: { key: AMAP_KEY, address, city },
      timeout: 8000
    });
    if (resp.data.status !== '1') {
      return res.status(502).json({ error: '地理编码失败', detail: resp.data.info });
    }
    const geocodes = (resp.data.geocodes || []).map(g => ({
      location: g.location,
      formatted_address: g.formatted_address,
      province: g.province,
      city: g.city,
      district: g.district
    }));
    res.json({ data: geocodes });
  } catch (err) {
    console.error('[高德] 地理编码失败:', err.message);
    res.status(500).json({ error: '地理编码请求失败', detail: err.message });
  }
});

module.exports = router;
