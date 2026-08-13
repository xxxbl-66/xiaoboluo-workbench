<template>
  <div class="markdown-renderer" v-html="renderedHtml"></div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  content: { type: String, default: '' }
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(value) {
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, label, url) => {
    const safeUrl = escapeHtml(url).replace(/^javascript:/i, '');
    return `<a href="${safeUrl}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
  });
  return text;
}

const renderedHtml = computed(() => {
  const lines = String(props.content || '').replace(/\r\n/g, '\n').split('\n');
  const output = [];
  let inCode = false;
  let code = [];
  let listType = null;

  function closeList() {
    if (listType) {
      output.push(`</${listType}>`);
      listType = null;
    }
  }

  for (const raw of lines) {
    if (raw.trim().startsWith('```')) {
      if (inCode) {
        output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      code.push(raw);
      continue;
    }

    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      continue;
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      closeList();
      const match = trimmed.match(/^(#{1,6})\s+(.*)$/);
      const level = match[1].length;
      output.push(`<h${level}>${renderInline(match[2])}</h${level}>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (listType !== 'ul') {
        closeList();
        listType = 'ul';
        output.push('<ul>');
      }
      output.push(`<li>${renderInline(trimmed.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      if (listType !== 'ol') {
        closeList();
        listType = 'ol';
        output.push('<ol>');
      }
      output.push(`<li>${renderInline(trimmed.replace(/^\d+\.\s+/, ''))}</li>`);
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      closeList();
      output.push(`<blockquote>${renderInline(trimmed.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }

    closeList();
    output.push(`<p>${renderInline(line)}</p>`);
  }

  if (inCode) {
    output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  }
  closeList();
  return output.join('\n');
});
</script>
