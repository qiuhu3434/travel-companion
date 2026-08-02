// 悠行 - 攻略检索页面 (5A景区版)
const api = require('../../utils/api');
const mock = require('../../utils/mock');

Page({
  data: {
    keyword: '',
    list: [],
    scenicList: [],
    scenicTotal: 0,
    scenicCities: 0,
    searched: false,
    dataSource: 'mock',
    hotTags: ['杭州', '常州', '溧阳', '苏州', '南京', '上海', '北京', '成都', '西安', '黄山', '桂林']
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  quickSearch(e) {
    const tag = e.currentTarget.dataset.tag;
    this.setData({ keyword: tag }, () => {
      this.doSearch();
    });
  },

  async doSearch() {
    const keyword = this.data.keyword.trim();
    if (!keyword) return;

    wx.showLoading({ title: '搜索中...' });
    this.setData({ searched: true });

    // 提取城市名（关键词中第一个词或整体）
    const cityMatch = keyword.split(/[\s,，、]+/)[0] || keyword;

    // 同时获取5A景区导览和攻略链接
    await Promise.all([
      this.fetchScenicGuides(cityMatch),
      this.searchGuides(keyword, cityMatch)
    ]);

    wx.hideLoading();
  },

  async fetchScenicGuides(city) {
    const res = await api.request('/api/guides/scenic', { city: city });

    if (res && res.data && res.data.length > 0) {
      this.setData({
        scenicList: res.data,
        scenicTotal: res.total,
        scenicCities: res.citiesCovered || 1
      });
    } else {
      this.setData({ scenicList: [], scenicTotal: 0, scenicCities: 0 });
    }
  },

  async searchGuides(keyword, city) {
    const res = await api.request('/api/guides/search', { keywords: keyword, city: city });

    if (res && res.data && res.data.length > 0) {
      api.updateDataSource('guides', 'live');
      this.setData({ list: res.data, dataSource: 'live' });
    } else {
      const mockList = mock.mockGuides(keyword);
      this.setData({ list: mockList, dataSource: 'mock' });
    }
  },

  previewMap(e) {
    const url = e.currentTarget.dataset.url;
    if (url) {
      wx.previewImage({ urls: [url] });
    }
  },

  openGuide(e) {
    const url = e.currentTarget.dataset.url;
    if (url) {
      wx.setClipboardData({
        data: url,
        success: () => {
          wx.showToast({ title: '链接已复制', icon: 'success' });
        }
      });
    } else {
      wx.showToast({ title: '该攻略暂无链接', icon: 'none' });
    }
  }
});
