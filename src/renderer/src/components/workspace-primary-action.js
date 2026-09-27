export function workspacePrimaryAction(workspace, activeSession, lastSession) {
  if (workspace?.archived === true) return { id: 'restore', label: '恢复工作空间' };
  if (activeSession?.workspaceId === workspace?.id) return { id: 'working', label: '正在工作' };
  if (activeSession) return { id: 'elsewhere', label: '返回正在工作的项目' };
  if (lastSession) return { id: 'resume', label: '继续工作' };
  return { id: 'start', label: '开始工作' };
}
