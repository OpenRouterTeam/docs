export const Template = ({ children, data }) => {
  const replace = (s) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in data ? data[k] : `{{${k}}}`));

  // Get text content only if node is a leaf (single string child or plain string)
  const leafText = (node) =>
    typeof node === 'string' ? node
    : node?.$$typeof && typeof node.props?.children === 'string' ? node.props.children
    : null;

  // Shiki splits {{KEY}} across three spans: '{{' · 'KEY' · '}}'
  // Scan siblings and collapse those triplets into a single replacement string
  const collapseTokens = (nodes) => {
    const out = [];
    let i = 0;
    while (i < nodes.length) {
      const ta = leafText(nodes[i]);
      const tb = leafText(nodes[i + 1]);
      const tc = leafText(nodes[i + 2]);
      if (ta != null && tb != null && tc != null) {
        const m = (ta + tb + tc).match(/^([\s\S]*)\{\{(\w+)\}\}([\s\S]*)$/);
        if (m && m[2] in data) {
          out.push(m[1] + data[m[2]] + m[3]);
          i += 3;
          continue;
        }
      }
      out.push(nodes[i]);
      i++;
    }
    return out;
  };

  const process = (node) => {
    if (typeof node === 'string') return replace(node);
    if (Array.isArray(node)) return collapseTokens(node.map(process));
    if (node && typeof node === 'object') {
      if (node.$$typeof) return { ...node, props: process(node.props) };
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, process(v)]));
    }
    return node;
  };

  return <>{process(children)}</>;
};
