import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { errorMessage, isSignedOutError, setMediaToken, setServerUrl, veogenHttp } from "@/lib/http";
import { getMediaToken, getSession, login, logout } from "@/services/veogen";

const SERVER_KEY = "veogen.serverUrl";

type Session = {
  status: "loading" | "signedOut" | "signedIn";
  // The address used last, to prefill the sign-in form.
  serverUrl: string | null;
  // Why the saved server could not be reached, if it could not.
  problem: string | null;
  signIn: (serverUrl: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside SessionProvider");
  return session;
}

// Drops everything loaded from the server except the session itself, which the screens are routed by.
function forgetServerData(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" && query.queryKey[0] !== "media-token" });
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // undefined until the saved address has been read from the phone.
  const [serverUrl, setUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    void SecureStore.getItemAsync(SERVER_KEY).then((saved) => {
      setServerUrl(saved);
      setUrl(saved);
    });
  }, []);

  // Any request answered with "sign in first" means the session ended on the server.
  useEffect(() => {
    const id = veogenHttp.interceptors.response.use(undefined, (error: unknown) => {
      if (isSignedOutError(error)) void queryClient.invalidateQueries({ queryKey: ["session"] });
      return Promise.reject(error);
    });
    return () => veogenHttp.interceptors.response.eject(id);
  }, [queryClient]);

  const session = useQuery({ queryKey: ["session", serverUrl], queryFn: getSession, enabled: Boolean(serverUrl), retry: 1 });
  const signedIn = session.data?.signedIn === true;
  const media = useQuery({
    queryKey: ["media-token", serverUrl],
    queryFn: async () => {
      const { token } = await getMediaToken();
      setMediaToken(token);
      return token;
    },
    enabled: signedIn,
    staleTime: Infinity,
  });

  const value = useMemo<Session>(() => {
    const checking = serverUrl === undefined || (Boolean(serverUrl) && session.isPending) || (signedIn && (media.isPending || media.isFetching));
    return {
      status: checking ? "loading" : signedIn && media.isSuccess ? "signedIn" : "signedOut",
      serverUrl: serverUrl ?? null,
      problem: session.error ? errorMessage(session.error) : media.error ? errorMessage(media.error) : null,
      signIn: async (url, password) => {
        setServerUrl(url);
        try {
          await login({ password });
        } catch (error) {
          // Keep talking to the server that was working before, if there was one.
          setServerUrl(serverUrl ?? null);
          throw error;
        }
        await SecureStore.setItemAsync(SERVER_KEY, url);
        forgetServerData(queryClient);
        setUrl(url);
        await queryClient.invalidateQueries({ queryKey: ["media-token"] });
        await queryClient.refetchQueries({ queryKey: ["session"] });
      },
      signOut: async () => {
        await logout().catch(() => undefined);
        setMediaToken(null);
        forgetServerData(queryClient);
        await queryClient.refetchQueries({ queryKey: ["session"] });
      },
    };
  }, [serverUrl, session.isPending, session.error, signedIn, media.isPending, media.isFetching, media.isSuccess, media.error, queryClient]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
