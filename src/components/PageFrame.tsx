import React, { Component, Suspense } from 'react';
import { AlertOctagon, Loader2 } from 'lucide-react';
import { retryFailedPages } from '../lib/lazyPage';
import { checkForNewVersionNow } from '../lib/appUpdate';

interface PageFrameLabels {
  title: string;
  hint: string;
  retry: string;
}

const ENGLISH: PageFrameLabels = {
  title: 'Could not open this page',
  hint: 'This needs the internet. Check the connection and try again.',
  retry: 'Try again',
};

export function PageLoading({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex-1 flex items-center justify-center bg-[#F8FAFC] p-6">
      <div className="flex flex-col items-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
        <p className="text-base font-medium">{label}</p>
      </div>
    </div>
  );
}

interface BoundaryProps {
  labels: PageFrameLabels;
  /** Show nothing on failure and quietly try again a little later. */
  quiet: boolean;
  children: React.ReactNode;
}

const QUIET_RETRY_MS = 5000;

/** Shows "Try again" instead of a blank screen when a page fails to download or draw. */
class PageErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('A page could not be shown:', error);
    checkForNewVersionNow();
    if (this.props.quiet) this.retryTimer = setTimeout(this.retry, QUIET_RETRY_MS);
  }

  componentWillUnmount() {
    clearTimeout(this.retryTimer);
  }

  retry = () => {
    retryFailedPages();
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    const { labels, quiet } = this.props;
    if (quiet) return null;
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F8FAFC] p-6">
        <div className="max-w-md w-full bg-white border border-red-200 rounded-xl p-6 shadow-lg text-center space-y-4">
          <AlertOctagon className="h-10 w-10 text-red-500 mx-auto" />
          <h2 className="text-xl font-bold text-slate-900">{labels.title}</h2>
          <p className="text-sm text-slate-600 leading-relaxed">{labels.hint}</p>
          <button
            type="button"
            onClick={this.retry}
            className="min-h-12 px-5 bg-[#0F172A] text-white rounded-xl text-base font-semibold cursor-pointer"
          >
            {labels.retry}
          </button>
        </div>
      </div>
    );
  }
}

/** Wraps a page whose code is downloaded on demand (see lazyPage). */
export function PageFrame({
  children,
  loadingLabel,
  labels = ENGLISH,
  quiet = false,
}: {
  children: React.ReactNode;
  loadingLabel?: string;
  labels?: PageFrameLabels;
  /** For helpers that draw nothing until needed: no spinner, no error card. */
  quiet?: boolean;
}) {
  return (
    <PageErrorBoundary labels={labels} quiet={quiet}>
      <Suspense fallback={quiet ? null : <PageLoading label={loadingLabel} />}>{children}</Suspense>
    </PageErrorBoundary>
  );
}
