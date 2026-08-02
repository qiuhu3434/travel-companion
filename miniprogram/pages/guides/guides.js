// 悠行 - 攻略检索页面
const api = require('../../utils/api');
const mock = require('../../utils/mock');

Page({
  data: {
    keyword: '',
    list: [],
    scenicList: [],
    searched: false,
    dataSource: 'mock',
    hotTags: ['杭州', '常州', '苏州', '南京', '上海', '北京', '成都', '西安']
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

    // 同时获取景区导览
    this.fetchScenicGuides(cityMatch);

    // 攻略链接搜索（修复参数名 keyword -> keywords）
    const res = await api.request('/api/guides/search', { keywords: keyword, city: cityMatch });

    if (res && res.data && res.data.length > 0) {
      api.updateDataSource('guides', 'live');
      this.setData({ list: res.data, dataSource: 'live' });
    } else {
      const mockList = mock.mockGuides(keyword);
      this.setData({ list: mockList, dataSource: 'mock' });
    }

    wx.hideLoading();
  },

  async fetchScenicGuides(city) {
    const res = await api.request('/api/guides/scenic', { city: city });

    if (res && res.data && res.data.length > 0) {
      // 为每个景区添加 expanded 字段
      const scenicList = res.data.map(s => ({
        ...s,
        expanded: false,
        recommendedRoute: s.recommendedRoute || [],
        highlights: s.highlights || [],
        tips: s.tips || []
      }));
      this.setData({ scenicList });
    } else {
      this.setData({ scenicList: [] });
    }
  },

  toggleScenic(e) {
    const id = e.currentTarget.dataset.id;
    const scenicList = this.data.scenicList.map(s => {
      if (s.id === id) {
        return { ...s, expanded: !s.expanded };
      }
      return s;
    });
    this.setData({ scenicList });
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
      // 小程序中无法直接打开外部链接，复制到剪贴板
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
