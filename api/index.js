/**
 * Vercel Serverless Function 入口
 *
 * Vercel 会把 /api/* 路径的请求转发到这里，
 * serverless-http 把 Express app 包装成 Serverless 函数。
 */
const serverless = require('serverless-http');
const app = require('../src/server');

module.exports = serverless(app);
