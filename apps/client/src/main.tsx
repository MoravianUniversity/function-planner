import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import 'sonner/dist/styles.css';
import './index.css';
import { ApiHttpError } from './api/client';
import { applyAppTheme, getStoredTheme } from './theme';

applyAppTheme(getStoredTheme());

function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) {
    return false;
  }
  if (error instanceof ApiHttpError) {
    if (error.status >= 400 && error.status < 500) {
      return false;
    }
  }
  return true;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 5000)
    },
    mutations: {
      retry: shouldRetryQuery,
      retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 5000)
    }
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
