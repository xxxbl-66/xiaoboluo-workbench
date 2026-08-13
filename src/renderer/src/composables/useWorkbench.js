export function getApi() {
  if (!window.workbench) {
    throw new Error('工作台 API 未加载，请通过 Electron 启动');
  }
  return window.workbench;
}

export const workbench = getApi();
