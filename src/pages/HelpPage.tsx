// 使用帮助：直接渲染 docs/使用手册.md，文档只维护一份。
import { useMemo } from 'react';
import { marked } from 'marked';
import manual from '../../docs/使用手册.md?raw';

export function HelpPage() {
  const html = useMemo(() => marked.parse(manual, { async: false }) as string, []);
  return <article className="card help" dangerouslySetInnerHTML={{ __html: html }} />;
}
