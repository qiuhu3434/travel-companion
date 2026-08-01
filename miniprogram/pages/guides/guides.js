// 悠行 - 攻略检索页面
const api = require('../../utils/api');
const mock = require('../../utils/mock');

Page({
  data: {
    keyword: '',
    list: [],
    searched: false,
    dataSource: 'mock',
    hotTags: ['杭州', '三日游', '美食', '穷游', '避暑', '情侣', '亲子', '自驾']
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

    // 尝试调用后端
    const res = await api.request('/api/guides/search', { keyword });

    if (res && res.data && res.data.length > 0) {
      api.updateDataSource('guides', 'live');
      this.setData({ list: res.data, dataSource: 'live' });
    } else {
      // 回退到模拟数据
      const mockList = mock.mockGuides(keyword);
      this.setData({ list: mockList, dataSource: 'mock' });
    }

    wx.hideLoading();
  }
});
