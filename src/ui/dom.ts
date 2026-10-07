export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
export function button(label: string, onClick: () => void, cls = 'ghost') {
  const b = el('button', cls, label);
  b.type = 'button';
  b.onclick = onClick;
  return b;
}
export function checkbox(label: string, checked: boolean, onChange: (on: boolean) => void) {
  const wrap = el('label', 'check');
  const cb = el('input');
  cb.type = 'checkbox'; cb.checked = checked;
  cb.onchange = () => onChange(cb.checked);
  wrap.append(cb, document.createTextNode(' ' + label));
  return { wrap, cb };
}
