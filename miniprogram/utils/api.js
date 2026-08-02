/**
 * 雨筹出行规划 - API 请求封装
 * 
 * 所有后端 API 调用统一入口，负责：
 * 1. 封装 wx.request
 * 2. 统一错误处理
 * 3. 超时控制
 * 4. 缓存数据回退
 */

const app = getApp();

const CACHE_KEY_PREFIX = 'api_cache_';
const DEFAULT_TIMEOUT = 10000;

/**
 * 发起 API 请求
 * @param {string} path    - API 路径，如 /api/weather/now
 * @param {object} params  - 查询参数
 * @param {object} options - 可选配置 { timeout, useCache, cacheTTL }
 * @returns {Promise<object|null>}
 */
function request(path, params = {}, options = {}) {
  const { timeout = DEFAULT_TIMEOUT, useCache = false, cacheTTL = 1800000, method = 'GET', body = null } = options;
  const baseUrl = app.globalData.apiBase;
  
  let url = baseUrl + path;
  let data = null;

  if (method === 'GET') {
    const queryStr = Object.keys(params)
      .filter(k => params[k] !== undefined && params[k] !== null)
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join('&');
    if (queryStr) url += '?' + queryStr;
  } else if (method === 'POST' && body) {
    data = body;
  }

  // 检查缓存
  if (useCache && method === 'GET') {
    const cacheKey = CACHE_KEY_PREFIX + path + '_' + JSON.stringify(params);
    const cached = wx.getStorageSync(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return Promise.resolve(cached.data);
    }
  }

  const requestOptions = { url, method, timeout };
  if (data) {
    requestOptions.data = data;
    requestOptions.header = { 'Content-Type': 'application/json' };
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('请求超时'));
    }, timeout);

    wx.request({
      ...requestOptions,
      success(res) {
        clearTimeout(timer);
        if (res.statusCode === 200) {
          const respData = res.data;
          if (useCache && method === 'GET' && respData && !respData.error) {
            wx.setStorageSync(CACHE_KEY_PREFIX + path + '_' + JSON.stringify(params), {
              data: respData,
              expires: Date.now() + cacheTTL
            });
          }
          resolve(respData);
        } else {
          console.warn(`[API] ${path} 返回 ${res.statusCode}:`, res.data);
          resolve(null);
        }
      },
      fail(err) {
        clearTimeout(timer);
        console.warn(`[API] ${path} 请求失败:`, err.errMsg);
        resolve(null);
      }
    });
  });
}

/**
 * 检查 Key 是否有效
 * @returns {Promise<{amap:boolean, qweather:boolean, wechat:boolean, qweatherHost:string}>}
 */
function checkKeys() {
  return request('/api/health');
}

/**
 * 获取全局状态
 */
function getState() {
  return app.globalData.state;
}

/**
 * 更新全局状态并持久化
 */
function updateState(updates) {
  Object.assign(app.globalData.state, updates);
  app.saveState();
}

/**
 * 获取数据来源信息
 */
function getDataSource() {
  return app.globalData.dataSource;
}

/**
 * 更新数据来源标记
 */
function updateDataSource(key, value) {
  app.globalData.dataSource[key] = value;
}

module.exports = {
  request,
  get: (path, params, options) => request(path, params, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, {}, { ...options, method: 'POST', body }),
  checkKeys,
  getState,
  updateState,
  getDataSource,
  updateDataSource
};
