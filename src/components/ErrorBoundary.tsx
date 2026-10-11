// 兜底：任何页面渲染出错时显示可读的提示，而不是一片空白。
import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="welcome">
        <div className="dropzone">
          <h2>页面出错了</h2>
          <p>{this.state.error.message}</p>
          <p className="muted small">请截图本页并反馈到 GitHub Issues。点下方按钮重新加载（需要重新导入数据）。</p>
          <div className="dz-actions"><button type="button" className="btn btn-primary" onClick={() => location.reload()}>重新加载</button></div>
        </div>
      </div>
    );
  }
}
