<template>
  <div v-if="workspaceId === currentWorkspaceId && recentResult">
    <button v-if="!visible" class="ghost small" type="button" @click="showResult">查看上次运行结果</button>
    <WorkflowRunResult v-else :result="recentResult.result" :error="recentResult.error" :workflow-name="recentResult.name" @close="hideResult" />
  </div>
</template>

<script setup>
import WorkflowRunResult from './WorkflowRunResult.vue';
import { useRecentWorkflowResult } from '../composables/useRecentWorkflowResult.js';

defineProps({ currentWorkspaceId: { type: String, required: true } });
const { workspaceId, recentResult, visible, showResult, hideResult } = useRecentWorkflowResult();
</script>
