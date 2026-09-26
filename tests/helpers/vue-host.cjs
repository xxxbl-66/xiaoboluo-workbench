function createHost(createRenderer) {
  const root = node('root');
  const body = node('body');
  function remove(el) {
    if (!el.parentNode) return;
    const list = el.parentNode.children;
    const index = list.indexOf(el);
    if (index >= 0) list.splice(index, 1);
    el.parentNode = null;
  }
  function node(type, text = '') {
    return {
      type, text, value: '', props: {}, children: [], parentNode: null, listeners: {},
      addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); },
      removeEventListener(name, handler) { this.listeners[name] = (this.listeners[name] || []).filter((fn) => fn !== handler); },
      getRootNode() { return root; }
    };
  }
  const renderer = createRenderer({
    createElement: (type) => node(type),
    createText: (text) => node('#text', text),
    createComment: (text) => node('#comment', text),
    setText: (el, text) => { el.text = text; },
    setElementText: (el, text) => { el.text = text; el.children = []; },
    patchProp: (el, key, _old, value) => { el.props[key] = value; if (key === 'type') el.type = value; },
    insert(el, parent, anchor) {
      if (el.parentNode) remove(el);
      el.parentNode = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(el);
      else parent.children.splice(index, 0, el);
    },
    remove,
    parentNode: (el) => el.parentNode,
    nextSibling: (el) => {
      if (!el.parentNode) return null;
      return el.parentNode.children[el.parentNode.children.indexOf(el) + 1] || null;
    },
    querySelector: (selector) => selector === 'body' ? body : null
  });
  function all(start = root) {
    return [start, ...start.children.flatMap((child) => all(child))];
  }
  function visible() { return [...all(root), ...all(body)]; }
  function content(el) { return el.text + (el.props.innerHTML || '') + el.children.map(content).join(''); }
  function find(type, label) { return visible().find((el) => el.type === type && (!label || content(el).includes(label))); }
  function click(el) { if (!el) throw new Error('Element missing'); el.props.onClick?.(); }
  function input(el, value) {
    if (!el) throw new Error('Input missing');
    el.value = value;
    for (const listener of el.listeners.input || []) listener({ target: el });
  }
  return { renderer, root, body, visible, content, find, click, input };
}

module.exports = { createHost };
