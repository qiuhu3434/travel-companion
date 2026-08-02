/**
 * 攻略聚合路由
 *
 * ===================== 重要说明 =====================
 *
 * 携程和小红书的API现状：
 *
 * 携程：
 *   - 无面向个人开发者的开放API
 *   - 携程联盟(u.ctrip.com)：可注册获取分销推广链接，按成交抽佣
 *   - 携程开放平台(open.ctrip.com)：面向B2B企业合作，需企业资质
 *   - 替代方案：用高德POI获取酒店/餐厅数据，链接跳转携程H5页面
 *
 * 小红书：
 *   - 无任何面向开发者的公开API
 *   - 小红书开放平台：仅面向品牌方和商户，需企业认证
 *   - 替代方案：人工策展 / 第三方付费数据 / 引导跳转
 *
 * 本路由聚合所有可用数据源，对不可用源提供替代方案
 * =====================================================
 */
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const path = require('path');

const router = express.Router();
const cache = new NodeCache({ stdTTL: 3600 }); // 攻略缓存1小时
const AMAP_KEY = process.env.AMAP_KEY;
const CTRIP_AID = process.env.CTRIP_AID || '';

// 加载策展景区数据库
let scenicDB = null;
function getScenicDB() {
  if (!scenicDB) {
    try {
      scenicDB = require('../data/scenic-areas.json');
    } catch (e) {
      console.error('[攻略] 景区数据库加载失败:', e.message);
      scenicDB = { scenicAreas: [] };
    }
  }
  return scenicDB;
}

/**
 * 生成高德静态地图URL
 * @param {number} lng - 经度
 * @param {number} lat - 纬度
 * @param {number} zoom - 缩放级别
 * @returns {string|null} 静态地图图片URL，无Key时返回null
 */
function genStaticMapUrl(lng, lat, zoom = 14) {
  if (!AMAP_KEY) return null;
  const loc = `${lng},${lat}`;
  // 高德静态地图API：标记点+标注文字
  const markers = `mid,0xFF6B6B,${lng},${lat}`;
  return `https://restapi.amap.com/v3/staticmap?location=${loc}&zoom=${zoom}&size=680*400&scale=2&markers=${markers}&key=${AMAP_KEY}`;
}

/**
 * GET /api/guides/scenic
 * 景区导览 - 返回策展景区数据（含静态地图、收费、推荐路线）
 *
 * 参数:
 *   city - 目标城市（支持城市名和别名，如 "常州"/"溧阳"/"常州溧阳"）
 *
 * 返回该城市的主要景区导览列表
 */
router.get('/scenic', (req, res) => {
  const { city } = req.query;
  if (!city) return res.status(400).json({ error: '缺少 city 参数' });

  const cacheKey = `scenic_${city}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  const db = getScenicDB();
  const cityNorm = city.trim();

  // 匹配城市：精确匹配city或cityAlias
  const matched = db.scenicAreas.filter(area => {
    if (area.city === cityNorm) return true;
    if (area.cityAlias && area.cityAlias.some(alias =>
      alias === cityNorm || cityNorm.includes(alias) || alias.includes(cityNorm)
    )) return true;
    return false;
  });

  // 为每个景区生成静态地图URL
  const result = matched.map(area => ({
    id: area.id,
    name: area.name,
    city: area.city,
    district: area.district,
    level: area.level,
    overview: area.overview,
    area: area.area,
    entranceFee: area.entranceFee,
    openHours: area.openHours,
    bestSeason: area.bestSeason,
    recommendedRoute: area.recommendedRoute,
    highlights: area.highlights,
    tips: area.tips,
    transportation: area.transportation,
    location: area.location,
    mapUrl: genStaticMapUrl(area.location.lng, area.location.lat, area.mapZoom),
    mapAvailable: !!AMAP_KEY
  }));

  const response = {
    total: result.length,
    mapAvailable: !!AMAP_KEY,
    data: result
  };

  cache.set(cacheKey, response);
  res.json(response);
});

/**
 * GET /api/guides/search
 * 攻略聚合搜索
 *
 * 参数:
 *   keywords - 搜索关键词，如 "杭州西湖攻略"
 *   city     - 目标城市
 *
 * 返回按相似度排序的攻略列表
 */
router.get('/search', async (req, res) => {
  const { keywords, city } = req.query;
  if (!keywords) return res.status(400).json({ error: '缺少 keywords 参数' });

  const cacheKey = `guides_${keywords}_${city || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  const results = [];

  // ---- 1. 高德POI数据（可直接获取）----
  if (AMAP_KEY) {
    try {
      const amapResp = await axios.get('https://restapi.amap.com/v3/place/text', {
        params: {
          key: AMAP_KEY,
          keywords,
          city,
          citylimit: !!city,
          offset: 10,
          extensions: 'all'
        },
        timeout: 8000
      });

      if (amapResp.data.status === '1' && amapResp.data.pois) {
        amapResp.data.pois.forEach(poi => {
          const tags = poi.type ? poi.type.split(';').slice(0, 3) : [];
          let similarity = 70;
          if (poi.name && poi.name.includes(keywords)) similarity += 20;
          tags.forEach(t => { if (keywords.includes(t)) similarity += 5; });
          similarity = Math.min(similarity, 98);

          results.push({
            source: '高德地图',
            title: poi.name,
            summary: `${poi.address || ''} · ${poi.type || ''}`.trim(),
            rating: poi.bizext && poi.bizext.rating ? poi.bizext.rating : null,
            location: poi.location,
            tags,
            similarity,
            url: null
          });
        });
      }
    } catch (e) {
      console.error('[攻略] 高德数据获取失败:', e.message);
    }
  }

  // ---- 2. 携程（联盟跳转链接）----
  const ctripUrl = CTRIP_AID
    ? `https://m.ctrip.com/webappsearch/?keyword=${encodeURIComponent(keywords)}&allianceid=${CTRIP_AID}`
    : `https://m.ctrip.com/webappsearch/?keyword=${encodeURIComponent(keywords)}`;

  results.push({
    source: '携程',
    title: `携程搜索「${keywords}」`,
    summary: '酒店预订、机票查询、景点门票、跟团游、用户真实评价',
    tags: ['酒店', '机票', '门票', '跟团游', '评价'],
    similarity: 75,
    url: ctripUrl,
    note: '携程无公开数据API，此为联盟跳转链接。完整数据接入需携程开放平台B2B合作资质。'
  });

  // ---- 3. 小红书（无API，仅跳转）----
  results.push({
    source: '小红书',
    title: `小红书搜索「${keywords}攻略」`,
    summary: '用户真实游记、探店笔记、避坑指南、美食推荐',
    tags: ['攻略', '探店', '游记', '避坑'],
    similarity: 65,
    url: `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keywords + ' 攻略')}`,
    note: '小红书无公开开发者API。替代方案：1)人工策展精选内容存入自建库 2)接入新红/蝉小红等第三方数据平台 3)引导用户在小红书APP内搜索'
  });

  // 按相似度降序排序
  results.sort((a, b) => b.similarity - a.similarity);

  cache.set(cacheKey, results);
  res.json({ total: results.length, data: results });
});

/**
 * POST /api/guides/curate
 * 人工策展 - 将精选攻略存入自建库
 *
 * 由于小红书无API，建议运营团队定期筛选优质攻略，
 * 通过此接口录入自建数据库，供小程序检索。
 */
router.post('/curate', async (req, res) => {
  const { title, source, summary, content, tags, original_url, city } = req.body;

  if (!title || !summary) {
    return res.status(400).json({ error: '缺少 title 或 summary' });
  }

  // TODO: 接入数据库后取消注释
  // const result = await db.query(
  //   'INSERT INTO guides (title, source, summary, content, tags, original_url, city, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
  //   [title, source, summary, content, JSON.stringify(tags), original_url, city]
  // );

  res.json({
    success: true,
    message: '攻略已录入策展库（数据库连接后生效）',
    data: { title, source, summary, tags, city }
  });
});

module.exports = router;
