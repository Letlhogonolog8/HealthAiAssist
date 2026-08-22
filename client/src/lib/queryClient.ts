import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  url: string,
  method: string = 'GET',
  data?: unknown | undefined,
): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res.json();
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey[0] as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

/**
 * Defaults for every query in the application.
 *
 * The previous defaults were `staleTime: Infinity` with `refetchOnWindowFocus`
 * and `refetchInterval` both off. Together those mean a query result, once
 * fetched, is never refetched for the life of the page unless something
 * explicitly invalidates it. On a clinical dashboard that is the wrong default
 * in a specific and unsafe direction: a radiologist who left a tab open on the
 * reading queue in the morning was still looking at the morning's queue in the
 * afternoon, with no indication that anything had changed, and a scan flagged in
 * between never appeared.
 *
 * A short stale time plus refetch-on-focus is the honest default for data that
 * other people are changing. Components that genuinely want a snapshot — a
 * completed report, a model card — can still opt out per query, and the polling
 * intervals the dashboards already set continue to win where they are set.
 *
 * `retry: false` is kept deliberately. These endpoints are not idempotent-safe
 * to hammer, and a failed clinical read should surface as an error the user can
 * see rather than be retried quietly behind a spinner.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: true,
      // Long enough that a render burst does not become a request burst, short
      // enough that returning to a tab shows current data.
      staleTime: 30_000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
