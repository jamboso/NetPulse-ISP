import { useEffect, useRef, Component, type ReactNode } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, RedirectToSignIn } from "@clerk/react";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";

import { queryClient } from "./lib/queryClient";
import Layout from "./components/layout";

import Dashboard from "./pages/dashboard";
import Customers from "./pages/customers";
import CustomerDetail from "./pages/customer-detail";
import Plans from "./pages/plans";
import Subscriptions from "./pages/subscriptions";
import Invoices from "./pages/invoices";
import Payments from "./pages/payments";
import Tickets from "./pages/tickets";
import TicketDetail from "./pages/ticket-detail";
import Network from "./pages/network";
import RouterOSDashboard from "./pages/ros-dashboard";
import PPPoESetup from "./pages/pppoe-setup";
import HotspotManager from "./pages/hotspot-manager";
import CaptivePortal from "./pages/captive-portal";
import Settings from "./pages/settings";
import Compliance from "./pages/compliance";
import SmsManager from "./pages/sms-manager";
import Monitoring from "./pages/monitoring";
import NetworkMap from "./pages/network-map";

class ErrorBoundary extends Component<{ children: ReactNode; routeKey?: string }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prevProps: { routeKey?: string }) {
    if (prevProps.routeKey !== this.props.routeKey && this.state.error) {
      this.setState({ error: null });
    }
  }
  render() {
    const err = this.state.error as Error | null;
    if (err) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-center p-8">
          <p className="text-lg font-semibold text-gray-800">Something went wrong on this page.</p>
          <p className="text-xs font-mono text-red-500 bg-red-50 border border-red-200 rounded px-3 py-2 max-w-xl break-words">{err.message}</p>
          <p className="text-sm text-gray-500">Try navigating to another page, or click below to retry.</p>
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
            onClick={() => this.setState({ error: null })}
          >Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL as string | undefined;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const clerkAppearance = {
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "hsl(221, 83%, 53%)",
    colorForeground: "hsl(222, 47%, 11%)",
    fontFamily: "'Inter', sans-serif",
    borderRadius: "0.25rem",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-900 px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-900 px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function ProtectedRoutes() {
  const [location] = useLocation();
  return (
    <ErrorBoundary routeKey={location}>
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/customers" component={Customers} />
        <Route path="/customers/:id" component={CustomerDetail} />
        <Route path="/plans" component={Plans} />
        <Route path="/subscriptions" component={Subscriptions} />
        <Route path="/invoices" component={Invoices} />
        <Route path="/payments" component={Payments} />
        <Route path="/tickets" component={Tickets} />
        <Route path="/tickets/:id" component={TicketDetail} />
        <Route path="/network" component={Network} />
        <Route path="/network/routers/:id" component={RouterOSDashboard} />
        <Route path="/network/routers/:id/pppoe" component={PPPoESetup} />
        <Route path="/network/routers/:id/hotspot" component={HotspotManager} />
        <Route path="/settings" component={Settings} />
        <Route path="/compliance" component={Compliance} />
        <Route path="/sms" component={SmsManager} />
        <Route path="/monitoring" component={Monitoring} />
        <Route path="/map" component={NetworkMap} />
        <Route>
          <div className="p-8 text-center text-gray-500">Page not found.</div>
        </Route>
      </Switch>
    </Layout>
    </ErrorBoundary>
  );
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/hotspot/:routerId" component={CaptivePortal} />
      <Route>
        <Show when="signed-in">
          <ProtectedRoutes />
        </Show>
        <Show when="signed-out">
          <RedirectToSignIn />
        </Show>
      </Route>
    </Switch>
  );
}

export default function App() {
  const [, setLocation] = useLocation();

  return (
    <WouterRouter base={basePath}>
      <ClerkProvider
        publishableKey={clerkPubKey}
        proxyUrl={clerkProxyUrl}
        appearance={clerkAppearance}
        signInUrl={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        routerPush={(to) => setLocation(stripBase(to))}
        routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
      >
        <QueryClientProvider client={queryClient}>
          <ClerkQueryClientCacheInvalidator />
          <AppRouter />
        </QueryClientProvider>
      </ClerkProvider>
    </WouterRouter>
  );
}
