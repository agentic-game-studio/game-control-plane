"use client";

interface DataLoaderProps {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  children: React.ReactNode;
}

export function DataLoader({ loading, error, onRetry, children }: DataLoaderProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-black border-t-primary animate-spin mx-auto mb-4" />
          <span className="font-[var(--font-terminal)] text-sm uppercase text-outline">
            Loading...
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center border-2 border-red-600 bg-red-50 p-6 max-w-md">
          <span className="material-symbols-outlined text-red-600 text-4xl mb-2 block">
            error
          </span>
          <span className="font-[var(--font-terminal)] text-sm text-red-600 block mb-4">
            {error}
          </span>
          <button
            onClick={onRetry}
            className="border-2 border-red-600 bg-white text-red-600 font-[var(--font-label)] text-xs font-bold uppercase px-4 py-2 hover:bg-red-600 hover:text-white retro-press transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
