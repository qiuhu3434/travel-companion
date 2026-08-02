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

// 加载5A景区数据库
let scenic5aDB = null;
function getScenic5aDB() {
  if (!scenic5aDB) {
    try {
      scenic5aDB = require('../data/scenic-5a.json');
    } catch (e) {
      console.error('[攻略] 5A景区数据库加载失败:', e.message);
      scenic5aDB = { total: 0, provinces: [], flatList: [] };
    }
  }
  return scenic5aDB;
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
 * 景区导览 - 全国5A级景区数据库
 *
 * 参数:
 *   province - 省份名（可选，筛选省份）
 *   city     - 城市名（可选，支持模糊匹配，如"杭州"/"溧阳"/"常州溧阳"）
 *   district - 区县名（可选，精确到县级市）
 *   mode     - "list"(默认)返回景区列表 / "tree"返回省-市-县层级树
 *
 * 无参数时返回所有省份有5A景区的城市概览
 */
router.get('/scenic', (req, res) => {
  const { province, city, district, mode } = req.query;

  const db = getScenic5aDB();
  let flatList = db.flatList;

  if (!flatList || flatList.length === 0) {
    return res.json({ total: 0, data: [], hint: '5A景区数据库未加载' });
  }

  // ---- mode=tree: 返回省-市-县层级浏览 ----
  if (mode === 'tree') {
    // 如果指定了province，只返回该省
    let provinces = db.provinces;
    if (province) {
      const pNorm = province.trim();
      provinces = provinces.filter(p => p.name === pNorm || p.name.includes(pNorm));
    }
    const tree = provinces.map(p => ({
      province: p.name,
      count: p.count,
      cities: p.cities.map(c => ({
        city: c.name,
        count: c.count,
        districts: c.districts.map(d => ({
          district: d.name,
          count: d.areas.length,
          areas: d.areas.map(a => ({
            name: a.name,
            year: a.year,
            ticket: a.ticket,
            desc: a.desc,
            coords: a.coords,
            mapUrl: genStaticMapUrl(a.coords[0], a.coords[1])
          }))
        }))
      }))
    }));
    return res.json({ total: db.total, provinces: tree, mapAvailable: !!AMAP_KEY });
  }

  // ---- mode=list (默认): 按条件筛选景区列表 ----
  let matched = flatList;

  if (province) {
    const pNorm = province.trim();
    matched = matched.filter(a => a.province === pNorm || a.province.includes(pNorm));
  }

  if (city) {
    const cNorm = city.trim();
    matched = matched.filter(a => {
      // 精确匹配城市
      if (a.city === cNorm) return true;
      // 模糊匹配：城市名包含输入 或 输入包含城市名
      if (a.city.includes(cNorm) || cNorm.includes(a.city)) return true;
      // 匹配区县名
      if (a.district && (a.district === cNorm || a.district.includes(cNorm) || cNorm.includes(a.district))) return true;
      // 匹配名称中包含（如"天目湖"可以匹配到"溧阳"）
      if (a.name.includes(cNorm)) return true;
      return false;
    });
  }

  if (district) {
    const dNorm = district.trim();
    matched = matched.filter(a =>
      a.district && (a.district === dNorm || a.district.includes(dNorm) || dNorm.includes(a.district))
    );
  }

  // 生成结果（含静态地图URL）
  const result = matched.map(a => ({
    name: a.name,
    province: a.province,
    city: a.city,
    district: a.district || '',
    year: a.year,
    ticket: a.ticket,
    desc: a.desc,
    coords: a.coords,
    mapUrl: genStaticMapUrl(a.coords[0], a.coords[1])
  }));

  // 统计覆盖的城市
  const citySet = new Set(result.map(a => `${a.province}-${a.city}-${a.district}`));
  
  const response = {
    total: result.length,
    citiesCovered: citySet.size,
    mapAvailable: !!AMAP_KEY,
    hasAMAPKey: !!AMAP_KEY,
    data: result
  };

  // 缓存30分钟
  const cacheKey = `scenic5a_${province || ''}_${city || ''}_${district || ''}_${mode || 'list'}`;
  cache.set(cacheKey, response, 1800);
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
