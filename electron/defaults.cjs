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
    timerRingtone: { type: 'builtin', id: 'chime' },
    extensions: {
      cloudBackup: false
    },
    chatProviders: {
      doubao: { enabled: true, url: 'https://www.doubao.com/chat/', label: '豆包' },
      deepseek: { enabled: true, url: 'https://chat.deepseek.com/', label: 'DeepSeek' },
      qwen: { enabled: true, url: 'https://chat.qwen.ai/', label: '千问' },
      gpt: { enabled: true, url: 'https://chatgpt.com/', label: 'GPT' }
    }
  };
}

module.exports = { id, defaultGroups, defaultSettings };
