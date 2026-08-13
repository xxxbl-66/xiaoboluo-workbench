const crypto = require('node:crypto');

function id() {
  return crypto.randomUUID();
}

function defaultGroups() {
  return [{ id: 'default', name: '默认分组', sort: 0, createdAt: new Date().toISOString() }];
}

function defaultSettings() {
  return {
    theme: 'light',
    user: { name: '小菠萝', avatarDataUrl: '' },
    navOrder: [],
    launchAtStartup: false,
    extensions: {
      weather: false,
      cloudBackup: false
    },
    chatProviders: {
      doubao: { enabled: true, url: 'https://www.doubao.com/chat/', label: '豆包' },
      deepseek: { enabled: true, url: 'https://chat.deepseek.com/', label: 'DeepSeek' },
      gpt: { enabled: false, url: 'https://chatgpt.com/', label: 'GPT' }
    }
  };
}

module.exports = { id, defaultGroups, defaultSettings };
