import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { C } from './theme';

/**
 * Help's topics are written as a little HTML (src/ui/help.ts, shared with the web app). This draws the few tags they
 * use as native text: paragraphs, h3, lists, bold and italic, line breaks. Anything else is shown as its text.
 */
const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&rarr;': '→', '&larr;': '←', '&middot;': '·', '&hellip;': '…', '&mdash;': '—', '&ndash;': '–' };
const decode = (t: string) => t.replace(/&[a-z#0-9]+;/gi, (e) => ENT[e] ?? e);

/** Bold / italic runs inside a block. */
function inline(html: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /<(b|strong|i|em|kbd|code)\b[^>]*>([\s\S]*?)<\/\1>|<br\s*\/?>/gi;
  let last = 0, m: RegExpExecArray | null, n = 0;
  const plain = (t: string) => decode(t.replace(/<[^>]+>/g, ''));
  while ((m = re.exec(html))) {
    if (m.index > last) out.push(plain(html.slice(last, m.index)));
    if (!m[1]) out.push('\n');
    else {
      const tag = m[1].toLowerCase();
      out.push(<Text key={`${key}-${n++}`} style={tag === 'b' || tag === 'strong' ? st.bold : tag === 'kbd' || tag === 'code' ? st.code : st.italic}>{plain(m[2])}</Text>);
    }
    last = re.lastIndex;
  }
  if (last < html.length) out.push(plain(html.slice(last)));
  return out;
}

export function Html({ html }: { html: string }) {
  const blocks: ReactNode[] = [];
  const re = /<(p|h3|h4|ul|ol|div)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null, i = 0, last = 0;
  const loose = (t: string) => { const s = t.replace(/<[^>]+>/g, '').trim(); if (s) blocks.push(<Text key={`l${i++}`} style={st.p}>{inline(t, `l${i}`)}</Text>); };
  while ((m = re.exec(html))) {
    loose(html.slice(last, m.index));
    const tag = m[1].toLowerCase(), body = m[2], k = `b${i++}`;
    if (tag === 'ul' || tag === 'ol') {
      const items = [...body.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((x) => x[1]);
      blocks.push(<View key={k} style={st.list}>{items.map((it, j) => (
        <View key={j} style={st.li}><Text style={st.bullet}>{tag === 'ol' ? `${j + 1}.` : '•'}</Text><Text style={st.liText}>{inline(it, `${k}-${j}`)}</Text></View>
      ))}</View>);
    } else if (tag === 'h3' || tag === 'h4') blocks.push(<Text key={k} style={st.h3}>{inline(body, k)}</Text>);
    else blocks.push(<Text key={k} style={st.p}>{inline(body, k)}</Text>);
    last = re.lastIndex;
  }
  loose(html.slice(last));
  return <View>{blocks}</View>;
}

const st = StyleSheet.create({
  p: { fontSize: 14, lineHeight: 21, color: C.ink, marginBottom: 10 },
  h3: { fontSize: 15, fontWeight: '600', color: C.ink, marginTop: 8, marginBottom: 6 },
  list: { marginBottom: 10, gap: 6 },
  li: { flexDirection: 'row', gap: 8 },
  bullet: { fontSize: 14, lineHeight: 21, color: C.sage, width: 14 },
  liText: { flex: 1, fontSize: 14, lineHeight: 21, color: C.ink },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  code: { fontWeight: '600', color: C.sageText },
});
