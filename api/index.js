/**
 * Vercel Serverless Function 入口
 *
 * 不使用 serverless-http，直接导出 Express app。
 * Vercel @vercel/node 运行时会以 (req, res) 形式调用本导出函数，
 * 而 Express app 本身就是一个合法的 (req, res) => void 处理器。
 */
let app;
try {
  app = require('../src/server');
  if (typeof app !== 'function') {
    throw new Error('server.js 未导出可调用的 Express 实例');
  }
} catch (err) {
  console.error('[启动错误]', err.message, err.stack);
  const express = require('express');
  app = express();
  app.all('*', (req, res) => {
    res.status(500).json({ error: '服务初始化失败', detail: err.message });
  });
}

module.exports = app;
