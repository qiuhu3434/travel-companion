/**
 * 和风天气 API 路由
 *
 * 和风天气提供比高德更专业的气象数据：
 * - 7天/15天天气预报
 * - 逐小时预报
 * - 生活指数（穿衣、紫外线、运动等）
 * - 气象预警（暴雨、台风等）
 *
 * 文档: https://dev.qweather.com/docs/
 * 注册: https://dev.qweather.com/  (免费版每日1000次)
 *
 * 注意：和风天气需要先通过城市查询接口获取 LocationID，
 * 再用 LocationID 查询天气。本路由已封装此流程。
 */
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

const router = express.Router();
const cache = new NodeCache({ stdTTL: 1800 }); // 天气缓存30分钟
const QWEATHER_KEY = process.env.QWEATHER_KEY;

// 和风天气API基础地址
// 2024年起和风改为专属API Host，请在控制台「设置」页查看你的专属域名
// 形如 abc123def.re.qweatherapi.com，配置到环境变量 QWEATHER_HOST
// 兼容旧版：未配置时回退到 devapi（老免费版）或 api（标准版）
const BASE_URL = process.env.QWEATHER_HOST
  ? `https://${process.env.QWEATHER_HOST}`
  : 'https://devapi.qweather.com';
const GEO_URL = process.env.QWEATHER_HOST
  ? `https://${process.env.QWEATHER_HOST}`
  : 'https://geoapi.qweather.com';

/**
 * GET /api/weather/city
 * 城市查询 - 获取城市的 LocationID
 *
 * 参数:
 *   location - 城市名称，如 "杭州" 或 "西湖"
 */
router.get('/city', async (req, res) => {
  const { location } = req.query;
  if (!location) return res.status(400).json({ error: '缺少 location 参数' });

  if (!QWEATHER_KEY) {
    return res.json({ data: [], mock: true, message: '和风天气Key未配置' });
  }

  const cacheKey = `city_${location}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const resp = await axios.get(`${GEO_URL}/v2/city/lookup`, {
      params: { location, key: QWEATHER_KEY },
      timeout: 8000
    });

    if (resp.data.code !== '200') {
      return res.status(502).json({ error: '城市查询失败', code: resp.data.code });
    }

    const cities = (resp.data.location || []).map(c => ({
      name: c.name,
      id: c.id,
      lat: c.lat,
      lon: c.lon,
      adm2: c.adm2,
      adm1: c.adm1,
      country: c.country
    }));

    cache.set(cacheKey, cities);
    res.json({ data: cities });
  } catch (err) {
    console.error('[和风天气] 城市查询失败:', err.message);
    res.status(500).json({ error: '城市查询请求失败', detail: err.message });
  }
});

/**
 * GET /api/weather/forecast
 * 7天天气预报
 *
 * 参数:
 *   location - LocationID 或 "经度,纬度"
 */
router.get('/forecast', async (req, res) => {
  const { location } = req.query;
  if (!location) return res.status(400).json({ error: '缺少 location 参数' });
  if (!QWEATHER_KEY) {
    return res.json({ data: [], mock: true, message: '和风天气Key未配置' });
  }

  const cacheKey = `forecast_${location}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const resp = await axios.get(`${BASE_URL}/v7/weather/7d`, {
      params: { location, key: QWEATHER_KEY },
      timeout: 8000
    });

    if (resp.data.code !== '200') {
      return res.status(502).json({ error: '天气预报获取失败', code: resp.data.code });
    }

    const daily = (resp.data.daily || []).map(d => ({
      date: d.fxDate,
      textDay: d.textDay,
      textNight: d.textNight,
      tempMax: d.tempMax,
      tempMin: d.tempMin,
      windDirDay: d.windDirDay,
      windScaleDay: d.windScaleDay,
      humidity: d.humidity,
      precip: d.precip,
      uvIndex: d.uvIndex
    }));

    cache.set(cacheKey, daily);
    res.json({ data: daily });
  } catch (err) {
    console.error('[和风天气] 预报获取失败:', err.message);
    res.status(500).json({ error: '天气预报请求失败', detail: err.message });
  }
});

/**
 * GET /api/weather/now
 * 实时天气
 *
 * 参数:
 *   location - LocationID 或 "经度,纬度"
 */
router.get('/now', async (req, res) => {
  const { location } = req.query;
  if (!location) return res.status(400).json({ error: '缺少 location 参数' });
  if (!QWEATHER_KEY) {
    return res.json({ data: null, mock: true, message: '和风天气Key未配置' });
  }

  try {
    const resp = await axios.get(`${BASE_URL}/v7/weather/now`, {
      params: { location, key: QWEATHER_KEY },
      timeout: 8000
    });

    if (resp.data.code !== '200') {
      return res.status(502).json({ error: '实时天气获取失败', code: resp.data.code });
    }

    const now = resp.data.now;
    res.json({
      data: {
        temp: now.temp,
        text: now.text,
        windDir: now.windDir,
        windScale: now.windScale,
        humidity: now.humidity,
        precip: now.precip,
        feelsLike: now.feelsLike,
        obsTime: now.obsTime
      }
    });
  } catch (err) {
    console.error('[和风天气] 实时天气获取失败:', err.message);
    const is403 = err.response && err.response.status === 403;
    res.status(500).json({
      error: '实时天气请求失败',
      detail: err.message,
      hint: is403
        ? '403错误通常是因为API Host不匹配。和风2024年起要求使用专属API Host，请到控制台「设置」页查看你的专属域名（形如 abc123def.re.qweatherapi.com），配置到环境变量 QWEATHER_HOST'
        : undefined
    });
  }
});

/**
 * GET /api/weather/warning
 * 气象预警 - 查询当前生效的天气预警
 *
 * 用于出行准备板块的"系统检查"功能：
 * 如果出发日有暴雨/台风等预警，自动打回并提醒用户
 */
router.get('/warning', async (req, res) => {
  const { location } = req.query;
  if (!location) return res.status(400).json({ error: '缺少 location 参数' });
  if (!QWEATHER_KEY) {
    return res.json({ data: [], mock: true, message: '和风天气Key未配置' });
  }

  try {
    const resp = await axios.get(`${BASE_URL}/v7/warning/now`, {
      params: { location, key: QWEATHER_KEY },
      timeout: 8000
    });

    if (resp.data.code !== '200') {
      return res.status(502).json({ error: '气象预警获取失败', code: resp.data.code });
    }

    const warnings = (resp.data.warning || []).map(w => ({
      title: w.title,
      type: w.type,
      level: w.level,
      text: w.text,
      startTime: w.startTime,
      endTime: w.endTime
    }));

    res.json({ data: warnings });
  } catch (err) {
    console.error('[和风天气] 预警获取失败:', err.message);
    res.status(500).json({ error: '气象预警请求失败', detail: err.message });
  }
});

/**
 * GET /api/weather/indices
 * 生活指数 - 穿衣、运动、紫外线等建议
 *
 * 参数:
 *   location - LocationID 或 "经度,纬度"
 *   type     - 指数类型（可选），默认 "3,5,6"
 *              1=运动, 2=洗车, 3=穿衣, 4=钓鱼, 5=紫外线, 6=旅游, 8=过敏
 */
router.get('/indices', async (req, res) => {
  const { location, type = '3,5,6' } = req.query;
  if (!location) return res.status(400).json({ error: '缺少 location 参数' });
  if (!QWEATHER_KEY) {
    return res.json({ data: [], mock: true, message: '和风天气Key未配置' });
  }

  try {
    const resp = await axios.get(`${BASE_URL}/v7/indices/1d`, {
      params: { location, key: QWEATHER_KEY, type },
      timeout: 8000
    });

    if (resp.data.code !== '200') {
      return res.status(502).json({ error: '生活指数获取失败', code: resp.data.code });
    }

    const indices = (resp.data.daily || []).map(i => ({
      name: i.name,
      category: i.category,
      text: i.text
    }));

    res.json({ data: indices });
  } catch (err) {
    console.error('[和风天气] 生活指数获取失败:', err.message);
    res.status(500).json({ error: '生活指数请求失败', detail: err.message });
  }
});

module.exports = router;
