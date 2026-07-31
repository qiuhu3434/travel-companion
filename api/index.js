/**
 * Vercel Serverless Function 入口
 *
 * Vercel 会把 /api/* 路径的请求转发到这里，
 * serverless-http 把 Express app 包装成 Serverless 函数。
 */
const serverless = require('serverless-http');

let app;
try {
  app = require('../src/server');
} catch (err) {
  console.error('[启动错误]', err.message, err.stack);
  // 返回一个最小的 Express 实例，避免整个函数崩溃
  const express = require('express');
  app = express();
  app.all('*', (req, res) => {
    res.status(500).json({ error: '服务初始化失败', detail: err.message });
  });
}

module.exports = serverless(app);
