// 悠行 - 地点搜索页面
const api = require('../../utils/api');
const mock = require('../../utils/mock');

Page({
  data: {
    city: '杭州',
    keyword: '',
    activeType: '全部',
    list: [],
    searched: false,
    dataSourceHint: ''
  },

  onLoad() {
    const state = api.getState();
    this.setData({ city: state.city });
  },

  onShow() {
    const state = api.getState();
    if (state.city !== this.data.city) {
      this.setData({ city: state.city });
    }
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  switchType(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ activeType: type }, () => {
      if (this.data.searched) this.doSearch();
    });
  },

  async doSearch() {
    const { keyword, activeType, city } = this.data;
    if (!keyword.trim()) return;

    this.setData({ searched: true, dataSourceHint: '⏳ 搜索中...' });

    // 尝试调用高德 API
    const res = await api.request('/api/amap/poi', {
      keywords: keyword,
      city,
      types: activeType === '全部' ? '' : activeType
    });

    if (res && res.data && res.data.list && res.data.list.length > 0) {
      api.updateDataSource('poi', 'live');
      this.setData({
        list: res.data.list,
        dataSourceHint: `✅ 高德地图返回 ${res.data.count || res.data.list.length} 条结果 · 实时数据`
      });
    } else {
      // 回退到模拟数据
      const mockList = mock.mockPoiList(keyword, activeType);
      this.setData({
        list: mockList,
        dataSourceHint: '📋 展示模拟数据（API Key 未配置或网络异常）'
      });
    }
  }
});
