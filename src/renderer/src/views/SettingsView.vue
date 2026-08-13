<template>
  <div class="view settings-view">
    <header class="view-header">
      <div>
        <h1>设置</h1>
        <p>调节外观、启动项、数据与预留扩展。</p>
      </div>
    </header>

    <div class="settings-columns">
      <section class="panel settings-panel">
        <h2>外观</h2>
        <div class="setting-row">
          <div>
            <strong>主题</strong>
            <p>跟随你的使用习惯切换明暗。</p>
          </div>
          <div class="segmented-tabs inline">
            <button :class="{ active: settings.theme !== 'dark' }" type="button" @click="updateSettings({ theme: 'light' })">浅色</button>
            <button :class="{ active: settings.theme === 'dark' }" type="button" @click="updateSettings({ theme: 'dark' })">深色</button>
          </div>
        </div>

        <div class="setting-row">
          <div>
            <strong>开机自启动</strong>
            <p>登录 Windows 后自动打开工作台。</p>
          </div>
          <label class="switch">
            <input type="checkbox" :checked="settings.launchAtStartup" @change="updateSettings({ launchAtStartup: $event.target.checked })" />
            <span></span>
          </label>
        </div>
      </section>

      <section class="panel settings-panel">
        <h2>对话服务</h2>
        <div v-for="provider in providerEntries" :key="provider.key" class="setting-row">
          <div>
            <strong>{{ provider.label }}</strong>
            <p>{{ provider.description }}</p>
          </div>
          <label class="switch">
            <input type="checkbox" :checked="provider.enabled" :disabled="provider.key === 'gpt'" @change="toggleProvider(provider.key, $event.target.checked)" />
            <span></span>
          </label>
        </div>
      </section>

      <section class="panel settings-panel">
        <h2>数据与备份</h2>
        <div class="setting-row column">
          <div>
            <strong>数据目录</strong>
            <p>{{ info.dataDir || '读取中…' }}</p>
          </div>
          <div class="button-row">
            <button class="ghost small" type="button" @click="workbench.system.openDataDir()">打开数据目录</button>
            <button class="ghost small" type="button" @click="exportBackup">导出备份</button>
            <button class="ghost small" type="button" @click="importBackup">导入备份</button>
          </div>
        </div>
      </section>

      <section class="panel settings-panel">
        <h2>预留扩展</h2>
        <p class="section-note">这些接口默认关闭，当前版本不会在关闭状态下发起任何网络请求。</p>
        <div class="setting-row">
          <div>
            <strong>天气</strong>
            <p>暂未开放，接口已预留。</p>
          </div>
          <label class="switch">
            <input type="checkbox" :checked="settings.extensions.weather" @change="toggleExtension('weather', $event.target.checked)" />
            <span></span>
          </label>
        </div>
        <div class="setting-row">
          <div>
            <strong>云端配置备份</strong>
            <p>暂未开放，当前仅支持本地备份。</p>
          </div>
          <label class="switch">
            <input type="checkbox" :checked="settings.extensions.cloudBackup" @change="toggleExtension('cloudBackup', $event.target.checked)" />
            <span></span>
          </label>
        </div>
      </section>

      <section class="panel settings-panel about-panel">
        <h2>关于</h2>
        <p>小菠萝的工作台</p>
        <p>版本 {{ info.version || '0.1.0' }} · 本地离线运行</p>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';

const props = defineProps({
  settings: { type: Object, default: () => ({ extensions: {}, chatProviders: {} }) }
});

const emit = defineEmits(['settings-updated']);

const info = ref({ version: '', dataDir: '' });

const providerEntries = computed(() => {
  const configured = props.settings.chatProviders || {};
  return [
    { key: 'doubao', label: '豆包', enabled: true, description: '字节跳动 AI 助手', ...(configured.doubao || {}) },
    { key: 'deepseek', label: 'DeepSeek', enabled: true, description: '深度求索 AI 助手', ...(configured.deepseek || {}) },
    { key: 'gpt', label: 'GPT', enabled: false, description: '接口预留，网络可用后开放', ...(configured.gpt || {}) }
  ];
});

async function updateSettings(patch) {
  try {
    const next = await workbench.settings.update(patch);
    emit('settings-updated', next);
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function toggleProvider(key, enabled) {
  const nextProviders = {
    ...props.settings.chatProviders,
    [key]: { ...(props.settings.chatProviders[key] || {}), enabled }
  };
  await updateSettings({ chatProviders: nextProviders });
}

async function toggleExtension(key, enabled) {
  const nextExtensions = {
    ...props.settings.extensions,
    [key]: enabled
  };
  await updateSettings({ extensions: nextExtensions });
}

async function exportBackup() {
  try {
    const result = await workbench.backup.export();
    toast(`备份已导出：${result.filePath}`);
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function importBackup() {
  try {
    const result = await workbench.backup.import();
    if (result && result.canceled) return;
    toast(`已导入 ${result.count} 个数据文件，重启应用后生效`);
  } catch (error) {
    toast(error.message, 'error');
  }
}

onMounted(async () => {
  try {
    info.value = await workbench.app.info();
  } catch (_) {}
});
</script>
