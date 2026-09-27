<template>
  <div class="view settings-view">
    <header class="view-header">
      <div>
        <p class="view-kicker">WORKSPACE / SETTINGS</p>
        <h1>设置</h1>
        <p>调整外观与本地数据，工作台保持离线运行。</p>
      </div>
    </header>

    <section class="panel user-card">
      <button class="user-card__avatar" type="button" title="更换头像" @click="changeAvatar">
        <img v-if="userForm.avatarDataUrl" :src="userForm.avatarDataUrl" alt="头像" />
        <span v-else>{{ (userForm.name || '小').slice(0, 1) }}</span>
      </button>
      <div class="user-card__info">
        <input v-model="userForm.name" class="user-card__name" :disabled="savingUser" @blur="saveUser" @keyup.enter="saveUser" />
        <p v-if="saveError" class="user-card__error">{{ saveError }} —— 修改内容仍保留在输入框里，可以再次保存。</p>
        <p v-else-if="savingUser">正在保存…</p>
        <p v-else>点击头像更换图片，修改名字后按 Enter 或点击空白处保存。</p>
      </div>
    </section>

    <div class="settings-columns">
      <section class="panel settings-panel">
        <h2>通用</h2>
        <div class="setting-row">
          <div>
            <strong>主题</strong>
            <p>切换浅色或深色工作台外观。</p>
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
        <h2>数据与备份</h2>
        <div class="setting-row column">
          <div>
            <strong>数据目录</strong>
            <p>{{ info.dataDir || '读取中…' }}</p>
          </div>
          <div class="button-row">
            <button class="ghost small" type="button" @click="workbench.system.openDataDir()">打开数据目录</button>
            <button class="ghost small" type="button" @click="changeDataDir">更改位置</button>
            <button class="ghost small" type="button" @click="exportBackup">导出备份</button>
            <button class="ghost small" type="button" @click="importBackup">导入备份</button>
          </div>
        </div>
      </section>

      <section class="panel settings-panel">
        <h2>计时器铃声</h2>
        <div class="setting-row column">
          <div>
            <strong>提醒铃声</strong>
            <p>计时结束后播放的声音，可选择内置提示音或上传自定义音频。</p>
          </div>
          <div class="ringtone-options">
            <button
              v-for="tone in builtinTones"
              :key="tone.id"
              class="ghost small"
              :class="{ active: currentRingtoneId === tone.id }"
              type="button"
              @click="chooseBuiltinTone(tone.id)"
            >
              {{ tone.label }}
            </button>
            <button class="ghost small" :class="{ active: currentRingtoneId === 'custom' }" type="button" @click="chooseCustomTone">
              上传自定义铃声
            </button>
          </div>
          <p v-if="customToneName" class="ringtone-current">当前自定义铃声：{{ customToneName }}</p>
        </div>
      </section>

      <section class="panel settings-panel">
        <h2>删除数据</h2>
        <div class="setting-row column">
          <div>
            <strong>删除全部本地数据</strong>
            <p>清空待办、目标、收藏、便签、日历、书架索引等数据，操作不可撤销。</p>
          </div>
          <button class="danger-button" type="button" @click="clearAllData">删除本地数据</button>
        </div>
      </section>

      <section class="panel settings-panel about-panel">
        <h2>关于</h2>
        <p>四一四工作台</p>
        <p>个人数字工作台 · 版本 {{ info.version || '0.1.0' }} · 本地离线运行</p>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';
import { runSave } from '../composables/save-result.js';
import { saveCustomTone } from '../composables/settings-actions.js';

const props = defineProps({
  settings: { type: Object, default: () => ({ extensions: {} }) }
});

const emit = defineEmits(['settings-updated']);

const info = ref({ version: '', dataDir: '' });
const userForm = ref({ name: '用户', avatarDataUrl: '' });
const savingUser = ref(false);
const saveError = ref('');

const builtinTones = [
  { id: 'chime', label: '清脆提示音' },
  { id: 'wind', label: '柔和风铃' },
  { id: 'beep', label: '电子蜂鸣' }
];

const currentRingtone = computed(() => props.settings.timerRingtone || { type: 'builtin', id: 'chime' });
const currentRingtoneId = computed(() => (
  currentRingtone.value.type === 'custom' ? 'custom' : currentRingtone.value.id || 'chime'
));
const customToneName = computed(() => (
  currentRingtone.value.type === 'custom' ? currentRingtone.value.name : ''
));

/**
 * 通用设置保存。
 * 返回明确的 {ok,error}，调用方据此决定是否提示成功（原来吞掉错误后无条件提示）。
 */
async function updateSettings(patch, options = {}) {
  const outcome = await runSave(
    () => workbench.settings.update(patch),
    { fallback: '设置保存失败' }
  );
  if (outcome.ok) {
    saveError.value = '';
    emit('settings-updated', outcome.data);
  } else {
    saveError.value = outcome.error;
    if (!options.silent) toast(outcome.error, 'error');
  }
  return outcome;
}

async function changeAvatar() {
  try {
    const avatarDataUrl = await workbench.system.selectAvatar();
    if (!avatarDataUrl) return;
    userForm.value.avatarDataUrl = avatarDataUrl;
    await saveUser();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/**
 * 保存用户信息（名称与头像）。
 *
 * 只有主进程确认写入后才提示"用户信息已保存"。
 * 失败时保留用户已经输入的名称，并给出可重试的失败提示。
 */
async function saveUser() {
  if (savingUser.value) return;
  const nextUser = {
    name: (userForm.value.name || '').trim() || '用户',
    avatarDataUrl: userForm.value.avatarDataUrl || ''
  };
  savingUser.value = true;
  try {
    const outcome = await updateSettings({ user: nextUser }, { silent: true });
    if (!outcome.ok) {
      // 不覆盖 userForm，用户输入的名字留在输入框里可以重试
      saveError.value = outcome.error;
      toast(`用户信息保存失败：${outcome.error}`, 'error');
      return outcome;
    }
    userForm.value = { ...nextUser };
    saveError.value = '';
    toast('用户信息已保存');
    return outcome;
  } finally {
    savingUser.value = false;
  }
}

async function chooseBuiltinTone(id) {
  await updateSettings({ timerRingtone: { type: 'builtin', id } });
}

async function chooseCustomTone() {
  try {
    const audio = await workbench.system.selectAudio();
    if (!audio) return;
    await saveCustomTone(audio, updateSettings, toast);
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function clearAllData() {
  if (!window.confirm('确定要删除全部本地数据吗？此操作不可撤销。')) return;
  try {
    await workbench.settings.clearData();
    toast('本地数据已删除，工作台即将刷新');
    setTimeout(() => window.location.reload(), 600);
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function changeDataDir() {
  try {
    const result = await workbench.system.changeDataDir();
    if (result && result.canceled) return;
    toast("数据目录已更新，应用即将重启");
  } catch (error) {
    toast(error.message, "error");
  }
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
    // 备份是"部分覆盖"：只覆盖备份里包含的表，没有的表保持原样
    const tables = Array.isArray(result.importedTables) ? result.importedTables.length : result.count;
    toast(`已导入 ${tables} 个数据文件（未包含的表保持原样），重启应用后生效`);
  } catch (error) {
    // 结构不合法、含未知表、写入失败已回滚等情况都会走到这里
    toast(error.message, 'error');
  }
}

onMounted(async () => {
  userForm.value = {
    name: props.settings.user?.name || '用户',
    avatarDataUrl: props.settings.user?.avatarDataUrl || ''
  };
  try {
    info.value = await workbench.app.info();
  } catch (_) {}
});
</script>

<style scoped>
.ringtone-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.ringtone-options .active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.ringtone-current {
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.user-card {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.user-card__avatar {
  width: 64px;
  height: 64px;
  flex: 0 0 64px;
  border-radius: 50%;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: var(--primary-soft);
  color: var(--primary-strong);
  font-size: 26px;
  font-weight: 700;
}

.user-card__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.user-card__info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.user-card__name {
  width: min(220px, 100%);
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  padding: 8px 10px;
  font-size: 19px;
  font-weight: 750;
  color: var(--text);
}

.user-card__name:focus {
  border-color: var(--primary);
  background: var(--surface-2);
}

.user-card__info p {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.user-card__error {
  color: var(--danger) !important;
}

.danger-button {
  padding: 9px 16px;
  border: 1px solid #dc2626;
  border-radius: 10px;
  background: #ef4444;
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
}

.danger-button:hover {
  background: #dc2626;
  border-color: #b91c1c;
}
</style>
