<template>
  <div class="view chat-view">
    <header class="chat-header">
      <div class="chat-title">
        <span class="chat-logo"><LineIcon name="chat" :size="22" /></span>
        <div>
          <h1>对话</h1>
          <p>选择服务后，在工作台内打开对应网页。</p>
        </div>
      </div>
      <div class="chat-actions" v-if="activeProvider">
        <button class="ghost small" type="button" @click="goBack">后退</button>
        <button class="ghost small" type="button" @click="reload">刷新</button>
        <button class="ghost small" type="button" @click="openExternal">在浏览器打开</button>
      </div>
    </header>

    <div class="provider-tabs">
      <button
        v-for="provider in providers"
        :key="provider.key"
        class="provider-tab"
        :class="{ active: activeId === provider.key, disabled: !provider.enabled }"
        type="button"
        @click="selectProvider(provider)"
      >
        <span>{{ provider.label }}</span>
        <small v-if="!provider.enabled">接口预留</small>
      </button>
    </div>

    <div class="chat-stage">
      <div v-if="loading" class="chat-loading">正在加载 {{ activeProvider.label }}…</div>
      <div v-if="failed" class="chat-failed">
        <div>网页加载失败</div>
        <p>{{ failedMessage }}</p>
        <button class="primary" type="button" @click="reload">重试</button>
      </div>
      <webview
        v-if="activeProvider"
        ref="webviewRef"
        class="chat-webview"
        :src="activeProvider.url"
        :partition="`persist:xiaoboluo-chat-${activeProvider.key}`"
        allowpopups
        @dom-ready="onReady"
        @did-start-loading="loading = true"
        @did-stop-loading="loading = false"
        @did-navigate="onNavigate"
        @did-fail-load="onFail"
      ></webview>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import LineIcon from '../components/LineIcon.vue';
import { workbench } from '../composables/useWorkbench.js';

const props = defineProps({
  settings: { type: Object, default: () => ({}) }
});

const webviewRef = ref(null);
const activeId = ref('');
const loading = ref(false);
const failed = ref(false);
const failedMessage = ref('');
const currentUrl = ref('');

const providers = computed(() => {
  const configured = props.settings.chatProviders || {};
  return [
    { key: 'doubao', label: '豆包', enabled: true, url: 'https://www.doubao.com/chat/', ...(configured.doubao || {}) },
    { key: 'deepseek', label: 'DeepSeek', enabled: true, url: 'https://chat.deepseek.com/', ...(configured.deepseek || {}) },
    { key: 'gpt', label: 'GPT', enabled: false, url: 'https://chatgpt.com/', ...(configured.gpt || {}) }
  ];
});

const activeProvider = computed(() => providers.value.find((item) => item.key === activeId.value));

function selectProvider(provider) {
  if (!provider.enabled) return;
  if (activeId.value === provider.key) return;
  activeId.value = provider.key;
  failed.value = false;
  failedMessage.value = '';
  currentUrl.value = provider.url;
}

function onReady() {
  loading.value = false;
  failed.value = false;
}

function onNavigate(event) {
  currentUrl.value = event.url || currentUrl.value;
}

function onFail(event) {
  if (event.isMainFrame) {
    failed.value = true;
    failedMessage.value = event.errorDescription || '请检查网络连接';
    loading.value = false;
  }
}

function reload() {
  failed.value = false;
  if (webviewRef.value) {
    webviewRef.value.reload();
  }
}

function goBack() {
  if (webviewRef.value && webviewRef.value.canGoBack()) {
    webviewRef.value.goBack();
  }
}

function openExternal() {
  if (currentUrl.value) workbench.system.openExternal(currentUrl.value);
}

onMounted(() => {
  const first = providers.value.find((item) => item.enabled);
  if (first) activeId.value = first.key;
});
</script>
