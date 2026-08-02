// 雨筹出行规划 - 主页逻辑
const api = require('../../utils/api');
const mock = require('../../utils/mock');

Page({
  data: {
    city: '杭州',
    weather: { temp: 32, desc: '晴', wind: '东南风3级', humidity: '65%' },
    weatherLoaded: false,
    weatherIcon: '☀️',
    forecast: [],
    tripStart: '2026-08-03',
    tripEnd: '2026-08-06',
    departTime: '08:00',
    returnTime: '18:00',
    warnings: [],
    dataSourceText: ''
  },

  onLoad() {
    const state = api.getState();
    this.setData({
      city: state.city,
      weather: state.date.weather,
      weatherLoaded: state.date.weatherLoaded,
      tripStart: state.date.start,
      tripEnd: state.date.end
    });

    // 从模拟数据初始化天气展示
    if (!state.date.weatherLoaded) {
      this.initMockWeather();
    }

    // 尝试加载真实天气
    this.loadRealWeather();
  },

  onShow() {
    // 从其它页面回来时同步状态
    const state = api.getState();
    if (state.city !== this.data.city) {
      this.setData({ city: state.city });
      this.loadRealWeather();
    }
  },

  /** 从模拟数据初始�化 */
  initMockWeather() {
    const state = api.getState();
    const now = mock.mockNow(state.city);
    const forecast = mock.mockForecast(state.city);
    this.setData({
      weather: {
        temp: now.temp,
        desc: now.text,
        wind: now.windDir + now.windScale + '级',
        humidity: now.humidity + '%',
        feelsLike: now.feelsLike
      },
      weatherIcon: this.getWeatherIcon(now.text),
      forecast,
      weatherLoaded: false
    });
  },

  /** 从后端API加载真实天气 */
  async loadRealWeather() {
    const app = getApp();
    const city = app.globalData.state.city;

    // 先查城市ID
    const cityRes = await api.request('/api/weather/city', { location: city });
    if (!cityRes || !cityRes.data || !cityRes.data[0]) {
      return; // 用模拟数据
    }

    const locationId = cityRes.data[0].id;

    // 并行请求：实时天气 + 预报 + 预警
    const [nowRes, fcRes, warnRes] = await Promise.all([
      api.request('/api/weather/now', { location: locationId }),
      api.request('/api/weather/forecast', { location: locationId }),
      api.request('/api/weather/warning', { location: locationId })
    ]);

    if (nowRes && nowRes.data) {
      const n = nowRes.data;
      api.updateDataSource('weather', 'live');

      // 更新 state
      const state = api.getState();
      state.date.weather = {
        temp: n.temp,
        desc: n.text,
        wind: n.windDir + n.windScale + '级',
        humidity: n.humidity + '%',
        feelsLike: n.feelsLike,
        forecast: fcRes && fcRes.data ? fcRes.data : []
      };
      state.date.weatherLoaded = true;
      app.saveState();

      // 格式化预报数据
      const forecast = (fcRes && fcRes.data ? fcRes.data : []).map(d => ({
        ...d,
        dateShow: d.date.slice(5)
      }));

      this.setData({
        weather: {
          temp: n.temp,
          desc: n.text,
          wind: n.windDir + n.windScale + '级',
          humidity: n.humidity + '%',
          feelsLike: n.feelsLike
        },
        weatherIcon: this.getWeatherIcon(n.text),
        weatherLoaded: true,
        forecast,
        dataSourceText: '✅ 天气数据已实时更新'
      });
    }

    // 预警
    if (warnRes && warnRes.data && warnRes.data.length > 0) {
      this.setData({ warnings: warnRes.data });
    }
  },

  /** 天气图标 */
  getWeatherIcon(text) {
    const t = (text || '').toLowerCase();
    if (t.includes('雨')) return '🌧️';
    if (t.includes('雪')) return '🌨️';
    if (t.includes('阴')) return '☁️';
    if (t.includes('多云')) return '⛅';
    if (t.includes('晴')) return '☀️';
    if (t.includes('风') || t.includes('沙')) return '💨';
    if (t.includes('雾') || t.includes('霾')) return '🌫️';
    return '🌤️';
  },

  /** 判断日期是否在行程范围内 */
  inTripRange(dateStr) {
    return dateStr >= this.data.tripStart && dateStr <= this.data.tripEnd;
  },

  /** 城市输入 */
  onCityInput(e) {
    this.setData({ city: e.detail.value });
  },

  onCityConfirm() {
    const city = this.data.city.trim();
    if (!city) return;
    
    const state = api.getState();
    state.city = city;
    getApp().saveState();
    
    // 先用模拟数据
    const now = mock.mockNow(city);
    const forecast = mock.mockForecast(city);
    this.setData({
      weather: {
        temp: now.temp,
        desc: now.text,
        wind: now.windDir + now.windScale + '级',
        humidity: now.humidity + '%',
        feelsLike: now.feelsLike
      },
      weatherIcon: this.getWeatherIcon(now.text),
      forecast,
      weatherLoaded: false,
      dataSourceText: '⏳ 正在获取实时天气...'
    });
    
    // 异步加载真实数据
    this.loadRealWeather();
  },

  /** 日期选择 */
  onStartChange(e) {
    const val = e.detail.value;
    this.setData({ tripStart: val });
    const state = api.getState();
    state.date.start = val;
    getApp().saveState();
  },

  onEndChange(e) {
    const val = e.detail.value;
    this.setData({ tripEnd: val });
    const state = api.getState();
    state.date.end = val;
    getApp().saveState();
  },

  onDepartTimeChange(e) {
    this.setData({ departTime: e.detail.value });
  },

  onReturnTimeChange(e) {
    this.setData({ returnTime: e.detail.value });
  },

  /**
   * 跳转预算/攻略/规划
   */
  goToBudget() {
    wx.navigateTo({ url: '/pages/budget/budget' });
  },

  goToGuides() {
    wx.navigateTo({ url: '/pages/guides/guides' });
  },

  goToPlan() {
    wx.navigateTo({ url: '/pages/plan/plan' });
  }
});
