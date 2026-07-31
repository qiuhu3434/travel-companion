/**
 * 悠行 - 出行游玩规划助手 后端服务
 *
 * 本文件是整个后端的入口，负责：
 * 1. 加载环境变量（.env）
 * 2. 挂载所有 API 路由（高德/天气/攻略/微信）
 * 3. 托管前端页面（public/index.html）
 * 4. 启动 HTTP 服务
 *
 * 启动后浏览器访问 http://localhost:3000 即可使用全部功能。
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

/* ---- 中间件 ---- */
app.use(cors());
app.use(express.json());

// 简易限流：每个IP每分钟最多60次请求
const requestCounts = {};
app.use((req, res, next) => {
  // 只限制 /api 路径
  if (!req.path.startsWith('/api/')) return next();
  // 兼容 Serverless 环境（Vercel 下 req.connection 可能不存在）
  const ip = req.ip || (req.connection && req.connection.remoteAddress) || req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  if (!requestCounts[ip] || now - requestCounts[ip].resetTime > 60000) {
    requestCounts[ip] = { count: 0, resetTime: now };
  }
  requestCounts[ip].count++;
  if (requestCounts[ip].count > 60) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }
  next();
});

/* ---- 辅助函数：检测Key是否为真实值（非空且非占位符）---- */
function isRealKey(val) {
  if (!val) return false;
  const placeholders = ['your_', 'placeholder', 'xxx', 'test', 'example', 'change_me'];
  const lower = val.toLowerCase();
  return !placeholders.some(p => lower.startsWith(p));
}

/* ---- 路由挂载 ---- */
app.use('/api/amap', require('./routes/amap'));
app.use('/api/weather', require('./routes/weather'));
app.use('/api/guides', require('./routes/guides'));
app.use('/api/wechat', require('./routes/wechat'));

/* ---- 健康检查 ---- */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    keys: {
      amap: isRealKey(process.env.AMAP_KEY),
      qweather: isRealKey(process.env.QWEATHER_KEY),
      wechat: isRealKey(process.env.WX_APPID) && isRealKey(process.env.WX_SECRET)
    }
  });
});

/* ---- 托管前端页面 ---- */
// public/ 目录与 src/ 同级，无论项目克隆到哪里都能正确找到
const frontendDir = path.join(__dirname, '..', 'public');
app.use(express.static(frontendDir));

app.get('/', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'), (err) => {
    if (err) res.status(404).json({ error: '前端页面未找到' });
  });
});

// 所有非 /api、非静态文件的请求都返回 index.html（前端路由兼容）
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(frontendDir, 'index.html'), (err) => {
    if (err) res.status(404).json({ error: '前端页面未找到', path: req.path });
  });
});

/* ---- 全局错误处理 ---- */
app.use((err, req, res, next) => {
  console.error('[错误]', err.message);
  res.status(500).json({ error: '服务器内部错误', detail: err.message });
});

/* ---- 导出 app 供 Vercel Serverless 使用 ---- */
module.exports = app;

/* ---- 本地启动服务 ----
 * 仅在直接运行本文件时启动 HTTP 服务（node src/server.js）
 * Vercel 等 Serverless 平台会导入 app，不会执行下面这段
 */
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    const amapOk = isRealKey(process.env.AMAP_KEY);
    const qweatherOk = isRealKey(process.env.QWEATHER_KEY);
    const wxOk = isRealKey(process.env.WX_APPID) && isRealKey(process.env.WX_SECRET);

    console.log('');
    console.log('=================================');
    console.log('  悠行 - 出行游玩规划助手 已启动');
    console.log('=================================');
    console.log('');
    console.log('  前端页面:  http://localhost:' + PORT);
    console.log('  API检测:   http://localhost:' + PORT + '/api/health');
    console.log('');
    console.log('  API Key 状态:');
    console.log('    高德地图:   ' + (amapOk ? '已配置' : '未配置 (使用模拟数据)'));
    console.log('    和风天气:   ' + (qweatherOk ? '已配置' : '未配置 (使用模拟数据)'));
    console.log('    微信小程序: ' + (wxOk ? '已配置' : '未配置 (使用模拟数据)'));
    console.log('');
    if (!amapOk && !qweatherOk && !wxOk) {
      console.log('  提示: 所有Key均未配置，页面可正常预览但使用模拟数据。');
      console.log('        配置方法: 复制 .env.example 为 .env，填入Key后重启。');
    }
    console.log('=================================');
    console.log('');
  });
}
